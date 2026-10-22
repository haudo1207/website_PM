"""Internal API for the MSC (Mua Sắm Công) system — weekly KPI Priority -> PM tasks.

MSC's "Thiết lập KPI Team > Priority" tab pushes, once per KPI week, one Task Group (the week) with
one child Task per member × status (Cần xem xét / Presale Check / Tham gia) that reached a Priority tier.
See docs/msc-kpi-sync.md (this repo) and docs/pm-sync-contract.md (MSC repo) for the contract.

Auth mirrors routers/meeting_bot.py and routers/zalo.py's /internal/*: a single shared token in
X-MSC-Sync-Token, no portal user session. Deliberately its own router so MSC never needs a user login.

Everything is written by calling the SAME route functions the PM UI uses (create_task_group / update_task_group /
create_task / update_task) with a system principal, so every validation and every side effect (task codes, KPI
recalculation, group dates, audit log) behaves exactly like a task created in the UI.
"""
import hmac
import logging
import math
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.member import Member
from ..models.phase import Phase
from ..models.project import Project, project_members
from ..models.skill_master import Category, Group
from ..models.task import Task
from ..models.task_group import TaskGroup
from ..models.user import User
from . import task_groups as tg_router

logger = logging.getLogger("msc_sync")
router = APIRouter()

# Mỗi hệ thống gọi sang có token riêng (X-MSC-Sync-Token) và tiền tố externalKey riêng; token quyết định nguồn nên MarkeeAI không thể ghi đè dữ liệu của MSC và ngược lại.
SOURCES = {
    "msc": {"prefix": "msc-kpi:", "phase": "KPI MSC theo tuần", "label": "MSC"},
    "markeeai": {"prefix": "markeeai-kpi:", "phase": "KPI MarkeeAI theo tuần", "label": "MarkeeAI"},
}
DEFAULT_PHASE_NAME = SOURCES["msc"]["phase"]
GROUP_KEY_PREFIX = SOURCES["msc"]["prefix"]
MAX_TASKS = 60
ALLOWED_PRIORITIES = {"Normal", "High", "Critical"}
# System principal: behaves like a super_admin for the route functions we call, but is not a portal user (id None => audit "user" empty).
SERVICE_USER = SimpleNamespace(id=None, role="super_admin", data_scope="all", member_id=None, name="MSC Sync")


def _check_token(x_msc_sync_token: Optional[str] = Header(default=None)) -> str:
    """Returns the source ("msc" | "markeeai") whose token matches X-MSC-Sync-Token."""
    tokens = {"msc": (settings.MSC_SYNC_TOKEN or "").strip(), "markeeai": (settings.MARKEEAI_SYNC_TOKEN or "").strip()}
    configured = {k: v for k, v in tokens.items() if v}
    if not configured:
        # Fail closed: an unset token must never mean "auth disabled".
        raise HTTPException(status_code=503, detail="MSC_SYNC_TOKEN / MARKEEAI_SYNC_TOKEN chưa được cấu hình trên server.")
    given = str(x_msc_sync_token or "")
    if given:
        for source, expected in configured.items():
            if hmac.compare_digest(given, expected):
                return source
    raise HTTPException(status_code=403, detail="Forbidden")


# ── skills ────────────────────────────────────────────────────────────────────

@router.get("/skills", dependencies=[Depends(_check_token)])
def list_skills(db: Session = Depends(get_db)):
    """Skill Solution (groups) with their Skill Vendors (skills), for MSC's pickers."""
    cats = {c.id: c.name for c in db.query(Category).all()}
    out = []
    for g in db.query(Group).order_by(Group.name).all():
        out.append({
            "id": g.id,
            "name": g.name,
            "categoryName": cats.get(g.category_id, ""),
            "skills": [{"id": s.id, "name": s.name} for s in sorted(g.skills, key=lambda s: (s.name or "").lower()) if s.is_active is not False],
        })
    return {"groups": out}


# ── helpers ───────────────────────────────────────────────────────────────────

def _find_member(db: Session, email: str) -> Optional[Member]:
    """Match an MSC user to a PM member by email (Member.email first, then the portal User linked to a member)."""
    e = (email or "").strip().lower()
    if not e:
        return None
    m = db.query(Member).filter(func.lower(Member.email) == e).first()
    if m:
        return m
    u = db.query(User).filter(func.lower(User.email) == e).first()
    if u and getattr(u, "member_id", None):
        return db.query(Member).filter(Member.id == u.member_id).first()
    return None


def _is_project_member(db: Session, pid: int, member_id: int) -> bool:
    return db.execute(project_members.select().where(
        project_members.c.project_id == pid, project_members.c.member_id == member_id)).first() is not None


def _member_name(m: Member) -> str:
    return getattr(m, "display_name", None) or getattr(m, "full_name", None) or f"#{m.id}"


def _detail(e: HTTPException) -> str:
    d = e.detail
    return d if isinstance(d, str) else str(d)


def _find_or_create_phase(db: Session, pid: int, name: str) -> Phase:
    phase = db.query(Phase).filter(Phase.project_id == pid, Phase.name == name).first()
    if phase:
        return phase
    last = db.query(func.max(Phase.sort_order)).filter(Phase.project_id == pid).scalar() or 0
    phase = Phase(project_id=pid, name=name, sort_order=last + 1, status="Process")
    db.add(phase)
    db.commit()
    db.refresh(phase)
    return phase


def _find_group(db: Session, pid: int, phase: Phase, group_in: dict) -> Optional[TaskGroup]:
    """Same week => same Task Group: by the externalKey we stored in description, then the id PM gave back, then the name."""
    key = str(group_in.get("externalKey") or "").strip()
    base = db.query(TaskGroup).join(Phase, TaskGroup.phase_id == Phase.id).filter(Phase.project_id == pid)
    if key:
        tg = base.filter(TaskGroup.description == key).first()
        if tg:
            return tg
    gid = group_in.get("pmGroupId")
    if isinstance(gid, int) and gid > 0:
        tg = base.filter(TaskGroup.id == gid).first()
        if tg:
            return tg
    name = str(group_in.get("name") or "").strip()
    return db.query(TaskGroup).filter(TaskGroup.phase_id == phase.id, TaskGroup.name == name).first() if name else None


def _find_task(db: Session, tg: TaskGroup, t: dict) -> Optional[Task]:
    key = str(t.get("externalKey") or "").strip()
    tid = t.get("pmTaskId")
    if isinstance(tid, int) and tid > 0:
        task = db.query(Task).filter(Task.id == tid, Task.task_group_id == tg.id).first()
        if task:
            return task
    return db.query(Task).filter(Task.task_group_id == tg.id, Task.ticket_id == key).first() if key else None


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ── weekly KPI ────────────────────────────────────────────────────────────────

@router.post("/projects/{pid}/weekly-kpi")
def upsert_weekly_kpi(pid: int, body: dict, db: Session = Depends(get_db), source: str = Depends(_check_token)):
    """Create or update the week's Task Group and its child tasks (idempotent by externalKey). Returns 200 even when some tasks were
    rejected: those are listed in `errors`, the others are saved."""
    project = db.query(Project).filter(Project.id == pid).first()
    if not project:
        raise HTTPException(404, "Project not found.")

    group_in = body.get("group") if isinstance(body.get("group"), dict) else {}
    week = body.get("week") if isinstance(body.get("week"), dict) else {}
    tasks_in = body.get("tasks") if isinstance(body.get("tasks"), list) else []
    group_name = str(group_in.get("name") or "").strip()[:200]
    group_key = str(group_in.get("externalKey") or "").strip()
    start_date = str(week.get("startDate") or "")
    src = SOURCES.get(source if isinstance(source, str) else "msc", SOURCES["msc"])  # gọi trực tiếp trong test (không qua FastAPI) thì mặc định MSC
    prefix = src["prefix"]
    if not group_name or not group_key.startswith(prefix):
        raise HTTPException(400, f"group.name và group.externalKey ({prefix}…) là bắt buộc.")
    if not tasks_in:
        raise HTTPException(400, "Không có task nào để đồng bộ.")
    if len(tasks_in) > MAX_TASKS:
        raise HTTPException(400, f"Tối đa {MAX_TASKS} task mỗi lần.")
    for t in tasks_in:
        if not isinstance(t, dict) or not str(t.get("externalKey") or "").startswith(prefix):
            raise HTTPException(400, f"Mỗi task cần externalKey ({prefix}…).")

    phase = _find_or_create_phase(db, pid, str(body.get("phaseName") or src["phase"]).strip()[:200] or src["phase"])
    tg = _find_group(db, pid, phase, group_in)

    # Task Group MANDAY EST is a whole number 1..MAX_GROUP_MANDAY and must cover its children (PM rules): size it to the tasks of this
    # request plus tasks already in the group that this request does not touch.
    payload_keys = {str(t.get("externalKey")) for t in tasks_in}
    payload_ids = {t.get("pmTaskId") for t in tasks_in if isinstance(t.get("pmTaskId"), int)}
    need = sum((_num(t.get("manday")) or 0) for t in tasks_in)
    if tg:
        for ex in db.query(Task).filter(Task.task_group_id == tg.id).all():
            if ex.ticket_id not in payload_keys and ex.id not in payload_ids:
                need += float(ex.manday_est or 0)
    group_manday = max(1, math.ceil(need - 1e-9))
    # Luật "High ≤30% / Critical ≤20% manday của task cha" tính trên manday của task cha, không phải tổng task con: người gọi có thể xin task cha lớn hơn
    # (vd 10 để chứa 3 manday High) bằng group.mandayEst. Không bao giờ nhỏ hơn tổng các task con.
    wanted = group_in.get("mandayEst")
    if isinstance(wanted, (int, float)) and not isinstance(wanted, bool) and wanted >= 1:
        group_manday = max(group_manday, min(int(math.ceil(wanted)), tg_router.MAX_GROUP_MANDAY))
    if group_manday > tg_router.MAX_GROUP_MANDAY:
        raise HTTPException(400, f"Tổng manday các task trong tuần là {need:g}, vượt giới hạn {tg_router.MAX_GROUP_MANDAY} manday của một Task Group bên PM. Giảm manday các task rồi đồng bộ lại.")

    group_action = "updated"
    try:
        if tg is None:
            tg_router.create_task_group(phase.id, {"name": group_name, "description": group_key, "manday_est": group_manday,
                                                   "status": "Process", "start_date_est": start_date or None}, db, SERVICE_USER)
            tg = db.query(TaskGroup).filter(TaskGroup.phase_id == phase.id, TaskGroup.description == group_key).order_by(TaskGroup.id.desc()).first()
            group_action = "created"
        else:
            upd = {"name": group_name, "manday_est": group_manday}
            if start_date:
                upd["start_date_est"] = start_date
            if not (tg.description or "").startswith(prefix):
                upd["description"] = group_key
            tg_router.update_task_group(tg.phase_id, tg.id, upd, db, SERVICE_USER)
    except HTTPException as e:
        db.rollback()
        raise HTTPException(e.status_code, f"Không tạo/cập nhật được Task Cha: {_detail(e)}")

    results, errors = [], []
    for t in tasks_in:
        key = str(t.get("externalKey"))
        try:
            assignee_in = t.get("assignee") if isinstance(t.get("assignee"), dict) else {}
            support_in = t.get("support") if isinstance(t.get("support"), dict) else {}
            assignee = _find_member(db, assignee_in.get("email"))
            support = _find_member(db, support_in.get("email"))
            if not assignee:
                raise HTTPException(400, f"Không tìm thấy thành viên PM có email {assignee_in.get('email') or '(trống)'}.")
            if not support:
                raise HTTPException(400, f"Không tìm thấy thành viên PM (người hỗ trợ) có email {support_in.get('email') or '(trống)'}.")
            if assignee.id == support.id:
                raise HTTPException(400, "Người hỗ trợ phải khác người được giao.")
            for who in (assignee, support):
                if not _is_project_member(db, pid, who.id):
                    raise HTTPException(400, f"{_member_name(who)} chưa là thành viên của project {pid}: thêm vào project rồi đồng bộ lại.")
            priority = str(t.get("priority") or "")
            if priority not in ALLOWED_PRIORITIES:
                raise HTTPException(400, f"Priority \"{priority}\" không hợp lệ.")
            fields = {
                "detail": str(t.get("detail") or "").strip()[:500],
                "priority": priority,
                "manday_est": _num(t.get("manday")),
                "status": str(t.get("status") or "Done"),
                "start_date": t.get("startDate") or start_date or None,
                "assigned_id": assignee.id,
                "support_id": support.id,
                "skill_solution_id": t.get("skillSolutionId"),
                "skill_vendor_id": t.get("skillVendorId"),
                "ticket_id": key,
            }
            existing = _find_task(db, tg, t)
            if existing:
                tg_router.update_task(tg.id, existing.id, fields, db, SERVICE_USER)
                task = existing
                action = "updated"
            else:
                tg_router.create_task(tg.id, {**fields, "kpi_ratio_assign": 90, "kpi_ratio_support": 10}, db, SERVICE_USER)
                task = db.query(Task).filter(Task.task_group_id == tg.id, Task.ticket_id == key).order_by(Task.id.desc()).first()
                action = "created"
            db.refresh(task)
            results.append({"externalKey": key, "id": task.id, "code": task.task_code, "action": action})
        except HTTPException as e:
            db.rollback()
            errors.append({"externalKey": key, "message": _detail(e)})
        except Exception as e:  # one bad task must not lose the others
            db.rollback()
            logger.exception("msc_sync task %s failed", key)
            errors.append({"externalKey": key, "message": f"Lỗi PM: {e}"})

    db.refresh(tg)
    group = {"id": tg.id, "code": tg_router.to_roman(tg_router.get_group_index(tg, db)), "action": group_action}
    logger.info("msc_sync project=%s group=%s ok=%s failed=%s", pid, tg.id, len(results), len(errors))
    return {"group": group, "tasks": results, "errors": errors}
