from sqlalchemy import Column, Integer, String, Boolean, DateTime, func
from ..database import Base


class MasterPhase(Base):
    __tablename__ = "master_phases"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(String, nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
