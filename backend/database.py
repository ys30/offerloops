"""SQLite database setup using SQLAlchemy."""

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import (
    Column, DateTime, Float, String, Text, Boolean, create_engine, event
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DB_PATH = Path(__file__).parent / "jobs.db"
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})

# Enable WAL mode for better concurrent reads
@event.listens_for(engine, "connect")
def set_wal_mode(dbapi_conn, _):
    dbapi_conn.execute("PRAGMA journal_mode=WAL")


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class JobRow(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True)
    source = Column(String, nullable=False, index=True)
    source_id = Column(String, index=True)
    title = Column(String, nullable=False)
    company = Column(String, nullable=False, index=True)
    # location stored as JSON
    location_city = Column(String)
    location_state = Column(String)
    location_country = Column(String, default="US")
    location_remote = Column(Boolean, default=False)
    location_raw = Column(String)
    # salary
    salary_min = Column(Float)
    salary_max = Column(Float)
    salary_currency = Column(String, default="USD")
    salary_period = Column(String, default="annual")
    # content
    description = Column(Text)
    requirements = Column(Text, default="[]")   # JSON list
    tags = Column(Text, default="[]")            # JSON list
    job_type = Column(String, default="unknown")
    posted_date = Column(DateTime)
    deadline = Column(DateTime)
    apply_url = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # AI fields
    ai_summary = Column(Text)
    ai_score = Column(Float)
    ai_tags = Column(Text, default="[]")         # JSON list


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
