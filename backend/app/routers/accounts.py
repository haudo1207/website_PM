from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..models.member import Member
from ..utils.auth import require_admin, hash_password

router = APIRouter()

VALID_ROLES = {"admin", "group_a", "group_b"}


def account_to_dict(u: User) -> dict:
    member_info = None
    if u.member_id and u.member:
        m = u.member
        member_info = {
            "id": m.id,
            "display_name": m.display_name,
            "full_name": m.full_name,
            "team": m.team,
            "position": m.position,
            "department": m.department,
        }
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "role": u.role,
        "is_active": u.is_active,
        "member_id": u.member_id,
        "member": member_info,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("")
def list_accounts(db: Session = Depends(get_db), _=Depends(require_admin)):
    users = db.query(User).order_by(User.id.asc()).all()
    return [account_to_dict(u) for u in users]


@router.get("/available-members")
def available_members(db: Session = Depends(get_db), _=Depends(require_admin)):
    linked_ids = [
        uid for (uid,) in db.query(User.member_id).filter(User.member_id.isnot(None)).all()
    ]
    q = db.query(Member)
    if linked_ids:
        q = q.filter(~Member.id.in_(linked_ids))
    members = q.order_by(Member.display_name.asc()).all()
    return [
        {
            "id": m.id,
            "display_name": m.display_name,
            "full_name": m.full_name,
            "email": m.email,
            "team": m.team,
            "position": m.position,
            "department": m.department,
        }
        for m in members
    ]


@router.post("")
def create_account(body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    email = str(body.get("email", "")).strip()
    password = str(body.get("password", "")).strip()
    role = body.get("role", "group_a")
    member_id = body.get("member_id")

    if not email:
        raise HTTPException(400, "Email không được để trống")
    if not password:
        raise HTTPException(400, "Mật khẩu không được để trống")
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Role không hợp lệ. Phải là: {VALID_ROLES}")

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "Email đã tồn tại")

    if member_id:
        member = db.query(Member).filter(Member.id == member_id).first()
        if not member:
            raise HTTPException(404, "Không tìm thấy thành viên")
        existing_link = db.query(User).filter(User.member_id == member_id).first()
        if existing_link:
            raise HTTPException(400, "Thành viên này đã có tài khoản")

    u = User(
        email=email,
        full_name=body.get("full_name", ""),
        hashed_pw=hash_password(password),
        role=role,
        is_active=True,
        member_id=member_id,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return account_to_dict(u)


@router.put("/{account_id}")
def update_account(account_id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.query(User).filter(User.id == account_id).first()
    if not u:
        raise HTTPException(404, "Không tìm thấy tài khoản")

    if "email" in body:
        new_email = str(body["email"]).strip()
        if not new_email:
            raise HTTPException(400, "Email không được để trống")
        dup = db.query(User).filter(User.email == new_email, User.id != account_id).first()
        if dup:
            raise HTTPException(400, "Email đã tồn tại")
        u.email = new_email

    if "full_name" in body:
        u.full_name = body["full_name"]

    if "role" in body:
        if body["role"] not in VALID_ROLES:
            raise HTTPException(400, f"Role không hợp lệ. Phải là: {VALID_ROLES}")
        u.role = body["role"]

    db.commit()
    db.refresh(u)
    return account_to_dict(u)


@router.post("/{account_id}/reset-password")
def reset_password(account_id: int, body: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.query(User).filter(User.id == account_id).first()
    if not u:
        raise HTTPException(404, "Không tìm thấy tài khoản")

    new_pw = str(body.get("password", "")).strip()
    if not new_pw:
        raise HTTPException(400, "Mật khẩu mới không được để trống")

    u.hashed_pw = hash_password(new_pw)
    db.commit()
    return {"message": "Đặt lại mật khẩu thành công"}


@router.post("/{account_id}/lock")
def lock_account(account_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.query(User).filter(User.id == account_id).first()
    if not u:
        raise HTTPException(404, "Không tìm thấy tài khoản")
    u.is_active = False
    db.commit()
    return {"message": "Đã khóa tài khoản"}


@router.post("/{account_id}/unlock")
def unlock_account(account_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.query(User).filter(User.id == account_id).first()
    if not u:
        raise HTTPException(404, "Không tìm thấy tài khoản")
    u.is_active = True
    db.commit()
    return {"message": "Đã mở khóa tài khoản"}


@router.delete("/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    u = db.query(User).filter(User.id == account_id).first()
    if not u:
        raise HTTPException(404, "Không tìm thấy tài khoản")
    db.delete(u)
    db.commit()
    return {"message": "Đã xóa tài khoản (thành viên vẫn được giữ nguyên)"}
