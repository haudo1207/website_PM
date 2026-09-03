from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..models.workspace_access import UserWorkspaceAccess
from ..models.system_category import Workspace
from ..utils.auth import require_admin, hash_password, get_current_user
from ..utils.access import ALL_SCOPE, default_scope, is_valid_scope, valid_data_scopes
from .accounts import (
    VALID_ROLES,
    ensure_superadmin_remains,
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
    role = body.get("role", "member")
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Invalid role. Must be one of: {VALID_ROLES}")
    data_scope = str(body.get("data_scope") or default_scope(db)).strip().lower()
    if not is_valid_scope(db, data_scope):
        raise HTTPException(400, f"Invalid data_scope. Must be one of: {sorted(valid_data_scopes(db))}")
    
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

    from ..utils.audit_service import AuditService
    AuditService.record(
        db=db,
        user_id=admin.id,
        module="User",
        entity_type="User",
        entity_id=u.id,
        action="CREATE_USER",
        severity="INFO",
        description=f"Tạo tài khoản mới '{u.email}' (Role: {u.role})",
    )
    db.commit()
    return {"id":u.id,"email":u.email,"role":u.role,"data_scope":u.data_scope}

@router.put("/{uid}")
def update_user(uid: int, body: dict, db: Session = Depends(get_db), admin=Depends(require_admin)):
    u = db.query(User).filter(User.id == uid).first()
    if not u:
        raise HTTPException(404)
    old_role = u.role
    old_active = u.is_active

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
            if not is_valid_scope(db, value):
                raise HTTPException(400, f"Invalid data_scope. Must be one of: {sorted(valid_data_scopes(db))}")
            u.data_scope = value
        elif k == "email":
            email = normalize_email(v)
            if not email:
                raise HTTPException(400, "Email is required")
            duplicate = db.query(User).filter(User.email == email, User.id != uid).first()
            if duplicate:
                raise HTTPException(400, "Email exists")
            if u.email != email:
                u.email = email
                u.google_sub = None
                u.avatar_url = None
        elif k == "role":
            role = str(v).strip().lower()
            if role not in VALID_ROLES:
                raise HTTPException(400, f"Invalid role. Must be one of: {VALID_ROLES}")
            if admin.id == u.id and role != "super_admin":
                raise HTTPException(400, "You cannot demote your own admin account")
            ensure_superadmin_remains(db, u, role=role)
            u.role = role
        elif k == "is_active":
            is_active = bool(v)
            if admin.id == u.id and not is_active:
                raise HTTPException(400, "You cannot lock your own account")
            ensure_superadmin_remains(db, u, active=is_active)
            u.is_active = is_active
        elif hasattr(u, k) and k not in ["id", "hashed_pw", "member_id", "created_at"]:
            setattr(u, k, v)

    from ..utils.audit_service import AuditService
    admin_name = admin.full_name or admin.email or "Admin"
    target_name = u.full_name or u.email or f"User #{u.id}"
    evt_id = str(uuid.uuid4())

    if "role" in body and body["role"] != old_role:
        AuditService.record(
            db=db,
            user_id=admin.id,
            module="Permission",
            entity_type="User",
            entity_id=u.id,
            resource_name=target_name,
            action="CHANGE_ROLE",
            severity="CRITICAL",
            field_name="role",
            old_value=old_role,
            new_value=u.role,
            description=f"Admin {admin_name} đổi quyền {target_name}: {old_role} ➔ {u.role}",
            event_id=evt_id
        )
    if "is_active" in body and body["is_active"] != old_active:
        action_name = "LOCK_ACCOUNT" if not u.is_active else "UNLOCK_ACCOUNT"
        AuditService.record(
            db=db,
            user_id=admin.id,
            module="User",
            entity_type="User",
            entity_id=u.id,
            resource_name=target_name,
            action=action_name,
            severity="CRITICAL" if not u.is_active else "INFO",
            field_name="is_active",
            old_value=str(old_active),
            new_value=str(u.is_active),
            description=f"Admin {admin_name} {'khóa' if not u.is_active else 'mở khóa'} tài khoản {target_name}",
            event_id=evt_id
        )
    
    AuditService.record(
        db=db,
        user_id=admin.id,
        module="User",
        entity_type="User",
        entity_id=u.id,
        resource_name=target_name,
        action="UPDATE_USER",
        severity="INFO",
        description=f"Admin {admin_name} cập nhật thông tin tài khoản {target_name}",
        event_id=evt_id
    )

    db.commit()
    return {"message": "Updated"}

@router.delete("/{uid}")
def delete_user(uid: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    u = db.query(User).filter(User.id == uid).first()
    if not u:
        raise HTTPException(404)
    if admin.id == u.id:
        raise HTTPException(400, "You cannot delete your own account")
    ensure_superadmin_remains(db, u, deleting=True)

    from ..utils.audit_service import AuditService
    admin_name = admin.full_name or admin.email or "Admin"
    target_name = u.full_name or u.email or f"User #{u.id}"
    AuditService.record(
        db=db,
        user_id=admin.id,
        module="User",
        entity_type="User",
        entity_id=u.id,
        resource_name=target_name,
        action="DELETE_USER",
        severity="CRITICAL",
        description=f"Admin {admin_name} đã xóa vĩnh viễn tài khoản {target_name}",
    )
    db.delete(u)
    db.commit()
    return {"message": "Deleted"}

@router.get("/me")
def me(user=Depends(get_current_user), db: Session = Depends(get_db)):
    member = user.member
    skills = [s.name for s in user.skills] or ([s.name for s in member.skills] if member else [])

    # Surface the full Workspace grant list (multi-Workspace support for
    # Leaders) — additive to the legacy `data_scope` column. Super Admins
    # receive every active Workspace and `workspace_scope='all'` so callers
    # know they have global access.
    if (user.role or "").strip().lower() == "super_admin" or (user.data_scope or "").strip().lower() == ALL_SCOPE:
        workspace_ids = [ALL_SCOPE]
        workspaces = [
            {"id": w.id, "code": w.code, "name": w.name, "is_primary": False}
            for w in db.query(Workspace).order_by(Workspace.id.asc()).all()
        ]
    else:
        # Primary (Chính) Workspace first — the Navbar's fixed label shows
        # only this one, with any Phụ ones surfaced as a secondary count
        # rather than joined into the main label (see WorkspaceSwitcher).
        rows = (
            db.query(Workspace, UserWorkspaceAccess.is_primary)
            .join(UserWorkspaceAccess, UserWorkspaceAccess.workspace_id == Workspace.id)
            .filter(UserWorkspaceAccess.user_id == user.id)
            .order_by(UserWorkspaceAccess.is_primary.desc(), Workspace.id.asc())
            .all()
        )
        workspace_ids = [w.code for w, _ in rows]
        workspaces = [{"id": w.id, "code": w.code, "name": w.name, "is_primary": bool(is_primary)} for w, is_primary in rows]
        if not workspace_ids and user.data_scope:
            workspace_ids = [(user.data_scope or "").strip().lower()]

    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url,
        "role": user.role,
        "data_scope": user.data_scope,
        "workspace_ids": workspace_ids,
        "workspaces": workspaces,
        "member_id": user.member_id,
        "is_active": user.is_active,
        "login_method": "Google OAuth" if user.google_sub else ("Microsoft OAuth" if user.outlook_sub else "Password"),
        "position": user.position or (member.position if member else None),
        "department": user.department or (member.department if member else None),
        "skills": skills,
        "member": {
            "display_name": member.display_name,
            "team": member.team,
            "phone": member.phone,
            "experience_year": member.experience_year,
            "leader_name": member.leader_name,
            "zalo_name": member.zalo_name,
        } if member else None,
    }


class UpdateZaloNameRequest(BaseModel):
    zalo_name: str


@router.patch("/me/zalo-name")
def update_my_zalo_name(payload: UpdateZaloNameRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Self-service — any user sets their OWN Zalo display name here so the
    Zalo task-assignment feature (@mention resolution, roster matching) can
    recognize them; admins can additionally set it for anyone else via the
    Members admin panel (PUT /members/{id})."""
    member = user.member
    if not member:
        raise HTTPException(400, "Tài khoản chưa liên kết hồ sơ nhân sự, không thể đặt tên Zalo.")
    zalo_name = payload.zalo_name.strip()
    member.zalo_name = zalo_name or None
    db.commit()
    return {"zalo_name": member.zalo_name}


@router.get("/me/login-history")
def my_login_history(limit: int = 20, db: Session = Depends(get_db), user=Depends(get_current_user)):
    from ..models.audit_log import AuditLog
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.module == "Authentication", AuditLog.user_id == user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(min(limit, 50))
        .all()
    )
    return [l.to_dict() for l in logs]
