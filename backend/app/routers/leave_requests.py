from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload
from typing import Optional
from datetime import datetime
import logging
import re

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

_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _validate_hourly(body: dict) -> tuple:
    """Hourly Leave = ONE date + start time + end time, end after start.

    Returns (start_time, end_time), both None for a regular full-day request.
    Cross-day hourly leave is explicitly NOT supported (start_date must equal
    end_date whenever times are provided).
    """
    start_time = (body.get('start_time') or '').strip() or None
    end_time = (body.get('end_time') or '').strip() or None
    if not start_time and not end_time:
        return None, None
    if not start_time or not end_time:
        raise HTTPException(400, "Nghỉ theo giờ phải có cả giờ bắt đầu và giờ kết thúc.")
    if not _HHMM_RE.match(start_time) or not _HHMM_RE.match(end_time):
        raise HTTPException(400, "Giờ phải theo định dạng HH:MM.")
    if body.get('start_date') != body.get('end_date'):
        raise HTTPException(400, "Nghỉ theo giờ chỉ áp dụng trong MỘT ngày (không hỗ trợ-cross ngày).")
    if start_time >= end_time:
        raise HTTPException(400, "Giờ kết thúc phải sau giờ bắt đầu.")
    return start_time, end_time



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
        "man_day": float(lr.man_day) if lr.man_day is not None else None,
        "month": lr.month,
        "year": lr.year,
        "time": lr.time,
        "start_time": lr.start_time,
        "end_time": lr.end_time,
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
    start_time, end_time = _validate_hourly(body)
    # Hourly OFF = 0.5 man-day (server-authoritative business rule); full-day
    # requests keep the existing frontend-computed man_day untouched.
    man_day = 0.5 if start_time else body.get('man_day', 1)
    leave_request = LeaveRequest(
        user_id=current_user.id,
        leave_type=body.get('leave_type'),
        start_date=body.get('start_date'),
        end_date=body.get('end_date'),
        man_day=man_day,
        month=body.get('month', ''),
        year=body.get('year', datetime.now().year),
        time=body.get('time', ''),
        start_time=start_time,
        end_time=end_time,
        province=body.get('province', ''),
        ward=body.get('ward', ''),
        address=body.get('address'),
        reason=body.get('reason', ''),
        # Auto-approve: every authenticated user who is currently allowed to
        # POST /leave-requests gets the new Leave saved as Approved immediately.
        # The body's `status` is intentionally ignored — the backend is the
        # authoritative enforcement point (project.md §1A, §4). Existing
        # authorization is unchanged: there is still no extra role gate on
        # create, so this applies to whichever roles the endpoint already
        # accepts (member/leader/super_admin/viewer).
        status='Approved',
    )
    db.add(leave_request)
    db.commit()
    db.refresh(leave_request)
    lr = db.query(LeaveRequest).options(selectinload(LeaveRequest.user).selectinload(User.member)).filter(LeaveRequest.id == leave_request.id).first()

    # ── In-app Notification Bell (recipient = creator's direct Leader) ──
    # Reuses the existing `notifications` table + /api/notifications/inbox +
    # Navbar bell. Resolves the direct Leader through the canonical
    # organizational chain: LeaveRequest.user_id -> User -> User.member_id ->
    # Member -> Member.leader_member_id -> Leader Member -> Leader User.
    # Best-effort: any failure here (no member link, no leader, no leader user
    # account) is logged and swallowed — it must never fail or roll back a
    # successfully created Leave Request, and we never invent a fallback
    # recipient.
    try:
        creator_member_id = getattr(current_user, "member_id", None)
        creator_member = db.query(Member).filter(Member.id == creator_member_id).first() if creator_member_id else None
        leader_member_id = getattr(creator_member, "leader_member_id", None) if creator_member else None
        leader_user = (
            db.query(User).filter(User.member_id == leader_member_id).first()
            if leader_member_id else None
        )
        if leader_user:
            creator_name = current_user.full_name or current_user.email or f"user-{current_user.id}"
            if lr.start_time and lr.end_time:
                date_text = f"{lr.start_date} {lr.start_time} → {lr.end_time}"
            elif lr.start_date == lr.end_date:
                date_text = lr.start_date
            else:
                date_text = f"{lr.start_date} → {lr.end_date}"
            db.add(Notification(
                recipient_id=leader_user.id,
                sender_id=current_user.id,
                message=f"🔔 {creator_name} đã tạo đơn nghỉ phép {date_text}. Đơn đã được tự động Duyệt.",
                notification_type="leave_request_created",
                is_read=False,
            ))
            db.commit()
    except Exception as exc:
        logger.error("In-app Leave notification failed for Leave Request #%s: %s", lr.id, exc)

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
    if any(k in body for k in ('start_time', 'end_time', 'start_date', 'end_date')):
        # Re-validate hourly consistency against the EFFECTIVE post-update
        # values (times may be added to an existing full-day row and vice
        # versa) — same single-date/end-after-start rules as create.
        effective = {
            'start_date': body.get('start_date', lr.start_date),
            'end_date': body.get('end_date', lr.end_date),
            'start_time': body.get('start_time', lr.start_time),
            'end_time': body.get('end_time', lr.end_time),
        }
        _validate_hourly(effective)
    for field in ['leave_type', 'start_date', 'end_date', 'man_day', 'month', 'year', 'time',
                  'start_time', 'end_time',
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