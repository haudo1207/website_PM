from sqlalchemy import Column, Integer, String, Boolean, DateTime, func
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
    created_at = Column(DateTime, server_default=func.now())

    skills = relationship("Skill", secondary="user_skills", backref="users")

