import socket
import urllib.parse
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import settings

def is_db_reachable(url_str: str) -> bool:
    if not url_str:
        return False
    try:
        url = urllib.parse.urlparse(url_str)
        if url.scheme and "postgresql" in url.scheme:
            host = url.hostname or "localhost"
            port = url.port or 5432
            with socket.create_connection((host, port), timeout=1.0):
                return True
    except Exception:
        pass
    return False

db_url = settings.DATABASE_URL
connect_args = {}

if not is_db_reachable(db_url):
    sqlite_db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "task_portal.db"))
    db_url = f"sqlite:///{sqlite_db_path}"
    connect_args = {"check_same_thread": False}
    print(f"[*] PostgreSQL connection failed. Falling back to SQLite: {db_url}")

engine = create_engine(db_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
