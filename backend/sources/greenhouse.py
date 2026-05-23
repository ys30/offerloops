"""Greenhouse connector — hits the public Greenhouse Jobs API for a given company slug."""

import hashlib
from datetime import datetime
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType, SalaryRange

GREENHOUSE_API = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"


def _stable_id(slug: str, job_id) -> str:
    key = f"greenhouse-{slug}-{job_id}"
    return "gh-" + hashlib.md5(key.encode()).hexdigest()[:12]


def _parse_location(raw: str) -> JobLocation:
    remote = "remote" in raw.lower()
    parts = [p.strip() for p in raw.split(",")]
    city = parts[0] if parts else None
    state = parts[1] if len(parts) > 1 else None
    return JobLocation(city=city, state=state, remote=remote, raw=raw)


class GreenhouseSource:
    id = "greenhouse"

    async def fetch(self, company_slug: str, **kwargs) -> AsyncIterator[Job]:
        url = GREENHOUSE_API.format(slug=company_slug)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, params={"content": "true"})
            if resp.status_code == 404:
                return  # company not on Greenhouse
            resp.raise_for_status()
            data = resp.json()

        jobs = data.get("jobs", [])
        for j in jobs:
            now = datetime.utcnow()
            loc_raw = j.get("location", {}).get("name", "")
            updated_raw = j.get("updated_at")
            updated = datetime.fromisoformat(updated_raw.replace("Z", "+00:00")) if updated_raw else now

            depts = [d.get("name", "") for d in j.get("departments", [])]
            offices = j.get("offices", [])
            office_name = offices[0].get("name", "") if offices else ""

            yield Job(
                id=_stable_id(company_slug, j["id"]),
                source=JobSource.greenhouse,
                source_id=str(j["id"]),
                title=j.get("title", ""),
                company=company_slug.replace("-", " ").title(),
                location=_parse_location(loc_raw),
                salary=None,  # Greenhouse doesn't expose salary in public API
                description=j.get("content", ""),
                requirements=[],
                tags=depts,
                job_type=JobType.full_time,
                posted_date=updated,
                deadline=None,
                apply_url=j.get("absolute_url"),
                created_at=now,
                updated_at=now,
            )
