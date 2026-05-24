"""FastAPI application — open API for job search platform."""

import asyncio
import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session
from pathlib import Path

from fastapi import UploadFile, File
from .database import JobRow, ProfileRow, SessionLocal, get_db, init_db
from .models import (
    AnalyzeRequest,
    ApplicationPackRequest,
    ApplicationPackResult,
    Job,
    JobCreate,
    JobSource,
    JobType,
    JobUpdate,
    ProfileIn,
    ProfileOut,
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


@app.get("/api/ai/providers", tags=["ai"])
def get_providers():
    """List available AI providers and their configured status."""
    from .ai import available_providers
    return available_providers()


@app.post("/api/ai/analyze", tags=["ai"])
async def analyze_job(payload: AnalyzeRequest, db: Session = Depends(get_db)):
    """Score a job against a resume. Supports anthropic, openai, nvidia, gemini."""
    from .ai import analyze_job_fit

    row = db.get(JobRow, payload.job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    resume_text = payload.resume_text
    if not resume_text:
        from .profile import get_profile
        profile = get_profile(db)
        if profile and profile.resume_text:
            resume_text = profile.resume_text
        else:
            raise HTTPException(status_code=422, detail="No resume provided and no profile saved. Upload your resume first.")

    try:
        result = await analyze_job_fit(
            job_id=payload.job_id,
            job_title=row.title,
            job_description=row.description or "",
            resume_text=resume_text,
            provider=payload.provider,
            model=payload.model,
            api_key=payload.api_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {e}")

    row.ai_score = result.score
    row.ai_summary = result.summary
    row.ai_tags = json.dumps(result.extracted_requirements)
    row.updated_at = datetime.utcnow()
    db.commit()

    return result


@app.post("/api/ai/application-pack", response_model=ApplicationPackResult, tags=["ai"])
async def generate_application_pack(
    payload: ApplicationPackRequest,
    db: Session = Depends(get_db),
):
    """One-click: generate tailored resume + cover letter for a job."""
    from .ai import tailor_resume, generate_cover_letter, _pick_provider

    row = db.get(JobRow, payload.job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    # Use stored profile resume if none provided in payload
    resume_text = payload.resume_text
    if not resume_text:
        from .profile import get_profile
        profile = get_profile(db)
        if profile and profile.resume_text:
            resume_text = profile.resume_text
        else:
            raise HTTPException(status_code=422, detail="No resume provided and no profile saved. Upload your resume first.")

    try:
        provider_used, _ = _pick_provider(payload.provider, payload.api_key)
        tailored, cover = await asyncio.gather(
            tailor_resume(
                job_title=row.title,
                job_description=row.description or "",
                resume_text=resume_text,
                provider=payload.provider,
                model=payload.model,
                api_key=payload.api_key,
            ),
            generate_cover_letter(
                job_title=row.title,
                company=row.company,
                job_description=row.description or "",
                resume_text=resume_text,
                provider=payload.provider,
                model=payload.model,
                api_key=payload.api_key,
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Generation failed: {e}")

    return ApplicationPackResult(
        job_id=payload.job_id,
        job_title=row.title,
        company=row.company,
        tailored_resume=tailored,
        cover_letter=cover,
        provider_used=provider_used,
    )


@app.post("/api/ai/score-all", tags=["ai"])
async def score_all_jobs(
    provider: str = Query("anthropic", description="AI provider: anthropic|openai|nvidia|gemini"),
    api_key: Optional[str] = Query(None, description="Provider API key (BYOK)"),
    model: Optional[str] = Query(None),
    rescore: bool = Query(False, description="Re-score jobs that already have a score"),
    concurrency: int = Query(3, le=10, description="Max concurrent AI calls"),
    days: Optional[int] = Query(None, description="Only score jobs posted within this many days (e.g. 7). Omit for all jobs."),
    db: Session = Depends(get_db),
):
    """Score all jobs against the saved profile resume. Streams SSE progress events."""
    from datetime import timedelta
    from .profile import get_profile
    from .ai import analyze_job_fit

    profile = get_profile(db)
    if not profile or not profile.resume_text:
        raise HTTPException(status_code=422, detail="No profile resume saved. Upload your resume on the Profile page first.")

    q = db.query(JobRow)
    if not rescore:
        q = q.filter(JobRow.ai_score.is_(None))
    if days is not None:
        cutoff = datetime.utcnow() - timedelta(days=days)
        q = q.filter(JobRow.posted_date >= cutoff)
    rows = q.all()
    job_data = [(r.id, r.title, r.description or "") for r in rows]
    resume_text = profile.resume_text

    async def generate():
        total = len(job_data)
        scored = 0
        failed = 0

        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

        if total == 0:
            yield f"data: {json.dumps({'type': 'done', 'scored': 0, 'failed': 0, 'total': 0})}\n\n"
            return

        sem = asyncio.Semaphore(concurrency)

        async def score_one(job_id: str, job_title: str, job_description: str):
            async with sem:
                try:
                    result = await analyze_job_fit(
                        job_id=job_id,
                        job_title=job_title,
                        job_description=job_description,
                        resume_text=resume_text,
                        provider=provider,
                        model=model,
                        api_key=api_key,
                    )
                    with SessionLocal() as write_db:
                        row = write_db.get(JobRow, job_id)
                        if row:
                            row.ai_score = result.score
                            row.ai_summary = result.summary
                            row.ai_tags = json.dumps(result.extracted_requirements)
                            row.updated_at = datetime.utcnow()
                            write_db.commit()
                    return ("ok", job_id, job_title, result.score)
                except Exception as e:
                    return ("error", job_id, job_title, str(e))

        tasks = [asyncio.create_task(score_one(jid, jtitle, jdesc)) for jid, jtitle, jdesc in job_data]
        for fut in asyncio.as_completed(tasks):
            status, job_id, job_title, payload = await fut
            if status == "ok":
                scored += 1
                yield f"data: {json.dumps({'type': 'progress', 'job_id': job_id, 'title': job_title, 'score': payload, 'scored': scored, 'failed': failed, 'total': total})}\n\n"
            else:
                failed += 1
                yield f"data: {json.dumps({'type': 'error', 'job_id': job_id, 'title': job_title, 'error': payload, 'scored': scored, 'failed': failed, 'total': total})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'scored': scored, 'failed': failed, 'total': total})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@app.post("/api/ai/search", tags=["ai"])
async def ai_search(
    query: str = Query(..., description="Natural language: 'remote EPA data scientist'"),
    provider: str = Query("anthropic", description="AI provider: anthropic|openai|nvidia|gemini"),
    api_key: Optional[str] = Query(None, description="Provider API key (BYOK)"),
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
):
    """Parse a natural language query with AI, then search the job database."""
    from .ai import parse_search_query

    try:
        params = parse_search_query(query, provider=provider, api_key=api_key)
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


# ── Profile ──────────────────────────────────────────────────────────


@app.get("/api/profile", response_model=ProfileOut, tags=["profile"])
def get_profile_route(db: Session = Depends(get_db)):
    from .profile import get_profile
    row = get_profile(db)
    if not row:
        raise HTTPException(status_code=404, detail="No profile saved yet")
    return ProfileOut(
        id=row.id, name=row.name, email=row.email, phone=row.phone,
        location=row.location, linkedin_url=row.linkedin_url,
        resume_text=row.resume_text, updated_at=row.updated_at,
    )


@app.post("/api/profile", response_model=ProfileOut, tags=["profile"])
def save_profile(payload: ProfileIn, db: Session = Depends(get_db)):
    from .profile import upsert_profile
    row = upsert_profile(db, **payload.model_dump(exclude_none=True))
    return ProfileOut(
        id=row.id, name=row.name, email=row.email, phone=row.phone,
        location=row.location, linkedin_url=row.linkedin_url,
        resume_text=row.resume_text, updated_at=row.updated_at,
    )


@app.post("/api/profile/upload", response_model=ProfileOut, tags=["profile"])
async def upload_resume(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload PDF, DOCX, DOC, or TXT resume — text is extracted and stored."""
    from .profile import parse_pdf, parse_docx, upsert_profile
    data = await file.read()
    fname = (file.filename or "").lower()
    text = ""
    errors = []

    # Try by extension first, then fall back to other parsers
    if fname.endswith(".pdf"):
        try:
            text = parse_pdf(data)
        except Exception as e:
            errors.append(f"PDF parse failed: {e}")
    elif fname.endswith(".docx") or fname.endswith(".doc"):
        try:
            text = parse_docx(data)
        except Exception as e:
            errors.append(f"DOCX parse failed: {e}")
            # .doc (old Word) — try extracting raw text
            try:
                text = data.decode("utf-8", errors="ignore")
                # Strip binary noise: keep only printable ASCII lines
                import re
                lines = [l for l in text.splitlines() if re.search(r"[a-zA-Z]{3,}", l)]
                text = "\n".join(lines[:200])
            except Exception:
                pass
    else:
        # TXT, MD, or unknown — decode as UTF-8
        text = data.decode("utf-8", errors="replace")

    # If extension-based parse gave nothing, try PDF as fallback
    if not text.strip() and not fname.endswith(".pdf"):
        try:
            text = parse_pdf(data)
        except Exception:
            pass

    if not text.strip():
        detail = "Could not extract text from file."
        if errors:
            detail += " " + errors[0]
        detail += " Try saving as PDF or .docx, or paste your resume text directly."
        raise HTTPException(status_code=422, detail=detail)

    text = text.strip()

    # If text looks garbled (long runs without spaces), clean it with AI
    long_words = [w for w in text.split() if len(w) > 25 and w.isalpha()]
    if len(long_words) > 3:
        from .profile import clean_resume_with_ai
        text = await clean_resume_with_ai(text)

    row = upsert_profile(db, resume_text=text)
    return ProfileOut(
        id=row.id, name=row.name, email=row.email, phone=row.phone,
        location=row.location, linkedin_url=row.linkedin_url,
        resume_text=row.resume_text, updated_at=row.updated_at,
    )


@app.post("/api/profile/linkedin", response_model=ProfileOut, tags=["profile"])
async def import_linkedin(url: str = Query(...), db: Session = Depends(get_db)):
    """Import profile text from a public LinkedIn URL."""
    from .profile import import_linkedin as fetch_linkedin, upsert_profile
    from .ai import _pick_provider, _call_provider, PROVIDERS, _strip_json
    try:
        raw_text = await fetch_linkedin(url)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch LinkedIn: {e}")

    # Use AI to structure the scraped text into a clean resume
    try:
        provider, key = _pick_provider("nvidia", None)
        model = PROVIDERS[provider]["default_model"]
        system = "Convert the following LinkedIn profile page text into a clean, structured resume in plain text. Extract: name, contact, summary, work experience with dates and bullets, education, skills. Output plain text only."
        structured = await _call_provider(provider, model, system, raw_text, key)
    except Exception:
        structured = raw_text  # fall back to raw if AI unavailable

    row = upsert_profile(db, linkedin_url=url, resume_text=structured)
    return ProfileOut(
        id=row.id, name=row.name, email=row.email, phone=row.phone,
        location=row.location, linkedin_url=row.linkedin_url,
        resume_text=row.resume_text, updated_at=row.updated_at,
    )


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
