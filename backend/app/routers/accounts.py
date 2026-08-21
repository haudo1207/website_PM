from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ..database import get_db
from ..config import settings
from ..models.member import Member
from ..models.user import User
from ..utils.access import (
    ALL_SCOPE,
    default_scope,
    is_valid_scope,
    member_query_for_user,
    user_allowed_scopes,
    valid_data_scopes,
    VALID_ROLES,
    ROLE_SUPER_ADMIN,
    ROLE_LEADER,
    ROLE_MEMBER,
    ROLE_VIEWER,
)
from ..utils.auth import hash_password, require_manager, get_current_user
from ..utils.audit_service import AuditService

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


def _leader_scope_guard(db: Session, caller: User, target: User) -> None:
    """A Leader may only operate on accounts assigned to their own
    Workspace(s). Super Admin accounts are already blocked by _leader_guard;
    this closes the remaining hole where a Leader could reach a Member/Viewer
    account of another Workspace by guessing its ID."""
    if caller.role != ROLE_LEADER:
        return
    scopes = user_allowed_scopes(db, caller)
    if scopes == ALL_SCOPE:
        return
    if (target.data_scope or "").strip().lower() not in scopes:
        raise HTTPException(403, "Leader chỉ được thao tác tài khoản trong Workspace của mình.")


def _ensure_leader_allowed_role(caller: User, role: str) -> None:
    if caller.role == ROLE_LEADER and role not in LEADER_MANAGED_ROLES:
        raise HTTPException(403, "Leader chỉ có quyền gán role Member hoặc Viewer.")


def account_to_dict(u: User) -> dict:
    created_at = u.created_at
    if created_at is not None and not hasattr(created_at, "isoformat"):
        created_at = str(created_at)

    member_info = None
    member = None
    try:
        member = u.member if u.member_id else None
    except Exception:
        member = None
    if member:
        member_info = {
            "id": member.id,
            "display_name": member.display_name,
            "full_name": member.full_name,
            "team": member.team,
            "position": member.position,
            "department": member.department,
        }
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "avatar_url": u.avatar_url,
        "outlook_mail": u.outlook_mail,
        "role": u.role,
        "data_scope": u.data_scope,
        "is_active": u.is_active,
        "member_id": u.member_id,
        "member": member_info,
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else created_at,
    }


@router.get("")
def list_accounts(db: Session = Depends(get_db), caller=Depends(require_manager)):
    query = db.query(User)
    if getattr(caller, "role", None) == ROLE_LEADER:
        # Leader scope: only Leader/Member/Viewer accounts assigned to the
        # Leader's own Workspace(s). Super Admin accounts are NEVER visible
        # to a Leader, regardless of Workspace — enforced server-side, so it
        # cannot be bypassed through query parameters or filters.
        query = query.filter(~User.role.in_(SUPER_ADMIN_ROLES))
        scopes = user_allowed_scopes(db, caller)
        if scopes != ALL_SCOPE:
            query = query.filter(User.data_scope.in_(scopes))
    users = query.order_by(User.id.asc()).all()
    return [account_to_dict(u) for u in users]


@router.get("/available-members")
def available_members(db: Session = Depends(get_db), caller=Depends(require_manager)):
    query = db.query(Member)
    if getattr(caller, "role", None) == ROLE_LEADER:
        # Leader may only link Members belonging to their own Workspace(s).
        query = query.filter(Member.id.in_(member_query_for_user(db, caller).with_entities(Member.id)))
    linked_ids = [
        uid for (uid,) in db.query(User.member_id).filter(User.member_id.isnot(None)).all()
    ]
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
    data_scope = str(body.get("data_scope") or default_scope(db)).strip().lower()
    member_id = body.get("member_id") or None
    outlook_mail = normalize_email(body.get("outlook_mail")) or None

    if not email:
        raise HTTPException(400, "Email không được để trống.")
    if settings.PASSWORD_LOGIN_ENABLED:
        validate_password(password)
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Role không hợp lệ. Chọn một trong: {sorted(VALID_ROLES)}")
    if not is_valid_scope(db, data_scope):
        raise HTTPException(400, f"Phạm vi dữ liệu không hợp lệ. Chọn một trong: {sorted(valid_data_scopes(db))}")
    if db.query(User).filter(func.lower(User.email) == email).first():
        raise HTTPException(400, "Email đã tồn tại.")
    if outlook_mail and db.query(User).filter(func.lower(User.outlook_mail) == outlook_mail).first():
        raise HTTPException(400, "Microsoft Mail đã tồn tại.")

    _ensure_leader_allowed_role(caller, role)
    if caller.role == ROLE_LEADER:
        # A Leader may only create accounts inside their own Workspace(s);
        # the assigned Workspace is authoritative and cannot be overridden
        # through the request body.
        scopes = user_allowed_scopes(db, caller)
        if scopes != ALL_SCOPE and data_scope not in scopes:
            raise HTTPException(403, "Leader chỉ được tạo tài khoản trong Workspace của mình.")

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
        outlook_mail=outlook_mail,
    )
    db.add(account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Email hoặc thành viên liên kết đã được sử dụng.")
    db.refresh(account)
    AuditService.record(
        db=db, user_id=getattr(caller, "id", None), module="User", entity_type="User",
        entity_id=account.id, action="CREATE_USER", resource_name=account.email,
        target_user_id=account.id,
        description=f"Tạo tài khoản '{account.email}' (role={account.role})"
    )
    db.commit()
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
    _leader_scope_guard(db, caller, account)

    old_dict = {
        "email": account.email,
        "full_name": account.full_name,
        "member_id": account.member_id,
        "data_scope": account.data_scope,
        "outlook_mail": account.outlook_mail,
    }
    old_role = account.role

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

    if "outlook_mail" in body:
        new_outlook_mail = normalize_email(body["outlook_mail"]) or None
        if new_outlook_mail:
            duplicate = db.query(User).filter(
                func.lower(User.outlook_mail) == new_outlook_mail,
                User.id != account_id,
            ).first()
            if duplicate:
                raise HTTPException(400, "Microsoft Mail đã tồn tại.")
        if account.outlook_mail != new_outlook_mail:
            account.outlook_mail = new_outlook_mail
            # Re-approve and bind the replacement Microsoft identity on first login.
            account.outlook_sub = None

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
        if not is_valid_scope(db, data_scope):
            raise HTTPException(400, f"Phạm vi dữ liệu không hợp lệ. Chọn một trong: {sorted(valid_data_scopes(db))}")
        if caller.role == ROLE_LEADER:
            # A Leader may only assign a Workspace they are allowed to access.
            scopes = user_allowed_scopes(db, caller)
            if scopes != ALL_SCOPE and data_scope not in scopes:
                raise HTTPException(403, "Leader chỉ được gán Workspace trong phạm vi của mình.")
        if is_bootstrap_superadmin(account) and data_scope != "all":
            raise HTTPException(400, "The bootstrap super-admin must retain access to all data.")
        account.data_scope = data_scope

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Không thể cập nhật do dữ liệu bị trùng.")
    db.refresh(account)

    AuditService.record_diff(
        db=db, user_id=getattr(caller, "id", None), module="User", entity_type="User",
        entity_id=account.id, old_dict=old_dict,
        new_dict={"email": account.email, "full_name": account.full_name, "member_id": account.member_id, "data_scope": account.data_scope, "outlook_mail": account.outlook_mail},
        field_labels={"email": "Email", "full_name": "Họ tên", "member_id": "Thành viên liên kết", "data_scope": "Phạm vi dữ liệu", "outlook_mail": "Microsoft Mail"},
    )
    if old_role != account.role:
        AuditService.record(
            db=db, user_id=getattr(caller, "id", None), module="Permission", entity_type="User",
            entity_id=account.id, action="CHANGE_ROLE", resource_name=account.email,
            target_user_id=account.id, field_name="role", old_value=old_role, new_value=account.role,
            description=f"Đổi role tài khoản '{account.email}': '{old_role}' → '{account.role}'"
        )
    db.commit()
    return account_to_dict(account)


@router.post("/{account_id}/reset-password")
def reset_password(account_id: int, body: dict, db: Session = Depends(get_db), caller=Depends(require_manager)):
    if not settings.PASSWORD_LOGIN_ENABLED:
        raise HTTPException(403, "Password login is disabled.")
    account = require_account(db, account_id)
    _leader_guard(caller, account, "đặt lại mật khẩu")
    _leader_scope_guard(db, caller, account)
    new_password = str(body.get("password") or "")
    validate_password(new_password)
    account.hashed_pw = hash_password(new_password)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(caller, "id", None), module="User", entity_type="User",
        entity_id=account.id, action="RESET_PASSWORD", resource_name=account.email,
        target_user_id=account.id,
        description=f"Đặt lại mật khẩu cho tài khoản '{account.email}'"
    )
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
    _leader_scope_guard(db, caller, account)
    if is_bootstrap_superadmin(account):
        raise HTTPException(400, "The bootstrap super-admin cannot be locked.")
    if caller.id == account.id:
        raise HTTPException(400, "Bạn không thể tự khóa tài khoản đang đăng nhập.")
    ensure_superadmin_remains(db, account, active=False)
    account.is_active = False
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(caller, "id", None), module="User", entity_type="User",
        entity_id=account.id, action="LOCK_ACCOUNT", resource_name=account.email,
        target_user_id=account.id,
        description=f"Khóa tài khoản '{account.email}'"
    )
    db.commit()
    return {"message": "Đã khóa tài khoản."}


@router.post("/{account_id}/unlock")
def unlock_account(account_id: int, db: Session = Depends(get_db), caller=Depends(require_manager)):
    account = require_account(db, account_id)
    _leader_guard(caller, account, "mở khóa")
    _leader_scope_guard(db, caller, account)
    account.is_active = True
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(caller, "id", None), module="User", entity_type="User",
        entity_id=account.id, action="UNLOCK_ACCOUNT", resource_name=account.email,
        target_user_id=account.id,
        description=f"Mở khóa tài khoản '{account.email}'"
    )
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
    _leader_scope_guard(db, caller, account)
    if is_bootstrap_superadmin(account):
        raise HTTPException(400, "The bootstrap super-admin cannot be deleted.")
    if caller.id == account.id:
        raise HTTPException(400, "Bạn không thể tự xóa tài khoản đang đăng nhập.")
    ensure_superadmin_remains(db, account, deleting=True)
    acc_email, acc_id = account.email, account.id
    db.delete(account)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(caller, "id", None), module="User", entity_type="User",
        entity_id=acc_id, action="DELETE_USER", resource_name=acc_email,
        description=f"Xóa tài khoản '{acc_email}'"
    )
    db.commit()
    return {"message": "Đã xóa tài khoản; thành viên liên kết vẫn được giữ nguyên."}
