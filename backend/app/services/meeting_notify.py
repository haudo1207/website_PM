"""On meeting creation: push the join link to any Zalo group(s) linked to
the meeting's project(s) — the Zalo counterpart of services/telegram.py's
send_meeting_notification. Best-effort (never raises) so a delivery failure
never blocks meeting creation, matching how the existing Telegram call is
wrapped in meetings.py.
"""
import datetime
import logging

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..models.zalo import ZaloAccount, ZaloConversation, ZaloMessage
from . import zalo as zalo_service

logger = logging.getLogger("meeting_notify")


def _meeting_project_ids(meeting) -> list[int]:
    ids = set()
    if getattr(meeting, "project_id", None):
        ids.add(meeting.project_id)
    for ep in (getattr(meeting, "extra_projects", None) or []):
        if ep.project_id:
            ids.add(ep.project_id)
    return list(ids)


def _meeting_message_lines(meeting) -> list[str]:
    proj_name = meeting.project.name if getattr(meeting, "project", None) else "Dự án chung"
    creator_name = meeting.creator.display_name if getattr(meeting, "creator", None) else "Host"
    date_str = meeting.meeting_date.strftime("%d/%m/%Y") if getattr(meeting, "meeting_date", None) else ""
    start_time_str = meeting.start_time.strftime("%H:%M") if getattr(meeting, "start_time", None) else ""
    end_time_str = meeting.end_time.strftime("%H:%M") if getattr(meeting, "end_time", None) else ""
    time_str = f"({start_time_str} - {end_time_str})" if start_time_str and end_time_str else (f"({start_time_str})" if start_time_str else "")

    lines = [
        f"THÔNG BÁO CUỘC HỌP: {meeting.title}",
        f"Dự án: {proj_name}",
        f"Thời gian: {date_str} {time_str}".strip(),
        f"Nền tảng: {meeting.platform or 'Google Meet'}",
        f"Người tạo: {creator_name}",
    ]
    if meeting.meeting_url:
        lines.append(f"Link tham gia: {meeting.meeting_url}")
    return lines


def notify_zalo_groups_meeting_created(db: Session, meeting) -> int:
    """Sends the join link to every Zalo group conversation linked
    (ZaloConversation.project_id) to any of the meeting's project(s).
    Returns how many groups were actually notified."""
    project_ids = _meeting_project_ids(meeting)
    if not project_ids:
        return 0

    account = db.query(ZaloAccount).filter(ZaloAccount.is_active.is_(True)).first()
    if not account or not zalo_service.is_configured():
        return 0

    conversations = (
        db.query(ZaloConversation)
        .filter(
            ZaloConversation.account_id == account.id,
            ZaloConversation.project_id.in_(project_ids),
            ZaloConversation.is_group.is_(True),
        )
        .all()
    )
    if not conversations:
        return 0

    text = "\n".join(_meeting_message_lines(meeting))
    now = datetime.datetime.now(datetime.timezone.utc)
    sent = 0
    for conv in conversations:
        try:
            result = zalo_service.send_message(conv.zalo_thread_id, text, conv.is_group)
        except RuntimeError as e:
            logger.warning("Failed to send meeting notice to Zalo group %s: %s", conv.id, e)
            continue

        source_message_id = str(result.get("source_message_id") or f"local-{now.timestamp()}-{conv.id}")
        db.execute(
            pg_insert(ZaloMessage).values(
                conversation_id=conv.id,
                source_message_id=source_message_id,
                sender_zalo_id=None,
                sender_name="Bạn",
                content=text,
                is_outgoing=True,
            ).on_conflict_do_nothing(constraint="uq_zalo_messages_conversation_source")
        )
        conv.last_message_at = now
        conv.last_message_preview = text[:500]
        sent += 1

    if sent:
        db.commit()
    return sent
