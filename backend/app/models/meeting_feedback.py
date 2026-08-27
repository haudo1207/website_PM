from sqlalchemy import Column, Integer, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base


class MeetingFeedback(Base):
    """Post-meeting quick feedback ("Hữu ích / Chưa hữu ích") — feeds the
    Feedback (5đ) dimension of the meeting effectiveness score."""
    __tablename__ = "meeting_feedback"

    id         = Column(Integer, primary_key=True, index=True)
    meeting_id = Column(Integer, ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    member_id  = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    helpful    = Column(Boolean, nullable=False)
    comment    = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    meeting    = relationship("Meeting", lazy="select")
    member     = relationship("Member", lazy="select")
