"""RemoteOK connector — public API, multiple data-science / env tags."""
import hashlib
from datetime import datetime, timezone
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType, SalaryRange

_API_URL = "https://remoteok.com/api"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://remoteok.com/",
}

_TAGS = [
    "data-science",
    "machine-learning",
    "python",
    "gis",
    "environmental",
    "climate",
    "ecology",
]


def _stable_id(job_id) -> str:
    return "rok-" + hashlib.md5(f"remoteok-{job_id}".encode()).hexdigest()[:12]


def _parse_salary(job: dict) -> SalaryRange | None:
    lo = job.get("salary_min")
    hi = job.get("salary_max")
    if lo or hi:
        try:
            return SalaryRange(
                min=float(lo) if lo else None,
                max=float(hi) if hi else None,
                currency="USD",
                period="annual",
            )
        except Exception:
            pass
    return None


def _from_epoch(ts) -> datetime:
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None)
    except Exception:
        return datetime.utcnow()


class RemoteOKSource:
    id = "remoteok"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        seen: set[str] = set()
        async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
            for tag in _TAGS:
                try:
                    resp = await client.get(_API_URL, params={"tag": tag})
                    if not resp.is_success:
                        continue
                    items = resp.json()
                except Exception:
                    continue

                for j in items:
                    if not isinstance(j, dict) or not j.get("position"):
                        continue
                    job_id = str(j.get("id") or j.get("slug") or "")
                    if not job_id or job_id in seen:
                        continue
                    seen.add(job_id)

                    now = datetime.utcnow()
                    posted = _from_epoch(j.get("epoch")) if j.get("epoch") else now
                    tags = [str(t) for t in (j.get("tags") or []) if isinstance(t, str)][:6]

                    location_raw = j.get("location") or "Remote"
                    remote = "remote" in location_raw.lower() or not location_raw

                    yield Job(
                        id=_stable_id(job_id),
                        source=JobSource.remoteok,
                        source_id=job_id,
                        title=j.get("position") or "",
                        company=j.get("company") or "Unknown",
                        location=JobLocation(remote=True, raw=location_raw or "Remote"),
                        salary=_parse_salary(j),
                        description=j.get("description") or "",
                        requirements=[],
                        tags=tags,
                        job_type=JobType.full_time,
                        posted_date=posted,
                        deadline=None,
                        apply_url=j.get("apply_url") or j.get("url") or "",
                        created_at=now,
                        updated_at=now,
                    )
