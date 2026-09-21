"""The Muse connector — public API, Science+Engineering and Data+Analytics categories."""
import hashlib
import re
from datetime import datetime
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType

_API_URL = "https://www.themuse.com/api/public/jobs"
_PAGES_PER_CATEGORY = 5

_CATEGORIES = [
    "Science and Engineering",
    "Data and Analytics",
]

_US_STATE_PATTERN = re.compile(
    r",\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|"
    r"MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)$"
)


def _stable_id(job_id) -> str:
    return "muse-" + hashlib.md5(f"themuse-{job_id}".encode()).hexdigest()[:12]


def _parse_location(locations: list) -> JobLocation:
    if not locations:
        return JobLocation(remote=True, raw="Remote")
    loc_name = locations[0].get("name", "")
    parts = [p.strip() for p in loc_name.split(",")]
    city = parts[0] if parts else None
    state = parts[1] if len(parts) > 1 else None
    return JobLocation(city=city, state=state, country="US", remote=False, raw=loc_name)


def _is_us(locations: list) -> bool:
    if not locations:
        return False
    for loc in locations:
        name = loc.get("name", "")
        if _US_STATE_PATTERN.search(name):
            return True
        if "United States" in name or "Remote" in name:
            return True
    return False


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "").strip()


class TheMuseSource:
    id = "themuse"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        seen: set[str] = set()
        async with httpx.AsyncClient(timeout=30) as client:
            for category in _CATEGORIES:
                for page in range(1, _PAGES_PER_CATEGORY + 1):
                    try:
                        resp = await client.get(_API_URL, params={
                            "category": category,
                            "page": page,
                            "page_count": "true",
                        })
                        if not resp.is_success:
                            break
                        data = resp.json()
                    except Exception:
                        break

                    jobs = data.get("results") or []
                    if not jobs:
                        break

                    for j in jobs:
                        job_id = j.get("id")
                        if not job_id or str(job_id) in seen:
                            continue

                        locations = j.get("locations") or []
                        if not _is_us(locations):
                            continue

                        seen.add(str(job_id))
                        now = datetime.utcnow()

                        pub = j.get("publication_date")
                        try:
                            posted = datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else now
                        except Exception:
                            posted = now

                        levels = [lv.get("name", "") for lv in (j.get("levels") or [])]
                        cats = [c.get("name", "") for c in (j.get("categories") or [])]
                        tags = levels + cats

                        description = _strip_html(j.get("contents") or "")
                        apply_url = (j.get("refs") or {}).get("landing_page") or ""

                        yield Job(
                            id=_stable_id(job_id),
                            source=JobSource.themuse,
                            source_id=str(job_id),
                            title=j.get("name") or "",
                            company=(j.get("company") or {}).get("name") or "Unknown",
                            location=_parse_location(locations),
                            salary=None,
                            description=description,
                            requirements=[],
                            tags=[t for t in tags if t][:6],
                            job_type=JobType.full_time,
                            posted_date=posted,
                            deadline=None,
                            apply_url=apply_url,
                            created_at=now,
                            updated_at=now,
                        )

                    if page >= (data.get("page_count") or 1):
                        break
