"""
Project Skill — mượn/trả người giữa các dự án.

Mọi Leader/Super Admin gửi được yêu cầu mượn 1 Member cho dự án của mình.
Chính Member bị mượn hoặc Leader phụ trách tự đồng ý/từ chối kèm lý do.
Chỉ một trong hai cần approve/reject.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import Optional, List
from datetime import datetime, date

from ..database import get_db
from ..utils.auth import get_current_user, require_audit_user
from ..models.member_loan_request import MemberLoanRequest
from ..models.member_consideration import MemberConsideration
from ..models.member import Member
from ..models.project import Project
from ..models.user import User
from ..models.notification import Notification

router = APIRouter()


def _loan_to_dict(loan: MemberLoanRequest) -> dict:
    return {
        "id": loan.id,
        "project_id": loan.project_id,
        "project_name": loan.project.name if loan.project else None,
        "member_id": loan.member_id,
        "member_name": loan.member.display_name if loan.member else None,
        "requested_by_user_id": loan.requested_by_user_id,
        "requested_by_name": loan.requested_by.full_name if loan.requested_by else None,
        "status": loan.status,
        "message": loan.message,
        "reason": loan.reason,
        "start_date": loan.start_date.isoformat() if loan.start_date else None,
        "end_date": loan.end_date.isoformat() if loan.end_date else None,
        "decided_by_user_id": loan.decided_by_user_id,
        "created_at": loan.created_at.isoformat() if loan.created_at else None,
        "decided_at": loan.decided_at.isoformat() if loan.decided_at else None,
    }


def _consideration_to_dict(c: MemberConsideration) -> dict:
    return {
        "id": c.id,
        "member_id": c.member_id,
        "member_name": c.member.display_name if c.member else None,
        "member_team": c.member.team if c.member else None,
        "member_department": c.member.department if c.member else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _get_member_busy_periods(db: Session, member_id: int, check_date: date = None) -> List[dict]:
    """Get all approved borrowing periods for a member that are currently active or future."""
    today = check_date or date.today()
    loans = db.query(MemberLoanRequest).filter(
        MemberLoanRequest.member_id == member_id,
        MemberLoanRequest.status == "accepted",
        MemberLoanRequest.start_date.isnot(None),
        MemberLoanRequest.end_date.isnot(None),
    ).all()
    
    periods = []
    for loan in loans:
        if loan.end_date >= today:
            periods.append({
                "start_date": loan.start_date.isoformat(),
                "end_date": loan.end_date.isoformat(),
                "project_name": loan.project.name if loan.project else None,
            })
    return periods


def _is_member_busy_on(db: Session, member_id: int, check_date: date) -> Optional[dict]:
    """Check if member is busy on a specific date. Returns the period info if busy."""
    loan = db.query(MemberLoanRequest).filter(
        MemberLoanRequest.member_id == member_id,
        MemberLoanRequest.status == "accepted",
        MemberLoanRequest.start_date <= check_date,
        MemberLoanRequest.end_date >= check_date,
    ).first()
    
    if loan:
        return {
            "start_date": loan.start_date.isoformat(),
            "end_date": loan.end_date.isoformat(),
            "project_name": loan.project.name if loan.project else None,
        }
    return None


def _has_date_overlap(db: Session, member_id: int, start_date: date, end_date: date, exclude_loan_id: int = None) -> Optional[dict]:
    """Check if the proposed period overlaps with any existing approved reservation."""
    query = db.query(MemberLoanRequest).filter(
        MemberLoanRequest.member_id == member_id,
        MemberLoanRequest.status == "accepted",
        MemberLoanRequest.start_date <= end_date,
        MemberLoanRequest.end_date >= start_date,
    )
    if exclude_loan_id:
        query = query.filter(MemberLoanRequest.id != exclude_loan_id)
    
    loan = query.first()
    if loan:
        return {
            "start_date": loan.start_date.isoformat(),
            "end_date": loan.end_date.isoformat(),
            "project_name": loan.project.name if loan.project else None,
        }
    return None


# ─── CONSIDERATION LIST (Nhân sự đang được xem xét) ───────────────────────

@router.get("/considerations")
def list_considerations(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get the current user's consideration list."""
    items = db.query(MemberConsideration).filter(
        MemberConsideration.user_id == current_user.id
    ).order_by(MemberConsideration.created_at.desc()).all()
    
    result = []
    for c in items:
        item = _consideration_to_dict(c)
        item["busy_info"] = _get_member_busy_periods(db, c.member_id)
        result.append(item)
    return result


@router.post("/considerations")
def add_consideration(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Add a member to the current user's consideration list."""
    member_id = body.get("member_id")
    if not member_id:
        raise HTTPException(400, "Thiếu member_id")
    
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(404, "Không tìm thấy member")
    
    existing = db.query(MemberConsideration).filter(
        MemberConsideration.user_id == current_user.id,
        MemberConsideration.member_id == member_id,
    ).first()
    
    if existing:
        return _consideration_to_dict(existing)
    
    c = MemberConsideration(user_id=current_user.id, member_id=member_id)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _consideration_to_dict(c)


@router.delete("/considerations/{member_id}")
def remove_consideration(
    member_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Remove a member from the current user's consideration list."""
    c = db.query(MemberConsideration).filter(
        MemberConsideration.user_id == current_user.id,
        MemberConsideration.member_id == member_id,
    ).first()
    
    if not c:
        raise HTTPException(404, "Không tìm thấy trong danh sách xem xét")
    
    db.delete(c)
    db.commit()
    return {"message": "Đã xóa"}


@router.get("/considerations/check/{member_id}")
def check_consideration(
    member_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Check if a member is in the current user's consideration list."""
    c = db.query(MemberConsideration).filter(
        MemberConsideration.user_id == current_user.id,
        MemberConsideration.member_id == member_id,
    ).first()
    return {"in_consideration": c is not None}


# ─── BUSY STATE ────────────────────────────────────────────────────────────

@router.get("/busy/{member_id}")
def get_member_busy(
    member_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get busy periods for a member."""
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(404, "Không tìm thấy member")
    
    periods = _get_member_busy_periods(db, member_id)
    today = date.today()
    currently_busy = _is_member_busy_on(db, member_id, today)
    
    return {
        "member_id": member_id,
        "busy_periods": periods,
        "currently_busy": currently_busy is not None,
        "current_busy_info": currently_busy,
    }


@router.get("/check-overlap")
def check_overlap(
    member_id: int,
    start_date: str,
    end_date: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Check if a proposed period overlaps with existing reservations."""
    try:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        ed = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Định dạng ngày không hợp lệ (YYYY-MM-DD)")
    
    if ed < sd:
        raise HTTPException(400, "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu")
    
    overlap = _has_date_overlap(db, member_id, sd, ed)
    return {
        "has_overlap": overlap is not None,
        "overlap_info": overlap,
    }


# ─── ELIGIBLE MEMBERS ──────────────────────────────────────────────────────

@router.get("/eligible-members")
def list_eligible_members(
    exclude_own_team: bool = True,
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Danh sách member có thể chọn để gửi yêu cầu mượn — chỉ những người
    trong consideration list và không đang bận."""
    considerations = db.query(MemberConsideration).filter(
        MemberConsideration.user_id == current_user.id
    ).all()
    
    if not considerations:
        return []
    
    member_ids = [c.member_id for c in considerations]
    members = db.query(Member).filter(
        Member.id.in_(member_ids),
        Member.employment_status == "ON",
    ).order_by(Member.display_name).all()
    
    today = date.today()
    result = []
    for m in members:
        busy_info = _is_member_busy_on(db, m.id, today)
        result.append({
            "id": m.id,
            "display_name": m.display_name,
            "team": m.team,
            "department": m.department,
            "position": m.position,
            "currently_busy": busy_info is not None,
            "busy_info": busy_info,
        })
    return result


# ─── LOAN REQUESTS ─────────────────────────────────────────────────────────

@router.post("/requests")
def create_loan_request(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Create a borrowing request with date range."""
    project_id = body.get("project_id")
    member_id = body.get("member_id")
    message = (body.get("message") or "").strip() or None
    start_date_str = body.get("start_date")
    end_date_str = body.get("end_date")
    
    if not project_id or not member_id:
        raise HTTPException(400, "Thiếu project_id hoặc member_id")
    if not start_date_str or not end_date_str:
        raise HTTPException(400, "Thiếu ngày bắt đầu hoặc ngày kết thúc")
    
    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Định dạng ngày không hợp lệ (YYYY-MM-DD)")
    
    if end_date < start_date:
        raise HTTPException(400, "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu")
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Không tìm thấy dự án")
    
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(404, "Không tìm thấy member")
    
    if member.employment_status != "ON":
        raise HTTPException(400, "Member này không còn hoạt động")
    
    overlap = _has_date_overlap(db, member_id, start_date, end_date)
    if overlap:
        raise HTTPException(400, f"Member đang bận trong giai đoạn {overlap['start_date']} → {overlap['end_date']} (dự án: {overlap['project_name']})")
    
    loan = MemberLoanRequest(
        project_id=project_id,
        member_id=member_id,
        requested_by_user_id=current_user.id,
        message=message,
        status="pending",
        start_date=start_date,
        end_date=end_date,
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)
    
    consideration = db.query(MemberConsideration).filter(
        MemberConsideration.user_id == current_user.id,
        MemberConsideration.member_id == member_id,
    ).first()
    if consideration:
        db.delete(consideration)
        db.commit()
    
    recipients: list[User] = []
    target_user = db.query(User).filter(User.member_id == member.id).first()
    if target_user:
        recipients.append(target_user)
    
    leader_user = None
    if member.leader_member_id:
        leader_user = db.query(User).filter(User.member_id == member.leader_member_id).first()
        if leader_user and (not target_user or leader_user.id != target_user.id):
            recipients.append(leader_user)
    
    requester_name = current_user.full_name or "Một Leader"
    period_str = f"từ {start_date_str} đến {end_date_str}"
    for recipient in recipients:
        is_target = target_user and recipient.id == target_user.id
        is_leader = leader_user and recipient.id == leader_user.id
        if is_target:
            note = f"{requester_name} muốn mượn bạn cho dự án '{project.name}' ({period_str})."
        elif is_leader:
            note = f"{requester_name} đang gửi yêu cầu mượn {member.display_name} (member của bạn) cho dự án '{project.name}' ({period_str})."
        else:
            note = f"{requester_name} muốn mượn {member.display_name} cho dự án '{project.name}' ({period_str})."
        
        db.add(Notification(
            recipient_id=recipient.id,
            sender_id=current_user.id,
            project_id=project_id,
            message=note,
            notification_type="member_loan_request",
        ))
    db.commit()
    
    return _loan_to_dict(loan)


@router.get("/requests")
def list_loan_requests(
    scope: str = "incoming",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """scope=incoming: yêu cầu gửi đến bạn (bạn là member hoặc leader của member).
    scope=outgoing: yêu cầu do CHÍNH BẠN gửi đi."""
    if scope == "outgoing":
        q = db.query(MemberLoanRequest).filter(MemberLoanRequest.requested_by_user_id == current_user.id)
    else:
        if not current_user.member_id:
            return []
        
        member = db.query(Member).filter(Member.id == current_user.member_id).first()
        if not member:
            return []
        
        member_ids = [member.id]
        managed_ids = [m.id for m in db.query(Member.id).filter(Member.leader_member_id == member.id).all()]
        member_ids.extend(managed_ids)
        
        if member.leader_name:
            legacy_managed = db.query(Member.id).filter(
                Member.leader_member_id.is_(None),
                Member.leader_name == member.display_name,
            ).all()
            member_ids.extend([m[0] for m in legacy_managed])
        
        member_ids = list(set(member_ids))
        q = db.query(MemberLoanRequest).filter(MemberLoanRequest.member_id.in_(member_ids))
    
    loans = q.order_by(MemberLoanRequest.created_at.desc()).all()
    return [_loan_to_dict(l) for l in loans]


@router.post("/requests/{loan_id}/respond")
def respond_loan_request(
    loan_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Approve or reject a loan request. Either the target member OR their leader can respond."""
    loan = db.query(MemberLoanRequest).filter(MemberLoanRequest.id == loan_id).first()
    if not loan:
        raise HTTPException(404, "Không tìm thấy yêu cầu")
    if loan.status != "pending":
        raise HTTPException(400, "Yêu cầu này đã được trả lời rồi")
    
    is_target_member = current_user.member_id and loan.member_id == current_user.member_id
    
    is_responsible_leader = False
    if current_user.member_id:
        member = db.query(Member).filter(Member.id == loan.member_id).first()
        if member:
            if member.leader_member_id and member.leader_member_id == current_user.member_id:
                is_responsible_leader = True
            elif member.leader_name:
                current_member = db.query(Member).filter(Member.id == current_user.member_id).first()
                if current_member and member.leader_name == current_member.display_name:
                    is_responsible_leader = True
    
    if not is_target_member and not is_responsible_leader:
        raise HTTPException(403, "Chỉ người được mượn hoặc Leader phụ trách mới trả lời được yêu cầu này")
    
    decision = body.get("decision")
    if decision not in {"accepted", "rejected"}:
        raise HTTPException(400, "decision phải là 'accepted' hoặc 'rejected'")
    
    if decision == "accepted" and loan.start_date and loan.end_date:
        overlap = _has_date_overlap(db, loan.member_id, loan.start_date, loan.end_date, exclude_loan_id=loan.id)
        if overlap:
            raise HTTPException(400, f"Member đang bận trong giai đoạn {overlap['start_date']} → {overlap['end_date']}")
    
    loan.status = decision
    loan.reason = (body.get("reason") or "").strip() or None
    loan.decided_at = datetime.utcnow()
    loan.decided_by_user_id = current_user.id
    db.commit()
    db.refresh(loan)
    
    if loan.requested_by_user_id:
        verb = "đồng ý" if decision == "accepted" else "từ chối"
        period_str = f"({loan.start_date} → {loan.end_date})" if loan.start_date and loan.end_date else ""
        note = f"{current_user.full_name or 'Member'} đã {verb} yêu cầu mượn cho dự án '{loan.project.name if loan.project else ''}' {period_str}."
        if loan.reason:
            note += f" Lý do: {loan.reason}"
        db.add(Notification(
            recipient_id=loan.requested_by_user_id,
            sender_id=current_user.id,
            project_id=loan.project_id,
            message=note,
            notification_type="member_loan_response",
        ))
        db.commit()
    
    return _loan_to_dict(loan)


@router.delete("/requests/{loan_id}")
def cancel_loan_request(
    loan_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Cancel a pending loan request. Only the creator can cancel."""
    loan = db.query(MemberLoanRequest).filter(MemberLoanRequest.id == loan_id).first()
    if not loan:
        raise HTTPException(404, "Không tìm thấy yêu cầu")
    
    if loan.requested_by_user_id != current_user.id:
        raise HTTPException(403, "Chỉ người tạo yêu cầu mới có thể hủy")
    
    if loan.status != "pending":
        raise HTTPException(400, "Chỉ hủy được yêu cầu đang chờ xử lý")
    
    db.delete(loan)
    db.commit()
    return {"message": "Đã hủy yêu cầu"}
