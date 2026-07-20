from sqlalchemy import Column, Integer, String, Date, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base

class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    leave_type = Column(String(50), nullable=False)  # 'Work Remotely', 'Offline', 'Go on Business', 'Workshop', 'Work Weekend'
    start_date = Column(String(20), nullable=False)
    end_date = Column(String(20), nullable=False)
    man_day = Column(Integer, nullable=False)
    month = Column(String(20), nullable=False)
    year = Column(Integer, nullable=False)
    time = Column(String(20), nullable=False)
    province = Column(String(100), nullable=False)
    ward = Column(String(100), nullable=False)
    address = Column(String(255), nullable=True)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default='Pending')  # 'Pending', 'Approved', 'Rejected'
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationship
    user = relationship("User", backref="leave_requests")