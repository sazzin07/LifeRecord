"""Time-based one-time passwords (RFC 6238) for the optional second step at sign-in, and the one-time recovery codes that go with it.

An authenticator app and the server share a secret. Every 30 seconds both compute the same six digits from it and the clock,
so a stolen password alone no longer opens the account.

- The secret is stored ENCRYPTED (Fernet, key UPLOAD_ENCRYPTION_KEY, the same durable key that protects uploads; keep a copy of it).
  With no key nothing is stored in the clear: setting up the second step is refused instead.
- A code is accepted once: the step it belongs to is remembered and a step at or before it is never accepted again, so a code
  seen over someone's shoulder is worth nothing a second later.
- Recovery codes (for a lost phone) are shown once, stored only as keyed hashes under the same key, and each works once.
"""
import base64
import hashlib
import hmac
import os
import re
import secrets
import struct
import time
from typing import List, Optional
from urllib.parse import quote

from cryptography.fernet import Fernet, InvalidToken

STEP_SECONDS = 30
DIGITS = 6
RECOVERY_CODE_COUNT = 8
_RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o/1/i/l: they get misread when written down


class TotpUnavailable(RuntimeError):
    """The server has no encryption key, so a second-step secret cannot be stored safely."""


def new_secret() -> str:
    """20 random bytes (160 bits) as base32, the form every authenticator app accepts."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def code_at(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** DIGITS)
    return f"{number:0{DIGITS}d}"


def verify(secret: str, code: Optional[str], now: Optional[float] = None, last_step: int = 0, window: int = 1) -> Optional[int]:
    """The step the code belongs to if it is valid now, else None. Valid means: six digits, from the current step or `window`
    steps either side (clocks drift), and later than `last_step` (a code is used once)."""
    if not isinstance(code, str) or not re.fullmatch(r"\d{6}", code):
        return None
    current = int((time.time() if now is None else now) // STEP_SECONDS)
    for step in (current, current - 1, current + 1)[: 2 * window + 1]:
        if step > last_step and hmac.compare_digest(code_at(secret, step), code):
            return step
    return None


def otpauth_uri(secret: str, account: str, issuer: str = "Life Record") -> str:
    label = f"{quote(issuer)}:{quote(account, safe='')}"
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"


# -- keeping secrets -------------------------------------------------------------------------------------------------------

def _key() -> bytes:
    key = os.environ.get("UPLOAD_ENCRYPTION_KEY", "").strip()
    if not key:
        raise TotpUnavailable("Two-step sign-in needs the server's encryption key (UPLOAD_ENCRYPTION_KEY) to keep its secrets safe.")
    return key.encode()


def encrypt_secret(secret: str) -> str:
    return Fernet(_key()).encrypt(secret.encode()).decode()


def decrypt_secret(stored: str) -> str:
    try:
        return Fernet(_key()).decrypt(stored.encode()).decode()
    except InvalidToken as exc:
        raise TotpUnavailable("A stored second-step secret cannot be read with the server's current encryption key.") from exc


def new_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> List[str]:
    codes: set = set()
    while len(codes) < count:
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(10))
        codes.add(f"{raw[:5]}-{raw[5:]}")
    return sorted(codes, key=lambda _: secrets.randbelow(1 << 30))


def normalise_recovery_code(code: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (code or "").lower())


def recovery_hash(user_id: str, code: str) -> str:
    """What is stored of a recovery code: a keyed hash that belongs to one account. Not a plain hash: a code has ~50 bits, which an
    offline attack on a copy of the table could otherwise search."""
    return hmac.new(_key(), f"recovery:{user_id}:{normalise_recovery_code(code)}".encode(), hashlib.sha256).hexdigest()
