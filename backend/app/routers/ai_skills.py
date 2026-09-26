"""
AI Skill Library — company-wide, cross-project reusable skills/prompts/SOPs
for the "KPI Prototype" browser extension. Native pm-new port of
markee-dashboard's skill_library(skill_type='skill') + departments/teams +
favorites/recent tables.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.ai_skill import AiSkill, AiSkillAttachment, AiSkillFavorite, AiSkillRecent
from ..models.member import Member
from ..utils.auth import get_current_user

router = APIRouter(tags=["ai-skills"])


def _member_id_for(current_user, db: Session):
    if current_user and getattr(current_user, "email", None):
        member = db.query(Member).filter(Member.email.ilike(current_user.email)).first()
        if member:
            return member.id
    return None


def _skill_to_dict(s: AiSkill, favorite_ids: set = None) -> dict:
    return {
        "id": s.id,
        "title": s.title,
        "markdown_content": s.markdown_content,
        "asset_type": s.asset_type,
        "category": s.category,
        "department_id": s.department_id,
        "department_name": s.department.name if s.department else None,
        "team_id": s.team_id,
        "team_name": s.team.name if s.team else None,
        "project_id": s.project_id,
        "project_name": s.project.name if s.project else None,
        "status": s.status,
        "created_by": s.created_by.display_name if s.created_by else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "is_favorite": favorite_ids is not None and s.id in favorite_ids,
        "attachments": [
            {"id": a.id, "file_name": a.file_name, "mime_type": a.mime_type, "size_bytes": a.size_bytes}
            for a in (s.attachments or [])
        ],
    }


@router.get("/ai-skills")
def list_skills(
    department_id: int = None, team_id: int = None, project_id: int = None,
    asset_type: str = None, keyword: str = None, favorite: bool = False, recent: bool = False,
    mine: bool = False, limit: int = 50, offset: int = 0,
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
):
    member_id = _member_id_for(current_user, db)
    query = db.query(AiSkill).filter(AiSkill.status == "approved")

    if department_id:
        query = query.filter(AiSkill.department_id == department_id)
    if team_id:
        query = query.filter(AiSkill.team_id == team_id)
    if project_id:
        query = query.filter(AiSkill.project_id == project_id)
    if asset_type:
        query = query.filter(AiSkill.asset_type == asset_type)
    if keyword:
        query = query.filter(AiSkill.title.ilike(f"%{keyword}%"))
    if mine and member_id:
        query = query.filter(AiSkill.created_by_id == member_id)

    if favorite and member_id:
        fav_ids = [r.skill_id for r in db.query(AiSkillFavorite).filter(AiSkillFavorite.member_id == member_id).all()]
        if not fav_ids:
            return []
        query = query.filter(AiSkill.id.in_(fav_ids))

    if recent and member_id:
        recent_rows = (
            db.query(AiSkillRecent)
            .filter(AiSkillRecent.member_id == member_id)
            .order_by(AiSkillRecent.used_at.desc())
            .limit(limit)
            .all()
        )
        recent_ids = [r.skill_id for r in recent_rows]
        if not recent_ids:
            return []
        skills = db.query(AiSkill).filter(AiSkill.id.in_(recent_ids)).all()
        by_id = {s.id: s for s in skills}
        fav_ids = set(r.skill_id for r in db.query(AiSkillFavorite).filter(AiSkillFavorite.member_id == member_id).all())
        return [_skill_to_dict(by_id[i], fav_ids) for i in recent_ids if i in by_id]

    skills = query.order_by(AiSkill.created_at.desc()).offset(offset).limit(limit).all()
    fav_ids = set()
    if member_id:
        fav_ids = set(r.skill_id for r in db.query(AiSkillFavorite).filter(AiSkillFavorite.member_id == member_id).all())
    return [_skill_to_dict(s, fav_ids) for s in skills]


@router.post("/ai-skills")
def create_skill(body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    title = (body.get("title") or "").strip()
    markdown_content = (body.get("markdown_content") or "").strip()
    if not title or not markdown_content:
        raise HTTPException(400, "Thiếu tiêu đề hoặc nội dung")

    skill = AiSkill(
        title=title,
        markdown_content=markdown_content,
        asset_type=(body.get("asset_type") or "skill").lower(),
        category=body.get("category"),
        department_id=body.get("department_id"),
        team_id=body.get("team_id"),
        project_id=body.get("project_id"),
        created_by_id=_member_id_for(current_user, db),
    )
    db.add(skill)
    db.flush()

    from ..services.document_storage import save_base64_upload
    for f in (body.get("attached_files") or []):
        file_name = f.get("file_name") or f.get("fileName") or "file"
        b64 = f.get("base64")
        if not b64:
            continue
        try:
            relative_path, size = save_base64_upload("ai-skills", file_name, b64)
        except ValueError as e:
            raise HTTPException(400, str(e))
        db.add(AiSkillAttachment(
            skill_id=skill.id, file_name=file_name, file_path=relative_path,
            mime_type=f.get("mime_type") or f.get("mimeType"), size_bytes=size,
        ))

    db.commit()
    db.refresh(skill)
    return _skill_to_dict(skill)


@router.patch("/ai-skills/{sid:int}")
def update_skill(sid: int, body: dict, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Edit a saved Skill's title/content — the /skills page (pm-new's own
    "Knowledge Hub" tab) had view + delete but no edit at all, unlike a
    project's WIP log (PATCH /projects/{pid}/feature-logs/{lid})."""
    skill = db.query(AiSkill).filter(AiSkill.id == sid).first()
    if not skill:
        raise HTTPException(404, "Không tìm thấy skill")

    if "title" in body:
        title = (body.get("title") or "").strip()
        if not title:
            raise HTTPException(400, "Thiếu tiêu đề")
        skill.title = title
    if "markdown_content" in body:
        content = (body.get("markdown_content") or "").strip()
        if not content:
            raise HTTPException(400, "Thiếu nội dung")
        skill.markdown_content = content

    db.commit()
    db.refresh(skill)
    return _skill_to_dict(skill)


@router.delete("/ai-skills/{sid:int}")
def delete_skill(sid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    skill = db.query(AiSkill).filter(AiSkill.id == sid).first()
    if not skill:
        raise HTTPException(404, "Không tìm thấy skill")
    from ..services.document_storage import delete_file
    for a in (skill.attachments or []):
        delete_file(a.file_path)
    db.delete(skill)
    db.commit()
    return {"success": True}


@router.post("/ai-skills/{sid:int}/favorite")
def toggle_favorite(sid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    member_id = _member_id_for(current_user, db)
    if not member_id:
        raise HTTPException(400, "Không xác định được thành viên")
    existing = (
        db.query(AiSkillFavorite)
        .filter(AiSkillFavorite.member_id == member_id, AiSkillFavorite.skill_id == sid)
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
        return {"success": True, "is_favorite": False}
    db.add(AiSkillFavorite(member_id=member_id, skill_id=sid))
    db.commit()
    return {"success": True, "is_favorite": True}


@router.get("/ai-skills/favorites")
def list_favorite_ids(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    member_id = _member_id_for(current_user, db)
    if not member_id:
        return {"favorite_skill_ids": []}
    ids = [r.skill_id for r in db.query(AiSkillFavorite).filter(AiSkillFavorite.member_id == member_id).all()]
    return {"favorite_skill_ids": ids}


@router.post("/ai-skills/{sid:int}/recent")
def record_recent(sid: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    member_id = _member_id_for(current_user, db)
    if not member_id:
        return {"success": False}
    existing = (
        db.query(AiSkillRecent)
        .filter(AiSkillRecent.member_id == member_id, AiSkillRecent.skill_id == sid)
        .first()
    )
    if existing:
        db.delete(existing)
        db.flush()
    from datetime import datetime, timezone
    db.add(AiSkillRecent(member_id=member_id, skill_id=sid, used_at=datetime.now(timezone.utc)))
    db.commit()
    return {"success": True}


@router.get("/ai-skills/{sid:int}/attachments/{idx:int}")
def download_attachment(sid: int, idx: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from fastapi.responses import FileResponse
    from ..services.document_storage import resolve_path

    skill = db.query(AiSkill).filter(AiSkill.id == sid).first()
    if not skill or idx < 0 or idx >= len(skill.attachments or []):
        raise HTTPException(404, "Không tìm thấy file đính kèm")
    att = skill.attachments[idx]
    path = resolve_path(att.file_path)
    if not path.is_file():
        raise HTTPException(404, "File không tồn tại trên server")
    return FileResponse(path, filename=att.file_name, media_type=att.mime_type or "application/octet-stream")
