from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func
from ..database import Base

class Sheet(Base):
    __tablename__ = "sheets"
    id = Column(Integer, primary_key=True)
    spreadsheet_id = Column(String, nullable=False)
    name = Column(String)
    owner_id = Column(Integer, ForeignKey("users.id"))
    leader_email = Column(String, nullable=True)
    pm_email = Column(String, nullable=True)
    member_emails = Column(String, nullable=True)
    project_code = Column(String, nullable=True)
    customer_name = Column(String, nullable=True)
    current_phase = Column(String, nullable=True)
    spreadsheet_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    last_checked = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
