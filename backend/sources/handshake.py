"""Handshake connector — requires a valid session cookie (HANDSHAKE_SESSION env var).

To get your session cookie:
  1. Log in at https://app.joinhandshake.com
  2. Open DevTools → Application → Cookies → app.joinhandshake.com
  3. Copy the value of `_handshake_session`
  4. Set HANDSHAKE_SESSION=<value> in your .env file
"""

import hashlib
import os
from datetime import datetime, timezone
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType, SalaryRange

_BASE = "https://app.joinhandshake.com"
_SEARCH_URL = f"{_BASE}/stu/postings.json"

_KEYWORDS = [
    "environmental scientist",
    "environmental data",
    "climate data",
    "sustainability analyst",
    "data scientist",
    "GIS analyst",
    "geospatial",
    "water resources",
    "natural resources",
    "ecology",
    "conservation",
    "environmental engineer",
]
_PAGES_PER_KEYWORD = 2
_PER_PAGE = 25


def _stable_id(posting_id) -> str:
    return "hs-" + hashlib.md5(f"handshake-{posting_id}".encode()).hexdigest()[:12]


def _parse_location(item: dict) -> JobLocation:
    remote = item.get("remote_work_type") in ("fully_remote", "remote") or item.get("remote", False)
    city = item.get("city") or None
    state = item.get("state_name") or item.get("state") or None
    country = item.get("country_name") or item.get("country") or "US"
    raw_parts = [p for p in [city, state, country] if p]
    return JobLocation(city=city, state=state, country=country, remote=bool(remote), raw=", ".join(raw_parts) or None)


def _parse_salary(item: dict) -> SalaryRange | None:
    lo = item.get("salary_minimum") or item.get("salary_low") or item.get("minimum_compensation")
    hi = item.get("salary_maximum") or item.get("salary_high") or item.get("maximum_compensation")
    period_raw = (item.get("compensation_type") or "annual").lower()
    period = "hourly" if "hour" in period_raw else "annual"
    if not lo and not hi:
        return None
    try:
        return SalaryRange(min=float(lo) if lo else None, max=float(hi) if hi else None, currency="USD", period=period)
    except Exception:
        return None


def _parse_job_type(item: dict) -> JobType:
    raw = (item.get("job_type") or item.get("employment_type_name") or "").lower()
    if "part" in raw:
        return JobType.part_time
    if "contract" in raw or "freelance" in raw:
        return JobType.contract
    if "intern" in raw:
        return JobType.internship
    if "temp" in raw:
        return JobType.temporary
    return JobType.full_time


class HandshakeSource:
    id = "handshake"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        session = os.environ.get("HANDSHAKE_SESSION", "").strip()
        if not session:
            return  # not configured — skip silently

        headers = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{_BASE}/stu/postings",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
            "Cookie": f"_handshake_session={session}",
        }

        seen: set[str] = set()
        async with httpx.AsyncClient(timeout=30, headers=headers, follow_redirects=True) as client:
            for keyword in _KEYWORDS:
                for page in range(1, _PAGES_PER_KEYWORD + 1):
                    try:
                        resp = await client.get(_SEARCH_URL, params={
                            "page": page,
                            "per_page": _PER_PAGE,
                            "sort_direction": "desc",
                            "sort_column": "score",
                            "status[]": "approved",
                            "job_types[]": ["full_time", "part_time", "internship"],
                            "keywords": keyword,
                        })
                        if resp.status_code == 401 or resp.status_code == 403:
                            return  # session expired or invalid
                        if not resp.is_success:
                            break
                        data = resp.json()
                        postings = data.get("postings") or data.get("results") or []
                        if not postings:
                            break

                        for item in postings:
                            pid = str(item.get("id") or "")
                            if not pid or pid in seen:
                                continue
                            seen.add(pid)

                            emp = item.get("employer") or {}
                            company = (emp.get("name") if isinstance(emp, dict) else str(emp)) or item.get("employer_name") or "Unknown"

                            pub_raw = item.get("created_at") or item.get("start_date") or item.get("updated_at")
                            try:
                                posted = datetime.fromisoformat(pub_raw.replace("Z", "+00:00")) if pub_raw else datetime.now(timezone.utc)
                            except Exception:
                                posted = datetime.now(timezone.utc)

                            exp_raw = item.get("expiration_date") or item.get("deadline")
                            try:
                                deadline = datetime.fromisoformat(exp_raw.replace("Z", "+00:00")) if exp_raw else None
                            except Exception:
                                deadline = None

                            desc = item.get("description") or item.get("job_description") or ""
                            tags = [t for t in (item.get("labels") or item.get("industries") or []) if isinstance(t, str)][:6]
                            apply_url = item.get("apply_url") or f"{_BASE}/stu/postings/{pid}"
                            now = datetime.utcnow()

                            yield Job(
                                id=_stable_id(pid),
                                source=JobSource.handshake,
                                source_id=pid,
                                title=item.get("title") or item.get("job_title") or "",
                                company=company,
                                location=_parse_location(item),
                                salary=_parse_salary(item),
                                description=desc,
                                requirements=[],
                                tags=tags,
                                job_type=_parse_job_type(item),
                                posted_date=posted,
                                deadline=deadline,
                                apply_url=apply_url,
                                created_at=now,
                                updated_at=now,
                            )
                    except Exception:
                        break
