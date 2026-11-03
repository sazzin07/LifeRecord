"""The favourite place of each main account, the favourite main account, and the "Default" place every main account has.

Money used to sit in two kinds of spot: inside a place (a wallet, an envelope, a Revolut space) or "unassigned" on the main account
itself. That second kind confused day-to-day use, so now every main account has at least one place, "Default", marked with a star as
its FAVOURITE: whatever is entered against a main account without naming a place goes to its favourite place. One main account is
the overall favourite (what an expense without any account uses). Unassigned money on a main account is then only ever a
leftover (something unusual happened to it, see `unplaced`), and the Money page shows it only then.

The choice is kept in `account_favorites` (its own table: no ALTER on `accounts`). The money functions live in server.py and are
passed in as `srv`, like the other domain modules.
"""
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select

from models import Account, AccountFavorite, User

DEFAULT_NAME = "Default"
OVERALL = "overall"
PLACE_TYPES = {"revolut": "revolut_space", "bank": "bank_place"}   # anything else (cash ...) gets a cash_place


def place_type_for(main: Account) -> str:
    return PLACE_TYPES.get(main.type, "cash_place")


async def favourites(db, user_id: str) -> Dict[str, str]:
    rows = (await db.execute(select(AccountFavorite).where(AccountFavorite.user_id == user_id))).scalars().all()
    return {r.scope: r.account_id for r in rows}


async def active_places(db, user_id: str, main_id: str) -> List[Account]:
    return list((await db.execute(select(Account).where(
        Account.user_id == user_id, Account.parent_id == main_id, Account.is_active == True  # noqa: E712
    ).order_by(Account.sort_order, Account.name))).scalars())


async def place_of(db, user_id: str, main: Account, stored: Optional[Dict[str, str]] = None) -> Optional[Account]:
    """The favourite place of a main account: the one marked, else one called Default, else its first. None if it has no places."""
    places = await active_places(db, user_id, main.id)
    if not places:
        return None
    wanted = (stored if stored is not None else await favourites(db, user_id)).get(main.id)
    by_id = {p.id: p for p in places}
    if wanted in by_id:
        return by_id[wanted]
    return next((p for p in places if p.name == DEFAULT_NAME), places[0])


async def overall_main(db, user_id: str) -> Optional[Account]:
    """The favourite main account: the one marked, else the first by the order the person set."""
    mains = list((await db.execute(select(Account).where(
        Account.user_id == user_id, Account.parent_id == None, Account.is_active == True  # noqa: E711, E712
    ).order_by(Account.sort_order, Account.name))).scalars())
    if not mains:
        return None
    wanted = (await favourites(db, user_id)).get(OVERALL)
    return next((m for m in mains if m.id == wanted), mains[0])


async def target(db, user_id: str) -> Optional[Tuple[Account, Optional[Account]]]:
    """(favourite main account, its favourite place): where an expense goes when no account is named."""
    main = await overall_main(db, user_id)
    if main is None:
        return None
    return main, await place_of(db, user_id, main)


async def set_favourite(db, user_id: str, scope: str, account_id: str) -> None:
    row = (await db.execute(select(AccountFavorite).where(AccountFavorite.user_id == user_id, AccountFavorite.scope == scope))).scalar_one_or_none()
    if row is None:
        db.add(AccountFavorite(user_id=user_id, scope=scope, account_id=account_id))
    else:
        row.account_id = account_id


async def ensure_default_place(srv, db, user_id: str, main: Account) -> Account:
    """Make sure `main` has a favourite place, creating "Default" if it has none marked. Whatever the main account held unassigned
    moves into Default by a recorded transfer, so the total does not change. The caller commits (and holds the money lock)."""
    places = await active_places(db, user_id, main.id)
    stored = (await favourites(db, user_id)).get(main.id)
    marked = next((p for p in places if p.id == stored), None)
    if marked:
        return marked
    existing = next((p for p in places if p.name == DEFAULT_NAME), None)
    if existing:
        await set_favourite(db, user_id, main.id, existing.id)
        return existing
    default = Account(
        id=srv.new_id(), user_id=user_id, name=DEFAULT_NAME, type=place_type_for(main), parent_id=main.id, currency=main.currency,
        opening_balance=0, is_locked=False, sort_order=min([p.sort_order for p in places], default=0) - 1, is_active=True,
        created_at=srv.now_iso())
    db.add(default)
    await db.flush()
    unassigned = await srv.compute_account_balance(db, main.id, user_id)
    if srv.cents(unassigned) > 0:
        db.add(srv.allocation_transfer(user_id, main, default, unassigned, f"Moved into {DEFAULT_NAME}"))
    await set_favourite(db, user_id, main.id, default.id)
    await db.flush()
    return default


async def ensure_all(srv, session_factory) -> int:
    """At start-up: every active main account of every person gets its Default place. Idempotent. Returns how many were made."""
    made = 0
    async with session_factory() as db:
        user_ids = [u for (u,) in (await db.execute(select(User.id))).all()]
    for uid in user_ids:
        async with session_factory() as db:
            await srv.lock_money(db, uid)
            mains = (await db.execute(select(Account).where(
                Account.user_id == uid, Account.parent_id == None, Account.is_active == True  # noqa: E711, E712
            ))).scalars().all()
            for main in mains:
                before = len(await active_places(db, uid, main.id))
                stored = (await favourites(db, uid)).get(main.id)
                place = await ensure_default_place(srv, db, uid, main)
                made += 1 if (before == 0 or stored != place.id) else 0
            await db.commit()
    return made
