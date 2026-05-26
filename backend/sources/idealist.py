"""Idealist.org connector — nonprofit and social-impact job board."""
import hashlib
from datetime import datetime, timezone
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType, SalaryRange

_SEARCH_URL = "https://www.idealist.org/api/v1/listings"
_KEYWORDS = [
    "environmental scientist",
    "data scientist",
    "conservation",
    "climate",
    "water resources",
    "geospatial",
    "GIS",
    "sustainability",
    "natural resources",
    "ecology",
]
_PAGES_PER_KEYWORD = 2
_PAGE_SIZE = 20

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Referer": "https://www.idealist.org/en/jobs",
}


def _stable_id(listing_id: str) -> str:
    return "idealist-" + hashlib.md5(f"idealist-{listing_id}".encode()).hexdigest()[:12]


def _parse_location(listing: dict) -> JobLocation:
    remote = listing.get("isRemote") or listing.get("remote", False)
    city = listing.get("city") or None
    state = listing.get("state") or None
    country = listing.get("country") or "US"
    raw = ", ".join(filter(None, [city, state, country]))
    return JobLocation(city=city, state=state, country=country, remote=bool(remote), raw=raw or None)


def _parse_salary(listing: dict) -> SalaryRange | None:
    lo = listing.get("salaryFrom") or listing.get("salary_from")
    hi = listing.get("salaryTo") or listing.get("salary_to")
    if not lo and not hi:
        return None
    try:
        return SalaryRange(
            min=float(lo) if lo else None,
            max=float(hi) if hi else None,
            currency="USD",
            period="yearly",
        )
    except Exception:
        return None


class IdealistSource:
    id = "idealist"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        seen: set[str] = set()
        async with httpx.AsyncClient(timeout=20, headers=_HEADERS, follow_redirects=True) as client:
            for keyword in _KEYWORDS:
                for page in range(1, _PAGES_PER_KEYWORD + 1):
                    try:
                        resp = await client.get(_SEARCH_URL, params={
                            "type": "JOB",
                            "q": keyword,
                            "page": page,
                            "pageSize": _PAGE_SIZE,
                        })
                        if not resp.is_success:
                            break
                        data = resp.json()
                        listings = data.get("hits") or data.get("results") or data.get("listings") or []
                        if not listings:
                            break
                        for item in listings:
                            lid = str(item.get("id") or item.get("objectID") or "")
                            if not lid or lid in seen:
                                continue
                            seen.add(lid)

                            pub = item.get("publishedAt") or item.get("activatedAt") or item.get("startDate")
                            try:
                                posted = datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else datetime.now(timezone.utc)
                            except Exception:
                                posted = datetime.now(timezone.utc)

                            now = datetime.utcnow()
                            org = item.get("org") or item.get("organization") or {}
                            company = (org.get("name") if isinstance(org, dict) else org) or item.get("orgName") or "Unknown"
                            desc = item.get("description") or item.get("body") or ""
                            tags = [s for s in (item.get("themes") or item.get("sectors") or []) if isinstance(s, str)][:6]
                            apply_url = item.get("url") or f"https://www.idealist.org/en/job/{lid}"

                            yield Job(
                                id=_stable_id(lid),
                                source=JobSource.idealist,
                                source_id=lid,
                                title=item.get("title") or item.get("name") or "",
                                company=company,
                                location=_parse_location(item),
                                salary=_parse_salary(item),
                                description=desc,
                                requirements=[],
                                tags=tags,
                                job_type=JobType.full_time,
                                posted_date=posted,
                                deadline=None,
                                apply_url=apply_url,
                                created_at=now,
                                updated_at=now,
                            )
                    except Exception:
                        break
