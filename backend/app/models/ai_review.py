from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, func, JSON
from sqlalchemy.orm import relationship
from ..database import Base

class AIPrompt(Base):
    __tablename__ = "ai_prompts"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)
    type = Column(String(50), nullable=False)  # PROJECT, PHASE, TASK
    name = Column(String(200), nullable=False)
    prompt_content = Column(Text, nullable=False)
    active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    # Relationships
    project = relationship("Project", foreign_keys=[project_id], lazy="select")
    creator = relationship("User", foreign_keys=[created_by], lazy="select")


class AIReviewLog(Base):
    __tablename__ = "ai_review_logs"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_type = Column(String(50), nullable=False)  # PROJECT, PHASE, TASK
    entity_id = Column(Integer, nullable=False, index=True)
    prompt_id = Column(Integer, ForeignKey("ai_prompts.id", ondelete="SET NULL"), nullable=True)
    prompt_snapshot = Column(Text, nullable=True)
    status = Column(String(50), default="NOT_CHECKED")  # NOT_CHECKED, CHECKING, CHECKED, HAS_ISSUE, NEED_RECHECK
    score = Column(Integer, nullable=True)
    issues_json = Column(JSON, nullable=True)
    suggestions_json = Column(JSON, nullable=True)
    result_markdown = Column(Text, nullable=True)
    checked_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    checked_at = Column(DateTime, server_default=func.now())

    # Relationships
    project = relationship("Project", foreign_keys=[project_id], lazy="select")
    checker = relationship("User", foreign_keys=[checked_by], lazy="select")
    prompt = relationship("AIPrompt", foreign_keys=[prompt_id], lazy="select")
