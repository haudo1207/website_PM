from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base


class ProjectTemplate(Base):
    __tablename__ = "project_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    phases = relationship("ProjectTemplatePhase", back_populates="template", cascade="all, delete-orphan")


class ProjectTemplatePhase(Base):
    __tablename__ = "project_template_phases"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("project_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    template = relationship("ProjectTemplate", back_populates="phases")
    task_groups = relationship("ProjectTemplateTaskGroup", back_populates="phase", cascade="all, delete-orphan")


class ProjectTemplateTaskGroup(Base):
    __tablename__ = "project_template_task_groups"

    id = Column(Integer, primary_key=True, index=True)
    phase_id = Column(Integer, ForeignKey("project_template_phases.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())

    phase = relationship("ProjectTemplatePhase", back_populates="task_groups")
    tasks = relationship("ProjectTemplateTask", back_populates="task_group", cascade="all, delete-orphan")


class ProjectTemplateTask(Base):
    __tablename__ = "project_template_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_group_id = Column(Integer, ForeignKey("project_template_task_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    detail = Column(String(500), nullable=False)
    priority = Column(String(50), default="Normal", nullable=False)
    manday_est = Column(Integer, default=1, nullable=False)
    status = Column(String(50), default="Waiting", nullable=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())

    task_group = relationship("ProjectTemplateTaskGroup", back_populates="tasks")
