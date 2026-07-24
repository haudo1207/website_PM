from sqlalchemy import Column, Integer, Boolean, Date, DateTime, ForeignKey, UniqueConstraint, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class LunchRecord(Base):
    __tablename__ = "lunch_records"

    id = Column(Integer, primary_key=True, index=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    date = Column(Date, nullable=False)
    has_lunch = Column(Boolean, nullable=False, default=True)
    status = Column(String(20), nullable=False, default='no_lunch')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    member = relationship("Member", backref="lunch_records")

    __table_args__ = (
        UniqueConstraint("member_id", "date", name="uq_member_date_lunch"),
    )
