"""Telegram Bot integration used to notify admin/super_admin users about new
Leave Requests, and to let those users securely link their system account to a
Telegram chat.

The Telegram Bot Token is only ever read from the environment (via config) and
is never exposed to the frontend or logged.
"""
import logging
import secrets
from html import escape
from datetime import datetime, timedelta, timezone

import requests

from ..config import settings
from ..models.telegram_connection import TelegramConnection
from ..models.user import User

logger = logging.getLogger("telegram")

# Roles that are allowed to connect Telegram and to receive Leave Request
# notifications. Mirrors the existing role values used in the codebase.
TELEGRAM_NOTIFY_ROLES = {"admin","super_admin"}

# How long a connection link stays valid.
CONNECTION_TOKEN_TTL_MINUTES = 15

TELEGRAM_API_BASE = "https://api.telegram.org"


# ── Low-level helpers ─────────────────────────────────────────
def _bot_token() -> str:
    return (settings.TELEGRAM_BOT_TOKEN_LEAVEREQUEST or "").strip()


def is_telegram_enabled() -> bool:
    return bool(_bot_token())


def _api_url(method: str) -> str:
    return f"{TELEGRAM_API_BASE}/bot{_bot_token()}/{method}"


def _format_date(value) -> str:
    """Format a date-ish value as DD/MM/YYYY, matching the frontend display."""
    if not value:
        return ""
    try:
        dt = value
        if isinstance(value, str):
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return str(value)


def _format_time_display(leave_request) -> str:
    """Build the 'Time' column text the same way the frontend does.

    The stored `time` is normally just "HH:MM" and the date part comes from
    created_at. Some legacy rows store a full datetime string, so handle both.
    """
    raw_time = getattr(leave_request, "time", "") or ""
    parts = str(raw_time).split(" ")
    time_part = parts[1] if len(parts) > 1 else parts[0]
    date_str = _format_date(getattr(leave_request, "created_at", None))
    if date_str:
        return f"{time_part} {date_str}"
    return time_part


def _location_text(leave_request) -> str:
    """Location shown in the table: '<ward>, <province>'."""
    return ", ".join(
        p for p in (getattr(leave_request, "ward", ""), getattr(leave_request, "province", "")) if p
    )


def _user_display_name(leave_request) -> str:
    """The user name shown in the table: member.full_name, else user.full_name."""
    user = getattr(leave_request, "user", None)
    if user:
        member = getattr(user, "member", None)
        if member and getattr(member, "full_name", None):
            return member.full_name
        if getattr(user, "full_name", None):
            return user.full_name
        return user.email or f"User {user.id}"
    return f"User {getattr(leave_request, 'user_id', '')}"


# ── Sending ────────────────────────────────────────────────────
def send_message(chat_id, text: str, reply_markup: dict = None, message_thread_id: int = None, parse_mode: str = "HTML") -> bool:
    """Send a plain text message to a Telegram chat. Returns True on success."""
    if not is_telegram_enabled():
        logger.info("Telegram disabled — skipping message to chat_id=%s", chat_id)
        return False
    if not chat_id:
        logger.warning("No chat_id provided — skipping Telegram message")
        return False

    payload = {
        "chat_id": str(chat_id),
        "text": text,
        "parse_mode": parse_mode,
    }

    thread_id = message_thread_id or getattr(settings, "TELEGRAM_MESSAGE_THREAD_ID", None)
    if thread_id and str(chat_id).startswith("-100"):
        payload["message_thread_id"] = int(thread_id)

    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        resp = requests.post(_api_url("sendMessage"), json=payload, timeout=10)
        data = resp.json()
        if not resp.ok or not data.get("ok"):
            logger.warning(
                "Telegram sendMessage failed for chat_id=%s: %s",
                chat_id,
                data.get("description", resp.text)[:300],
            )
            return False
        return True
    except requests.RequestException as exc:
        # Never allow a Telegram failure to break the caller (e.g. the Leave
        # Request creation flow). Log and move on.
        logger.error("Telegram sendMessage error for chat_id=%s: %s", chat_id, exc)
        return False


def get_bot_username() -> str:
    """Return the bot @username, or empty string if unavailable/disabled."""
    if not is_telegram_enabled():
        return ""
    try:
        resp = requests.post(_api_url("getMe"), timeout=10)
        data = resp.json()
        if resp.ok and data.get("ok"):
            return str(data["result"].get("username", ""))
    except requests.RequestException as exc:
        logger.error("Telegram getMe error: %s", exc)
    return ""


# ── Connection token management ────────────────────────────────
def generate_connection_token(db, user_id: int) -> dict:
    """Create a secure, single-use, expiring connection token for a user.

    Returns {"url": "https://t.me/<bot>?start=<token>"} or raises if the bot
    is not configured.
    """
    if not is_telegram_enabled():
        raise RuntimeError("Telegram is not configured")

    # Invalidate any previous unused tokens for this user so reconnecting is
    # idempotent and old links stop working.
    db.query(TelegramConnection).filter(
        TelegramConnection.user_id == user_id,
        TelegramConnection.used.is_(False),
    ).update({TelegramConnection.used: True})

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=CONNECTION_TOKEN_TTL_MINUTES)
    conn = TelegramConnection(
        user_id=user_id,
        token=token,
        expires_at=expires_at,
        used=False,
    )
    db.add(conn)
    db.commit()

    username = get_bot_username()
    if username:
        url = f"https://t.me/{username}?start={token}"
    else:
        # Fall back to the bot id-based deep link if username is unavailable.
        url = f"https://t.me/{_bot_token().split(':')[0]}?start={token}"
    return {"url": url}


def validate_connection_token(db, token: str) -> TelegramConnection:
    """Look up a connection token and return it, or None if invalid/expired."""
    if not token:
        return None
    conn = (
        db.query(TelegramConnection)
        .filter(TelegramConnection.token == token)
        .first()
    )
    if not conn:
        return None
    if conn.used:
        return None
    if conn.expires_at and conn.expires_at < datetime.now(timezone.utc):
        return None
    return conn


def process_start_command(db, token: str, chat_id) -> str:
    """Handle a Telegram /start <token> message.

    Returns a reply text to send back to the user in Telegram.
    """
    if not token:
        return "Invalid or expired connection link."

    conn = validate_connection_token(db, token)
    if not conn:
        return "Invalid or expired connection link."

    user = db.query(User).filter(User.id == conn.user_id).first()
    if not user or not user.is_active:
        return "Invalid or expired connection link."

    # Only admin/super_admin may connect their Telegram account.
    if user.role not in TELEGRAM_NOTIFY_ROLES:
        return "You are not allowed to connect Telegram."

    # Save the Telegram chat_id on the user row (idempotent — reconnecting
    # simply updates it, no duplicate rows).
    user.telegram_chat_id = str(chat_id)
    conn.used = True
    db.commit()

    return "Telegram connected successfully."


# ── Leave Request notification ─────────────────────────────────
def build_leave_request_message(leave_request) -> str:
    """Build the Telegram message text for a new Leave Request."""
    status = getattr(leave_request, "status", "") or "Pending"
    status_emoji = "🟡" if status == "Pending" else ("🟢" if status == "Approved" else "🔴")

    province = getattr(leave_request, "province", "") or ""
    location = province or _location_text(leave_request)
    name = escape(_user_display_name(leave_request))
    man_day = escape(str(getattr(leave_request, "man_day", "") or ""))
    start_date = escape(_format_date(getattr(leave_request, "start_date", None)))
    end_date = escape(_format_date(getattr(leave_request, "end_date", None)))
    leave_type = escape(str(getattr(leave_request, "leave_type", "") or ""))
    reason = escape(str(getattr(leave_request, "reason", "") or ""))
    location = escape(location)

    lines = [
        f"<b>Thông báo nghỉ phép từ {name}</b>",
        f"🟢 <b>Số ngày nghỉ:</b> {man_day}",
        f"📅 <b>Ngày bắt đầu:</b> {start_date}",
        f"📅 <b>Ngày kết thúc:</b> {end_date}",
        f"🧑‍💻 <b>Trạng thái:</b> {leave_type}",
        f"📝 <b>Lý do:</b> {reason}",
        f"📍 <b>Địa điểm:</b> {location}",
    ]
    return "\n".join(lines)


def _view_leave_request_url(leave_request_id: int) -> str:
    base = settings.telegram_base_url
    if not base:
        return ""
    return f"{base}/leave-request?view={leave_request_id}"


def send_group_message(text: str, reply_markup: dict = None) -> bool:
    """Send a message to the configured Telegram group.

    The group chat id is the single source of truth for Leave Request
    notifications. Returns True on success, False if the group is not
    configured, the bot is disabled, or the Telegram API call failed.
    """
    group_chat_id = (settings.TELEGRAM_GROUP_CHAT_ID or "").strip()
    if not group_chat_id:
        logger.warning(
            "TELEGRAM_GROUP_CHAT_ID is not configured, skipping Telegram group notification"
        )
        return False
    return send_message(group_chat_id, text, reply_markup=reply_markup)


def build_leave_request_reply_markup(leave_request_id: int) -> dict | None:
    """Inline keyboard with a single "View Leave Request" button using the
    configured public base URL (never localhost)."""
    view_url = _view_leave_request_url(leave_request_id)
    if not view_url:
        return None
    return {
        "inline_keyboard": [[{"text": "View Leave Request", "url": view_url}]]
    }


def send_leave_request_notification(db, leave_request) -> int:
    """Send a Telegram notification for a new Leave Request.

    The message is sent exactly once to the configured Telegram group
    (TELEGRAM_GROUP_CHAT_ID). Individual admin/super_admin personal chat ids
    are intentionally NOT used for Leave Request notifications anymore.

    Returns 1 if the group message was sent successfully, otherwise 0. Never
    raises — a Telegram failure must never break the Leave Request creation
    flow.
    """
    if not is_telegram_enabled():
        logger.info("Telegram disabled — skip Leave Request notification")
        return 0

    group_chat_id = (settings.TELEGRAM_GROUP_CHAT_ID or "").strip()
    if not group_chat_id:
        logger.warning(
            "TELEGRAM_GROUP_CHAT_ID is not configured, skipping Telegram group notification "
            "for Leave Request #%s",
            getattr(leave_request, "id", None),
        )
        return 0

    text = build_leave_request_message(leave_request)
    reply_markup = build_leave_request_reply_markup(leave_request.id)
    # reply_markup = None  # Disable the "View Leave Request" button for now, as the frontend URL may not be public.

    ok = send_group_message(text, reply_markup=reply_markup)
    if ok:
        logger.info("Telegram group notified for Leave Request #%s", leave_request.id)
        return 1
    return 0


def send_meeting_notification(db, meeting) -> int:
    """Send Telegram notification for a meeting (created or AI summarized).

    Notifies TELEGRAM_GROUP_CHAT_ID and all connected users (User.telegram_chat_id).
    Returns total count of successfully sent messages.
    """
    if not is_telegram_enabled():
        logger.info("Telegram disabled — skipping meeting notification")
        return 0

    proj_name = meeting.project.name if getattr(meeting, "project", None) else "Dự án chung"
    creator_name = meeting.creator.display_name if getattr(meeting, "creator", None) else "Host"
    
    date_str = meeting.meeting_date.strftime("%d/%m/%Y") if getattr(meeting, "meeting_date", None) else ""
    start_time_str = meeting.start_time.strftime("%H:%M") if getattr(meeting, "start_time", None) else ""
    end_time_str = meeting.end_time.strftime("%H:%M") if getattr(meeting, "end_time", None) else ""
    time_str = f"({start_time_str} - {end_time_str})" if start_time_str and end_time_str else (f"({start_time_str})" if start_time_str else "")

    executive_summary = ""
    decisions = []
    recommended_tasks = []

    ai_sum = getattr(meeting, "ai_summary", None)
    if isinstance(ai_sum, dict):
        executive_summary = ai_sum.get("executive_summary") or ai_sum.get("summary") or ""
        decisions = ai_sum.get("decisions") or []
        recommended_tasks = ai_sum.get("recommended_tasks") or []
    elif isinstance(ai_sum, list) and ai_sum:
        executive_summary = str(ai_sum[0])

    if not executive_summary:
        executive_summary = meeting.description or "Cuộc họp mới đã được khởi tạo trên hệ thống."

    lines = [
        f"📌 <b>THÔNG BÁO CUỘC HỌP: {meeting.title}</b>",
        f"📁 <b>Dự án:</b> {proj_name}",
        f"📅 <b>Thời gian:</b> {date_str} {time_str}".strip(),
        f"💻 <b>Nền tảng:</b> {meeting.platform or 'Google Meet'}",
        f"👤 <b>Người tạo:</b> {creator_name}",
    ]

    if meeting.meeting_url:
        lines.append(f"🔗 <b>Link:</b> {meeting.meeting_url}")

    lines.append(f"\n📝 <b>Tóm tắt AI (Executive Summary):</b>\n{executive_summary}")

    if decisions:
        lines.append("\n🎯 <b>Quyết định chính:</b>")
        for d in decisions[:5]:
            lines.append(f"• {d}")

    if recommended_tasks:
        lines.append(f"\n📋 <b>Task AI đề xuất ({len(recommended_tasks)}):</b>")
        for t in recommended_tasks[:5]:
            if isinstance(t, dict):
                t_name = t.get("detail_task") or t.get("title") or "Task"
                t_owner = t.get("assigned_name") or t.get("owner") or ""
                owner_str = f" (Giao: {t_owner})" if t_owner else ""
                lines.append(f"• {t_name}{owner_str}")
            elif isinstance(t, str):
                lines.append(f"• {t}")

    view_url = f"{settings.telegram_base_url}/meetings?id={meeting.id}"
    reply_markup = {
        "inline_keyboard": [[{"text": "Xem cuộc họp trên Portal", "url": view_url}]]
    } if settings.telegram_base_url else None

    text = "\n".join(lines)

    chat_ids = set()
    group_chat_id = (settings.TELEGRAM_GROUP_CHAT_ID or "").strip()
    if group_chat_id:
        chat_ids.add(group_chat_id)

    users = db.query(User).filter(User.telegram_chat_id != None, User.telegram_chat_id != "").all()
    for u in users:
        chat_ids.add(u.telegram_chat_id)

    sent_count = 0
    for cid in chat_ids:
        try:
            if send_message(cid, text, reply_markup=reply_markup):
                sent_count += 1
        except Exception as e:
            logger.warning(f"Failed to send meeting telegram notification to chat_id {cid}: {e}")

    logger.info(f"Sent meeting notification for meeting #{meeting.id} to {sent_count} Telegram destination(s).")
    return sent_count

