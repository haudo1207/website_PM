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

logger = logging.getLogger("meetings")
router = APIRouter()

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

    # Format AI Summary object (JSONB/dict) to a flat array for frontend compatibility
    summary_list = []
    if m.ai_summary:
        if isinstance(m.ai_summary, dict):
            summary_list.append("MEETING SUMMARY")
            summary_list.append(m.ai_summary.get("summary") or "Chưa có tóm tắt.")
            
            decisions = m.ai_summary.get("decisions") or []
            if decisions:
                summary_list.append("1. QUYẾT ĐỊNH CHÍNH:")
                for d in decisions:
                    summary_list.append(f"• {d}")
                    
            action_items = m.ai_summary.get("action_items") or []
            if action_items:
                summary_list.append("2. HÀNH ĐỘNG TIẾP THEO:")
                for a in action_items:
                    summary_list.append(f"• {a}")
                    
            issues = m.ai_summary.get("issues") or []
            if issues:
                summary_list.append("3. VẤN ĐỀ CẦN GIẢI QUYẾT:")
                for i in issues:
                    summary_list.append(f"• {i}")
        elif isinstance(m.ai_summary, list):
            summary_list = m.ai_summary
        else:
            summary_list = [str(m.ai_summary)]

    return {
        "id": m.id,
        "title": m.title,
        "description": m.description,
        "platform": m.platform,
        "meeting_url": m.meeting_url,
        "link": m.meeting_url, # Frontend uses meeting.link
        "date": m.meeting_date.isoformat() if m.meeting_date else None, # Frontend uses date
        "meeting_date": m.meeting_date.isoformat() if m.meeting_date else None,
        "time": m.start_time.strftime("%H:%M") if m.start_time else None, # Frontend uses time
        "start_time": m.start_time.strftime("%H:%M") if m.start_time else None,
        "endTime": m.end_time.strftime("%H:%M") if m.end_time else None, # Frontend uses endTime
        "end_time": m.end_time.strftime("%H:%M") if m.end_time else None,
        "duration": duration,
        "status": STATUS_DB_TO_FE.get(m.status, m.status), # Map to FE status text label
        "transcript": m.transcript,
        "ai_summary": m.ai_summary,
        "summary": summary_list, # Map to FE flat list structure
        "project_id": m.project_id,
        "project": m.project.name if m.project else None, # Frontend uses project (string)
        "project_name": m.project.name if m.project else None,
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
        ]
    }

# ─── LIST ───────────────────────────────────────────────
@router.get("")
def list_meetings(
    project_id: Optional[int] = None,
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    q = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    )

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
        proj = db.query(Project).filter(Project.id == project_id).first()
        if not proj:
            raise HTTPException(404, "Không tìm thấy dự án được liên kết")
    elif project_input:
        proj = db.query(Project).filter(Project.name.ilike(str(project_input).strip())).first()
        if proj:
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
    platform = body.get("platform", "")

    if not meeting_url and platform:
        # Build ISO start_time for API calls
        start_datetime = f"{meeting_date.isoformat()}T{start_time.strftime('%H:%M')}:00Z"
        dur_mins = 60
        try:
            dur_mins = int(body.get("duration", 60))
        except Exception:
            pass

        if platform.lower() == "zoom":
            try:
                from ..services.meeting_sync import create_zoom_meeting
                result = create_zoom_meeting(title, start_datetime, dur_mins)
                meeting_url = result["join_url"]
            except Exception as e:
                logger.warning(f"Auto-generate Zoom link failed: {e}")
        elif platform.lower() == "google meet":
            try:
                from ..services.meeting_sync import create_google_meet_link
                result = create_google_meet_link(title, start_datetime, dur_mins)
                meeting_url = result["join_url"]
            except Exception as e:
                logger.warning(f"Auto-generate Google Meet link failed: {e}")

    # Handle AI summary formatting
    ai_summary = body.get("ai_summary") or body.get("summary")
    # If summary is a flat list of strings, keep it or convert it
    if ai_summary and isinstance(ai_summary, list):
        # Check if first item is our marker
        if len(ai_summary) > 1 and ai_summary[0] == "MEETING SUMMARY":
            # Already mapped, try to extract parts or store as list
            pass
        else:
            # Map flat string array to structured JSONB
            ai_summary = {
                "summary": "Tóm tắt cuộc họp",
                "decisions": [],
                "issues": [],
                "action_items": ai_summary
            }

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

    db.add(m)
    db.commit()
    db.refresh(m)

    # Re-fetch with relationships
    m = db.query(Meeting).options(
        joinedload(Meeting.project),
        joinedload(Meeting.creator),
        joinedload(Meeting.members).joinedload(MeetingMember.member)
    ).filter(Meeting.id == m.id).first()

    return {"success": True, "data": meeting_to_dict(m)}

# ─── UPDATE ──────────────────────────────────────────────
@router.put("/{id}")
def update_meeting(id: int, body: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
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
    # Check both 'ai_summary' and 'summary'
    ai_summary_input = body.get("ai_summary") or body.get("summary")
    if ai_summary_input is not None:
        if isinstance(ai_summary_input, list):
            # Convert flat list to structured JSONB if not already formatted
            if len(ai_summary_input) > 1 and ai_summary_input[0] == "MEETING SUMMARY":
                # Old structure representation
                pass
            else:
                ai_summary_input = {
                    "summary": "Tóm tắt cuộc họp",
                    "decisions": [],
                    "issues": [],
                    "action_items": ai_summary_input
                }
        m.ai_summary = ai_summary_input

    project_id = body.get("project_id")
    project_input = body.get("project")
    if project_id is not None:
        if project_id:
            proj = db.query(Project).filter(Project.id == project_id).first()
            if not proj:
                raise HTTPException(404, "Không tìm thấy dự án được liên kết")
            m.project_id = project_id
        else:
            m.project_id = None
    elif project_input is not None:
        if project_input:
            proj = db.query(Project).filter(Project.name.ilike(str(project_input).strip())).first()
            if proj:
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
def sync_meeting(id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Sync a meeting: fetch transcript and generate AI summary from Zoom/Google Meet."""
    m = db.query(Meeting).filter(Meeting.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy cuộc họp")

    if not m.meeting_url:
        raise HTTPException(400, "Cuộc họp không có link. Không thể đồng bộ.")

    platform = (m.platform or "").lower()
    meeting_info = {
        "title": m.title,
        "date": m.meeting_date.isoformat() if m.meeting_date else "",
        "meeting_date": m.meeting_date,
        "start_time": m.start_time,
        "duration": None,
    }
    if m.start_time and m.end_time:
        start_dt = datetime.datetime.combine(datetime.date.today(), m.start_time)
        end_dt = datetime.datetime.combine(datetime.date.today(), m.end_time)
        meeting_info["duration"] = int((end_dt - start_dt).total_seconds() / 60)

    try:
        if "zoom" in platform:
            from ..services.meeting_sync import sync_zoom_meeting
            result = sync_zoom_meeting(m.meeting_url, meeting_info)
        elif "google" in platform or "meet" in platform:
            from ..services.meeting_sync import sync_google_meet
            result = sync_google_meet(m.meeting_url, meeting_info)
        else:
            raise HTTPException(400, f"Nền tảng '{m.platform}' không hỗ trợ đồng bộ tự động.")
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
def google_status():
    """Check if Google Calendar/Drive is connected."""
    from ..services.meeting_sync import is_google_connected
    return {"connected": is_google_connected()}


@router.get("/google/auth")
def google_auth_url():
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
        redirect_uri=settings.GOOGLE_CLIENT_ID and f"{settings.AI_BASE_URL.replace('/v1','')}/api/meetings/google/callback" or "http://localhost:8000/api/meetings/google/callback",
    )
    auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline")
    return {"auth_url": auth_url}


@router.get("/google/callback")
def google_callback(code: str):
    """Handle Google OAuth2 callback and save tokens."""
    from ..config import settings
    from google_auth_oauthlib.flow import Flow
    from ..services.meeting_sync import _save_google_tokens

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=[
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/drive.readonly",
        ],
        redirect_uri=settings.GOOGLE_CLIENT_ID and f"{settings.AI_BASE_URL.replace('/v1','')}/api/meetings/google/callback" or "http://localhost:8000/api/meetings/google/callback",
    )
    flow.fetch_token(code=code)
    creds = flow.credentials

    _save_google_tokens({
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
    })

    return {"success": True, "message": "Đã kết nối Google Calendar & Drive thành công!"}
