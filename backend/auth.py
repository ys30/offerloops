"""Auth utilities — password hashing, JWT creation/verification."""

import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

import bcrypt as _bcrypt
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .database import UserRow

SECRET_KEY = os.environ.get("JWT_SECRET", "offerloops-dev-secret-change-in-prod")
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(days=TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": user_id, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def get_user_by_email(db: Session, email: str) -> Optional[UserRow]:
    return db.query(UserRow).filter(UserRow.email == email.lower()).first()


def get_user_by_id(db: Session, user_id: str) -> Optional[UserRow]:
    return db.get(UserRow, user_id)


def create_user(db: Session, email: str, password: str, name: str = "", phone: str = "", location: str = "") -> UserRow:
    row = UserRow(
        id=str(uuid.uuid4()),
        email=email.lower(),
        password_hash=hash_password(password),
        name=name,
        phone=phone,
        location=location,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def upsert_oauth_user(
    db: Session,
    email: str,
    provider: str,
    sub: str,
    name: str = "",
    avatar_url: str = "",
) -> UserRow:
    """Find or create a user via OAuth. Merges with existing email account."""
    user = get_user_by_email(db, email)
    if user:
        user.oauth_provider = user.oauth_provider or provider
        user.oauth_sub = user.oauth_sub or sub
        user.avatar_url = user.avatar_url or avatar_url
        if name and not user.name:
            user.name = name
        user.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(user)
        return user
    user = UserRow(
        id=str(uuid.uuid4()),
        email=email.lower(),
        password_hash=None,
        name=name,
        oauth_provider=provider,
        oauth_sub=sub,
        avatar_url=avatar_url,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_reset_token(db: Session, user: UserRow) -> str:
    token = str(uuid.uuid4()).replace("-", "")
    user.reset_token = token
    user.reset_expires = datetime.utcnow() + timedelta(hours=1)
    db.commit()
    return token


def consume_reset_token(db: Session, token: str) -> Optional[UserRow]:
    """Return the user if the token is valid and not expired, else None."""
    user = db.query(UserRow).filter(UserRow.reset_token == token).first()
    if not user:
        return None
    if not user.reset_expires or user.reset_expires < datetime.utcnow():
        return None
    return user


def apply_new_password(db: Session, user: UserRow, new_password: str) -> None:
    user.password_hash = hash_password(new_password)
    user.reset_token = None
    user.reset_expires = None
    user.updated_at = datetime.utcnow()
    db.commit()


def send_reset_email(to_email: str, reset_url: str) -> bool:
    """Send reset email via SMTP. Returns True on success, False if SMTP not configured."""
    import smtplib
    from email.mime.text import MIMEText

    host = os.environ.get("SMTP_HOST", "")
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", "")
    password = os.environ.get("SMTP_PASS", "")
    from_addr = os.environ.get("SMTP_FROM", user)

    if not host or not user:
        print(f"\n[OfferLoops] Password reset link (no SMTP configured):\n{reset_url}\n")
        return False

    body = f"""Hi,

You requested a password reset for your OfferLoops account.

Click the link below to set a new password (expires in 1 hour):

{reset_url}

If you didn't request this, you can safely ignore this email.

— OfferLoops
"""
    msg = MIMEText(body)
    msg["Subject"] = "OfferLoops — Reset your password"
    msg["From"] = from_addr
    msg["To"] = to_email

    with smtplib.SMTP(host, port) as server:
        server.starttls()
        server.login(user, password)
        server.sendmail(from_addr, [to_email], msg.as_string())
    return True


def update_user(db: Session, user: UserRow, **fields) -> UserRow:
    for k, v in fields.items():
        if v is not None:
            setattr(user, k, v)
    user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user
