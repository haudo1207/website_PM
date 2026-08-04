"""
AuditLog SQLAlchemy Model for system-wide change tracking, auth logging, and traceability.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from ..database import Base

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    business_unit = Column(String(50), nullable=True, index=True) # Infrastructure, Markee, All
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)
    module = Column(String(50), nullable=False, index=True)        # Project, Phase, Task Group, Task, Meeting, File, AI Check, System, Customer, Setting, Permission, Authentication
    entity_type = Column(String(50), nullable=False, index=True)   # Project, Phase, TaskGroup, Task, Meeting, AIPrompt, User, Customer, etc.
    entity_id = Column(String(100), nullable=True)                 # ID of affected entity
    action = Column(String(30), nullable=False, index=True)        # CREATE, UPDATE, DELETE, CHECK, LOGIN, FAILED_LOGIN, SYSTEM
    field_name = Column(String(100), nullable=True)                # e.g. priority, status, deadline, manday_est, role
    old_value = Column(Text, nullable=True)                        # Original value or JSON
    new_value = Column(Text, nullable=True)                        # Updated value or JSON
    description = Column(Text, nullable=True)                     # Human-readable Vietnamese summary
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    ip_address = Column(String(50), nullable=True)                 # Client IP
    user_agent = Column(String(255), nullable=True)                # Browser / OS User Agent
    request_url = Column(String(255), nullable=True)               # API URL endpoint
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Relationships
    project = relationship("Project", lazy="select")
    customer = relationship("Customer", lazy="select")
    user = relationship("User", lazy="select")

    def to_dict(self):
        user_name = None
        if self.user:
            user_name = self.user.full_name or self.user.display_name or self.user.email
        project_name = self.project.name if self.project else None
        
        # Calculate business unit fallback if missing
        bu = self.business_unit
        if not bu and self.project:
            bu = self.project.business
        if not bu:
            bu = "All"

        return {
            "id": self.id,
            "business_unit": bu,
            "customer_id": self.customer_id,
            "project_id": self.project_id,
            "project_name": project_name,
            "module": self.module,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "action": self.action,
            "field_name": self.field_name,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "description": self.description,
            "user_id": self.user_id,
            "user_name": user_name or "System",
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "request_url": self.request_url,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
