"""Recovery and account-control tool for the person who runs this server (run it on the server machine).

    python owner_admin.py reset-password        # prompts for a new owner password (hidden)
    python owner_admin.py deactivate EMAIL      # switch an account off: every session ends, nobody can sign in, nothing is deleted
    python owner_admin.py reactivate EMAIL      # switch it back on
    python owner_admin.py disable-2fa EMAIL     # for someone who lost the phone AND the recovery codes: turns the second step off

The password is no longer reset from ADMIN_PASSWORD on every start, so reset-password is how to regain access if it is lost.
An account that is deactivated here stays off even if its person uses an emailed reset link; only `reactivate` undoes it.
The owner account itself cannot be deactivated.
"""
import asyncio
import getpass
import sys

import account_status
import auth_sessions
import server
import two_factor_api
from database import AsyncSessionLocal
from models import User
from security_utils import hash_password, password_problem
from sqlalchemy import select


async def set_password(user_id: str, new_password: str) -> bool:
    """A password change like any other: every token issued so far stops working and every session ends."""
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            return False
        user.password_hash = hash_password(new_password)
        user.token_version = int(user.token_version or 0) + 1
        user.password_reset_token = None  # a reset link sent earlier must not undo it
        user.password_reset_expires_at = None
        await db.commit()
        await auth_sessions.end_all_for_user(db, user.id)
        return True


async def reset_password(new_password: str) -> bool:
    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(User).where(User.role == "owner"))).scalar_one_or_none()
    return bool(owner) and await set_password(owner.id, new_password)


async def set_deactivated(email: str, off: bool) -> str:
    """Returns "ok", "none" (no such account), "owner" (refused) or "unchanged" (it was already in that state)."""
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email.strip().lower()))).scalar_one_or_none()
        if user is None:
            return "none"
        if off:
            if user.role == "owner":
                return "owner"
            await account_status.deactivate(db, user.id, account_status.OWNER)
            return "ok"
        return "ok" if await account_status.reactivate(db, user.id) else "unchanged"


async def disable_second_step(email: str) -> str:
    """Returns "ok" (it was on and is now off), "unchanged" (it was not on) or "none" (no such account)."""
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email.strip().lower()))).scalar_one_or_none()
        if user is None:
            return "none"
        was_on = await two_factor_api.credential(db, user.id) is not None
        await two_factor_api.remove_second_step(db, user.id)
        return "ok" if was_on else "unchanged"


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) == 2 and argv[0] == "disable-2fa":
        outcome = asyncio.run(disable_second_step(argv[1]))
        print({"ok": f"Done: two-step sign-in is off for {argv[1]}. They sign in with the password alone and can turn it on again in Settings.",
               "unchanged": f"Nothing to do: two-step sign-in was not on for {argv[1]}.",
               "none": f"No account with the address {argv[1]}."}[outcome])
        return 0 if outcome in ("ok", "unchanged") else 1
    if len(argv) == 2 and argv[0] in ("deactivate", "reactivate"):
        outcome = asyncio.run(set_deactivated(argv[1], argv[0] == "deactivate"))
        print({"ok": f"Done: {argv[1]} is {'deactivated and signed out everywhere' if argv[0] == 'deactivate' else 'active again'}.",
               "unchanged": f"Nothing to do: {argv[1]} was not deactivated.",
               "none": f"No account with the address {argv[1]}.",
               "owner": "The owner account cannot be deactivated."}[outcome])
        return 0 if outcome in ("ok", "unchanged") else 1
    if argv != ["reset-password"]:
        print(__doc__)
        return 2
    first = getpass.getpass("New owner password (hidden): ")
    problem = password_problem(first)
    if problem:
        print(f"Too weak or too long: {problem}.")
        return 1
    if first != getpass.getpass("Repeat it: "):
        print("The two entries differ; nothing changed.")
        return 1
    if not asyncio.run(reset_password(first)):
        print("No owner account exists.")
        return 1
    print("Owner password changed. Every session the owner had was signed out.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
