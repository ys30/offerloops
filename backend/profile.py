"""User profile — resume storage, file parsing, LinkedIn import."""

import io
import os
import re
from datetime import datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from .database import ProfileRow


def get_profile(db: Session, user_id: str = "default") -> Optional[ProfileRow]:
    return db.get(ProfileRow, user_id)


def upsert_profile(db: Session, user_id: str = "default", **fields) -> ProfileRow:
    row = db.get(ProfileRow, user_id)
    if not row:
        row = ProfileRow(id=user_id, created_at=datetime.utcnow())
        db.add(row)
    for k, v in fields.items():
        if v is not None:
            setattr(row, k, v)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def parse_pdf(data: bytes) -> str:
    """Extract text from PDF using word-level extraction to handle multi-column layouts."""
    import pdfplumber

    text_parts = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            # Use word-level extraction: preserves spacing in complex layouts
            words = page.extract_words(
                x_tolerance=3,
                y_tolerance=3,
                keep_blank_chars=False,
                use_text_flow=True,         # follow reading order
                extra_attrs=["fontname", "size"],
            )
            if words:
                # Group words into lines by vertical position (bucket within 4 units)
                lines: dict[int, list] = {}
                for w in words:
                    y_key = round(float(w.get("top", 0)) / 4) * 4
                    lines.setdefault(y_key, []).append(w)

                for y_key in sorted(lines.keys()):
                    line_words = sorted(lines[y_key], key=lambda w: float(w.get("x0", 0)))
                    text_parts.append(" ".join(w["text"] for w in line_words))
            else:
                # Fallback to plain text extraction
                t = page.extract_text()
                if t:
                    text_parts.append(t)

    raw = "\n".join(text_parts)

    # Detect garbled text (no spaces between words longer than 20 chars)
    long_words = [w for w in raw.split() if len(w) > 20 and w.isalpha()]
    if len(long_words) > 5:
        raw = _fix_concatenated_words(raw)

    return raw.strip()


def _fix_concatenated_words(text: str) -> str:
    """Insert spaces before capital letters in CamelCase runs (last resort for garbled PDFs)."""
    # Add space before uppercase letters that follow lowercase letters
    fixed = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    # Add space before digits following letters
    fixed = re.sub(r"([a-zA-Z])(\d)", r"\1 \2", fixed)
    fixed = re.sub(r"(\d)([a-zA-Z])", r"\1 \2", fixed)
    return fixed


def parse_docx(data: bytes) -> str:
    """Extract text from DOCX, including tables and text boxes."""
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(io.BytesIO(data))
    parts = []

    # Main paragraphs
    for para in doc.paragraphs:
        t = para.text.strip()
        if t:
            parts.append(t)

    # Tables (often used for resume layouts)
    for table in doc.tables:
        for row in table.rows:
            row_texts = []
            for cell in row.cells:
                ct = cell.text.strip()
                if ct and ct not in row_texts:
                    row_texts.append(ct)
            if row_texts:
                parts.append("  |  ".join(row_texts))

    # Text boxes / drawing canvas (some resumes use these for sidebars)
    try:
        body = doc.element.body
        for txbx in body.iter(qn("w:txbxContent")):
            for para in txbx.iter(qn("w:p")):
                texts = [n.text for n in para.iter(qn("w:t")) if n.text]
                t = "".join(texts).strip()
                if t and t not in parts:
                    parts.append(t)
    except Exception:
        pass

    return "\n".join(parts)


async def clean_resume_with_ai(raw_text: str) -> str:
    """Use AI to fix garbled resume text (missing spaces, broken formatting)."""
    try:
        from .ai import _pick_provider, _call_provider, PROVIDERS
        provider, key = _pick_provider("nvidia", None)
        model = PROVIDERS[provider]["default_model"]
        system = (
            "You receive garbled resume text extracted from a PDF where spaces between words are missing. "
            "Your job: add correct spaces, fix formatting, and return clean readable resume text. "
            "Keep all content exactly — only fix spacing and line breaks. Output plain text only."
        )
        fixed = await _call_provider(provider, model, system, raw_text[:4000], key)
        return fixed.strip()
    except Exception:
        return raw_text  # return original if AI unavailable


async def import_linkedin(url: str) -> str:
    """Fetch public LinkedIn profile page and extract text."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code in (999, 403, 429):
            raise ValueError(
                "LinkedIn blocked direct scraping. "
                "Export your profile instead: LinkedIn → Me → Settings → Data Privacy "
                "→ Get a copy of your data, then upload the PDF."
            )
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

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

    return "\n\n".join(sections)[:4000]
