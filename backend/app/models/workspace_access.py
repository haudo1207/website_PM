from sqlalchemy import Column, Integer, ForeignKey, UniqueConstraint
from ..database import Base


class UserWorkspaceAccess(Base):
    """Explicit user <-> Workspace grants. A user may hold more than one
    Workspace (e.g. a Leader overseeing several) — additive to
    `User.data_scope`, which stays as the legacy single/primary scope for
    code that still reads it directly (GET /api/users/me, project-create
    defaults, etc.)."""
    __tablename__ = "user_workspace_access"
    __table_args__ = (UniqueConstraint("user_id", "workspace_id", name="uq_user_workspace"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
