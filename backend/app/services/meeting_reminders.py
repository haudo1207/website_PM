"""Meeting reminder dispatch — polled from the background loop registered in
main.py (start_meeting_reminder_loop), same pattern as auto_sync_all_ended_meetings.

Delivery per channel:
- App: insert a Notification row for each participant who has a linked User
  account. Cheap — the inbox read/poll pipeline already exists.
- Telegram: broadcast to the configured group chat (TELEGRAM_GROUP_CHAT_ID).
  There is no per-participant Telegram DM in this app (only super_admins may
  link a personal chat_id), so this is a group announcement, not a 1:1 ping.
- Zalo / "Nhóm dự án": post into the meeting's project's linked Zalo group
  conversation (if any), @mentioning participants who have a zalo_uid.
- Email: to each participant's Member.email (not the whole project — a
  reminder is for the people attending), via the same SMTP client
  meeting_notify.py's on-create notification already uses. A no-op if SMTP
  isn't configured (see config.is_smtp_enabled) or no participant has an
  email on file.
"""
import datetime
import logging
from zoneinfo import ZoneInfo

from sqlalchemy import update

from ..models.meeting import Meeting
from ..models.meeting_project import MeetingProject
from ..models.member import Member
from ..models.user import User
from ..models.notification import Notification
from ..models.zalo import ZaloConversation
from . import telegram as telegram_service
from . import zalo as zalo_service
from .email_client import send_email

logger = logging.getLogger(__name__)

# A meeting whose start time already passed by more than this is stale by the
# time we notice (app restart, downtime) — mark it handled without sending a
# now-pointless "upcoming" reminder.
STALE_AFTER_MINUTES = 30


def _build_text(meeting, start_dt) -> str:
    proj_name = meeting.project.name if getattr(meeting, "project", None) else "Dự án chung"
    return (
        f"🔔 Nhắc lịch họp: {meeting.title}\n"
        f"🕒 {start_dt.strftime('%H:%M ngày %d/%m/%Y')} — {proj_name}"
    )


def _notify_app(db, meeting, member_ids, text) -> None:
    if not member_ids:
        return
    users = db.query(User).filter(User.member_id.in_(member_ids)).all()
    for u in users:
        db.add(Notification(
            recipient_id=u.id,
            message=text,
            notification_type="meeting_reminder",
            project_id=meeting.project_id,
        ))
    db.commit()


def _notify_telegram(meeting, text) -> None:
    try:
        telegram_service.send_group_message(text)
    except Exception:
        logger.exception("Telegram reminder failed for meeting %s", meeting.id)


def _notify_zalo(db, meeting, member_ids, text) -> None:
    if not zalo_service.is_configured():
        return
    project_ids = {meeting.project_id} if meeting.project_id else set()
    project_ids |= {
        row.project_id
        for row in db.query(MeetingProject).filter(MeetingProject.meeting_id == meeting.id).all()
    }
    project_ids.discard(None)
    if not project_ids:
        return
    conversations = db.query(ZaloConversation).filter(ZaloConversation.project_id.in_(project_ids)).all()
    if not conversations:
        return
    mentioned = (
        db.query(Member).filter(Member.id.in_(member_ids), Member.zalo_uid.isnot(None)).all()
        if member_ids else []
    )
    for conv in conversations:
        body = text
        mentions = []
        if mentioned:
            body += "\n"
            for i, mem in enumerate(mentioned):
                name_text = f"@{mem.zalo_name or mem.display_name}"
                pos = len(body)
                body += name_text
                mentions.append({"uid": mem.zalo_uid, "pos": pos, "len": len(name_text)})
                if i < len(mentioned) - 1:
                    body += " "
        try:
            zalo_service.send_message(conv.zalo_thread_id, body, conv.is_group, mentions or None)
        except Exception:
            logger.exception("Zalo reminder failed for meeting %s conversation %s", meeting.id, conv.id)


def _notify_email(db, meeting, member_ids, text) -> None:
    if not member_ids:
        return
    rows = db.query(Member.email).filter(Member.id.in_(member_ids), Member.email.isnot(None)).all()
    emails = [r.email for r in rows if r.email and r.email.strip()]
    if not emails:
        return
    subject = f"🔔 Nhắc lịch họp: {meeting.title}"
    html_body = "<p>" + text.replace("\n", "</p><p>") + "</p>"
    try:
        send_email(emails, subject, html_body)
    except Exception:
        logger.exception("Email reminder failed for meeting %s", meeting.id)


def _claim_due_meetings(db):
    """Atomically claim every meeting due for a reminder right now.

    The backend runs multiple uvicorn workers, each polling independently —
    a plain read-then-write would let two workers see the same unclaimed
    meeting and both send it. The claim itself is a single conditional
    UPDATE (only succeeds if reminder_sent_at is still NULL), so at most one
    worker wins per meeting.
    """
    # meeting_date/start_time are stored exactly as the user typed them —
    # Vietnam wall-clock time, no UTC conversion on input (see
    # meetings.py::create_meeting). The container's own clock is UTC (Docker
    # default), so a bare datetime.now() compared against that naive value
    # was off by 7 hours — reminders fired ~7h late instead of on time.
    now = datetime.datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).replace(tzinfo=None)
    candidates = (
        db.query(Meeting)
        .filter(Meeting.status == "UPCOMING", Meeting.reminder_sent_at.is_(None))
        .all()
    )
    claimed = []
    for m in candidates:
        if not m.meeting_date or not m.start_time:
            continue
        start_dt = datetime.datetime.combine(m.meeting_date, m.start_time)
        remind_at = start_dt - datetime.timedelta(minutes=m.reminder_minutes or 15)
        if now < remind_at:
            continue
        result = db.execute(
            update(Meeting)
            .where(Meeting.id == m.id, Meeting.reminder_sent_at.is_(None))
            .values(reminder_sent_at=now)
        )
        db.commit()
        if result.rowcount:
            claimed.append((m, start_dt))
    return claimed, now


def dispatch_due_reminders(db) -> int:
    """Poll for meetings whose reminder time has arrived and notify their
    participants through whichever channels were picked in the Create
    Meeting drawer. Returns how many meetings were dispatched this call.

    Best-effort and claim-before-send: once a meeting is claimed it will not
    be retried even if every channel fails (e.g. Zalo not configured in this
    environment) — for a reminder, a rare missed send beats a duplicate-spam
    retry loop.
    """
    claimed, now = _claim_due_meetings(db)
    sent = 0
    for meeting, start_dt in claimed:
        try:
            if now > start_dt + datetime.timedelta(minutes=STALE_AFTER_MINUTES):
                continue
            channels = meeting.notify_channels or []
            if not channels:
                continue
            member_ids = [mm.member_id for mm in meeting.members]
            text = _build_text(meeting, start_dt)

            if "App" in channels:
                _notify_app(db, meeting, member_ids, text)
            if "Telegram" in channels:
                _notify_telegram(meeting, text)
            if "Zalo" in channels or "Nhóm dự án" in channels:
                _notify_zalo(db, meeting, member_ids, text)
            if "Email" in channels:
                _notify_email(db, meeting, member_ids, text)

            sent += 1
            logger.info("Dispatched meeting reminder id=%s via %s", meeting.id, channels)
        except Exception:
            logger.exception("Failed dispatching reminder for meeting %s", meeting.id)
    return sent
