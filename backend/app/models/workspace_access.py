from sqlalchemy import Column, Integer, Boolean, ForeignKey, UniqueConstraint
from ..database import Base


class UserWorkspaceAccess(Base):
    """Explicit user <-> Workspace grants. A user may hold more than one
    Workspace (e.g. a Leader overseeing several) — additive to
    `User.data_scope`, which stays as the legacy single/primary scope for
    code that still reads it directly (GET /api/users/me, project-create
    defaults, etc.).

    `is_primary` marks the user's "home" Workspace among their granted set
    (shown as "Chính" in the UI; the rest are "Phụ") — exactly one row per
    user should have this set. Previously this was only inferred from
    grant order (first-granted == data_scope); an explicit column lets an
    admin/Leader re-designate it later without re-submitting the whole list."""
    __tablename__ = "user_workspace_access"
    __table_args__ = (UniqueConstraint("user_id", "workspace_id", name="uq_user_workspace"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    is_primary = Column(Boolean, nullable=False, default=False, server_default="false")
