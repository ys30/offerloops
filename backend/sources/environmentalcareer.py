"""EnvironmentalCareer.com connector — RSS feed for environmental/conservation jobs."""
import hashlib
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import AsyncIterator
from xml.etree import ElementTree as ET

import httpx

from ..models import Job, JobLocation, JobSource, JobType

_RSS_URL = "https://environmentalcareer.com/rss/"

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml",
}

_DC_NS = {"dc": "http://purl.org/dc/elements/1.1/"}


def _stable_id(url: str) -> str:
    m = re.search(r"/job/(\d+)/", url)
    job_id = m.group(1) if m else url
    return "ec-" + hashlib.md5(f"envcareer-{job_id}".encode()).hexdigest()[:12]


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "").strip()


def _parse_location(description_raw: str) -> JobLocation:
    # Description begins with plain text "City, State, Country\nCompany\n<p>..."
    # or "Remote (State, Country)\nCompany\n<p>..."
    text_only = _strip_html(description_raw)
    lines = [l.strip() for l in text_only.split("\n") if l.strip()]
    first_line = lines[0] if lines else ""

    remote = "remote" in first_line.lower() or "worldwide" in first_line.lower()

    # "Remote (California, USA)" → extract from parens
    paren = re.search(r"\(([^)]+)\)", first_line)
    location_str = paren.group(1) if paren else (first_line if not remote else "")

    parts = [p.strip() for p in location_str.split(",")]
    city = parts[0] if parts and parts[0] and not remote else None
    state = parts[1].strip() if len(parts) > 1 else None

    return JobLocation(
        city=city,
        state=state,
        country="US",
        remote=remote,
        raw=first_line or None,
    )


class EnvironmentalCareerSource:
    id = "environmental_career"

    async def fetch(self, **kwargs) -> AsyncIterator[Job]:
        try:
            async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
                resp = await client.get(_RSS_URL)
                if not resp.is_success:
                    return
                xml_text = resp.text
        except Exception:
            return

        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError:
            return

        channel = root.find("channel")
        if channel is None:
            return

        for item in channel.findall("item"):
            title = (item.findtext("title") or "").strip()
            if not title:
                continue

            link = (item.findtext("link") or item.findtext("guid") or "").strip()
            company = (item.findtext("dc:creator", namespaces=_DC_NS) or "Unknown").strip()
            pub_raw = item.findtext("pubDate") or ""
            description_raw = item.findtext("description") or ""

            try:
                posted = parsedate_to_datetime(pub_raw).replace(tzinfo=None) if pub_raw else datetime.utcnow()
            except Exception:
                posted = datetime.utcnow()

            m = re.search(r"/job/(\d+)/", link)
            source_id = m.group(1) if m else link

            now = datetime.utcnow()
            yield Job(
                id=_stable_id(link),
                source=JobSource.environmental_career,
                source_id=source_id,
                title=title,
                company=company,
                location=_parse_location(description_raw),
                salary=None,
                description=_strip_html(description_raw),
                requirements=[],
                tags=[],
                job_type=JobType.full_time,
                posted_date=posted,
                deadline=None,
                apply_url=link,
                created_at=now,
                updated_at=now,
            )
