"""
Shared fixtures for the backend test suite.

Tests call the route functions directly against a throwaway in-memory SQLite
database — no running server, no Postgres, no auth tokens needed.

    cd backend
    pip install -r requirements-dev.txt
    python -m pytest tests -q
"""
import importlib
import os
import pkgutil
import sys
from types import SimpleNamespace

# Must be set before anything imports app.database / app.config.
os.environ["DATABASE_URL"] = "sqlite://"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models
for _m in pkgutil.iter_modules(app.models.__path__):
    importlib.import_module(f"app.models.{_m.name}")

from app.database import Base
from app.models.member import Member
from app.models.project import project_members
from app.models.system_category import Workspace
from app.models.workspace_access import UserWorkspaceAccess


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add_all([Workspace(name="Infras", code="infras"), Workspace(name="Markee", code="markee")])
    session.commit()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def ws(db):
    return {w.code: w for w in db.query(Workspace).all()}


def _member(db, name):
    m = Member(display_name=name, full_name=name.title())
    db.add(m)
    db.commit()
    return m


def _grant(db, user_id, *workspaces):
    db.add_all([UserWorkspaceAccess(user_id=user_id, workspace_id=w.id) for w in workspaces])
    db.commit()


@pytest.fixture
def admin():
    return SimpleNamespace(id=1, role="super_admin", data_scope="all", member_id=None)


@pytest.fixture
def leader(db, ws):
    """Leader whose Chính Workspace is Infras and Phụ Workspace is Markee."""
    m = _member(db, "leader")
    _grant(db, 2, ws["infras"], ws["markee"])
    return SimpleNamespace(id=2, role="leader", data_scope="infras", member_id=m.id)


@pytest.fixture
def leader_infras_only(db, ws):
    m = _member(db, "leader2")
    _grant(db, 4, ws["infras"])
    return SimpleNamespace(id=4, role="leader", data_scope="infras", member_id=m.id)


@pytest.fixture
def member(db, ws):
    m = _member(db, "member")
    _grant(db, 3, ws["infras"])
    return SimpleNamespace(id=3, role="member", data_scope="infras", member_id=m.id)


@pytest.fixture
def assign(db):
    def _assign(project_id, member_id, role="Member"):
        db.execute(project_members.insert().values(project_id=project_id, member_id=member_id, role=role))
        db.commit()
    return _assign


@pytest.fixture
def status_of(db):
    """Run *fn*; return 200 on success or the HTTPException status code."""
    def _status_of(fn):
        try:
            fn()
            return 200
        except HTTPException as e:
            db.rollback()
            return e.status_code
    return _status_of


def names(rows):
    return {c.name for c in rows}
