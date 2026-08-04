from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import settings

db_url = settings.DATABASE_URL
if not db_url or not db_url.strip():
    db_url = "postgresql://postgres.asvtfrbkvgllqsksuyxp:Poptech%40123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"

engine = create_engine(
    db_url,
    pool_pre_ping=True,
    pool_size=2,
    max_overflow=0,
    pool_recycle=300,
    pool_timeout=30,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
