from sqlalchemy import Column, Integer, String, Time, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from ..database import Base


class MeetingAttendance(Base):
    """Manual per-participant attendance record (chốt 2026-09-15) — recorded
    by can_manage only AFTER a meeting reaches DONE (never while ONGOING: a
    member could still join late). Deliberately never inferred from Google
    Calendar responseStatus — an RSVP says nothing about who actually showed
    up. One row per (meeting_id, member_id), upserted by
    POST /meetings/{id}/attendance."""
    __tablename__ = "meeting_attendances"
    __table_args__ = (
        UniqueConstraint("meeting_id", "member_id", name="uq_meeting_attendance_meeting_member"),
    )

    id           = Column(Integer, primary_key=True, index=True)
    meeting_id   = Column(Integer, ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    member_id    = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    status       = Column(String(20), nullable=False)  # ON_TIME, LATE, NO_SHOW
    # Optional even when status=LATE — "don't know the exact time" stays
    # null rather than guessing/defaulting to "now" (chốt 2026-09-15).
    joined_at    = Column(Time, nullable=True)
    late_minutes = Column(Integer, nullable=True)  # server-computed from joined_at vs Meeting.start_time
    recorded_by  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    recorded_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())

    meeting = relationship("Meeting", lazy="select")
    member  = relationship("Member", lazy="select")
