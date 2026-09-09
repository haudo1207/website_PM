from sqlalchemy import Column, Integer, String
from ..database import Base

class Position(Base):
    __tablename__ = "positions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)

class Department(Base):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)

class Team(Base):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)

class TaskPriority(Base):
    __tablename__ = "task_priorities"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    kpi_base = Column(Integer, nullable=False, default=6)
    color = Column(String, nullable=False, default="🟢")

class TaskStatus(Base):
    __tablename__ = "task_statuses"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)

class Customer(Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    business_unit = Column(String, nullable=False, default="infrastructure", index=True)

class Workspace(Base):
    __tablename__ = "workspaces"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    code = Column(String(50), unique=True, nullable=False)
    description = Column(String, nullable=True)
    # Per-workspace n8n meeting-discovery webhook override (see
    # notify_n8n_meeting_created in services/meeting_sync.py). Empty/None
    # falls back to the shared N8N_MEETING_WEBHOOK_URL_DEFAULT env var.
    n8n_webhook_url = Column(String(500), nullable=True)
    # Display-only hint of which Google account THIS workspace is supposed to
    # connect (WorkspaceGoogleAccount) — purely a label shown in the "Connect
    # Google account" UI before anyone has actually gone through OAuth for
    # this workspace, so the person clicking Connect knows which mailbox to
    # log in with. Not used for auth in any way (that's WorkspaceGoogleAccount
    # .google_email, set only after real OAuth consent).
    expected_google_email = Column(String(255), nullable=True)
