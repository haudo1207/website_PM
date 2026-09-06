"""
Task model — belongs to TaskGroup.
This is the ONLY entity where KPI is calculated.

Changes from v4:
- Removed: sheet_id, phase_name, is_section, root_task, sub_id, task_id
- Added: task_group_id (FK → task_groups)
- Renamed: task_id → task_code
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, Numeric, Text, ForeignKey, Boolean, func
from sqlalchemy.orm import relationship
from ..database import Base
from .skill_master import Group, Skill




class Task(Base):
    __tablename__ = "tasks_v2"

    id              = Column(Integer, primary_key=True, index=True)
    task_group_id   = Column(Integer, ForeignKey("task_groups.id", ondelete="RESTRICT"), nullable=False, index=True)

    # Display code — e.g. "301", "302"
    task_code       = Column(String(30), nullable=True)

    # Detail Task (required, max 500 chars)
    detail          = Column(String(500), nullable=False)

    # Priority (FK conceptual to system_categories.task_priorities)
    priority        = Column(String(50), default="Normal", nullable=False)

    # Manday EST
    manday_est      = Column(Numeric(5, 2), nullable=False)

    # Status
    status          = Column(String(50), default="Waiting", nullable=False)

    # Start Date
    start_date      = Column(Date, nullable=False)

    # Assigned (FK → members)
    assigned_id     = Column(Integer, ForeignKey("members.id", ondelete="RESTRICT"), nullable=False, index=True)

    # Support (FK → members)
    support_id      = Column(Integer, ForeignKey("members.id", ondelete="RESTRICT"), nullable=False, index=True)

    # KPI Ratio
    kpi_ratio_assign  = Column(Integer, default=90, nullable=False)
    kpi_ratio_support = Column(Integer, default=10, nullable=False)

    # Skill Solution (Group level)
    skill_solution_id = Column(Integer, ForeignKey("groups.id", ondelete="RESTRICT"), nullable=False, index=True)

    # Skill Vendor (Skill level)
    skill_vendor_id   = Column(Integer, ForeignKey("skills.id", ondelete="RESTRICT"), nullable=False, index=True)

    # Ticket ID
    ticket_id       = Column(Text, nullable=True)

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

    # AI Check Fields
    ai_status        = Column(String(50), default="NOT_CHECKED", nullable=False, server_default="NOT_CHECKED")
    last_ai_check_at = Column(DateTime, nullable=True)
    last_ai_score    = Column(Integer, nullable=True)
    last_review_id   = Column(Integer, nullable=True)

    # Zalo "Yêu cầu xem demo" flow — some Done tasks just don't need a demo;
    # marking this hides the request button/nag for this task without ever
    # having deleted its demo-request history.
    zalo_demo_skip   = Column(Boolean, nullable=False, default=False, server_default="false")

    # Review workflow — a layer SEPARATE from `status` (status stays the
    # tenant-configurable free-text lookup it always was, e.g. "Waiting" /
    # "Review" / a custom name). review_status is our own fixed vocabulary:
    # None (never entered review) / "pending" / "approved" / "changes_requested".
    review_status          = Column(String(30), nullable=True)
    review_requested_at    = Column(DateTime, nullable=True)
    review_requested_by    = Column(Integer, nullable=True)  # users.id
    approved_at            = Column(DateTime, nullable=True)
    approved_by            = Column(Integer, nullable=True)  # users.id
    change_requested_at    = Column(DateTime, nullable=True)
    change_requested_by    = Column(Integer, nullable=True)  # users.id
    change_request_reason  = Column(Text, nullable=True)
    last_review_action_at  = Column(DateTime, nullable=True)

    # Relationships
    task_group        = relationship("TaskGroup", back_populates="tasks")
    assigned_member   = relationship("Member", foreign_keys=[assigned_id], lazy="select")
    support_member    = relationship("Member", foreign_keys=[support_id], lazy="select")
    skill_solution_rel = relationship("Group", foreign_keys=[skill_solution_id], lazy="select")
    skill_vendor_rel   = relationship("Skill", foreign_keys=[skill_vendor_id], lazy="select")
