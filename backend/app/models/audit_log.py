"""
AuditLog SQLAlchemy Model for system-wide change tracking, auth logging, and traceability.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from ..database import Base

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(String(50), nullable=True, index=True)       # Grouping UUID for multi-field updates
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
    severity = Column(String(20), default="INFO", nullable=False, server_default="INFO", index=True) # INFO / WARNING / CRITICAL
    login_method = Column(String(50), nullable=True)               # Password / Google OAuth
    resource_name = Column(String(255), nullable=True, index=True) # Target entity human name (e.g. Nguyễn Văn A, IT Dept)
    source = Column(String(50), default="WEB", nullable=False, server_default="WEB", index=True) # WEB, API, CRON, SYSTEM, AI, GOOGLE_OAUTH
    category = Column(String(50), default="Administration", nullable=False, server_default="Administration", index=True) # Security, Administration, Configuration, Integration, System
    session_id = Column(String(100), nullable=True, index=True)   # Tracing User Login Session lifecycle
    ip_risk = Column(String(30), default="Internal", nullable=False, server_default="Internal", index=True) # Internal, Trusted, Unknown
    correlation_id = Column(String(100), nullable=True, index=True) # Tracing HTTP Request lifecycle

    # V3 Advanced Forensic Columns
    target_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    target_customer_id = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)
    target_department = Column(String(100), nullable=True, index=True)
    snapshot_json = Column(Text, nullable=True)                    # Full entity JSON snapshot before modification/deletion
    outcome = Column(String(20), default="SUCCESS", nullable=False, server_default="SUCCESS", index=True) # SUCCESS, FAILED, PARTIAL
    duration_ms = Column(Integer, nullable=True)                   # Action execution time in ms
    browser = Column(String(100), nullable=True)                  # Parsed browser (e.g. Chrome 125)
    os = Column(String(100), nullable=True)                       # Parsed OS (e.g. Windows 11)
    device_type = Column(String(50), default="Desktop", nullable=False, server_default="Desktop") # Desktop, Mobile, Tablet
    is_new_ip = Column(Boolean, default=False, nullable=False, server_default="false")
    is_new_device = Column(Boolean, default=False, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Relationships
    project = relationship("Project", lazy="select")
    customer = relationship("Customer", foreign_keys=[customer_id], lazy="select")
    target_customer = relationship("Customer", foreign_keys=[target_customer_id], lazy="select")
    user = relationship("User", foreign_keys=[user_id], lazy="select")
    target_user = relationship("User", foreign_keys=[target_user_id], lazy="select")

    def to_dict(self):
        user_name = None
        if self.user:
            user_name = self.user.full_name or self.user.display_name or self.user.email
        target_user_name = None
        if self.target_user:
            target_user_name = self.target_user.full_name or self.target_user.display_name or self.target_user.email
        project_name = self.project.name if self.project else None
        
        # Calculate business unit fallback if missing
        bu = self.business_unit
        if not bu and self.project:
            bu = self.project.business
        if not bu:
            bu = "All"

        return {
            "id": self.id,
            "event_id": self.event_id or f"single-{self.id}",
            "business_unit": bu,
            "customer_id": self.customer_id,
            "project_id": self.project_id,
            "project_name": project_name,
            "module": self.module,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "resource_name": self.resource_name or self.entity_id or "",
            "action": self.action,
            "severity": self.severity or "INFO",
            "login_method": self.login_method,
            "source": self.source or "WEB",
            "category": self.category or "Administration",
            "session_id": self.session_id or "",
            "ip_risk": self.ip_risk or "Internal",
            "correlation_id": self.correlation_id or "",
            "target_user_id": self.target_user_id,
            "target_user_name": target_user_name or "",
            "target_customer_id": self.target_customer_id,
            "target_department": self.target_department or "",
            "snapshot_json": self.snapshot_json or "",
            "outcome": self.outcome or "SUCCESS",
            "duration_ms": self.duration_ms or 0,
            "browser": self.browser or "Browser",
            "os": self.os or "OS",
            "device_type": self.device_type or "Desktop",
            "is_new_ip": bool(self.is_new_ip),
            "is_new_device": bool(self.is_new_device),
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
