from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric, func
from ..database import Base


class MasterPhase(Base):
    __tablename__ = "master_phases"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(String, nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    # Configured Project Progress percentage (0..100) — single source of truth
    # for "Project Progress" everywhere in the system (Dashboard Team Load,
    # System Audit, Project Detail, Project Card/List). NULL = not yet
    # configured (treated as 0 by the shared lookup helper).
    progress_pct = Column(Numeric(5, 2), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
