from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint, func
from sqlalchemy.orm import relationship
from ..database import Base


class MeetingProject(Base):
    """Extra project links for a meeting — Meeting.project_id stays the single
    "primary" project (used by scoring/back-compat); this table holds any
    additional projects a meeting is associated with."""
    __tablename__ = "meeting_projects"
    __table_args__ = (UniqueConstraint("meeting_id", "project_id", name="uq_meeting_project"),)

    id         = Column(Integer, primary_key=True, index=True)
    meeting_id = Column(Integer, ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())

    meeting = relationship("Meeting", back_populates="extra_projects", lazy="select")
    project = relationship("Project", lazy="select")
