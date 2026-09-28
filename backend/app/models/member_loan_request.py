"""
MemberLoanRequest — "Project Skill" mượn/trả người giữa các dự án. Một
Leader/Super Admin gửi yêu cầu mượn 1 Member (thường thuộc team khác) cho dự
án của mình; chính Member đó hoặc Leader phụ trách tự đồng ý/từ chối kèm lý do.
Trạng thái sống trên chính bảng này (không dựa vào Notification — Notification
chỉ là bản tin "có việc cần xem", giống pattern group_approval_request).
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Date, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base


class MemberLoanRequest(Base):
    __tablename__ = "member_loan_requests"

    id                 = Column(Integer, primary_key=True, index=True)
    project_id         = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    member_id          = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status             = Column(String(20), nullable=False, default="pending", server_default="pending")
    message            = Column(Text, nullable=True)
    reason             = Column(Text, nullable=True)
    start_date         = Column(Date, nullable=True)
    end_date           = Column(Date, nullable=True)
    decided_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at         = Column(DateTime, server_default=func.now())
    decided_at         = Column(DateTime, nullable=True)

    project       = relationship("Project", foreign_keys=[project_id], lazy="select")
    member        = relationship("Member", foreign_keys=[member_id], lazy="joined")
    requested_by  = relationship("User", foreign_keys=[requested_by_user_id], lazy="joined")
    decided_by    = relationship("User", foreign_keys=[decided_by_user_id], lazy="select")
