from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    full_name = Column(String)
    hashed_pw = Column(String, nullable=False)
    role = Column(String, default="group_a")
    is_active = Column(Boolean, default=True)
    position = Column(String, nullable=True)
    department = Column(String, nullable=True)
    # all: access every project; otherwise must match projects.data_scope.
    data_scope = Column(String(50), nullable=False, default="infrastructure", server_default="infrastructure")
    created_at = Column(DateTime, server_default=func.now())
    member_id = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True, unique=True)

    member = relationship("Member", foreign_keys=[member_id], lazy="joined")
    skills = relationship("Skill", secondary="user_skills", backref="users")
