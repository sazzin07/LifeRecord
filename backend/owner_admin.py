"""Recovery tool for the owner account (run on the server machine).

    python owner_admin.py reset-password     # prompts for a new password (hidden)

The password is no longer reset from ADMIN_PASSWORD on every start, so this is how to regain access if it is lost.
"""
import asyncio
import getpass
import sys

import server
from database import AsyncSessionLocal
from models import User
from security_utils import hash_password, is_strong_password
from sqlalchemy import select


async def reset_password(new_password: str) -> bool:
    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(User).where(User.role == "owner"))).scalar_one_or_none()
        if not owner:
            return False
        owner.password_hash = hash_password(new_password)
        await db.commit()
        return True


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv != ["reset-password"]:
        print(__doc__)
        return 2
    first = getpass.getpass("New owner password (hidden): ")
    if not is_strong_password(first):
        print("Too weak: use at least 8 characters with a letter and a digit.")
        return 1
    if first != getpass.getpass("Repeat it: "):
        print("The two entries differ; nothing changed.")
        return 1
    if not asyncio.run(reset_password(first)):
        print("No owner account exists.")
        return 1
    print("Owner password changed. Existing sessions stay valid until they expire; rotate the JWT secret to end them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
