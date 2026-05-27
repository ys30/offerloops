"""Fetch enrichment context from GitHub, ORCID, and Google Scholar public APIs."""

import asyncio
import re
from typing import Optional


async def fetch_github_context(github_url: str) -> str:
    import httpx
    match = re.search(r"github\.com/([^/?#\s]+)", github_url)
    if not match:
        return ""
    username = match.group(1)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.github.com/users/{username}/repos",
                params={"sort": "updated", "per_page": 12, "type": "public"},
                headers={"Accept": "application/vnd.github.v3+json", "User-Agent": "OfferLoops/1.0"},
            )
            if resp.status_code != 200:
                return ""
            repos = resp.json()

        if not repos:
            return ""

        lines = [f"GitHub public projects (@{username}):"]
        for repo in repos[:10]:
            name = repo.get("name", "")
            desc = repo.get("description") or ""
            lang = repo.get("language") or ""
            stars = repo.get("stargazers_count", 0)
            topics = ", ".join((repo.get("topics") or [])[:5])
            line = f"  • {name}"
            if lang:
                line += f" [{lang}]"
            if stars:
                line += f" ★{stars}"
            if desc:
                line += f" — {desc}"
            if topics:
                line += f" (tags: {topics})"
            lines.append(line)
        return "\n".join(lines)
    except Exception:
        return ""


async def fetch_orcid_context(orcid_url: str) -> str:
    import httpx
    match = re.search(r"(\d{4}-\d{4}-\d{4}-\d{3}[\dX])", orcid_url)
    if not match:
        return ""
    orcid_id = match.group(1)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://pub.orcid.org/v3.0/{orcid_id}/works",
                headers={"Accept": "application/json"},
            )
            if resp.status_code != 200:
                return ""
            data = resp.json()

        groups = (data.get("group") or [])[:12]
        if not groups:
            return ""

        lines = [f"Publications (ORCID {orcid_id}):"]
        for g in groups:
            summaries = g.get("work-summary") or []
            if not summaries:
                continue
            ws = summaries[0]
            title_obj = (ws.get("title") or {}).get("title") or {}
            title = title_obj.get("value", "")
            year_obj = (ws.get("publication-date") or {}).get("year") or {}
            year = year_obj.get("value", "")
            if title:
                lines.append(f"  • {title}" + (f" ({year})" if year else ""))
        return "\n".join(lines) if len(lines) > 1 else ""
    except Exception:
        return ""


async def fetch_scholar_context(scholar_url: str) -> str:
    import httpx
    from bs4 import BeautifulSoup
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            resp = await client.get(
                scholar_url,
                headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"},
            )
            if resp.status_code != 200:
                return ""
            html = resp.text

        soup = BeautifulSoup(html, "html.parser")
        titles = [el.get_text(strip=True) for el in soup.select(".gsc_a_at")][:12]
        if not titles:
            return ""

        lines = ["Google Scholar publications:"]
        for t in titles:
            lines.append(f"  • {t}")
        return "\n".join(lines)
    except Exception:
        return ""


async def build_links_context(profile) -> str:
    """Fetch and combine context from all configured profile links. Returns '' if nothing."""
    tasks = []
    if getattr(profile, "github_url", None):
        tasks.append(fetch_github_context(profile.github_url))
    if getattr(profile, "orcid_url", None):
        tasks.append(fetch_orcid_context(profile.orcid_url))
    if getattr(profile, "google_scholar_url", None):
        tasks.append(fetch_scholar_context(profile.google_scholar_url))

    if not tasks:
        return ""

    results = await asyncio.gather(*tasks, return_exceptions=True)
    parts = [r for r in results if isinstance(r, str) and r.strip()]
    return "\n\n".join(parts)
