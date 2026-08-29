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
        "label": "NVIDIA NIM (Nemotron Ultra 550B)",
        "models": [
            "nvidia/nemotron-3-ultra-550b-a55b",
            "nvidia/nemotron-3-super-120b-a12b",
            "openai/gpt-oss-120b",
            "nvidia/llama-3.1-nemotron-70b-instruct",
            "nvidia/llama-3.1-nemotron-51b-instruct",
            "nvidia/nemotron-3-nano-30b-a3b",
            "mistralai/mistral-large-2-instruct",
            "google/gemma-3-27b-it",
        ],
        "default_model": "nvidia/nemotron-3-ultra-550b-a55b",
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
    # Strip reasoning/thinking blocks (Nemotron, DeepSeek, o1-style)
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    # Strip markdown code fences
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"```$", "", raw).strip()
    # Extract JSON object if surrounded by prose
    if not raw.startswith("{"):
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            raw = m.group(0)
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
            content = resp.choices[0].message.content
            if not content:
                finish = resp.choices[0].finish_reason
                raise RuntimeError(
                    f"Model returned empty response (finish_reason={finish!r}). "
                    "This may be a rate limit or content-length issue — please try again."
                )
            return content
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

    for attempt in range(2):
        raw = await _call_provider(provider, resolved_model, ANALYZE_SYSTEM, user_msg, resolved_key, max_tokens=2048)
        try:
            data = json.loads(_strip_json(raw))
            break
        except (json.JSONDecodeError, ValueError):
            if attempt == 1:
                raise

    return AnalyzeResult(
        job_id=job_id,
        score=float(data.get("score", 0)),
        summary=data.get("summary", ""),
        fit_reasons=data.get("fit_reasons", []),
        gap_reasons=data.get("gap_reasons", []),
        extracted_requirements=data.get("extracted_requirements", []),
    )


TAILOR_RESUME_SYSTEM = """You are a world-class resume writer specializing in dense, technically precise, ATS-optimized one-page resumes. Given a base resume and a job description, produce a tailored resume JSON that is information-dense, technically specific, and highly readable.

STYLE GUIDE — this defines the voice and density:
- Bullets are dense and technical: name specific tools, methods, frameworks, and standards (e.g. "Scope 1–3 GHG accounting", "SSP-RCP scenarios", "ISO 14040 LCA", "GIS/MCDA", "SBTi target-setting")
- Every bullet conveys a complete idea in one tight line — no filler words, no vague verbs
- Bullets describe methodology + scope + outcome: what you did, with what tools/methods, at what scale, with what result
- The core_expertise field is a pipe-separated ( | ) list of 6–8 precise domain competencies drawn from the JD — this is the most ATS-critical line
- Writing is direct, specific, and professional — never generic ("utilized tools to support projects" is banned)

RULES:
1. FACTS: Never invent companies, dates, degrees, credentials, metrics, percentages, or outcomes. Every factual claim — every number, every scale, every result — must come directly from the base resume. Do not fabricate or "infer plausible" figures. If the original says nothing quantitative about a task, describe the work accurately without inventing numbers.
2. EDUCATION: Copy EVERY degree from the "EDUCATION SECTION" block in reverse chronological order. Expand abbreviations (MAP → Master of Public Affairs (MAP)). Copy school names character-for-character. Never add placeholder text.
3. LENGTH: Strict one-page. Enforce every limit below — this is the #1 constraint:
   - Profile/summary: 2 sentences maximum, no more
   - Roles: include only the 3 most recent/relevant; omit all others
   - Bullets: 3 per most recent role; 2 per remaining roles
   - Each bullet: one line, under 130 characters
   - Skills: 3–4 groups, max 4 items per group — use inline text not tags
   - Education: degree + school + year only, no notes
   - Projects: omit unless directly matching a core JD requirement; if included, max 1, one sentence
4. BULLETS: Each bullet must name (1) a strong action verb, (2) a specific tool/method/standard from the original resume, and (3) the actual scope or outcome as described in the original. Only include a number if the base resume states one. If no metric exists, describe the scope honestly (e.g. "institution-wide", "multi-site", "cross-functional") without fabricating percentages or impact claims.
   Formula: [Verb] + [specific method/tool from resume] + [actual scope] + [real outcome if stated]
   Good (metric exists in resume): "Reduced manual reconciliation time by 40% by automating SQL-based ETL workflows across campus financial systems"
   Good (no metric in resume): "Built automated SQL/Power BI reporting pipeline consolidating procurement, payroll, and grant data for institutional budget monitoring"
   Bad: invented numbers not in original ("reduced costs by 60%", "served 200+ stakeholders") — fabricating these damages credibility
5. PROFILE: 2 sentences. Sentence 1: role title from JD + top domain expertise. Sentence 2: key methodological strengths + tools. No degree-leading openers.
6. CORE EXPERTISE: 6–8 pipe-separated competencies directly matching JD keywords. Be specific: "Corporate Carbon Accounting & Scope 1–3" not "Carbon".
7. SKILLS: Inline grouped text — "Programming & Data: Python, R, SQL, Power BI | Spatial & Modeling: GIS, scenario modeling, time-series analysis"
8. KEYWORDS: 10–15 exact JD terms present in the resume for ATS scanning.
9. Output ONLY valid JSON, no markdown, matching this schema exactly:
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "555-000-0000",
  "location": "City, State",
  "linkedin": "",
  "github": "github.com/handle",
  "headline": "FULL NAME | EXACT JOB TITLE FROM JD",
  "core_expertise": "Competency One | Competency Two | Competency Three | Competency Four | Competency Five | Competency Six",
  "summary": "First sentence: role title + domain alignment. Second sentence: methodological strengths + tools.",
  "experience": [
    {
      "title": "Role Title",
      "company": "Company Name",
      "dates": "2022–Present",
      "location": "City, State",
      "bullets": [
        "Developed reproducible analytical pipelines integrating climate, energy, and environmental datasets for scenario evaluation and trend analysis",
        "Conducted Scope 1–3 GHG accounting exercises including emission-factor calculations, SBTi target-setting, and ISO 14040 LCA case studies",
        "Built QA/QC and validation workflows across heterogeneous datasets using Python, R, and SQL to ensure defensible analytical outputs"
      ]
    }
  ],
  "education": [
    {
      "degree": "Ph.D. in Ecology",
      "school": "Exact University Name",
      "year": "2019"
    }
  ],
  "projects": [],
  "skills": {
    "Programming & Data": ["Python", "R", "SQL", "Power BI"],
    "Spatial & Modeling": ["GIS", "Scenario Modeling", "Time-Series Analysis"],
    "Domain Expertise": ["Corporate Carbon Accounting (Scope 1–3)", "LCA", "SBTi"]
  },
  "ats_keywords": ["keyword1", "keyword2"]
}"""

COVER_LETTER_SYSTEM = """You are a senior career coach who writes cover letters that get interviews at competitive organizations. Write a deeply personalized, compelling cover letter that fits on ONE PAGE (~280–320 words total). Every sentence must earn its place — no filler, no fluff.

STRUCTURE (4 tight paragraphs):

1. OPENING + HOOK (3 sentences total):
   - Sentence 1: Confident, specific statement of intent — name the exact job title and organization. Do NOT use "I am writing to apply for." Use an active, assertive opener: "I am applying for the [Job Title] role at [Org] because...", or "The [Job Title] position in [Org] aligns directly with...", or "Few candidates for the [Job Title] role at [Org] bring both X and Y — I am one of them."
   - Sentences 2–3: The strongest alignment between candidate's background and the role's core requirement. Reference a specific achievement, technology, or credential. No generic claims.

2. EVIDENCE (3 sentences): Describe the candidate's single most relevant achievement. Include specific technologies, scale/scope, and a measurable outcome. Connect it directly to a requirement in the job description.

3. ALIGNMENT (2 sentences): Explain what draws the candidate specifically to this organization — its mission, its approach, or its impact. Show how the candidate's values or career goals align with the employer's work.

4. CLOSING (2 sentences): Confident call to action. Express enthusiasm and availability.

RULES:
- ~300–340 words total — strictly one page when printed
- Write in FIRST PERSON ("I", "my", "me") — NEVER third person ("he/she", the candidate's name)
- Use the exact job title from the job description — never substitute a generic label
- If the candidate holds a doctorate (Ph.D.), reference it by its actual field (e.g., "Ph.D. in Environmental Science") not as a generic "PhD-holding X"
- Use the candidate's actual companies and achievements — never generic placeholders
- Vary sentence structure; avoid repetitive openings ("I have", "I am", "My experience")
- Every sentence must be specific: no vague claims like "I am passionate about" or "I bring strong skills"
- Professional but human tone — not stiff or bureaucratic
- Output plain text only, no markdown, no headers
- CRITICAL: Output ONLY the final cover letter. No planning, no analysis, no reasoning, no word counts, no paragraph labels, no internal notes. Start directly with the first sentence of the letter and end with "Sincerely," followed by the candidate's name. Nothing before or after."""


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
        f"Output the JSON now. Begin your response immediately with {{ and end with }}. No reasoning, no explanation, no preamble — only the JSON object:"
    )

    # Large reasoning models (nemotron-ultra) output planning prose before JSON and run out of tokens.
    # On failure, retry with a smaller instruction-following model.
    fallback_model = None
    if resolved_provider == "nvidia" and "ultra" in resolved_model:
        fallback_model = "nvidia/llama-3.1-nemotron-70b-instruct"

    models_to_try = [resolved_model] + ([fallback_model] if fallback_model else [])
    last_err: Exception = RuntimeError("Unknown error")
    for try_model in models_to_try:
        try:
            raw = await _call_provider(resolved_provider, try_model, TAILOR_RESUME_SYSTEM, user_msg, resolved_key, max_tokens=3500)
            stripped = _strip_json(raw)
            if not stripped or not stripped.startswith("{"):
                raise RuntimeError(
                    f"Model ({try_model}) returned no parseable JSON. "
                    f"Response starts with: {raw[:120]!r}"
                )
            return json.loads(stripped)
        except (json.JSONDecodeError, RuntimeError) as e:
            last_err = e

    raise ValueError(
        f"Resume generation failed: {last_err}. Try switching to a different AI provider."
    )


def _extract_cover_letter(raw: str) -> str:
    """Strip model reasoning/planning that leaks before the actual letter."""
    lines = raw.strip().splitlines()
    # Find the first line that looks like the start of a real letter paragraph
    # (starts with "Dear", "My ", "I ", or a capital letter after a blank line)
    letter_start = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(("Dear ", "My ", "I ", "As a", "As an", "With my", "With a")):
            letter_start = i
            break
        # If we hit "Sincerely" near top, something is wrong — return raw
    # Cut off anything after a second "Sincerely" (duplicate closings)
    result = "\n".join(lines[letter_start:])
    # Truncate at the closing signature
    for closing in ["Sincerely,", "Best regards,", "Warm regards,"]:
        idx = result.find(closing)
        if idx != -1:
            # Keep everything up to and including the name after closing
            end = result.find("\n", idx + len(closing) + 1)
            if end == -1:
                end = len(result)
            result = result[:end].strip()
            break
    return result


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
    user_msg = (
        f"Job Title: {job_title}\nCompany: {company}\n\n"
        f"Job Description:\n{job_description[:4000]}\n\n"
        f"Resume:\n{resume_text[:3500]}\n\n"
        f"Write the cover letter now. Begin immediately with the first sentence — no preamble, no planning, no notes:"
    )
    last_err: Exception = RuntimeError("Unknown error")
    for attempt in range(2):
        try:
            raw = await _call_provider(resolved_provider, resolved_model, COVER_LETTER_SYSTEM, user_msg, resolved_key, max_tokens=1000)
            result = _extract_cover_letter(raw)
            if result.strip():
                return result
            raise RuntimeError("Cover letter extraction returned empty — model may have returned unusable content.")
        except RuntimeError as e:
            last_err = e
            if attempt == 1:
                raise ValueError(
                    f"Cover letter generation failed after 2 attempts: {e}. "
                    "Try again or switch to a different AI provider."
                ) from e
    raise last_err


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
