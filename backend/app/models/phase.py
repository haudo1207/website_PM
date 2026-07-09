"""
Phase model — belongs to Project.
Master is NOT stored in DB, it's just a frontend view of all phases combined.
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base


class Phase(Base):
    __tablename__ = "phases"

    id          = Column(Integer, primary_key=True, index=True)
    project_id  = Column(Integer, ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False, index=True)
    name        = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    sort_order  = Column(Integer, default=0)
    status      = Column(String(50), default="Waiting")  # Waiting / Process / Done / Archived
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, onupdate=func.now())

    # Relationships
    project     = relationship("Project", back_populates="phases")
    task_groups = relationship("TaskGroup", back_populates="phase", lazy="select", order_by="TaskGroup.sort_order")
