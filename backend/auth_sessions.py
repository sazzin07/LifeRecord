"""Server-side sessions: what makes "signed out" mean signed out.

A JWT alone stays valid until it expires, wherever a copy of it ended up. Every access and refresh token therefore names
a session row (`sid`), and the server honours the token only while that row exists and has not expired:

- signing out deletes the row, so the access token and the refresh cookie (and any copy of either) stop working at once;
- "sign out everywhere", a password change and a password reset delete every row of the user;
- every row is deleted when the server starts and when it stops, so a restart, a crash or a redeploy signs everyone out;
- one user holds at most SESSION_MAX_PER_USER sessions (default 20): past that the oldest make room for the newest;
- a deactivated account cannot start a session at all (account_status.py);
- a refresh token is used once: every refresh replaces it (see `rotate`). The one just replaced still works for a short
  grace period, because two tabs refreshing at the same moment are normal; an older one ends the whole session, because a
  copy of it is the likeliest explanation;
- a session lasts SESSION_IDLE_DAYS (default: the refresh-token lifetime) after its last refresh, and never longer than
  SESSION_MAX_DAYS (default 30) after sign-in; either way the user has to sign in again.

The tables with a user_id cascade on user deletion, so deleting an account removes its sessions too.
"""
import hashlib
import hmac
import os
import time
import uuid
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

import account_status
from models import AuthSession, AuthSessionInfo
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
REFRESH_GRACE_MS = _days("REFRESH_GRACE_SECONDS", 60) * 1000
REFRESH_RETRY_MS = _days("REFRESH_RETRY_HOURS", 24) * 3_600_000  # how long a repeated request with the same key is answered again
MAX_PER_USER = _days("SESSION_MAX_PER_USER", 20)  # not days: the same "positive whole number, else the default" rule


def now_ms() -> int:
    return int(time.time() * 1000)


def _expiry(created_ms: int, now: int) -> int:
    return min(now + IDLE_DAYS * DAY_MS, created_ms + MAX_DAYS * DAY_MS)


async def start(db: AsyncSession, user_id: str, device: str = "") -> tuple:
    """A new session for a user who has just proved who they are (sign-in, verification, password reset). Expired rows are
    removed on the way: they are refused anyway, but nothing else deletes them until the server restarts.

    The single place a session can begin, so it is also where a deactivated account is turned away (account_status.py)."""
    await account_status.refuse_if_deactivated(db, user_id)
    now = now_ms()
    await db.execute(delete(AuthSession).where(AuthSession.expires_ms <= now))
    row = AuthSession(id=str(uuid.uuid4()), user_id=user_id, created_ms=now, expires_ms=_expiry(now, now))
    db.add(row)
    await db.flush()
    jti = str(uuid.uuid4())
    db.add(AuthSessionInfo(session_id=row.id, user_id=user_id, refresh_jti=jti, rotated_ms=now, device=device[:80], last_seen_ms=now))
    # A person has a handful of devices, not hundreds: past MAX_PER_USER the oldest sessions make room for the newest.
    surplus = (await db.execute(
        select(AuthSession.id).where(AuthSession.user_id == user_id, AuthSession.id != row.id)
        .order_by(AuthSession.created_ms.desc(), AuthSession.id).offset(MAX_PER_USER - 1)
    )).scalars().all()
    if surplus:
        await db.execute(delete(AuthSession).where(AuthSession.id.in_(surplus)))
    await db.commit()
    return row, jti


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
    expires = _expiry(row.created_ms, now_ms())
    # A conditional UPDATE, not an attribute change flushed by the ORM: a sign-out that lands between finding the session and
    # extending it leaves nothing to update, and that is an ended session (401), not an unexpected error.
    result = await db.execute(update(AuthSession).where(AuthSession.id == row.id).values(expires_ms=expires))
    await db.commit()
    if result.rowcount != 1:
        raise HTTPException(status_code=401, detail=SESSION_ENDED)
    set_committed_value(row, "expires_ms", expires)  # already written above; do not queue the same UPDATE again
    return row


def _key_hash(key: Optional[str]) -> Optional[str]:
    """What is remembered of a retry key: a hash, and only of something that looks like a key (random, 16-128 characters)."""
    return hashlib.sha256(key.encode()).hexdigest() if key and 16 <= len(key) <= 128 else None


async def rotate(db: AsyncSession, session: AuthSession, presented: Optional[str], key: Optional[str] = None) -> str:
    """Use up the refresh token `presented` and return the id of the one that replaces it.

    - the current token: replaced. The swap is one conditional UPDATE, so two requests with the same token cannot both win;
    - the token replaced a moment ago (within REFRESH_GRACE_MS): the other tab's refresh got there first, so this one is
      handed the current token instead;
    - the token replaced a while ago, asked again WITH THE SAME KEY that replaced it (within REFRESH_RETRY_MS): the browser
      never heard the answer (the network dropped, the laptop was shut) and is repeating the request. It is handed the same
      current token, not a new one. The key is something only that browser knows; a copy of the cookie alone has no key;
    - anything else, or no id at all: a copy of an old token was used. The session is ended, for whoever holds it, and the
      real owner signs in again. That is the price of noticing a stolen copy."""
    now = now_ms()
    new = str(uuid.uuid4())
    if presented:
        swapped = await db.execute(
            update(AuthSessionInfo).where(AuthSessionInfo.session_id == session.id, AuthSessionInfo.refresh_jti == presented)
            .values(previous_jti=presented, refresh_jti=new, rotated_ms=now, last_seen_ms=now, rotation_key=_key_hash(key)))
        if swapped.rowcount == 1:
            await db.commit()
            return new
    # The transaction opened by authentication still sees the row as it was before a concurrent refresh committed; end it, so
    # this read sees what that refresh did (InnoDB reads from the snapshot taken at the first plain SELECT of a transaction).
    await db.commit()
    info = (await db.execute(select(AuthSessionInfo).where(AuthSessionInfo.session_id == session.id))).scalar_one_or_none()
    if info is not None and presented and presented == info.previous_jti:
        age = now - info.rotated_ms
        key_hash = _key_hash(key)
        same_request = bool(key_hash and info.rotation_key and hmac.compare_digest(key_hash, info.rotation_key))
        if age <= REFRESH_GRACE_MS or (same_request and age <= REFRESH_RETRY_MS):
            await db.commit()
            return info.refresh_jti
    if info is None:
        # a session that has no generations yet (it began before they existed): start them now rather than refuse the person
        db.add(AuthSessionInfo(session_id=session.id, user_id=session.user_id, refresh_jti=new, rotated_ms=now, device="", last_seen_ms=now))
        await db.commit()
        return new
    await end(db, session.id, session.user_id)
    raise HTTPException(status_code=401, detail=SESSION_ENDED)


async def sessions_of(db: AsyncSession, user_id: str) -> list:
    """The user's live sessions with what they are shown (newest activity first): [(AuthSession, AuthSessionInfo or None)]."""
    now = now_ms()
    rows = (await db.execute(
        select(AuthSession, AuthSessionInfo).outerjoin(AuthSessionInfo, AuthSessionInfo.session_id == AuthSession.id)
        .where(AuthSession.user_id == user_id, AuthSession.expires_ms > now)
        .order_by(AuthSessionInfo.last_seen_ms.desc(), AuthSession.created_ms.desc())
    )).all()
    return [(session, info) for session, info in rows]


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
