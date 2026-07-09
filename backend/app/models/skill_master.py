from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func, Table
from sqlalchemy.orm import relationship
from ..database import Base

user_skills = Table(
    "user_skills",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("skill_id", Integer, ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True)
)

class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    groups = relationship("Group", back_populates="category", cascade="all, delete-orphan")

class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    category = relationship("Category", back_populates="groups")
    skills = relationship("Skill", back_populates="group", cascade="all, delete-orphan")

class Skill(Base):
    __tablename__ = "skills"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    group = relationship("Group", back_populates="skills")
