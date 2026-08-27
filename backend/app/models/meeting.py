from sqlalchemy import Column, Integer, String, Text, Date, Time, ForeignKey, DateTime, JSON, func
from sqlalchemy.orm import relationship
from ..database import Base

class Meeting(Base):
    __tablename__ = "meetings"

    id           = Column(Integer, primary_key=True, index=True)
    title        = Column(String(250), nullable=False)
    description  = Column(Text, nullable=True)
    platform     = Column(String(50), nullable=True)
    meeting_url  = Column(Text, nullable=True)
    meeting_date = Column(Date, nullable=False)
    start_time   = Column(Time, nullable=False)
    end_time     = Column(Time, nullable=True)
    status       = Column(String(30), default="UPCOMING")  # UPCOMING, ONGOING, DONE, CANCELLED
    transcript   = Column(Text, nullable=True)
    ai_summary   = Column(JSON, nullable=True)  # Maps to JSONB in PostgreSQL
    project_id   = Column(Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    created_by   = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    created_at   = Column(DateTime, server_default=func.now())
    updated_at   = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Meeting Intelligence — preparation fields (mục tiêu / agenda), scored by
    # meeting_score_engine.recalculate_meeting_score.
    objective        = Column(Text, nullable=True)
    agenda           = Column(Text, nullable=True)
    no_action_reason = Column(Text, nullable=True)

    # Effectiveness score — deterministic, computed from real data (not AI-judged).
    # See backend/app/services/meeting_score_engine.py for the formula.
    score_total              = Column(Integer, nullable=True)
    score_prep               = Column(Integer, nullable=True)
    score_execution          = Column(Integer, nullable=True)
    score_result             = Column(Integer, nullable=True)
    score_followthrough      = Column(Integer, nullable=True)
    score_feedback           = Column(Integer, nullable=True)
    score_status             = Column(String(20), nullable=True, default="provisional")
    last_score_calculated_at = Column(DateTime, nullable=True)

    # Relationships
    project      = relationship("Project", foreign_keys=[project_id], lazy="select")
    creator      = relationship("Member", foreign_keys=[created_by], lazy="select")
    members      = relationship("MeetingMember", back_populates="meeting", cascade="all, delete-orphan")


class MeetingMember(Base):
    __tablename__ = "meeting_members"

    id         = Column(Integer, primary_key=True, index=True)
    meeting_id = Column(Integer, ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    member_id  = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    role       = Column(String(30), default="PARTICIPANT")  # HOST, PM, PARTICIPANT, VIEWER
    joined_at  = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    # Relationships
    meeting    = relationship("Meeting", back_populates="members")
    member     = relationship("Member", lazy="select")
