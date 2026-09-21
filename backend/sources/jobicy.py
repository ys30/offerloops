"""Jobicy connector — remote jobs public API, data-science and engineering categories."""
import hashlib
import re
from datetime import datetime
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType, SalaryRange

_API_URL = "https://jobicy.com/api/v2/remote-jobs"

_CATEGORIES = [
    "data-science",
    "engineering",
]


def _stable_id(job_id) -> str:
    return "jcy-" + hashlib.md5(f"jobicy-{job_id}".encode()).hexdigest()[:12]


def _parse_salary(job: dict) -> SalaryRange | None:
    lo = job.get("salaryMin")
    hi = job.get("salaryMax")
    currency = job.get("salaryCurrency") or "USD"
    period = job.get("salaryPeriod") or "annual"
    if lo or hi:
        try:
            return SalaryRange(
                min=float(lo) if lo else None,
                max=float(hi) if hi else None,
                currency=currency,
                period=period,
            )
        except Exception:
            pass
    return None


def _map_type(raw) -> JobType:
    if isinstance(raw, list):
        raw = " ".join(str(x) for x in raw)
    raw = (raw or "").lower()
    if "part" in raw:
        return JobType.part_time
    if "contract" in raw or "freelance" in raw:
        return JobType.contract
    if "intern" in raw:
        return JobType.internship
    return JobType.full_time


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "").strip()


class JobicySource:
    id = "jobicy"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        seen: set[str] = set()
        async with httpx.AsyncClient(timeout=30) as client:
            for category in _CATEGORIES:
                try:
                    resp = await client.get(_API_URL, params={"count": 100, "industry": category})
                    if not resp.is_success:
                        continue
                    data = resp.json()
                except Exception:
                    continue

                for j in data.get("jobs") or []:
                    job_id = str(j.get("id") or j.get("jobSlug") or "")
                    if not job_id or job_id in seen:
                        continue
                    seen.add(job_id)

                    now = datetime.utcnow()
                    pub = j.get("pubDate")
                    try:
                        posted = datetime.strptime(pub, "%Y-%m-%d %H:%M:%S") if pub else now
                    except Exception:
                        posted = now

                    geo = j.get("jobGeo") or "Remote"
                    remote = "worldwide" in geo.lower() or "remote" in geo.lower()
                    parts = [p.strip() for p in geo.split(",")]
                    city = parts[0] if len(parts) > 1 else None
                    state = parts[1] if len(parts) > 2 else None

                    industries = j.get("jobIndustry") or []
                    if isinstance(industries, list):
                        tags = industries[:4]
                    else:
                        tags = [str(industries)]

                    level = j.get("jobLevel") or ""
                    if level:
                        tags.append(level)

                    description = _strip_html(j.get("jobDescription") or j.get("jobExcerpt") or "")

                    yield Job(
                        id=_stable_id(job_id),
                        source=JobSource.jobicy,
                        source_id=job_id,
                        title=j.get("jobTitle") or "",
                        company=j.get("companyName") or "Unknown",
                        location=JobLocation(
                            city=city,
                            state=state,
                            country="US",
                            remote=remote or not city,
                            raw=geo,
                        ),
                        salary=_parse_salary(j),
                        description=description,
                        requirements=[],
                        tags=[t for t in tags if t][:5],
                        job_type=_map_type(j.get("jobType") or ""),
                        posted_date=posted,
                        deadline=None,
                        apply_url=j.get("url") or "",
                        created_at=now,
                        updated_at=now,
                    )
