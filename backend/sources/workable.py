"""Workable connector — searches jobs.workable.com public API by keyword."""
import hashlib
import re
from datetime import datetime
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType, SalaryRange

_API_URL = "https://jobs.workable.com/api/v1/jobs"
_PAGE_SIZE = 20
_PAGES_PER_KEYWORD = 2

_KEYWORDS = [
    "environmental scientist",
    "environmental engineer",
    "water resources",
    "hydrologist",
    "geospatial",
    "remote sensing",
    "climate scientist",
    "data scientist environmental",
    "GIS analyst",
    "sustainability analyst",
    "ecologist",
    "air quality scientist",
    "environmental compliance",
    "conservation scientist",
]

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://jobs.workable.com/",
}


def _stable_id(job_id: str) -> str:
    return "wk-" + hashlib.md5(f"workable-{job_id}".encode()).hexdigest()[:12]


def _parse_location(job: dict) -> JobLocation:
    workplace = job.get("workplace", "")
    remote = workplace == "remote"
    hybrid = workplace == "hybrid"
    loc = job.get("location") or {}
    city = loc.get("city")
    state = loc.get("subregion")
    country = loc.get("countryName", "US")
    locations = job.get("locations") or []
    raw = locations[0] if locations else (city or "")
    return JobLocation(city=city, state=state, country=country, remote=remote or hybrid, raw=raw or None)


def _parse_salary(job: dict) -> SalaryRange | None:
    salary_min = job.get("salaryMin")
    salary_max = job.get("salaryMax")
    if salary_min or salary_max:
        try:
            return SalaryRange(
                min=float(salary_min) if salary_min else None,
                max=float(salary_max) if salary_max else None,
                currency=job.get("salaryCurrency", "USD"),
                period="annual",
            )
        except Exception:
            pass
    return None


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html).strip()


def _map_employment_type(raw: str) -> JobType:
    mapping = {
        "Full-time": JobType.full_time,
        "Part-time": JobType.part_time,
        "Contract": JobType.contract,
        "Internship": JobType.internship,
    }
    return mapping.get(raw, JobType.full_time)


class WorkableSource:
    id = "workable"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        seen: set[str] = set()
        async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
            for keyword in _KEYWORDS:
                token = None
                for _ in range(_PAGES_PER_KEYWORD):
                    params: dict = {"query": keyword, "limit": _PAGE_SIZE}
                    if token:
                        params["nextPageToken"] = token
                    try:
                        resp = await client.get(_API_URL, params=params)
                        if not resp.is_success:
                            break
                        data = resp.json()
                    except Exception:
                        break

                    jobs = data.get("jobs") or []
                    if not jobs:
                        break

                    for j in jobs:
                        job_id = j.get("id", "")
                        if not job_id or job_id in seen:
                            continue
                        seen.add(job_id)

                        now = datetime.utcnow()
                        created_raw = j.get("created")
                        try:
                            posted = datetime.fromisoformat(created_raw.replace("Z", "+00:00")) if created_raw else now
                        except Exception:
                            posted = now

                        company_obj = j.get("company") or {}
                        company = company_obj.get("title") or "Unknown"

                        description = _strip_html(j.get("description") or "")
                        reqs_html = j.get("requirementsSection") or ""
                        reqs_text = _strip_html(reqs_html)

                        dept = j.get("department") or ""
                        tags = [dept] if dept else []

                        yield Job(
                            id=_stable_id(job_id),
                            source=JobSource.workable,
                            source_id=job_id,
                            title=j.get("title") or "",
                            company=company,
                            location=_parse_location(j),
                            salary=_parse_salary(j),
                            description=description,
                            requirements=[reqs_text] if reqs_text else [],
                            tags=tags,
                            job_type=_map_employment_type(j.get("employmentType") or ""),
                            posted_date=posted,
                            deadline=None,
                            apply_url=j.get("url") or "",
                            created_at=now,
                            updated_at=now,
                        )

                    token = data.get("nextPageToken")
                    if not token:
                        break
