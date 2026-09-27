"""
Project Skill — mượn/trả người giữa các dự án.

Mọi Leader/Super Admin gửi được yêu cầu mượn 1 Member cho dự án của mình.
Theo yêu cầu: chỉ được chọn người KHÔNG cùng team với chính người gửi yêu
cầu (mượn người từ team khác, không phải chọn lại người trong team mình).
Chính Member bị mượn tự đồng ý/từ chối kèm lý do — Leader hiện tại của
Member đó chỉ được CC thông báo để biết, không tự quyết định thay.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from ..database import get_db
from ..utils.auth import get_current_user, require_audit_user
from ..models.member_loan_request import MemberLoanRequest
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
        "created_at": loan.created_at,
        "decided_at": loan.decided_at,
    }


@router.get("/eligible-members")
def list_eligible_members(
    exclude_own_team: bool = True,
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    """Danh sách member có thể chọn để gửi yêu cầu mượn — mặc định loại bỏ
    người cùng team với chính người gửi (mượn người từ team khác)."""
    own_member = db.query(Member).filter(Member.id == current_user.member_id).first() if current_user.member_id else None
    q = db.query(Member).filter(Member.employment_status == "ON")
    if exclude_own_team and own_member and own_member.team:
        q = q.filter((Member.team != own_member.team) | (Member.team.is_(None)))
    members = q.order_by(Member.display_name).all()
    return [
        {"id": m.id, "display_name": m.display_name, "team": m.team, "department": m.department, "position": m.position}
        for m in members
    ]


@router.post("/requests")
def create_loan_request(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_audit_user),
):
    project_id = body.get("project_id")
    member_id = body.get("member_id")
    message = (body.get("message") or "").strip() or None
    if not project_id or not member_id:
        raise HTTPException(400, "Thiếu project_id hoặc member_id")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Không tìm thấy dự án")
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        raise HTTPException(404, "Không tìm thấy member")

    own_member = db.query(Member).filter(Member.id == current_user.member_id).first() if current_user.member_id else None
    if own_member and own_member.team and member.team and own_member.team == member.team:
        raise HTTPException(400, "Chỉ mượn được người ở team khác — người này đang cùng team với bạn")

    loan = MemberLoanRequest(
        project_id=project_id,
        member_id=member_id,
        requested_by_user_id=current_user.id,
        message=message,
        status="pending",
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)

    # Notification cho chính member bị mượn + CC leader hiện tại của họ.
    recipients: list[User] = []
    target_user = db.query(User).filter(User.member_id == member.id).first()
    if target_user:
        recipients.append(target_user)
    if member.leader_member_id:
        leader_user = db.query(User).filter(User.member_id == member.leader_member_id).first()
        if leader_user and (not target_user or leader_user.id != target_user.id):
            recipients.append(leader_user)

    requester_name = current_user.full_name or "Một Leader"
    for recipient in recipients:
        is_target = target_user and recipient.id == target_user.id
        note = (
            f"{requester_name} muốn mượn bạn cho dự án '{project.name}'."
            if is_target
            else f"{requester_name} đang gửi yêu cầu mượn {member.display_name} (member của bạn) cho dự án '{project.name}'."
        )
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
    """scope=incoming: yêu cầu người khác gửi để mượn CHÍNH BẠN (bạn accept/reject).
    scope=outgoing: yêu cầu do CHÍNH BẠN gửi đi để mượn người khác."""
    if scope == "outgoing":
        q = db.query(MemberLoanRequest).filter(MemberLoanRequest.requested_by_user_id == current_user.id)
    else:
        if not current_user.member_id:
            return []
        q = db.query(MemberLoanRequest).filter(MemberLoanRequest.member_id == current_user.member_id)
    loans = q.order_by(MemberLoanRequest.created_at.desc()).all()
    return [_loan_to_dict(l) for l in loans]


@router.post("/requests/{loan_id}/respond")
def respond_loan_request(
    loan_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    loan = db.query(MemberLoanRequest).filter(MemberLoanRequest.id == loan_id).first()
    if not loan:
        raise HTTPException(404, "Không tìm thấy yêu cầu")
    if not current_user.member_id or loan.member_id != current_user.member_id:
        raise HTTPException(403, "Chỉ chính người được mượn mới trả lời được yêu cầu này")
    if loan.status != "pending":
        raise HTTPException(400, "Yêu cầu này đã được trả lời rồi")

    decision = body.get("decision")
    if decision not in {"accepted", "rejected"}:
        raise HTTPException(400, "decision phải là 'accepted' hoặc 'rejected'")

    loan.status = decision
    loan.reason = (body.get("reason") or "").strip() or None
    loan.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(loan)

    if loan.requested_by_user_id:
        verb = "đồng ý" if decision == "accepted" else "từ chối"
        note = f"{current_user.full_name or 'Member'} đã {verb} yêu cầu mượn cho dự án '{loan.project.name if loan.project else ''}'."
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
