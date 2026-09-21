from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload
from typing import Optional
from datetime import datetime
import logging

from ..database import get_db
from ..models.leave_request import LeaveRequest
from ..models.member import Member
from ..models.notification import Notification
from ..models.user import User
from ..utils.auth import get_current_user, require_admin
from ..utils.access import ROLE_SUPER_ADMIN, ROLE_LEADER, ALL_SCOPE, user_allowed_scopes
from ..utils.audit_service import AuditService

logger = logging.getLogger("leave_requests")

router = APIRouter()


def _leader_scope_ok(db: Session, current_user: User, target_user_id: int) -> bool:
    """A Leader may only view/manage leave requests from users within their
    own Workspace(s); super_admin is unrestricted."""
    if current_user.role == ROLE_SUPER_ADMIN:
        return True
    if current_user.role != ROLE_LEADER:
        return True

    allowed = user_allowed_scopes(db, current_user)
    if allowed == ALL_SCOPE:
        return True

    target_user = db.query(User).filter(User.id == target_user_id).first()
    if not target_user:
        return False

    target_scope = (target_user.data_scope or "").strip().lower()
    # Global scope remains visible to every Leader, matching the app's
    # Workspace-visibility convention used elsewhere in the project.
    return target_scope in allowed or target_scope == ALL_SCOPE

def leave_to_dict(lr: LeaveRequest) -> dict:
    return {
        "id": lr.id,
        "user_id": lr.user_id,
        "leave_type": lr.leave_type,
        "start_date": lr.start_date,
        "end_date": lr.end_date,
        "man_day": lr.man_day,
        "month": lr.month,
        "year": lr.year,
        "time": lr.time,
        "province": lr.province,
        "ward": lr.ward,
        "address": lr.address,
        "reason": lr.reason,
        "status": lr.status,
        "created_at": lr.created_at.isoformat() if lr.created_at else None,
        "updated_at": lr.updated_at.isoformat() if lr.updated_at else None,
        "member_id": lr.user.member_id if lr.user else None,
        "member": {
            "id": lr.user.member.id,
            "full_name": lr.user.member.full_name,
            "member_id": lr.user.member.id,
            "team": lr.user.member.team,
        } if lr.user and lr.user.member else None,
        "user": {
            "id": lr.user.id,
            "full_name": lr.user.full_name,
            "email": lr.user.email,
            "member_id": lr.user.member_id,
        } if lr.user else None,
    }

# LIST LEAVE REQUESTS
@router.get("")
def list_leave_requests(
    status: Optional[str] = None,
    user_id: Optional[int] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    q = db.query(LeaveRequest).options(selectinload(LeaveRequest.user).selectinload(User.member))

    # Super admin can see all; Leader is scoped to their own Company
    # (Workspace); regular users can only see their own.
    if current_user.role == ROLE_SUPER_ADMIN:
        if user_id:
            q = q.filter(LeaveRequest.user_id == user_id)
    elif current_user.role == ROLE_LEADER:
        allowed = user_allowed_scopes(db, current_user)
        if allowed != ALL_SCOPE:
            allowed_scopes = {str(s).strip().lower() for s in allowed if str(s).strip()}
            user_ids_subq = (
                db.query(User.id)
                .filter(or_(User.data_scope.in_(allowed_scopes), User.data_scope == ALL_SCOPE))
                .subquery()
            )
            q = q.filter(LeaveRequest.user_id.in_(user_ids_subq))
        if user_id:
            q = q.filter(LeaveRequest.user_id == user_id)
    else:
        q = q.filter(LeaveRequest.user_id == current_user.id)

    if status:
        q = q.filter(LeaveRequest.status == status)
    if from_date:
        q = q.filter(LeaveRequest.start_date >= from_date)
    if to_date:
        q = q.filter(LeaveRequest.end_date <= to_date)

    leave_requests = q.order_by(LeaveRequest.created_at.desc()).all()
    return [leave_to_dict(lr) for lr in leave_requests]

# GET ONE LEAVE REQUEST
@router.get("/{id}")
def get_leave_request(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lr = db.query(LeaveRequest).options(selectinload(LeaveRequest.user).selectinload(User.member)).filter(LeaveRequest.id == id).first()
    if not lr:
        raise HTTPException(404, "Không tìm thấy leave request")
    
    # Check permission: admin can see all, user can only see their own
    if current_user.role not in {ROLE_SUPER_ADMIN, ROLE_LEADER} and lr.user_id != current_user.id:
        raise HTTPException(403, "Không có quyền xem")
    if not _leader_scope_ok(db, current_user, lr.user_id):
        raise HTTPException(403, "Không có quyền xem (khác Công ty)")

    return leave_to_dict(lr)

# CREATE LEAVE REQUEST
@router.post("")
def create_leave_request(body: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Leave requests are auto-approved on creation (2026-09 requirement).
    # Preserve the status field in body only if it already denotes a terminal
    # state; otherwise force Approved so the flow never stays Pending.
    raw_status = (body.get('status') or 'Pending')
    status = raw_status if raw_status in ('Approved', 'Rejected') else 'Approved'

    leave_request = LeaveRequest(
        user_id=current_user.id,
        leave_type=body.get('leave_type'),
        start_date=body.get('start_date'),
        end_date=body.get('end_date'),
        man_day=body.get('man_day', 1),
        month=body.get('month', ''),
        year=body.get('year', datetime.now().year),
        time=body.get('time', ''),
        province=body.get('province', ''),
        ward=body.get('ward', ''),
        address=body.get('address'),
        reason=body.get('reason', ''),
        status=status,
    )
    db.add(leave_request)
    db.commit()
    db.refresh(leave_request)
    lr = db.query(LeaveRequest).options(selectinload(LeaveRequest.user).selectinload(User.member)).filter(LeaveRequest.id == leave_request.id).first()

    # ── In-app notification to the direct leader (non-blocking) ───────
    # A Leader is whoever this requester's Member.leader_member_id points to.
    try:
        if lr.user and lr.user.member and lr.user.member.leader_member_id:
            leader_member = db.query(Member).filter(Member.id == lr.user.member.leader_member_id).first()
            if leader_member and leader_member.user:
                member_name = lr.user.member.full_name or lr.user.full_name or f"User #{lr.user_id}"
                notif = Notification(
                    recipient_id=leader_member.user.id,
                    sender_id=current_user.id,
                    message=f"{member_name} đã đăng ký {lr.leave_type} từ {lr.start_date} đến {lr.end_date}",
                    notification_type="leave_registered",
                )
                db.add(notif)
                db.commit()
    except Exception as exc:
        logger.error("Leader notification failed for Leave Request #%s: %s", lr.id, exc)
        db.rollback()

    # ── Telegram notification (non-blocking) ─────────────────────────
    # The Leave Request is already saved successfully. Notifying admins is an
    # additional, best-effort step: a Telegram failure must never roll back or
    # fail the request creation, and must never return a 5xx.
    try:
        from ..services.telegram import send_leave_request_notification
        sent = send_leave_request_notification(db, lr)
        if sent:
            logger.info("Telegram notified %s recipient(s) about Leave Request #%s",
                        sent, lr.id)
    except Exception as exc:
        logger.error("Telegram notification failed for Leave Request #%s: %s",
                     lr.id, exc)

    return leave_to_dict(lr)

# UPDATE LEAVE REQUEST
@router.put("/{id}")
def update_leave_request(id: int, body: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lr = db.query(LeaveRequest).filter(LeaveRequest.id == id).first()
    if not lr:
        raise HTTPException(404, "Không tìm thấy leave request")
    
    # Check permission: only admin or owner can update
    if current_user.role not in {ROLE_SUPER_ADMIN, ROLE_LEADER} and lr.user_id != current_user.id:
        raise HTTPException(403, "Không có quyền sửa")
    if not _leader_scope_ok(db, current_user, lr.user_id):
        raise HTTPException(403, "Không có quyền sửa (khác Công ty)")

    # Only admin can change status
    if 'status' in body and current_user.role not in {ROLE_SUPER_ADMIN, ROLE_LEADER}:
        raise HTTPException(403, "Chỉ admin mới có quyền thay đổi trạng thái")

    old_status = lr.status
    for field in ['leave_type', 'start_date', 'end_date', 'man_day', 'month', 'year', 'time',
                  'province', 'ward', 'address', 'reason', 'status']:
        if field in body:
            setattr(lr, field, body[field])

    db.commit()
    db.refresh(lr)
    if 'status' in body and lr.status != old_status and lr.status in ('Approved', 'Rejected'):
        AuditService.record(
            db=db, user_id=getattr(current_user, "id", None), module="Leave Request", entity_type="LeaveRequest",
            entity_id=lr.id, action=lr.status.upper(), target_user_id=lr.user_id,
            field_name="status", old_value=old_status, new_value=lr.status,
            description=f"{'Duyệt' if lr.status == 'Approved' else 'Từ chối'} đơn nghỉ phép #{lr.id} của user #{lr.user_id}"
        )
        db.commit()
    lr = db.query(LeaveRequest).options(selectinload(LeaveRequest.user).selectinload(User.member)).filter(LeaveRequest.id == id).first()
    return leave_to_dict(lr)

# DELETE LEAVE REQUEST
@router.delete("/{id}")
def delete_leave_request(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lr = db.query(LeaveRequest).filter(LeaveRequest.id == id).first()
    if not lr:
        raise HTTPException(404, "Không tìm thấy leave request")
    
    # Check permission: only admin or owner can delete
    if current_user.role not in {ROLE_SUPER_ADMIN, ROLE_LEADER} and lr.user_id != current_user.id:
        raise HTTPException(403, "Không có quyền xóa")
    if not _leader_scope_ok(db, current_user, lr.user_id):
        raise HTTPException(403, "Không có quyền xóa (khác Công ty)")

    lr_id, lr_user_id, lr_status = lr.id, lr.user_id, lr.status
    db.delete(lr)
    db.commit()
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Leave Request", entity_type="LeaveRequest",
        entity_id=lr_id, action="DELETE", target_user_id=lr_user_id,
        description=f"Xóa đơn nghỉ phép #{lr_id} (trạng thái: {lr_status}) của user #{lr_user_id}"
    )
    db.commit()
    return {"message": "Đã xóa leave request thành công"}

# APPROVE/REJECT LEAVE REQUEST (admin only)
@router.patch("/{id}/approve")
def approve_leave_request(id: int, body: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lr = db.query(LeaveRequest).filter(LeaveRequest.id == id).first()
    if not lr:
        raise HTTPException(404, "Không tìm thấy leave request")

    if current_user.role not in {ROLE_SUPER_ADMIN, ROLE_LEADER}:
        raise HTTPException(403, "Không có quyền duyệt đơn nghỉ phép")
    if not _leader_scope_ok(db, current_user, lr.user_id):
        raise HTTPException(403, "Không có quyền duyệt đơn của Workspace khác")

    status = body.get('status')
    if status not in ['Approved', 'Rejected']:
        raise HTTPException(400, "Status phải là Approved hoặc Rejected")

    old_status = lr.status
    # Idempotent: if the leave is already in the requested terminal state,
    # just return it without recording a redundant audit log.
    if old_status == status:
        lr = db.query(LeaveRequest).options(selectinload(LeaveRequest.user).selectinload(User.member)).filter(LeaveRequest.id == id).first()
        return leave_to_dict(lr)

    lr.status = status
    db.commit()
    db.refresh(lr)
    AuditService.record(
        db=db, user_id=getattr(current_user, "id", None), module="Leave Request", entity_type="LeaveRequest",
        entity_id=lr.id, action=status.upper(), target_user_id=lr.user_id,
        field_name="status", old_value=old_status, new_value=status,
        description=f"{'Duyệt' if status == 'Approved' else 'Từ chối'} đơn nghỉ phép #{lr.id} của user #{lr.user_id}"
    )
    db.commit()
    lr = db.query(LeaveRequest).options(selectinload(LeaveRequest.user).selectinload(User.member)).filter(LeaveRequest.id == id).first()
    return leave_to_dict(lr)