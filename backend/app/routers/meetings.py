from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import Optional
import datetime
import logging

from ..database import get_db
from ..models.meeting import Meeting, MeetingMember
from ..models.project import Project
from ..models.member import Member
from ..utils.auth import get_current_user
from ..utils.access import ALL_SCOPE, project_query_for_user, require_project, require_route_project_access, user_scope
from ..utils.audit_service import AuditService

logger = logging.getLogger("meetings")
router = APIRouter(dependencies=[Depends(require_route_project_access)])

# Mapping between Database Enums and Frontend text labels
STATUS_DB_TO_FE = {
    "UPCOMING": "SẮP TỚI",
    "ONGOING": "ĐANG DIỄN RA",
    "DONE": "ĐÃ DIỄN RA",
    "CANCELLED": "ĐÃ HỦY"
}

STATUS_FE_TO_DB = {
    "SẮP TỚI": "UPCOMING",
    "ĐANG DIỄN RA": "ONGOING",
    "ĐÃ DIỄN RA": "DONE",
    "ĐÃ HỦY": "CANCELLED"
}

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

def meeting_to_dict(m: Meeting) -> dict:
    # Calculate duration
    duration = None
    if m.start_time and m.end_time:
        start_mins = m.start_time.hour * 60 + m.start_time.minute
        end_mins = m.end_time.hour * 60 + m.end_time.minute
        if end_mins >= start_mins:
            duration = end_mins - start_mins

    proj_name = m.project.name if m.project else "Dự án chung"

    executive_summary = ""
    decisions = []
    recommended_tasks = []
    summary_list = []

    # Only process AI summary if meeting actually has ai_summary JSON or has a transcript uploaded
    if m.ai_summary:
        if isinstance(m.ai_summary, dict):
            executive_summary = m.ai_summary.get("executive_summary") or m.ai_summary.get("summary") or ""
            decisions = m.ai_summary.get("decisions") or []
            recommended_tasks = m.ai_summary.get("recommended_tasks") or m.ai_summary.get("action_items") or []
        elif isinstance(m.ai_summary, list):
            summary_list = [str(item) for item in m.ai_summary]
            if summary_list:
                executive_summary = summary_list[0]
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

    return {
        "id": m.id,
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
        "status": STATUS_DB_TO_FE.get(m.status, m.status),
        "transcript": m.transcript,
        "ai_summary": m.ai_summary,
        "summary": summary_list,
        "executive_summary": executive_summary,
        "decisions": decisions,
        "recommended_tasks": recommended_tasks,
        "project_id": m.project_id,
        "project": proj_name,
        "project_name": proj_name,
        "created_by": m.created_by,
        "creator_name": m.creator.display_name if m.creator else None,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
        "members": [
            {
                "id": mm.id,
                "member_id": mm.member_id,
                "display_name": mm.member.display_name,
                "role": mm.role,
                "joined_at": mm.joined_at.isoformat() if mm.joined_at else None
            } for mm in m.members
        ],
        "member_count": len(m.members)
    }

# ─── LIST ───────────────────────────────────────────────
@router.get("")
def list_meetings(
    project_id: Optional[int] = None,
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    q = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    )
    if user_scope(current_user) != ALL_SCOPE:
        allowed_projects = project_query_for_user(db, current_user).with_entities(Project.id)
        q = q.filter(Meeting.project_id.in_(allowed_projects))

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

    meetings = q.order_by(Meeting.meeting_date.desc(), Meeting.start_time.desc()).all()
    return {"success": True, "data": [meeting_to_dict(m) for m in meetings]}

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
            from ..services.meeting_sync import create_google_meet_link
            result = create_google_meet_link(db, current_user.id, title, start_datetime, dur_mins)
            return {"success": True, "join_url": result["join_url"], "platform": "Google Meet"}
        except Exception as e:
            logger.error(f"Generate Google Meet link failed: {e}")
            raise HTTPException(status_code=400, detail=str(e))
    else:
        raise HTTPException(status_code=400, detail=f"Nền tảng '{platform}' chưa hỗ trợ tự động tạo link.")


# ─── GET ONE ─────────────────────────────────────────────
@router.get("/{id}")
def get_meeting(id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")
    return {"success": True, "data": meeting_to_dict(m)}

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
                result = create_google_meet_link(db, current_user.id, title, start_datetime, dur_mins)
                meeting_url = result["join_url"]
            except Exception as e:
                logger.error(f"Auto-generate Google Meet link failed: {e}")
                raise HTTPException(status_code=400, detail=str(e))

    # Handle AI summary formatting
    ai_summary = body.get("ai_summary") or body.get("summary")
    if ai_summary and isinstance(ai_summary, list):
        # Store flat list of strings directly
        ai_summary = [str(item) for item in ai_summary]

    m = Meeting(
        title=title,
        description=body.get("description"),
        platform=body.get("platform"),
        meeting_url=meeting_url,
        meeting_date=meeting_date,
        start_time=start_time,
        end_time=end_time,
        status=status,
        transcript=body.get("transcript"),
        ai_summary=ai_summary,
        project_id=project_id,
        created_by=created_by
    )
    # Auto-summarize with AI if transcript is provided
    if m.transcript and m.transcript.strip() and (not m.ai_summary or body.get("auto_summarize")):
        try:
            from ..services.meeting_sync import summarize_with_ai
            meeting_info = {
                "title": m.title,
                "date": m.meeting_date.isoformat() if m.meeting_date else "",
                "meeting_date": m.meeting_date,
                "start_time": m.start_time,
                "transcript": m.transcript,
            }
            summary_result = summarize_with_ai(m.transcript, meeting_info)
            if summary_result:
                m.ai_summary = summary_result
                m.status = "DONE"
        except Exception as e:
            logger.warning(f"Auto-summarize meeting {m.id} on create failed: {e}")

    db.add(m)
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
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == m.id).first()

    return {"success": True, "data": meeting_to_dict(m)}

# ─── UPDATE ──────────────────────────────────────────────
@router.put("/{id}")
def update_meeting(id: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

    old_status = m.status
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
    
    # Store ai_summary if provided (or keep old if not in payload)
    ai_summary_input = body.get("ai_summary") or body.get("summary")
    if ai_summary_input is not None:
        if isinstance(ai_summary_input, list):
            m.ai_summary = [str(item) for item in ai_summary_input]
        else:
            m.ai_summary = ai_summary_input

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

    db.commit()

    # Re-fetch with relationships
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == id).first()

    return {"success": True, "data": meeting_to_dict(m)}

# ─── UPDATE TRANSCRIPT (Rule 03) ────────────────────────
@router.post("/{id}/transcript")
def update_transcript(id: int, body: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
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

    return {"success": True, "data": meeting_to_dict(m)}

# ─── DELETE ──────────────────────────────────────────────
@router.delete("/{id}")
def delete_meeting(id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")
    db.delete(m)
    db.commit()
    return {"message": "Đã xóa cuộc họp thành công"}

# ─── ADD MEMBER ─────────────────────────────────────────
@router.post("/{id}/members")
def add_meeting_member(id: int, body: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
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

    # Re-fetch full meeting
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == id).first()

    return {"success": True, "data": meeting_to_dict(m)}

# ─── REMOVE MEMBER ───────────────────────────────────────
@router.delete("/{id}/members/{member_id}")
def remove_meeting_member(id: int, member_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
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

    db.delete(mm)
    db.commit()

    # Re-fetch full meeting
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == id).first()

    return {"success": True, "data": meeting_to_dict(m)}

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

    try:
        if "zoom" in platform and m.meeting_url:
            from ..services.meeting_sync import sync_zoom_meeting
            result = sync_zoom_meeting(m.meeting_url, meeting_info)
        elif ("google" in platform or "meet" in platform) and m.meeting_url:
            from ..services.meeting_sync import sync_google_meet
            result = sync_google_meet(db, current_user.id, m.meeting_url, meeting_info)
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

    # Update meeting with sync results
    m.transcript = result.get("transcript", m.transcript)
    m.ai_summary = result.get("summary", m.ai_summary)
    if result.get("status") == "DONE":
        m.status = "DONE"

    db.commit()

    # Re-fetch with relationships
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == id).first()

    return {"success": True, "data": meeting_to_dict(m)}


# ─── GOOGLE OAUTH — Connect/Disconnect/Status ───────────
@router.get("/google/status")
def google_status(db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Check if Google Calendar/Drive is connected."""
    from ..services.meeting_sync import is_google_connected
    return {"connected": is_google_connected(db, current_user.id)}


@router.get("/google/auth")
def google_auth_url(db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """Generate Google OAuth2 authorization URL."""
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
        ],
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )
    auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline", state=str(current_user.id))
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

    for item in tasks_data:
        detail_task = str(item.get("detail_task") or item.get("title") or item.get("name") or "").strip()
        if not detail_task:
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

        assigned_id = item.get("assigned_id")
        assigned_name = item.get("assigned_name") or item.get("member_name") or item.get("owner")
        if not assigned_id and assigned_name:
            mb = db.query(Member).filter(Member.display_name.ilike(str(assigned_name).strip())).first()
            if not mb:
                mb = db.query(Member).filter(Member.full_name.ilike(str(assigned_name).strip())).first()
            if mb:
                assigned_id = mb.id

        inbox_task = AITaskInbox(
            project_id=project_id,
            source_platform=m.platform or "Meeting AI",
            source_group_name=m.title or "Cuộc họp",
            source_message=f"[Meeting: {m.title}] {detail_task}",
            detail_task=detail_task,
            priority=item.get("priority", "Normal"),
            assigned_id=assigned_id,
            assigned_name=assigned_name,
            acceptance_criteria=f"Hạn hoàn thành: {item.get('deadline', 'Chưa xác định')}",
            status="PENDING",
            manday_est=float(item.get("manday_est", 1.0)),
        )
        db.add(inbox_task)
        pushed_count += 1

    db.commit()
    return {"success": True, "pushed_count": pushed_count, "message": f"Đã push {pushed_count} task vào Project thành công!"}


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
    link_data = create_google_meet_link(db, current_user.id, m.title or "Cuộc họp", m.meeting_date.isoformat() if m.meeting_date else "")
    if link_data and link_data.get("join_url"):
        m.meeting_link = link_data["join_url"]
        db.commit()
        return {"success": True, "meeting_link": m.meeting_link}

    raise HTTPException(500, "Không thể tạo lại link Google Meet")
