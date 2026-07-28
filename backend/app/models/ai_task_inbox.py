"""
AI Task Inbox and Chat Sync Log models.
Stores extracted tasks parsed by AI from Chat (Telegram, Zalo, manual paste) before being imported into Project Plan (tasks_v2).
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, Float, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base


class AITaskInbox(Base):
    __tablename__ = "chat_ai_tasks"

    id                    = Column(Integer, primary_key=True, index=True)
    project_id            = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    chat_group_id         = Column(Integer, ForeignKey("project_links.id", ondelete="SET NULL"), nullable=True)
    source_platform       = Column(String(50), default="Telegram")  # Telegram / Zalo / Slack / Manual Paste
    source_group_name     = Column(String(150), default="Telegram Group")
    source_message        = Column(Text, nullable=True)  # Snapshot of original raw message

    detail_task           = Column(String(500), nullable=False)
    task_description      = Column(Text, nullable=True)
    phase_id              = Column(Integer, ForeignKey("phases.id", ondelete="SET NULL"), nullable=True)
    task_group_id         = Column(Integer, ForeignKey("task_groups.id", ondelete="SET NULL"), nullable=True)
    assigned_id           = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    assigned_name         = Column(String(100), nullable=True)
    support_id            = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    
    priority              = Column(String(50), default="Normal")  # Normal / High / Critical / Interrupt
    manday_est            = Column(Float, nullable=True, default=1.0)
    start_date            = Column(String(20), nullable=True)     # YYYY-MM-DD
    kpi_ratio_assign      = Column(Integer, default=100)
    kpi_ratio_support     = Column(Integer, default=0)
    acceptance_criteria   = Column(Text, nullable=True)

    skill_solution_id     = Column(Integer, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)
    skill_vendor_id       = Column(Integer, ForeignKey("skills.id", ondelete="SET NULL"), nullable=True)
    ticket_id             = Column(String(500), nullable=True)
    remark                = Column(String(500), nullable=True)
    send                  = Column(String(500), nullable=True)
    target_status         = Column(String(50), default="Waiting")

    confidence            = Column(Integer, default=90)           # e.g. 96 for 96%
    status                = Column(String(30), default="ready")   # ready / missing / PENDING / REJECTED / IMPORTED
    imported_task_id      = Column(Integer, ForeignKey("tasks_v2.id", ondelete="SET NULL"), nullable=True)

    created_at            = Column(DateTime, server_default=func.now())
    updated_at            = Column(DateTime, onupdate=func.now())

    # Relationships
    project               = relationship("Project", lazy="select")
    phase                 = relationship("Phase", lazy="select")
    task_group            = relationship("TaskGroup", lazy="select")
    assigned_member       = relationship("Member", foreign_keys=[assigned_id], lazy="select")
    support_member        = relationship("Member", foreign_keys=[support_id], lazy="select")
    skill_solution_rel    = relationship("Group", foreign_keys=[skill_solution_id], lazy="select")
    skill_vendor_rel      = relationship("Skill", foreign_keys=[skill_vendor_id], lazy="select")


class ChatSyncLog(Base):
    __tablename__ = "chat_sync_logs"

    id                    = Column(Integer, primary_key=True, index=True)
    project_id            = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    source_name           = Column(String(150), nullable=False)
    message_text          = Column(Text, nullable=False)
    status                = Column(String(30), default="SUCCESS") # SUCCESS / WARNING / ERROR
    created_at            = Column(DateTime, server_default=func.now())

    # Relationships
    project               = relationship("Project", lazy="select")
