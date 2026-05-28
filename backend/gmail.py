"""Gmail OAuth, email sync, and rule-based application status parser."""
import re
from datetime import datetime, timedelta
from email.utils import parseaddr, parsedate_to_datetime
from typing import Optional

import httpx

# ── ATS sender domains ───────────────────────────────────────────────────────

ATS_DOMAINS = {
    "greenhouse.io", "lever.co", "ashbyhq.com", "myworkday.com",
    "smartrecruiters.com", "taleo.net", "icims.com", "jobvite.com",
    "workable.com", "bamboohr.com", "successfactors.com", "linkedin.com",
    "breezy.hr", "recruitee.com", "dover.com", "rippling.com",
    "rippling-corp.com", "applicantpro.com", "jazz.co", "jobscore.com",
    "pinpoint.com", "eightfold.ai", "beamery.com", "phenom.com",
}

# ── Rule-based classifier ────────────────────────────────────────────────────
# Order matters — check more specific stages first

STATUS_RULES: list[tuple[list[str], str]] = [
    (["offer letter", "pleased to extend an offer", "pleased to offer",
      "compensation package", "base salary", "sign.*offer",
      "start date.*monday", "join our team"], "offer"),

    (["unfortunately", "not moving forward", "other candidates",
      "not selected", "regret to inform", "decided not to",
      "pursuing other", "won't be moving", "will not be moving",
      "no longer considering", "position has been filled",
      "we have decided to", "we've decided to"], "rejected"),

    (["onsite", "on-site", "final round", "panel interview",
      "technical interview", "coding interview", "system design",
      "loop interview", "schedule.*interview", "interview.*schedule",
      "meet with.*team", "meet the team", "virtual interview",
      "video interview", "case study interview"], "interview"),

    (["phone screen", "recruiter call", "intro call", "initial screen",
      "brief call", "chat.*recruiter", "recruiter.*chat",
      r"30[\s-]minute", r"15[\s-]minute", "quick call",
      "hiring manager.*call", "talent acquisition", "initial conversation"], "phone_screen"),

    (["thank you for applying", "application received",
      "we received your application", "successfully submitted",
      "application.*submitted", "applied.*successfully",
      "thank you for your interest", "application is under review",
      "application.*review", "reviewing your application",
      "we will be in touch", "we'll be in touch"], "applied"),
]

# Pipeline order for "don't downgrade" logic
PIPELINE_ORDER = ["new", "interested", "applied", "phone_screen", "interview", "offer", "rejected", "withdrawn"]


def pipeline_rank(status: str) -> int:
    try:
        return PIPELINE_ORDER.index(status)
    except ValueError:
        return -1


def classify_email(subject: str, snippet: str) -> Optional[str]:
    """Return detected application status or None."""
    text = (subject + " " + snippet).lower()
    for patterns, status in STATUS_RULES:
        for p in patterns:
            if re.search(p, text):
                return status
    return None


def extract_domain(sender: str) -> str:
    _, addr = parseaddr(sender)
    return addr.split("@")[-1].lower() if "@" in addr else ""


def is_job_related(sender: str, subject: str, snippet: str) -> bool:
    """True if email looks like a job application email."""
    domain = extract_domain(sender)
    if any(domain == d or domain.endswith("." + d) for d in ATS_DOMAINS):
        return True
    text = (subject + " " + snippet).lower()
    keywords = ["application", "applying", "interview", "offer", "recruiter",
                 "hiring", "position", "candidate", "opportunity", "role"]
    return sum(1 for kw in keywords if kw in text) >= 2


def guess_company_from_subject(subject: str) -> Optional[str]:
    """Extract company name from common ATS subject patterns."""
    patterns = [
        r"your application (?:to|at|with) ([A-Za-z0-9][A-Za-z0-9 &,.\-']+?)(?:\s+for|\s+–|\s+-|\s*$)",
        r"application (?:to|at|with) ([A-Za-z0-9][A-Za-z0-9 &,.\-']+?)(?:\s+for|\s+–|\s+-|\s*$)",
        r"(?:from|at|with) ([A-Za-z0-9][A-Za-z0-9 &,.\-']+?) (?:recruiting|talent|careers|hiring)",
        r"interview (?:with|at) ([A-Za-z0-9][A-Za-z0-9 &,.\-']+?)(?:\s+for|\s+–|\s+-|\s*$)",
        r"offer from ([A-Za-z0-9][A-Za-z0-9 &,.\-']+?)(?:\s+for|\s+–|\s+-|\s*$)",
    ]
    for pat in patterns:
        m = re.search(pat, subject, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def guess_role_from_subject(subject: str) -> Optional[str]:
    """Extract role from common ATS subject patterns."""
    patterns = [
        r"for (?:the )?([A-Za-z0-9][A-Za-z0-9 &,.\-']+?) (?:position|role|opportunity)",
        r"(?:position|role): ([A-Za-z0-9][A-Za-z0-9 &,.\-']+)",
        r"application for ([A-Za-z0-9][A-Za-z0-9 &,.\-']+)",
    ]
    for pat in patterns:
        m = re.search(pat, subject, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


# ── Gmail OAuth helpers ──────────────────────────────────────────────────────

GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"


def build_auth_url(client_id: str, redirect_uri: str) -> str:
    import urllib.parse
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": f"openid email {GMAIL_SCOPE}",
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{AUTH_BASE}?{urllib.parse.urlencode(params)}"


async def exchange_code(code: str, client_id: str, client_secret: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient() as c:
        r = await c.post(TOKEN_URL, data={
            "code": code, "client_id": client_id, "client_secret": client_secret,
            "redirect_uri": redirect_uri, "grant_type": "authorization_code",
        })
        r.raise_for_status()
        return r.json()


async def refresh_token(refresh: str, client_id: str, client_secret: str) -> dict:
    async with httpx.AsyncClient() as c:
        r = await c.post(TOKEN_URL, data={
            "refresh_token": refresh, "client_id": client_id,
            "client_secret": client_secret, "grant_type": "refresh_token",
        })
        r.raise_for_status()
        return r.json()


# ── Gmail API calls ──────────────────────────────────────────────────────────

async def get_access_token(db, user_id: str) -> tuple[Optional[str], Optional[str]]:
    """Return (access_token, error). Refreshes if needed."""
    from .database import GmailTokenRow
    import os
    row = db.query(GmailTokenRow).filter(GmailTokenRow.user_id == user_id).first()
    if not row or not row.refresh_token:
        return None, "Gmail not connected — please reconnect in Profile."
    if row.expires_at and row.expires_at > datetime.utcnow() + timedelta(minutes=2):
        return row.access_token, None
    # Refresh
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        return None, "Google OAuth credentials not configured on the server."
    try:
        data = await refresh_token(row.refresh_token, client_id, client_secret)
    except httpx.HTTPStatusError as e:
        body = e.response.text
        if "invalid_grant" in body or e.response.status_code == 400:
            # Token revoked or expired — user must reconnect
            row.refresh_token = None
            row.access_token = None
            db.commit()
            return None, "Gmail session expired — please reconnect Gmail in Profile."
        return None, f"Token refresh failed ({e.response.status_code}): {body[:200]}"
    except Exception as e:
        return None, f"Token refresh error: {e}"
    row.access_token = data["access_token"]
    row.expires_at = datetime.utcnow() + timedelta(seconds=data.get("expires_in", 3600))
    db.commit()
    return row.access_token, None


async def list_messages(access_token: str, days_back: int = 60, max_results: int = 200) -> list[dict]:
    after = int((datetime.utcnow() - timedelta(days=days_back)).timestamp())
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"q": f"after:{after}", "maxResults": max_results},
        )
        if r.status_code != 200:
            return []
        return r.json().get("messages", [])


async def get_message(access_token: str, msg_id: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"format": "metadata", "metadataHeaders": ["From", "Subject", "Date"]},
        )
        r.raise_for_status()
        return r.json()


def parse_header(msg: dict, name: str) -> str:
    for h in msg.get("payload", {}).get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def parse_date(date_str: str) -> Optional[datetime]:
    try:
        return parsedate_to_datetime(date_str).replace(tzinfo=None)
    except Exception:
        return None


async def sync_emails(db, user_id: str, days_back: int = 60) -> dict:
    """
    Fetch recent emails, classify, match to jobs, save events.
    Returns summary dict.
    """
    from .database import EmailEventRow, JobRow

    access_token, token_err = await get_access_token(db, user_id)
    if not access_token:
        return {"error": token_err or "Gmail not connected"}

    messages = await list_messages(access_token, days_back=days_back)
    new_events = 0
    updated_jobs = 0
    errors = 0

    # Prefetch existing gmail_message_ids to skip duplicates
    existing_ids = {
        row.gmail_message_id
        for row in db.query(EmailEventRow.gmail_message_id)
        .filter(EmailEventRow.user_id == user_id).all()
    }

    # Load user's jobs for matching (company → job)
    jobs = db.query(JobRow).all()

    for msg_stub in messages:
        msg_id = msg_stub["id"]
        if msg_id in existing_ids:
            continue
        try:
            msg = await get_message(access_token, msg_id)
        except Exception:
            errors += 1
            continue

        sender = parse_header(msg, "From")
        subject = parse_header(msg, "Subject")
        snippet = msg.get("snippet", "")
        email_date = parse_date(parse_header(msg, "Date"))

        if not is_job_related(sender, subject, snippet):
            continue

        detected_status = classify_email(subject, snippet)
        company_guess = guess_company_from_subject(subject)
        role_guess = guess_role_from_subject(subject)

        # Try to match a job
        matched_job: Optional[JobRow] = None
        if company_guess:
            cg_lower = company_guess.lower()
            for job in jobs:
                if cg_lower in job.company.lower() or job.company.lower() in cg_lower:
                    matched_job = job
                    break

        # Save event
        import uuid
        event = EmailEventRow(
            id=str(uuid.uuid4()),
            user_id=user_id,
            job_id=matched_job.id if matched_job else None,
            gmail_message_id=msg_id,
            sender=sender,
            subject=subject,
            snippet=snippet[:300],
            detected_status=detected_status,
            company_guess=company_guess,
            role_guess=role_guess,
            email_date=email_date or datetime.utcnow(),
        )
        db.add(event)
        new_events += 1

        # Auto-update job status if we have a match and a detected status
        if matched_job and detected_status:
            current_rank = pipeline_rank(matched_job.status or "new")
            new_rank = pipeline_rank(detected_status)
            if new_rank > current_rank:
                matched_job.status = detected_status
                if detected_status == "applied" and not matched_job.applied_date:
                    matched_job.applied_date = email_date
                matched_job.updated_at = datetime.utcnow()
                updated_jobs += 1

    db.commit()
    return {"scanned": len(messages), "new_events": new_events, "jobs_updated": updated_jobs, "errors": errors}
