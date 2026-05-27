"""Multi-provider AI layer — Anthropic, OpenAI, NVIDIA NIM, Google Gemini."""

import json
import os
import re
from typing import Optional

from .models import AnalyzeResult

# ── Provider registry ────────────────────────────────────────────────

PROVIDERS = {
    "anthropic": {
        "label": "Claude Opus 4.7",
        "models": ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
        "default_model": "claude-opus-4-7",
        "env_key": "ANTHROPIC_API_KEY",
    },
    "openai": {
        "label": "GPT-4o",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
        "default_model": "gpt-4o",
        "env_key": "OPENAI_API_KEY",
    },
    "nvidia": {
        "label": "NVIDIA NIM (Llama 3.3 70B)",
        "models": [
            "meta/llama-3.3-70b-instruct",
            "nvidia/llama-3.1-nemotron-70b-instruct",
            "mistralai/mistral-large-2-instruct",
            "google/gemma-3-27b-it",
        ],
        "default_model": "meta/llama-3.3-70b-instruct",
        "env_key": "NVIDIA_API_KEY",
        "base_url": "https://integrate.api.nvidia.com/v1",
    },
    "gemini": {
        "label": "Gemini 1.5 Pro",
        "models": ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
        "default_model": "gemini-1.5-pro",
        "env_key": "GEMINI_API_KEY",
    },
}


def available_providers() -> list[dict]:
    """Return providers that have a configured API key."""
    result = []
    for pid, info in PROVIDERS.items():
        has_key = bool(os.environ.get(info["env_key"], ""))
        result.append({
            "id": pid,
            "label": info["label"],
            "available": has_key,
            "models": info["models"],
            "default_model": info["default_model"],
        })
    return result


def _resolve_key(provider: str, api_key: Optional[str]) -> str:
    key = api_key or os.environ.get(PROVIDERS[provider]["env_key"], "")
    if not key:
        raise ValueError(
            f"No API key for provider '{provider}'. "
            f"Set {PROVIDERS[provider]['env_key']} or pass api_key in the request."
        )
    return key


# ── Shared prompt ────────────────────────────────────────────────────

ANALYZE_SYSTEM = """You are a precise job-fit analyzer. Given a job description and a resume, you:
1. Score the fit from 0.0 to 5.0 (one decimal place)
2. Write a 2-sentence summary of the role
3. List up to 5 specific reasons the candidate is a good fit
4. List up to 5 specific gaps or concerns
5. Extract the top 8 requirements from the job description as short bullet strings

Respond ONLY with valid JSON matching this schema (no markdown, no explanation):
{"score":4.2,"summary":"...","fit_reasons":["..."],"gap_reasons":["..."],"extracted_requirements":["..."]}"""

SEARCH_SYSTEM = """Extract structured job search parameters from a natural language query.
Respond ONLY with valid JSON (no markdown):
{"keyword":"data scientist","location":"remote","organization":"","tags":["python","environmental"]}
Only include fields clearly implied by the query. Use empty strings for absent fields."""


def _strip_json(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"```$", "", raw).strip()
    return raw


# ── Provider implementations ─────────────────────────────────────────

async def _call_anthropic(system: str, user: str, model: str, api_key: str, max_tokens: int = 1024) -> str:
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=api_key)
    resp = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
    )
    return resp.content[0].text


async def _call_openai_compat(
    system: str, user: str, model: str, api_key: str,
    base_url: Optional[str] = None, max_tokens: int = 1024,
) -> str:
    import asyncio
    from openai import AsyncOpenAI, RateLimitError
    kwargs: dict = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = AsyncOpenAI(**kwargs)
    for attempt in range(4):
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                max_tokens=max_tokens,
                temperature=0.2,
            )
            return resp.choices[0].message.content or ""
        except RateLimitError:
            if attempt == 3:
                raise
            await asyncio.sleep(2 ** attempt * 5)  # 5s, 10s, 20s
        except Exception as e:
            err = str(e)
            # Strip HTML from error messages for readability
            if "<!DOCTYPE" in err or "<html" in err.lower():
                raise RuntimeError(f"API returned HTML error page (status may be 401/403). Check your API key. Provider base_url={base_url}")
            raise


async def _call_gemini(system: str, user: str, model: str, api_key: str, max_tokens: int = 1024) -> str:
    import asyncio
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    gmodel = genai.GenerativeModel(
        model_name=model,
        system_instruction=system,
    )
    resp = await asyncio.to_thread(gmodel.generate_content, user)
    return resp.text


async def _call_provider(
    provider: str, model: str, system: str, user: str, api_key: str, max_tokens: int = 1024,
) -> str:
    if provider == "anthropic":
        return await _call_anthropic(system, user, model, api_key, max_tokens=max_tokens)
    elif provider == "openai":
        return await _call_openai_compat(system, user, model, api_key, max_tokens=max_tokens)
    elif provider == "nvidia":
        base_url = PROVIDERS["nvidia"]["base_url"]
        return await _call_openai_compat(system, user, model, api_key, base_url=base_url, max_tokens=max_tokens)
    elif provider == "gemini":
        return await _call_gemini(system, user, model, api_key, max_tokens=max_tokens)
    else:
        raise ValueError(f"Unknown provider: {provider}")


# ── Public API ───────────────────────────────────────────────────────

async def analyze_job_fit(
    job_id: str,
    job_title: str,
    job_description: str,
    resume_text: str,
    provider: str = "anthropic",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> AnalyzeResult:
    if provider not in PROVIDERS:
        raise ValueError(f"Unknown provider '{provider}'. Choose: {list(PROVIDERS)}")

    resolved_model = model or PROVIDERS[provider]["default_model"]
    resolved_key = _resolve_key(provider, api_key)

    user_msg = f"Job Title: {job_title}\n\nJob Description:\n{job_description[:4000]}\n\nResume:\n{resume_text[:3000]}"

    raw = await _call_provider(provider, resolved_model, ANALYZE_SYSTEM, user_msg, resolved_key)
    data = json.loads(_strip_json(raw))

    return AnalyzeResult(
        job_id=job_id,
        score=float(data.get("score", 0)),
        summary=data.get("summary", ""),
        fit_reasons=data.get("fit_reasons", []),
        gap_reasons=data.get("gap_reasons", []),
        extracted_requirements=data.get("extracted_requirements", []),
    )


TAILOR_RESUME_SYSTEM = """You are an expert resume writer. Given a base resume and a job description,
produce a tailored resume as a JSON object. Rules:
- Keep all factual information (companies, dates, degrees, names) exactly as-is
- Reorder bullet points so the most relevant ones come first
- Rephrase bullets to mirror the job description's language where truthful
- Do NOT invent or exaggerate anything
- Output ONLY valid JSON, no markdown fences, matching this schema exactly:
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "",
  "location": "City, State",
  "linkedin": "",
  "summary": "2-3 sentence tailored professional summary",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "dates": "Jan 2020 – Present",
      "bullets": ["achievement 1", "achievement 2"]
    }
  ],
  "education": [
    {
      "degree": "M.S. Environmental Science",
      "school": "University Name",
      "year": "2020",
      "notes": ""
    }
  ],
  "skills": ["Python", "GIS", "SQL"]
}"""

COVER_LETTER_SYSTEM = """You are an expert career coach and cover letter writer.
Given a resume and a job description, write a compelling, personalized cover letter.
Rules:
- 3-4 paragraphs, professional but warm tone
- Opening: why THIS role at THIS company excites the candidate
- Middle: 2-3 specific achievements from the resume that directly match the job
- Closing: call to action, enthusiasm
- No generic phrases like 'I am writing to apply for...'
- Output plain text only, no markdown"""


async def tailor_resume(
    job_title: str,
    job_description: str,
    resume_text: str,
    provider: str = "nvidia",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> dict:
    """Return structured resume as a dict."""
    resolved_provider, resolved_key = _pick_provider(provider, api_key)
    resolved_model = model or PROVIDERS[resolved_provider]["default_model"]
    user_msg = f"Job Title: {job_title}\n\nJob Description:\n{job_description[:4000]}\n\nBase Resume:\n{resume_text[:3000]}\n\nOutput the tailored resume JSON:"
    raw = await _call_provider(resolved_provider, resolved_model, TAILOR_RESUME_SYSTEM, user_msg, resolved_key)
    return json.loads(_strip_json(raw))


async def generate_cover_letter(
    job_title: str,
    company: str,
    job_description: str,
    resume_text: str,
    provider: str = "nvidia",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> str:
    resolved_provider, resolved_key = _pick_provider(provider, api_key)
    resolved_model = model or PROVIDERS[resolved_provider]["default_model"]
    user_msg = f"Job Title: {job_title}\nCompany: {company}\n\nJob Description:\n{job_description[:3000]}\n\nResume:\n{resume_text[:2500]}\n\nWrite the cover letter:"
    return await _call_provider(resolved_provider, resolved_model, COVER_LETTER_SYSTEM, user_msg, resolved_key)


def _pick_provider(preferred: str, api_key: Optional[str]) -> tuple[str, str]:
    """Return (provider, key) — use preferred if key available, else fall back."""
    if api_key:
        return preferred, api_key
    for p in [preferred, "nvidia", "anthropic", "openai", "gemini"]:
        key = os.environ.get(PROVIDERS[p]["env_key"], "")
        if key:
            return p, key
    raise ValueError("No AI provider configured. Set at least one API key in .env.")


async def call_ai(
    prompt: str,
    provider: str = "nvidia",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    max_tokens: int = 2048,
) -> str:
    """General-purpose AI call — returns raw text. Used by story generate/polish."""
    resolved_provider, resolved_key = _pick_provider(provider, api_key)
    resolved_model = model or PROVIDERS[resolved_provider]["default_model"]
    return await _call_provider(
        resolved_provider, resolved_model,
        "You are a helpful career coach assistant.", prompt,
        resolved_key, max_tokens=max_tokens,
    )


async def parse_search_query(
    query: str,
    provider: str = "anthropic",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> dict:
    # Fall back through providers if the preferred one has no key
    for p in [provider, "nvidia", "openai", "gemini", "anthropic"]:
        key = os.environ.get(PROVIDERS[p]["env_key"], "")
        if key:
            resolved_key = key
            resolved_provider = p
            break
    else:
        raise ValueError("No AI provider configured. Set at least one API key in .env.")

    resolved_model = model or PROVIDERS[resolved_provider]["default_model"]
    raw = await _call_provider(resolved_provider, resolved_model, SEARCH_SYSTEM, query, resolved_key)
    return json.loads(_strip_json(raw))
