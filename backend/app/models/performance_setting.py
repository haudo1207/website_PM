from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, func
from ..database import Base


class PerformanceSetting(Base):
    __tablename__ = "performance_settings"

    id          = Column(Integer, primary_key=True, index=True)
    performance = Column(String(500), nullable=False)
    kpi         = Column(Numeric(10, 2), nullable=False)
    sort_order  = Column(Integer, default=0)
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())
