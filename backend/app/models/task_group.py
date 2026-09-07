"""
TaskGroup model — belongs to Phase.
Groups tasks together. Displayed as a Table Row alongside Tasks.

Editable fields: name (Detail Task), manday_est, status, start_date_est
Auto-calculated: end_date_est, manday_actual, end_date_actual, progress

Rules:
- TaskGroup Done  → Commit KPI (show ✓ badge on child tasks)
- TaskGroup Cancel → Discard KPI (all child task KPIs = 0)
- Progress = count(task.status='Done') / count(total tasks)
- Roman Index is derived from sort_order (I, II, III...)
"""
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Numeric, ForeignKey, func, JSON
from sqlalchemy.orm import relationship
from ..database import Base


class TaskGroup(Base):
    __tablename__ = "task_groups"

    id            = Column(Integer, primary_key=True, index=True)
    phase_id      = Column(Integer, ForeignKey("phases.id", ondelete="RESTRICT"), nullable=False, index=True)
    name          = Column(String(500), nullable=False)        # Detail Task
    description   = Column(Text, nullable=True)
    status        = Column(String(50), default="Waiting")      # Waiting / Process / Done / Cancel
    progress      = Column(Numeric(5, 2), default=0)           # auto-calculated

    # Manday & Dates — editable. manday_est is capped at <= 10 by the router
    # (enforced only on create/update — existing rows saved before this rule
    # keep whatever value they already had).
    manday_est     = Column(Numeric(5, 2), nullable=True)
    start_date_est = Column(Date, nullable=True)

    # Member ids (of the group's own child Tasks' assigned/support, plus any
    # manually added) shown as a roster on the Task Group row. Additive: a
    # child Task's assigned/support member is appended here when set,
    # deduped, and never auto-removed — manual edits replace the whole list.
    assigned_ids  = Column(JSON, nullable=True, default=list)
    support_ids   = Column(JSON, nullable=True, default=list)

    # Auto-calculated
    end_date_est   = Column(Date, nullable=True)
    manday_actual  = Column(Numeric(5, 2), nullable=True)
    end_date_actual = Column(Date, nullable=True)
    end_date_actual_override = Column(Date, nullable=True)

    sort_order    = Column(Integer, default=0)
    created_at    = Column(DateTime, server_default=func.now())
    updated_at    = Column(DateTime, onupdate=func.now())

    # Relationships
    phase = relationship("Phase", back_populates="task_groups")
    tasks = relationship("Task", back_populates="task_group", lazy="select")
