from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..utils.auth import require_admin, hash_password, get_current_user
from ..utils.access import VALID_DATA_SCOPES
from .accounts import (
    VALID_ROLES,
    ensure_admin_remains,
    normalize_email,
    validate_password,
)

router = APIRouter()

@router.get("")
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    return [
        {
            "id": u.id,
            "email": u.email,
            "full_name": u.full_name,
            "role": u.role,
            "is_active": u.is_active,
            "data_scope": u.data_scope,
            "department": u.department,
            "skills": [s.id for s in u.skills]
        }
        for u in db.query(User).all()
    ]

@router.post("")
def create_user(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    email = normalize_email(body.get("email"))
    password = str(body.get("password") or "")
    if not email:
        raise HTTPException(400, "Email is required")
    validate_password(password)
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "Email exists")
    role = body.get("role", "group_a")
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Invalid role. Must be one of: {VALID_ROLES}")
    data_scope = str(body.get("data_scope", "infrastructure")).strip().lower()
    if data_scope not in VALID_DATA_SCOPES:
        raise HTTPException(400, f"Invalid data_scope. Must be one of: {VALID_DATA_SCOPES}")
    
    from ..models.skill_master import Skill
    skills = body.get("skills", [])
    skill_objs = db.query(Skill).filter(Skill.id.in_(skills)).all()
    
    u = User(
        email=email,
        full_name=body.get("full_name",""),
        hashed_pw=hash_password(password),
        role=role,
        data_scope=data_scope,
        department=body.get("department"),
        skills=skill_objs
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return {"id":u.id,"email":u.email,"role":u.role,"data_scope":u.data_scope}

@router.put("/{uid}")
def update_user(uid: int, body: dict, db: Session = Depends(get_db), admin=Depends(require_admin)):
    u = db.query(User).filter(User.id == uid).first()
    if not u:
        raise HTTPException(404)
    for k, v in body.items():
        if k == "password":
            password = str(v or "")
            validate_password(password)
            setattr(u, "hashed_pw", hash_password(password))
        elif k == "skills":
            from ..models.skill_master import Skill
            skill_objs = db.query(Skill).filter(Skill.id.in_(v)).all()
            u.skills = skill_objs
        elif k == "data_scope":
            value = str(v).strip().lower()
            if value not in VALID_DATA_SCOPES:
                raise HTTPException(400, f"Invalid data_scope. Must be one of: {VALID_DATA_SCOPES}")
            u.data_scope = value
        elif k == "email":
            email = normalize_email(v)
            if not email:
                raise HTTPException(400, "Email is required")
            duplicate = db.query(User).filter(User.email == email, User.id != uid).first()
            if duplicate:
                raise HTTPException(400, "Email exists")
            u.email = email
        elif k == "role":
            role = str(v).strip().lower()
            if role not in VALID_ROLES:
                raise HTTPException(400, f"Invalid role. Must be one of: {VALID_ROLES}")
            if admin.id == u.id and role != "admin":
                raise HTTPException(400, "You cannot demote your own admin account")
            ensure_admin_remains(db, u, role=role)
            u.role = role
        elif k == "is_active":
            is_active = bool(v)
            if admin.id == u.id and not is_active:
                raise HTTPException(400, "You cannot lock your own account")
            ensure_admin_remains(db, u, active=is_active)
            u.is_active = is_active
        elif hasattr(u, k) and k not in ["id", "hashed_pw", "member_id", "created_at"]:
            setattr(u, k, v)
    db.commit()
    return {"message": "Updated"}

@router.delete("/{uid}")
def delete_user(uid: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    u = db.query(User).filter(User.id == uid).first()
    if not u:
        raise HTTPException(404)
    if admin.id == u.id:
        raise HTTPException(400, "You cannot delete your own account")
    ensure_admin_remains(db, u, deleting=True)
    db.delete(u)
    db.commit()
    return {"message": "Deleted"}

@router.get("/me")
def me(user=Depends(get_current_user)):
    return {"id":user.id,"email":user.email,"full_name":user.full_name,"role":user.role,"data_scope":user.data_scope}
