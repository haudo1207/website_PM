from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base

class WorkspaceGoogleAccount(Base):
    """Per-workspace override of the shared Google account used for Calendar/Meet/Drive
    (e.g. infra uses its own account while dev/marketing keep the default shared one)."""
    __tablename__ = "workspace_google_accounts"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, unique=True)
    google_email = Column(String(255), nullable=True)
    access_token = Column(String(512), nullable=False)
    refresh_token = Column(String(512), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    workspace = relationship("Workspace", lazy="select")
