from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, func
from ..database import Base

class Violation(Base):
    __tablename__ = "violations"
    id = Column(Integer, primary_key=True)
    sheet_id = Column(Integer, ForeignKey("sheets.id"))
    tab_name = Column(String)
    row_number = Column(Integer)
    row_data = Column(Text)
    violation_code = Column(String)
    violation_msg = Column(Text)
    ai_verdict = Column(String)
    ai_reason = Column(Text)
    ai_suggestion = Column(Text)
    check_run_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
