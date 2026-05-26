"""Ashby ATS connector — public posting API for a given company slug."""
import hashlib
from datetime import datetime
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType

ASHBY_API = "https://api.ashbyhq.com/posting-public/job/list"


def _stable_id(slug: str, job_id: str) -> str:
    key = f"ashby-{slug}-{job_id}"
    return "ab-" + hashlib.md5(key.encode()).hexdigest()[:12]


def _parse_location(raw: str, is_remote: bool) -> JobLocation:
    remote = is_remote or "remote" in (raw or "").lower()
    parts = [p.strip() for p in (raw or "").split(",")]
    city = parts[0] if parts and parts[0] else None
    state = parts[1] if len(parts) > 1 else None
    return JobLocation(city=city, state=state, remote=remote, raw=raw or "")


class AshbySource:
    id = "ashby"

    async def fetch(self, company_slug: str, **kwargs) -> AsyncIterator[Job]:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                ASHBY_API,
                json={"organizationHostedJobsPageName": company_slug},
            )
            if resp.status_code in (401, 403, 404, 422):
                return  # slug not on Ashby
            resp.raise_for_status()
            data = resp.json()

        jobs = data.get("results", [])
        for j in jobs:
            now = datetime.utcnow()
            published = j.get("publishedDate") or j.get("updatedAt")
            try:
                posted = datetime.fromisoformat(published.replace("Z", "+00:00")) if published else now
            except Exception:
                posted = now

            loc_raw = j.get("locationName") or j.get("location") or ""
            is_remote = j.get("isRemote", False)
            dept = j.get("teamName") or j.get("team") or ""
            org_name = j.get("organizationName") or company_slug.replace("-", " ").title()
            apply_url = j.get("jobUrl") or j.get("applyUrl") or j.get("externalLink")

            yield Job(
                id=_stable_id(company_slug, str(j.get("id", j.get("title", "")))),
                source=JobSource.ashby,
                source_id=str(j.get("id", "")),
                title=j.get("title", ""),
                company=org_name,
                location=_parse_location(loc_raw, is_remote),
                salary=None,
                description=j.get("descriptionHtml") or j.get("description") or "",
                requirements=[],
                tags=[dept] if dept else [],
                job_type=JobType.full_time,
                posted_date=posted,
                deadline=None,
                apply_url=apply_url,
                created_at=now,
                updated_at=now,
            )
