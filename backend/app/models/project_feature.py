"""
ProjectFeature / ProjectFeatureLog — per-project feature tracking with a WIP-log
timeline, modeled after markee-dashboard's skill_library(skill_type='wip') +
feature_name pattern, but as real normalized entities instead of a free-text
column.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, func
from sqlalchemy.orm import relationship
from ..database import Base


class ProjectFeature(Base):
    __tablename__ = "project_features"

    id             = Column(Integer, primary_key=True, index=True)
    project_id     = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name           = Column(String(200), nullable=False)
    created_by_id  = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    created_at     = Column(DateTime, server_default=func.now())

    project    = relationship("Project", lazy="select")
    created_by = relationship("Member", foreign_keys=[created_by_id], lazy="select")
    logs       = relationship(
        "ProjectFeatureLog", back_populates="feature",
        cascade="all, delete-orphan", lazy="select",
        order_by="ProjectFeatureLog.created_at.desc()",
    )


class ProjectFeatureLog(Base):
    __tablename__ = "project_feature_logs"

    id          = Column(Integer, primary_key=True, index=True)
    feature_id  = Column(Integer, ForeignKey("project_features.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id  = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id   = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    # Fallback plain-text name for authors with no linked Member profile (e.g.
    # an admin/system account logged into the extension) — without this the
    # log would show "Ẩn danh" even though the author's real login is known.
    author_display_name = Column(String(255), nullable=True)
    content     = Column(Text, nullable=False)
    status      = Column(String(20), nullable=False, default="pending", server_default="pending")
    attached_files = Column(JSON, nullable=True)
    # AI-generated summary + proposed tasks (see services/project_feature_ai.py).
    ai_summary  = Column(Text, nullable=True)
    ai_tasks    = Column(JSON, nullable=True)
    created_at  = Column(DateTime, server_default=func.now())

    feature = relationship("ProjectFeature", back_populates="logs", lazy="select")
    author  = relationship("Member", foreign_keys=[author_id], lazy="select")
