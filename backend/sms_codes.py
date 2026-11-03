"""The six-digit codes sent by text message: made, kept as keyed hashes, spent once.

Like the emailed verification codes (verification_codes.py) the code itself is never stored, only an HMAC under the signing secret
and the user id, so a copy of the table holds nothing that can be typed in. A code lives 5 minutes and gets 5 tries; the try is
taken by one conditional UPDATE, so simultaneous guesses cannot exceed it, and spending a correct code is one conditional DELETE,
so two requests carrying it cannot both succeed. A new send replaces the old code.
"""
import hashlib
import hmac
import secrets
import time

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import SmsCode
from security_utils import JWT_SECRET

CODE_SECONDS = 300
MAX_TRIES = 5
RESEND_GAP_SECONDS = 60


def new_code() -> str:
    return f"{secrets.randbelow(10 ** 6):06d}"


def fingerprint(user_id: str, code: str) -> str:
    return hmac.new(JWT_SECRET.encode(), f"sms:{user_id}:{code}".encode(), hashlib.sha256).hexdigest()


def _now() -> int:
    return int(time.time() * 1000)


async def seconds_until_resend(db: AsyncSession, user_id: str) -> int:
    """0 when a new code may be sent, else how long to wait."""
    sent = (await db.execute(select(SmsCode.sent_ms).where(SmsCode.user_id == user_id))).scalar_one_or_none()
    if sent is None:
        return 0
    return max(0, (sent + RESEND_GAP_SECONDS * 1000 - _now() + 999) // 1000)


async def store(db: AsyncSession, user_id: str, code: str) -> int:
    """Keep `code` as the user's current one (replacing any earlier). Returns the time it was stored, to undo it if the send fails."""
    now = _now()
    await db.execute(delete(SmsCode).where(SmsCode.user_id == user_id))
    db.add(SmsCode(user_id=user_id, code_hash=fingerprint(user_id, code), expires_ms=now + CODE_SECONDS * 1000, attempts=0, sent_ms=now))
    await db.commit()
    return now


async def discard(db: AsyncSession, user_id: str, sent_ms: int) -> None:
    """Take back a code that was stored but never sent (only if no newer code has replaced it)."""
    await db.execute(delete(SmsCode).where(SmsCode.user_id == user_id, SmsCode.sent_ms == sent_ms))
    await db.commit()


async def verify(db: AsyncSession, user_id: str, code: str) -> bool:
    """True once, for the right code, while it is fresh and has tries left."""
    code = (code or "").strip()
    took = await db.execute(update(SmsCode).where(SmsCode.user_id == user_id, SmsCode.attempts < MAX_TRIES, SmsCode.expires_ms > _now())
                            .values(attempts=SmsCode.attempts + 1))
    await db.commit()
    if took.rowcount != 1 or len(code) != 6 or not code.isdigit():
        return False
    spent = await db.execute(delete(SmsCode).where(SmsCode.user_id == user_id, SmsCode.code_hash == fingerprint(user_id, code)))
    await db.commit()
    return spent.rowcount == 1
