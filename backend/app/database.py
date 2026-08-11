from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import settings

db_url = settings.DATABASE_URL or "sqlite:///./app.db"

engine_args = {
    "pool_pre_ping": True,
}
if db_url.startswith("postgresql"):
    engine_args.update({
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "pool_recycle": 300,
        "pool_timeout": settings.DB_POOL_TIMEOUT,
    })
elif db_url.startswith("sqlite"):
    engine_args["connect_args"] = {"check_same_thread": False}

engine = create_engine(db_url, **engine_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Separate, small pool for background jobs (meeting auto-sync loop, cron...).
# These hold a session open while calling slow external APIs (Zoom/Google/AI);
# on Postgres they get their own tiny pool so a slow external call never
# starves the pool serving real user requests.
background_engine = (
    create_engine(
        db_url,
        pool_pre_ping=True,
        pool_size=1,
        max_overflow=0,
        pool_recycle=300,
    )
    if db_url.startswith("postgresql")
    else engine
)
BackgroundSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=background_engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
