from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..utils.auth import get_current_user
from ..config import settings
from ..services import telegram as telegram_service

router = APIRouter()


def _is_admin(user) -> bool:
    return user.role in {"admin", "super_admin"}


# ── Public webhook (no auth required) ─────────────────────────
# Telegram calls this endpoint when a user sends a message to the bot.
# Security is enforced by validating the optional webhook secret token header
# (X-Telegram-Bot-Api-Secret-Token) and by validating the connection token
# server-side. We never trust a user-supplied id from Telegram.
@router.post("/webhook")
def telegram_webhook(
    body: dict,
    x_telegram_bot_api_secret_token: str = Header(default=None),
    db: Session = Depends(get_db),
):
    expected_secret = (settings.TELEGRAM_WEBHOOK_SECRET or "").strip()

    if expected_secret:
        if (
            not x_telegram_bot_api_secret_token
            or x_telegram_bot_api_secret_token != expected_secret
        ):
            raise HTTPException(status_code=403, detail="Forbidden")

    message = body.get("message") or body.get("edited_message") or {}

    chat = message.get("chat") or {}
    chat_id = chat.get("id")

    text = str(message.get("text") or "").strip()

    # DEBUG: lấy thông tin group/chat
    print("========== TELEGRAM ==========")
    print("Chat ID:", chat_id)
    print("Chat Type:", chat.get("type"))
    print("Chat Title:", chat.get("title"))
    print("Text:", text)
    print("==============================")

    if not text or chat_id is None:
        return {"ok": True}

    lower = text.lower()

    if not lower.startswith("/start"):
        return {"ok": True}

    token = (
        text.split(None, 1)[1].strip()
        if len(text.split(None, 1)) > 1
        else ""
    )

    reply = telegram_service.process_start_command(
        db,
        token,
        chat_id,
    )

    if reply:
        telegram_service.send_message(chat_id, reply)

    return {"ok": True}


# ── Connection status for the current user ────────────────────
@router.get("/status")
def telegram_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Whether the current user has connected Telegram.

    Only admin/super_admin can connect. Returns a boolean only — never exposes
    the chat_id or any sensitive information.
    """
    connected = bool(
        current_user.role in {"admin", "super_admin"}
        and current_user.telegram_chat_id
    )
    return {
        "connected": connected,
        "enabled": settings.is_telegram_enabled,
    }


# ── Generate a connection link for the current user ───────────
@router.post("/connect")
def telegram_connect(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a secure, single-use, expiring Telegram deep link.

    Only admin/super_admin may connect. The returned URL contains a random
    connection token, never a raw user id. The bot token is never exposed.
    """
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only admin/super_admin can connect Telegram.")

    if not settings.is_telegram_enabled:
        raise HTTPException(status_code=503, detail="Telegram is not configured.")

    try:
        result = telegram_service.generate_connection_token(db, current_user.id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return result


# ── Disconnect Telegram for the current user ──────────────────
@router.post("/disconnect")
def telegram_disconnect(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove the current user's Telegram connection."""
    current_user.telegram_chat_id = None
    db.commit()
    return {"connected": False}