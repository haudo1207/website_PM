import datetime
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..database import get_db
from ..models.user import User
from ..models.member import Member
from ..models.project import Project, project_members
from ..models.phase import Phase
from ..models.task_group import TaskGroup
from ..models.task import Task
from ..models.zalo import ZaloAccount, ZaloConversation, ZaloMessage, ZaloDemoRequest, ZaloConversationSummary
from ..utils.auth import get_current_user, require_zalo_user
from ..config import settings
from ..services import zalo as zalo_service
from ..services import zalo_task_parser
from ..services import zalo_summary

logger = logging.getLogger("zalo")

router = APIRouter()


def _utf16_len(s: str) -> int:
    """Zalo's mention pos/len are UTF-16 code units (its client is
    JS-based), not Python's `len()` (Unicode code points) — they diverge
    for any astral character (many emoji, some rare CJK). Always use this
    when computing mention offsets server-side."""
    return len(s.encode("utf-16-le")) // 2


# ── Request/response models (kept in the router file — schemas/ folder is
# effectively unused in this codebase, see routers/meetings.py convention) ──
class ImportSessionRequest(BaseModel):
    cookies: list
    imei: str = ""
    user_agent: str = ""


class SendMessageRequest(BaseModel):
    text: str
    # Real Zalo mentions to attach — [{uid, pos, len}], computed client-side
    # from where "@Name" landed in the final text (see zalo-account/page.tsx).
    mentions: Optional[list] = None


class SendToThreadRequest(BaseModel):
    thread_id: str
    text: str
    is_group: bool = False
    name: Optional[str] = None


class CreateTaskRequest(BaseModel):
    title: str
    # The assignee is picked directly from this project's own member list
    # (project_members) — no dependency on a live Zalo group-roster fetch,
    # which requires an active Zalo session and was the actual cause of an
    # empty assignee picker once that session expired. The tag used when
    # notifying the group still prefers the member's Zalo name (see
    # Member.zalo_name / zalo_uid), it's just resolved from an already-known
    # Member instead of an ephemeral roster entry.
    assigned_member_id: int
    priority: str = "Normal"
    manday: float
    deadline: Optional[str] = None  # "YYYY-MM-DD"


class RemindUnlinkedRequest(BaseModel):
    zalo_name: str


class RequestDemoRequest(BaseModel):
    task_id: int
    demo_at: str  # ISO datetime, e.g. "2026-09-20T14:30"


class LinkProjectRequest(BaseModel):
    project_id: Optional[int] = None


class InternalMessageRequest(BaseModel):
    account_id: int
    thread_id: str
    is_group: bool
    name: Optional[str] = None
    source_message_id: str
    sender_zalo_id: Optional[str] = None
    sender_name: Optional[str] = None
    content: Optional[str] = None
    is_outgoing: bool = False
    # Real Zalo @mentions ({uid, text}), sliced from content via the
    # mention's pos/len by the sidecar — more reliable than regex-parsing
    # "@Name" ourselves (see zalo_task_parser.py).
    mentions: Optional[list] = None


# ── Helpers ─────────────────────────────────────────────────────
# Each Leader/Admin owns exactly one ZaloAccount (owner_user_id) — never a
# shared/singleton row. Every caller-facing endpoint below resolves "my
# account" through these, so a Leader's calls only ever touch their own
# conversations/messages, never another Leader's.
def _account_for_user(db: Session, current_user: User) -> Optional[ZaloAccount]:
    return (
        db.query(ZaloAccount)
        .filter(ZaloAccount.owner_user_id == current_user.id)
        .first()
    )


def _require_account_for_user(db: Session, current_user: User) -> ZaloAccount:
    account = _account_for_user(db, current_user)
    if not account:
        raise HTTPException(status_code=404, detail="Bạn chưa kết nối tài khoản Zalo nào.")
    return account


def _upsert_conversation(
    db: Session,
    account_id: int,
    thread_id: str,
    name: Optional[str],
    is_group: bool,
    last_message_at,
    preview: Optional[str],
) -> ZaloConversation:
    stmt = pg_insert(ZaloConversation).values(
        account_id=account_id,
        zalo_thread_id=thread_id,
        name=name,
        is_group=is_group,
        last_message_at=last_message_at,
        last_message_preview=(preview or "")[:500] or None,
    )
    update_cols = {
        "last_message_at": stmt.excluded.last_message_at,
        "last_message_preview": stmt.excluded.last_message_preview,
        "updated_at": datetime.datetime.now(datetime.timezone.utc),
    }
    # Only overwrite the name when we actually have one — an outgoing send
    # to a brand-new thread may not know the display name yet, and we don't
    # want that to blank out a name the listener already learned.
    if name:
        update_cols["name"] = stmt.excluded.name
    if is_group:
        update_cols["is_group"] = True
    stmt = stmt.on_conflict_do_update(
        constraint="uq_zalo_conversations_account_thread",
        set_=update_cols,
    ).returning(ZaloConversation.id)
    conversation_id = db.execute(stmt).scalar_one()
    db.commit()
    return db.query(ZaloConversation).filter(ZaloConversation.id == conversation_id).first()


def _insert_message(
    db: Session,
    conversation_id: int,
    source_message_id: str,
    sender_zalo_id: Optional[str],
    sender_name: Optional[str],
    content: Optional[str],
    is_outgoing: bool,
) -> bool:
    """Returns True only if this actually inserted a NEW row — False means
    a message with this (conversation_id, source_message_id) already
    existed (e.g. the listener echoing back something we already recorded
    synchronously via our own /send endpoint). Callers use this, not
    `is_outgoing`, to decide whether a message is genuinely new — `is_outgoing`
    only reflects who sent it (for UI bubble alignment), not whether we've
    already processed it (see receive_worker_message)."""
    stmt = pg_insert(ZaloMessage).values(
        conversation_id=conversation_id,
        source_message_id=str(source_message_id),
        sender_zalo_id=sender_zalo_id,
        sender_name=sender_name,
        content=content,
        is_outgoing=is_outgoing,
    ).on_conflict_do_nothing(
        constraint="uq_zalo_messages_conversation_source",
    ).returning(ZaloMessage.id)
    inserted = db.execute(stmt).first() is not None
    db.commit()
    return inserted


# ── Status / connect / disconnect ──────────────────────────────
@router.get("/status")
def zalo_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    account = _account_for_user(db, current_user)
    worker = (
        zalo_service.get_status(account.id) if account
        else {"logged_in": False, "listener_connected": False, "configured": zalo_service.is_configured()}
    )
    return {
        "connected": bool(account and worker.get("logged_in")),
        "account": None if not account else {
            "id": account.id,
            "label": account.label,
            "status": account.status,
            "last_login_at": account.last_login_at,
        },
        "worker": worker,
    }


@router.post("/auth/import-session")
def zalo_import_session(
    payload: ImportSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    account = _account_for_user(db, current_user)
    if not account:
        account = ZaloAccount(owner_user_id=current_user.id, label="Zalo giao task", status="disconnected")
        db.add(account)
        db.commit()
        db.refresh(account)

    try:
        result = zalo_service.import_session(account.id, payload.cookies, payload.imei, payload.user_agent)
    except RuntimeError as exc:
        logger.error("zalo/auth/import-session failed for user_id=%s: %s", current_user.id, exc)
        raise HTTPException(status_code=502, detail=str(exc))

    account.status = "connected"
    account.last_login_at = datetime.datetime.now(datetime.timezone.utc)
    account.last_error = None
    account.zalo_uid = result.get("zalo_uid") or account.zalo_uid
    db.commit()
    db.refresh(account)
    return {"connected": True, "account_id": account.id}


@router.post("/disconnect")
def zalo_disconnect(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    account = _account_for_user(db, current_user)
    if account:
        try:
            zalo_service.disconnect(account.id)
        except RuntimeError as exc:
            logger.warning("Zalo worker disconnect call failed (continuing): %s", exc)
        account.status = "disconnected"
        db.commit()
    return {"connected": False}


# ── Conversations / messages (test panel, phase 1) ─────────────
@router.get("/groups/available")
def list_available_groups(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """All Zalo groups the caller's own connected account is currently a
    member of, from the sidecar's in-memory cache (populated on login) —
    lets the Leader pick a group by name instead of hunting for its raw
    thread id via chat.zalo.me (which also risks bumping the worker's own
    session, see the "Đổi thiết bị" conflict). Already-tracked groups are
    flagged so the picker can skip/dim them."""
    account = _require_account_for_user(db, current_user)
    snapshot = zalo_service.get_groups(account.id)
    groups = snapshot.get("groups") or {}

    tracked_ids = {
        c.zalo_thread_id
        for c in db.query(ZaloConversation).filter(ZaloConversation.account_id == account.id).all()
    }
    return [
        {"thread_id": thread_id, "name": name, "already_tracked": thread_id in tracked_ids}
        for thread_id, name in groups.items()
    ]


@router.get("/conversations")
def list_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    account = _require_account_for_user(db, current_user)
    rows = (
        db.query(ZaloConversation)
        .options(joinedload(ZaloConversation.project))
        # Zalo task assignment (roster, mentions, project link) only makes
        # sense for groups — 1:1 threads clutter the list with no way to use
        # any of that, so they're filtered out here at the source.
        .filter(ZaloConversation.account_id == account.id, ZaloConversation.is_group.is_(True))
        .order_by(ZaloConversation.last_message_at.desc().nullslast())
        .all()
    )
    return [
        {
            "id": c.id,
            "thread_id": c.zalo_thread_id,
            "name": c.name or c.zalo_thread_id,
            "is_group": c.is_group,
            "last_message_at": c.last_message_at,
            "last_message_preview": c.last_message_preview,
            "project_id": c.project_id,
            "project_name": c.project.name if c.project else None,
        }
        for c in rows
    ]


@router.post("/conversations/{conversation_id}/link-project")
def link_conversation_project(
    conversation_id: int,
    payload: LinkProjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """Links (or unlinks, when project_id is null) a conversation to a
    project. Once linked, incoming messages matching the /task syntax in
    that conversation create a Task under that project."""
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")

    if payload.project_id is not None:
        project = db.query(Project).filter(Project.id == payload.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Không tìm thấy dự án.")

    conv.project_id = payload.project_id
    db.commit()
    return {"conversation_id": conv.id, "project_id": conv.project_id}


@router.post("/conversations/refresh-names")
def refresh_conversation_names(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """Backfill names for conversations that were created before the
    sidecar's group/friend name cache was ready (or before this feature
    existed) — matches them against the sidecar's current cache snapshot.
    New conversations resolve their name automatically going forward; this
    is only needed for stale rows already sitting with a placeholder name.
    """
    account = _require_account_for_user(db, current_user)
    snapshot = zalo_service.get_groups(account.id)
    groups = snapshot.get("groups") or {}
    friends = snapshot.get("friends") or {}
    updated = 0
    rows = db.query(ZaloConversation).filter(ZaloConversation.account_id == account.id).all()
    for conv in rows:
        resolved = (groups if conv.is_group else friends).get(conv.zalo_thread_id)
        if resolved and resolved != conv.name:
            conv.name = resolved
            updated += 1
    db.commit()
    return {"updated": updated, "checked": len(rows)}


@router.get("/conversations/{conversation_id}/suggested-members")
def suggested_task_mentions(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """Real Zalo group roster, cross-referenced against known members —
    tells the admin exactly which names will resolve (linked=true) and
    which still need a Zalo name set before they can be assigned a task
    (linked=false). Groups only — a DM has no "roster" to suggest.

    Matches against Member.zalo_name first (the deliberate, admin-set
    mapping — always wins), then falls back to full_name/display_name so
    someone whose real name already matches their Zalo display name doesn't
    need to be manually re-entered in /accounts just to show up here."""
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
    if not conv.is_group:
        return {"members": [], "total_member": 0}

    snapshot = zalo_service.get_conversation_members(account.id, conv.zalo_thread_id)
    all_members = db.query(Member).all()
    known: dict = {}
    for m in all_members:
        key = (m.zalo_name or "").strip().lower()
        if key:
            known[key] = m
    for m in all_members:
        for candidate in (m.full_name, m.display_name):
            key = (candidate or "").strip().lower()
            if key and key not in known:
                known[key] = m
    result = []
    for zm in snapshot.get("members") or []:
        name = (zm.get("name") or "").strip()
        if not name:
            continue
        matched = known.get(name.lower())
        result.append({
            "zalo_name": name,
            "zalo_uid": zm.get("uid"),
            "linked": bool(matched),
            "member_id": matched.id if matched else None,
            "member_full_name": matched.full_name if matched else None,
        })
    result.sort(key=lambda r: (not r["linked"], r["zalo_name"]))
    return {"members": result, "total_member": snapshot.get("total_member") or len(result)}


@router.get("/conversations/{conversation_id}/project-members")
def list_project_members_for_task_assignment(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """Assignee list for the "+ Task" form — this project's own member list
    (project_members), NOT a live Zalo group-roster fetch. A roster fetch
    needs an active Zalo session and goes empty the moment that session
    expires (a real, recurring failure mode); the project's member list is
    always available regardless of Zalo connectivity. Each entry still
    carries zalo_name/zalo_uid so the picker can show "tên Zalo kèm tên
    KPI" and the backend can still send a real tag when one is set."""
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
    if not conv.project_id:
        return []

    rows = (
        db.query(Member)
        .join(project_members, project_members.c.member_id == Member.id)
        .filter(project_members.c.project_id == conv.project_id)
        .order_by(Member.full_name)
        .all()
    )
    return [
        {
            "id": m.id,
            "full_name": m.full_name,
            "display_name": m.display_name,
            "zalo_name": m.zalo_name,
            "zalo_uid": m.zalo_uid,
        }
        for m in rows
    ]


@router.post("/conversations/{conversation_id}/create-task")
def create_task_via_form(
    conversation_id: int,
    payload: CreateTaskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """The "+ Task" form — a direct alternative to the /task text command:
    title/assignee/manday/deadline picked in the UI, no @mention parsing.
    Requires the conversation to already be linked to a project."""
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
    if not conv.project_id:
        raise HTTPException(status_code=400, detail="Hội thoại này chưa được gán vào dự án nào.")

    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Thiếu tên task.")

    assigned = db.query(Member).filter(Member.id == payload.assigned_member_id).first()
    if not assigned:
        raise HTTPException(status_code=400, detail="Không tìm thấy người thực hiện.")
    is_project_member = db.execute(
        project_members.select().where(
            project_members.c.project_id == conv.project_id,
            project_members.c.member_id == assigned.id,
        )
    ).first()
    if not is_project_member:
        raise HTTPException(status_code=400, detail="Người này không thuộc dự án đã gắn với hội thoại này.")

    deadline = None
    if payload.deadline:
        try:
            deadline = datetime.date.fromisoformat(payload.deadline)
        except ValueError:
            raise HTTPException(status_code=400, detail="Ngày demo không hợp lệ.")

    task = zalo_task_parser.create_task_direct(
        db, conv.project_id, title, assigned, payload.manday, deadline, conv.zalo_thread_id, payload.priority
    )
    if not task:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Không tạo được task — dự án thiếu cấu hình skill mặc định, hoặc chưa có thành viên nào khác trong dự án để làm người hỗ trợ.",
        )
    db.commit()

    # The task itself always succeeds independently of the Zalo notify —
    # a failed send must never roll back a task that genuinely exists now.
    # But it must NOT be silent either: swallowing this used to report
    # plain success back to the UI with no Zalo message ever appearing and
    # no visible reason why (the actual bug behind "bấm tạo task không
    # nhắn lên Zalo, không có báo lỗi gì"). zalo_notify_error surfaces the
    # real reason (e.g. Zalo session expired) so the UI can warn instead
    # of pretending everything went out fine.
    zalo_notify_error: Optional[str] = None
    try:
        demo_date_str = task.end_date_est.strftime("%d/%m/%Y") if task.end_date_est else "(chưa đặt)"
        prefix_text = "\n".join([
            f"📋 Task: {task.detail}",
            f"Priority: {task.priority}",
            f"Manday: {task.manday_est}",
            f"Ngày demo: {demo_date_str}",
            "Người thực hiện: ",
        ])
        # A real Zalo @mention (notifies + highlights on their side), not
        # just "@Name" as inert text — same {uid, pos, len} mechanism as the
        # manual compose box's mention picker. pos/len must be UTF-16 code
        # UNITS (what Zalo's JS-based protocol expects), not Python's
        # `len()` (Unicode code points) — they diverge for any astral
        # character before the mention, e.g. the 📋 emoji above counts as 1
        # in Python but 2 in UTF-16, which would silently misplace the tag.
        tag_name = assigned.zalo_name or assigned.full_name
        tag_text = f"@{tag_name}"
        reply = prefix_text + tag_text
        mentions = (
            [{"uid": assigned.zalo_uid, "pos": _utf16_len(prefix_text), "len": _utf16_len(tag_text)}]
            if assigned.zalo_uid
            else None
        )
        if not assigned.zalo_uid:
            reply += "\n\nNhắc bạn cập nhật đúng Tên Zalo trong Hồ sơ cá nhân để nhận tag thật khi giao task qua Zalo nhé"

        result = zalo_service.send_message(account.id, conv.zalo_thread_id, reply, conv.is_group, mentions)
        source_message_id = str(result.get("source_message_id") or f"local-{datetime.datetime.now().timestamp()}")
        # Still recorded into our own DB (same as any other outgoing send),
        # so it shows up in the app's chat panel immediately, in sync with
        # what was actually sent to Zalo.
        _insert_message(db, conv.id, source_message_id, None, "Bạn", reply, True)
        conv.last_message_at = datetime.datetime.now(datetime.timezone.utc)
        conv.last_message_preview = reply[:500]
        db.commit()
    except RuntimeError as exc:
        logger.warning("Could not send task-creation notice to conversation_id=%s: %s", conv.id, exc)
        zalo_notify_error = str(exc)

    return {
        "id": task.id,
        "task_code": task.task_code,
        "detail": task.detail,
        "manday_est": float(task.manday_est),
        "assigned_id": task.assigned_id,
        "end_date_est": task.end_date_est.isoformat() if task.end_date_est else None,
        "zalo_notify_error": zalo_notify_error,
    }


@router.post("/conversations/{conversation_id}/remind-unlinked")
def remind_unlinked_member(
    conversation_id: int,
    payload: RemindUnlinkedRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """For a Zalo group member whose display name doesn't match any known
    Member yet — can't auto-fill an assignee, so instead of a task form,
    send a real Zalo message asking them to add their Zalo name to their
    profile, with a direct link to the linked project."""
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
    if not conv.project_id:
        raise HTTPException(status_code=400, detail="Hội thoại này chưa được gán vào dự án nào.")

    project = db.query(Project).filter(Project.id == conv.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Không tìm thấy dự án.")

    name = payload.zalo_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Thiếu tên Zalo.")

    project_url = f"{settings.FRONTEND_URL.rstrip('/')}/project-hub/{project.code or project.id}"
    text = (
        f"⚠️ {name} chưa liên kết tài khoản KPI Portal (chưa có Tên Zalo khớp trong hồ sơ).\n"
        f"Vui lòng vào hồ sơ cập nhật đúng Tên Zalo, sau đó nhờ giao lại task.\n"
        f"👉 Điền task tại dự án: {project_url}"
    )
    try:
        result = zalo_service.send_message(account.id, conv.zalo_thread_id, text, conv.is_group)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    now = datetime.datetime.now(datetime.timezone.utc)
    source_message_id = str(result.get("source_message_id") or f"local-{now.timestamp()}")
    _insert_message(db, conv.id, source_message_id, None, "Bạn", text, True)
    conv.last_message_at = now
    conv.last_message_preview = text[:500]
    db.commit()
    return {"ok": True}


def _date_range_bounds(range_key: str):
    """"today" / "yesterday" / "7d" / anything else ("all") → (lo, hi) date
    bounds (inclusive), or (None, None) for no constraint."""
    today = datetime.date.today()
    if range_key == "today":
        return today, today
    if range_key == "yesterday":
        y = today - datetime.timedelta(days=1)
        return y, y
    if range_key == "7d":
        return today - datetime.timedelta(days=6), today
    return None, None


@router.get("/conversations/{conversation_id}/tasks")
def list_project_tasks(
    conversation_id: int,
    status: str = "done",  # "done" | "assigned" | "all"
    range: str = "all",     # "today" | "yesterday" | "7d" | "all"
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """Tasks in the project this conversation is linked to — feeds the
    "Task trong dự án" modal (filter by status + recency) and the
    "Yêu cầu xem demo" / "Yêu cầu lại" actions on Done tasks."""
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
    if not conv.project_id:
        return []

    q = (
        db.query(Task, Member)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .join(Member, Task.assigned_id == Member.id)
        .filter(Phase.project_id == conv.project_id)
    )
    if status == "done":
        q = q.filter(Task.status == "Done")
    elif status == "assigned":
        q = q.filter(Task.status != "Done")

    lo, hi = _date_range_bounds(range)
    if lo and hi:
        if status == "done":
            q = q.filter(Task.end_date_actual.isnot(None), Task.end_date_actual >= lo, Task.end_date_actual <= hi)
        else:
            q = q.filter(Task.start_date >= lo, Task.start_date <= hi)

    rows = q.order_by(Task.id.desc()).limit(200).all()

    task_ids = [t.id for t, _ in rows]
    latest_request_by_task = {}
    if task_ids:
        dr_rows = (
            db.query(ZaloDemoRequest)
            .filter(ZaloDemoRequest.task_id.in_(task_ids))
            .order_by(ZaloDemoRequest.created_at.desc())
            .all()
        )
        for dr in dr_rows:
            latest_request_by_task.setdefault(dr.task_id, dr)  # first hit per task_id = latest (already ordered desc)

    return [
        {
            "id": t.id,
            "task_code": t.task_code,
            "detail": t.detail,
            "priority": t.priority,
            "status": t.status,
            "manday_est": float(t.manday_est) if t.manday_est is not None else None,
            "start_date": t.start_date.isoformat() if t.start_date else None,
            "end_date_actual": t.end_date_actual.isoformat() if t.end_date_actual else None,
            "assigned_id": m.id,
            "assigned_name": m.full_name,
            "assigned_zalo_uid": m.zalo_uid,
            "assigned_zalo_name": m.zalo_name or m.full_name,
            "last_demo_requested_at": (
                latest_request_by_task[t.id].demo_at.isoformat() if t.id in latest_request_by_task else None
            ),
            "zalo_demo_skip": bool(t.zalo_demo_skip),
        }
        for t, m in rows
    ]


class SetDemoSkipRequest(BaseModel):
    skip: bool


@router.post("/conversations/{conversation_id}/tasks/{task_id}/skip-demo")
def set_task_demo_skip(
    conversation_id: int,
    task_id: int,
    payload: SetDemoSkipRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """Marks (or unmarks) a task as "không cần xem demo" — some Done tasks
    genuinely don't need one; this hides the request nag without deleting
    any prior request history."""
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
    if not conv.project_id:
        raise HTTPException(status_code=400, detail="Hội thoại này chưa được gán vào dự án nào.")

    task = (
        db.query(Task)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .filter(Task.id == task_id, Phase.project_id == conv.project_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy task trong dự án này.")

    task.zalo_demo_skip = payload.skip
    db.commit()
    return {"ok": True, "zalo_demo_skip": task.zalo_demo_skip}


@router.post("/conversations/{conversation_id}/request-demo")
def request_demo(
    conversation_id: int,
    payload: RequestDemoRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """"Yêu cầu xem demo" — sends a real Zalo message tagging the assignee
    of a Done task, asking them to demo it at the chosen time."""
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")
    if not conv.project_id:
        raise HTTPException(status_code=400, detail="Hội thoại này chưa được gán vào dự án nào.")

    task = (
        db.query(Task)
        .join(TaskGroup, Task.task_group_id == TaskGroup.id)
        .join(Phase, TaskGroup.phase_id == Phase.id)
        .filter(Task.id == payload.task_id, Phase.project_id == conv.project_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy task trong dự án này.")

    assigned = db.query(Member).filter(Member.id == task.assigned_id).first()
    if not assigned:
        raise HTTPException(status_code=404, detail="Không tìm thấy người thực hiện của task.")

    try:
        demo_dt = datetime.datetime.fromisoformat(payload.demo_at)
    except ValueError:
        raise HTTPException(status_code=400, detail="Thời gian demo không hợp lệ.")
    demo_str = demo_dt.strftime("%H:%M %d/%m/%Y")

    tag_name = assigned.zalo_name or assigned.full_name
    prefix_text = f"Task {task.detail} đã hoàn thành, "
    tag_text = f"@{tag_name}"
    reply = f"{prefix_text}{tag_text} tiến hành demo cho anh vào lúc {demo_str}"

    mentions = None
    if assigned.zalo_uid:
        mentions = [{"uid": assigned.zalo_uid, "pos": _utf16_len(prefix_text), "len": _utf16_len(tag_text)}]

    try:
        result = zalo_service.send_message(account.id, conv.zalo_thread_id, reply, conv.is_group, mentions)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    now = datetime.datetime.now(datetime.timezone.utc)
    source_message_id = str(result.get("source_message_id") or f"local-{now.timestamp()}")
    _insert_message(db, conv.id, source_message_id, None, "Bạn", reply, True)
    conv.last_message_at = now
    conv.last_message_preview = reply[:500]
    db.add(ZaloDemoRequest(
        task_id=task.id,
        conversation_id=conv.id,
        demo_at=demo_dt,
        requested_by_id=getattr(current_user, "id", None),
    ))
    db.commit()
    return {"ok": True}


@router.get("/conversations/{conversation_id}/messages")
def get_conversation_messages(
    conversation_id: int,
    after_id: Optional[int] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")

    q = db.query(ZaloMessage).filter(ZaloMessage.conversation_id == conversation_id)
    limit = min(limit, 200)
    if after_id:
        # Incremental poll — always oldest-of-the-new-batch first, ascending.
        rows = q.filter(ZaloMessage.id > after_id).order_by(ZaloMessage.id.asc()).limit(limit).all()
    else:
        # Initial load — a conversation can have far more than `limit`
        # messages; without after_id this must return the LATEST ones, not
        # whatever the first `limit` rows happen to be (that was the actual
        # "messages not syncing" bug: an ASC-order LIMIT here permanently
        # hid every message past the first `limit`, no matter how much
        # newer traffic arrived).
        rows = q.order_by(ZaloMessage.id.desc()).limit(limit).all()
        rows.reverse()
    return [
        {
            "id": m.id,
            "source_message_id": m.source_message_id,
            "sender_zalo_id": m.sender_zalo_id,
            "sender_name": m.sender_name,
            "content": m.content,
            "is_outgoing": m.is_outgoing,
            "created_at": m.created_at,
        }
        for m in rows
    ]


def _summary_to_dict(s: ZaloConversationSummary) -> dict:
    return {
        "id": s.id,
        "period_start": s.period_start,
        "period_end": s.period_end,
        "message_count": s.message_count,
        "content": s.content,
        "decisions": s.decisions or [],
        "issues": s.issues or [],
        "next_steps": s.next_steps or [],
        "recommended_tasks": s.recommended_tasks or [],
        "created_at": s.created_at,
    }


@router.get("/projects/{project_id:int}/summary")
def get_project_zalo_summary(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Powers the project detail page's "Tóm tắt nhóm" tab — every Zalo
    group currently linked to this project (ZaloConversation.project_id),
    across every connected Leader's own account, each with its recent AI
    digests, so a PM can see what a group discussed without leaving the
    project."""
    conversations = (
        db.query(ZaloConversation)
        .join(ZaloAccount, ZaloConversation.account_id == ZaloAccount.id)
        .filter(
            ZaloAccount.is_active.is_(True),
            ZaloConversation.project_id == project_id,
            ZaloConversation.is_group.is_(True),
        )
        .order_by(ZaloConversation.name.asc())
        .all()
    )

    result = []
    for conv in conversations:
        summaries = (
            db.query(ZaloConversationSummary)
            .filter(ZaloConversationSummary.conversation_id == conv.id)
            .order_by(ZaloConversationSummary.period_end.desc())
            .limit(10)
            .all()
        )
        result.append({
            "conversation_id": conv.id,
            "name": conv.name,
            "last_message_at": conv.last_message_at,
            "summaries": [_summary_to_dict(s) for s in summaries],
        })
    return result


@router.get("/conversations/{conversation_id}/summaries")
def get_conversation_summaries(
    conversation_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")

    rows = (
        db.query(ZaloConversationSummary)
        .filter(ZaloConversationSummary.conversation_id == conversation_id)
        .order_by(ZaloConversationSummary.period_end.desc())
        .limit(min(limit, 100))
        .all()
    )
    return [_summary_to_dict(s) for s in rows]


@router.post("/conversations/{conversation_id}/summarize-now")
def summarize_conversation_now(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """Manual trigger — summarizes messages since the last summary (or since
    ZALO_SUMMARY_INTERVAL_SECONDS ago if none yet) right now, bypassing the
    scheduler's wait. Meant for testing/QA, not gated behind the advisory
    lock since it's an explicit one-off action, not a competing scheduler tick."""
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")

    now = datetime.datetime.now(datetime.timezone.utc)
    last = (
        db.query(ZaloConversationSummary)
        .filter(ZaloConversationSummary.conversation_id == conversation_id)
        .order_by(ZaloConversationSummary.period_end.desc())
        .first()
    )
    window_start = last.period_end if last else now - datetime.timedelta(seconds=settings.ZALO_SUMMARY_INTERVAL_SECONDS)
    if window_start >= now:
        raise HTTPException(status_code=400, detail="Chưa đủ thời gian kể từ lần tóm tắt trước.")

    row = zalo_summary.summarize_conversation_window(db, conv, window_start, now)
    if not row:
        raise HTTPException(status_code=400, detail="Không có tin nhắn nào trong khoảng thời gian này để tóm tắt.")
    db.commit()
    return _summary_to_dict(row)


@router.post("/conversations/{conversation_id}/send")
def send_to_conversation(
    conversation_id: int,
    payload: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    account = _require_account_for_user(db, current_user)
    conv = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.id == conversation_id, ZaloConversation.account_id == account.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Không tìm thấy hội thoại.")

    try:
        result = zalo_service.send_message(account.id, conv.zalo_thread_id, payload.text, conv.is_group, payload.mentions)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    now = datetime.datetime.now(datetime.timezone.utc)
    source_message_id = str(result.get("source_message_id") or f"local-{now.timestamp()}")
    _insert_message(db, conv.id, source_message_id, None, "Bạn", payload.text, True)
    conv.last_message_at = now
    conv.last_message_preview = payload.text[:500]
    resolved_name = result.get("name")
    if resolved_name:
        conv.name = resolved_name
    db.commit()

    # Let admins test /task directly from this panel too, not only from a
    # real Zalo client — no structured mentions here (we composed the text
    # ourselves), so the regex fallback in parse_task_command reads the
    # "@Name" text (the mention autocomplete in the UI writes exactly that).
    if conv.project_id:
        _try_handle_task_command(db, conv, payload.text, None)

    return {"ok": True, "source_message_id": source_message_id}


@router.post("/conversations/send-to-thread")
def send_to_new_thread(
    payload: SendToThreadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_zalo_user),
):
    """Phase-1 test-panel helper: send the first message to a Zalo thread id
    typed in by hand (there is no reliable "browse all conversations" API —
    see plan doc), creating the ZaloConversation row on the fly."""
    account = _require_account_for_user(db, current_user)
    thread_id = payload.thread_id.strip()
    if not thread_id:
        raise HTTPException(status_code=400, detail="Thiếu thread_id.")

    try:
        result = zalo_service.send_message(account.id, thread_id, payload.text, payload.is_group)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    now = datetime.datetime.now(datetime.timezone.utc)
    resolved_name = result.get("name") or payload.name
    conv = _upsert_conversation(
        db, account.id, thread_id, resolved_name, payload.is_group, now, payload.text
    )
    source_message_id = str(result.get("source_message_id") or f"local-{now.timestamp()}")
    _insert_message(db, conv.id, source_message_id, None, "Bạn", payload.text, True)
    return {"ok": True, "conversation_id": conv.id, "source_message_id": source_message_id}


# ── Internal: sidecar polls this to know which groups to back-fill ─────────
@router.get("/internal/tracked-groups")
def list_tracked_groups(
    account_id: int = Query(...),
    db: Session = Depends(get_db),
    x_zalo_worker_token: str = Header(default=None),
):
    """Poll-fallback support: zca-js's real-time listener occasionally goes
    silently stale (connected, no errors, but stops firing 'message' events —
    see server.js's polling loop). The sidecar calls this periodically (once
    per logged-in session) to know which groups that specific account
    tracks, then pulls each one's recent history via getGroupChatHistory and
    forwards it through the same /internal/messages endpoint — safe to call
    repeatedly since messages are deduped there on (conversation_id,
    source_message_id)."""
    expected = (settings.ZALO_WORKER_INTERNAL_TOKEN or "").strip()
    if expected and x_zalo_worker_token != expected:
        raise HTTPException(status_code=403, detail="Forbidden")

    rows = (
        db.query(ZaloConversation)
        .filter(ZaloConversation.account_id == account_id, ZaloConversation.is_group.is_(True))
        .all()
    )
    return [{"thread_id": c.zalo_thread_id} for c in rows]


# ── Internal: sidecar pushes incoming (real-time) messages here ────────────
@router.post("/internal/messages")
def receive_worker_message(
    payload: InternalMessageRequest,
    db: Session = Depends(get_db),
    x_zalo_worker_token: str = Header(default=None),
):
    expected = (settings.ZALO_WORKER_INTERNAL_TOKEN or "").strip()
    if expected and x_zalo_worker_token != expected:
        raise HTTPException(status_code=403, detail="Forbidden")

    account = db.query(ZaloAccount).filter(ZaloAccount.id == payload.account_id).first()
    if not account:
        # Sidecar reports an account id we don't recognize (e.g. a stale
        # session after the DB row was deleted) — drop silently rather than
        # 500 the worker.
        return {"ok": False, "reason": "unknown_account"}

    now = datetime.datetime.now(datetime.timezone.utc)
    conv = _upsert_conversation(
        db, account.id, payload.thread_id, payload.name, payload.is_group, now, payload.content
    )
    inserted = _insert_message(
        db,
        conv.id,
        payload.source_message_id,
        payload.sender_zalo_id,
        payload.sender_name,
        payload.content,
        payload.is_outgoing,
    )

    # Gate on `inserted` (genuinely new to us), NOT `is_outgoing` — the
    # account owner sending "/task ..." from their own phone (not through
    # this app) still arrives with is_outgoing=True (Zalo's `isSelf`), and
    # must still be able to create a task. A message we already recorded
    # ourselves (via /send) hits the unique-constraint conflict here
    # (inserted=False) and correctly does NOT get re-processed when the
    # listener echoes it back.
    if inserted and conv.project_id:
        _try_handle_task_command(db, conv, payload.content, payload.mentions)

    return {"ok": True, "conversation_id": conv.id}


def _try_handle_task_command(
    db: Session, conv: ZaloConversation, content: Optional[str], structured_mentions: Optional[list]
) -> None:
    """Best-effort — a bad /task message must never break message ingestion.
    Always replies into the SAME Zalo thread so the sender gets immediate
    feedback (task created, or exactly what's missing)."""
    parsed = zalo_task_parser.parse_task_command(content or "")
    if not parsed:
        return

    reply = None
    try:
        # Real Zalo mentions (uid+exact text, sliced by the sidecar from
        # content's pos/len) are more reliable than the regex-parsed
        # "@Name" text — prefer them when the sender actually used Zalo's
        # own @mention picker; fall back to the regex parse otherwise (e.g.
        # the /task line was typed/forwarded without using the picker).
        mention_texts = (
            [m.get("text") for m in structured_mentions if m.get("text")]
            if structured_mentions
            else parsed["mentions"]
        )
        members = zalo_task_parser.resolve_mentioned_members(db, mention_texts)
        if not members:
            mentioned = ", ".join(mention_texts) or "(không có)"
            reply = (
                f"⚠️ Không tạo được task \"{parsed['title']}\" — không nhận diện được người được giao.\n"
                f"Đã tag: {mentioned}\n"
                f"Vào /accounts để admin gán đúng tên Zalo cho thành viên rồi thử lại."
            )
        else:
            task = zalo_task_parser.create_task_from_zalo(db, conv.project_id, parsed, members, conv.zalo_thread_id)
            if not task:
                reply = (
                    f"⚠️ Không tạo được task \"{parsed['title']}\" — dự án thiếu cấu hình skill mặc định, "
                    "hoặc chưa có thành viên nào khác trong dự án để làm người hỗ trợ."
                )
            else:
                names = ", ".join(m.full_name or m.display_name for m in members)
                reply = (
                    f"✅ Đã tạo task [{task.task_code}] \"{task.detail}\"\n"
                    f"Priority: {task.priority} · {task.manday_est} manday\n"
                    f"Giao cho: {names}"
                )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Zalo /task command failed for conversation_id=%s", conv.id)
        reply = f"⚠️ Có lỗi khi tạo task \"{parsed['title']}\". Đã báo cho admin kiểm tra log."

    if not reply:
        return
    try:
        result = zalo_service.send_message(conv.account_id, conv.zalo_thread_id, reply, conv.is_group)
        source_message_id = str(result.get("source_message_id") or f"local-{datetime.datetime.now().timestamp()}")
        _insert_message(db, conv.id, source_message_id, None, "Bạn", reply, True)
    except RuntimeError as exc:
        logger.warning("Could not send /task reply to conversation_id=%s: %s", conv.id, exc)
