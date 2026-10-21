import datetime

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base

class GoogleToken(Base):
    __tablename__ = "google_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    google_email = Column(String(255), nullable=True)
    access_token = Column(String(512), nullable=False)
    refresh_token = Column(String(512), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    user = relationship("User", lazy="select")


class GoogleOAuthState(Base):
    """One-time `state` for the Google connect flow. The OAuth callback is a
    public route, so the state Google echoes back is the only thing tying the
    returned tokens to the Super Admin who started the flow — a random value
    stored here (DB, not memory: 2 uvicorn workers), consumed on first use and
    valid for a few minutes only. Replaces the old guessable "<user_id>:<ws_id>"
    state, which let anyone bind their own Google account to a Workspace."""
    __tablename__ = "google_oauth_states"

    id = Column(Integer, primary_key=True, index=True)
    state = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(Integer, nullable=True)
    # Python-side UTC (not server_default now()) so the TTL check compares
    # like with like regardless of the DB server's timezone setting.
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
