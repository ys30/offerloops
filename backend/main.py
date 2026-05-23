"""FastAPI application — open API for job search platform."""

import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session
from pathlib import Path

from .database import JobRow, SessionLocal, get_db, init_db
from .models import (
    AnalyzeRequest,
    Job,
    JobCreate,
    JobSource,
    JobType,
    JobUpdate,
    SalaryRange,
    JobLocation,
)
from .pipeline import (
    ingest_greenhouse,
    ingest_lever,
    ingest_usajobs,
    job_to_row,
    row_to_job,
)

app = FastAPI(
    title="Job Search Platform API",
    description="Uniform job data pipeline — open for AI agents and humans.",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# Fully open CORS — AI agents can call from anywhere
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


# ── Jobs CRUD ────────────────────────────────────────────────────────


@app.get("/api/jobs", response_model=list[Job], tags=["jobs"])
def list_jobs(
    q: Optional[str] = Query(None, description="Full-text keyword search"),
    company: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    remote: Optional[bool] = Query(None),
    source: Optional[str] = Query(None),
    job_type: Optional[str] = Query(None),
    min_score: Optional[float] = Query(None, description="Minimum AI fit score"),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    query = db.query(JobRow)

    if q:
        query = query.filter(
            or_(
                JobRow.title.ilike(f"%{q}%"),
                JobRow.description.ilike(f"%{q}%"),
                JobRow.company.ilike(f"%{q}%"),
            )
        )
    if company:
        query = query.filter(JobRow.company.ilike(f"%{company}%"))
    if location:
        query = query.filter(
            or_(
                JobRow.location_city.ilike(f"%{location}%"),
                JobRow.location_state.ilike(f"%{location}%"),
                JobRow.location_raw.ilike(f"%{location}%"),
            )
        )
    if remote is not None:
        query = query.filter(JobRow.location_remote == remote)
    if source:
        query = query.filter(JobRow.source == source)
    if job_type:
        query = query.filter(JobRow.job_type == job_type)
    if min_score is not None:
        query = query.filter(JobRow.ai_score >= min_score)

    rows = query.order_by(JobRow.posted_date.desc()).offset(offset).limit(limit).all()
    return [row_to_job(r) for r in rows]


@app.get("/api/jobs/{job_id}", response_model=Job, tags=["jobs"])
def get_job(job_id: str, db: Session = Depends(get_db)):
    row = db.get(JobRow, job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return row_to_job(row)


@app.post("/api/jobs", response_model=Job, status_code=201, tags=["jobs"])
def create_job(payload: JobCreate, db: Session = Depends(get_db)):
    """Manually add a job posting via the web portal."""
    now = datetime.utcnow()
    job = Job(
        id="manual-" + str(uuid.uuid4())[:12],
        source=JobSource.manual,
        title=payload.title,
        company=payload.company,
        location=JobLocation(
            city=payload.location_city,
            state=payload.location_state,
            remote=payload.location_remote,
        ),
        salary=SalaryRange(
            min=payload.salary_min,
            max=payload.salary_max,
            period=payload.salary_period,
        ) if payload.salary_min or payload.salary_max else None,
        description=payload.description,
        requirements=payload.requirements,
        tags=payload.tags,
        job_type=payload.job_type,
        posted_date=payload.posted_date,
        deadline=payload.deadline,
        apply_url=payload.apply_url,
        created_at=now,
        updated_at=now,
    )
    db.add(job_to_row(job))
    db.commit()
    return job


@app.patch("/api/jobs/{job_id}", response_model=Job, tags=["jobs"])
def update_job(job_id: str, payload: JobUpdate, db: Session = Depends(get_db)):
    row = db.get(JobRow, job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        if field == "requirements" or field == "tags":
            setattr(row, field, json.dumps(value))
        elif field == "job_type":
            row.job_type = value.value if hasattr(value, "value") else value
        else:
            setattr(row, field, value)
    row.updated_at = datetime.utcnow()
    db.commit()
    return row_to_job(row)


@app.delete("/api/jobs/{job_id}", status_code=204, tags=["jobs"])
def delete_job(job_id: str, db: Session = Depends(get_db)):
    row = db.get(JobRow, job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(row)
    db.commit()


# ── Ingestion ────────────────────────────────────────────────────────


@app.post("/api/ingest/usajobs", tags=["ingest"])
async def trigger_usajobs(
    keyword: str = Query("", description="Job title / keyword"),
    organization: str = Query("", description="Agency code e.g. EP=EPA GS=USGS"),
    location: str = Query("", description="City or state"),
    pages: int = Query(1, le=5),
    db: Session = Depends(get_db),
):
    try:
        return await ingest_usajobs(db, keyword=keyword, organization=organization, location=location, pages=pages)
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))


@app.post("/api/ingest/greenhouse/{company_slug}", tags=["ingest"])
async def trigger_greenhouse(company_slug: str, db: Session = Depends(get_db)):
    return await ingest_greenhouse(db, company_slug=company_slug)


@app.post("/api/ingest/lever/{company_slug}", tags=["ingest"])
async def trigger_lever(company_slug: str, db: Session = Depends(get_db)):
    return await ingest_lever(db, company_slug=company_slug)


@app.post("/api/ingest/all", tags=["ingest"])
async def trigger_bulk(db: Session = Depends(get_db)):
    """Run all configured sources from sources_config.py."""
    from .pipeline import bulk_ingest
    try:
        return await bulk_ingest(db)
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))


# ── AI endpoints ─────────────────────────────────────────────────────


@app.post("/api/ai/analyze", tags=["ai"])
async def analyze_job(payload: AnalyzeRequest, db: Session = Depends(get_db)):
    """Score a job against a resume using Claude Opus 4.7. Pass api_key for BYOK."""
    from .ai import analyze_job_fit

    row = db.get(JobRow, payload.job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        result = await analyze_job_fit(
            job_id=payload.job_id,
            job_title=row.title,
            job_description=row.description or "",
            resume_text=payload.resume_text,
            api_key=payload.api_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {e}")

    # Persist score back to the job row
    row.ai_score = result.score
    row.ai_summary = result.summary
    row.ai_tags = json.dumps(result.extracted_requirements)
    row.updated_at = datetime.utcnow()
    db.commit()

    return result


@app.post("/api/ai/search", tags=["ai"])
async def ai_search(
    query: str = Query(..., description="Natural language: 'remote EPA data scientist'"),
    api_key: Optional[str] = Query(None, description="Anthropic API key (BYOK)"),
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
):
    """Parse a natural language query with Claude, then search the job database."""
    from .ai import parse_search_query

    try:
        params = parse_search_query(query, api_key=api_key)
    except Exception:
        params = {"keyword": query}

    keyword = params.get("keyword", "")
    location = params.get("location", "")

    db_query = db.query(JobRow)
    if keyword:
        db_query = db_query.filter(
            or_(
                JobRow.title.ilike(f"%{keyword}%"),
                JobRow.description.ilike(f"%{keyword}%"),
            )
        )
    if location and location.lower() not in ("", "remote"):
        db_query = db_query.filter(
            or_(
                JobRow.location_city.ilike(f"%{location}%"),
                JobRow.location_state.ilike(f"%{location}%"),
                JobRow.location_raw.ilike(f"%{location}%"),
            )
        )
    if location.lower() == "remote":
        db_query = db_query.filter(JobRow.location_remote == True)

    rows = db_query.order_by(JobRow.posted_date.desc()).limit(limit).all()
    return {
        "parsed_params": params,
        "count": len(rows),
        "jobs": [row_to_job(r) for r in rows],
    }


# ── Stats ────────────────────────────────────────────────────────────


@app.get("/api/stats", tags=["meta"])
def stats(db: Session = Depends(get_db)):
    from sqlalchemy import func
    total = db.query(func.count(JobRow.id)).scalar()
    by_source = db.query(JobRow.source, func.count(JobRow.id)).group_by(JobRow.source).all()
    remote_count = db.query(func.count(JobRow.id)).filter(JobRow.location_remote == True).scalar()
    scored = db.query(func.count(JobRow.id)).filter(JobRow.ai_score.isnot(None)).scalar()
    return {
        "total_jobs": total,
        "by_source": {s: c for s, c in by_source},
        "remote_jobs": remote_count,
        "ai_scored": scored,
    }


# ── Serve frontend ───────────────────────────────────────────────────

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        index = FRONTEND_DIST / "index.html"
        return FileResponse(index)
