from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class ZaloAccount(Base):
    """A shared Zalo account connected to the app (login via cookie import,
    no QR). Phase 1 only ever has one active row, but the schema allows more
    later without a migration.
    """
    __tablename__ = "zalo_accounts"

    id           = Column(Integer, primary_key=True, index=True)
    label        = Column(String(100), nullable=False, default="Zalo giao task")
    phone        = Column(String(30), nullable=True)
    zalo_uid     = Column(String(50), nullable=True)
    status       = Column(String(30), nullable=False, default="disconnected")  # connected, disconnected, error
    is_active    = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    last_error   = Column(Text, nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    conversations = relationship("ZaloConversation", back_populates="account", cascade="all, delete-orphan")


class ZaloConversation(Base):
    """A Zalo thread (group or 1:1) the connected account has exchanged at
    least one message on. Built up reactively from message traffic — Zalo's
    old-history/group-directory APIs don't return usable names, and only
    real-time (post-connect) messages are available at all, so there is no
    upfront "list all conversations" sync in phase 1.
    """
    __tablename__ = "zalo_conversations"

    id            = Column(Integer, primary_key=True, index=True)
    account_id    = Column(Integer, ForeignKey("zalo_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    zalo_thread_id = Column(String(50), nullable=False)
    name          = Column(String(255), nullable=True)
    is_group      = Column(Boolean, nullable=False, default=False)
    # When set, messages matching the /task syntax in this conversation
    # create a Task under this project (see services/zalo_task_parser.py).
    project_id    = Column(Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    last_message_at = Column(DateTime(timezone=True), nullable=True)
    last_message_preview = Column(String(500), nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    account  = relationship("ZaloAccount", back_populates="conversations", lazy="select")
    messages = relationship("ZaloMessage", back_populates="conversation", cascade="all, delete-orphan")
    project  = relationship("Project", foreign_keys=[project_id], lazy="select")

    __table_args__ = (
        # Mandatory — without it, ON CONFLICT upserts on (account_id,
        # zalo_thread_id) fail silently (Postgres 42P10) and the conversation
        # list stays empty with no visible error.
        UniqueConstraint("account_id", "zalo_thread_id", name="uq_zalo_conversations_account_thread"),
    )


class ZaloMessage(Base):
    """A single message on a ZaloConversation, outgoing (sent by us) or
    incoming (pushed by the sidecar's real-time listener)."""
    __tablename__ = "zalo_messages"

    id                = Column(Integer, primary_key=True, index=True)
    conversation_id   = Column(Integer, ForeignKey("zalo_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    source_message_id = Column(String(50), nullable=False)
    sender_zalo_id    = Column(String(50), nullable=True)
    sender_name       = Column(String(255), nullable=True)
    content           = Column(Text, nullable=True)
    is_outgoing       = Column(Boolean, nullable=False, default=False)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    conversation = relationship("ZaloConversation", back_populates="messages", lazy="select")

    __table_args__ = (
        # Mandatory — same "42P10 upsert conflict silently fails" trap as
        # above, and this one also prevents duplicate rows when the sidecar
        # echoes back a message we just sent ourselves.
        UniqueConstraint("conversation_id", "source_message_id", name="uq_zalo_messages_conversation_source"),
    )


class ZaloDemoRequest(Base):
    """One "Yêu cầu xem demo" send — lets the UI show "Đã yêu cầu xem lúc
    ..." on a Done task instead of a bare button, and still allows sending
    it again (e.g. the person no-showed) via a distinct "Yêu cầu lại"."""
    __tablename__ = "zalo_demo_requests"

    id              = Column(Integer, primary_key=True, index=True)
    task_id         = Column(Integer, ForeignKey("tasks_v2.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("zalo_conversations.id", ondelete="CASCADE"), nullable=False)
    demo_at         = Column(DateTime, nullable=False)
    requested_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
