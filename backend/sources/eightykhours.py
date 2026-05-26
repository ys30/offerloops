"""80,000 Hours job board — uses Algolia search API."""
import hashlib
from datetime import datetime, timezone
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType, SalaryRange

ALGOLIA_APP_ID = "W6KM1UDIB3"
ALGOLIA_API_KEY = "d1d7f2c8696e7b36837d5ed337c4a319"
ALGOLIA_URL = f"https://{ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries"

HEADERS = {
    "x-algolia-application-id": ALGOLIA_APP_ID,
    "x-algolia-api-key": ALGOLIA_API_KEY,
    "Content-Type": "application/json",
    "Origin": "https://jobs.80000hours.org",
    "Referer": "https://jobs.80000hours.org/",
}


def _stable_id(job_id) -> str:
    return "8k-" + hashlib.md5(f"80k-{job_id}".encode()).hexdigest()[:12]


def _parse_location(card_locations: list, location_type_tags: list) -> JobLocation:
    remote = any("remote" in t.lower() for t in location_type_tags)
    raw = ", ".join(card_locations) if card_locations else ("Remote" if remote else "")
    first = card_locations[0] if card_locations else ""
    parts = [p.strip() for p in first.split(",")]
    return JobLocation(
        city=parts[0] if parts and parts[0] else None,
        state=parts[1] if len(parts) > 1 else None,
        remote=remote or not card_locations,
        raw=raw,
    )


def _parse_salary(salary_str: str | None, salary_limit: float | None) -> SalaryRange | None:
    if not salary_str and not salary_limit:
        return None
    try:
        import re
        # Only parse the USD portion (before any semicolon separating other currencies)
        usd_part = (salary_str or "").split(";")[0]
        # Match numbers that follow a $ sign
        nums = re.findall(r"\$([\d,]+)", usd_part)
        if nums:
            vals = [float(n.replace(",", "")) for n in nums]
            return SalaryRange(
                min=vals[0],
                max=vals[-1] if len(vals) > 1 else vals[0],
                currency="USD",
                period="annual",
            )
    except Exception:
        pass
    if salary_limit:
        return SalaryRange(min=None, max=salary_limit, currency="USD", period="annual")
    return None


def _from_ts(ts) -> datetime:
    """Unix timestamp → UTC datetime."""
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None)
    except Exception:
        return datetime.utcnow()


class EightyKHoursSource:
    id = "80k_hours"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        payload = {
            "requests": [
                {
                    "indexName": "jobs_prod",
                    "params": "hitsPerPage=200&page=0",
                }
            ]
        }
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.post(ALGOLIA_URL, json=payload, headers=HEADERS)
                if not resp.is_success:
                    return
                data = resp.json()
            except Exception:
                return

        results = data.get("results", [])
        hits = results[0].get("hits", []) if results else []

        for j in hits:
            now = datetime.utcnow()

            posted_ts = j.get("posted_at") or j.get("created_at")
            posted = _from_ts(posted_ts) if posted_ts else now

            closes_ts = j.get("closes_at")
            deadline = _from_ts(closes_ts) if closes_ts else None

            card_locations = j.get("card_locations") or []
            location_type_tags = j.get("tags_location_type") or []

            # Merge multiple tag categories into a short list
            tags = []
            for tag_field in ("tags_area", "tags_role_type", "tags_skill"):
                tags.extend(j.get(tag_field) or [])
            tags = [str(t) for t in tags[:5]]

            company_raw = j.get("company") or {}
            company = (
                j.get("company_name")
                or (company_raw.get("name") if isinstance(company_raw, dict) else None)
                or "Unknown"
            )

            apply_url = j.get("url_external") or j.get("url") or ""

            salary = _parse_salary(j.get("salary"), j.get("salary_limit"))

            yield Job(
                id=_stable_id(j.get("objectID") or j.get("post_pk") or j.get("title", "")),
                source=JobSource.eighty_k_hours,
                source_id=str(j.get("objectID") or j.get("post_pk") or ""),
                title=j.get("title") or "",
                company=company,
                location=_parse_location(card_locations, location_type_tags),
                salary=salary,
                description=j.get("description") or j.get("description_short") or "",
                requirements=[],
                tags=tags,
                job_type=JobType.full_time,
                posted_date=posted,
                deadline=deadline,
                apply_url=apply_url,
                created_at=now,
                updated_at=now,
            )
