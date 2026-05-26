"""Climatebase.org connector — listing page + individual job detail pages."""
import asyncio
import hashlib
import json
import re
from datetime import datetime
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType, SalaryRange

_LIST_URL = "https://climatebase.org/jobs"
_DETAIL_URL = "https://climatebase.org/job/{}"
_PAGES_TO_FETCH = 3
_CONCURRENCY = 5  # parallel detail fetches

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Referer": "https://climatebase.org/jobs",
}


def _stable_id(job_id) -> str:
    return "cb-" + hashlib.md5(f"climatebase-{job_id}".encode()).hexdigest()[:12]


def _parse_location(locations: list, remote_prefs: list, detail_locs: list) -> JobLocation:
    remote = any("remote" in p.lower() for p in remote_prefs)
    # Prefer clean primary_location_name from detail page
    if detail_locs:
        primary = detail_locs[0].get("location", {}).get("primary_location_name") or ""
        raw = "; ".join(
            loc.get("location", {}).get("primary_location_name") or "" for loc in detail_locs
        )
    else:
        primary = locations[0] if locations else ""
        raw = "; ".join(locations) if locations else ("Remote" if remote else "")

    parts = [p.strip() for p in (primary or "").split(",")]
    city = parts[0] if parts and parts[0] else None
    state = parts[1].strip() if len(parts) > 1 else None
    return JobLocation(city=city, state=state, remote=remote or not (locations or detail_locs), raw=raw)


def _extract_listing_jobs(html: str) -> list[dict]:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.+?)</script>', html, re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
        return data.get("props", {}).get("pageProps", {}).get("jobs", [])
    except Exception:
        return []


def _extract_detail(html: str) -> dict:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.+?)</script>', html, re.DOTALL)
    if not m:
        return {}
    try:
        data = json.loads(m.group(1))
        return data.get("props", {}).get("pageProps", {}).get("data", {})
    except Exception:
        return {}


async def _fetch_detail(client: httpx.AsyncClient, sem: asyncio.Semaphore, job_id) -> dict:
    async with sem:
        try:
            resp = await client.get(_DETAIL_URL.format(job_id))
            if resp.is_success:
                return _extract_detail(resp.text)
        except Exception:
            pass
        return {}


class ClimatebaseSource:
    id = "climatebase"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        seen: set = set()
        listing_jobs: list[dict] = []

        async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=_HEADERS) as client:
            # Step 1: collect all listing-page jobs
            for page in range(1, _PAGES_TO_FETCH + 1):
                try:
                    url = f"{_LIST_URL}?page={page}" if page > 1 else _LIST_URL
                    resp = await client.get(url)
                    if not resp.is_success:
                        break
                    jobs = _extract_listing_jobs(resp.text)
                    if not jobs:
                        break
                    for j in jobs:
                        jid = j.get("id")
                        if jid not in seen:
                            seen.add(jid)
                            listing_jobs.append(j)
                except Exception:
                    break

            # Step 2: fetch all detail pages concurrently
            sem = asyncio.Semaphore(_CONCURRENCY)
            job_ids = [j.get("id") for j in listing_jobs]
            detail_pages = await asyncio.gather(
                *[_fetch_detail(client, sem, jid) for jid in job_ids]
            )

        # Step 3: yield merged jobs
        for j, detail in zip(listing_jobs, detail_pages):
            job_id = j.get("id")
            now = datetime.utcnow()

            pub = j.get("activation_date") or j.get("created_at")
            try:
                posted = datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else now
            except Exception:
                posted = now

            locations = j.get("locations") or []
            remote_prefs = j.get("remote_preferences") or []
            detail_locs = detail.get("jobs_locations") or []

            company = j.get("name_of_employer") or "Unknown"
            description = detail.get("description") or j.get("employer_short_description") or ""

            tags = (j.get("sectors") or []) + (j.get("job_types") or [])
            tags = [str(t) for t in tags[:5]]

            # Prefer detail-page salary (more complete), fall back to listing
            sal_min = detail.get("salary_from") or j.get("salary_from")
            sal_max = detail.get("salary_to") or j.get("salary_to")
            salary = None
            if sal_min or sal_max:
                try:
                    salary = SalaryRange(
                        min=float(sal_min) if sal_min else None,
                        max=float(sal_max) if sal_max else None,
                        currency="USD",
                        period=j.get("salary_period") or "yearly",
                    )
                except Exception:
                    pass

            apply_url = f"https://climatebase.org/job/{job_id}"

            yield Job(
                id=_stable_id(job_id),
                source=JobSource.climatebase,
                source_id=str(job_id),
                title=j.get("title") or "",
                company=company,
                location=_parse_location(locations, remote_prefs, detail_locs),
                salary=salary,
                description=description,
                requirements=[],
                tags=tags,
                job_type=JobType.full_time,
                posted_date=posted,
                deadline=None,
                apply_url=apply_url,
                created_at=now,
                updated_at=now,
            )
