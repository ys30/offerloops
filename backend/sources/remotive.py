"""Remotive connector — remote jobs public API, data and AI categories."""
import hashlib
import re
from datetime import datetime
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType

_API_URL = "https://remotive.com/api/remote-jobs"

_CATEGORIES = [
    "data",
    "software-dev",
]

_SKIP_TITLE = frozenset([
    "react", "angular", "vue", "frontend", "front-end", "front end",
    "ios developer", "android developer", "mobile developer", "flutter developer",
    ".net developer", "ruby developer", "rails engineer", "php developer",
    "wordpress developer", "laravel developer",
    "devops engineer", "sre ", "site reliability engineer",
    "copywriter", "content writer", "technical writer",
    "sales representative", "account executive", "customer success",
    "ux designer", "ui designer", "graphic designer",
    "qa engineer", "quality assurance engineer", "test engineer",
    "recruiter", "hr ", "human resources",
    "product manager", "project manager",
])


def _stable_id(job_id) -> str:
    return "rmtv-" + hashlib.md5(f"remotive-{job_id}".encode()).hexdigest()[:12]


def _map_type(raw: str) -> JobType:
    raw = (raw or "").lower()
    if "part" in raw:
        return JobType.part_time
    if "contract" in raw or "freelance" in raw:
        return JobType.contract
    return JobType.full_time


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "").strip()


class RemotiveSource:
    id = "remotive"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        seen: set[str] = set()
        async with httpx.AsyncClient(timeout=30) as client:
            for category in _CATEGORIES:
                try:
                    resp = await client.get(_API_URL, params={"category": category})
                    if not resp.is_success:
                        continue
                    data = resp.json()
                except Exception:
                    continue

                for j in data.get("jobs") or []:
                    job_id = str(j.get("id") or "")
                    if not job_id or job_id in seen:
                        continue

                    # Skip clearly non-data-science roles
                    _title_lower = (j.get("title") or "").lower()
                    if any(pat in _title_lower for pat in _SKIP_TITLE):
                        continue

                    seen.add(job_id)

                    now = datetime.utcnow()
                    pub = j.get("publication_date")
                    try:
                        posted = datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else now
                    except Exception:
                        posted = now

                    candidate_location = j.get("candidate_required_location") or "Remote"
                    tags = [str(t) for t in (j.get("tags") or []) if t][:5]
                    description = _strip_html(j.get("description") or "")

                    yield Job(
                        id=_stable_id(job_id),
                        source=JobSource.remotive,
                        source_id=job_id,
                        title=j.get("title") or "",
                        company=j.get("company_name") or "Unknown",
                        location=JobLocation(remote=True, raw=candidate_location),
                        salary=None,
                        description=description,
                        requirements=[],
                        tags=tags,
                        job_type=_map_type(j.get("job_type") or ""),
                        posted_date=posted,
                        deadline=None,
                        apply_url=j.get("url") or "",
                        created_at=now,
                        updated_at=now,
                    )
