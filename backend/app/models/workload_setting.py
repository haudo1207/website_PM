"""
Workload threshold configuration — dedicated table for Section 4
workload classification boundaries (Quá tải / Bình thường / Còn capacity / Không làm việc).
"""
from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, func
from ..database import Base


class WorkloadSetting(Base):
    __tablename__ = "workload_settings"

    id          = Column(Integer, primary_key=True, index=True)
    status_key  = Column(String(30), unique=True, nullable=False)   # overload | normal | capacity | not_working
    status_label = Column(String(100), nullable=False)              # Quá tải | Bình thường | Còn capacity | Không làm việc
    min_kpi     = Column(Numeric(10, 2), nullable=True)             # inclusive lower bound (NULL = -infinity)
    max_kpi     = Column(Numeric(10, 2), nullable=True)             # inclusive upper bound (NULL = +infinity)
    sort_order  = Column(Integer, default=0)
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())
