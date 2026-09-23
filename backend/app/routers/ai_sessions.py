"""
Passive AI-session logging (AUTO_LOG) + weekly usage-quota pings, for the
"KPI Prototype" browser extension. Was write-only ("no listing UI yet" —
now added below): every AUTO_LOG'd ChatGPT/Claude/Gemini message was
captured and stored per-project but had no GET route at all, so it was
permanently unviewable anywhere — the reference product (markee-dashboard's
ProjectDetailContent.tsx "Nhật ký hoạt động" timeline) has always shown
this per-project; pm-new's own Prototype tab never had an equivalent to
render it in the first place, exactly because this route didn't exist yet.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.ai_skill import AiSession, AiSessionAttachment, AiUsageStat
from ..models.member import Member
from ..utils.access import require_project
from ..utils.auth import get_current_user

router = APIRouter(tags=["ai-sessions"])


def _member_id_for(current_user, db: Session):
    if current_user and getattr(current_user, "email", None):
        member = db.query(Member).filter(Member.email.ilike(current_user.email)).first()
        if member:
            return member.id
    return None


def _session_to_dict(s: AiSession) -> dict:
    return {
        "id": s.id,
        "ai_tool": s.ai_tool,
        "project_id": s.project_id,
        "department_id": s.department_id,
        "team_id": s.team_id,
        "task_type": s.task_type,
        "prompt_content": s.prompt_content,
        "tokens_used": s.tokens_used,
        "author": s.author.display_name if s.author else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "attachments": [
            {"id": a.id, "file_name": a.file_name, "mime_type": a.mime_type, "size_bytes": a.size_bytes}
            for a in (s.attachments or [])
        ],
    }


@router.get("/projects/{project_id:int}/ai-sessions")
def list_project_sessions(
    project_id: int,
    ai_tool: str = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """"Nhật ký hoạt động" (Activity Log) timeline — every AUTO_LOG'd message
    sent to ChatGPT/Claude/Gemini while this project was selected in the
    extension, newest first. Mirrors markee-dashboard's
    ProjectDetailContent.tsx timeline (same AiSession shape: ai_tool,
    tokens_used, prompt_content, attachments)."""
    require_project(db, current_user, project_id)
    query = db.query(AiSession).filter(AiSession.project_id == project_id)
    if ai_tool:
        query = query.filter(AiSession.ai_tool == ai_tool)
    sessions = query.order_by(AiSession.created_at.desc()).offset(offset).limit(limit).all()
    return [_session_to_dict(s) for s in sessions]


@router.get("/ai-sessions/{session_id:int}/attachments/{attachment_id:int}")
def download_session_attachment(
    session_id: int, attachment_id: int,
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    from fastapi.responses import FileResponse
    from ..services.document_storage import resolve_path

    session = db.query(AiSession).filter(AiSession.id == session_id).first()
    if not session:
        raise HTTPException(404, "Không tìm thấy session")
    if session.project_id:
        require_project(db, current_user, session.project_id)
    attachment = db.query(AiSessionAttachment).filter(
        AiSessionAttachment.id == attachment_id, AiSessionAttachment.session_id == session_id
    ).first()
    if not attachment:
        raise HTTPException(404, "Không tìm thấy file đính kèm")
    path = resolve_path(attachment.file_path)
    if not path.is_file():
        raise HTTPException(404, "File không tồn tại trên server")
    return FileResponse(path, filename=attachment.file_name, media_type=attachment.mime_type or "application/octet-stream")


@router.post("/ai-sessions")
def create_session(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    staged_files = body.get("staged_files") or []

    session = AiSession(
        ai_tool=body.get("ai_tool") or "unknown",
        project_id=body.get("project_id"),
        department_id=body.get("department_id"),
        team_id=body.get("team_id"),
        task_type=body.get("task_type") or "Auto-tracked",
        prompt_content=body.get("prompt_content") or "",
        tokens_used=body.get("tokens_used") or 0,
        author_id=_member_id_for(current_user, db),
    )
    db.add(session)
    db.flush()

    if staged_files:
        from ..services.document_storage import save_base64_upload
        for f in staged_files:
            file_name = f.get("fileName") or f.get("file_name") or "file"
            b64 = f.get("base64")
            if not b64 or not f.get("size"):
                continue
            try:
                relative_path, size = save_base64_upload(f"ai-sessions/{session.id}", file_name, b64)
            except ValueError:
                continue
            db.add(AiSessionAttachment(
                session_id=session.id, file_name=file_name, file_path=relative_path,
                mime_type=f.get("mimeType") or f.get("mime_type"), size_bytes=size,
            ))

    db.commit()
    return {"ok": True, "session_id": session.id}


@router.post("/ai-usage-stats")
def create_usage_stat(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    db.add(AiUsageStat(
        member_id=_member_id_for(current_user, db),
        ai_tool=body.get("ai_tool") or "unknown",
        weekly_used=body.get("weekly_used"),
        reset_time=body.get("reset_time"),
    ))
    db.commit()
    return {"ok": True}
