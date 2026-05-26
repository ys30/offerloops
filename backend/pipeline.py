"""Data ingestion pipeline — fetch from sources, normalize, upsert to DB."""

import json
from datetime import datetime

from sqlalchemy.orm import Session

from typing import Optional

from .database import JobRow
from .models import Job, JobSource
from .sources import USAJobsSource, GreenhouseSource, LeverSource, AshbySource, EightyKHoursSource, ClimatebaseSource

SOURCES = {
    "usajobs":     USAJobsSource(),
    "greenhouse":  GreenhouseSource(),
    "lever":       LeverSource(),
    "ashby":       AshbySource(),
    "80k_hours":   EightyKHoursSource(),
    "climatebase": ClimatebaseSource(),
}


def job_to_row(job: Job, user_id: Optional[str] = None) -> JobRow:
    return JobRow(
        id=job.id,
        source=job.source.value,
        source_id=job.source_id,
        title=job.title,
        company=job.company,
        location_city=job.location.city,
        location_state=job.location.state,
        location_country=job.location.country,
        location_remote=job.location.remote,
        location_raw=job.location.raw,
        salary_min=job.salary.min if job.salary else None,
        salary_max=job.salary.max if job.salary else None,
        salary_currency=job.salary.currency if job.salary else "USD",
        salary_period=job.salary.period if job.salary else "annual",
        description=job.description,
        requirements=json.dumps(job.requirements),
        tags=json.dumps(job.tags),
        job_type=job.job_type.value,
        posted_date=job.posted_date,
        deadline=job.deadline,
        apply_url=job.apply_url,
        created_at=job.created_at,
        updated_at=job.updated_at,
        ai_summary=job.ai_summary,
        ai_score=job.ai_score,
        ai_tags=json.dumps(job.ai_tags),
        user_id=user_id,
    )


def row_to_job(row: JobRow) -> Job:
    from .models import JobLocation, JobType, SalaryRange
    salary = None
    if row.salary_min or row.salary_max:
        salary = SalaryRange(
            min=row.salary_min,
            max=row.salary_max,
            currency=row.salary_currency or "USD",
            period=row.salary_period or "annual",
        )
    return Job(
        id=row.id,
        source=JobSource(row.source),
        source_id=row.source_id,
        title=row.title,
        company=row.company,
        location=JobLocation(
            city=row.location_city,
            state=row.location_state,
            country=row.location_country or "US",
            remote=row.location_remote or False,
            raw=row.location_raw,
        ),
        salary=salary,
        description=row.description or "",
        requirements=json.loads(row.requirements or "[]"),
        tags=json.loads(row.tags or "[]"),
        job_type=JobType(row.job_type or "unknown"),
        posted_date=row.posted_date,
        deadline=row.deadline,
        apply_url=row.apply_url,
        created_at=row.created_at,
        updated_at=row.updated_at,
        ai_summary=row.ai_summary,
        ai_score=row.ai_score,
        ai_tags=json.loads(row.ai_tags or "[]"),
        status=row.status or "new",
        applied_date=row.applied_date,
        notes=row.notes,
    )


async def ingest_usajobs(
    db: Session,
    keyword: str = "",
    organization: str = "",
    location: str = "",
    pages: int = 1,
    user_id: Optional[str] = None,
) -> dict:
    source = SOURCES["usajobs"]
    ingested, skipped = 0, 0
    seen: set[str] = set()
    for page in range(1, pages + 1):
        async for job in source.fetch(keyword=keyword, organization=organization, location=location, page=page):
            if job.id in seen or db.get(JobRow, job.id):
                skipped += 1
                continue
            seen.add(job.id)
            db.add(job_to_row(job, user_id=user_id))
            ingested += 1
    db.commit()
    return {"ingested": ingested, "skipped": skipped, "source": "usajobs"}


async def ingest_greenhouse(db: Session, company_slug: str, user_id: Optional[str] = None) -> dict:
    source = SOURCES["greenhouse"]
    ingested, skipped = 0, 0
    async for job in source.fetch(company_slug=company_slug):
        existing = db.get(JobRow, job.id)
        if existing:
            existing.updated_at = datetime.utcnow()
            skipped += 1
            continue
        db.add(job_to_row(job, user_id=user_id))
        ingested += 1
    db.commit()
    return {"ingested": ingested, "skipped": skipped, "source": "greenhouse", "company": company_slug}


async def ingest_lever(db: Session, company_slug: str, user_id: Optional[str] = None) -> dict:
    source = SOURCES["lever"]
    ingested, skipped = 0, 0
    async for job in source.fetch(company_slug=company_slug):
        if db.get(JobRow, job.id):
            skipped += 1
            continue
        db.add(job_to_row(job, user_id=user_id))
        ingested += 1
    db.commit()
    return {"ingested": ingested, "skipped": skipped, "source": "lever", "company": company_slug}


async def ingest_ashby(db: Session, company_slug: str, user_id: Optional[str] = None) -> dict:
    source = SOURCES["ashby"]
    ingested, skipped = 0, 0
    async for job in source.fetch(company_slug=company_slug):
        if db.get(JobRow, job.id):
            skipped += 1
            continue
        db.add(job_to_row(job, user_id=user_id))
        ingested += 1
    db.commit()
    return {"ingested": ingested, "skipped": skipped, "source": "ashby", "company": company_slug}


async def ingest_80k(db: Session, user_id: Optional[str] = None) -> dict:
    source = SOURCES["80k_hours"]
    ingested, skipped = 0, 0
    async for job in source.fetch():
        if db.get(JobRow, job.id):
            skipped += 1
            continue
        db.add(job_to_row(job, user_id=user_id))
        ingested += 1
    db.commit()
    return {"ingested": ingested, "skipped": skipped, "source": "80k_hours"}


async def ingest_climatebase(db: Session, user_id: Optional[str] = None) -> dict:
    source = SOURCES["climatebase"]
    ingested, skipped = 0, 0
    async for job in source.fetch():
        if db.get(JobRow, job.id):
            skipped += 1
            continue
        db.add(job_to_row(job, user_id=user_id))
        ingested += 1
    db.commit()
    return {"ingested": ingested, "skipped": skipped, "source": "climatebase"}


async def bulk_ingest(db: Session, user_id: Optional[str] = None) -> dict:
    """Run all configured searches from sources_config.py."""
    from .sources_config import USAJOBS_SEARCHES, GREENHOUSE_SLUGS, LEVER_SLUGS, ASHBY_SLUGS

    totals: dict[str, int] = {"ingested": 0, "skipped": 0}
    results: list[dict] = []

    for search in USAJOBS_SEARCHES:
        r = await ingest_usajobs(db, user_id=user_id, **search)
        totals["ingested"] += r["ingested"]
        totals["skipped"] += r["skipped"]
        results.append(r)

    for slug in GREENHOUSE_SLUGS:
        r = await ingest_greenhouse(db, slug, user_id=user_id)
        totals["ingested"] += r["ingested"]
        totals["skipped"] += r["skipped"]
        results.append(r)

    for slug in LEVER_SLUGS:
        r = await ingest_lever(db, slug, user_id=user_id)
        totals["ingested"] += r["ingested"]
        totals["skipped"] += r["skipped"]
        results.append(r)

    for slug in ASHBY_SLUGS:
        r = await ingest_ashby(db, slug, user_id=user_id)
        totals["ingested"] += r["ingested"]
        totals["skipped"] += r["skipped"]
        results.append(r)

    r = await ingest_80k(db, user_id=user_id)
    totals["ingested"] += r["ingested"]
    totals["skipped"] += r["skipped"]
    results.append(r)

    r = await ingest_climatebase(db, user_id=user_id)
    totals["ingested"] += r["ingested"]
    totals["skipped"] += r["skipped"]
    results.append(r)

    return {**totals, "details": results}
