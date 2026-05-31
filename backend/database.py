"""Database setup — PostgreSQL in production, SQLite for local dev."""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional  # noqa: F401

from sqlalchemy import (
    Column, DateTime, Float, String, Text, Boolean, create_engine, event
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL:
    # Railway injects postgres://...; SQLAlchemy needs postgresql://
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    _is_sqlite = False
else:
    DB_PATH = Path(__file__).parent / "jobs.db"
    engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
    _is_sqlite = True

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
    # Application tracking
    status = Column(String, default="new", index=True)  # new|interested|applied|phone_screen|interview|offer|rejected|withdrawn
    applied_date = Column(DateTime)
    notes = Column(Text)
    user_id = Column(String, index=True)


class UserRow(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=True)   # null for OAuth-only accounts
    name = Column(String)
    phone = Column(String)
    location = Column(String)
    oauth_provider = Column(String)   # "google" | "github" | null
    oauth_sub = Column(String)        # provider user ID
    avatar_url = Column(String)
    reset_token = Column(String)
    reset_expires = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GmailTokenRow(Base):
    __tablename__ = "gmail_tokens"

    user_id = Column(String, primary_key=True)
    access_token = Column(String)
    refresh_token = Column(String)
    expires_at = Column(DateTime)
    connected_at = Column(DateTime, default=datetime.utcnow)
    last_synced_at = Column(DateTime)


class EmailEventRow(Base):
    __tablename__ = "email_events"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    job_id = Column(String, nullable=True, index=True)   # matched job, if any
    gmail_message_id = Column(String, unique=True, index=True)
    sender = Column(String)
    subject = Column(String)
    snippet = Column(String)
    detected_status = Column(String)   # applied|phone_screen|interview|offer|rejected
    company_guess = Column(String)
    role_guess = Column(String)
    email_date = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProfileRow(Base):
    __tablename__ = "profiles"

    id = Column(String, primary_key=True, default="default")
    name = Column(String)
    email = Column(String)
    phone = Column(String)
    location = Column(String)
    linkedin_url = Column(String)
    github_url = Column(String)
    google_scholar_url = Column(String)
    orcid_url = Column(String)
    website_url = Column(String)
    twitter_url = Column(String)
    resume_text = Column(Text)          # raw text (source of truth for AI)
    education_json = Column(Text, default="[]")  # JSON list of {degree, school, year, notes}
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ProjectRow(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=lambda: str(__import__("uuid").uuid4()))
    user_id = Column(String, index=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    role = Column(Text, nullable=True)
    tech_stack = Column(Text, default="[]")   # JSON list
    outcome = Column(Text, nullable=True)
    url = Column(Text, nullable=True)
    dates = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StoryRow(Base):
    __tablename__ = "stories"

    id = Column(String, primary_key=True, default=lambda: str(__import__("uuid").uuid4()))
    user_id = Column(String, index=True, nullable=False)
    title = Column(String, nullable=False)
    situation = Column(Text, nullable=True)
    task = Column(Text, nullable=True)
    action = Column(Text, nullable=True)
    result = Column(Text, nullable=True)
    skills = Column(Text, default="[]")          # JSON list of skill tags
    linked_job_ids = Column(Text, default="[]")  # JSON list of job IDs this story is linked to
    ai_polished = Column(Boolean, default=False)
    category = Column(Text, default="")
    reflection = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate(conn):
    """Add columns / fix schema issues from older versions."""
    cur = conn.cursor()

    def col_info(table: str) -> dict:
        cur.execute(f"PRAGMA table_info({table})")
        return {row[1]: row for row in cur.fetchall()}  # name -> (cid, name, type, notnull, dflt, pk)

    # ── users table ──────────────────────────────────────────────────────────
    ucols = col_info("users")

    # If password_hash is NOT NULL, recreate the table with the correct schema.
    # This preserves all existing rows.
    pw_col = ucols.get("password_hash")
    if pw_col and pw_col[3] == 1:  # notnull == 1
        cur.execute("""
            CREATE TABLE users_new (
                id VARCHAR NOT NULL PRIMARY KEY,
                email VARCHAR NOT NULL UNIQUE,
                password_hash VARCHAR,
                name VARCHAR,
                phone VARCHAR,
                location VARCHAR,
                oauth_provider TEXT,
                oauth_sub TEXT,
                avatar_url TEXT,
                reset_token TEXT,
                reset_expires DATETIME,
                created_at DATETIME,
                updated_at DATETIME
            )
        """)
        # Copy all columns that existed in both old and new
        old_cols = ", ".join(c for c in [
            "id", "email", "password_hash", "name", "phone", "location",
            "oauth_provider", "oauth_sub", "avatar_url",
            "reset_token", "reset_expires", "created_at", "updated_at",
        ] if c in ucols)
        cur.execute(f"INSERT INTO users_new ({old_cols}) SELECT {old_cols} FROM users")
        cur.execute("DROP TABLE users")
        cur.execute("ALTER TABLE users_new RENAME TO users")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users(email)")
        ucols = col_info("users")  # refresh after recreate

    # Add any remaining missing columns
    for col, typ in {
        "oauth_provider": "TEXT",
        "oauth_sub":      "TEXT",
        "avatar_url":     "TEXT",
        "reset_token":    "TEXT",
        "reset_expires":  "DATETIME",
    }.items():
        if col not in ucols:
            cur.execute(f"ALTER TABLE users ADD COLUMN {col} {typ}")

    # ── jobs table ───────────────────────────────────────────────────────────
    jcols = col_info("jobs")
    for col, typ in {
        "status":       "TEXT DEFAULT 'new'",
        "applied_date": "DATETIME",
        "notes":        "TEXT",
        "user_id":      "TEXT",
    }.items():
        if col not in jcols:
            cur.execute(f"ALTER TABLE jobs ADD COLUMN {col} {typ}")

    # Assign existing unowned jobs to the oldest user account
    if "user_id" not in jcols:
        cur.execute("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
        row = cur.fetchone()
        if row:
            cur.execute("UPDATE jobs SET user_id = ? WHERE user_id IS NULL", (row[0],))

    # ── profiles table extra link columns ────────────────────────────────────
    pcols2 = col_info("profiles")
    for col in ["github_url", "google_scholar_url", "orcid_url", "website_url", "twitter_url"]:
        if col not in pcols2:
            cur.execute(f"ALTER TABLE profiles ADD COLUMN {col} TEXT")
    if "education_json" not in pcols2:
        cur.execute("ALTER TABLE profiles ADD COLUMN education_json TEXT DEFAULT '[]'")

    # ── projects table ───────────────────────────────────────────────────────
    try:
        prcols = col_info("projects")
        for col, typ in {
            "description": "TEXT",
            "role":        "TEXT",
            "tech_stack":  "TEXT DEFAULT '[]'",
            "outcome":     "TEXT",
            "url":         "TEXT",
            "dates":       "TEXT",
        }.items():
            if col not in prcols:
                cur.execute(f"ALTER TABLE projects ADD COLUMN {col} {typ}")
    except Exception:
        pass

    # ── stories table ────────────────────────────────────────────────────────
    try:
        scols = col_info("stories")
        for col, typ in {
            "linked_job_ids": "TEXT DEFAULT '[]'",
            "ai_polished":    "BOOLEAN DEFAULT 0",
            "category":       "TEXT DEFAULT ''",
            "reflection":     "TEXT",
        }.items():
            if col not in scols:
                cur.execute(f"ALTER TABLE stories ADD COLUMN {col} {typ}")
    except Exception:
        pass  # table may not exist yet; create_all will handle it

    # ── profiles table ───────────────────────────────────────────────────────
    pcols = col_info("profiles")
    if "user_id" not in pcols:
        # Migrate the singleton "default" profile to the oldest user's id
        cur.execute("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
        row = cur.fetchone()
        if row:
            cur.execute("UPDATE profiles SET id = ? WHERE id = 'default'", (row[0],))

    # ── email_events table ───────────────────────────────────────────────────
    try:
        cur.execute("SELECT 1 FROM email_events LIMIT 1")
    except Exception:
        pass  # create_all will handle it

    conn.commit()


def _migrate_pg(conn):
    """Add missing columns for PostgreSQL (SQLAlchemy inspect-based, dialect-agnostic)."""
    from sqlalchemy import inspect, text
    inspector = inspect(conn)
    # profiles table — add link columns
    try:
        pcols = {c["name"] for c in inspector.get_columns("profiles")}
        for col in ["github_url", "google_scholar_url", "orcid_url", "website_url", "twitter_url"]:
            if col not in pcols:
                conn.execute(text(f"ALTER TABLE profiles ADD COLUMN {col} TEXT"))
        if "education_json" not in pcols:
            conn.execute(text("ALTER TABLE profiles ADD COLUMN education_json TEXT DEFAULT '[]'"))
        conn.commit()
    except Exception:
        pass

    # projects table — add optional columns
    try:
        existing_p = {c["name"] for c in inspector.get_columns("projects")}
        for col, typ in [
            ("description", "TEXT"), ("role", "TEXT"),
            ("tech_stack", "TEXT DEFAULT '[]'"), ("outcome", "TEXT"),
            ("url", "TEXT"), ("dates", "TEXT"),
        ]:
            if col not in existing_p:
                conn.execute(text(f"ALTER TABLE projects ADD COLUMN {col} {typ}"))
        conn.commit()
    except Exception:
        pass

    # stories table — add columns introduced in pool-model refactor
    try:
        existing = {c["name"] for c in inspector.get_columns("stories")}
        if "linked_job_ids" not in existing:
            conn.execute(text("ALTER TABLE stories ADD COLUMN linked_job_ids TEXT DEFAULT '[]'"))
        if "ai_polished" not in existing:
            conn.execute(text("ALTER TABLE stories ADD COLUMN ai_polished BOOLEAN DEFAULT FALSE"))
        if "category" not in existing:
            conn.execute(text("ALTER TABLE stories ADD COLUMN category TEXT DEFAULT ''"))
        if "reflection" not in existing:
            conn.execute(text("ALTER TABLE stories ADD COLUMN reflection TEXT"))
        conn.commit()
    except Exception:
        pass  # table may not exist yet; create_all handles it


def init_db():
    Base.metadata.create_all(bind=engine)
    if _is_sqlite:
        with engine.connect() as conn:
            _migrate(conn.connection.driver_connection)
    else:
        with engine.connect() as conn:
            _migrate_pg(conn)
