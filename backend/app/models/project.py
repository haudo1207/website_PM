"""
Project, Platform, ProjectLink, ProjectMember models.
Implements the new 4-level hierarchy: Project → Phase → TaskGroup → Task
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Table, UniqueConstraint, func
from sqlalchemy.orm import relationship
from ..database import Base
from .system_category import Customer



# Junction table: which members belong to which project (with role)
project_members = Table(
    'project_members_v2',
    Base.metadata,
    Column('id', Integer, primary_key=True, autoincrement=True),
    Column('project_id', Integer, ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True),
    Column('member_id', Integer, ForeignKey('members.id', ondelete='CASCADE'), nullable=False, index=True),
    Column('role', String(50), default='Member'),  # PM / Leader / Member / Sales
)


class Platform(Base):
    """Managed in Settings — Admin can add Telegram, Zalo, Slack, etc."""
    __tablename__ = "platforms"

    id        = Column(Integer, primary_key=True, index=True)
    name      = Column(String(100), nullable=False, unique=True)
    icon      = Column(String(50), nullable=True)   # emoji or icon class
    color     = Column(String(20), nullable=True)    # hex color
    is_active = Column(Boolean, default=True)

    # Relationships
    links = relationship("ProjectLink", back_populates="platform", lazy="select")


class Project(Base):
    """Top-level entity — replaces the old 'sheets' table."""
    __tablename__ = "projects"

    id                    = Column(Integer, primary_key=True, index=True)
    name                  = Column(String(200), nullable=False)
    code                  = Column(String(50), nullable=True, unique=True, index=True)
    customer_name         = Column(String(200), nullable=True)
    customer_id           = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)
    year                  = Column(Integer, nullable=True, index=True)
    pm_id                 = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True)
    technical_leader_id   = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True)
    sales_id              = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True)
    description           = Column(Text, nullable=True)
    status                = Column(String(50), default="Planning")  # Planning / Developing / Completed / Archived
    current_phase         = Column(String(100), nullable=True, default="1. Tư vấn")
    business              = Column(String(30), nullable=False, default="Infrastructure", server_default="Infrastructure", index=True)
    # Explicit business boundary used by backend authorization.
    data_scope            = Column(String(50), nullable=False, default="infrastructure", server_default="infrastructure", index=True)
    created_at            = Column(DateTime, server_default=func.now())
    updated_at            = Column(DateTime, onupdate=func.now())
    last_activity_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True)

    # AI Check Fields
    ai_status             = Column(String(50), default="NOT_CHECKED", nullable=False, server_default="NOT_CHECKED")
    last_ai_check_at      = Column(DateTime, nullable=True)
    last_ai_score         = Column(Integer, nullable=True)
    last_review_id        = Column(Integer, nullable=True)

    # Lazily generated, non-rotating public share token for the "KPI Prototype"
    # extension's project share-link feature (see routers/public_share.py).
    share_token           = Column(String(64), unique=True, nullable=True, index=True)

    # Personal Calendar (008-task-calendar-overview) — hex color identifying
    # this project's tasks on a member's Calendar (left border + tint on
    # each task block). Not set on older projects until backfilled.
    color                 = Column(String(20), nullable=True)

    # Relationships
    pm_member             = relationship("Member", foreign_keys=[pm_id], lazy="select")
    technical_leader      = relationship("Member", foreign_keys=[technical_leader_id], lazy="select")
    sales_member          = relationship("Member", foreign_keys=[sales_id], lazy="select")
    customer              = relationship("Customer", foreign_keys=[customer_id], lazy="select")
    phases                = relationship("Phase", back_populates="project", lazy="select", order_by="Phase.sort_order")
    links                 = relationship("ProjectLink", back_populates="project", lazy="select", order_by="ProjectLink.sort_order")


class ProjectLink(Base):
    """Dynamic links for a project (replaces hardcoded zalo_link, telegram_link, etc.)"""
    __tablename__ = "project_links"

    id           = Column(Integer, primary_key=True, index=True)
    project_id   = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    platform_id  = Column(Integer, ForeignKey("platforms.id", ondelete="SET NULL"), nullable=True)
    name         = Column(String(200), nullable=False)  # Group name
    url          = Column(String(500), nullable=False)
    description  = Column(String(500), nullable=True)
    sort_order   = Column(Integer, default=0)
    created_at   = Column(DateTime, server_default=func.now())
    updated_at   = Column(DateTime, onupdate=func.now())

    # Relationships
    project  = relationship("Project", back_populates="links")
    platform = relationship("Platform", back_populates="links", lazy="select")


class ProjectPin(Base):
    """Per-user pinned project on the Projects list — pinned projects sort
    to the top instead of the user having to search the whole list. Keyed
    by User.id (not Member.id) — some accounts (e.g. an admin login with no
    linked Member row) still need to be able to pin their own projects."""
    __tablename__ = "project_pins"
    __table_args__ = (UniqueConstraint("user_id", "project_id", name="uq_project_pin"),)

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())


from sqlalchemy import event

@event.listens_for(Project, 'before_insert')
@event.listens_for(Project, 'before_update')
def sync_project_data_scope(mapper, connection, target):
    if target.business:
        target.data_scope = str(target.business).strip().lower()
