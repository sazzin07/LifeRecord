"""Per-user limits on the endpoints that cost model quota or fill the disk (S-04).

Sign-in has had its own limiter since the security batch (`check_rate_limit` in server.py, per address + email). The
assistant, voice, receipt and upload endpoints had none, so one script or one bug could burn the model quota or fill
the storage folder. These limits are per signed-in user, over a minute and over a day, kept in the same
`rate_limit_events` table (so they survive restarts and are shared by every server process). The table holds only a
hash of "user:<id>:<scope>" and a timestamp.

Defaults can be changed with LIMIT_<SCOPE>_PER_MINUTE / LIMIT_<SCOPE>_PER_DAY (for example LIMIT_AI_CHAT_PER_DAY=500);
an unreadable value falls back to the default rather than switching the limit off. One assistant message can make up
to 7 model calls, so 300 messages a day is at most ~2,100 calls.

The check is a count followed by an insert, not a lock: two requests arriving in the same instant can both pass, so
a limit can be exceeded by the number of simultaneous requests. That is acceptable for a cost guard.
"""
import hashlib
import math
import os
import secrets
from datetime import datetime, timezone
from typing import Tuple

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import RateLimitEvent

MINUTE_MS = 60_000
DAY_MS = 86_400_000
RETENTION_MS = DAY_MS + 3_600_000  # a day plus an hour: nothing a day-long window still needs is ever deleted

# scope -> (per minute, per day, what it counts, in the wording of the refusal)
DEFAULTS = {
    "ai_chat": (20, 300, "assistant messages"),
    "ai_transcribe": (10, 100, "voice messages"),
    "ai_receipt": (10, 50, "receipt scans"),
    "photo_upload": (20, 100, "photo uploads"),
    "account_export": (3, 10, "data exports"),  # builds a .zip of everything, pictures included
}


def _from_env(name: str, fallback: int) -> int:
    try:
        value = int(os.environ[name])
        return value if value > 0 else fallback
    except (KeyError, ValueError):
        return fallback


def limit_for(scope: str) -> Tuple[int, int]:
    per_minute, per_day, _ = DEFAULTS[scope]
    return (_from_env(f"LIMIT_{scope.upper()}_PER_MINUTE", per_minute),
            _from_env(f"LIMIT_{scope.upper()}_PER_DAY", per_day))


def _bucket(user_id: str, scope: str) -> str:
    return hashlib.sha256(f"user:{user_id}:{scope}".encode()).hexdigest()


async def prune_old_events(db: AsyncSession, now_ms: int) -> None:
    """Delete events nobody can still need. Used by both limiters, so neither erases the other's window."""
    await db.execute(delete(RateLimitEvent).where(RateLimitEvent.at_ms < now_ms - RETENTION_MS))


def _wait_text(seconds: int) -> str:
    if seconds < 90:
        return f"{seconds} seconds"
    if seconds < 5400:
        return f"{math.ceil(seconds / 60)} minutes"
    return f"about {math.ceil(seconds / 3600)} hours"


def _refuse(message: str, retry_after: int) -> HTTPException:
    return HTTPException(status_code=429, detail=message, headers={"Retry-After": str(max(1, retry_after))})


async def check_user_limit(user_id: str, scope: str) -> None:
    """Count one use of `scope` for this user, or raise a 429 that says what was reached and when to try again."""
    what = DEFAULTS[scope][2]
    per_minute, per_day = limit_for(scope)
    bucket = _bucket(user_id, scope)
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    async with AsyncSessionLocal() as db:
        stamps = (await db.execute(
            select(RateLimitEvent.at_ms).where(RateLimitEvent.bucket == bucket, RateLimitEvent.at_ms > now_ms - DAY_MS)
            .order_by(RateLimitEvent.at_ms)
        )).scalars().all()
        if len(stamps) >= per_day:
            wait = math.ceil((stamps[len(stamps) - per_day] + DAY_MS - now_ms) / 1000)
            raise _refuse(f"You have reached today's limit of {per_day} {what}. Try again in {_wait_text(wait)}.", wait)
        recent = [t for t in stamps if t > now_ms - MINUTE_MS]
        if len(recent) >= per_minute:
            wait = math.ceil((recent[len(recent) - per_minute] + MINUTE_MS - now_ms) / 1000)
            raise _refuse(f"That is too many {what} in a minute (the limit is {per_minute}). Try again in {_wait_text(wait)}.", wait)
        db.add(RateLimitEvent(bucket=bucket, at_ms=now_ms))
        if secrets.randbelow(50) == 0:
            await prune_old_events(db, now_ms)
        await db.commit()
