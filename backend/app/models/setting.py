from sqlalchemy import Column, Integer, String, Text, DateTime, func
from ..database import Base

class Setting(Base):
    __tablename__ = "settings"
    id = Column(Integer, primary_key=True)
    key = Column(String, unique=True, nullable=False)
    value = Column(Text, nullable=False)
    updated_by = Column(Integer, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    user_email = Column(String)
    action = Column(String)
    detail = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
