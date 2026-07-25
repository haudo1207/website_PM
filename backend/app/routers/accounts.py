from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ..database import get_db
from ..config import settings
from ..models.member import Member
from ..models.user import User
from ..utils.access import (
    DEFAULT_SCOPE,
    VALID_DATA_SCOPES,
    VALID_ROLES,
    ROLE_SUPER_ADMIN,
    ROLE_LEADER,
    ROLE_MEMBER,
    ROLE_VIEWER,
)
from ..utils.auth import hash_password, require_manager, get_current_user

router = APIRouter()
MIN_PASSWORD_LENGTH = 8
SUPER_ADMIN_ROLES = {ROLE_SUPER_ADMIN, "admin"}
LEADER_MANAGED_ROLES = {ROLE_MEMBER, ROLE_VIEWER}


def normalize_email(value) -> str:
    return str(value or "").strip().lower()


def is_bootstrap_superadmin(account: User) -> bool:
    return normalize_email(account.email) in settings.superadmin_emails


def require_account(db: Session, account_id: int) -> User:
    account = db.query(User).filter(User.id == account_id).first()
    if not account:
        raise HTTPException(404, "Không tìm thấy tài khoản.")
    return account


def ensure_superadmin_remains(db: Session, account: User, *, role=None, active=None, deleting=False) -> None:
    """Prevent the last active super_admin from being disabled, demoted, or deleted."""
    next_role = account.role if role is None else role
    next_active = account.is_active if active is None else active
    removes_active_superadmin = (
        account.role in {ROLE_SUPER_ADMIN, "admin"}
        and account.is_active
        and (deleting or next_role not in {ROLE_SUPER_ADMIN, "admin"} or not next_active)
    )
    if removes_active_superadmin:
        active_superadmins = db.query(User).filter(User.role.in_(SUPER_ADMIN_ROLES), User.is_active.is_(True)).count()
        if active_superadmins <= 1:
            raise HTTPException(400, "Hệ thống phải còn ít nhất một tài khoản Super Admin đang hoạt động.")


def validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Mật khẩu phải có ít nhất {MIN_PASSWORD_LENGTH} ký tự.")


def _leader_guard(caller: User, target: User, action: str = "thao tác") -> None:
    """Raise 403 if a Leader tries to modify accounts outside Member/Viewer."""
    if caller.role == ROLE_LEADER and target.role not in LEADER_MANAGED_ROLES:
        raise HTTPException(403, f"Leader không có quyền {action} tài khoản này.")


def _ensure_leader_allowed_role(caller: User, role: str) -> None:
    if caller.role == ROLE_LEADER and role not in LEADER_MANAGED_ROLES:
        raise HTTPException(403, "Leader chỉ có quyền gán role Member hoặc Viewer.")


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
        "avatar_url": u.avatar_url,
        "role": u.role,
        "data_scope": u.data_scope,
        "is_active": u.is_active,
        "member_id": u.member_id,
        "member": member_info,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("")
def list_accounts(db: Session = Depends(get_db), caller=Depends(require_manager)):
    query = db.query(User)
    if caller.role == ROLE_LEADER:
        query = query.filter(
            (User.id == caller.id) | (User.role.in_(LEADER_MANAGED_ROLES))
        )
    users = query.order_by(User.id.asc()).all()
    return [account_to_dict(u) for u in users]


@router.get("/available-members")
def available_members(db: Session = Depends(get_db), _=Depends(require_manager)):
    linked_ids = [
        uid for (uid,) in db.query(User.member_id).filter(User.member_id.isnot(None)).all()
    ]
    query = db.query(Member)
    if linked_ids:
        query = query.filter(~Member.id.in_(linked_ids))
    members = query.order_by(Member.display_name.asc()).all()
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
def create_account(body: dict, db: Session = Depends(get_db), caller=Depends(require_manager)):
    email = normalize_email(body.get("email"))
    password = str(body.get("password") or "")
    role = str(body.get("role") or "member").strip().lower()
    data_scope = str(body.get("data_scope") or DEFAULT_SCOPE).strip().lower()
    member_id = body.get("member_id") or None

    if not email:
        raise HTTPException(400, "Email không được để trống.")
    if settings.PASSWORD_LOGIN_ENABLED:
        validate_password(password)
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Role không hợp lệ. Chọn một trong: {sorted(VALID_ROLES)}")
    if data_scope not in VALID_DATA_SCOPES:
        raise HTTPException(400, f"Phạm vi dữ liệu không hợp lệ. Chọn một trong: {sorted(VALID_DATA_SCOPES)}")
    if db.query(User).filter(func.lower(User.email) == email).first():
        raise HTTPException(400, "Email đã tồn tại.")

    _ensure_leader_allowed_role(caller, role)

    if member_id is not None:
        member = db.query(Member).filter(Member.id == member_id).first()
        if not member:
            raise HTTPException(404, "Không tìm thấy thành viên.")
        if db.query(User).filter(User.member_id == member_id).first():
            raise HTTPException(400, "Thành viên này đã có tài khoản.")

    account = User(
        email=email,
        full_name=str(body.get("full_name") or "").strip(),
        hashed_pw=(
            hash_password(password)
            if settings.PASSWORD_LOGIN_ENABLED
            else "!google-only!"
        ),
        role=role,
        data_scope=data_scope,
        is_active=True,
        member_id=member_id,
    )
    db.add(account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Email hoặc thành viên liên kết đã được sử dụng.")
    db.refresh(account)
    return account_to_dict(account)


@router.put("/{account_id}")
def update_account(
    account_id: int,
    body: dict,
    db: Session = Depends(get_db),
    caller=Depends(require_manager),
):
    account = require_account(db, account_id)
    _leader_guard(caller, account, "chỉnh sửa")

    if "email" in body:
        if is_bootstrap_superadmin(account):
            raise HTTPException(400, "The bootstrap super-admin email cannot be changed.")
        new_email = normalize_email(body["email"])
        if not new_email:
            raise HTTPException(400, "Email không được để trống.")
        duplicate = db.query(User).filter(func.lower(User.email) == new_email, User.id != account_id).first()
        if duplicate:
            raise HTTPException(400, "Email đã tồn tại.")
        if account.email != new_email:
            account.email = new_email
            # Re-approve and bind the replacement Google identity on first login.
            account.google_sub = None
            account.avatar_url = None

    if "full_name" in body:
        account.full_name = str(body["full_name"] or "").strip()

    if "member_id" in body:
        member_id = body.get("member_id") or None
        if member_id is not None:
            member = db.query(Member).filter(Member.id == member_id).first()
            if not member:
                raise HTTPException(404, "Không tìm thấy thành viên.")
            duplicate = db.query(User).filter(
                User.member_id == member_id,
                User.id != account_id,
            ).first()
            if duplicate:
                raise HTTPException(400, "Thành viên này đã được liên kết với tài khoản khác.")
        account.member_id = member_id

    if "role" in body:
        new_role = str(body["role"]).strip().lower()
        if new_role not in VALID_ROLES:
            raise HTTPException(400, f"Role không hợp lệ. Chọn một trong: {sorted(VALID_ROLES)}")
        if caller.id == account.id and new_role != caller.role:
            raise HTTPException(400, "Bạn không thể tự thay đổi role của chính mình.")
        _ensure_leader_allowed_role(caller, new_role)
        ensure_superadmin_remains(db, account, role=new_role)
        if is_bootstrap_superadmin(account) and new_role not in SUPER_ADMIN_ROLES:
            raise HTTPException(400, "The bootstrap super-admin cannot be demoted.")
        account.role = new_role

    if "data_scope" in body:
        data_scope = str(body["data_scope"]).strip().lower()
        if data_scope not in VALID_DATA_SCOPES:
            raise HTTPException(400, f"Phạm vi dữ liệu không hợp lệ. Chọn một trong: {sorted(VALID_DATA_SCOPES)}")
        if is_bootstrap_superadmin(account) and data_scope != "all":
            raise HTTPException(400, "The bootstrap super-admin must retain access to all data.")
        account.data_scope = data_scope

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Không thể cập nhật do dữ liệu bị trùng.")
    db.refresh(account)
    return account_to_dict(account)


@router.post("/{account_id}/reset-password")
def reset_password(account_id: int, body: dict, db: Session = Depends(get_db), caller=Depends(require_manager)):
    if not settings.PASSWORD_LOGIN_ENABLED:
        raise HTTPException(403, "Password login is disabled.")
    account = require_account(db, account_id)
    _leader_guard(caller, account, "đặt lại mật khẩu")
    new_password = str(body.get("password") or "")
    validate_password(new_password)
    account.hashed_pw = hash_password(new_password)
    db.commit()
    return {"message": "Đặt lại mật khẩu thành công."}


@router.post("/{account_id}/lock")
def lock_account(
    account_id: int,
    db: Session = Depends(get_db),
    caller=Depends(require_manager),
):
    account = require_account(db, account_id)
    _leader_guard(caller, account, "khóa")
    if is_bootstrap_superadmin(account):
        raise HTTPException(400, "The bootstrap super-admin cannot be locked.")
    if caller.id == account.id:
        raise HTTPException(400, "Bạn không thể tự khóa tài khoản đang đăng nhập.")
    ensure_superadmin_remains(db, account, active=False)
    account.is_active = False
    db.commit()
    return {"message": "Đã khóa tài khoản."}


@router.post("/{account_id}/unlock")
def unlock_account(account_id: int, db: Session = Depends(get_db), caller=Depends(require_manager)):
    account = require_account(db, account_id)
    _leader_guard(caller, account, "mở khóa")
    account.is_active = True
    db.commit()
    return {"message": "Đã mở khóa tài khoản."}


@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    caller=Depends(require_manager),
):
    account = require_account(db, account_id)
    _leader_guard(caller, account, "xóa")
    if is_bootstrap_superadmin(account):
        raise HTTPException(400, "The bootstrap super-admin cannot be deleted.")
    if caller.id == account.id:
        raise HTTPException(400, "Bạn không thể tự xóa tài khoản đang đăng nhập.")
    ensure_superadmin_remains(db, account, deleting=True)
    db.delete(account)
    db.commit()
    return {"message": "Đã xóa tài khoản; thành viên liên kết vẫn được giữ nguyên."}
