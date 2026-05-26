"""FastAPI application — open API for job search platform."""

import asyncio
import json
import os
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import or_
from sqlalchemy.orm import Session
from pathlib import Path

from fastapi import UploadFile, File
from .database import EmailEventRow, GmailTokenRow, JobRow, ProfileRow, SessionLocal, get_db, init_db
from .auth import (
    apply_new_password, consume_reset_token, create_reset_token, create_token,
    create_user, decode_token, get_user_by_email, get_user_by_id,
    send_reset_email, update_user, upsert_oauth_user, verify_password,
)
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


_auto_refresh_state: dict = {"last_run": None, "last_result": None, "running": False}
_AUTO_REFRESH_HOURS = 12


async def _auto_refresh_loop():
    """Background task: ingest fresh jobs every 12 hours."""
    await asyncio.sleep(5)  # let server finish starting up
    while True:
        _auto_refresh_state["running"] = True
        try:
            db = SessionLocal()
            from .pipeline import bulk_ingest
            result = await bulk_ingest(db)
            _auto_refresh_state["last_result"] = result
        except Exception as e:
            _auto_refresh_state["last_result"] = {"error": str(e)}
        finally:
            try:
                db.close()
            except Exception:
                pass
            _auto_refresh_state["running"] = False
            _auto_refresh_state["last_run"] = datetime.utcnow().isoformat()
        await asyncio.sleep(_AUTO_REFRESH_HOURS * 3600)


@app.on_event("startup")
def on_startup():
    init_db()


# ── Auth helpers ──────────────────────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)


def _current_user_id(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[str]:
    if not creds:
        return None
    return decode_token(creds.credentials)


def _require_user(user_id: Optional[str] = Depends(_current_user_id)) -> str:
    if not user_id:
        raise HTTPException(status_code=401, detail="Login required")
    return user_id


# ── Jobs CRUD ────────────────────────────────────────────────────────


@app.get("/api/jobs", tags=["jobs"])
def list_jobs(
    q: Optional[str] = Query(None, description="Full-text keyword search"),
    company: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    remote: Optional[bool] = Query(None),
    source: Optional[str] = Query(None),
    job_type: Optional[str] = Query(None),
    min_score: Optional[float] = Query(None, description="Minimum AI fit score"),
    tag: Optional[str] = Query(None, description="Filter by raw tag (exact name)"),
    industries: Optional[str] = Query(None, description="Comma-separated consolidated industry names"),
    sort: str = Query("date", description="Sort order: date | score"),
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
    if tag:
        query = query.filter(JobRow.tags.like(f'%"{tag}"%'))
    if industries:
        from .industries import INDUSTRY_MAP
        ind_list = [i.strip() for i in industries.split(",") if i.strip()]
        raw_tags = [t for ind in ind_list for t in INDUSTRY_MAP.get(ind, [])]
        if raw_tags:
            query = query.filter(or_(*[JobRow.tags.like(f'%"{t}"%') for t in raw_tags]))

    total = query.count()
    if sort == "score":
        rows = query.order_by(JobRow.ai_score.desc().nulls_last(), JobRow.posted_date.desc()).offset(offset).limit(limit).all()
    elif sort == "score_date":
        rows = query.order_by(JobRow.ai_score.desc().nulls_last(), JobRow.posted_date.desc()).offset(offset).limit(limit).all()
    else:
        rows = query.order_by(JobRow.posted_date.desc()).offset(offset).limit(limit).all()
    jobs = [row_to_job(r) for r in rows]
    return JSONResponse(
        content=[j.model_dump(mode="json") for j in jobs],
        headers={"X-Total-Count": str(total), "Access-Control-Expose-Headers": "X-Total-Count"},
    )


@app.get("/api/jobs/{job_id}", response_model=Job, tags=["jobs"])
def get_job(job_id: str, db: Session = Depends(get_db)):
    row = db.get(JobRow, job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return row_to_job(row)


@app.post("/api/jobs", response_model=Job, status_code=201, tags=["jobs"])
def create_job(payload: JobCreate, user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
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
    db.add(job_to_row(job, user_id=user_id))
    db.commit()
    return job


@app.patch("/api/jobs/{job_id}", response_model=Job, tags=["jobs"])
def update_job(job_id: str, payload: JobUpdate, user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    from .models import APPLICATION_STATUSES
    row = db.get(JobRow, job_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Job not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        if field in ("requirements", "tags"):
            setattr(row, field, json.dumps(value))
        elif field == "job_type":
            row.job_type = value.value if hasattr(value, "value") else value
        elif field == "status":
            if value not in APPLICATION_STATUSES:
                raise HTTPException(status_code=422, detail=f"Invalid status. Choose: {APPLICATION_STATUSES}")
            row.status = value
            if value == "applied" and not row.applied_date:
                row.applied_date = datetime.utcnow()
        else:
            setattr(row, field, value)
    row.updated_at = datetime.utcnow()
    db.commit()
    return row_to_job(row)


@app.delete("/api/jobs/{job_id}", status_code=204, tags=["jobs"])
def delete_job(job_id: str, user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    row = db.get(JobRow, job_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(row)
    db.commit()


# ── Tracker ──────────────────────────────────────────────────────────


@app.get("/api/tracker", tags=["tracker"])
def get_tracker(user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    """Return all tracked jobs (status != 'new') grouped by status."""
    from .models import APPLICATION_STATUSES
    rows = db.query(JobRow).filter(JobRow.user_id == user_id, JobRow.status != "new").order_by(JobRow.updated_at.desc()).all()
    grouped: dict = {s: [] for s in APPLICATION_STATUSES if s != "new"}
    for row in rows:
        status = row.status or "interested"
        if status in grouped:
            grouped[status].append(row_to_job(row))
    return grouped


# ── Ingestion ────────────────────────────────────────────────────────


@app.post("/api/ingest/usajobs", tags=["ingest"])
async def trigger_usajobs(
    keyword: str = Query("", description="Job title / keyword"),
    organization: str = Query("", description="Agency code e.g. EP=EPA GS=USGS"),
    location: str = Query("", description="City or state"),
    pages: int = Query(1, le=5),
    user_id: str = Depends(_require_user),
    db: Session = Depends(get_db),
):
    try:
        return await ingest_usajobs(db, keyword=keyword, organization=organization, location=location, pages=pages, user_id=user_id)
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))


@app.post("/api/ingest/greenhouse/{company_slug}", tags=["ingest"])
async def trigger_greenhouse(company_slug: str, user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    return await ingest_greenhouse(db, company_slug=company_slug, user_id=user_id)


@app.post("/api/ingest/lever/{company_slug}", tags=["ingest"])
async def trigger_lever(company_slug: str, user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    return await ingest_lever(db, company_slug=company_slug, user_id=user_id)


@app.post("/api/ingest/ashby/{company_slug}", tags=["ingest"])
async def trigger_ashby(company_slug: str, user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    from .pipeline import ingest_ashby
    return await ingest_ashby(db, company_slug=company_slug, user_id=user_id)


@app.post("/api/ingest/80k", tags=["ingest"])
async def trigger_80k(user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    from .pipeline import ingest_80k
    return await ingest_80k(db, user_id=user_id)


@app.post("/api/ingest/climatebase", tags=["ingest"])
async def trigger_climatebase(user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    from .pipeline import ingest_climatebase
    return await ingest_climatebase(db, user_id=user_id)


@app.post("/api/ingest/all", tags=["ingest"])
async def trigger_bulk(user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    """Run all configured sources from sources_config.py."""
    from .pipeline import bulk_ingest
    try:
        return await bulk_ingest(db, user_id=user_id)
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))


# ── AI endpoints ─────────────────────────────────────────────────────


@app.get("/api/ai/providers", tags=["ai"])
def get_providers():
    """List available AI providers and their configured status."""
    from .ai import available_providers
    return available_providers()


@app.post("/api/ai/analyze", tags=["ai"])
async def analyze_job(payload: AnalyzeRequest, user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    """Score a job against a resume. Supports anthropic, openai, nvidia, gemini."""
    from .ai import analyze_job_fit

    row = db.get(JobRow, payload.job_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Job not found")

    resume_text = payload.resume_text
    if not resume_text:
        from .profile import get_profile
        profile = get_profile(db, user_id)
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
    user_id: str = Depends(_require_user),
    db: Session = Depends(get_db),
):
    """One-click: generate tailored resume + cover letter for a job."""
    from .ai import tailor_resume, generate_cover_letter, _pick_provider

    row = db.get(JobRow, payload.job_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Job not found")

    resume_text = payload.resume_text
    if not resume_text:
        from .profile import get_profile
        profile = get_profile(db, user_id)
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
    concurrency: int = Query(1, le=10, description="Max concurrent AI calls"),
    days: Optional[int] = Query(None, description="Only score jobs posted within this many days (e.g. 7). Omit for all jobs."),
    us_only: bool = Query(False, description="Only score jobs located in the United States"),
    states: Optional[str] = Query(None, description="Comma-separated state codes to filter (e.g. 'CA,TX,NY'). Implies US only."),
    remote: Optional[bool] = Query(None, description="True = remote only, False = on-site only, omit = any"),
    tag: Optional[str] = Query(None, description="Only score jobs matching this raw tag"),
    industries: Optional[str] = Query(None, description="Comma-separated consolidated industry names"),
    min_score: Optional[float] = Query(None, description="Only score jobs with existing score above this threshold (for re-scoring)"),
    source: Optional[str] = Query(None, description="Only score jobs from a specific source"),
    user_id: str = Depends(_require_user),
    db: Session = Depends(get_db),
):
    """Score all jobs against the saved profile resume. Streams SSE progress events."""
    from datetime import timedelta
    from .profile import get_profile
    from .ai import analyze_job_fit

    profile = get_profile(db, user_id)
    if not profile or not profile.resume_text:
        raise HTTPException(status_code=422, detail="No profile resume saved. Upload your resume on the Profile page first.")

    q = db.query(JobRow).filter(JobRow.user_id == user_id)
    if not rescore:
        q = q.filter(JobRow.ai_score.is_(None))
    if days is not None:
        cutoff = datetime.utcnow() - timedelta(days=days)
        q = q.filter(JobRow.posted_date >= cutoff)
    if states:
        state_list = [s.strip().upper() for s in states.split(",") if s.strip()]
        q = q.filter(JobRow.location_state.in_(state_list))
    elif us_only:
        q = q.filter(or_(JobRow.location_country == "US", JobRow.location_country.is_(None)))
    if remote is not None:
        q = q.filter(JobRow.location_remote == remote)
    if tag:
        q = q.filter(JobRow.tags.like(f'%"{tag}"%'))
    if industries:
        from .industries import INDUSTRY_MAP
        ind_list = [i.strip() for i in industries.split(",") if i.strip()]
        raw_tags = [t for ind in ind_list for t in INDUSTRY_MAP.get(ind, [])]
        if raw_tags:
            q = q.filter(or_(*[JobRow.tags.like(f'%"{t}"%') for t in raw_tags]))
    if source:
        q = q.filter(JobRow.source == source)
    if min_score is not None:
        q = q.filter(JobRow.ai_score >= min_score)
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
def get_profile_route(user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    from .profile import get_profile
    row = get_profile(db, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="No profile saved yet")
    return ProfileOut(
        id=row.id, name=row.name, email=row.email, phone=row.phone,
        location=row.location, linkedin_url=row.linkedin_url,
        resume_text=row.resume_text, updated_at=row.updated_at,
    )


@app.post("/api/profile", response_model=ProfileOut, tags=["profile"])
def save_profile(payload: ProfileIn, user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
    from .profile import upsert_profile
    row = upsert_profile(db, user_id=user_id, **payload.model_dump(exclude_none=True))
    return ProfileOut(
        id=row.id, name=row.name, email=row.email, phone=row.phone,
        location=row.location, linkedin_url=row.linkedin_url,
        resume_text=row.resume_text, updated_at=row.updated_at,
    )


@app.post("/api/profile/upload", response_model=ProfileOut, tags=["profile"])
async def upload_resume(file: UploadFile = File(...), user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
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

    row = upsert_profile(db, user_id=user_id, resume_text=text)
    return ProfileOut(
        id=row.id, name=row.name, email=row.email, phone=row.phone,
        location=row.location, linkedin_url=row.linkedin_url,
        resume_text=row.resume_text, updated_at=row.updated_at,
    )


@app.post("/api/profile/linkedin", response_model=ProfileOut, tags=["profile"])
async def import_linkedin(url: str = Query(...), user_id: str = Depends(_require_user), db: Session = Depends(get_db)):
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

    row = upsert_profile(db, user_id=user_id, linkedin_url=url, resume_text=structured)
    return ProfileOut(
        id=row.id, name=row.name, email=row.email, phone=row.phone,
        location=row.location, linkedin_url=row.linkedin_url,
        resume_text=row.resume_text, updated_at=row.updated_at,
    )


# ── Auth ─────────────────────────────────────────────────────────────


class SignupRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None


class AuthResponse(BaseModel):
    token: str
    user: UserOut


@app.post("/api/auth/signup", response_model=AuthResponse, tags=["auth"])
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    if get_user_by_email(db, payload.email):
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")
    user = create_user(
        db,
        email=payload.email,
        password=payload.password,
        name=payload.name or "",
        phone=payload.phone or "",
        location=payload.location or "",
    )
    token = create_token(user.id)
    return AuthResponse(token=token, user=UserOut(id=user.id, email=user.email, name=user.name, phone=user.phone, location=user.location))


@app.post("/api/auth/login", response_model=AuthResponse, tags=["auth"])
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = get_user_by_email(db, payload.email)
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    token = create_token(user.id)
    return AuthResponse(token=token, user=UserOut(id=user.id, email=user.email, name=user.name, phone=user.phone, location=user.location))


@app.get("/api/auth/me", response_model=UserOut, tags=["auth"])
def me(user_id: Optional[str] = Depends(_current_user_id), db: Session = Depends(get_db)):
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")
    return UserOut(id=user.id, email=user.email, name=user.name, phone=user.phone, location=user.location)


@app.patch("/api/auth/me", response_model=UserOut, tags=["auth"])
def update_me(
    payload: SignupRequest,
    user_id: Optional[str] = Depends(_current_user_id),
    db: Session = Depends(get_db),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")
    user = update_user(db, user, name=payload.name, phone=payload.phone, location=payload.location)
    return UserOut(id=user.id, email=user.email, name=user.name, phone=user.phone, location=user.location)


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


@app.post("/api/auth/forgot-password", tags=["auth"])
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = get_user_by_email(db, payload.email)
    # Always return 200 — don't reveal whether email exists
    if not user:
        return {"detail": "If that email is registered, a reset link has been sent."}
    token = create_reset_token(db, user)
    reset_url = f"{_REDIRECT_BASE}/?reset_token={token}"
    try:
        sent = send_reset_email(user.email, reset_url)
        msg = "Reset email sent." if sent else "Reset link printed to server console (SMTP not configured)."
    except Exception as e:
        print(f"[OfferLoops] SMTP error: {e}\nReset link: {reset_url}")
        msg = "Reset link printed to server console."
    return {"detail": msg}


@app.post("/api/auth/reset-password", response_model=AuthResponse, tags=["auth"])
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")
    user = consume_reset_token(db, payload.token)
    if not user:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired.")
    apply_new_password(db, user, payload.password)
    token = create_token(user.id)
    return AuthResponse(token=token, user=UserOut(id=user.id, email=user.email, name=user.name, phone=user.phone, location=user.location))


@app.get("/api/auth/providers", tags=["auth"])
def auth_providers():
    """Return which OAuth providers are configured."""
    return {
        "google":    bool(os.environ.get("GOOGLE_CLIENT_ID")),
        "github":    bool(os.environ.get("GITHUB_CLIENT_ID")),
        "linkedin":  bool(os.environ.get("LINKEDIN_CLIENT_ID")),
        "microsoft": bool(os.environ.get("MICROSOFT_CLIENT_ID")),
    }


class GoogleTokenRequest(BaseModel):
    credential: str  # Google ID token from GSI


@app.post("/api/auth/google", response_model=AuthResponse, tags=["auth"])
async def google_auth(payload: GoogleTokenRequest, db: Session = Depends(get_db)):
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=501, detail="Google Sign-In is not configured on this server.")
    import httpx
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": payload.credential},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google credential.")
    info = r.json()
    if info.get("aud") != client_id:
        raise HTTPException(status_code=401, detail="Google credential audience mismatch.")
    email = info.get("email", "")
    if not email:
        raise HTTPException(status_code=422, detail="Google account has no email.")
    user = upsert_oauth_user(
        db,
        email=email,
        provider="google",
        sub=info.get("sub", ""),
        name=info.get("name", ""),
        avatar_url=info.get("picture", ""),
    )
    token = create_token(user.id)
    return AuthResponse(token=token, user=UserOut(id=user.id, email=user.email, name=user.name, phone=user.phone, location=user.location))


@app.get("/api/auth/github", tags=["auth"])
def github_auth_start():
    """Redirect browser to GitHub OAuth consent page."""
    client_id = os.environ.get("GITHUB_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=501, detail="GitHub Sign-In is not configured on this server.")
    from fastapi.responses import RedirectResponse
    params = f"client_id={client_id}&scope=user:email&allow_signup=true"
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{params}")


@app.get("/api/auth/github/callback", tags=["auth"])
async def github_callback(code: str, db: Session = Depends(get_db)):
    client_id = os.environ.get("GITHUB_CLIENT_ID")
    client_secret = os.environ.get("GITHUB_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=501, detail="GitHub Sign-In is not configured.")
    import httpx
    from fastapi.responses import RedirectResponse
    async with httpx.AsyncClient() as client:
        token_r = await client.post(
            "https://github.com/login/oauth/access_token",
            json={"client_id": client_id, "client_secret": client_secret, "code": code},
            headers={"Accept": "application/json"},
        )
        token_data = token_r.json()
        access_token = token_data.get("access_token", "")
        if not access_token:
            return RedirectResponse(f"{_REDIRECT_BASE}/?auth_error=github_failed")

        user_r = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        gh_user = user_r.json()

        email = gh_user.get("email") or ""
        if not email:
            emails_r = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            primary = next((e["email"] for e in emails_r.json() if e.get("primary")), "")
            email = primary

    if not email:
        return RedirectResponse(f"{_REDIRECT_BASE}/?auth_error=no_email")

    user = upsert_oauth_user(
        db,
        email=email,
        provider="github",
        sub=str(gh_user.get("id", "")),
        name=gh_user.get("name") or gh_user.get("login", ""),
        avatar_url=gh_user.get("avatar_url", ""),
    )
    token = create_token(user.id)
    return RedirectResponse(f"http://localhost:5173/?token={token}")


_REDIRECT_BASE = os.environ.get("APP_BASE_URL", "http://localhost:5173")
_API_BASE = os.environ.get("API_BASE_URL", "http://localhost:8000")


@app.get("/api/auth/linkedin", tags=["auth"])
def linkedin_auth_start():
    client_id = os.environ.get("LINKEDIN_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=501, detail="LinkedIn Sign-In is not configured.")
    from fastapi.responses import RedirectResponse
    from urllib.parse import urlencode
    params = urlencode({
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": f"{_API_BASE}/api/auth/linkedin/callback",
        "scope": "openid profile email",
    })
    return RedirectResponse(f"https://www.linkedin.com/oauth/v2/authorization?{params}")


@app.get("/api/auth/linkedin/callback", tags=["auth"])
async def linkedin_callback(code: str, db: Session = Depends(get_db)):
    client_id = os.environ.get("LINKEDIN_CLIENT_ID")
    client_secret = os.environ.get("LINKEDIN_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=501, detail="LinkedIn Sign-In is not configured.")
    import httpx
    from fastapi.responses import RedirectResponse
    async with httpx.AsyncClient() as client:
        token_r = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": f"{_API_BASE}/api/auth/linkedin/callback",
                "client_id": client_id,
                "client_secret": client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        token_data = token_r.json()
        access_token = token_data.get("access_token", "")
        if not access_token:
            return RedirectResponse(f"{_REDIRECT_BASE}/?auth_error=linkedin_failed")

        # LinkedIn OpenID Connect userinfo endpoint
        info_r = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        info = info_r.json()

    email = info.get("email", "")
    if not email:
        return RedirectResponse(f"{_REDIRECT_BASE}/?auth_error=no_email")

    name = f"{info.get('given_name', '')} {info.get('family_name', '')}".strip()
    user = upsert_oauth_user(
        db,
        email=email,
        provider="linkedin",
        sub=info.get("sub", ""),
        name=name,
        avatar_url=info.get("picture", ""),
    )
    token = create_token(user.id)
    return RedirectResponse(f"{_REDIRECT_BASE}/?token={token}")


@app.get("/api/auth/microsoft", tags=["auth"])
def microsoft_auth_start():
    client_id = os.environ.get("MICROSOFT_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=501, detail="Microsoft Sign-In is not configured.")
    from fastapi.responses import RedirectResponse
    from urllib.parse import urlencode
    params = urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": f"{_API_BASE}/api/auth/microsoft/callback",
        "response_mode": "query",
        "scope": "openid profile email User.Read",
    })
    return RedirectResponse(f"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?{params}")


@app.get("/api/auth/microsoft/callback", tags=["auth"])
async def microsoft_callback(code: str, db: Session = Depends(get_db)):
    client_id = os.environ.get("MICROSOFT_CLIENT_ID")
    client_secret = os.environ.get("MICROSOFT_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=501, detail="Microsoft Sign-In is not configured.")
    import httpx
    from fastapi.responses import RedirectResponse
    async with httpx.AsyncClient() as client:
        token_r = await client.post(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": f"{_API_BASE}/api/auth/microsoft/callback",
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        token_data = token_r.json()
        access_token = token_data.get("access_token", "")
        if not access_token:
            return RedirectResponse(f"{_REDIRECT_BASE}/?auth_error=microsoft_failed")

        me_r = await client.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        ms_user = me_r.json()

    email = ms_user.get("mail") or ms_user.get("userPrincipalName", "")
    if not email or "@" not in email:
        return RedirectResponse(f"{_REDIRECT_BASE}/?auth_error=no_email")

    name = ms_user.get("displayName", "")
    user = upsert_oauth_user(
        db,
        email=email,
        provider="microsoft",
        sub=ms_user.get("id", ""),
        name=name,
    )
    token = create_token(user.id)
    return RedirectResponse(f"{_REDIRECT_BASE}/?token={token}")


# ── Dashboard ────────────────────────────────────────────────────────


def _reply_template(status: Optional[str], company: str) -> Optional[str]:
    c = company or "the company"
    templates = {
        "phone_screen": f"Hi [Recruiter Name],\n\nThank you for reaching out — I'd love to learn more about the opportunity at {c}.\n\nPlease feel free to share some available times and I'll confirm what works best.\n\nLooking forward to speaking with you.\n\nBest,\n[Your Name]",
        "interview":    f"Hi [Recruiter Name],\n\nThank you for the update — I'm excited about the opportunity to meet the team at {c}.\n\nThe proposed time works well for me. Please send any prep materials or format details when convenient.\n\nLooking forward to it.\n\nBest,\n[Your Name]",
        "offer":        f"Hi [Recruiter Name],\n\nThank you so much for the offer — I'm genuinely excited about joining {c}.\n\nI'd like a few days to review the details carefully. Could you share the complete offer package so I can give it full consideration?\n\nI'll follow up shortly.\n\nBest,\n[Your Name]",
        "rejected":     f"Hi [Recruiter Name],\n\nThank you for letting me know, and for your time and consideration throughout the process.\n\nI have a lot of respect for the work at {c} and would welcome the chance to stay in touch for future opportunities.\n\nBest,\n[Your Name]",
    }
    return templates.get(status or "")


@app.get("/api/dashboard", tags=["meta"])
def dashboard(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False)),
    db: Session = Depends(get_db),
):
    from datetime import timedelta

    user_id = decode_token(credentials.credentials) if credentials else None

    # ── Funnel ──────────────────────────────────────────────────────
    tracked = db.query(JobRow).filter(JobRow.status != "new").all()
    sc: dict[str, int] = {}
    for j in tracked:
        sc[j.status] = sc.get(j.status, 0) + 1

    n_applied   = sum(sc.get(s, 0) for s in ["applied","phone_screen","interview","offer","rejected","withdrawn"])
    n_responded = sum(sc.get(s, 0) for s in ["phone_screen","interview","offer"])
    n_interview = sum(sc.get(s, 0) for s in ["interview","offer"])
    n_offer     = sc.get("offer", 0)

    response_rate  = round(n_responded / n_applied * 100, 1) if n_applied else 0
    interview_rate = round(n_interview / n_applied * 100, 1) if n_applied else 0
    offer_rate     = round(n_offer     / n_applied * 100, 1) if n_applied else 0

    # ── Weekly trend (last 8 weeks) ──────────────────────────────────
    now = datetime.utcnow()
    weekly = []
    for i in range(7, -1, -1):
        ws = now - timedelta(weeks=i + 1)
        we = now - timedelta(weeks=i)
        cnt = sum(1 for j in tracked if j.applied_date and ws <= j.applied_date < we)
        weekly.append({"week": ws.strftime("%b %d"), "count": cnt})

    # ── Salary insights ──────────────────────────────────────────────
    salary_jobs = [j for j in tracked if j.salary_min or j.salary_max]
    avg_min = round(sum(j.salary_min for j in salary_jobs if j.salary_min) / len(salary_jobs), 0) if salary_jobs else None
    avg_max = round(sum(j.salary_max for j in salary_jobs if j.salary_max) / len(salary_jobs), 0) if salary_jobs else None

    # ── Per-user data (email events) ─────────────────────────────────
    activity: list[dict] = []
    reply_templates: list[dict] = []
    avg_response_days: Optional[float] = None
    ghost_count = 0

    if user_id:
        events = (
            db.query(EmailEventRow)
            .filter(EmailEventRow.user_id == user_id)
            .order_by(EmailEventRow.email_date.desc())
            .limit(40)
            .all()
        )
        job_map = {j.id: j for j in db.query(JobRow).all()}

        for ev in events:
            job = job_map.get(ev.job_id or "")
            activity.append({
                "date":    ev.email_date.isoformat() if ev.email_date else None,
                "status":  ev.detected_status,
                "company": ev.company_guess or (job.company if job else None),
                "subject": ev.subject,
                "job_id":  ev.job_id,
                "event_id": ev.id,
            })
            tmpl = _reply_template(ev.detected_status, ev.company_guess or (job.company if job else ""))
            if tmpl:
                reply_templates.append({
                    "event_id": ev.id,
                    "job_id":   ev.job_id,
                    "company":  ev.company_guess or (job.company if job else None),
                    "subject":  ev.subject,
                    "status":   ev.detected_status,
                    "template": tmpl,
                })

        # Average response time
        resp_events = [e for e in events if e.detected_status in ("phone_screen","interview","offer") and e.job_id]
        times = []
        for ev in resp_events:
            job = job_map.get(ev.job_id or "")
            if job and job.applied_date and ev.email_date:
                d = (ev.email_date - job.applied_date).days
                if 0 <= d <= 90:
                    times.append(d)
        if times:
            avg_response_days = round(sum(times) / len(times), 1)

        # Ghost detection: applied > 30 days with no email response
        cutoff = now - timedelta(days=30)
        responded_ids = {e.job_id for e in events if e.detected_status in ("phone_screen","interview","offer","rejected")}
        ghost_count = sum(
            1 for j in tracked
            if j.status == "applied"
            and j.applied_date
            and j.applied_date < cutoff
            and j.id not in responded_ids
        )

    return {
        "funnel": {
            "interested": sc.get("interested", 0),
            "applied":    n_applied,
            "responded":  n_responded,
            "interview":  n_interview,
            "offer":      n_offer,
            "rejected":   sc.get("rejected", 0),
        },
        "response_rate":   response_rate,
        "interview_rate":  interview_rate,
        "offer_rate":      offer_rate,
        "avg_response_days": avg_response_days,
        "ghost_count":     ghost_count,
        "weekly_trend":    weekly,
        "activity_feed":   activity[:20],
        "reply_templates": reply_templates[:8],
        "salary": {"avg_min": avg_min, "avg_max": avg_max, "sample_size": len(salary_jobs)},
    }


# ── Gmail integration ────────────────────────────────────────────────


_GMAIL_REDIRECT = f"{_API_BASE}/api/gmail/callback"


@app.get("/api/gmail/status", tags=["gmail"])
def gmail_status(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False)),
    db: Session = Depends(get_db),
):
    """Return whether Gmail is connected for the current user."""
    user_id = decode_token(credentials.credentials) if credentials else None
    if not user_id:
        return {"connected": False, "last_synced_at": None}
    row = db.query(GmailTokenRow).filter(GmailTokenRow.user_id == user_id).first()
    return {
        "connected": bool(row and row.refresh_token),
        "last_synced_at": row.last_synced_at.isoformat() if row and row.last_synced_at else None,
    }


@app.get("/api/gmail/auth", tags=["gmail"])
def gmail_auth_redirect(token: str = Query(...)):
    """Redirect user to Google OAuth with their JWT stashed in state."""
    from fastapi.responses import RedirectResponse
    from .gmail import build_auth_url
    import urllib.parse
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(status_code=501, detail="GOOGLE_CLIENT_ID not configured")
    url = build_auth_url(client_id, _GMAIL_REDIRECT)
    url += f"&state={urllib.parse.quote(token)}"
    return RedirectResponse(url)


@app.get("/api/gmail/callback", tags=["gmail"])
async def gmail_callback(
    code: str = Query(...),
    state: str = Query(""),
    error: str = Query(""),
    db: Session = Depends(get_db),
):
    from fastapi.responses import RedirectResponse
    from .gmail import exchange_code
    if error:
        return RedirectResponse(f"{_REDIRECT_BASE}/?gmail_error={error}")
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return RedirectResponse(f"{_REDIRECT_BASE}/?gmail_error=not_configured")
    try:
        tokens = await exchange_code(code, client_id, client_secret, _GMAIL_REDIRECT)
    except Exception as e:
        return RedirectResponse(f"{_REDIRECT_BASE}/?gmail_error=token_exchange_failed")

    # Identify user from state (their JWT)
    user_id = decode_token(state) if state else None
    if not user_id:
        return RedirectResponse(f"{_REDIRECT_BASE}/?gmail_error=not_authenticated")

    expires_at = datetime.utcnow() + __import__("datetime").timedelta(seconds=tokens.get("expires_in", 3600))
    row = db.query(GmailTokenRow).filter(GmailTokenRow.user_id == user_id).first()
    if row:
        row.access_token = tokens["access_token"]
        if "refresh_token" in tokens:
            row.refresh_token = tokens["refresh_token"]
        row.expires_at = expires_at
    else:
        row = GmailTokenRow(
            user_id=user_id,
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            expires_at=expires_at,
        )
        db.add(row)
    db.commit()
    return RedirectResponse(f"{_REDIRECT_BASE}/?gmail_connected=1")


@app.delete("/api/gmail/disconnect", tags=["gmail"])
def gmail_disconnect(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    db: Session = Depends(get_db),
):
    user_id = decode_token(credentials.credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    db.query(GmailTokenRow).filter(GmailTokenRow.user_id == user_id).delete()
    db.commit()
    return {"detail": "Gmail disconnected"}


@app.post("/api/gmail/sync", tags=["gmail"])
async def gmail_sync(
    days_back: int = Query(60, ge=1, le=365),
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    db: Session = Depends(get_db),
):
    """Sync recent emails and auto-update job statuses."""
    user_id = decode_token(credentials.credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    from .gmail import sync_emails
    result = await sync_emails(db, user_id, days_back=days_back)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    # Update last_synced_at
    row = db.query(GmailTokenRow).filter(GmailTokenRow.user_id == user_id).first()
    if row:
        row.last_synced_at = datetime.utcnow()
        db.commit()
    return result


@app.get("/api/gmail/events", tags=["gmail"])
def gmail_events(
    job_id: Optional[str] = None,
    limit: int = Query(50, le=200),
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    db: Session = Depends(get_db),
):
    """Return parsed email events, optionally filtered by job."""
    user_id = decode_token(credentials.credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    q = db.query(EmailEventRow).filter(EmailEventRow.user_id == user_id)
    if job_id:
        q = q.filter(EmailEventRow.job_id == job_id)
    events = q.order_by(EmailEventRow.email_date.desc()).limit(limit).all()
    return [
        {
            "id": e.id,
            "job_id": e.job_id,
            "sender": e.sender,
            "subject": e.subject,
            "snippet": e.snippet,
            "detected_status": e.detected_status,
            "company_guess": e.company_guess,
            "role_guess": e.role_guess,
            "email_date": e.email_date.isoformat() if e.email_date else None,
        }
        for e in events
    ]


# ── Stats ────────────────────────────────────────────────────────────


@app.get("/api/tags", tags=["meta"])
def list_tags(db: Session = Depends(get_db)):
    """Return all raw tags with job counts, sorted by frequency."""
    import json as _json
    rows = db.query(JobRow.tags).filter(JobRow.tags.isnot(None), JobRow.tags != "[]").all()
    counts: dict[str, int] = {}
    SKIP = {"Full time role", "Full-time", "Internship", "Contract", "Part time role", "Part-time", "Freelance"}
    for (raw,) in rows:
        try:
            tags = _json.loads(raw)
        except Exception:
            continue
        for t in tags:
            if t and t not in SKIP:
                counts[t] = counts.get(t, 0) + 1
    return [{"tag": t, "count": c} for t, c in sorted(counts.items(), key=lambda x: -x[1])]


@app.get("/api/industries", tags=["meta"])
def list_industries(db: Session = Depends(get_db)):
    """Return consolidated industry categories with job counts."""
    import json as _json
    from .industries import INDUSTRY_MAP
    rows = db.query(JobRow.tags, JobRow.posted_date).filter(JobRow.tags.isnot(None), JobRow.tags != "[]").all()
    counts: dict[str, int] = {k: 0 for k in INDUSTRY_MAP}
    cutoff_24h = datetime.utcnow() - __import__("datetime").timedelta(hours=24)
    cutoff_7d  = datetime.utcnow() - __import__("datetime").timedelta(days=7)
    counts_24h: dict[str, int] = {k: 0 for k in INDUSTRY_MAP}
    counts_7d:  dict[str, int] = {k: 0 for k in INDUSTRY_MAP}
    from .industries import TAG_TO_INDUSTRY
    for raw, pd in rows:
        try:
            tags = _json.loads(raw)
        except Exception:
            continue
        seen: set[str] = set()
        for t in tags:
            ind = TAG_TO_INDUSTRY.get(t)
            if ind and ind not in seen:
                seen.add(ind)
                counts[ind] += 1
                if pd and pd >= cutoff_24h:
                    counts_24h[ind] += 1
                if pd and pd >= cutoff_7d:
                    counts_7d[ind] += 1
    return [
        {"industry": k, "total": counts[k], "last_24h": counts_24h[k], "last_7d": counts_7d[k]}
        for k in INDUSTRY_MAP if counts[k] > 0
    ]


@app.get("/api/market", tags=["meta"])
def market_intel(db: Session = Depends(get_db)):
    """Job market intelligence: activity by time window, trending locations, salary data."""
    from sqlalchemy import func
    from datetime import timedelta

    now = datetime.utcnow()
    windows = {"24h": 1, "3d": 3, "7d": 7, "30d": 30}

    # --- Activity by time window ---
    activity = {}
    for label, days in windows.items():
        cutoff = now - timedelta(days=days)
        total = db.query(func.count(JobRow.id)).filter(JobRow.posted_date >= cutoff).scalar() or 0

        by_state = (
            db.query(JobRow.location_state, func.count(JobRow.id))
            .filter(JobRow.posted_date >= cutoff, JobRow.location_state.isnot(None))
            .group_by(JobRow.location_state)
            .order_by(func.count(JobRow.id).desc())
            .limit(10)
            .all()
        )
        by_source = (
            db.query(JobRow.source, func.count(JobRow.id))
            .filter(JobRow.posted_date >= cutoff)
            .group_by(JobRow.source)
            .order_by(func.count(JobRow.id).desc())
            .all()
        )
        activity[label] = {
            "total": total,
            "by_state": [{"state": s, "count": c} for s, c in by_state],
            "by_source": {s: c for s, c in by_source},
        }

    # --- Trend: compare 24h vs prior 24h per state ---
    cutoff_24h = now - timedelta(hours=24)
    cutoff_48h = now - timedelta(hours=48)
    curr_24h = dict(
        db.query(JobRow.location_state, func.count(JobRow.id))
        .filter(JobRow.posted_date >= cutoff_24h, JobRow.location_state.isnot(None))
        .group_by(JobRow.location_state).all()
    )
    prev_24h = dict(
        db.query(JobRow.location_state, func.count(JobRow.id))
        .filter(JobRow.posted_date >= cutoff_48h, JobRow.posted_date < cutoff_24h, JobRow.location_state.isnot(None))
        .group_by(JobRow.location_state).all()
    )
    trending = []
    all_states = set(curr_24h) | set(prev_24h)
    for state in all_states:
        curr = curr_24h.get(state, 0)
        prev = prev_24h.get(state, 0)
        delta = curr - prev
        pct = round((delta / prev * 100) if prev > 0 else (100.0 if curr > 0 else 0.0), 1)
        trending.append({"state": state, "current_24h": curr, "prev_24h": prev, "delta": delta, "pct_change": pct})
    trending.sort(key=lambda x: x["delta"], reverse=True)

    # --- Salary ---
    salary_rows = (
        db.query(JobRow.location_state, func.avg(JobRow.salary_min), func.avg(JobRow.salary_max), func.count(JobRow.id))
        .filter(JobRow.salary_min.isnot(None))
        .group_by(JobRow.location_state)
        .order_by(func.avg(JobRow.salary_min).desc())
        .limit(15)
        .all()
    )
    overall_min = db.query(func.avg(JobRow.salary_min)).filter(JobRow.salary_min.isnot(None)).scalar()
    overall_max = db.query(func.avg(JobRow.salary_max)).filter(JobRow.salary_max.isnot(None)).scalar()
    salary_by_source = (
        db.query(JobRow.source, func.avg(JobRow.salary_min), func.avg(JobRow.salary_max), func.count(JobRow.id))
        .filter(JobRow.salary_min.isnot(None))
        .group_by(JobRow.source)
        .order_by(func.avg(JobRow.salary_min).desc())
        .all()
    )

    # --- Summary ---
    total_all = db.query(func.count(JobRow.id)).scalar() or 1
    remote_count = db.query(func.count(JobRow.id)).filter(JobRow.location_remote == True).scalar() or 0
    top_companies = (
        db.query(JobRow.company, func.count(JobRow.id))
        .group_by(JobRow.company)
        .order_by(func.count(JobRow.id).desc())
        .limit(10)
        .all()
    )
    score_dist = {
        "excellent": db.query(func.count(JobRow.id)).filter(JobRow.ai_score >= 4.0).scalar() or 0,
        "good":      db.query(func.count(JobRow.id)).filter(JobRow.ai_score >= 3.0, JobRow.ai_score < 4.0).scalar() or 0,
        "low":       db.query(func.count(JobRow.id)).filter(JobRow.ai_score < 3.0, JobRow.ai_score.isnot(None)).scalar() or 0,
        "unscored":  db.query(func.count(JobRow.id)).filter(JobRow.ai_score.is_(None)).scalar() or 0,
    }
    by_type = dict(
        db.query(JobRow.job_type, func.count(JobRow.id))
        .group_by(JobRow.job_type)
        .order_by(func.count(JobRow.id).desc())
        .all()
    )

    # --- Industry breakdown (consolidated categories) ---
    import json as _json
    from .industries import INDUSTRY_MAP, TAG_TO_INDUSTRY
    cutoff_24h_ind = now - timedelta(hours=24)
    cutoff_7d_ind  = now - timedelta(days=7)
    ind_total: dict[str, int] = {k: 0 for k in INDUSTRY_MAP}
    ind_24h:   dict[str, int] = {k: 0 for k in INDUSTRY_MAP}
    ind_7d:    dict[str, int] = {k: 0 for k in INDUSTRY_MAP}
    all_tag_rows = db.query(JobRow.tags, JobRow.posted_date).filter(JobRow.tags.isnot(None), JobRow.tags != "[]").all()
    for raw, pd in all_tag_rows:
        try:
            tags = _json.loads(raw)
        except Exception:
            continue
        seen: set[str] = set()
        for t in tags:
            cat = TAG_TO_INDUSTRY.get(t)
            if cat and cat not in seen:
                seen.add(cat)
                ind_total[cat] += 1
                if pd and pd >= cutoff_24h_ind:
                    ind_24h[cat] += 1
                if pd and pd >= cutoff_7d_ind:
                    ind_7d[cat] += 1
    industry = [
        {"industry": k, "total": ind_total[k], "last_24h": ind_24h[k], "last_7d": ind_7d[k]}
        for k in INDUSTRY_MAP
        if ind_total[k] > 0
    ]
    industry.sort(key=lambda x: -x["total"])

    return {
        "activity": activity,
        "trending": trending[:20],
        "industry": industry,
        "salary": {
            "overall_avg_min": round(overall_min, 0) if overall_min else None,
            "overall_avg_max": round(overall_max, 0) if overall_max else None,
            "by_state": [
                {"state": s or "Unknown", "avg_min": round(mn, 0), "avg_max": round(mx, 0) if mx else None, "count": c}
                for s, mn, mx, c in salary_rows if mn is not None
            ],
            "by_source": [
                {"source": s, "avg_min": round(mn, 0), "avg_max": round(mx, 0) if mx else None, "count": c}
                for s, mn, mx, c in salary_by_source if mn is not None
            ],
        },
        "summary": {
            "total_jobs": total_all,
            "remote_pct": round(remote_count / total_all * 100, 1),
            "top_companies": [{"company": co, "count": c} for co, c in top_companies],
            "score_distribution": score_dist,
            "by_job_type": by_type,
        },
    }


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


@app.post("/api/refresh", tags=["meta"])
async def manual_refresh(db: Session = Depends(get_db)):
    """Trigger an immediate job refresh (same as the 12-hour auto-refresh)."""
    if _auto_refresh_state["running"]:
        return {"detail": "Refresh already in progress"}
    _auto_refresh_state["running"] = True
    try:
        from .pipeline import bulk_ingest
        result = await bulk_ingest(db)
        _auto_refresh_state["last_result"] = result
        _auto_refresh_state["last_run"] = datetime.utcnow().isoformat()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _auto_refresh_state["running"] = False


# ── Serve frontend ───────────────────────────────────────────────────

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        index = FRONTEND_DIST / "index.html"
        return FileResponse(index)
