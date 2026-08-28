"""
ProjectDocument model — the real "Trung tâm dữ liệu dự án" (Resources tab)
backing store: uploaded files or attached links, scoped to a project and
optionally a phase/task, with a lightweight draft/review/approved workflow.
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base


class ProjectDocument(Base):
    __tablename__ = "project_documents"

    id                = Column(Integer, primary_key=True, index=True)
    project_id        = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name              = Column(String(300), nullable=False)
    doc_type          = Column(String(50), nullable=False, default="Tài liệu")
    ext               = Column(String(20), nullable=False, default="FILE")
    phase_id          = Column(Integer, ForeignKey("phases.id", ondelete="SET NULL"), nullable=True, index=True)
    task_id           = Column(Integer, ForeignKey("tasks_v2.id", ondelete="SET NULL"), nullable=True, index=True)
    source            = Column(String(10), nullable=False, default="file")  # file | link
    file_path         = Column(String(500), nullable=True)   # relative path under UPLOAD_DIR
    url               = Column(String(1000), nullable=True)
    size_bytes        = Column(Integer, nullable=True)
    owner_member_id   = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True)
    uploader_user_id  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    status            = Column(String(20), nullable=False, default="draft", server_default="draft", index=True)  # draft | review | approved
    is_starred        = Column(Boolean, nullable=False, default=False, server_default="false")
    version           = Column(Integer, nullable=False, default=1, server_default="1")
    # True for a document this app created itself by mirroring a Task's LINK
    # column (Task.ticket_id) — kept apart from manually-added link resources
    # so the sync logic only ever touches documents it owns.
    synced_from_task_link = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    project  = relationship("Project", lazy="select")
    phase    = relationship("Phase", lazy="select")
    task     = relationship("Task", lazy="select")
    owner    = relationship("Member", foreign_keys=[owner_member_id], lazy="select")
    uploader = relationship("User", foreign_keys=[uploader_user_id], lazy="select")
