from sqlalchemy import Column, Integer, String, Date, Boolean, DateTime, ForeignKey, Numeric, Text, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base

class LeaveRequest(Base):
    __tablename__ = "leave_requests"
    __table_args__ = (
        Index('ix_leave_requests_status_created', 'status', 'created_at'),
        Index('ix_leave_requests_user_status_created', 'user_id', 'status', 'created_at'),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    leave_type = Column(String(50), nullable=False)  # 'Annual Leave', 'Sick Leave', 'Remote Work', 'WFH', 'Business Trip', 'Offline', 'Half Day', 'Unpaid Leave', 'Other'
    start_date = Column(String(20), nullable=False)
    end_date = Column(String(20), nullable=False)
    # NUMERIC(3,1): hourly OFF = 0.5 man-day (business rule); full-day rows keep
    # whole numbers (existing INTEGER values convert losslessly at startup).
    man_day = Column(Numeric(3, 1), nullable=False)
    month = Column(String(20), nullable=False)
    year = Column(Integer, nullable=False)
    time = Column(String(20), nullable=False)
    # Hourly Leave ("OFF theo khung giờ"): both set, HH:MM, same calendar day
    # (start_date == end_date). NULL/NULL = full-day leave — every pre-existing
    # row reads unchanged. See create_leave_request validation.
    start_time = Column(String(5), nullable=True)
    end_time = Column(String(5), nullable=True)
    province = Column(String(100), nullable=False)
    ward = Column(String(100), nullable=False)
    address = Column(String(255), nullable=True)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default='Pending')  # 'Pending', 'Approved', 'Rejected'
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationship
    user = relationship("User", backref="leave_requests")