from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base

class ChatGroup(Base):
    __tablename__ = "chat_groups"
    id = Column(Integer, primary_key=True)
    sheet_id = Column(Integer, ForeignKey("sheets.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    platform = Column(String, nullable=False)
    link = Column(String, nullable=False)
    desc = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    # We can define a back-reference to sheet, or keep it simple.
    # To keep it simple, sheet.py will not need circular imports.
