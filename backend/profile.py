"""User profile — resume storage, file parsing, LinkedIn import."""

import io
import os
from datetime import datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from .database import ProfileRow


def get_profile(db: Session) -> Optional[ProfileRow]:
    return db.query(ProfileRow).order_by(ProfileRow.updated_at.desc()).first()


def upsert_profile(db: Session, **fields) -> ProfileRow:
    row = db.query(ProfileRow).first()
    if not row:
        row = ProfileRow(id="default", created_at=datetime.utcnow())
        db.add(row)
    for k, v in fields.items():
        if v is not None:
            setattr(row, k, v)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def parse_pdf(data: bytes) -> str:
    import pdfplumber
    text_parts = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text_parts.append(t)
    return "\n".join(text_parts)


def parse_docx(data: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


async def import_linkedin(url: str) -> str:
    """Fetch public LinkedIn profile page and extract text."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code == 999 or resp.status_code == 403:
            raise ValueError(
                "LinkedIn blocked direct scraping. "
                "Please export your profile: LinkedIn → Me → Settings → Data Privacy → Get a copy of your data, "
                "then upload the PDF/TXT instead."
            )
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    # Remove nav, footer, scripts
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    # Try to get main profile content
    sections = []
    for sel in ["main", ".core-section-container", ".profile-section", "article"]:
        found = soup.select(sel)
        if found:
            for f in found[:5]:
                t = f.get_text(separator="\n", strip=True)
                if len(t) > 100:
                    sections.append(t)
            break

    if not sections:
        sections = [soup.get_text(separator="\n", strip=True)]

    raw = "\n\n".join(sections)
    # Trim to first 4000 chars of relevant content
    return raw[:4000]
