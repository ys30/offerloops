"""Canonical job schema — all sources normalize to this."""

from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, HttpUrl


class JobType(str, Enum):
    full_time = "full-time"
    part_time = "part-time"
    contract = "contract"
    internship = "internship"
    temporary = "temporary"
    unknown = "unknown"


class JobSource(str, Enum):
    usajobs = "usajobs"
    greenhouse = "greenhouse"
    lever = "lever"
    ashby = "ashby"
    eighty_k_hours = "80k_hours"
    climatebase = "climatebase"
    idealist = "idealist"
    manual = "manual"
    other = "other"


class SalaryRange(BaseModel):
    min: Optional[float] = None
    max: Optional[float] = None
    currency: str = "USD"
    period: str = "annual"  # annual | hourly


class JobLocation(BaseModel):
    city: Optional[str] = None
    state: Optional[str] = None
    country: str = "US"
    remote: bool = False
    raw: Optional[str] = None  # original string from source


APPLICATION_STATUSES = ["new", "interested", "applied", "phone_screen", "interview", "offer", "rejected", "withdrawn"]


class Job(BaseModel):
    id: str                              # platform-assigned UUID
    source: JobSource
    source_id: Optional[str] = None     # ID in the originating system
    title: str
    company: str
    location: JobLocation
    salary: Optional[SalaryRange] = None
    description: str
    requirements: list[str] = []
    tags: list[str] = []
    job_type: JobType = JobType.unknown
    posted_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    apply_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # AI-enriched fields (populated by /api/ai/analyze)
    ai_summary: Optional[str] = None
    ai_score: Optional[float] = None    # 0-5 fit score vs resume
    ai_tags: list[str] = []
    # Application tracking
    status: str = "new"
    applied_date: Optional[datetime] = None
    notes: Optional[str] = None


class JobCreate(BaseModel):
    """Manual job entry from the web portal."""
    title: str
    company: str
    location_city: Optional[str] = None
    location_state: Optional[str] = None
    location_remote: bool = False
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    salary_period: str = "annual"
    description: str
    requirements: list[str] = []
    tags: list[str] = []
    job_type: JobType = JobType.unknown
    posted_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    apply_url: Optional[str] = None


class JobUpdate(BaseModel):
    title: Optional[str] = None
    company: Optional[str] = None
    description: Optional[str] = None
    requirements: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    job_type: Optional[JobType] = None
    apply_url: Optional[str] = None
    deadline: Optional[datetime] = None
    status: Optional[str] = None
    applied_date: Optional[datetime] = None
    notes: Optional[str] = None


class JobSearchParams(BaseModel):
    q: Optional[str] = None             # full-text keyword
    title: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    remote: Optional[bool] = None
    source: Optional[JobSource] = None
    job_type: Optional[JobType] = None
    limit: int = 50
    offset: int = 0


class AnalyzeRequest(BaseModel):
    job_id: str
    resume_text: Optional[str] = None   # uses stored profile if omitted
    provider: str = "anthropic"         # anthropic | openai | nvidia | gemini
    model: Optional[str] = None         # override default model for the provider
    api_key: Optional[str] = None       # BYOK — provider key from client


class AnalyzeResult(BaseModel):
    job_id: str
    score: float
    summary: str
    fit_reasons: list[str]
    gap_reasons: list[str]
    extracted_requirements: list[str]


class ApplicationPackRequest(BaseModel):
    job_id: str
    resume_text: Optional[str] = None   # uses stored profile if omitted
    provider: str = "nvidia"
    model: Optional[str] = None
    api_key: Optional[str] = None


class ApplicationPackResult(BaseModel):
    job_id: str
    job_title: str
    company: str
    tailored_resume: dict   # structured JSON with name/experience/education/skills
    cover_letter: str       # plain text
    provider_used: str


class ProfileIn(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin_url: Optional[str] = None
    resume_text: Optional[str] = None


class ProfileOut(BaseModel):
    id: str
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin_url: Optional[str] = None
    resume_text: Optional[str] = None
    updated_at: Optional[datetime] = None
