"""Switching an account off and on again, without deleting anything.

A deactivated account keeps every record; what it loses is the ability to sign in. The one place that enforces this is
`auth_sessions.start`, which every sign-in, verification and password reset goes through, so no route can forget it, and
deactivating ends every session the account already has, so a token in someone's pocket stops working at once.

Who may switch it back on depends on who switched it off:
- "self": the person, with their password. They switch it back on by using the emailed reset link (see reset_password),
  which proves they control the mailbox.
- "owner": the person who runs this server (backend/owner_admin.py). A reset link cannot undo that.
"""
import time
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AccountDeactivation, AuthSession, User

SELF, OWNER = "self", "owner"

SELF_MESSAGE = ("This account is deactivated. Nothing was deleted: use “Forgot password” on the sign-in page "
                "and the emailed link will switch it back on.")
OWNER_MESSAGE = ("This account has been deactivated by the person who runs this server. "
                 "Contact them to have it switched back on.")


async def deactivation_for(db: AsyncSession, user_id: str) -> Optional[AccountDeactivation]:
    return (await db.execute(select(AccountDeactivation).where(AccountDeactivation.user_id == user_id))).scalar_one_or_none()


async def refuse_if_deactivated(db: AsyncSession, user_id: str) -> None:
    """Raise the 403 that tells the person why they cannot sign in."""
    row = await deactivation_for(db, user_id)
    if row is not None:
        raise HTTPException(status_code=403, detail=OWNER_MESSAGE if row.deactivated_by == OWNER else SELF_MESSAGE)


async def deactivate(db: AsyncSession, user_id: str, by: str) -> None:
    """Switch the account off and end every session it has. Idempotent; the owner's decision replaces the person's."""
    row = await deactivation_for(db, user_id)
    if row is None:
        db.add(AccountDeactivation(user_id=user_id, deactivated_ms=int(time.time() * 1000), deactivated_by=by))
    elif by == OWNER:
        row.deactivated_by = OWNER
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
    user.token_version = int(user.token_version or 0) + 1  # every token issued so far is void, whatever session it names
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    await db.commit()


async def reactivate(db: AsyncSession, user_id: str) -> bool:
    """Switch the account back on. False when it was not off."""
    result = await db.execute(delete(AccountDeactivation).where(AccountDeactivation.user_id == user_id))
    await db.commit()
    return bool(result.rowcount)
