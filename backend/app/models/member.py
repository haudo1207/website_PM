from sqlalchemy import Column, Integer, String, Date, ForeignKey, Table, Boolean, DateTime
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
    # Recruitment sync (`POST /members/sync-from-recruitment`). It marks
    # Recruitment-sourced rows for reporting/traceability. It previously also
    # gated the sync's automatic deletion step; that step has been REMOVED —
    # permanent Member deletion is now an explicit Member Management operation
    # only (`DELETE /api/members/{id}`), never a Recruitment-sync side effect,
    # so historical KPI of ON/OFF Members is always preserved.
    # Existing rows default to FALSE so the deployment never enters a state
    # where existing manual Members are misclassified.
    is_recruitment_synced = Column(Boolean, nullable=False, default=False, server_default="false")
    employment_status = Column(String(20), nullable=True, server_default="ON")
    # Captured at the exact moment the Recruitment/CV sync turned this Member
    # OFF. Powers time-aware Dashboard period filters so an OFF member who
    # worked through (say) Week N is still counted for Week N, but not for
    # subsequent periods. Legacy rows (OFF members synced before this column
    # landed) keep off_effective_at=NULL — the system-audit helper treats
    # those as "active for all historical periods" to avoid destroying
    # existing KPI history.
    off_effective_at = Column(DateTime, nullable=True)
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
