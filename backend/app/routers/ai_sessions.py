"""
Passive AI-session logging (AUTO_LOG) + weekly usage-quota pings, for the
"KPI Prototype" browser extension. Write-only in v1 — no listing UI yet,
just landing the data so it exists for later reporting.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.ai_skill import AiSession, AiSessionAttachment, AiUsageStat
from ..models.member import Member
from ..utils.auth import get_current_user

router = APIRouter(tags=["ai-sessions"])


def _member_id_for(current_user, db: Session):
    if current_user and getattr(current_user, "email", None):
        member = db.query(Member).filter(Member.email.ilike(current_user.email)).first()
        if member:
            return member.id
    return None


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
