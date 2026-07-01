from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..utils.auth import require_admin, hash_password, get_current_user

router = APIRouter()

@router.get("")
def list_users(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"id":u.id,"email":u.email,"full_name":u.full_name,"role":u.role,"is_active":u.is_active} for u in db.query(User).all()]

VALID_ROLES = {"admin", "group_a", "group_b"}

@router.post("")
def create_user(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(User).filter(User.email == body["email"]).first():
        raise HTTPException(400, "Email exists")
    role = body.get("role", "group_a")
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Invalid role. Must be one of: {VALID_ROLES}")
    u = User(email=body["email"], full_name=body.get("full_name",""), hashed_pw=hash_password(body["password"]), role=role)
    db.add(u)
    db.commit()
    db.refresh(u)
    return {"id":u.id,"email":u.email,"role":u.role}

@router.put("/{uid}")
def update_user(uid: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.query(User).filter(User.id == uid).first()
    if not u:
        raise HTTPException(404)
    for k, v in body.items():
        if k == "password":
            setattr(u, "hashed_pw", hash_password(v))
        elif hasattr(u, k) and k not in ["id","hashed_pw"]:
            setattr(u, k, v)
    db.commit()
    return {"message": "Updated"}

@router.delete("/{uid}")
def delete_user(uid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.query(User).filter(User.id == uid).first()
    if not u:
        raise HTTPException(404)
    db.delete(u)
    db.commit()
    return {"message": "Deleted"}

@router.get("/me")
def me(user=Depends(get_current_user)):
    return {"id":user.id,"email":user.email,"full_name":user.full_name,"role":user.role}
