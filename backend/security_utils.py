import hashlib
import os
import secrets
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
import bcrypt

import common_passwords
import verification_codes

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
JWT_SECRET = os.environ['JWT_SECRET']
MIN_SECRET_LENGTH = 32
if len(JWT_SECRET) < MIN_SECRET_LENGTH:
    # Every token is only as hard to forge as this value is to guess; a placeholder or a short word would sign valid sessions.
    raise RuntimeError(f"JWT_SECRET must be at least {MIN_SECRET_LENGTH} characters (python backend/local_secrets.py rotate-jwt makes a good one).")
JWT_ALG = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
BCRYPT_MAX_BYTES = 72  # bcrypt reads no more than this; whatever follows would be silently ignored (or refused by newer versions)


def _bcrypt_input(password: str) -> bytes:
    return password.encode()[:BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_bcrypt_input(password), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_bcrypt_input(plain), hashed.encode())
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT tokens
# ---------------------------------------------------------------------------
def hash_token(token: str) -> str:
    """One-way fingerprint for tokens kept in the database (reset links): a leaked row cannot be replayed."""
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: str, email: str, token_version: int = 0, session_id: Optional[str] = None) -> str:
    """`tv` ties the token to the user's current token_version; bumping it ends every earlier session. `sid` names the
    server-side session (auth_sessions) the token belongs to; a token with no `sid` is only the pre-verification token."""
    payload = {
        "sub": user_id,
        "email": email,
        "tv": token_version,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def create_refresh_token(user_id: str, token_version: int = 0, session_id: Optional[str] = None,
                         expires_at: Optional[datetime] = None, generation: Optional[str] = None) -> str:
    """`generation` (claim `jti`) names which refresh token of the session this is: a refresh token is used once, and the
    server remembers the current one (auth_sessions.rotate)."""
    payload = {
        "sub": user_id,
        "tv": token_version,
        "type": "refresh",
        "exp": expires_at or datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    if session_id:
        payload["sid"] = session_id
    if generation:
        payload["jti"] = generation
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def create_email_verification_token(user_id: str) -> str:
    """Short-lived token for email verification (used in password-reset links)."""
    payload = {
        "sub": user_id,
        "type": "email_verify",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


DEVICE_TOKEN_DAYS = 180


def create_device_token(user_id: str) -> str:
    """Given to a browser that has signed in to the account, to say "this one is familiar". It carries no permission at all:
    the only thing it changes is that this browser is not held up by a lockout that strangers' guessing set off."""
    payload = {
        "sub": user_id,
        "type": "device",
        "exp": datetime.now(timezone.utc) + timedelta(days=DEVICE_TOKEN_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def create_password_reset_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "type": "password_reset",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str, token_type: Optional[str] = None, allow_expired: bool = False) -> dict:
    """`allow_expired` still checks the signature; it is only for signing out, where an old token must be able to name its session."""
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG], options={"verify_exp": False} if allow_expired else {})
    if token_type and payload.get("type") != token_type:
        raise jwt.InvalidTokenError("Invalid token type")
    return payload


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def is_valid_email(email: str) -> bool:
    return bool(EMAIL_REGEX.match(email.strip()))


WEAK_PASSWORD_MESSAGE = "Password must be at least 8 characters with a letter and a number"
TOO_LONG_PASSWORD_MESSAGE = (f"Password must be at most {BCRYPT_MAX_BYTES} bytes long (about {BCRYPT_MAX_BYTES} letters and digits; "
                             "accented letters and emoji take more than one byte each)")


TOO_EASY_PASSWORD_MESSAGE = "That password is too easy to guess (a common word, or part of your email address). Choose another."


def password_problem(password: str, email: Optional[str] = None) -> Optional[str]:
    """Why a new password is refused, in words for the person, or None when it is fine: at least 8 characters with a letter
    and a digit, no longer than bcrypt can use (a longer one would be cut short without telling anyone), and not one of the
    words every guessing attack starts with, nor the person's own address (common_passwords.py)."""
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return WEAK_PASSWORD_MESSAGE
    if len(password.encode()) > BCRYPT_MAX_BYTES:
        return TOO_LONG_PASSWORD_MESSAGE
    if common_passwords.is_common(password):
        return TOO_EASY_PASSWORD_MESSAGE
    local = (email or "").split("@")[0].lower()
    if len(local) >= 4 and local in password.lower():
        return TOO_EASY_PASSWORD_MESSAGE
    return None


def is_strong_password(password: str) -> bool:
    return password_problem(password) is None


# ---------------------------------------------------------------------------
# Secure random codes
# ---------------------------------------------------------------------------
def generate_six_digit_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def code_fingerprint(user_id: str, code: str) -> str:
    """What is stored for an emailed code (see verification_codes)."""
    return verification_codes.fingerprint(JWT_SECRET, user_id, code)


def code_matches(stored: Optional[str], user_id: str, code: str) -> bool:
    return verification_codes.matches(stored or "", JWT_SECRET, user_id, code)


def generate_secure_token(length: int = 32) -> str:
    return secrets.token_urlsafe(length)
