"""AI-005 / DEBT-004 / BUG-011: destructive AI actions need a preview and a confirmation on a later turn.

Pending confirmations are stored in the database (they survive a restart and work across processes), belong to
one user and one chat, and expire. In-process against the dispatcher; test rows are tagged and removed.
"""
import asyncio
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import delete, select, update

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402  (loads backend/.env)
from database import AsyncSessionLocal  # noqa: E402
from models import AIPendingConfirmation, ShoppingItem, ShoppingList, User  # noqa: E402

TAG = f"AIC_{uuid.uuid4().hex[:6]}"
OWNER_EMAIL = "tiagosa743@gmail.com"
SESSION = "sess-" + TAG


def run(coro):
    return asyncio.run(coro)


async def _owner(db):
    u = (await db.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
    return {"_id": u.id, "email": u.email, "name": u.name, "role": u.role}


async def _tool(name, args, previewed=None, session_id=SESSION):
    async with AsyncSessionLocal() as db:
        return await server.dispatch_tool(db, name, args, [], await _owner(db), session_id=session_id,
                                          previewed_this_turn=previewed if previewed is not None else set())


async def _item(name):
    async with AsyncSessionLocal() as db:
        u = await _owner(db)
        lst = (await db.execute(select(ShoppingList).where(ShoppingList.user_id == u["_id"]))).scalars().first()
        item = await server.post_shopping(server.ShoppingBody(name=name, list_id=lst.id), u, db)
        return item["id"], lst.id


async def _items_named(name):
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(ShoppingItem).where(ShoppingItem.name == name))).scalars().all()


async def _pending_rows():
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(AIPendingConfirmation).where(AIPendingConfirmation.session_id.like(f"{SESSION}%")))).scalars().all()


async def _cleanup():
    async with AsyncSessionLocal() as db:
        await db.execute(delete(ShoppingItem).where(ShoppingItem.name.like(f"{TAG}%")))
        await db.execute(delete(AIPendingConfirmation).where(AIPendingConfirmation.session_id.like(f"{SESSION}%")))
        await db.commit()


@pytest.fixture(autouse=True)
def tidy():
    yield
    run(_cleanup())


def test_remove_shopping_item_needs_a_later_confirmation_and_works():
    name = f"{TAG} oat milk"
    item_id, _ = run(_item(name))
    preview = run(_tool("delete_shopping_item", {"item_id": item_id}))
    assert preview.get("needs_confirmation") and name in preview["message"]
    # Confirming inside the same model turn is refused
    seen = set()
    run(_tool("delete_shopping_item", {"item_id": item_id}, previewed=seen))
    assert run(_tool("delete_shopping_item", {"item_id": item_id, "confirm": True}, previewed=seen)).get("needs_confirmation")
    assert run(_items_named(name))
    # A later turn confirms (this crashed before: the tool called an undefined function)
    run(_tool("delete_shopping_item", {"item_id": item_id}))
    assert run(_tool("delete_shopping_item", {"item_id": item_id, "confirm": True})) == {"deleted": name}
    assert not run(_items_named(name))


def test_submit_purchase_cannot_be_confirmed_without_a_preview():
    name = f"{TAG} rice"
    item_id, list_id = run(_item(name))
    args = {"list_id": list_id, "items": [{"item_id": item_id, "quantity": 1}], "confirm": True}
    out = run(_tool("submit_purchase", args))
    assert out.get("needs_confirmation"), out
    assert run(_items_named(name)), "nothing may be bought on an unconfirmed first call"


def test_pending_confirmation_is_stored_and_survives_a_restart():
    name = f"{TAG} restart"
    item_id, _ = run(_item(name))
    run(_tool("delete_shopping_item", {"item_id": item_id}))
    rows = run(_pending_rows())
    assert len(rows) == 1 and rows[0].tool == "delete_shopping_item" and rows[0].target_id == item_id
    # Nothing is kept in process memory any more, so a fresh process (new DB session) can confirm.
    assert not hasattr(server, "_pending_confirmations")
    assert run(_tool("delete_shopping_item", {"item_id": item_id, "confirm": True})) == {"deleted": name}
    assert run(_pending_rows()) == []


def test_pending_confirmation_belongs_to_one_user_and_one_chat():
    async def gate(user_id, session_id, confirm):
        async with AsyncSessionLocal() as db:
            return await server._confirmation_gate(db, user_id, session_id, set(), "delete_task", "t-1", confirm, "msg")

    async def owner_id():
        async with AsyncSessionLocal() as db:
            return (await _owner(db))["_id"]

    async def make_stranger():
        # A real second account (the email pattern is removed by conftest.py at the end of the run).
        async with AsyncSessionLocal() as db:
            uid_ = str(uuid.uuid4())
            db.add(User(id=uid_, email=f"aiiso_{uuid.uuid4().hex[:8]}@example.com", password_hash="x", name="s",
                        role="user", created_at=server.now_iso(), email_verified=True))
            await db.commit()
            return uid_

    uid = run(owner_id())
    assert run(gate(uid, SESSION, None))  # preview
    assert run(gate(uid, SESSION + "-other", True)), "another chat cannot confirm"
    run(gate(uid, SESSION, None))
    stranger = run(make_stranger())
    assert run(gate(stranger, SESSION, True)), "another user cannot confirm"
    run(gate(uid, SESSION, None))
    assert run(gate(uid, SESSION, True)) is None, "the same user and chat can"


def test_expired_confirmation_is_not_honoured():
    name = f"{TAG} expired"
    item_id, _ = run(_item(name))
    run(_tool("delete_shopping_item", {"item_id": item_id}))

    async def expire():
        async with AsyncSessionLocal() as db:
            await db.execute(update(AIPendingConfirmation).where(AIPendingConfirmation.session_id == SESSION)
                             .values(expires_at="2000-01-01T00:00:00+00:00"))
            await db.commit()

    run(expire())
    assert run(_tool("delete_shopping_item", {"item_id": item_id, "confirm": True})).get("needs_confirmation")
    assert run(_items_named(name))
