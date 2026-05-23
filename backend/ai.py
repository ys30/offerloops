"""Claude Opus 4.7 integration — job analysis, scoring, extraction."""

import os
from typing import Optional

import anthropic

from .models import AnalyzeResult

DEFAULT_MODEL = "claude-opus-4-7"


def get_client(api_key: Optional[str] = None) -> anthropic.Anthropic:
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise ValueError("No Anthropic API key provided. Pass api_key or set ANTHROPIC_API_KEY.")
    return anthropic.Anthropic(api_key=key)


ANALYZE_SYSTEM = """You are a precise job-fit analyzer. Given a job description and a resume, you:
1. Score the fit from 0.0 to 5.0 (one decimal place)
2. Write a 2-sentence summary of the role
3. List up to 5 specific reasons the candidate is a good fit
4. List up to 5 specific gaps or concerns
5. Extract the top 8 requirements from the job description as short bullet strings

Respond ONLY with valid JSON matching this schema:
{
  "score": 4.2,
  "summary": "...",
  "fit_reasons": ["...", "..."],
  "gap_reasons": ["...", "..."],
  "extracted_requirements": ["...", "..."]
}"""


async def analyze_job_fit(
    job_id: str,
    job_title: str,
    job_description: str,
    resume_text: str,
    api_key: Optional[str] = None,
) -> AnalyzeResult:
    client = get_client(api_key)

    user_msg = f"""Job Title: {job_title}

Job Description:
{job_description[:4000]}

Resume:
{resume_text[:3000]}"""

    # Use prompt caching for the system prompt
    response = client.messages.create(
        model=DEFAULT_MODEL,
        max_tokens=1024,
        system=[
            {
                "type": "text",
                "text": ANALYZE_SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_msg}],
    )

    import json
    raw = response.content[0].text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    data = json.loads(raw)

    return AnalyzeResult(
        job_id=job_id,
        score=float(data.get("score", 0)),
        summary=data.get("summary", ""),
        fit_reasons=data.get("fit_reasons", []),
        gap_reasons=data.get("gap_reasons", []),
        extracted_requirements=data.get("extracted_requirements", []),
    )


SEARCH_SYSTEM = """You are a job search assistant. The user gives you a natural-language query
about what job they want. Return a JSON object with extracted search parameters:
{
  "keyword": "data scientist",
  "location": "remote",
  "organization": "",   // federal agency code e.g. "EP" for EPA, "GS" for USGS
  "tags": ["python", "environmental"]
}
Only include fields that are clearly implied by the query. Use empty strings for absent fields."""


def parse_search_query(query: str, api_key: Optional[str] = None) -> dict:
    """Use Claude to extract structured search params from a natural language query."""
    client = get_client(api_key)
    response = client.messages.create(
        model=DEFAULT_MODEL,
        max_tokens=256,
        system=SEARCH_SYSTEM,
        messages=[{"role": "user", "content": query}],
    )
    import json
    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)
