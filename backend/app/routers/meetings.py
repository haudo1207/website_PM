from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from typing import Optional, List, Dict, Any
import datetime
import logging
import re
from zoneinfo import ZoneInfo

from ..database import get_db
from ..models.meeting import Meeting, MeetingMember
from ..models.project import Project
from ..models.member import Member
from ..utils.auth import get_current_user
from ..utils.access import ALL_SCOPE, WRITE_ROLES, has_full_project_access, project_belongs_to_workspace, project_query_for_user, require_project, require_route_project_access, resolve_workspace, user_scope, workspace_id_for_project
from ..utils.audit_service import AuditService

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


_VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def _now_vn() -> datetime.datetime:
    """Naive Vietnam wall-clock 'now' — meeting_date/start_time/end_time are
    always stored as naive Vietnam local values (see create_google_meet_link),
    never UTC. Plain datetime.datetime.now() would silently use the SERVER's
    OS timezone instead (UTC in this deployment, ~7h behind Vietnam), making
    meetings that already started/ended still show as upcoming for hours."""
    return datetime.datetime.now(_VN_TZ).replace(tzinfo=None)


def compute_display_status(m: Meeting) -> str:
    """Meeting status architecture (chốt kiến trúc):
      SẮP TỚI      -> now < start_time
      ĐANG DIỄN RA -> start_time <= now < end_time
      ĐÃ KẾT THÚC  -> now >= end_time
    Computed live from meeting_date/start_time/end_time so the badge is
    always accurate regardless of the background auto-sync loop's cadence.
    CANCELLED is a manual state and always wins over the time computation;
    falls back to the stored status when date/time isn't fully set (can't compute).
    """
    if m.status == "CANCELLED":
        return "ĐÃ HỦY"
    if m.meeting_date and m.start_time and m.end_time:
        start_dt = datetime.datetime.combine(m.meeting_date, m.start_time)
        end_dt = datetime.datetime.combine(m.meeting_date, m.end_time)
        if m.end_time < m.start_time:
            end_dt += datetime.timedelta(days=1)
        now = _now_vn()
        if now >= end_dt:
            return "ĐÃ KẾT THÚC"
        if now >= start_dt:
            return "ĐANG DIỄN RA"
        return "SẮP TỚI"
    return STATUS_DB_TO_FE.get(m.status, m.status)

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
    # meeting — super_admin/leader globally, or a member/viewer whose
    # project_members role for m.project_id is PM/Leader. Purely a UI hint:
    # require_route_project_access re-checks this server-side on every
    # write regardless of what this flag says, so a stale/omitted value
    # here (db/current_user not passed) just means the UI is conservative,
    # never a permission bypass.
    can_manage = False
    if current_user is not None:
        role = getattr(current_user, "role", None)
        if role in WRITE_ROLES:
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

    # Which Google account actually organizes this meeting's Meet event —
    # the workspace's own connected WorkspaceGoogleAccount if set, else the
    # workspace's expected_google_email hint, else the historical shared
    # default account. Drives the "Host" badge/join link on the FE so it
    # reflects the real per-workspace account instead of a hard-coded one.
    host_google_email = "mkt.szone@gmail.com"
    if db is not None:
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
    final_members = db_members + custom_only

    host_name = m.creator.display_name if m.creator else f"Host {host_google_email.split('@')[0]}"
    if not final_members:
        final_members = [{"display_name": host_name, "role": "Người tạo (Host)"}]
    else:
        has_host = any("Host" in str(mb.get("role", "")) or mb.get("display_name") == host_name for mb in final_members)
        if not has_host:
            final_members = [{"display_name": host_name, "role": "Người tạo (Host)"}] + final_members

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
    )
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
        q = q.filter(Meeting.project_id == project_id)
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

    # Newest-created always first — meeting_date/start_time sort was confusing
    # (a just-created meeting could land in the middle or bottom depending on
    # its scheduled date relative to others). id is monotonic on insert, so
    # this is also immune to clock skew.
    meetings = q.order_by(Meeting.id.desc()).all()
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
    meeting_date = parse_date(date_val) if date_val else datetime.date.today()
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
            from ..services.meeting_sync import create_google_meet_link, notify_n8n_meeting_created
            proj = db.query(Project).filter(Project.id == body.get("project_id")).first() if body.get("project_id") else None
            workspace_id = workspace_id_for_project(db, proj)
            result = create_google_meet_link(db, current_user.id, title, start_datetime, dur_mins, workspace_id)
            notify_n8n_meeting_created(db, result.get("mk_tag"), title, meeting_date, start_time, workspace_id)
            return {"success": True, "join_url": result["join_url"], "platform": "Google Meet"}
        except Exception as e:
            logger.error(f"Generate Google Meet link failed: {e}")
            raise HTTPException(status_code=400, detail=str(e))
    else:
        raise HTTPException(status_code=400, detail=f"Nền tảng '{platform}' chưa hỗ trợ tự động tạo link.")


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
    )
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


# ─── GET ONE ─────────────────────────────────────────────
@router.get("/{id}")
def get_meeting(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from ..models.meeting_project import MeetingProject
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member),
        joinedload(Meeting.extra_projects).joinedload(MeetingProject.project)
    ).filter(Meeting.id == id).first()
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

    status_input = str(body.get("status", "UPCOMING")).upper()
    status = STATUS_FE_TO_DB.get(status_input, status_input)
    if status not in ["UPCOMING", "ONGOING", "DONE", "CANCELLED"]:
        status = "UPCOMING"

    # Rule 02: If DONE, meeting_date must be <= today
    if status == "DONE" and meeting_date > datetime.date.today():
        raise HTTPException(400, "Cuộc họp ở trạng thái DONE không được có ngày họp lớn hơn ngày hiện tại")

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
    google_event_id = None

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
                from ..services.meeting_sync import create_google_meet_link, notify_n8n_meeting_created
                workspace_id = workspace_id_for_project(db, proj if 'proj' in locals() else None)
                result = create_google_meet_link(db, current_user.id, title, start_datetime, dur_mins, workspace_id)
                meeting_url = result["join_url"]
                google_event_id = result.get("id")
                notify_n8n_meeting_created(db, result.get("mk_tag"), title, meeting_date, start_time, workspace_id)
            except Exception as e:
                logger.error(f"Auto-generate Google Meet link failed: {e}")
                raise HTTPException(status_code=400, detail=str(e))

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
                    m.status = "DONE"
    except Exception as e:
        logger.warning(f"Auto-summarize meeting {m.id} on create failed: {e}")

    db.add(m)
    db.flush()
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

    # Push the join link to any Zalo group(s) linked to the meeting's project(s)
    try:
        from ..services.meeting_notify import notify_zalo_groups_meeting_created
        notify_zalo_groups_meeting_created(db, m)
    except Exception as e:
        logger.warning(f"Failed to send Zalo notification for meeting {m.id}: {e}")

    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}

# ─── UPDATE ──────────────────────────────────────────────
@router.put("/{id}")
def update_meeting(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

    old_dict = {"title": m.title, "status": m.status, "meeting_date": str(m.meeting_date) if m.meeting_date else None}
    old_status = m.status
    old_meeting_date = m.meeting_date
    old_start_time = m.start_time
    old_end_time = m.end_time
    status_input = str(body.get("status", m.status)).upper()
    new_status = STATUS_FE_TO_DB.get(status_input, status_input)
    if new_status not in ["UPCOMING", "ONGOING", "DONE", "CANCELLED"]:
        new_status = m.status

    # Support 'date' or 'meeting_date'
    new_date_str = body.get("meeting_date") or body.get("date")
    new_date = parse_date(new_date_str) if new_date_str else m.meeting_date

    # Rule 05: Meeting DONE -> Cannot change meeting_date
    if old_status == "DONE" and new_date != m.meeting_date:
        raise HTTPException(400, "Không thể thay đổi ngày họp của cuộc họp đã hoàn thành (DONE)")

    # Rule 02: If DONE, meeting_date must be <= today
    if new_status == "DONE" and new_date > datetime.date.today():
        raise HTTPException(400, "Cuộc họp ở trạng thái DONE không được có ngày họp lớn hơn ngày hiện tại")

    m.title = str(body.get("title", m.title)).strip()
    if not m.title:
        raise HTTPException(400, "Tiêu đề không được để trống")

    m.description = body.get("description", m.description)
    m.platform = body.get("platform", m.platform)
    m.meeting_url = body.get("meeting_url") or body.get("link") or m.meeting_url
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

    # Participants — re-selected from the edit form. Mirrors the DONE-status
    # guard on the dedicated add/remove-member endpoints below.
    member_ids_input = body.get("member_ids")
    if isinstance(member_ids_input, list) and m.status != "DONE":
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
        for mid in existing.keys() - wanted_ids:
            db.delete(existing[mid])

    from ..services.meeting_score_engine import recalculate_meeting_score
    recalculate_meeting_score(m, db)
    db.commit()
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
            meeting_proj = db.query(Project).filter(Project.id == m.project_id).first() if m.project_id else None
            workspace_id = workspace_id_for_project(db, meeting_proj)
            update_google_meet_event(db, m.google_event_id, start_iso, end_iso, workspace_id)
        except Exception as e:
            logger.warning(f"Failed to sync rescheduled time to Google Calendar for meeting {m.id}: {e}")

    return {"success": True, "data": meeting_to_dict(m, db=db, current_user=current_user)}

# ─── UPDATE TRANSCRIPT (Rule 03) ────────────────────────
@router.post("/{id}/transcript")
def update_transcript(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

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
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")
    m_title, m_project_id = m.title, m.project_id
    db.delete(m)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Meeting", entity_type="Meeting",
        entity_id=id, action="DELETE", project_id=m_project_id, resource_name=m_title,
        description=f"Xóa cuộc họp '{m_title}'"
    )
    db.commit()
    return {"message": "Đã xóa cuộc họp thành công"}

# ─── ADD MEMBER ─────────────────────────────────────────
@router.post("/{id}/members")
def add_meeting_member(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

    # Rule 05: Meeting DONE -> Cannot change participants
    if m.status == "DONE":
        raise HTTPException(400, "Không thể thay đổi người tham gia của cuộc họp đã hoàn thành (DONE)")

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
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

    # Rule 05: Meeting DONE -> Cannot change participants
    if m.status == "DONE":
        raise HTTPException(400, "Không thể thay đổi người tham gia của cuộc họp đã hoàn thành (DONE)")

    mm = db.query(MeetingMember).filter(
        MeetingMember.meeting_id == id,
        MeetingMember.member_id == member_id
    ).first()
    if not mm:
        raise HTTPException(404, "Thành viên không thuộc cuộc họp này")

    removed_member = db.query(Member).filter(Member.id == member_id).first()
    db.delete(mm)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Meeting", entity_type="Meeting",
        entity_id=id, action="UPDATE", project_id=m.project_id,
        resource_name=removed_member.display_name if removed_member else str(member_id),
        description=f"Gỡ '{removed_member.display_name if removed_member else member_id}' khỏi cuộc họp '{m.title}'"
    )
    db.commit()

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
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

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
                meeting_proj = db.query(Project).filter(Project.id == m.project_id).first() if m.project_id else None
                workspace_id = workspace_id_for_project(db, meeting_proj)
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
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

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
            if not skill_vendor_id:
                fallback_skill = db.query(Skill).order_by(Skill.id.asc()).first()
                skill_vendor_id = fallback_skill.id if fallback_skill else None

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

    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

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
def retry_meeting_link(id: int, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Retry creating Google Meet link for a meeting that failed link creation."""
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

    from ..services.meeting_sync import create_google_meet_link
    meeting_proj = db.query(Project).filter(Project.id == m.project_id).first() if m.project_id else None
    workspace_id = workspace_id_for_project(db, meeting_proj)
    link_data = create_google_meet_link(db, current_user.id, m.title or "Cuộc họp", m.meeting_date.isoformat() if m.meeting_date else "", workspace_id=workspace_id)
    if link_data and link_data.get("join_url"):
        m.meeting_link = link_data["join_url"]
        db.commit()
        return {"success": True, "meeting_link": m.meeting_link}

    raise HTTPException(500, "Không thể tạo lại link Google Meet")


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
        matched_meeting.status = "DONE"

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

