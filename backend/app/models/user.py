from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from .skill_master import user_skills
from ..database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    full_name = Column(String)
    avatar_url = Column(String, nullable=True)
    google_sub = Column(String, nullable=True, unique=True)
    outlook_mail = Column(String, nullable=True, unique=True)
    outlook_sub = Column(String, nullable=True, unique=True)
    hashed_pw = Column(String, nullable=False)
    role = Column(String, default="member")
    is_active = Column(Boolean, default=True)
    position = Column(String, nullable=True)
    department = Column(String, nullable=True)
    # Telegram chat id of the account used to send Leave Request notifications.
    # Nullable because not every admin/super_admin will have connected Telegram.
    telegram_chat_id = Column(String, nullable=True, unique=True, index=True)
    # all: access every project; otherwise must match projects.data_scope.
    data_scope = Column(String(50), nullable=False, default="infrastructure", server_default="infrastructure")
    created_at = Column(DateTime, server_default=func.now())
    member_id = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True, unique=True)

    member = relationship(
        "Member",
        foreign_keys=[member_id],
        back_populates="user",
        lazy="joined"
    )
    skills = relationship("Skill", secondary="user_skills", backref="users")