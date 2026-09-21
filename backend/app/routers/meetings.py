from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from typing import Optional, List, Dict, Any
import datetime
import logging
import re

from ..database import get_db
from ..models.meeting import Meeting, MeetingMember
from ..models.meeting_attendance import MeetingAttendance
from ..models.project import Project
from ..models.member import Member
from ..models.user import User
from ..models.system_category import Workspace
from ..models.workspace_google_account import WorkspaceGoogleAccount
from ..utils.auth import get_current_user
from ..utils.access import ALL_SCOPE, WRITE_ROLES, has_full_project_access, project_belongs_to_workspace, project_query_for_user, require_project, require_route_project_access, resolve_workspace, user_scope, workspace_id_for_project
from ..utils.audit_service import AuditService
from ..utils.leave_conflict import meeting_leave_conflicts
from ..utils.timezone import VN_TZ as _VN_TZ

logger = logging.getLogger("meetings")
router = APIRouter(dependencies=[Depends(require_route_project_access)])

# Mapping between Database Enums and Frontend text labels
STATUS_DB_TO_FE = {
    "UPCOMING": "SẮP TỚI",
    "ONGOING": "ĐANG DIỄN RA",
    "DONE": "ĐÃ KẾT THÚC",
    "CANCELLED": "ĐÃ HỦY"
}

STATUS_FE_TO_DB = {
    "SẮP TỚI": "UPCOMING",
    "ĐANG DIỄN RA": "ONGOING",
    "ĐÃ KẾT THÚC": "DONE",
    "ĐÃ DIỄN RA": "DONE",  # legacy label, kept as an alias for older callers
    "ĐÃ HỦY": "CANCELLED"
}

# Temporary (chốt 2026-09-14, "HOST *" field): devv.szone@gmail.com's Google
# session is broken/unusable, so it's excluded from the Host picker until
# fixed — GET /hosts filters it out and create_meeting rejects it if sent
# anyway. Remove this set (and the two checks that reference it) once the
# account is restored; no other code change needed.
DISABLED_HOST_EMAILS = {"devv.szone@gmail.com"}


def _now_vn() -> datetime.datetime:
    """Naive Vietnam wall-clock 'now' — meeting_date/start_time/end_time are
    always stored as naive Vietnam local values (see create_google_meet_link),
    never UTC. Plain datetime.datetime.now() would silently use the SERVER's
    OS timezone instead (UTC in this deployment, ~7h behind Vietnam), making
    meetings that already started/ended still show as upcoming for hours."""
    return datetime.datetime.now(_VN_TZ).replace(tzinfo=None)


def _meeting_datetime_range(meeting_date: datetime.date, start_time: datetime.time, end_time: datetime.time | None):
    """Return (start_datetime, end_datetime) for a meeting, handling
    overnight meetings where end_time is on the next calendar day."""
    start_dt = datetime.datetime.combine(meeting_date, start_time)
    end_dt = datetime.datetime.combine(meeting_date, end_time) if end_time else None
    if end_dt and end_dt < start_dt:
        end_dt += datetime.timedelta(days=1)
    return start_dt, end_dt


def compute_display_status(m: Meeting) -> str:
    """Meeting status architecture (chốt 2026-09-13 — end_time is PLANNED end
    only, never lifecycle state):
      DONE/CANCELLED -> always read straight from the real, stored m.status
                         (only the Bot's actual-end report, a real external
                         sync, or a manual cancel may set these — never the
                         clock, see auto_sync_all_ended_meetings/notify_n8n's
                         removal of the old end_time-based auto-DONE).
      otherwise       -> live start_time vs now decides SẮP TỚI/ĐANG DIỄN RA
                         for display only (there's no automatic DB write for
                         this transition, and none is needed: nothing in the
                         business rules depends on ONGOING-vs-UPCOMING being
                         exactly accurate in real time, unlike DONE).
    Previously this also flipped to "ĐÃ KẾT THÚC" once now >= end_time even
    when the stored status was still ONGOING — showing "ended" for a meeting
    the Bot was still genuinely in, and confusingly allowing edits the DONE
    guards would otherwise have blocked. Fixed: end_time is no longer read
    here at all.
    """
    if m.status in ("DONE", "CANCELLED"):
        return STATUS_DB_TO_FE.get(m.status, m.status)
    if m.meeting_date and m.start_time:
        start_dt = datetime.datetime.combine(m.meeting_date, m.start_time)
        now = _now_vn()
        return "ĐANG DIỄN RA" if now >= start_dt else "SẮP TỚI"
    return STATUS_DB_TO_FE.get(m.status, m.status)

_SORT_EPOCH = datetime.datetime(1970, 1, 1)

def _meeting_list_sort_key(m: Meeting):
    """Chốt 2026-09-14: single flat list (no section headers), but two
    logical groups within it. Not-yet-ended meetings (ĐANG DIỄN RA/SẮP TỚI)
    sort start_time ASC — the soonest one is always on top, so the list
    doesn't reshuffle every time "now" ticks past another meeting's start.
    Ended meetings (ĐÃ KẾT THÚC/ĐÃ HỦY) sort start_time DESC — most recent
    history on top of that group. Not-ended always comes before ended.
    Uses plain timedelta-from-epoch arithmetic (not .timestamp()) so a
    hypothetical missing meeting_date/start_time — required at creation, so
    this is defensive only — can't raise on very old/naive datetimes."""
    ended = compute_display_status(m) in ("ĐÃ KẾT THÚC", "ĐÃ HỦY")
    dt = datetime.datetime.combine(m.meeting_date, m.start_time) if m.meeting_date and m.start_time else _SORT_EPOCH
    seconds = (dt - _SORT_EPOCH).total_seconds()
    return (1, -seconds) if ended else (0, seconds)

def parse_time(time_str: str):
    if not time_str:
        return None
    try:
        parts = str(time_str).strip().split(':')
        if len(parts) >= 2:
            return datetime.time(int(parts[0]), int(parts[1]))
    except Exception:
        raise HTTPException(400, f"Định dạng giờ không hợp lệ (yêu cầu HH:MM): {time_str}")
    return None

def parse_date(date_str: str):
    if not date_str:
        return None
    try:
        return datetime.date.fromisoformat(str(date_str).strip())
    except Exception:
        raise HTTPException(400, f"Định dạng ngày không hợp lệ (yêu cầu YYYY-MM-DD): {date_str}")

def parse_n8n_markdown_summary(text: str) -> dict:
    if not text or not isinstance(text, str):
        return {}

    exec_summary = ""
    decisions = []
    recommended_tasks = []

    match_overview = re.search(r'📋\s*TỔNG QUAN\s*\n(.*?)(?=\n\s*[✅📌⚠️📅]|\Z)', text, re.DOTALL)
    if match_overview:
        exec_summary = match_overview.group(1).strip()

    match_actions = re.search(r'✅\s*ACTION ITEMS.*?\n(.*?)(?=\n\s*[📋📌⚠️📅]|\Z)', text, re.DOTALL)
    if match_actions:
        action_text = match_actions.group(1).strip()
        for line in action_text.split('\n'):
            line = line.strip()
            if not line or 'Không có' in line:
                continue
            cleaned_line = re.sub(r'^\d+[\.\)]\s*', '', line).strip()
            if cleaned_line:
                parts = cleaned_line.split('| Deadline:')
                task_name = parts[0].strip()
                dl = parts[1].strip() if len(parts) > 1 else ''
                recommended_tasks.append({
                    'detail_task': task_name,
                    'priority': 'High',
                    'deadline': dl or datetime.date.today().isoformat()
                })

    match_decisions = re.search(r'📌\s*QUYẾT ĐỊNH.*?\n(.*?)(?=\n\s*[📋✅⚠️📅]|\Z)', text, re.DOTALL)
    if match_decisions:
        dec_text = match_decisions.group(1).strip()
        for line in dec_text.split('\n'):
            line = line.strip()
            if not line or 'Không có' in line:
                continue
            cleaned_line = re.sub(r'^\d+[\.\)]\s*', '', line).strip()
            if cleaned_line:
                decisions.append(cleaned_line)

    return {
        'executive_summary': exec_summary or text[:500],
        'decisions': decisions,
        'recommended_tasks': recommended_tasks
    }

def meeting_to_dict(m: Meeting, db=None, current_user=None) -> dict:
    # Whether the CALLER (not just any admin) can edit/delete/sync this
    # meeting — super_admin/leader globally, whoever created this specific
    # meeting, or a member/viewer whose project_members role for m.project_id
    # is PM/Leader. Purely a UI hint: require_route_project_access re-checks
    # this server-side on every write regardless of what this flag says
    # (same 3 conditions, see its ROLE_MEMBER branch), so a stale/omitted
    # value here (db/current_user not passed) just means the UI is
    # conservative, never a permission bypass.
    can_manage = False
    if current_user is not None:
        role = getattr(current_user, "role", None)
        member_id = getattr(current_user, "member_id", None)
        if role in WRITE_ROLES:
            can_manage = True
        elif member_id is not None and m.created_by is not None and member_id == m.created_by:
            can_manage = True
        elif db is not None and m.project_id:
            can_manage = has_full_project_access(db, current_user, m.project_id)

    # Calculate duration
    duration = None
    if m.start_time and m.end_time:
        start_mins = m.start_time.hour * 60 + m.start_time.minute
        end_mins = m.end_time.hour * 60 + m.end_time.minute
        if end_mins >= start_mins:
            duration = end_mins - start_mins

    proj_name = m.project.name if m.project else "Dự án chung"

    # Which Google account actually organizes this meeting's Meet event.
    # m.organizer_google_email is the Calendar-confirmed ground truth for
    # THIS specific event, captured once at creation/regeneration time — it
    # must win whenever set, because the live workspace-connection lookup
    # below reflects CURRENT status and can drift from what the event was
    # actually organized under (e.g. the workspace connected its own account
    # only *after* this meeting was created — the live lookup would then
    # wrongly show the new account even though Calendar still admits only
    # the old organizer). Falls back to the live best-effort guess only for
    # meetings created before this column existed.
    host_google_email = m.organizer_google_email or "mkt.szone@gmail.com"
    if not m.organizer_google_email and db is not None:
        try:
            from ..services.meeting_sync import is_workspace_google_connected
            ws_id = workspace_id_for_project(db, m.project)
            if ws_id:
                status = is_workspace_google_connected(db, ws_id)
                host_google_email = status.get("google_email") or status.get("expected_google_email") or host_google_email
        except Exception as e:
            logger.warning(f"Failed to resolve host_google_email for meeting {m.id}: {e}")

    # Primary project (m.project_id) first, then any extra linked projects —
    # dedup by id so the primary never shows twice if also linked as "extra".
    project_ids = [m.project_id] if m.project_id else []
    projects_list = [{"id": m.project_id, "name": proj_name}] if m.project_id else []
    for link in (m.extra_projects or []):
        if link.project_id and link.project_id not in project_ids:
            project_ids.append(link.project_id)
            projects_list.append({"id": link.project_id, "name": link.project.name if link.project else ""})

    executive_summary = ""
    decisions = []
    recommended_tasks = []
    issues = []
    next_steps = []
    team_name = ""
    organizer_name = ""
    participant_count = None
    is_auto_created = False
    summary_list = []

    # Only process AI summary if meeting actually has ai_summary JSON or has a transcript uploaded
    if m.ai_summary:
        if isinstance(m.ai_summary, dict):
            executive_summary = m.ai_summary.get("executive_summary") or m.ai_summary.get("summary") or ""
            decisions = m.ai_summary.get("decisions") or []
            recommended_tasks = m.ai_summary.get("recommended_tasks") or m.ai_summary.get("action_items") or []
            issues = m.ai_summary.get("issues") or []
            next_steps = m.ai_summary.get("next_steps") or []
            team_name = m.ai_summary.get("team_name") or ""
            organizer_name = m.ai_summary.get("organizer_name") or ""
            participant_count = m.ai_summary.get("participant_count")
            is_auto_created = bool(m.ai_summary.get("is_auto_created"))
            
            if executive_summary and ("📋" in executive_summary or "ACTION ITEMS" in executive_summary or "QUYẾT ĐỊNH" in executive_summary):
                parsed = parse_n8n_markdown_summary(executive_summary)
                if parsed.get("executive_summary"):
                    executive_summary = parsed["executive_summary"]
                if not decisions and parsed.get("decisions"):
                    decisions = parsed["decisions"]
                if not recommended_tasks and parsed.get("recommended_tasks"):
                    recommended_tasks = parsed["recommended_tasks"]
        elif isinstance(m.ai_summary, list):
            summary_list = [str(item) for item in m.ai_summary]
            if summary_list:
                executive_summary = summary_list[0]
                if "📋" in executive_summary or "ACTION ITEMS" in executive_summary or "QUYẾT ĐỊNH" in executive_summary:
                    parsed = parse_n8n_markdown_summary(executive_summary)
                    if parsed.get("executive_summary"):
                        executive_summary = parsed["executive_summary"]
                    if parsed.get("decisions"):
                        decisions = parsed["decisions"]
                    if parsed.get("recommended_tasks"):
                        recommended_tasks = parsed["recommended_tasks"]
    elif m.transcript and m.transcript.strip():
        try:
            from ..services.meeting_sync import summarize_meeting_with_ai_structured
            meeting_info = {
                "title": m.title,
                "project": proj_name,
                "project_name": proj_name,
                "date": m.meeting_date.isoformat() if m.meeting_date else "",
                "transcript": m.transcript
            }
            ai_res = summarize_meeting_with_ai_structured(m.transcript, meeting_info)
            executive_summary = ai_res.get("executive_summary") or ""
            decisions = ai_res.get("decisions") or []
            recommended_tasks = ai_res.get("recommended_tasks") or []
        except Exception as e:
            logger.warning(f"Failed to generate dynamic AI summary for meeting {m.id}: {e}")

    # Build summary_list if empty
    if not summary_list:
        if executive_summary:
            summary_list.append(executive_summary)
        if decisions:
            summary_list.append("1. QUYẾT ĐỊNH CHÍNH:")
            for d in decisions:
                summary_list.append(f"• {d}")
        if recommended_tasks:
            summary_list.append("2. TASK AI ĐỀ XUẤT:")
            for idx, t in enumerate(recommended_tasks):
                if isinstance(t, dict):
                    summary_list.append(f"• {t.get('detail_task')} (Priority: {t.get('priority', 'Normal')})")
                elif isinstance(t, str):
                    summary_list.append(f"• {t}")

    db_members = [
        {
            "id": mm.id,
            "member_id": mm.member_id,
            "display_name": mm.member.display_name if mm.member else "Thành viên",
            "role": mm.role,
            "joined_at": mm.joined_at.isoformat() if mm.joined_at else None
        } for mm in m.members
    ]
    
    custom_members = []
    if isinstance(m.ai_summary, dict) and "custom_members" in m.ai_summary and isinstance(m.ai_summary["custom_members"], list):
        custom_members = m.ai_summary["custom_members"]

    # Union, not either/or: custom_members (free-text external guests, no
    # member_id) must still show up alongside real MeetingMember rows —
    # previously a meeting with ANY real member silently dropped every
    # custom_members entry. Dedup by display_name in case the same person
    # was later also added as a real member.
    db_member_names = {mb.get("display_name") for mb in db_members}
    custom_only = [cm for cm in custom_members if cm.get("display_name") not in db_member_names]
    # No synthetic "Người tạo (Host)" entry here anymore (chốt 2026-09-13,
    # "Host tách khỏi participant"): Host is derived from
    # organizer_google_email/created_by and shown via the separate
    # host_google_email/creator_name fields below, never as a member row —
    # the creator only counts as a participant if they were actually added
    # as one (a real MeetingMember row). This also fixes member_count/
    # members previously always being >= 1 even for a meeting with zero
    # real participants.
    final_members = db_members + custom_only

    return {
        "id": m.id,
        "can_manage": can_manage,
        "title": m.title,
        "description": m.description,
        "platform": m.platform,
        "meeting_url": m.meeting_url,
        "link": m.meeting_url,
        "date": m.meeting_date.isoformat() if m.meeting_date else None,
        "meeting_date": m.meeting_date.isoformat() if m.meeting_date else None,
        "time": m.start_time.strftime("%H:%M") if m.start_time else None,
        "start_time": m.start_time.strftime("%H:%M") if m.start_time else None,
        "endTime": m.end_time.strftime("%H:%M") if m.end_time else None,
        "end_time": m.end_time.strftime("%H:%M") if m.end_time else None,
        "duration": duration,
        "status": compute_display_status(m),
        "transcript": m.transcript,
        "ai_summary": m.ai_summary,
        "summary": summary_list,
        "executive_summary": executive_summary,
        "decisions": decisions,
        "issues": issues,
        "next_steps": next_steps,
        "team_name": team_name,
        "organizer_name": organizer_name,
        "participant_count": participant_count,
        "is_auto_created": is_auto_created,
        "recommended_tasks": recommended_tasks,
        "project_id": m.project_id,
        "project": proj_name,
        "project_name": proj_name,
        "project_ids": project_ids,
        "projects": projects_list,
        "created_by": m.created_by,
        "creator_name": m.creator.display_name if m.creator else None,
        "host_google_email": host_google_email,
        "n8n_notify_status": m.n8n_notify_status,
        "n8n_notify_attempts": m.n8n_notify_attempts,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
        "members": final_members,
        "member_count": len(final_members),
        "objective": m.objective,
        "agenda": m.agenda,
        "no_action_reason": m.no_action_reason,
        "reminder_minutes": m.reminder_minutes,
        "notify_channels": m.notify_channels,
        "score_total": m.score_total,
        "score_prep": m.score_prep,
        "score_execution": m.score_execution,
        "score_result": m.score_result,
        "score_followthrough": m.score_followthrough,
        "score_feedback": m.score_feedback,
        "score_status": m.score_status,
        "last_score_calculated_at": m.last_score_calculated_at.isoformat() if m.last_score_calculated_at else None,
    }

def _sync_meeting_projects(db: Session, meeting_id: int, project_ids) -> None:
    """Replace the full set of extra project links for a meeting.
    `project_ids` may include the primary project too — the caller doesn't
    need to filter it out, we just dedupe here."""
    from ..models.meeting_project import MeetingProject
    db.query(MeetingProject).filter(MeetingProject.meeting_id == meeting_id).delete()
    seen = set()
    for pid in (project_ids or []):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            continue
        if pid and pid not in seen:
            seen.add(pid)
            db.add(MeetingProject(meeting_id=meeting_id, project_id=pid))


def _find_organizer_time_conflict(
    db: Session,
    organizer_google_email: Optional[str],
    meeting_date,
    start_time,
    end_time,
    exclude_meeting_id: Optional[int] = None,
) -> Optional["Meeting"]:
    """Return the first UPCOMING/ONGOING meeting for the same
    organizer_google_email whose [meeting_date/start_time, end_time) overlaps
    the given window, or None. Single source of truth for the overlap rule —
    used both to ENFORCE (raise 400 via _check_organizer_time_conflict below)
    and to PREVIEW (GET .../check-conflict, read-only) — so the frontend can
    never show "trùng"/"rảnh" out of sync with what create/update will
    actually accept, unlike two independently-written checks.

    A single Gmail account can only ever host one Google Meet call at a time
    (Meeting Host Bot enforces "1 profile = 1 active Meet tab" — see the
    extension's README) — two overlapping meetings for the same organizer
    can never both actually be attended by the bot. Skipped entirely (returns
    None) when any of the four inputs is missing (nothing to compare against).
    """
    if not organizer_google_email or not meeting_date or not start_time or not end_time:
        return None

    new_end_date = meeting_date + datetime.timedelta(days=1) if end_time < start_time else meeting_date
    new_start_dt = datetime.datetime.combine(meeting_date, start_time)
    new_end_dt = datetime.datetime.combine(new_end_date, end_time)

    candidates = db.query(Meeting).filter(
        Meeting.organizer_google_email == organizer_google_email,
        Meeting.status.in_(["UPCOMING", "ONGOING"]),
        Meeting.deleted_at.is_(None),
        Meeting.meeting_date.isnot(None),
        Meeting.start_time.isnot(None),
        Meeting.end_time.isnot(None),
        # A window one day either side is enough to catch every case that
        # could possibly overlap, including a midnight-crossing neighbor.
        Meeting.meeting_date >= meeting_date - datetime.timedelta(days=1),
        Meeting.meeting_date <= meeting_date + datetime.timedelta(days=1),
    )
    if exclude_meeting_id is not None:
        candidates = candidates.filter(Meeting.id != exclude_meeting_id)

    for other in candidates.all():
        other_end_date = other.meeting_date + datetime.timedelta(days=1) if other.end_time < other.start_time else other.meeting_date
        other_start_dt = datetime.datetime.combine(other.meeting_date, other.start_time)
        other_end_dt = datetime.datetime.combine(other_end_date, other.end_time)
        if new_start_dt < other_end_dt and other_start_dt < new_end_dt:
            return other
    return None


def _check_organizer_time_conflict(
    db: Session,
    organizer_google_email: Optional[str],
    meeting_date,
    start_time,
    end_time,
    exclude_meeting_id: Optional[int] = None,
) -> None:
    """Raise 400 if a conflict exists — see _find_organizer_time_conflict."""
    other = _find_organizer_time_conflict(db, organizer_google_email, meeting_date, start_time, end_time, exclude_meeting_id)
    if other:
        raise HTTPException(
            400,
            f"Trùng giờ với cuộc họp #{other.id} \"{other.title}\" "
            f"({other.meeting_date} {other.start_time}–{other.end_time}) — "
            f"cùng tài khoản Google host ({organizer_google_email}) chỉ có thể "
            f"tự động vào 1 cuộc họp tại một thời điểm.",
        )


def _get_active_meeting(db: Session, id: int) -> Meeting:
    """Fetch a meeting for a normal user-facing action — a soft-deleted
    meeting (see delete_meeting) is gone from the app's perspective, so this
    404s exactly like a truly-missing id would. Do NOT use this for the
    bot/n8n integration points (meeting_bot.py's /ended, the n8n webhook
    matcher below) — those must still reach a soft-deleted row so an
    in-flight Bot session or a late recording never orphans."""
    m = db.query(Meeting).filter(Meeting.id == id, Meeting.deleted_at.is_(None)).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")
    return m


def _sync_meeting_calendar_attendees(db: Session, m: Meeting) -> None:
    """Push the meeting's current participant list to Google Calendar as
    attendees (chốt 2026-09-14: Participant == Calendar Guest; organizer/Host
    is NEVER included here — resolved separately via organizer_google_email
    and stays the Calendar 'organizer', not an attendee). Call this after any
    change to a meeting's MeetingMember rows (add/remove/replace) so Calendar
    guests stay in sync with member_ids. Best-effort: never raises, matching
    sync_google_meet_attendees' own swallow-and-log contract, so a Calendar
    API hiccup can't block adding/removing a meeting member."""
    if not m.google_event_id:
        return
    try:
        from ..services.meeting_sync import sync_google_meet_attendees
        # Account (User) email is the primary source (chốt 2026-09-15) — it's
        # what the person actually logs in with, often their real Google
        # account (google_sub-linked), which is exactly what needs to be a
        # Calendar attendee for the invite to land in their own Calendar.
        # Member.email (HR roster contact) is only a fallback for a Member
        # with no linked login Account, or whose Account has no email set.
        rows = (
            db.query(Member.email, User.email)
            .join(MeetingMember, MeetingMember.member_id == Member.id)
            .outerjoin(User, User.member_id == Member.id)
            .filter(MeetingMember.meeting_id == m.id)
            .distinct().all()
        )
        emails = list({(user_email or member_email) for member_email, user_email in rows if (member_email or user_email)})
        workspace_id = _host_workspace_id_for_meeting(db, m)
        sync_google_meet_attendees(db, m.google_event_id, emails, workspace_id=workspace_id)
    except Exception as e:
        logger.warning(f"_sync_meeting_calendar_attendees failed for meeting {m.id} (non-fatal): {e}")


def _host_workspace_id_for_meeting(db: Session, m: Meeting) -> Optional[int]:
    """Which Workspace's Google account actually owns this meeting's Calendar
    event — resolved from organizer_google_email, NOT from the meeting's
    project. Chốt 2026-09-14 'HOST *' field: a meeting's Host can now be
    picked independent of its project's own Workspace (e.g. a project in one
    Workspace hosted under another Workspace's account as a manual backup),
    so workspace_id_for_project(m.project) can no longer be assumed to match
    the account that organizes the Calendar event. Every Calendar mutation on
    an EXISTING meeting (reschedule, cancel, attendees sync) must resolve
    workspace_id through here — project-based resolution stays correct only
    for CREATE-time (no organizer_google_email exists yet) and retry-link's
    intentional fresh-account assignment."""
    from ..services.meeting_sync import resolve_workspace_id_by_google_email
    ws_id = resolve_workspace_id_by_google_email(db, m.organizer_google_email)
    if ws_id:
        return ws_id
    meeting_proj = db.query(Project).filter(Project.id == m.project_id).first() if m.project_id else None
    return workspace_id_for_project(db, meeting_proj)


def _resolve_host_workspace_id(db: Session, body: dict, fallback_workspace_id: Optional[int]) -> Optional[int]:
    """Resolve which Workspace's Google account to use for a NOT-YET-EXISTING
    Calendar event, honoring an explicit body['host_workspace_id'] (chốt
    2026-09-14 'HOST *' field) over the project-derived fallback. Shared by
    /generate-link, /check-conflict, and create_meeting's own fallback-
    generation path, so all three agree on exactly the Host a client picked
    — a mismatch here would show "rảnh" in the conflict preview for one
    account while actually generating the Meet link under another. Raises
    400/404 if the client sent a host_workspace_id that doesn't resolve to a
    real, currently-enabled Host (DISABLED_HOST_EMAILS)."""
    host_workspace_id_input = body.get("host_workspace_id")
    if not host_workspace_id_input:
        return fallback_workspace_id
    try:
        host_workspace_id_input = int(host_workspace_id_input)
    except (TypeError, ValueError):
        raise HTTPException(400, "host_workspace_id không hợp lệ")
    host_ws = db.query(Workspace).filter(Workspace.id == host_workspace_id_input).first()
    if not host_ws:
        raise HTTPException(404, "Không tìm thấy Workspace của Host đã chọn")
    host_wga = db.query(WorkspaceGoogleAccount).filter(WorkspaceGoogleAccount.workspace_id == host_workspace_id_input).first()
    host_email = (host_wga.google_email if host_wga and host_wga.google_email else None) or host_ws.expected_google_email
    if not host_email or host_email.strip().lower() in DISABLED_HOST_EMAILS:
        raise HTTPException(400, "Host đã chọn hiện không khả dụng, vui lòng chọn Host khác")
    return host_workspace_id_input


# ─── LIST ───────────────────────────────────────────────
@router.get("")
def list_meetings(
    project_id: Optional[int] = None,
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    mine: bool = False,
    workspace: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    from ..models.meeting_project import MeetingProject
    q = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member),
        joinedload(Meeting.extra_projects).joinedload(MeetingProject.project)
    ).filter(Meeting.deleted_at.is_(None))
    if user_scope(current_user) != ALL_SCOPE:
        allowed_projects = project_query_for_user(db, current_user).with_entities(Project.id)
        # Visible when it has no project at all (general/company-wide meeting),
        # its primary project is in scope, OR any of its extra linked projects
        # (meeting_projects) is in scope — matching require_route_project_access.
        meetings_via_extra = db.query(MeetingProject.meeting_id).filter(MeetingProject.project_id.in_(allowed_projects))
        conditions = [
            Meeting.project_id.is_(None),
            Meeting.project_id.in_(allowed_projects),
            Meeting.id.in_(meetings_via_extra),
        ]
        # A member with a narrow (single/few) Workspace scope who's been added
        # as a participant or is the creator must still see the meeting, even
        # if its project(s) sit outside their Workspace — same "membership
        # overrides Workspace" rule project_query_for_user() already applies.
        member_id = getattr(current_user, "member_id", None)
        if member_id:
            my_meetings = db.query(MeetingMember.meeting_id).filter(MeetingMember.member_id == member_id)
            conditions.append(Meeting.id.in_(my_meetings))
            conditions.append(Meeting.created_by == member_id)
        q = q.filter(or_(*conditions))

    # Workspace switcher (Navbar) — same UI-narrowing filter Dashboard/KPI/
    # Project Hub apply: a super_admin browsing "one company at a time" also
    # narrows Meetings instead of always seeing every company's meetings.
    # A general/no-project meeting stays visible under every Workspace, same
    # as an "All"-scope project would. Only meaningful for ALL_SCOPE callers —
    # a Workspace-scoped Member/Leader/Viewer is already locked to their own
    # Workspace(s) above (with the membership override applied), so applying
    # this on top of that would wrongly hide a meeting they're a participant
    # of but that belongs to a different Workspace.
    if workspace and workspace.lower() != ALL_SCOPE and user_scope(current_user) == ALL_SCOPE:
        ws_projects = db.query(Project.id).filter(or_(*project_belongs_to_workspace(db, {workspace})))
        meetings_via_extra_ws = db.query(MeetingProject.meeting_id).filter(MeetingProject.project_id.in_(ws_projects))
        q = q.filter(or_(
            Meeting.project_id.is_(None),
            Meeting.project_id.in_(ws_projects),
            Meeting.id.in_(meetings_via_extra_ws),
        ))

    if project_id is not None:
        # Match meetings where this is the primary project OR one of the
        # extra linked projects (meeting_projects) — a meeting assigned to
        # several projects must show up under every one of them.
        meetings_via_extra_pid = db.query(MeetingProject.meeting_id).filter(MeetingProject.project_id == project_id)
        q = q.filter(or_(Meeting.project_id == project_id, Meeting.id.in_(meetings_via_extra_pid)))
    if status:
        # Resolve status filter name
        db_status = STATUS_FE_TO_DB.get(status.upper(), status.upper())
        q = q.filter(Meeting.status.ilike(db_status))
    if from_date:
        fd = parse_date(from_date)
        q = q.filter(Meeting.meeting_date >= fd)
    if to_date:
        td = parse_date(to_date)
        q = q.filter(Meeting.meeting_date <= td)

    # Sort rule (chốt 2026-09-14): see _meeting_list_sort_key's own docstring —
    # not-ended meetings (soonest start_time first) always precede ended ones
    # (most recent start_time first), one flat list, no section headers.
    # Sorted in Python, not SQL: compute_display_status() is a live
    # now()-vs-start_time computation, not a DB column, so there's nothing to
    # ORDER BY server-side without duplicating that logic in a SQL CASE
    # expression — sorting the already-fetched ORM rows is simpler and this
    # endpoint's result set is never large enough for it to matter.
    meetings = q.all()
    meetings.sort(key=_meeting_list_sort_key)
    result = [meeting_to_dict(m, db=db, current_user=current_user) for m in meetings]

    if mine:
        member = None
        if current_user and getattr(current_user, "email", None):
            member = db.query(Member).filter(Member.email.ilike(current_user.email)).first()
        if not member:
            return {"success": True, "data": []}

        own_names = {member.display_name.strip().lower()}
        if member.full_name:
            own_names.add(member.full_name.strip().lower())

        def is_mine(md: dict) -> bool:
            if md.get("created_by") == member.id:
                return True
            for mb in md.get("members", []):
                if mb.get("member_id") == member.id:
                    return True
                name = str(mb.get("display_name") or "").strip().lower()
                if name and name in own_names:
                    return True
            return False

        result = [md for md in result if is_mine(md)]

    return {"success": True, "data": result}

# ─── GENERATE LINK (Zoom / Google Meet) ────────────────
@router.post("/generate-link")
def generate_meeting_link(body: dict, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Generate a Zoom or Google Meet link on demand."""
    platform = str(body.get("platform", "")).strip()
    title = str(body.get("title", "Cuộc họp mới")).strip()
    date_val = body.get("meeting_date") or body.get("date")
    # Confirmed live 2026-09-12: this container's OS/Python clock is UTC, ~7h
    # behind Vietnam (see _now_vn()'s docstring) — a bare date.today() default
    # picks VN's YESTERDAY during VN's 00:00-06:59 window. Use _now_vn() like
    # every other scheduling-relevant "now" in this file.
    meeting_date = parse_date(date_val) if date_val else _now_vn().date()
    time_val = body.get("start_time") or body.get("time")
    start_time = parse_time(time_val) if time_val else datetime.time(9, 0)
    
    dur_mins = 60
    try:
        dur_mins = int(body.get("duration", 60))
    except Exception:
        pass

    start_datetime = f"{meeting_date.isoformat()}T{start_time.strftime('%H:%M')}:00Z"

    if platform.lower() == "zoom":
        try:
            from ..services.meeting_sync import create_zoom_meeting
            result = create_zoom_meeting(title, start_datetime, dur_mins)
            return {"success": True, "join_url": result["join_url"], "platform": "Zoom"}
        except Exception as e:
            logger.error(f"Generate Zoom link failed: {e}")
            raise HTTPException(
                status_code=400,
                detail=f"Không thể tự động tạo link Zoom: {str(e)}. Hãy chắc chắn các khoá ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET được cấu hình đầy đủ trong file .env."
            )
    elif "google" in platform.lower() or "meet" in platform.lower():
        try:
            from ..services.meeting_sync import create_google_meet_link
            proj = db.query(Project).filter(Project.id == body.get("project_id")).first() if body.get("project_id") else None
            workspace_id = _resolve_host_workspace_id(db, body, workspace_id_for_project(db, proj))
            result = create_google_meet_link(db, current_user.id, title, start_datetime, dur_mins, workspace_id)
            # NOT notifying n8n here on purpose (confirmed live 2026-09-13):
            # this endpoint only pre-fetches a join link — no Meeting row
            # exists yet, so result["mk_tag"] is a throwaway placeholder
            # timestamp, not the real id our own recorder tags the Drive
            # upload with. Notifying with that placeholder made n8n search
            # for a tag the video will never actually have. create_meeting()
            # notifies instead, once the real row (and its real id) exists.
            return {
                "success": True,
                "join_url": result["join_url"],
                "platform": "Google Meet",
                # Carried by the FE into the create/update-meeting payload so
                # the eventual Meeting row can be stamped with the REAL event
                # id/organizer from this exact creation call, instead of
                # create_meeting() silently skipping that (meeting_url is
                # already non-empty by then) and leaving both fields NULL.
                "google_event_id": result.get("id"),
                "organizer_google_email": result.get("organizer_google_email"),
            }
        except Exception as e:
            logger.error(f"Generate Google Meet link failed: {e}")
            raise HTTPException(status_code=400, detail=str(e))
    else:
        raise HTTPException(status_code=400, detail=f"Nền tảng '{platform}' chưa hỗ trợ tự động tạo link.")


@router.post("/check-conflict")
def check_meeting_conflict(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Read-only preview of the organizer-conflict rule create/update/retry-link
    enforce (chốt 2026-09-13: overlap source of truth = organizer, not
    participants — see _find_organizer_time_conflict). The frontend calls this
    instead of computing its own member-based heuristic, so a "trùng"/"rảnh"
    hint on screen can never disagree with what submitting will actually do.

    organizer_google_email isn't user-chosen — it's resolved from project_id's
    workspace the exact same way create_google_meet_link will, without
    actually calling the Calendar API (no side effects, safe to call on every
    keystroke's debounce)."""
    project_id = body.get("project_id")
    proj = db.query(Project).filter(Project.id == project_id).first() if project_id else None
    workspace_id = _resolve_host_workspace_id(db, body, workspace_id_for_project(db, proj))

    from ..services.meeting_sync import is_workspace_google_connected
    organizer_google_email = None
    if workspace_id:
        organizer_google_email = (is_workspace_google_connected(db, workspace_id) or {}).get("google_email")
    organizer_google_email = organizer_google_email or "mkt.szone@gmail.com"

    date_val = body.get("meeting_date") or body.get("date")
    meeting_date = parse_date(date_val) if date_val else None
    start_time = parse_time(body.get("start_time") or body.get("time")) if (body.get("start_time") or body.get("time")) else None
    end_time = parse_time(body.get("end_time")) if body.get("end_time") else None
    if not end_time and start_time and body.get("duration"):
        try:
            dur_mins = int(body["duration"])
            start_dt = datetime.datetime.combine(datetime.date.today(), start_time)
            end_time = (start_dt + datetime.timedelta(minutes=dur_mins)).time()
        except Exception:
            end_time = None

    exclude_id = body.get("exclude_meeting_id")
    try:
        exclude_id = int(exclude_id) if exclude_id is not None else None
    except (TypeError, ValueError):
        exclude_id = None

    other = _find_organizer_time_conflict(db, organizer_google_email, meeting_date, start_time, end_time, exclude_meeting_id=exclude_id)
    if other:
        return {
            "conflict": True,
            "organizer_google_email": organizer_google_email,
            "meeting_id": other.id,
            "title": other.title,
            "meeting_date": str(other.meeting_date),
            "start_time": other.start_time.strftime("%H:%M"),
            "end_time": other.end_time.strftime("%H:%M"),
            "message": (
                f"Tài khoản host {organizer_google_email} đã có cuộc họp \"{other.title}\" "
                f"từ {other.start_time.strftime('%H:%M')} đến {other.end_time.strftime('%H:%M')} "
                f"ngày {other.meeting_date} — không thể tự động vào 2 cuộc họp cùng lúc."
            ),
        }
    return {"conflict": False, "organizer_google_email": organizer_google_email}


# ─── MEETING INTELLIGENCE INSIGHTS (must stay above GET /{id} — no path param) ───
@router.get("/insights")
def get_meeting_insights(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    workspace: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Aggregates for the Meeting Intelligence dashboard: weekly hours by
    project vs internal, top people by hours, per-project load, and alerts."""
    from ..models.ai_task_inbox import AITaskInbox
    from ..models.meeting_project import MeetingProject
    from collections import defaultdict

    q = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.members).joinedload(MeetingMember.member),
        joinedload(Meeting.extra_projects).joinedload(MeetingProject.project)
    ).filter(Meeting.deleted_at.is_(None))
    if user_scope(current_user) != ALL_SCOPE:
        allowed_projects = project_query_for_user(db, current_user).with_entities(Project.id)
        meetings_via_extra = db.query(MeetingProject.meeting_id).filter(MeetingProject.project_id.in_(allowed_projects))
        conditions = [
            Meeting.project_id.is_(None),
            Meeting.project_id.in_(allowed_projects),
            Meeting.id.in_(meetings_via_extra),
        ]
        member_id = getattr(current_user, "member_id", None)
        if member_id:
            my_meetings = db.query(MeetingMember.meeting_id).filter(MeetingMember.member_id == member_id)
            conditions.append(Meeting.id.in_(my_meetings))
            conditions.append(Meeting.created_by == member_id)
        q = q.filter(or_(*conditions))

    if workspace and workspace.lower() != ALL_SCOPE and user_scope(current_user) == ALL_SCOPE:
        ws_projects = db.query(Project.id).filter(or_(*project_belongs_to_workspace(db, {workspace})))
        meetings_via_extra_ws = db.query(MeetingProject.meeting_id).filter(MeetingProject.project_id.in_(ws_projects))
        q = q.filter(or_(
            Meeting.project_id.is_(None),
            Meeting.project_id.in_(ws_projects),
            Meeting.id.in_(meetings_via_extra_ws),
        ))

    today = datetime.date.today()
    fd = parse_date(from_date) if from_date else today - datetime.timedelta(days=7)
    td = parse_date(to_date) if to_date else today
    meetings = q.filter(Meeting.meeting_date >= fd, Meeting.meeting_date <= td).all()

    def hours(m: Meeting) -> float:
        if m.start_time and m.end_time:
            start_mins = m.start_time.hour * 60 + m.start_time.minute
            end_mins = m.end_time.hour * 60 + m.end_time.minute
            if end_mins >= start_mins:
                return (end_mins - start_mins) / 60.0
        return 1.0  # unknown duration — treat as 1h, matches modal's default assumption

    daily = defaultdict(lambda: {"project": 0.0, "internal": 0.0})
    per_project_hours = defaultdict(float)
    per_person_hours = defaultdict(float)
    per_person_meetings = defaultdict(int)
    outside_hours_count = 0

    for m in meetings:
        h = hours(m)
        day_key = m.meeting_date.isoformat()
        # A meeting linked to N projects counts its full hours toward each of
        # those N projects' load — a meeting genuinely spanning 2 projects
        # really did cost each of them that time, not a fraction of it.
        project_names = ([m.project.name] if m.project else []) + [
            link.project.name for link in (m.extra_projects or []) if link.project
        ]
        if project_names:
            daily[day_key]["project"] += h
            for name in dict.fromkeys(project_names):  # dedupe, keep order
                per_project_hours[name] += h
        else:
            daily[day_key]["internal"] += h

        if m.start_time and (m.start_time.hour < 8 or m.start_time.hour >= 18):
            outside_hours_count += 1

        for mm in (m.members or []):
            if mm.member:
                per_person_hours[mm.member.display_name] += h
                per_person_meetings[mm.member.display_name] += 1

    weekly_series = [
        {"day": day, "project": round(v["project"], 1), "internal": round(v["internal"], 1)}
        for day, v in sorted(daily.items())
    ]
    project_load = [
        {"name": name, "hours": round(h, 1)}
        for name, h in sorted(per_project_hours.items(), key=lambda x: -x[1])
    ]
    top_people = [
        {"name": name, "hours": round(h, 1), "meetings": per_person_meetings[name]}
        for name, h in sorted(per_person_hours.items(), key=lambda x: -x[1])
    ]

    alerts = []
    overloaded = [p for p in top_people if p["hours"] > 8]
    if overloaded:
        alerts.append({
            "type": "overload",
            "title": f"{len(overloaded)} nhân sự họp trên 8 giờ/tuần",
            "detail": ", ".join(p["name"] for p in overloaded[:3]),
            "count": len(overloaded),
        })
    if outside_hours_count:
        alerts.append({
            "type": "outside",
            "title": f"{outside_hours_count} cuộc họp ngoài giờ",
            "detail": "Trước 8h hoặc sau 18h",
            "count": outside_hours_count,
        })

    # Recurring-unresolved-topic heuristic: same normalized title ≥3x with no decisions.
    title_counts = defaultdict(list)
    for m in meetings:
        key = re.sub(r"\s+", " ", m.title.strip().lower())
        title_counts[key].append(m)
    for key, group in title_counts.items():
        if len(group) >= 3 and all(not (isinstance(x.ai_summary, dict) and x.ai_summary.get("decisions")) for x in group):
            alerts.append({
                "type": "recurring",
                "title": f'Chủ đề "{group[0].title}" lặp lại nhưng chưa chốt',
                "detail": f"Xuất hiện {len(group)} lần",
                "count": len(group),
            })

    unsynced_count = 0
    for m in meetings:
        recommended_tasks = (m.ai_summary or {}).get("recommended_tasks") if isinstance(m.ai_summary, dict) else []
        if recommended_tasks:
            inbox_rows = db.query(AITaskInbox).filter(AITaskInbox.meeting_id == m.id).all()
            if not inbox_rows or any(not r.imported_task_id for r in inbox_rows):
                unsynced_count += 1
    if unsynced_count:
        alerts.append({
            "type": "unsynced",
            "title": f"{unsynced_count} cuộc họp có task chưa vào KPI Tasks",
            "detail": "Kết quả sẽ bị giới hạn điểm cho tới khi đồng bộ",
            "count": unsynced_count,
        })

    return {
        "success": True,
        "data": {
            "weekly_series": weekly_series,
            "project_load": project_load,
            "top_people": top_people,
            "alerts": alerts,
        },
    }


# ─── AVAILABLE HOSTS (chốt 2026-09-14, "HOST *" field) ────
@router.get("/hosts")
def list_available_hosts(
    project_ids: str = "",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List every Workspace's Google account usable as a meeting Host
    (DISABLED_HOST_EMAILS filtered out), plus — when project_ids is passed —
    which one should be auto-selected: the single Workspace all of those
    projects share, if they share exactly one AND it isn't disabled.
    Multi-Workspace project selections and the disabled Workspace both
    resolve to auto_selected_workspace_id=None, requiring a manual pick from
    `hosts` (chốt rule: "khác WS → manual, không tự đoán")."""
    hosts = []
    for ws in db.query(Workspace).order_by(Workspace.name).all():
        wga = db.query(WorkspaceGoogleAccount).filter(WorkspaceGoogleAccount.workspace_id == ws.id).first()
        email = (wga.google_email if wga and wga.google_email else None) or ws.expected_google_email
        if not email or email.strip().lower() in DISABLED_HOST_EMAILS:
            continue
        hosts.append({"workspace_id": ws.id, "workspace_name": ws.name, "google_email": email})

    auto_selected_workspace_id = None
    ids = []
    for raw in project_ids.split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            ids.append(int(raw))
        except ValueError:
            continue
    if ids:
        resolved_ws_ids = set()
        for pid in ids:
            proj = db.query(Project).filter(Project.id == pid).first()
            if proj:
                resolved_ws_ids.add(workspace_id_for_project(db, proj))
        if len(resolved_ws_ids) == 1:
            candidate = next(iter(resolved_ws_ids))
            if candidate is not None and any(h["workspace_id"] == candidate for h in hosts):
                auto_selected_workspace_id = candidate

    return {"hosts": hosts, "auto_selected_workspace_id": auto_selected_workspace_id}


# ─── ATTENDANCE SUMMARY (chốt 2026-09-15, "Nhân sự & Tham gia" card) ──
@router.get("/attendance-summary")
def get_meeting_attendance_summary(
    project: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    workspace: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Per-member attendance aggregate for the Meetings page's "Nhân sự &
    Tham gia" card (chốt 2026-09-15). Only counts Meeting rows that are DONE
    AND have at least one recorded MeetingAttendance row — never inferred
    from Google Calendar responseStatus. `project`/`from_date`/`to_date`
    mirror the page's EXISTING filters (chốt: reuse them as-is, no new
    time-range preset UI) — `project` is a name (this page's project filter
    has no id to send, unlike GET /meetings' project_id), resolved the same
    way create_meeting's legacy project-name path does."""
    from ..models.meeting_project import MeetingProject
    q = (
        db.query(MeetingAttendance, Meeting, Member)
        .join(Meeting, MeetingAttendance.meeting_id == Meeting.id)
        .join(Member, MeetingAttendance.member_id == Member.id)
        .filter(Meeting.status == "DONE", Meeting.deleted_at.is_(None))
    )
    if user_scope(current_user) != ALL_SCOPE:
        allowed_projects = project_query_for_user(db, current_user).with_entities(Project.id)
        meetings_via_extra = db.query(MeetingProject.meeting_id).filter(MeetingProject.project_id.in_(allowed_projects))
        q = q.filter(or_(
            Meeting.project_id.is_(None),
            Meeting.project_id.in_(allowed_projects),
            Meeting.id.in_(meetings_via_extra),
        ))
    if workspace and workspace.lower() != ALL_SCOPE and user_scope(current_user) == ALL_SCOPE:
        ws_projects = db.query(Project.id).filter(or_(*project_belongs_to_workspace(db, {workspace})))
        meetings_via_extra_ws = db.query(MeetingProject.meeting_id).filter(MeetingProject.project_id.in_(ws_projects))
        q = q.filter(or_(
            Meeting.project_id.is_(None),
            Meeting.project_id.in_(ws_projects),
            Meeting.id.in_(meetings_via_extra_ws),
        ))
    if project and project != "All":
        proj = db.query(Project).filter(Project.name.ilike(project.strip())).first()
        if not proj:
            return {"success": True, "data": []}
        meetings_via_extra_pid = db.query(MeetingProject.meeting_id).filter(MeetingProject.project_id == proj.id)
        q = q.filter(or_(Meeting.project_id == proj.id, Meeting.id.in_(meetings_via_extra_pid)))
    if from_date:
        fd = parse_date(from_date)
        if fd:
            q = q.filter(Meeting.meeting_date >= fd)
    if to_date:
        td = parse_date(to_date)
        if td:
            q = q.filter(Meeting.meeting_date <= td)

    summary: dict = {}
    for att, m, member in q.all():
        s = summary.setdefault(member.id, {
            "member_id": member.id,
            "display_name": member.display_name,
            "on_time_count": 0,
            "late_count": 0,
            "late_minutes_total": 0,
            "no_show_count": 0,
            "history": [],
        })
        if att.status == "ON_TIME":
            s["on_time_count"] += 1
        elif att.status == "LATE":
            s["late_count"] += 1
            s["late_minutes_total"] += att.late_minutes or 0
        elif att.status == "NO_SHOW":
            s["no_show_count"] += 1
        s["history"].append({
            "meeting_id": m.id,
            "title": m.title,
            "date": m.meeting_date.isoformat() if m.meeting_date else None,
            "status": att.status,
            "late_minutes": att.late_minutes,
        })

    result = list(summary.values())
    for s in result:
        s["total_recorded"] = s["on_time_count"] + s["late_count"] + s["no_show_count"]
        s["history"].sort(key=lambda h: h["date"] or "", reverse=True)
    result.sort(key=lambda s: s["total_recorded"], reverse=True)
    return {"success": True, "data": result}


# ─── GET ONE ─────────────────────────────────────────────
@router.get("/{id}")
def get_meeting(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from ..models.meeting_project import MeetingProject
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member),
        joinedload(Meeting.extra_projects).joinedload(MeetingProject.project)
    ).filter(Meeting.id == id, Meeting.deleted_at.is_(None)).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")
    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}

# ─── CREATE ──────────────────────────────────────────────
@router.post("")
def create_meeting(body: dict, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    title = str(body.get("title", "")).strip()
    if not title:
        raise HTTPException(400, "Tiêu đề không được để trống")

    # Support 'date' or 'meeting_date'
    date_val = body.get("meeting_date") or body.get("date")
    meeting_date = parse_date(date_val)
    if not meeting_date:
        raise HTTPException(400, "Ngày họp không được để trống")

    # Support 'time' or 'start_time'
    time_val = body.get("start_time") or body.get("time")
    start_time = parse_time(time_val)
    if not start_time:
        raise HTTPException(400, "Giờ bắt đầu không được để trống")

    # Support 'endTime' or 'end_time'
    end_time_val = body.get("end_time") or body.get("endTime")
    end_time = parse_time(end_time_val)
    if not end_time and "duration" in body and start_time:
        try:
            dur_mins = int(body["duration"])
            start_dt = datetime.datetime.combine(datetime.date.today(), start_time)
            end_dt = start_dt + datetime.timedelta(minutes=dur_mins)
            end_time = end_dt.time()
        except Exception:
            pass

    # Lifecycle rule (chốt 2026-09-13): ONGOING/DONE are server-controlled —
    # only the Meeting Host Bot's actual-end report (POST /api/meeting-bot/ended),
    # a real external sync (Zoom cloud API, POST /{id}/sync), or n8n creating a
    # brand-new row from an already-discovered recording may set them. A client
    # cannot manufacture either state just by passing it in the create body.
    # CANCELLED is the one genuinely manual state (no bot/clock can know a
    # meeting was called off) and stays client-settable.
    status_input = str(body.get("status", "UPCOMING")).upper()
    status = STATUS_FE_TO_DB.get(status_input, status_input)
    if status not in ("UPCOMING", "CANCELLED"):
        status = "UPCOMING"

    # Multiple projects: front-end sends project_ids: [int]. First one becomes
    # the "primary" project_id (kept for scoring/back-compat); the rest go
    # into meeting_projects. Falls back to the legacy single project_id/project
    # fields when project_ids isn't sent, so older callers still work.
    project_ids_input = body.get("project_ids")
    extra_project_ids = []
    if isinstance(project_ids_input, list) and project_ids_input:
        validated = []
        for pid in project_ids_input:
            try:
                pid = int(pid)
            except (TypeError, ValueError):
                continue
            proj_check = require_project(db, current_user, pid)
            if not proj_check:
                raise HTTPException(404, f"Không tìm thấy dự án id={pid}")
            validated.append(pid)
        if not validated:
            raise HTTPException(400, "Danh sách dự án không hợp lệ")
        project_id = validated[0]
        extra_project_ids = validated[1:]
        proj = db.query(Project).filter(Project.id == project_id).first()
    else:
        project_id = body.get("project_id")
        # Support mapping project name string to project_id if it's sent as a string name
        project_input = body.get("project")
        if project_id:
            proj = require_project(db, current_user, int(project_id))
            if not proj:
                raise HTTPException(404, "Không tìm thấy dự án được liên kết")
        elif project_input:
            proj = db.query(Project).filter(Project.name.ilike(str(project_input).strip())).first()
            if proj:
                require_project(db, current_user, proj.id)
                project_id = proj.id
        else:
            project_id = None

    # Map current_user email to member if possible
    created_by = None
    if current_user and getattr(current_user, "email", None):
        member = db.query(Member).filter(Member.email.ilike(current_user.email)).first()
        if member:
            created_by = member.id

    # Handle Link mappings — auto-generate if empty
    meeting_url = body.get("meeting_url") or body.get("link")
    platform = body.get("platform") or "Google Meet"
    # Google Meet links are now generated up-front by POST /generate-link
    # (see CreateMeetingModal's locked-down "Tạo link Google Meet" flow), so
    # meeting_url usually already arrives non-empty here and the branch below
    # never runs — carry the event id/organizer that call already captured
    # instead of silently leaving both NULL for every meeting created this way.
    google_event_id = body.get("google_event_id")
    organizer_google_email = body.get("organizer_google_email")
    # HOST * field (chốt 2026-09-14): body.host_workspace_id, when sent,
    # overrides the project-derived workspace for EVERY Google side-effect
    # below (Meet-link generation, n8n notify routing, Drive tag rename) — a
    # meeting's Host account is now a deliberate, independent choice, not
    # just whatever account the project's own Workspace happens to use.
    # Other create_meeting callers that don't send this field (n8n's
    # create-branch, the Calendar quick-create drawer) keep the old
    # project-based auto-resolution untouched.
    workspace_id = _resolve_host_workspace_id(db, body, workspace_id_for_project(db, proj if 'proj' in locals() else None))

    if not meeting_url:
        # Build ISO start_time for API calls
        start_datetime = f"{meeting_date.isoformat()}T{start_time.strftime('%H:%M')}:00Z"
        dur_mins = 60
        try:
            dur_mins = int(body.get("duration", 60))
        except Exception:
            pass

        if platform and platform.lower() == "zoom":
            try:
                from ..services.meeting_sync import create_zoom_meeting
                result = create_zoom_meeting(title, start_datetime, dur_mins)
                meeting_url = result["join_url"]
            except Exception as e:
                logger.error(f"Auto-generate Zoom link failed: {e}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Không thể tự động tạo link Zoom: {str(e)}. Hãy chắc chắn các khoá ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET được cấu hình đầy đủ trong file .env."
                )
        else:
            try:
                from ..services.meeting_sync import create_google_meet_link
                result = create_google_meet_link(db, current_user.id, title, start_datetime, dur_mins, workspace_id)
                meeting_url = result["join_url"]
                google_event_id = result.get("id")
                organizer_google_email = result.get("organizer_google_email")
                # NOT notifying n8n here on purpose (confirmed live 2026-09-13):
                # result["mk_tag"] is a throwaway placeholder timestamp, not
                # this row's real id — notified once below, after db.flush(),
                # using the real m.id our own recorder tags the Drive upload
                # with.
            except Exception as e:
                logger.error(f"Auto-generate Google Meet link failed: {e}")
                raise HTTPException(status_code=400, detail=str(e))

    _check_organizer_time_conflict(db, organizer_google_email, meeting_date, start_time, end_time)

    # Handle AI summary formatting
    ai_summary = body.get("ai_summary") or body.get("summary")
    if ai_summary and isinstance(ai_summary, list):
        # Store flat list of strings directly
        ai_summary = [str(item) for item in ai_summary]

    try:
        reminder_minutes = int(body.get("reminder_minutes", 15))
    except (TypeError, ValueError):
        reminder_minutes = 15
    notify_channels_input = body.get("notify_channels")
    notify_channels = [str(c) for c in notify_channels_input] if isinstance(notify_channels_input, list) else None

    m = Meeting(
        title=title,
        description=body.get("description"),
        platform=body.get("platform"),
        meeting_url=meeting_url,
        google_event_id=google_event_id,
        organizer_google_email=organizer_google_email,
        meeting_date=meeting_date,
        start_time=start_time,
        end_time=end_time,
        status=status,
        transcript=body.get("transcript"),
        ai_summary=ai_summary,
        project_id=project_id,
        created_by=created_by,
        objective=body.get("objective"),
        agenda=body.get("agenda"),
        no_action_reason=body.get("no_action_reason"),
        reminder_minutes=reminder_minutes,
        notify_channels=notify_channels,
    )
    # Auto-summarize with AI on create (using structured output)
    try:
        from ..services.meeting_sync import summarize_meeting_with_ai_structured
        proj_name = proj.name if 'proj' in locals() and proj else "Dự án chung"
        meeting_info = {
            "title": m.title,
            "project_name": proj_name,
            "project": proj_name,
            "date": m.meeting_date.isoformat() if m.meeting_date else "",
            "meeting_date": m.meeting_date,
            "start_time": m.start_time,
            "transcript": m.transcript or m.description or "",
        }
        # Chỉ gọi AI khi thật sự có nội dung để tóm tắt (transcript/description
        # đủ dài) — trước đây luôn gọi kể cả khi rỗng vì frontend mặc định gửi
        # auto_summarize=true, khiến MỌI lần tạo meeting đều chờ 1 request AI
        # vô ích (chậm), dù chưa họp thì làm gì đã có gì để tóm tắt.
        has_real_content = bool((m.transcript and m.transcript.strip()) or (m.description and len(m.description.strip()) > 20))
        if has_real_content and (not m.ai_summary or body.get("auto_summarize")):
            summary_result = summarize_meeting_with_ai_structured(m.transcript or m.description or "", meeting_info)
            if summary_result:
                m.ai_summary = summary_result
                if m.transcript and m.transcript.strip():
                    logger.warning(
                        "MEETING_STATUS_DONE",
                        extra={"meeting_id": None, "meeting_title": m.title, "source": "create_meeting.auto_summarize"},
                    )
                    m.status = "DONE"
    except Exception as e:
        logger.warning(f"Auto-summarize meeting {m.id} on create failed: {e}")

    db.add(m)
    db.flush()
    # Notify n8n here, not earlier — this is the first point where m.id (the
    # real tag our own recorder_service.py/meeting_bot.py stamp the Drive
    # upload with, e.g. "[MK-{id}]") actually exists. Confirmed live
    # 2026-09-13: both call sites above used to notify with a throwaway
    # placeholder timestamp instead, so n8n's Drive search was hunting for a
    # tag the uploaded video would never actually have — silently breaking
    # AI-summary auto-discovery for every meeting created this way.
    meeting_url_lower = (m.meeting_url or "").lower()
    if "meet.google.com" in meeting_url_lower or (m.platform or "").lower() in ("google meet", "google"):
        from ..services.meeting_sync import notify_n8n_meeting_created, rename_google_meet_event_tag
        notify_n8n_meeting_created(db, m, workspace_id)
        rename_google_meet_event_tag(db, m.google_event_id, m.id, m.title, workspace_id)
    if extra_project_ids:
        _sync_meeting_projects(db, m.id, extra_project_ids)
    from ..services.meeting_score_engine import recalculate_meeting_score
    recalculate_meeting_score(m, db)
    db.commit()
    db.refresh(m)

    AuditService.record(
        db=db,
        user_id=getattr(current_user, "id", None),
        module="Meeting",
        entity_type="Meeting",
        entity_id=m.id,
        action="CREATE",
        project_id=m.project_id,
        description=f"Tạo cuộc họp '{m.title}' (Ngày: {m.meeting_date})"
    )
    db.commit()

    # Re-fetch with relationships
    from ..models.meeting_project import MeetingProject
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member),
        joinedload(Meeting.extra_projects).joinedload(MeetingProject.project)
    ).filter(Meeting.id == m.id).first()

    # Trigger Telegram Notification
    try:
        from ..services.telegram import send_meeting_notification
        send_meeting_notification(db, m)
    except Exception as e:
        logger.warning(f"Failed to send Telegram notification for meeting {m.id}: {e}")

    # The Zalo join-link message is sent by the reminder scheduler
    # (meeting_reminders.dispatch_due_reminders), timed to reminder_minutes
    # before the meeting actually starts — not here on creation. Blasting the
    # link out immediately regardless of how far in the future the meeting
    # is scheduled meant it was long buried in the group chat by the time
    # anyone needed it; the reminder is the one message that should carry it.

    # Advisory leave-conflict warning — non-blocking.
    participant_ids = set()
    if created_by:
        participant_ids.add(created_by)
    for raw in body.get("member_ids") or []:
        try:
            participant_ids.add(int(raw))
        except (TypeError, ValueError):
            continue
    start_dt, end_dt = _meeting_datetime_range(meeting_date, start_time, end_time)
    conflicts = meeting_leave_conflicts(db, list(participant_ids), start_dt, end_dt)
    response = {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}
    if conflicts:
        response["warning"] = {
            "message": "Một số người tham dự cuộc họp đã đăng ký nghỉ trong khoảng thời gian này.",
            "conflicts": conflicts,
        }

    return response

# ─── UPDATE ──────────────────────────────────────────────
@router.put("/{id}")
def update_meeting(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    m = _get_active_meeting(db, id)

    # Edit lifecycle lock (chốt 2026-09-14): only a genuinely-not-yet-started
    # UPCOMING meeting may be edited at all — ONGOING (live, via
    # compute_display_status — status itself never persists as "ONGOING",
    # see that function's docstring), DONE, and CANCELLED are all fully
    # read-only through this endpoint, no per-field exceptions. This is a
    # deliberate behavior change: CANCELLED meetings used to be revivable by
    # PUTting status=UPCOMING — that path is now gone too; organizing again
    # means creating a new meeting. Checked before touching any field so a
    # rejected request can never leave the row in a half-old-half-new state.
    if m.status != "UPCOMING" or compute_display_status(m) == "ĐANG DIỄN RA":
        raise HTTPException(
            400,
            f"Không thể chỉnh sửa cuộc họp ở trạng thái {compute_display_status(m)}. "
            f"Chỉ có thể sửa khi cuộc họp chưa bắt đầu (SẮP TỚI).",
        )

    old_dict = {"title": m.title, "status": m.status, "meeting_date": str(m.meeting_date) if m.meeting_date else None}
    old_status = m.status
    old_meeting_date = m.meeting_date
    old_start_time = m.start_time
    old_end_time = m.end_time
    # Lifecycle rule (chốt 2026-09-13): ONGOING/DONE are server-controlled —
    # a client PUT can no longer force either one directly (see create_meeting's
    # matching comment for the full rationale). CANCELLED is the one genuinely
    # manual status a client may request here (the guard above already
    # guarantees old_status is UPCOMING at this point, so this is always a
    # forward UPCOMING->CANCELLED transition, never a revival).
    status_input = str(body.get("status", m.status)).upper()
    requested_status = STATUS_FE_TO_DB.get(status_input, status_input)
    if requested_status in ("CANCELLED", "UPCOMING"):
        new_status = requested_status
    else:
        new_status = m.status

    # Support 'date' or 'meeting_date'
    new_date_str = body.get("meeting_date") or body.get("date")
    new_date = parse_date(new_date_str) if new_date_str else m.meeting_date

    m.title = str(body.get("title", m.title)).strip()
    if not m.title:
        raise HTTPException(400, "Tiêu đề không được để trống")

    m.description = body.get("description", m.description)
    m.platform = body.get("platform", m.platform)
    m.meeting_url = body.get("meeting_url") or body.get("link") or m.meeting_url
    # Organizer rule (chốt 2026-09-13): organizer_google_email is immutable via
    # this generic edit endpoint — the Meeting Host Bot's "1 Gmail host = 1
    # concurrent meeting" invariant and the overlap check both key off this
    # field, so it must never change as a side effect of an unrelated PUT body
    # (e.g. a date/time edit that happens to still carry the old value, or a
    # client that hand-crafts the field). The only way to reassign the
    # organizer is POST /{id}/retry-link, which atomically generates a brand
    # new Google Meet link AND persists organizer_google_email server-side —
    # never via this endpoint. `google_event_id` follows the same rule since
    # it's tied 1:1 to the same Calendar event as the organizer.
    m.meeting_date = new_date

    # Support time mappings
    start_time_val = body.get("start_time") or body.get("time")
    if start_time_val:
        m.start_time = parse_time(start_time_val)
        
    end_time_val = body.get("end_time") or body.get("endTime")
    if end_time_val:
        m.end_time = parse_time(end_time_val)
    elif "duration" in body and m.start_time:
        try:
            dur_mins = int(body["duration"])
            start_dt = datetime.datetime.combine(datetime.date.today(), m.start_time)
            end_dt = start_dt + datetime.timedelta(minutes=dur_mins)
            m.end_time = end_dt.time()
        except Exception:
            pass

    _check_organizer_time_conflict(db, m.organizer_google_email, m.meeting_date, m.start_time, m.end_time, exclude_meeting_id=m.id)

    m.status = new_status
    m.transcript = body.get("transcript", m.transcript)
    m.objective = body.get("objective", m.objective)
    m.agenda = body.get("agenda", m.agenda)
    m.no_action_reason = body.get("no_action_reason", m.no_action_reason)

    if "reminder_minutes" in body:
        try:
            m.reminder_minutes = int(body["reminder_minutes"])
        except (TypeError, ValueError):
            pass
    if isinstance(body.get("notify_channels"), list):
        m.notify_channels = [str(c) for c in body["notify_channels"]]

    # Store ai_summary if provided (or keep old if not in payload)
    ai_summary_input = body.get("ai_summary") or body.get("summary")
    if ai_summary_input is not None:
        if isinstance(ai_summary_input, list):
            m.ai_summary = [str(item) for item in ai_summary_input]
        else:
            m.ai_summary = ai_summary_input

    members_input = body.get("members")
    if members_input is not None and isinstance(members_input, list):
        if not isinstance(m.ai_summary, dict):
            m.ai_summary = {"executive_summary": str(m.ai_summary or "")}
        updated_summary = dict(m.ai_summary)
        updated_summary["custom_members"] = members_input
        m.ai_summary = updated_summary

    project_ids_input = body.get("project_ids")
    if isinstance(project_ids_input, list):
        validated = []
        for pid in project_ids_input:
            try:
                pid = int(pid)
            except (TypeError, ValueError):
                continue
            proj_check = require_project(db, current_user, pid)
            if not proj_check:
                raise HTTPException(404, f"Không tìm thấy dự án id={pid}")
            validated.append(pid)
        m.project_id = validated[0] if validated else None
        _sync_meeting_projects(db, m.id, validated[1:])
    else:
        project_id = body.get("project_id")
        project_input = body.get("project")
        if project_id is not None:
            if project_id:
                proj = require_project(db, current_user, int(project_id))
                if not proj:
                    raise HTTPException(404, "Không tìm thấy dự án được liên kết")
                m.project_id = project_id
            else:
                m.project_id = None
        elif project_input is not None:
            if project_input:
                proj = db.query(Project).filter(Project.name.ilike(str(project_input).strip())).first()
                if proj:
                    require_project(db, current_user, proj.id)
                    m.project_id = proj.id
            else:
                m.project_id = None

    # Participants — re-selected from the edit form. The endpoint-wide
    # lifecycle lock above already guarantees this is a not-yet-started
    # UPCOMING meeting.
    member_ids_input = body.get("member_ids")
    if isinstance(member_ids_input, list):
        wanted_ids = set()
        for raw in member_ids_input:
            try:
                wanted_ids.add(int(raw))
            except (TypeError, ValueError):
                continue
        existing = {mm.member_id: mm for mm in m.members}
        for mid in wanted_ids - existing.keys():
            if db.query(Member).filter(Member.id == mid).first():
                db.add(MeetingMember(meeting_id=m.id, member_id=mid, role="PARTICIPANT"))
        removed_mids = existing.keys() - wanted_ids
        for mid in removed_mids:
            db.delete(existing[mid])
        if removed_mids:
            # Same attendance-cleanup invariant as remove_meeting_member
            # (chốt 2026-09-15) — a no-op today since this whole endpoint
            # already requires UPCOMING, kept as the same defensive safety net.
            db.query(MeetingAttendance).filter(
                MeetingAttendance.meeting_id == m.id, MeetingAttendance.member_id.in_(removed_mids)
            ).delete(synchronize_session=False)
        members_changed = True
    else:
        members_changed = False

    from ..services.meeting_score_engine import recalculate_meeting_score
    recalculate_meeting_score(m, db)
    db.commit()
    if members_changed:
        _sync_meeting_calendar_attendees(db, m)
    AuditService.record_diff(
        db=db, user_id=getattr(current_user, "id", None), module="Meeting", entity_type="Meeting",
        entity_id=m.id, old_dict=old_dict,
        new_dict={"title": m.title, "status": m.status, "meeting_date": str(m.meeting_date) if m.meeting_date else None},
        project_id=m.project_id,
        field_labels={"title": "Tiêu đề", "status": "Trạng thái", "meeting_date": "Ngày họp"},
    )
    db.commit()

    # Trigger Telegram Notification if summary updated
    if body.get("ai_summary") or body.get("summary") or body.get("transcript"):
        try:
            from ..services.telegram import send_meeting_notification
            send_meeting_notification(db, m)
        except Exception as e:
            logger.warning(f"Failed to send Telegram notification for meeting update {m.id}: {e}")

    # Reschedule the SAME Google Calendar event (events.patch) if the date/time
    # actually changed — best-effort, mirrors the Telegram/Zalo notify pattern
    # above so a Calendar hiccup never blocks saving the edit.
    time_changed = (m.meeting_date != old_meeting_date) or (m.start_time != old_start_time) or (m.end_time != old_end_time)
    if m.google_event_id and time_changed and m.start_time and m.end_time:
        try:
            from ..services.meeting_sync import update_google_meet_event
            start_iso = datetime.datetime.combine(m.meeting_date, m.start_time).isoformat()
            end_iso = datetime.datetime.combine(m.meeting_date, m.end_time).isoformat()
            workspace_id = _host_workspace_id_for_meeting(db, m)
            update_google_meet_event(db, m.google_event_id, start_iso, end_iso, workspace_id)
        except Exception as e:
            logger.warning(f"Failed to sync rescheduled time to Google Calendar for meeting {m.id}: {e}")

    # Advisory leave-conflict warning — non-blocking.
    participant_ids = set()
    if m.created_by:
        participant_ids.add(m.created_by)
    for mm in m.members:
        if mm.member_id:
            participant_ids.add(mm.member_id)
    start_dt, end_dt = _meeting_datetime_range(m.meeting_date, m.start_time, m.end_time)
    conflicts = meeting_leave_conflicts(db, list(participant_ids), start_dt, end_dt)
    response = {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}
    if conflicts:
        response["warning"] = {
            "message": "Một số người tham dự cuộc họp đã đăng ký nghỉ trong khoảng thời gian này.",
            "conflicts": conflicts,
        }

    return response

# ─── UPDATE TRANSCRIPT (Rule 03) ────────────────────────
@router.post("/{id}/transcript")
def update_transcript(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    m = _get_active_meeting(db, id)

    # Update transcript. Keep old ai_summary as reference (Rule 03 updated).
    m.transcript = body.get("transcript", "")
    db.commit()

    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == id).first()

    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}

# ─── DELETE ──────────────────────────────────────────────
@router.delete("/{id}")
def delete_meeting(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m or m.deleted_at is not None:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

    # Delete rule (chốt 2026-09-13, "Delete Meeting an toàn cho Bot/n8n"):
    # ONGOING is the ONLY status that blocks Delete — no admin override.
    # Checked via compute_display_status(), NOT the raw m.status column:
    # "ONGOING" is a live display-only derivation (see that function's
    # docstring) and is never actually persisted — a meeting genuinely in
    # progress right now still has m.status == "UPCOMING" in the DB, so
    # comparing the raw column here would silently let an in-progress
    # meeting be deleted out from under the Bot.
    if compute_display_status(m) == "ĐANG DIỄN RA":
        raise HTTPException(
            400,
            "Không thể xóa cuộc họp đang diễn ra (ONGOING). Muốn kết thúc cuộc họp thì dùng "
            "Leave/End meeting — Delete chỉ áp dụng cho SẮP TỚI, ĐÃ KẾT THÚC hoặc ĐÃ HỦY.",
        )

    # Soft delete only — never hard-delete. Status is left untouched so it
    # still reflects the real lifecycle (DONE stays DONE, CANCELLED stays
    # CANCELLED, UPCOMING stays UPCOMING); meeting_id/google_event_id/
    # meeting_url/n8n_notify_*/transcript/ai_summary are all preserved so a
    # Bot session already in flight or a late n8n callback never orphans —
    # see meeting_bot.py's /ended and the n8n webhook matcher below, neither
    # of which filters on deleted_at on purpose.
    m.deleted_at = _now_vn()
    m.deleted_by = getattr(current_user, "id", None)

    # UPCOMING is the only case where the Calendar event is still "live" —
    # DONE/CANCELLED meetings' events are already over/cancelled from
    # Calendar's own perspective. Best-effort: never blocks or rolls back
    # the soft-delete the user already performed on failure.
    if m.status == "UPCOMING" and m.google_event_id:
        try:
            from ..services.meeting_sync import cancel_google_meet_event
            workspace_id = _host_workspace_id_for_meeting(db, m)
            cancel_google_meet_event(db, m.google_event_id, workspace_id=workspace_id)
        except Exception as e:
            logger.warning(f"cancel_google_meet_event failed for meeting {id} (non-fatal): {e}")

    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Meeting", entity_type="Meeting",
        entity_id=id, action="DELETE", project_id=m.project_id, resource_name=m.title,
        description=f"Xóa (ẩn) cuộc họp '{m.title}'"
    )
    db.commit()
    return {"message": "Đã xóa cuộc họp thành công"}

# ─── MANUAL END (VPS/Bot crash fallback) ─────────────────
@router.post("/{id}/manual-ended")
def manual_end_meeting(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Chốt 2026-09-14: fallback for when the Meeting Host Bot/VPS is down —
    a human joined as Host manually, actually ended the call on Google Meet,
    and comes back to the PM to mark it DONE by hand. Does NOT touch or
    replace POST /meeting-bot/ended (the Bot's own automated path) — both
    converge on the same DONE state, this is purely a manual escape hatch
    for when that automated path never fires.

    Authorization: no per-endpoint check here on purpose — this router's
    require_route_project_access dependency already gates every write on
    this exact router to creator/PM-Leader/full-project-access (the same
    "can_manage" condition meeting_to_dict computes for the UI), matching
    every other mutating endpoint here (delete/update/retry-link). A
    literal "is this caller the Host" check is not possible: Host accounts
    (organizer_google_email) are shared operational Gmail mailboxes the Bot
    logs into, not individual portal logins — no portal user's own email
    could ever equal one, so that check would 403 everyone unconditionally.
    """
    m = _get_active_meeting(db, id)
    if compute_display_status(m) != "ĐANG DIỄN RA":
        raise HTTPException(
            400,
            f"Chỉ có thể đánh dấu kết thúc khi cuộc họp đang diễn ra "
            f"(hiện tại: {compute_display_status(m)}).",
        )
    logger.warning(f"MEETING_STATUS_DONE source=manual_ended meeting_id={m.id} user_id={getattr(current_user, 'id', None)}")
    m.status = "DONE"
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Meeting", entity_type="Meeting",
        entity_id=id, action="UPDATE", project_id=m.project_id, resource_name=m.title,
        description=f"Đánh dấu thủ công cuộc họp '{m.title}' đã kết thúc (fallback khi Bot/VPS không khả dụng)"
    )
    db.commit()
    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}

# ─── ATTENDANCE (chốt 2026-09-15) ─────────────────────────
ATTENDANCE_STATUSES = {"ON_TIME", "LATE", "NO_SHOW"}


def _attendance_to_dict(a: MeetingAttendance) -> dict:
    return {
        "member_id": a.member_id,
        "status": a.status,
        "joined_at": a.joined_at.strftime("%H:%M") if a.joined_at else None,
        "late_minutes": a.late_minutes,
        "recorded_by": a.recorded_by,
        "recorded_at": a.recorded_at.isoformat() if a.recorded_at else None,
    }


@router.get("/{id}/attendance")
def get_meeting_attendance(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Phase 1 Manual Attendance (chốt 2026-09-15). `recorded=False` means no
    MeetingAttendance rows exist yet for this meeting — the frontend uses
    that (not the meeting's own status) to decide between the empty-state
    "Ghi nhận tham gia" prompt and the stats+table view."""
    m = _get_active_meeting(db, id)
    rows = db.query(MeetingAttendance).filter(MeetingAttendance.meeting_id == id).all()
    return {
        "success": True,
        "recorded": len(rows) > 0,
        "data": [_attendance_to_dict(a) for a in rows],
    }


@router.post("/{id}/attendance")
def save_meeting_attendance(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Bulk upsert — the whole form is submitted as one request (chốt
    2026-09-15: "Mỗi thành viên bắt buộc phải được chọn một trong 3 trạng
    thái"), so this requires exactly the meeting's CURRENT member_ids, no
    more/fewer. Only allowed once the meeting has genuinely ended (real
    persisted status, not the live display value — a meeting that's merely
    ĐANG DIỄN RA could still have someone walk in late) — deliberately not
    reusing the ONGOING-lock's compute_display_status check, since that
    check exists to protect Host/time/participant fields, not this one.
    Never inferred from Google Calendar responseStatus — an RSVP says
    nothing about who actually showed up."""
    m = _get_active_meeting(db, id)
    if m.status != "DONE":
        raise HTTPException(400, f"Chỉ có thể ghi nhận tham gia khi cuộc họp đã kết thúc (hiện tại: {compute_display_status(m)}).")

    records = body.get("records")
    if not isinstance(records, list) or not records:
        raise HTTPException(400, "Danh sách ghi nhận không được để trống")

    valid_member_ids = {mm.member_id for mm in m.members}
    submitted_ids = set()
    parsed = []
    for rec in records:
        member_id = rec.get("member_id")
        try:
            member_id = int(member_id)
        except (TypeError, ValueError):
            raise HTTPException(400, "member_id không hợp lệ")
        if member_id not in valid_member_ids:
            raise HTTPException(400, f"member_id {member_id} không thuộc danh sách tham gia của cuộc họp này")
        status = str(rec.get("status", "")).upper()
        if status not in ATTENDANCE_STATUSES:
            raise HTTPException(400, f"Trạng thái không hợp lệ: {rec.get('status')}")
        submitted_ids.add(member_id)

        joined_at = None
        late_minutes = None
        joined_at_str = rec.get("joined_at")
        if status == "LATE" and joined_at_str:
            joined_at = parse_time(joined_at_str)
            if joined_at and m.start_time:
                start_mins = m.start_time.hour * 60 + m.start_time.minute
                joined_mins = joined_at.hour * 60 + joined_at.minute
                late_minutes = max(joined_mins - start_mins, 0)
        parsed.append({"member_id": member_id, "status": status, "joined_at": joined_at, "late_minutes": late_minutes})

    if submitted_ids != valid_member_ids:
        missing = valid_member_ids - submitted_ids
        raise HTTPException(400, f"Thiếu ghi nhận cho {len(missing)} thành viên (member_id: {sorted(missing)})")

    existing_by_member = {a.member_id: a for a in db.query(MeetingAttendance).filter(MeetingAttendance.meeting_id == id).all()}
    for rec in parsed:
        row = existing_by_member.get(rec["member_id"])
        if row:
            row.status = rec["status"]
            row.joined_at = rec["joined_at"]
            row.late_minutes = rec["late_minutes"]
            row.recorded_by = getattr(current_user, "id", None)
        else:
            db.add(MeetingAttendance(
                meeting_id=id, member_id=rec["member_id"], status=rec["status"],
                joined_at=rec["joined_at"], late_minutes=rec["late_minutes"],
                recorded_by=getattr(current_user, "id", None),
            ))
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Meeting", entity_type="Meeting",
        entity_id=id, action="UPDATE", project_id=m.project_id, resource_name=m.title,
        description=f"Ghi nhận tham gia cho {len(parsed)} thành viên của cuộc họp '{m.title}'"
    )
    db.commit()

    rows = db.query(MeetingAttendance).filter(MeetingAttendance.meeting_id == id).all()
    return {"success": True, "data": [_attendance_to_dict(a) for a in rows]}

# ─── ADD MEMBER ─────────────────────────────────────────
@router.post("/{id}/members")
def add_meeting_member(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    m = _get_active_meeting(db, id)

    # Edit lifecycle lock (chốt 2026-09-14): participants follow the exact
    # same rule as the generic PUT — only a not-yet-started UPCOMING meeting
    # may have its member list touched at all.
    if m.status != "UPCOMING" or compute_display_status(m) == "ĐANG DIỄN RA":
        raise HTTPException(400, f"Không thể thay đổi người tham gia của cuộc họp ở trạng thái {compute_display_status(m)}.")

    member_id = body.get("member_id")
    if not member_id:
        raise HTTPException(400, "member_id không được để trống")

    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(404, "Không tìm thấy thành viên")

    # Check duplicate
    exists = db.query(MeetingMember).filter(
        MeetingMember.meeting_id == id,
        MeetingMember.member_id == member_id
    ).first()
    if exists:
        raise HTTPException(400, "Thành viên này đã được thêm vào cuộc họp")

    role = body.get("role", "PARTICIPANT")
    if role not in ["HOST", "PM", "PARTICIPANT", "VIEWER"]:
        role = "PARTICIPANT"

    mm = MeetingMember(
        meeting_id=id,
        member_id=member_id,
        role=role,
        joined_at=datetime.datetime.now()
    )
    db.add(mm)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Meeting", entity_type="Meeting",
        entity_id=id, action="UPDATE", project_id=m.project_id, resource_name=member.display_name,
        description=f"Thêm '{member.display_name}' vào cuộc họp '{m.title}' (vai trò {role})"
    )
    db.commit()
    _sync_meeting_calendar_attendees(db, m)

    # Re-fetch full meeting
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == id).first()

    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}

# ─── REMOVE MEMBER ───────────────────────────────────────
@router.delete("/{id}/members/{member_id}")
def remove_meeting_member(id: int, member_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    m = _get_active_meeting(db, id)

    # Edit lifecycle lock (chốt 2026-09-14): same rule as add_meeting_member.
    if m.status != "UPCOMING" or compute_display_status(m) == "ĐANG DIỄN RA":
        raise HTTPException(400, f"Không thể thay đổi người tham gia của cuộc họp ở trạng thái {compute_display_status(m)}.")

    mm = db.query(MeetingMember).filter(
        MeetingMember.meeting_id == id,
        MeetingMember.member_id == member_id
    ).first()
    if not mm:
        raise HTTPException(404, "Thành viên không thuộc cuộc họp này")

    removed_member = db.query(Member).filter(Member.id == member_id).first()
    db.delete(mm)
    # Attendance must stay in sync with the meeting's current member list
    # (chốt 2026-09-15): a removed member's MeetingAttendance row, if any,
    # is deleted with them — re-adding the same member later never restores
    # it, they'd need to be recorded again from scratch on a DONE meeting.
    # In practice this is a no-op today (this endpoint only runs while
    # UPCOMING, and attendance can only be recorded once DONE, so the two
    # can never coexist for the same meeting) — kept as a defensive
    # safety net in case that guard relationship ever changes.
    db.query(MeetingAttendance).filter(
        MeetingAttendance.meeting_id == id, MeetingAttendance.member_id == member_id
    ).delete()
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Meeting", entity_type="Meeting",
        entity_id=id, action="UPDATE", project_id=m.project_id,
        resource_name=removed_member.display_name if removed_member else str(member_id),
        description=f"Gỡ '{removed_member.display_name if removed_member else member_id}' khỏi cuộc họp '{m.title}'"
    )
    db.commit()
    _sync_meeting_calendar_attendees(db, m)

    # Re-fetch full meeting
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == id).first()

    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}

# ─── SYNC MEETING (Zoom / Google Meet) ───────────────────
@router.post("/{id}/sync")
def sync_meeting(id: int, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Sync a meeting: fetch transcript and generate AI summary from Zoom/Google Meet."""
    m = _get_active_meeting(db, id)

    if not m.meeting_url and not (m.transcript and m.transcript.strip()):
        raise HTTPException(400, "Cuộc họp không có link hoặc nội dung transcript. Không thể đồng bộ.")

    platform = (m.platform or "").lower()
    meeting_info = {
        "title": m.title,
        "date": m.meeting_date.isoformat() if m.meeting_date else "",
        "meeting_date": m.meeting_date,
        "start_time": m.start_time,
        "duration": None,
        "transcript": m.transcript,
        "status": m.status,
    }
    if m.start_time and m.end_time:
        start_dt = datetime.datetime.combine(datetime.date.today(), m.start_time)
        end_dt = datetime.datetime.combine(datetime.date.today(), m.end_time)
        meeting_info["duration"] = int((end_dt - start_dt).total_seconds() / 60)

    # If this meeting was already summarized once by the n8n pipeline, its
    # Google Sheet tab is a durable backup of that exact summary — prefer
    # restoring from there over paying to regenerate a different one via the
    # app's own AI call. Falls through to the normal sync below if there's no
    # such backup, or the Sheet read fails (e.g. scope not granted yet).
    sheet_tab = None
    if isinstance(m.ai_summary, dict):
        sheet_tab = (m.ai_summary.get("n8n_metadata") or {}).get("sheet_row_id")
    result = None
    if sheet_tab:
        from ..services.meeting_sync import fetch_summary_from_sheet
        sheet_summary = fetch_summary_from_sheet(db, current_user.id, sheet_tab)
        if sheet_summary:
            result = {"summary": sheet_summary, "status": "DONE"}

    if result is None:
        try:
            if "zoom" in platform and m.meeting_url:
                from ..services.meeting_sync import sync_zoom_meeting
                result = sync_zoom_meeting(m.meeting_url, meeting_info)
            elif ("google" in platform or "meet" in platform) and m.meeting_url:
                from ..services.meeting_sync import sync_google_meet
                workspace_id = _host_workspace_id_for_meeting(db, m)
                result = sync_google_meet(db, current_user.id, m.meeting_url, meeting_info, workspace_id)
            elif m.transcript and m.transcript.strip():
                from ..services.meeting_sync import summarize_with_ai
                summary = summarize_with_ai(m.transcript, meeting_info)
                result = {"transcript": m.transcript, "summary": summary, "status": "DONE"}
            else:
                raise HTTPException(400, f"Nền tảng '{m.platform}' chưa được hỗ trợ đồng bộ tự động.")
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            logger.error(f"Sync meeting {id} failed: {e}")
            raise HTTPException(500, f"Lỗi đồng bộ cuộc họp: {str(e)}")

    # Update meeting with sync results — merges onto existing ai_summary rather
    # than overwriting, so a manual re-sync doesn't wipe n8n-sourced metadata
    # (video_link/team_name/participant_count/is_auto_created). See
    # apply_sync_result_to_meeting's docstring for the full reasoning.
    from ..services.meeting_sync import apply_sync_result_to_meeting
    apply_sync_result_to_meeting(m, result)
    if result.get("status") == "DONE":
        logger.warning(
            "MEETING_STATUS_DONE",
            extra={"meeting_id": m.id, "source": "manual_sync_endpoint", "organizer": m.organizer_google_email},
        )
        m.status = "DONE"

    db.commit()

    # Trigger Telegram Notification after sync
    try:
        from ..services.telegram import send_meeting_notification
        send_meeting_notification(db, m)
    except Exception as e:
        logger.warning(f"Failed to send Telegram notification for synced meeting {m.id}: {e}")

    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}


# ─── GOOGLE OAUTH — Connect/Disconnect/Status ───────────
@router.get("/google/status")
def google_status(workspace: str = None, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Check if Google Calendar/Drive is connected. Pass ?workspace=<code> to
    strictly check that workspace's own connected account override (no fallback
    to the shared account), instead of the default global connection check."""
    if workspace:
        from ..services.meeting_sync import is_workspace_google_connected
        ws = resolve_workspace(db, workspace)
        if not ws:
            raise HTTPException(404, f"Không tìm thấy workspace '{workspace}'")
        return is_workspace_google_connected(db, ws.id)

    from ..services.meeting_sync import is_google_connected
    return {"connected": is_google_connected(db, current_user.id)}


@router.get("/google/auth")
def google_auth_url(workspace: str = None, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Generate Google OAuth2 authorization URL. Pass ?workspace=<code> to connect
    a Google account that overrides the shared one for just that workspace (e.g.
    ?workspace=infra) instead of replacing the default shared account."""
    from ..config import settings
    client_id = settings.GOOGLE_CLIENT_ID
    client_secret = settings.GOOGLE_CLIENT_SECRET
    if not client_id or not client_secret:
        raise HTTPException(400, "Thiếu GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET trong .env")

    from google_auth_oauthlib.flow import Flow
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=[
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/drive.readonly",
            # Narrow write scope (not the broad "drive" scope) — added
            # 2026-09-12 so a workspace-connected account can be used to
            # upload Meeting Host Bot recordings (see
            # routers/meeting_bot.py's /drive-token). "drive.file" only
            # lets this app see/manage files IT creates, not the account's
            # whole Drive — sufficient since we only ever create new files.
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/meetings.space.readonly",
            "https://www.googleapis.com/auth/spreadsheets.readonly",
        ],
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )
    state = str(current_user.id)
    if workspace:
        ws = resolve_workspace(db, workspace)
        if not ws:
            raise HTTPException(404, f"Không tìm thấy workspace '{workspace}'")
        state = f"{current_user.id}:{ws.id}"
    auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline", state=state)
    return {"auth_url": auth_url}





# ─── PUSH MEETING AI RECOMMENDED TASKS INTO PROJECT ───────
@router.post("/{id}/push-tasks")
def push_meeting_tasks(id: int, body: dict, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Push AI recommended meeting tasks into Project/AITaskInbox."""
    m = _get_active_meeting(db, id)

    tasks_data = body.get("tasks", [])
    if not isinstance(tasks_data, list) or not tasks_data:
        raise HTTPException(400, "Vui lòng cung cấp danh sách task cần push")

    pushed_count = 0
    from ..models.ai_task_inbox import AITaskInbox
    from ..models.project import Project
    from ..models.member import Member
    from ..models.phase import Phase
    from ..models.task_group import TaskGroup
    from ..services.meeting_score_engine import recalculate_meeting_score

    # Track pushed items back onto ai_summary.recommended_tasks so the score
    # engine (and the UI) can tell which action items are already staged.
    recommended_tasks = []
    if isinstance(m.ai_summary, dict):
        recommended_tasks = list(m.ai_summary.get("recommended_tasks") or [])
    pushed_index_by_detail = {
        str(t.get("detail_task") or t.get("title") or t.get("name") or "").strip(): idx
        for idx, t in enumerate(recommended_tasks)
        if isinstance(t, dict)
    }

    for item in tasks_data:
        detail_task = str(item.get("detail_task") or item.get("title") or item.get("name") or "").strip()
        if not detail_task:
            continue

        existing_idx = pushed_index_by_detail.get(detail_task)
        if existing_idx is not None and recommended_tasks[existing_idx].get("ai_task_inbox_id"):
            # Already pushed once — skip to avoid duplicate AITaskInbox rows.
            continue

        project_id = item.get("project_id") or m.project_id
        if not project_id and item.get("project_name"):
            p_obj = db.query(Project).filter(Project.name.ilike(str(item["project_name"]).strip())).first()
            if p_obj:
                project_id = p_obj.id

        if not project_id:
            first_p = db.query(Project).first()
            if first_p:
                project_id = first_p.id

        if not project_id:
            continue

        def _find_member_by_name(name: str):
            mb = db.query(Member).filter(Member.display_name.ilike(name)).first()
            if not mb:
                mb = db.query(Member).filter(Member.full_name.ilike(name)).first()
            return mb

        assigned_id = item.get("assigned_id")
        assigned_name = item.get("assigned_name") or item.get("member_name") or item.get("owner")
        support_id = item.get("support_id")
        if not assigned_id and assigned_name:
            # assigned_name may list multiple people separated by commas (AI
            # allows a primary + secondary owner) — first name becomes the
            # main assignee, second becomes support, matching how the rest of
            # the app models a task's people (assigned_id + support_id).
            names = [n.strip() for n in str(assigned_name).split(",") if n.strip()]
            if names:
                mb = _find_member_by_name(names[0])
                if mb:
                    assigned_id = mb.id
            if not support_id and len(names) > 1:
                mb2 = _find_member_by_name(names[1])
                if mb2:
                    support_id = mb2.id

        # Phase / "Task cha" (TaskGroup) — where in the project plan this task
        # belongs. Re-validate against the DB rather than trusting the client
        # blindly, since a stale/mismatched id would silently misfile the task
        # under the wrong project's plan.
        phase_id = item.get("phase_id")
        if phase_id:
            ph = db.query(Phase).filter(Phase.id == phase_id, Phase.project_id == project_id).first()
            phase_id = ph.id if ph else None

        task_group_id = item.get("task_group_id")
        if task_group_id:
            tg = db.query(TaskGroup).filter(TaskGroup.id == task_group_id, TaskGroup.phase_id == phase_id).first()
            task_group_id = tg.id if tg else None

        inbox_task = AITaskInbox(
            project_id=project_id,
            meeting_id=m.id,
            source_platform=m.platform or "Meeting AI",
            source_group_name=m.title or "Cuộc họp",
            source_message=f"[Meeting: {m.title}] {detail_task}",
            detail_task=detail_task,
            # task_description flows into Task.notes when this inbox row gets
            # imported (see chat_ai.py's import endpoint) — the natural home
            # for KPI/Output text, which has no dedicated column of its own.
            task_description=item.get("kpi_output") or None,
            phase_id=phase_id,
            task_group_id=task_group_id,
            priority=item.get("priority", "Normal"),
            assigned_id=assigned_id,
            assigned_name=assigned_name,
            support_id=support_id,
            acceptance_criteria=f"Hạn hoàn thành: {item.get('deadline', 'Chưa xác định')}",
            status="PENDING",
            manday_est=float(item.get("manday_est", 1.0)),
        )
        db.add(inbox_task)
        db.flush()
        pushed_count += 1

        # Push chuẩn 1 lần: tạo luôn Task thật trong Phase/Task cha, không bắt
        # người dùng phải qua tab "AI Task Inbox" bấm Import thêm 1 bước nữa —
        # logic dưới đây mirror y hệt chat_ai.py::import_inbox_task_to_project_plan,
        # chỉ khác là chạy trong cùng transaction/commit với push này.
        imported_task_id = None
        task_code = None
        try:
            # Phase/TaskGroup đã validate ở trên; nếu người dùng chưa chọn thì
            # fallback về Phase/TaskGroup đầu tiên của project (tạo mới nếu
            # project chưa có cái nào) — cùng hành vi với import thủ công.
            import_phase = None
            if phase_id:
                import_phase = db.query(Phase).filter(Phase.id == phase_id).first()
            if not import_phase:
                import_phase = db.query(Phase).filter(Phase.project_id == project_id).order_by(Phase.sort_order).first()
                if not import_phase:
                    import_phase = Phase(project_id=project_id, name="Master", sort_order=1)
                    db.add(import_phase)
                    db.flush()
                inbox_task.phase_id = import_phase.id

            import_tg = None
            if task_group_id:
                import_tg = db.query(TaskGroup).filter(TaskGroup.id == task_group_id, TaskGroup.phase_id == import_phase.id).first()
            if not import_tg:
                import_tg = db.query(TaskGroup).filter(TaskGroup.phase_id == import_phase.id).order_by(TaskGroup.sort_order).first()
                if not import_tg:
                    import_tg = TaskGroup(phase_id=import_phase.id, name="General Tasks", status="Waiting")
                    db.add(import_tg)
                    db.flush()
                inbox_task.task_group_id = import_tg.id

            from ..models.task import Task
            from ..models.skill_master import Skill, Group
            from ..utils.kpi_engine import parse_date, calc_end_date_est, recalculate_task
            from ..utils.skill_validation import validate_skill_area_consistency

            existing_count = db.query(Task).filter(Task.task_group_id == inbox_task.task_group_id).count()
            task_code = f"T{inbox_task.task_group_id}.{existing_count + 1}"

            parsed_start_date = parse_date(item.get("start_date"))
            end_date_est_val = calc_end_date_est(parsed_start_date, inbox_task.manday_est) if parsed_start_date else None

            # skill_solution_id/skill_vendor_id là NOT NULL trên Task — meeting
            # không phải lúc nào cũng có (fallback về Group/Skill đầu tiên,
            # giống hệt cách import_inbox_task_to_project_plan xử lý).
            skill_solution_id = item.get("skill_solution_id")
            skill_vendor_id = item.get("skill_vendor_id")
            if not skill_solution_id:
                fallback_group = db.query(Group).order_by(Group.id.asc()).first()
                skill_solution_id = fallback_group.id if fallback_group else None
            if not skill_vendor_id and skill_solution_id:
                # Fallback Skill phải thuộc đúng Group (kể cả Group cũng là
                # fallback) ở trên, không phải Skill đầu tiên bất kỳ trong DB.
                fallback_skill = db.query(Skill).filter(Skill.group_id == skill_solution_id).order_by(Skill.id.asc()).first()
                skill_vendor_id = fallback_skill.id if fallback_skill else None
            validate_skill_area_consistency(skill_solution_id, skill_vendor_id, db)

            new_task = Task(
                task_group_id=inbox_task.task_group_id,
                task_code=task_code,
                detail=inbox_task.detail_task or "Task từ cuộc họp",
                priority=inbox_task.priority or "Normal",
                manday_est=inbox_task.manday_est,
                status="Waiting",
                assigned_id=inbox_task.assigned_id,
                support_id=inbox_task.support_id,
                kpi_ratio_assign=100,
                kpi_ratio_support=0,
                skill_solution_id=skill_solution_id,
                skill_vendor_id=skill_vendor_id,
                remark=inbox_task.acceptance_criteria,
                notes=inbox_task.task_description,
                start_date=parsed_start_date,
                end_date_est=end_date_est_val,
            )
            db.add(new_task)
            db.flush()
            recalculate_task(new_task, db)

            inbox_task.status = "IMPORTED"
            inbox_task.imported_task_id = new_task.id
            imported_task_id = new_task.id
        except Exception:
            # Không chặn cả lần push chỉ vì 1 task tạo Task thật thất bại — nó
            # vẫn còn nguyên trong AI Task Inbox để import lại thủ công sau.
            logger.exception("Auto-import sau push thất bại cho task '%s'", detail_task)

        record = {
            **item,
            "detail_task": detail_task,
            "ai_task_inbox_id": inbox_task.id,
            "imported_task_id": imported_task_id,
            "task_code": task_code,
            "pushed_at": datetime.datetime.utcnow().isoformat(),
        }
        if existing_idx is not None:
            recommended_tasks[existing_idx] = record
        else:
            recommended_tasks.append(record)
            pushed_index_by_detail[detail_task] = len(recommended_tasks) - 1

    if isinstance(m.ai_summary, dict):
        m.ai_summary = {**m.ai_summary, "recommended_tasks": recommended_tasks}
    recalculate_meeting_score(m, db)
    db.commit()
    return {"success": True, "pushed_count": pushed_count, "message": f"Đã push {pushed_count} task vào Project thành công!"}


# ─── MEETING INTELLIGENCE: SCORE / FEEDBACK / AI COPILOT / INSIGHTS ───
@router.post("/{id}/recalculate-score")
def recalculate_score(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from ..services.meeting_score_engine import recalculate_meeting_score
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")
    recalculate_meeting_score(m, db)
    db.commit()
    db.refresh(m)
    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}


@router.post("/{id}/feedback")
def submit_meeting_feedback(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from ..models.meeting_feedback import MeetingFeedback
    from ..services.meeting_score_engine import recalculate_meeting_score

    m = _get_active_meeting(db, id)

    if "helpful" not in body:
        raise HTTPException(400, "Thiếu trường 'helpful'")

    member_id = None
    if current_user and getattr(current_user, "email", None):
        member = db.query(Member).filter(Member.email.ilike(current_user.email)).first()
        if member:
            member_id = member.id

    existing = None
    if member_id:
        existing = db.query(MeetingFeedback).filter(
            MeetingFeedback.meeting_id == id, MeetingFeedback.member_id == member_id
        ).first()

    if existing:
        existing.helpful = bool(body.get("helpful"))
        existing.comment = body.get("comment", existing.comment)
    else:
        db.add(MeetingFeedback(
            meeting_id=id,
            member_id=member_id,
            helpful=bool(body.get("helpful")),
            comment=body.get("comment"),
        ))

    db.flush()
    recalculate_meeting_score(m, db)
    db.commit()
    return {"success": True, "score_feedback": m.score_feedback, "score_total": m.score_total}


@router.post("/generate-ai-content")
def generate_ai_meeting_content(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """AI Meeting Copilot — drafts objective + agenda from the meeting title/project."""
    from ..services.ai_client import chat_completion_json, AiClientError

    title = str(body.get("title") or "").strip()
    project_name = str(body.get("project_name") or body.get("project") or "").strip()
    if not title:
        raise HTTPException(400, "Cần tên cuộc họp để AI đề xuất nội dung")

    system_prompt = (
        "Bạn là trợ lý soạn thảo cuộc họp cho một công ty công nghệ Việt Nam.\n"
        "Dựa trên tên cuộc họp và dự án liên quan, hãy đề xuất mục tiêu & kết quả mong đợi, "
        "và agenda/vấn đề cần xử lý — NGẮN GỌN, mỗi mục là MỘT DÒNG duy nhất, TUYỆT ĐỐI KHÔNG viết "
        "đoạn văn dài hay giải thích thêm sau mỗi mục.\n"
        "BẮT BUỘC: Trả về JSON duy nhất, đúng cấu trúc:\n"
        "{\n"
        '  "goal": "<danh sách đánh số dạng \'1. ...\\n2. ...\', TỐI ĐA 3 mục, mỗi mục khoảng 8-12 từ>",\n'
        '  "agenda": "<danh sách đánh số dạng \'1. ...\\n2. ...\', TỐI ĐA 5-6 mục, mỗi mục khoảng 8-15 từ>"\n'
        "}\n"
        "Ví dụ goal ĐÚNG (ngắn gọn, mỗi mục 1 ý cụ thể):\n"
        "1. Cập nhật tiến độ dự án\n"
        "2. Xác định vấn đề còn tồn đọng\n"
        "3. Thống nhất kế hoạch tiếp theo\n"
        "Ví dụ goal SAI (câu dài, giải thích lan man) — KHÔNG được viết kiểu này:\n"
        "\"Mục tiêu của cuộc họp là tiến hành đánh giá một cách toàn diện tình hình triển khai dự án "
        "trong thời gian vừa qua, đồng thời xác định những khó khăn...\"\n"
        "Không bọc trong ```json hay ``` ở kết quả."
    )
    user_content = f"Tên cuộc họp: {title}\nDự án liên quan: {project_name or 'Chưa xác định'}"

    try:
        result = chat_completion_json(system_prompt, user_content)
    except AiClientError as e:
        raise HTTPException(400, f"AI đề xuất thất bại: {e}")

    return {"success": True, "goal": result.get("goal", ""), "agenda": result.get("agenda", "")}


# ─── INTERNAL GOOGLE HEALTH CHECK ENDPOINT (SPEC CHAPTER 06) ───
@router.get("/internal/health/google")
def google_health_check(db: Session = Depends(get_db)):
    """Health check endpoint to monitor Google Refresh Token & API access status per Spec Chapter 06."""
    from ..services.meeting_sync import get_shared_google_access_token
    try:
        token = get_shared_google_access_token(db)
        import requests
        resp = requests.get(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5
        )
        if resp.ok:
            return {"status": "ok", "message": "Google Calendar API token is active and healthy."}
        return {"status": "error", "message": f"Google Calendar API returned status code {resp.status_code}"}
    except Exception as e:
        return {"status": "error", "message": f"Google token health check failed: {str(e)}"}


# ─── RETRY LINK CREATION ENDPOINT (SPEC CHAPTER 06) ───────────
@router.post("/{id}/retry-link")
def retry_meeting_link(id: int, body: Optional[dict] = None, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Regenerate the Google Meet link for a meeting — this is the ONLY
    server-side path allowed to change organizer_google_email after creation
    (chốt 2026-09-13): PUT /{id} no longer accepts it, precisely so a real
    organizer reassignment always goes through an actual new Calendar event
    here, never as a side effect of an unrelated field edit.

    Optional body.host_workspace_id (chốt 2026-09-14 Edit-lifecycle rules):
    this is also the mechanism the Edit form's "HOST *" dropdown uses under
    the hood when the user picks a different Host for an UPCOMING meeting —
    changing Host can only ever mean generating a brand-new Calendar event
    under the new account (Calendar has no "reassign organizer" operation on
    an existing event), so it must go through the exact same path as a plain
    manual retry, never a separate one. Omitted, this behaves exactly as
    before (auto-resolve via the project's Workspace)."""
    body = body or {}
    m = _get_active_meeting(db, id)
    # Status guard (chốt 2026-09-13, tightened 2026-09-14): only a genuinely
    # not-yet-started UPCOMING meeting may regenerate — compute_display_status
    # catches the live-ONGOING window that a bare m.status check misses
    # (ONGOING is never persisted). Reassigning the organizer while live risks
    # the Meeting Host Bot being live in the OLD organizer's session — its
    # eventual actual-end report (POST /api/meeting-bot/ended) would then
    # carry the stale google_email, get rejected (403, organizer mismatch),
    # and the extension does not retry on 403 — permanently stranding the
    # meeting at ONGOING. DONE/CANCELLED meetings have no legitimate reason to
    # regenerate a link at all.
    if m.status != "UPCOMING" or compute_display_status(m) == "ĐANG DIỄN RA":
        raise HTTPException(
            400,
            f"Chỉ có thể tạo lại link Google Meet khi cuộc họp chưa bắt đầu (SẮP TỚI) "
            f"(hiện tại: {compute_display_status(m)}).",
        )
    # Platform guard (added 2026-09-14 after a real frontend bug briefly
    # called this endpoint for a Zoom meeting): this endpoint only ever
    # creates a Google Calendar event — calling it for a non-Google-Meet
    # meeting would silently replace its real join link (e.g. a Zoom URL)
    # with a bogus Google Meet one. Server-side backstop regardless of what
    # any current or future frontend code does.
    if (m.platform or "").strip().lower() not in ("google meet", "google"):
        raise HTTPException(400, f"Không thể tạo lại link Google Meet cho nền tảng '{m.platform}'.")
    if not m.meeting_date or not m.start_time:
        raise HTTPException(400, "Cuộc họp cần có ngày và giờ bắt đầu trước khi tạo lại link")

    dur_mins = 60
    if m.start_time and m.end_time:
        start_mins = m.start_time.hour * 60 + m.start_time.minute
        end_mins = m.end_time.hour * 60 + m.end_time.minute
        if end_mins < start_mins:
            end_mins += 24 * 60
        dur_mins = max(end_mins - start_mins, 1)
    start_datetime = f"{m.meeting_date.isoformat()}T{m.start_time.strftime('%H:%M')}:00Z"

    from ..services.meeting_sync import create_google_meet_link
    meeting_proj = db.query(Project).filter(Project.id == m.project_id).first() if m.project_id else None
    workspace_id = _resolve_host_workspace_id(db, body, workspace_id_for_project(db, meeting_proj))
    try:
        link_data = create_google_meet_link(db, current_user.id, m.title or "Cuộc họp", start_datetime, dur_mins, workspace_id=workspace_id)
    except ValueError as e:
        # Same shape as /generate-link's own handling — a clean 400 instead of
        # an unhandled 500. No fields on `m` have been touched yet at this
        # point, so the meeting row is guaranteed untouched (chốt 2026-09-13:
        # "Google API fail → DB không đổi").
        raise HTTPException(400, str(e))
    if not link_data or not link_data.get("join_url"):
        raise HTTPException(500, "Không thể tạo lại link Google Meet")

    new_organizer = link_data.get("organizer_google_email")
    # Check the NEW organizer's schedule before committing — reassigning to an
    # account that's already busy at this exact slot is exactly the conflict
    # this whole rule exists to prevent.
    _check_organizer_time_conflict(db, new_organizer, m.meeting_date, m.start_time, m.end_time, exclude_meeting_id=m.id)

    m.meeting_url = link_data["join_url"]
    m.google_event_id = link_data.get("id") or m.google_event_id
    m.organizer_google_email = new_organizer or m.organizer_google_email
    db.commit()
    db.refresh(m)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Meeting", entity_type="Meeting",
        entity_id=id, action="UPDATE", project_id=m.project_id, resource_name=m.title,
        description=f"Tạo lại link Google Meet, đổi organizer sang {new_organizer or '(không đổi)'}"
    )
    db.commit()
    # New Calendar event starts with zero attendees (create_google_meet_link
    # always creates with attendees_emails=[]) — re-apply the existing
    # participant list as guests on this fresh event.
    _sync_meeting_calendar_attendees(db, m)
    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}


# ─── N8N INTEGRATION WEBHOOK SCHEMAS & ENDPOINT ───────────────
def _sanitize_meeting_join_url(url: Optional[str]) -> Optional[str]:
    """meeting_url must be a join link (meet.google.com/zoom.us/...), never a Google
    Drive file link. The n8n pipeline falls back to the Drive recording link
    (`realMeetUrl || videoLink`) when it can't match the real Meet link via
    Calendar, which would otherwise silently corrupt the join link shown in the
    app (e.g. the "Vào họp" button opening a Drive page instead of the meeting).
    Reject Drive links defensively rather than trust the payload."""
    if not url:
        return url
    if "drive.google.com" in url.lower():
        logger.warning(f"n8n webhook: rejected meeting_url that looks like a Drive link, not a join link: {url}")
        return None
    return url


class N8nMeetingSummaryPayload(BaseModel):
    meeting_id: Optional[int] = None
    meeting_url: Optional[str] = None
    meeting_code: Optional[str] = None
    # The Drive recording playback link — distinct from meeting_url (the
    # meet.google.com JOIN link, used before/during the call). Stored in
    # ai_summary rather than a dedicated column since it's display-only
    # metadata alongside team_name/organizer_name, which already live there.
    video_link: Optional[str] = None
    title: str = Field(..., min_length=1)
    meeting_date: str
    start_time: Optional[str] = "09:00"
    end_time: Optional[str] = None
    duration_minutes: Optional[float] = None
    platform: Optional[str] = "Google Meet"
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    creator_email: Optional[str] = None
    creator_name: Optional[str] = None
    transcript: Optional[str] = None
    executive_summary: Optional[str] = None
    decisions: Optional[List[str]] = Field(default_factory=list)
    issues: Optional[List[str]] = Field(default_factory=list)
    next_steps: Optional[List[str]] = Field(default_factory=list)
    recommended_tasks: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    team_name: Optional[str] = None
    organizer_name: Optional[str] = None
    participant_count: Optional[int] = None
    sheet_row_id: Optional[str] = None


@router.post("/webhook/n8n-summary")
def ingest_n8n_meeting_summary(
    payload: N8nMeetingSummaryPayload,
    db: Session = Depends(get_db),
    x_n8n_webhook_secret: Optional[str] = Header(None, alias="X-N8N-Webhook-Secret")
):
    """
    Ingest Meeting Summary from Google Sheet / n8n workflow.
    Validates secret, normalizes summary data, idempotently matches/updates or creates meeting,
    and preserves existing manual Project/Creator assignments.
    """
    from ..config import settings
    configured_secret = (settings.N8N_WEBHOOK_SECRET or "").strip()
    if configured_secret:
        if not x_n8n_webhook_secret or x_n8n_webhook_secret.strip() != configured_secret:
            logger.warning("n8n webhook authentication failed: invalid or missing secret header.")
            raise HTTPException(status_code=401, detail="X-N8N-Webhook-Secret không hợp lệ hoặc bị thiếu.")

    # 1. Parse dates and times
    try:
        meeting_date = parse_date(payload.meeting_date)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Ngày họp không hợp lệ (yêu cầu YYYY-MM-DD): {payload.meeting_date}")

    start_time = None
    if payload.start_time:
        try:
            start_time = parse_time(payload.start_time)
        except Exception:
            start_time = datetime.time(9, 0)
    else:
        start_time = datetime.time(9, 0)

    end_time = None
    if payload.end_time:
        try:
            end_time = parse_time(payload.end_time)
        except Exception:
            pass
    # Recording pipelines often only know the duration (from the transcribed
    # audio), not a wall-clock end time — derive one so "Thời lượng" on the
    # web matches the Sheet's duration column instead of staying unset.
    if not end_time and payload.duration_minutes and start_time:
        start_dt = datetime.datetime.combine(datetime.date.today(), start_time)
        end_time = (start_dt + datetime.timedelta(minutes=payload.duration_minutes)).time()

    clean_title = (payload.title or "").strip()
    if not clean_title:
        raise HTTPException(status_code=422, detail="Tiêu đề cuộc họp không được để trống.")

    # 2. Normalize AI Summary structure
    norm_summary = {
        "executive_summary": payload.executive_summary or "",
        "decisions": payload.decisions or [],
        "issues": payload.issues or [],
        "next_steps": payload.next_steps or [],
        "recommended_tasks": payload.recommended_tasks or [],
        "team_name": payload.team_name or "",
        "organizer_name": payload.organizer_name or "",
        "participant_count": payload.participant_count,
        "video_link": payload.video_link or "",
        "source": "n8n_google_sheet",
        "n8n_metadata": {
            "sheet_row_id": payload.sheet_row_id,
            "ingested_at": datetime.datetime.now().isoformat()
        }
    }

    # 3. Project auto-mapping
    mapped_project_id = None
    if payload.project_id:
        proj = db.query(Project).filter(Project.id == payload.project_id).first()
        if proj:
            mapped_project_id = proj.id
    elif payload.project_name and payload.project_name.strip():
        proj = db.query(Project).filter(Project.name.ilike(payload.project_name.strip())).first()
        if proj:
            mapped_project_id = proj.id

    # 4. Creator auto-mapping
    mapped_creator_id = None
    if payload.creator_email and payload.creator_email.strip():
        mb = db.query(Member).filter(Member.email.ilike(payload.creator_email.strip())).first()
        if mb:
            mapped_creator_id = mb.id
    elif payload.creator_name and payload.creator_name.strip():
        mb = db.query(Member).filter(Member.display_name.ilike(payload.creator_name.strip())).first()
        if not mb:
            mb = db.query(Member).filter(Member.full_name.ilike(payload.creator_name.strip())).first()
        if mb:
            mapped_creator_id = mb.id

    # 5. Idempotent Meeting Matcher
    matched_meeting = None

    # Priority 1: Match by ID
    if payload.meeting_id:
        matched_meeting = db.query(Meeting).filter(Meeting.id == payload.meeting_id).first()

    # Priority 2: Match by meeting_url or meeting_code
    if not matched_meeting and (payload.meeting_url or payload.meeting_code):
        url_query = payload.meeting_url or payload.meeting_code
        code_match = re.search(r"([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})", url_query, re.I)
        if code_match:
            code_str = code_match.group(1)
            matched_meeting = db.query(Meeting).filter(Meeting.meeting_url.ilike(f"%{code_str}%")).first()
        else:
            matched_meeting = db.query(Meeting).filter(Meeting.meeting_url == url_query.strip()).first()

    # Priority 3: Match by title + meeting_date ONLY if exactly 1 record matches
    if not matched_meeting and clean_title and meeting_date:
        candidates = db.query(Meeting).filter(
            Meeting.title.ilike(clean_title),
            Meeting.meeting_date == meeting_date
        ).all()

        if len(candidates) == 1:
            matched_meeting = candidates[0]
        elif len(candidates) > 1:
            logger.warning(
                f"n8n webhook: Match title '{clean_title}' on {meeting_date} is ambiguous ({len(candidates)} records found). "
                f"Skipping auto-update to avoid corrupting wrong meeting."
            )

    # 6. Execute Upsert
    if matched_meeting:
        # UPDATE existing meeting
        if payload.transcript and payload.transcript.strip():
            matched_meeting.transcript = payload.transcript.strip()
        # Preserve whatever origin the meeting already had — updating via webhook
        # doesn't change whether a human created it on the web or n8n auto-created it.
        existing_auto_created = False
        if isinstance(matched_meeting.ai_summary, dict):
            existing_auto_created = bool(matched_meeting.ai_summary.get("is_auto_created"))
        norm_summary["is_auto_created"] = existing_auto_created
        matched_meeting.ai_summary = norm_summary
        # NOTE (chốt 2026-09-13): no longer sets matched_meeting.status here.
        # Meeting lifecycle (UPCOMING/ONGOING/DONE) and the n8n processing
        # pipeline are independent — n8n finishing its AI summary does not by
        # itself prove the Meeting is DONE (see Meeting Host Bot's actual-end
        # report, POST /api/meeting-bot/ended, which is now the only thing
        # that sets DONE for a web-created meeting). A meeting can very
        # reasonably still be ONGOING while n8n has already produced a
        # summary for an earlier portion, or n8n can complete well after the
        # Bot already marked it DONE — either order is fine, this webhook
        # only ever touches transcript/ai_summary/date/time/link.

        # Preserve existing assignments: only update if currently NULL and new mapping exists
        if matched_meeting.project_id is None and mapped_project_id is not None:
            matched_meeting.project_id = mapped_project_id
        if matched_meeting.created_by is None and mapped_creator_id is not None:
            matched_meeting.created_by = mapped_creator_id

        # The webhook carries the actual recording's date/time/link — more
        # authoritative than whatever placeholder was set when the meeting was
        # first scheduled in the app. Without this, the "Bản Tóm Tắt AI Chi Tiết"
        # card keeps showing the stale scheduled time/link instead of the real
        # recording (e.g. "60 phút" default duration, old Meet join link).
        matched_meeting.meeting_date = meeting_date
        matched_meeting.start_time = start_time
        if end_time:
            matched_meeting.end_time = end_time
        sanitized_meeting_url = _sanitize_meeting_join_url(payload.meeting_url)
        if sanitized_meeting_url:
            matched_meeting.meeting_url = sanitized_meeting_url

        db.commit()
        db.refresh(matched_meeting)

        AuditService.record(
            db=db,
            user_id=None,
            module="Meeting",
            entity_type="Meeting",
            entity_id=matched_meeting.id,
            action="UPDATE",
            project_id=matched_meeting.project_id,
            description=f"Cập nhật Meeting Summary từ n8n cho cuộc họp '{matched_meeting.title}'"
        )
        db.commit()

        logger.info(f"n8n webhook: Updated existing meeting id={matched_meeting.id} title='{matched_meeting.title}'")
        return {
            "success": True,
            "action": "updated",
            "meeting_id": matched_meeting.id,
            "message": f"Đã cập nhật Meeting Summary cho cuộc họp #{matched_meeting.id}"
        }

    else:
        # CREATE new meeting (strict check minimum required fields)
        # No existing web-created meeting matched this recording — n8n is creating
        # this meeting from scratch, so flag it as such for the UI to distinguish.
        norm_summary["is_auto_created"] = True
        logger.warning(
            "MEETING_STATUS_DONE",
            extra={
                "meeting_id": None,
                "meeting_title": clean_title,
                "source": "n8n_webhook.create_new_meeting",
                "sheet_row_id": payload.sheet_row_id,
            },
        )
        new_m = Meeting(
            title=clean_title,
            description=f"Tự động tạo từ n8n (Row ID: {payload.sheet_row_id or 'N/A'})",
            platform=payload.platform or "Google Meet",
            meeting_url=_sanitize_meeting_join_url(payload.meeting_url),
            meeting_date=meeting_date,
            start_time=start_time,
            end_time=end_time,
            status="DONE",
            transcript=payload.transcript,
            ai_summary=norm_summary,
            project_id=mapped_project_id,
            created_by=mapped_creator_id
        )
        db.add(new_m)
        db.commit()
        db.refresh(new_m)

        AuditService.record(
            db=db,
            user_id=None,
            module="Meeting",
            entity_type="Meeting",
            entity_id=new_m.id,
            action="CREATE",
            project_id=new_m.project_id,
            description=f"Tạo cuộc họp mới từ n8n Summary '{new_m.title}'"
        )
        db.commit()

        logger.info(f"n8n webhook: Created new meeting id={new_m.id} title='{new_m.title}'")
        return {
            "success": True,
            "action": "created",
            "meeting_id": new_m.id,
            "message": f"Đã tạo cuộc họp mới #{new_m.id} từ n8n Summary"
        }

