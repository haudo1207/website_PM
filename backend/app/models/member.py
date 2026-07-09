from sqlalchemy import Column, Integer, String, Date, ForeignKey, Table
from sqlalchemy.orm import relationship
from ..database import Base
import datetime

# Junction table for member <-> skills
member_skills = Table(
    'member_skills',
    Base.metadata,
    Column('member_id', Integer, ForeignKey('members.id', ondelete='CASCADE'), primary_key=True),
    Column('skill_id', Integer, ForeignKey('skills.id', ondelete='CASCADE'), primary_key=True)
)

class Member(Base):
    __tablename__ = "members"

    id              = Column(Integer, primary_key=True, index=True)
    display_name    = Column(String(50), unique=True, nullable=False, index=True)
    full_name       = Column(String(255), nullable=False)
    email           = Column(String(255), nullable=True)
    telegram_username = Column(String(100), nullable=True)
    phone           = Column(String(20), nullable=True)
    birth_date      = Column(Date, nullable=True)
    gender          = Column(String(20), nullable=True)   # Nam / Nữ / Khác
    team            = Column(String(100), nullable=True)
    position        = Column(String(100), nullable=True)
    department      = Column(String(100), nullable=True)
    experience_year = Column(Integer, default=0, nullable=True)
    created_at      = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())

    skills = relationship(
        "Skill",
        secondary=member_skills,
        backref="members",
        lazy="select"
    )
