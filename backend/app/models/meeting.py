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
    # Google Calendar event ID for the event created via create_google_meet_shared
    # (shared mkt.szone@gmail.com account) — lets update_meeting reschedule the
    # SAME event via events.patch instead of silently drifting out of sync.
    # NULL for meetings without an auto-generated Google Meet link (manual link,
    # Zoom, Teams, or created before this column existed).
    google_event_id = Column(String(255), nullable=True)
    # The Google account that actually organizes this meeting's Calendar
    # event — captured once, straight from the Calendar API response, at
    # creation/regeneration time (see meeting_sync.create_google_meet_shared).
    # Frozen for this specific meeting: unlike a live per-workspace lookup,
    # it can't drift if the workspace's Google account connection changes
    # later. NULL for meetings created before this column existed, or for
    # non-Google-Meet platforms.
    organizer_google_email = Column(String(255), nullable=True)
    # n8n notify tracking (chốt 2026-09-13): notify_n8n_meeting_created() is a
    # fire-and-forget POST — before this, a failure only logged a warning,
    # with no way for anyone to tell a meeting never actually reached n8n
    # (see backend/app/services/meeting_sync.py). PENDING -> SENT on success,
    # -> FAILED after exhausting retries (n8n_notify_attempts).
    n8n_notify_status = Column(String(20), nullable=False, default="PENDING")
    n8n_notify_attempts = Column(Integer, nullable=False, default=0)
    n8n_notify_last_error = Column(Text, nullable=True)
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

    # Reminder — minutes before start_time to notify participants, and which
    # channels to notify through. See services/meeting_reminders.py for the
    # actual dispatch (App/Telegram/Zalo).
    reminder_minutes = Column(Integer, nullable=False, default=15, server_default="15")
    notify_channels  = Column(JSON, nullable=True)
    # Set once a reminder has been dispatched for this meeting — the claim
    # guard that keeps two uvicorn workers from both sending it (see
    # meeting_reminders._claim_due_meetings).
    reminder_sent_at = Column(DateTime, nullable=True)
    # Set once the "meeting is starting now" link message has been dispatched
    # (fires exactly at start_time, separate from the reminder_minutes-before
    # reminder above) — see meeting_reminders.dispatch_due_start_notifications.
    start_link_sent_at = Column(DateTime, nullable=True)

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

    # Soft delete (chốt 2026-09-13: Delete Meeting an toàn cho Bot/n8n) — never
    # hard-delete a Meeting row. deleted_at/deleted_by are set by DELETE
    # /{id} and every user-facing read filters them out; status is left
    # untouched so it still reflects the real lifecycle (a DONE meeting stays
    # DONE after being "deleted", it's just hidden). The Bot's /ended report
    # and the n8n ingestion webhook deliberately do NOT filter on this column
    # — they must still be able to reach a soft-deleted row (see
    # meeting_bot.py/report_meeting_ended and meetings.py's n8n webhook
    # matcher) so an in-flight Bot session or a late-arriving recording never
    # orphans.
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, nullable=True)  # users.id

    # Relationships
    project      = relationship("Project", foreign_keys=[project_id], lazy="select")
    creator      = relationship("Member", foreign_keys=[created_by], lazy="select")
    members      = relationship("MeetingMember", back_populates="meeting", cascade="all, delete-orphan")
    # Extra dự án ngoài project_id (dự án "chính") — xem models/meeting_project.py
    extra_projects = relationship("MeetingProject", back_populates="meeting", cascade="all, delete-orphan", lazy="select")


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
