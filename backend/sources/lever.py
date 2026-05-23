"""Lever connector — hits the public Lever Postings API for a given company slug."""

import hashlib
from datetime import datetime, timezone
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType

LEVER_API = "https://api.lever.co/v0/postings/{slug}"


def _stable_id(slug: str, posting_id: str) -> str:
    key = f"lever-{slug}-{posting_id}"
    return "lv-" + hashlib.md5(key.encode()).hexdigest()[:12]


def _parse_location(raw: str) -> JobLocation:
    remote = "remote" in raw.lower()
    parts = [p.strip() for p in raw.split(",")]
    city = parts[0] if parts else None
    state = parts[1] if len(parts) > 1 else None
    return JobLocation(city=city, state=state, remote=remote, raw=raw)


class LeverSource:
    id = "lever"

    async def fetch(self, company_slug: str, **kwargs) -> AsyncIterator[Job]:
        url = LEVER_API.format(slug=company_slug)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, params={"mode": "json"})
            if resp.status_code in (404, 403):
                return
            resp.raise_for_status()
            postings = resp.json()

        for p in postings:
            now = datetime.utcnow()
            created_ts = p.get("createdAt", 0)
            created = datetime.fromtimestamp(created_ts / 1000, tz=timezone.utc) if created_ts else now

            categories = p.get("categories", {})
            loc_raw = categories.get("location", "")
            dept = categories.get("department", "")
            team = categories.get("team", "")

            # Extract text from lists block
            lists = p.get("lists", [])
            reqs: list[str] = []
            for block in lists:
                if "requirement" in block.get("text", "").lower():
                    items = block.get("content", "").split("<li>")
                    reqs = [i.replace("</li>", "").strip() for i in items if i.strip()][:10]

            yield Job(
                id=_stable_id(company_slug, p["id"]),
                source=JobSource.lever,
                source_id=p["id"],
                title=p.get("text", ""),
                company=company_slug.replace("-", " ").title(),
                location=_parse_location(loc_raw),
                salary=None,
                description=p.get("descriptionPlain", p.get("description", "")),
                requirements=reqs,
                tags=[dept, team] if dept else [],
                job_type=JobType.full_time,
                posted_date=created,
                deadline=None,
                apply_url=p.get("hostedUrl"),
                created_at=now,
                updated_at=now,
            )
