from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"))
    task_id = Column(Integer, ForeignKey("tasks_v2.id"), index=True, nullable=True)
    task_group_id = Column(Integer, ForeignKey("task_groups.id"), index=True, nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), index=True, nullable=True)
    # Set only for notification_type="zalo_demo_ready" — the Zalo conversation
    # that was linked to the project at the moment the task went Done.
    zalo_conversation_id = Column(Integer, ForeignKey("zalo_conversations.id"), nullable=True)

    # Message content of the notification
    message = Column(String, nullable=False)
    # Type of notification, e.g., 'task_reminder', 'group_approval_request', 'overdue_alert'
    notification_type = Column(String, default="task_reminder")
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    recipient = relationship("User", foreign_keys=[recipient_id])
    sender = relationship("User", foreign_keys=[sender_id])
    task = relationship("Task")
    task_group = relationship("TaskGroup")
    project = relationship("Project")

