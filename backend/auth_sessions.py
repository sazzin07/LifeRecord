"""Server-side sessions: what makes "signed out" mean signed out.

A JWT alone stays valid until it expires, wherever a copy of it ended up. Every access and refresh token therefore names
a session row (`sid`), and the server honours the token only while that row exists and has not expired:

- signing out deletes the row, so the access token and the refresh cookie (and any copy of either) stop working at once;
- "sign out everywhere", a password change and a password reset delete every row of the user;
- every row is deleted when the server starts and when it stops, so a restart, a crash or a redeploy signs everyone out;
- one user holds at most SESSION_MAX_PER_USER sessions (default 20): past that the oldest make room for the newest;
- a deactivated account cannot start a session at all (account_status.py);
- a session lasts SESSION_IDLE_DAYS (default: the refresh-token lifetime) after its last refresh, and never longer than
  SESSION_MAX_DAYS (default 30) after sign-in; either way the user has to sign in again.

The tables with a user_id cascade on user deletion, so deleting an account removes its sessions too.
"""
import os
import time
import uuid
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

import account_status
from models import AuthSession
from security_utils import REFRESH_TOKEN_EXPIRE_DAYS

DAY_MS = 86_400_000
SESSION_ENDED = "Session ended, please sign in again"


def _days(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except ValueError:
        return default
    return value if value > 0 else default


IDLE_DAYS = _days("SESSION_IDLE_DAYS", REFRESH_TOKEN_EXPIRE_DAYS)
MAX_DAYS = _days("SESSION_MAX_DAYS", 30)
MAX_PER_USER = _days("SESSION_MAX_PER_USER", 20)  # not days: the same "positive whole number, else the default" rule


def now_ms() -> int:
    return int(time.time() * 1000)


def _expiry(created_ms: int, now: int) -> int:
    return min(now + IDLE_DAYS * DAY_MS, created_ms + MAX_DAYS * DAY_MS)


async def start(db: AsyncSession, user_id: str) -> AuthSession:
    """A new session for a user who has just proved who they are (sign-in, verification, password reset). Expired rows are
    removed on the way: they are refused anyway, but nothing else deletes them until the server restarts.

    The single place a session can begin, so it is also where a deactivated account is turned away (account_status.py)."""
    await account_status.refuse_if_deactivated(db, user_id)
    now = now_ms()
    await db.execute(delete(AuthSession).where(AuthSession.expires_ms <= now))
    row = AuthSession(id=str(uuid.uuid4()), user_id=user_id, created_ms=now, expires_ms=_expiry(now, now))
    db.add(row)
    await db.flush()
    # A person has a handful of devices, not hundreds: past MAX_PER_USER the oldest sessions make room for the newest.
    surplus = (await db.execute(
        select(AuthSession.id).where(AuthSession.user_id == user_id, AuthSession.id != row.id)
        .order_by(AuthSession.created_ms.desc(), AuthSession.id).offset(MAX_PER_USER - 1)
    )).scalars().all()
    if surplus:
        await db.execute(delete(AuthSession).where(AuthSession.id.in_(surplus)))
    await db.commit()
    return row


async def get_live(db: AsyncSession, session_id: Optional[str], user_id: str) -> AuthSession:
    """The session a token claims, or a 401. Looked up by id AND user, so a token can never borrow another user's session."""
    if not session_id or not isinstance(session_id, str):
        raise HTTPException(status_code=401, detail=SESSION_ENDED)
    row = (await db.execute(select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == user_id))).scalar_one_or_none()
    now = now_ms()
    if row is None or row.expires_ms <= now or row.created_ms + MAX_DAYS * DAY_MS <= now:
        raise HTTPException(status_code=401, detail=SESSION_ENDED)
    return row


async def is_live(db: AsyncSession, session_id: Optional[str], user_id: str) -> bool:
    try:
        await get_live(db, session_id, user_id)
        return True
    except HTTPException:
        return False


async def extend(db: AsyncSession, row: AuthSession) -> AuthSession:
    """Called when a refresh token is used: the session lives on for another idle period, up to the maximum age."""
    row.expires_ms = _expiry(row.created_ms, now_ms())
    await db.commit()
    return row


async def end(db: AsyncSession, session_id: str, user_id: str) -> None:
    await db.execute(delete(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == user_id))
    await db.commit()


async def end_all_for_user(db: AsyncSession, user_id: str) -> None:
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    await db.commit()


async def end_every_session(session_factory) -> int:
    """Server start and stop: nobody stays signed in across a restart. Returns how many sessions were ended."""
    async with session_factory() as db:
        result = await db.execute(delete(AuthSession))
        await db.commit()
        return result.rowcount or 0
