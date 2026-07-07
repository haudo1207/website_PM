from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func
from ..database import Base

class Phase(Base):
    __tablename__ = "phases"
    id = Column(Integer, primary_key=True)
    sheet_id = Column(Integer, ForeignKey("sheets.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    display_order = Column(Integer, default=0)
    is_master = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
