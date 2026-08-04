from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import settings

db_url = settings.DATABASE_URL or "sqlite:///./app.db"

engine_args = {
    "pool_pre_ping": True,
}
if db_url.startswith("postgresql"):
    engine_args.update({
        "pool_size": 2,
        "max_overflow": 0,
        "pool_recycle": 300,
        "pool_timeout": 30,
    })
elif db_url.startswith("sqlite"):
    engine_args["connect_args"] = {"check_same_thread": False}

engine = create_engine(db_url, **engine_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
