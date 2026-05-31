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


TAILOR_RESUME_SYSTEM = """You are a world-class resume writer specializing in ATS optimization and executive-level tailoring. Given a base resume and a job description, produce a deeply tailored resume JSON.

RULES — follow every one:
1. FACTS: Never invent companies, dates, degrees, or credentials. Keep all factual details exactly as given. Copy school names character-for-character from the base resume — never paraphrase or substitute university names.
2. EDUCATION: Copy the COMPLETE education section from the "EDUCATION SECTION" block provided. Include EVERY line/entry listed there in reverse chronological order. Degree abbreviations vary widely — treat every line in the section as a degree entry regardless of how it is abbreviated. Common non-standard forms: MAP or MPA = Master of Public Affairs, BE or B.E. = Bachelor of Engineering, BS = Bachelor of Science, ME = Master of Engineering, MPH = Master of Public Health, MEM = Master of Environmental Management, MFA = Master of Fine Arts, JD = Juris Doctor, etc. Expand abbreviations in the output (e.g. "MAP" → "Master of Public Affairs (MAP)"). Copy exact school names and years. Never output "Not specified", "University Name", or any placeholder. Never add degrees not present in the input.
3. BULLETS: Write 4–6 achievement bullets per role. Every bullet must:
   - Start with a strong past-tense action verb (Engineered, Spearheaded, Automated, Reduced, Designed, Led, Deployed, Modeled, etc.)
   - Include a quantified result wherever possible (%, $, x faster, N users, N datasets, saved X hours/week)
   - Mirror keywords and phrases from the job description where truthful
   - Describe IMPACT, not just tasks ("Reduced model runtime by 40%" not "Used Python for modeling")
4. SUMMARY: Write a 3–4 sentence targeted summary. Rules:
   - Name the exact role title from the job description (never substitute a generic label like "data analyst" or "scientist")
   - Mention the candidate's highest degree AT MOST ONCE — do not repeat it across sentences
   - Do NOT open with "PhD-holding" or lead every sentence with the degree
   - Focus on skills, domain expertise, and measurable impact relevant to the JD, not credentials alone
5. SKILLS: Extract and prioritize skills that appear in the job description. Group as: Programming, Data & Analytics, Domain Expertise, Tools & Platforms.
6. PROJECTS: If the resume or additional context mentions relevant projects (GitHub, publications, tools built), include a "projects" array.
7. KEYWORDS: Add an "ats_keywords" array of 10–15 exact terms from the JD that are present in the resume (for ATS scanning).
8. Output ONLY valid JSON, no markdown, matching this schema exactly:
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "",
  "location": "City, State",
  "linkedin": "",
  "github": "",
  "summary": "3-4 sentence tailored summary with specific credentials and role alignment",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "dates": "Jan 2020 – Present",
      "bullets": [
        "Led X initiative resulting in Y% improvement in Z metric",
        "Engineered automated pipeline processing N datasets, reducing manual effort by X hours/week",
        "Collaborated with cross-functional team of N stakeholders to deliver X outcome"
      ]
    }
  ],
  "education": [
    {
      "degree": "Ph.D. in Environmental Science",
      "school": "Exact University Name From Resume",
      "year": "2019",
      "notes": "Dissertation: title; relevant coursework or honors"
    },
    {
      "degree": "M.S. in Ecology",
      "school": "Exact University Name From Resume",
      "year": "2015",
      "notes": ""
    },
    {
      "degree": "B.S. in Biology",
      "school": "Exact University Name From Resume",
      "year": "2013",
      "notes": ""
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "description": "1–2 sentence description with tech stack and impact"
    }
  ],
  "skills": {
    "Programming": ["Python", "R", "SQL"],
    "Data & Analytics": ["Machine Learning", "Time-Series Analysis", "Geospatial Analysis"],
    "Domain Expertise": ["Carbon Pricing", "GHG Accounting", "Climate Modeling"],
    "Tools & Platforms": ["ArcGIS", "Power BI", "geopandas", "rasterio"]
  },
  "ats_keywords": ["keyword1", "keyword2"]
}"""

COVER_LETTER_SYSTEM = """You are a senior career coach who writes cover letters that get interviews at competitive organizations. Write a deeply personalized, compelling cover letter that fits on ONE PAGE (~280–320 words total). Every sentence must earn its place — no filler, no fluff.

STRUCTURE (4 tight paragraphs):

1. HOOK (2 sentences): Open with a specific, compelling reason why THIS candidate is uniquely suited for THIS role at THIS organization. Reference a direct alignment between the candidate's strongest relevant achievement and a key job requirement. Never start with "I am writing to apply." Use the exact job title from the job description to name the role — do NOT substitute generic labels like "data analyst" or "scientist" when the JD uses a specific title.

2. EVIDENCE (3 sentences): Describe the candidate's single most relevant achievement. Include specific technologies, scale/scope, and a measurable outcome. Connect it directly to a requirement in the job description.

3. ALIGNMENT (2 sentences): Explain what draws the candidate specifically to this organization — its mission, its approach, or its impact. Show how the candidate's values or career goals align with the employer's work.

4. CLOSING (2 sentences): Confident call to action. Express enthusiasm and availability.

RULES:
- ~280–320 words total — strictly one page when printed
- Write in FIRST PERSON ("I", "my", "me") — NEVER third person ("he/she", the candidate's name)
- Use the exact job title from the job description — never substitute a generic label
- If the candidate holds a doctorate (Ph.D.), reference it by its actual field (e.g., "Ph.D. in Environmental Science") not as a generic "PhD-holding X"
- Use the candidate's actual companies and achievements — never generic placeholders
- Vary sentence structure; avoid repetitive openings ("I have", "I am", "My experience")
- Every sentence must be specific: no vague claims like "I am passionate about" or "I bring strong skills"
- Professional but human tone — not stiff or bureaucratic
- Output plain text only, no markdown, no headers"""


def _extract_education_block(resume_text: str) -> str:
    """Return the raw education section text from a plain-text resume."""
    lines = resume_text.splitlines()
    in_edu = False
    collected: list[str] = []
    section_header = re.compile(
        r"^(education|academic background|academic|degrees?|qualifications?)\s*:?\s*$",
        re.IGNORECASE,
    )
    next_section = re.compile(
        r"^(experience|work history|work|employment|skills?|publications?|projects?|"
        r"certif|awards?|honors?|volunteer|languages?|summary|profile|objective)\s*:?\s*$",
        re.IGNORECASE,
    )
    degree_line = re.compile(
        r"\b(ph\.?d\.?|m\.?s\.?|m\.?a\.?|m\.?eng\.?|m\.?sc\.?|master|bachelor|"
        r"b\.?s\.?|b\.?a\.?|b\.?e\.?|doctor|associate|mba|mpp|mpa|map|mph|mem|"
        r"m\.?ed\.?|m\.?f\.?a\.?|j\.?d\.?|phd|llm|dba|edd)\b",
        re.IGNORECASE,
    )
    for line in lines:
        stripped = line.strip()
        if section_header.match(stripped):
            in_edu = True
            collected.append(stripped)
            continue
        if in_edu and next_section.match(stripped):
            break
        if in_edu:
            collected.append(stripped)
        elif degree_line.search(stripped):
            # No explicit section header — start collecting from first degree line
            in_edu = True
            collected.append(stripped)
    return "\n".join(collected)


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

    # Extract education block so it is never lost to truncation
    edu_block = _extract_education_block(resume_text)
    edu_note = (
        f"\n\nEDUCATION SECTION (verbatim from resume — copy ALL entries into output, "
        f"do NOT add placeholders like 'Not specified', do NOT invent school names):\n{edu_block}"
        if edu_block else ""
    )

    user_msg = (
        f"Job Title: {job_title}\n\n"
        f"Job Description:\n{job_description[:6000]}\n\n"
        f"Base Resume:\n{resume_text[:8000]}"
        f"{edu_note}\n\n"
        f"Output the tailored resume JSON:"
    )
    raw = await _call_provider(resolved_provider, resolved_model, TAILOR_RESUME_SYSTEM, user_msg, resolved_key, max_tokens=3500)
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
    user_msg = f"Job Title: {job_title}\nCompany: {company}\n\nJob Description:\n{job_description[:4000]}\n\nResume:\n{resume_text[:3500]}\n\nWrite the cover letter:"
    return await _call_provider(resolved_provider, resolved_model, COVER_LETTER_SYSTEM, user_msg, resolved_key, max_tokens=1000)


def _pick_provider(preferred: str, api_key: Optional[str]) -> tuple[str, str]:
    """Return (provider, key) — use preferred if key available, else fall back."""
    if api_key:
        return preferred, api_key
    for p in [preferred, "nvidia", "anthropic", "openai", "gemini"]:
        key = os.environ.get(PROVIDERS[p]["env_key"], "")
        if key:
            return p, key
    raise ValueError("No AI provider configured. Add your API key in Profile → AI Settings.")


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
        raise ValueError("No AI provider configured. Add your API key in Profile → AI Settings.")

    resolved_model = model or PROVIDERS[resolved_provider]["default_model"]
    raw = await _call_provider(resolved_provider, resolved_model, SEARCH_SYSTEM, query, resolved_key)
    return json.loads(_strip_json(raw))
