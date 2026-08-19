from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class TelegramConnection(Base):
    """Stores short-lived, single-use connection tokens used to link a system
    account to a Telegram chat.

    Flow:
      1. Admin/super_admin requests a connection link from the frontend.
      2. Backend generates a secure random token, stores it here with an
         expiration time, and returns https://t.me/<bot>?start=<token>.
      3. The user opens the link in Telegram and sends /start <token>.
      4. The Telegram webhook validates the token, checks the role of the
         linked user, saves their chat_id on the User row, and marks the
         token as used.
    """
    __tablename__ = "telegram_connections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token = Column(String(64), unique=True, nullable=False, index=True)
    # None = never expires (not used); otherwise an ISO/UTC timestamp.
    expires_at = Column(DateTime(timezone=True), nullable=True)
    used = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())