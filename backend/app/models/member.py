from sqlalchemy import Column, Integer, String, Date, ForeignKey, Table, Boolean
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
    # Display name this member is tagged by on Zalo (e.g. "Nguyễn Minh Hoàng")
    # — used to resolve @mentions in Zalo /task messages to this member.
    zalo_name       = Column(String(100), nullable=True)
    # Real Zalo UID — the durable identity link (display names can be
    # casual/change). Set the first time a Zalo group member is picked as a
    # task assignee (auto-provisioned member or matched to an existing one).
    zalo_uid        = Column(String(50), nullable=True, unique=True, index=True)
    phone           = Column(String(20), nullable=True)
    birth_date      = Column(Date, nullable=True)
    gender          = Column(String(20), nullable=True)   # Nam / Nữ / Khác
    team            = Column(String(100), nullable=True)
    position        = Column(String(100), nullable=True)
    department      = Column(String(100), nullable=True)
    experience_year = Column(Integer, default=0, nullable=True)
    cv_link         = Column(String(255), nullable=True)
    # Provenance flag — True ONLY when this Member was created by the
    # Recruitment sync (`POST /members/sync-from-recruitment`). The flag
    # distinguishes Recruitment-sourced rows from Admin-created rows so the
    # sync's deletion step can remove only its own records when an accepted
    # application lapses, without ever touching a manually-created Member.
    # Existing rows default to FALSE so the deployment never enters a state
    # where existing manual Members are misclassified.
    is_recruitment_synced = Column(Boolean, nullable=False, default=False, server_default="false")
    leader_name     = Column(String(100), nullable=True)
    leader_email    = Column(String(255), nullable=True)
    leader_member_id = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    created_at      = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())

    leader = relationship("Member", foreign_keys=[leader_member_id], remote_side=[id], lazy="joined")

    skills = relationship(
        "Skill",
        secondary=member_skills,
        backref="members",
        lazy="select"
    )
    user = relationship(
        "User",
        back_populates="member",
        uselist=False
    )
