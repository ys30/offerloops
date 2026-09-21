"""SmartRecruiters connector — public company postings API, US-only."""
import asyncio
import hashlib
import re
from datetime import datetime
from typing import AsyncIterator

import httpx

from ..models import Job, JobLocation, JobSource, JobType

_BASE = "https://api.smartrecruiters.com/v1/companies/{slug}/postings"
_CONCURRENCY = 8


def _stable_id(slug: str, posting_id: str) -> str:
    return "sr-" + hashlib.md5(f"sr-{slug}-{posting_id}".encode()).hexdigest()[:12]


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "").strip()


def _parse_location(loc: dict) -> JobLocation:
    city = loc.get("city")
    state = loc.get("region")
    remote = loc.get("remote") or loc.get("hybrid") or False
    raw = loc.get("fullLocation") or f"{city or ''}, {state or ''}".strip(", ")
    return JobLocation(city=city, state=state, country="US", remote=bool(remote), raw=raw or None)


def _map_type(raw: str) -> JobType:
    mapping = {
        "permanent": JobType.full_time,
        "contract": JobType.contract,
        "temporary": JobType.contract,
        "part_time": JobType.part_time,
        "internship": JobType.internship,
    }
    return mapping.get((raw or "").lower(), JobType.full_time)


async def _fetch_description(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    slug: str,
    posting_id: str,
) -> str:
    async with sem:
        try:
            resp = await client.get(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings/{posting_id}")
            if not resp.is_success:
                return ""
            sections = resp.json().get("jobAd", {}).get("sections", {})
            parts = [
                sections.get("jobDescription", {}).get("text", ""),
                sections.get("qualifications", {}).get("text", ""),
            ]
            return _strip_html(" ".join(filter(None, parts)))
        except Exception:
            return ""


class SmartRecruitersSource:
    id = "smartrecruiters"

    async def fetch(self, company_slug: str, **kwargs) -> AsyncIterator[Job]:
        listings: list[dict] = []
        async with httpx.AsyncClient(timeout=30) as client:
            offset = 0
            while True:
                try:
                    resp = await client.get(
                        _BASE.format(slug=company_slug),
                        params={"country": "us", "limit": 100, "offset": offset},
                    )
                    if not resp.is_success:
                        break
                    data = resp.json()
                except Exception:
                    break

                batch = data.get("content") or []
                listings.extend(batch)
                if offset + len(batch) >= data.get("totalFound", 0) or not batch:
                    break
                offset += len(batch)

            sem = asyncio.Semaphore(_CONCURRENCY)
            descriptions = await asyncio.gather(
                *[_fetch_description(client, sem, company_slug, j["id"]) for j in listings]
            )

        company_name = company_slug.replace("-", " ").title()
        for j, desc in zip(listings, descriptions):
            now = datetime.utcnow()
            pub = j.get("releasedDate")
            try:
                posted = datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else now
            except Exception:
                posted = now

            loc_raw = j.get("location") or {}
            emp_type = (j.get("typeOfEmployment") or {}).get("id", "")
            dept = (j.get("department") or {}).get("label", "")
            func = (j.get("function") or {}).get("label", "")
            exp = (j.get("experienceLevel") or {}).get("label", "")
            tags = [t for t in [dept, func, exp] if t][:4]

            posting_id = j["id"]
            apply_url = f"https://jobs.smartrecruiters.com/{company_slug.upper()}/{posting_id}"

            yield Job(
                id=_stable_id(company_slug, posting_id),
                source=JobSource.smartrecruiters,
                source_id=posting_id,
                title=j.get("name") or "",
                company=company_name,
                location=_parse_location(loc_raw),
                salary=None,
                description=desc,
                requirements=[],
                tags=tags,
                job_type=_map_type(emp_type),
                posted_date=posted,
                deadline=None,
                apply_url=apply_url,
                created_at=now,
                updated_at=now,
            )
