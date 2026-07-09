from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import Optional
import datetime

from ..database import get_db
from ..models.member import Member, member_skills
from ..models.skill_master import Skill
from ..utils.auth import require_admin, get_current_user

router = APIRouter()


def member_to_dict(m: Member) -> dict:
    return {
        "id": m.id,
        "display_name": m.display_name,
        "full_name": m.full_name,
        "email": m.email,
        "telegram_username": m.telegram_username,
        "phone": m.phone,
        "birth_date": m.birth_date.isoformat() if m.birth_date else None,
        "gender": m.gender,
        "team": m.team,
        "position": m.position,
        "department": m.department,
        "experience_year": m.experience_year,
        "created_at": m.created_at,
        "skill_ids": [s.id for s in m.skills],
        "skills": [
            {"id": s.id, "name": s.name}
            for s in m.skills
        ]
    }


# ─── LIST ───────────────────────────────────────────────
@router.get("")
def list_members(
    search: Optional[str] = None,
    team: Optional[str] = None,
    position: Optional[str] = None,
    department: Optional[str] = None,
    skill_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    q = db.query(Member).options(joinedload(Member.skills))

    if search:
        like = f"%{search}%"
        q = q.filter(
            (Member.display_name.ilike(like)) | (Member.full_name.ilike(like))
        )
    if team:
        q = q.filter(Member.team == team)
    if position:
        q = q.filter(Member.position == position)
    if department:
        q = q.filter(Member.department == department)
    if skill_id:
        q = q.filter(Member.skills.any(Skill.id == skill_id))

    members = q.order_by(Member.display_name.asc()).all()
    return [member_to_dict(m) for m in members]


# ─── GET ONE ─────────────────────────────────────────────
@router.get("/{id}")
def get_member(id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")
    return member_to_dict(m)


# ─── CREATE ──────────────────────────────────────────────
@router.post("")
def create_member(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    display_name = str(body.get("display_name", "")).strip()
    full_name = str(body.get("full_name", "")).strip()

    if not display_name:
        raise HTTPException(400, "Display Name không được để trống")
    if not full_name:
        raise HTTPException(400, "Họ và tên không được để trống")

    if db.query(Member).filter(Member.display_name.ilike(display_name)).first():
        raise HTTPException(400, f"Display Name '{display_name}' đã tồn tại")

    birth_date = None
    bd_str = body.get("birth_date", "")
    if bd_str:
        try:
            birth_date = datetime.date.fromisoformat(str(bd_str))
        except ValueError:
            pass

    m = Member(
        display_name=display_name,
        full_name=full_name,
        email=body.get("email") or None,
        telegram_username=body.get("telegram_username") or None,
        phone=body.get("phone") or None,
        birth_date=birth_date,
        gender=body.get("gender") or None,
        team=body.get("team") or None,
        position=body.get("position") or None,
        department=body.get("department") or None,
        experience_year=int(body.get("experience_year") or 0),
    )

    skill_ids = body.get("skill_ids", [])
    if skill_ids:
        skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
        m.skills = skills

    db.add(m)
    db.commit()
    db.refresh(m)
    # reload with skills
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == m.id).first()
    return member_to_dict(m)


# ─── UPDATE ──────────────────────────────────────────────
@router.put("/{id}")
def update_member(id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")

    display_name = str(body.get("display_name", m.display_name)).strip()
    full_name = str(body.get("full_name", m.full_name)).strip()

    if not display_name:
        raise HTTPException(400, "Display Name không được để trống")
    if not full_name:
        raise HTTPException(400, "Họ và tên không được để trống")

    dup = db.query(Member).filter(
        Member.display_name.ilike(display_name),
        Member.id != id
    ).first()
    if dup:
        raise HTTPException(400, f"Display Name '{display_name}' đã tồn tại")

    birth_date = m.birth_date
    bd_str = body.get("birth_date", "")
    if bd_str is not None:
        if bd_str:
            try:
                birth_date = datetime.date.fromisoformat(str(bd_str))
            except ValueError:
                pass
        else:
            birth_date = None

    m.display_name = display_name
    m.full_name = full_name
    m.email = body.get("email") or None
    m.telegram_username = body.get("telegram_username") or None
    m.phone = body.get("phone") or None
    m.birth_date = birth_date
    m.gender = body.get("gender") or None
    m.team = body.get("team") or None
    m.position = body.get("position") or None
    m.department = body.get("department") or None
    m.experience_year = int(body.get("experience_year") or 0)

    skill_ids = body.get("skill_ids")
    if skill_ids is not None:
        skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
        m.skills = skills

    db.commit()
    m = db.query(Member).options(joinedload(Member.skills)).filter(Member.id == id).first()
    return member_to_dict(m)


# ─── DELETE ──────────────────────────────────────────────
@router.delete("/{id}")
def delete_member(id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    m = db.query(Member).filter(Member.id == id).first()
    if not m:
        raise HTTPException(404, "Không tìm thấy thành viên")
    db.delete(m)
    db.commit()
    return {"message": "Đã xóa thành viên thành công"}


# ─── GET TEAMS (distinct list) ────────────────────────────
@router.get("/meta/teams")
def list_teams(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(Member.team).filter(Member.team.isnot(None)).distinct().all()
    return sorted([r[0] for r in rows if r[0]])
