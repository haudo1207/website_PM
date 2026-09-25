from sqlalchemy import (
    Column, Integer, Boolean, Date, DateTime, ForeignKey, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class WorkspaceWorkingLunchMember(Base):
    """Per-workspace configuration of which Members may participate in the
    Check Working/Lunch feature.

    A Member is only allowed to register their daily Working/Lunch status when
    a SUPER ADMIN (or Leader) has added an `enabled=true` row for that Member
    *inside the Workspace that Member belongs to*. The row is scoped by
    `workspace_id` (resolved from the Member's DB relationship — linked User's
    `user_workspace_access` / `data_scope`), so enabling a Member in Workspace
    DEV has zero effect on any other Workspace.

    Unique per (workspace_id, member_id) so re-toggling is a simple upsert.
    """
    __tablename__ = "workspace_working_lunch_members"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "member_id", "work_date",
            name="uq_workspace_working_lunch_member_day",
        ),
    )

    id = Column(Integer, primary_key=True)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    member_id = Column(
        Integer, ForeignKey("members.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    work_date = Column(Date, nullable=False, index=True)
    enabled = Column(
        Boolean, nullable=False, default=False, server_default="false",
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    member = relationship("Member", backref="working_lunch_configs")
    workspace = relationship("Workspace")