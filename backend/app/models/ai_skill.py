"""
AI Skill Library + passive session log — native pm-new backend for the
"KPI Prototype" browser extension (formerly "Markee AI Tracker", which wrote
directly to markee-dashboard's Supabase). Modeled after markee-dashboard's
skill_library(skill_type='skill') + departments/teams/favorites/recent tables,
rebuilt here as normalized tables in pm-new's own DB.

WIP-log entries (skill_type='wip' in the original) are NOT duplicated here —
those already have a real home in ProjectFeature/ProjectFeatureLog, which the
Prototype tab already renders.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from ..database import Base


class AiSkill(Base):
    __tablename__ = "ai_skills"

    id             = Column(Integer, primary_key=True, index=True)
    title          = Column(String(300), nullable=False)
    markdown_content = Column(Text, nullable=False)
    asset_type     = Column(String(30), nullable=False, default="skill", server_default="skill")
    category       = Column(String(100), nullable=True)
    department_id  = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    team_id        = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
    project_id     = Column(Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    status         = Column(String(20), nullable=False, default="approved", server_default="approved")
    created_by_id  = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    created_at     = Column(DateTime, server_default=func.now())
    updated_at     = Column(DateTime, server_default=func.now(), onupdate=func.now())

    department  = relationship("Department", lazy="select")
    team        = relationship("Team", lazy="select")
    project     = relationship("Project", lazy="select")
    created_by  = relationship("Member", foreign_keys=[created_by_id], lazy="select")
    attachments = relationship(
        "AiSkillAttachment", cascade="all, delete-orphan", lazy="select",
        order_by="AiSkillAttachment.id.asc()",
    )


class AiSkillAttachment(Base):
    __tablename__ = "ai_skill_attachments"

    id          = Column(Integer, primary_key=True, index=True)
    skill_id    = Column(Integer, ForeignKey("ai_skills.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name   = Column(String(300), nullable=False)
    file_path   = Column(String(500), nullable=False)
    mime_type   = Column(String(150), nullable=True)
    size_bytes  = Column(Integer, nullable=True)
    created_at  = Column(DateTime, server_default=func.now())


class AiSkillFavorite(Base):
    __tablename__ = "ai_skill_favorites"
    __table_args__ = (UniqueConstraint("member_id", "skill_id", name="uq_ai_skill_favorite"),)

    id         = Column(Integer, primary_key=True, index=True)
    member_id  = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    skill_id   = Column(Integer, ForeignKey("ai_skills.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())


class AiSkillRecent(Base):
    __tablename__ = "ai_skill_recent"
    __table_args__ = (UniqueConstraint("member_id", "skill_id", name="uq_ai_skill_recent"),)

    id         = Column(Integer, primary_key=True, index=True)
    member_id  = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True)
    skill_id   = Column(Integer, ForeignKey("ai_skills.id", ondelete="CASCADE"), nullable=False, index=True)
    used_at    = Column(DateTime, server_default=func.now())


class AiSession(Base):
    """Passive AUTO_LOG rows — one per message sent to an AI tool while the
    extension is active, whether or not a project is selected."""
    __tablename__ = "ai_sessions"

    id             = Column(Integer, primary_key=True, index=True)
    ai_tool        = Column(String(50), nullable=False)
    project_id     = Column(Integer, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    department_id  = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    team_id        = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    task_type      = Column(String(100), nullable=True)
    prompt_content = Column(Text, nullable=True)
    tokens_used    = Column(Integer, nullable=True, default=0)
    author_id      = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    created_at     = Column(DateTime, server_default=func.now())

    attachments = relationship(
        "AiSessionAttachment", cascade="all, delete-orphan", lazy="select",
        order_by="AiSessionAttachment.id.asc()",
    )


class AiSessionAttachment(Base):
    __tablename__ = "ai_session_attachments"

    id          = Column(Integer, primary_key=True, index=True)
    session_id  = Column(Integer, ForeignKey("ai_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name   = Column(String(300), nullable=False)
    file_path   = Column(String(500), nullable=False)
    mime_type   = Column(String(150), nullable=True)
    size_bytes  = Column(Integer, nullable=True)
    created_at  = Column(DateTime, server_default=func.now())


class AiUsageStat(Base):
    """Weekly AI-tool usage-quota pings, scraped client-side from each
    platform's own usage page (e.g. Claude/ChatGPT usage screens)."""
    __tablename__ = "ai_usage_stats"

    id          = Column(Integer, primary_key=True, index=True)
    member_id   = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True)
    ai_tool     = Column(String(50), nullable=False)
    weekly_used = Column(String(50), nullable=True)
    reset_time  = Column(String(100), nullable=True)
    recorded_at = Column(DateTime, server_default=func.now())
