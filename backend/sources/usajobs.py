"""USAJobs.gov connector — free federal job board API (EPA, USGS, DOE, etc.)."""

import hashlib
import os
from datetime import datetime
from typing import AsyncIterator, Optional

import httpx

from ..models import Job, JobLocation, JobSource, JobType, SalaryRange

USAJOBS_API = "https://data.usajobs.gov/api/search"
# USAJobs requires a free API key: https://developer.usajobs.gov/APIRequest/Index
# Set env vars: USAJOBS_API_KEY and USAJOBS_USER_AGENT (your email)


def _get_headers() -> dict:
    api_key = os.environ.get("USAJOBS_API_KEY", "")
    email = os.environ.get("USAJOBS_USER_AGENT", "job-search-platform@localhost")
    headers = {
        "Host": "data.usajobs.gov",
        "User-Agent": email,
    }
    if api_key:
        headers["Authorization-Key"] = api_key
    return headers


def _parse_pay_grade(detail: dict) -> Optional[SalaryRange]:
    low = detail.get("MinimumRange")
    high = detail.get("MaximumRange")
    rate = detail.get("RateIntervalCode", "PA")  # PA=per annum, PH=per hour
    if not low and not high:
        return None
    return SalaryRange(
        min=float(low) if low else None,
        max=float(high) if high else None,
        currency="USD",
        period="annual" if rate == "PA" else "hourly",
    )


def _parse_location(pos: dict, details: dict) -> JobLocation:
    locs = pos.get("PositionLocation", [])
    # Use the API's own RemoteIndicator field (most reliable)
    remote = details.get("RemoteIndicator") == "Yes" or details.get("TeleworkEligible") == "Yes"

    if not locs:
        return JobLocation(raw="Not specified", remote=remote)

    loc = locs[0]
    city = loc.get("CityName", "").split(",")[0].strip()  # "Elmendorf AFB, Alaska" → "Elmendorf AFB"
    state = loc.get("CountrySubDivisionCode")
    loc_name = loc.get("LocationName", "")

    # Also check location names for remote/virtual indicators
    if not remote:
        remote = any(
            kw in (l.get("LocationName") or "").lower()
            for l in locs
            for kw in ("remote", "virtual", "telework", "anywhere in the u.s")
        )

    return JobLocation(
        city=city,
        state=state,
        country="US",
        remote=remote,
        raw=loc_name,
    )


def _extract_requirements(details: dict) -> list[str]:
    # Prefer dedicated Requirements field; fall back to KeyRequirements list
    reqs_html = details.get("Requirements", "") or ""
    key_reqs = details.get("KeyRequirements", []) or []

    reqs: list[str] = []
    if key_reqs:
        reqs = [r.strip() for r in key_reqs if r.strip()]
    elif reqs_html:
        # Strip HTML tags and split on newlines/bullets
        import re
        plain = re.sub(r"<[^>]+>", " ", reqs_html)
        reqs = [ln.strip(" -•·") for ln in plain.splitlines() if len(ln.strip()) > 20]
    return reqs[:10]


def _stable_id(source_id: str) -> str:
    return "usajobs-" + hashlib.md5(source_id.encode()).hexdigest()[:12]


class USAJobsSource:
    id = "usajobs"

    async def fetch(
        self,
        keyword: str = "",
        organization: str = "",     # department agency code e.g. "EP"=EPA, "IN"=Interior
        location: str = "",
        results_per_page: int = 25,
        page: int = 1,
        **kwargs,
    ) -> AsyncIterator[Job]:
        params: dict = {
            "ResultsPerPage": results_per_page,
            "PageNumber": page,
        }
        if keyword:
            params["Keyword"] = keyword
        if organization:
            params["Organization"] = organization
        if location:
            params["LocationName"] = location

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(USAJOBS_API, headers=_get_headers(), params=params)
            if resp.status_code == 401:
                raise PermissionError(
                    "USAJobs API requires a free key. "
                    "Register at https://developer.usajobs.gov/APIRequest/Index "
                    "then set USAJOBS_API_KEY and USAJOBS_USER_AGENT env vars."
                )
            resp.raise_for_status()
            data = resp.json()

        items = data.get("SearchResult", {}).get("SearchResultItems", [])
        for item in items:
            pos = item.get("MatchedObjectDescriptor", {})
            details = pos.get("UserArea", {}).get("Details", {})
            source_id = pos.get("PositionID", "")
            now = datetime.utcnow()

            pay = pos.get("PositionRemuneration", [{}])[0]
            salary = _parse_pay_grade(pay)
            job_location = _parse_location(pos, details)

            posted_raw = pos.get("PublicationStartDate")
            deadline_raw = pos.get("ApplicationCloseDate")
            posted = datetime.fromisoformat(posted_raw[:10]) if posted_raw else None
            deadline = datetime.fromisoformat(deadline_raw[:10]) if deadline_raw else None

            categories = pos.get("JobCategory", [])
            tags = [c.get("Name", "") for c in categories if c.get("Name")]
            dept = pos.get("DepartmentName", "")
            if dept:
                tags.append(dept)

            yield Job(
                id=_stable_id(source_id),
                source=JobSource.usajobs,
                source_id=source_id,
                title=pos.get("PositionTitle", ""),
                company=pos.get("OrganizationName", "Federal Agency"),
                location=job_location,
                salary=salary,
                description=details.get("JobSummary", ""),
                requirements=_extract_requirements(details),
                tags=tags,
                job_type=JobType.full_time,
                posted_date=posted,
                deadline=deadline,
                apply_url=pos.get("PositionURI"),
                created_at=now,
                updated_at=now,
            )
