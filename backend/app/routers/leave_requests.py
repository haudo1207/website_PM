from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import Optional
from datetime import datetime

from ..database import get_db
from ..models.leave_request import LeaveRequest
from ..models.user import User
from ..utils.auth import get_current_user, require_admin

router = APIRouter()

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
        "user": {
            "id": lr.user.id,
            "full_name": lr.user.full_name,
            "email": lr.user.email,
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
    q = db.query(LeaveRequest).options(joinedload(LeaveRequest.user))

    # Admin can see all, regular users can only see their own
    if current_user.role != 'admin':
        q = q.filter(LeaveRequest.user_id == current_user.id)
    else:
        # Admin can filter by specific user if provided
        if user_id:
            q = q.filter(LeaveRequest.user_id == user_id)

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
    lr = db.query(LeaveRequest).options(joinedload(LeaveRequest.user)).filter(LeaveRequest.id == id).first()
    if not lr:
        raise HTTPException(404, "Không tìm thấy leave request")
    
    # Check permission: admin can see all, user can only see their own
    if current_user.role != 'admin' and lr.user_id != current_user.id:
        raise HTTPException(403, "Không có quyền xem")
    
    return leave_to_dict(lr)

# CREATE LEAVE REQUEST
@router.post("")
def create_leave_request(body: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
        status=body.get('status', 'Pending'),
    )
    db.add(leave_request)
    db.commit()
    db.refresh(leave_request)
    lr = db.query(LeaveRequest).options(joinedload(LeaveRequest.user)).filter(LeaveRequest.id == leave_request.id).first()
    return leave_to_dict(lr)

# UPDATE LEAVE REQUEST
@router.put("/{id}")
def update_leave_request(id: int, body: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lr = db.query(LeaveRequest).filter(LeaveRequest.id == id).first()
    if not lr:
        raise HTTPException(404, "Không tìm thấy leave request")
    
    # Check permission: only admin or owner can update
    if current_user.role != 'admin' and lr.user_id != current_user.id:
        raise HTTPException(403, "Không có quyền sửa")
    
    # Only admin can change status
    if 'status' in body and current_user.role != 'admin':
        raise HTTPException(403, "Chỉ admin mới có quyền thay đổi trạng thái")
    
    for field in ['leave_type', 'start_date', 'end_date', 'man_day', 'month', 'year', 'time',
                  'province', 'ward', 'address', 'reason', 'status']:
        if field in body:
            setattr(lr, field, body[field])
    
    db.commit()
    db.refresh(lr)
    lr = db.query(LeaveRequest).options(joinedload(LeaveRequest.user)).filter(LeaveRequest.id == id).first()
    return leave_to_dict(lr)

# DELETE LEAVE REQUEST
@router.delete("/{id}")
def delete_leave_request(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lr = db.query(LeaveRequest).filter(LeaveRequest.id == id).first()
    if not lr:
        raise HTTPException(404, "Không tìm thấy leave request")
    
    # Check permission: only admin or owner can delete
    if current_user.role != 'admin' and lr.user_id != current_user.id:
        raise HTTPException(403, "Không có quyền xóa")
    
    db.delete(lr)
    db.commit()
    return {"message": "Đã xóa leave request thành công"}

# APPROVE/REJECT LEAVE REQUEST (admin only)
@router.patch("/{id}/approve")
def approve_leave_request(id: int, body: dict, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    lr = db.query(LeaveRequest).filter(LeaveRequest.id == id).first()
    if not lr:
        raise HTTPException(404, "Không tìm thấy leave request")
    
    status = body.get('status')
    if status not in ['Approved', 'Rejected']:
        raise HTTPException(400, "Status phải là Approved hoặc Rejected")
    
    lr.status = status
    db.commit()
    db.refresh(lr)
    lr = db.query(LeaveRequest).options(joinedload(LeaveRequest.user)).filter(LeaveRequest.id == id).first()
    return leave_to_dict(lr)