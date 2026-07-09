"""
Task model — belongs to TaskGroup.
This is the ONLY entity where KPI is calculated.

Changes from v4:
- Removed: sheet_id, phase_name, is_section, root_task, sub_id, task_id
- Added: task_group_id (FK → task_groups)
- Renamed: task_id → task_code
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, Numeric, Text, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base


class Task(Base):
    __tablename__ = "tasks_v2"

    id              = Column(Integer, primary_key=True, index=True)
    task_group_id   = Column(Integer, ForeignKey("task_groups.id", ondelete="RESTRICT"), nullable=False, index=True)

    # Display code — e.g. "301", "302"
    task_code       = Column(String(30), nullable=True)

    # Detail Task (required, max 500 chars)
    detail          = Column(String(500), nullable=False)

    # Priority (FK conceptual to system_categories.task_priorities)
    priority        = Column(String(50), default="Normal")

    # Manday EST
    manday_est      = Column(Numeric(5, 2), nullable=True)

    # Status
    status          = Column(String(50), default="Waiting")

    # Start Date
    start_date      = Column(Date, nullable=True)

    # Assigned (FK → members)
    assigned_id     = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)

    # Support (FK → members)
    support_id      = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)

    # KPI Ratio
    kpi_ratio_assign  = Column(Integer, default=100)
    kpi_ratio_support = Column(Integer, default=0)

    # Skill Solution (Group level)
    skill_solution_id = Column(Integer, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)

    # Skill Vendor (Skill level)
    skill_vendor_id   = Column(Integer, ForeignKey("skills.id", ondelete="SET NULL"), nullable=True)

    # Ticket ID
    ticket_id       = Column(String(500), nullable=True)

    # Remark
    remark          = Column(String(500), nullable=True)

    # Send
    send            = Column(String(500), nullable=True)

    # Sort order within task group
    sort_order      = Column(Integer, default=0)

    # === COMPUTED FIELDS (server-side, read-only on frontend) ===

    # End Date EST = Start Date + CEIL(Manday EST) - 1
    end_date_est    = Column(Date, nullable=True)

    # Manday Actual = Status==Done ? EndActual - Start + 1 : NULL
    manday_actual   = Column(Numeric(5, 2), nullable=True)

    # End Date Actual (editable only when Status=Done)
    end_date_actual = Column(Date, nullable=True)

    # Days Late
    days_late       = Column(Integer, nullable=True)

    # KPI Base = Priority.kpi_base × Manday EST
    kpi_base        = Column(Numeric(10, 2), default=0)

    # KPI Perform
    kpi_perform     = Column(Numeric(10, 2), default=0)

    # KPI OT
    kpi_ot          = Column(Numeric(10, 2), default=0)

    # KPI Final = Base + Perform + OT
    kpi_final       = Column(Numeric(10, 2), default=0)
    kpi_assigned    = Column(Numeric(10, 2), default=0)
    kpi_support     = Column(Numeric(10, 2), default=0)

    # Notes
    notes           = Column(Text, nullable=True)

    # Solution (auto-lookup from Skill Vendor → Group → Category)
    solution        = Column(String(200), nullable=True)

    # Metadata
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, onupdate=func.now())

    # Relationships
    task_group        = relationship("TaskGroup", back_populates="tasks")
    assigned_member   = relationship("Member", foreign_keys=[assigned_id], lazy="select")
    support_member    = relationship("Member", foreign_keys=[support_id], lazy="select")
    skill_solution_rel = relationship("Group", foreign_keys=[skill_solution_id], lazy="select")
    skill_vendor_rel   = relationship("Skill", foreign_keys=[skill_vendor_id], lazy="select")
