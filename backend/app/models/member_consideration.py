"""
MemberConsideration — "Nhân sự đang được xem xét" per-user selection list.
Mỗi user có một danh sách riêng các member họ đang xem xét để mượn.
Đây là trạng thái cá nhân, không chia sẻ giữa các user.
"""
from sqlalchemy import Column, Integer, DateTime, ForeignKey, func, UniqueConstraint
from sqlalchemy.orm import relationship
from ..database import Base


class MemberConsideration(Base):
    __tablename__ = "member_considerations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    member_id = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", foreign_keys=[user_id], lazy="joined")
    member = relationship("Member", foreign_keys=[member_id], lazy="joined")

    __table_args__ = (
        UniqueConstraint("user_id", "member_id", name="uq_user_member_consideration"),
    )
