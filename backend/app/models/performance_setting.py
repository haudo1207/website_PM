from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, ForeignKey, func
from ..database import Base


class PerformanceSetting(Base):
    __tablename__ = "performance_settings"

    id          = Column(Integer, primary_key=True, index=True)
    performance = Column(String(500), nullable=False)
    kpi         = Column(Numeric(10, 2), nullable=False)
    remark_type = Column(String(20), nullable=False, default="Bonus", server_default="Bonus")
    description = Column(String, nullable=True)
    sort_order  = Column(Integer, default=0)
    is_active   = Column(Boolean, default=True)
    is_parent   = Column(Boolean, default=False, server_default="false")  # True = Remark Cha
    parent_id   = Column(Integer, ForeignKey("performance_settings.id", ondelete="SET NULL"), nullable=True)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())
