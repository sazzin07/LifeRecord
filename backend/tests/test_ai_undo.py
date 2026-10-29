"""AI-006: undoing an assistant action restores records it changed or deleted, not only removes what it created.
In-process against the dispatcher and the undo endpoint; test rows are tagged and removed."""
import asyncio
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import delete, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402  (loads backend/.env)
from database import AsyncSessionLocal  # noqa: E402
from models import AIAction, AIPendingConfirmation, Grocery, Task, User  # noqa: E402
from support_auth import OWNER_EMAIL  # noqa: E402

TAG = f"UNDO_{uuid.uuid4().hex[:6]}"
SESSION = "sess-" + TAG


def run(coro):
    return asyncio.run(coro)


async def _owner(db):
    u = (await db.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
    return {"_id": u.id, "email": u.email, "name": u.name, "role": u.role}


async def _turn(*calls):
    """Run tool calls as one assistant turn, record the action like the chat does, and return its id."""
    created = []
    async with AsyncSessionLocal() as db:
        u = await _owner(db)
        out = [await server.dispatch_tool(db, n, a, created, u, session_id=SESSION, previewed_this_turn=set()) for n, a in calls]
        aid = server.new_id()
        db.add(AIAction(id=aid, user_id=u["_id"], label=TAG, tools=[n for n, _ in calls], created=created,
                        undoable=len(created) > 0, undone=False, created_at=server.now_iso()))
        await db.commit()
        return aid, out


async def _undo(aid):
    async with AsyncSessionLocal() as db:
        return await server.ai_undo(aid, await _owner(db), db)


async def _grocery(name):
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(Grocery).where(Grocery.name == name))).scalar_one_or_none()


async def _task(title):
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(Task).where(Task.title == title))).scalar_one_or_none()


async def _cleanup():
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Grocery).where(Grocery.name.like(f"{TAG}%")))
        await db.execute(delete(Task).where(Task.title.like(f"{TAG}%")))
        await db.execute(delete(AIAction).where(AIAction.label == TAG))
        await db.execute(delete(AIPendingConfirmation).where(AIPendingConfirmation.session_id == SESSION))
        await db.commit()


@pytest.fixture(autouse=True)
def tidy():
    yield
    run(_cleanup())


def test_undo_restores_an_edited_grocery():
    name = f"{TAG} rice"
    run(_turn(("add_grocery", {"name": name, "quantity": 2, "unit": "kg"})))
    before = run(_grocery(name))
    aid, _ = run(_turn(("update_grocery", {"name": name, "quantity": 5, "notes": "edited"})))
    assert float(run(_grocery(name)).quantity) == 5
    run(_undo(aid))
    after = run(_grocery(name))
    assert float(after.quantity) == 2 and (after.notes or "") == (before.notes or "")


def test_undo_restores_consumed_and_moved_stock():
    name = f"{TAG} yogurt"
    run(_turn(("add_grocery", {"name": name, "quantity": 4, "storage_location": "fridge"})))
    loc = run(_grocery(name)).storage_location
    aid, _ = run(_turn(("consume_grocery", {"name": name, "quantity": 3}),
                       ("update_grocery_storage", {"name": name, "storage_location": "pantry"})))
    g = run(_grocery(name))
    assert float(g.quantity) == 1 and g.storage_location != loc
    run(_undo(aid))
    g = run(_grocery(name))
    assert float(g.quantity) == 4 and g.storage_location == loc


def test_undo_brings_back_a_fully_discarded_item_with_the_same_id():
    name = f"{TAG} bread"
    run(_turn(("add_grocery", {"name": name, "quantity": 1})))
    gid = run(_grocery(name)).id
    run(_turn(("discard_grocery", {"name": name})))  # preview (earlier turn)
    aid, out = run(_turn(("discard_grocery", {"name": name, "confirm": True})))
    assert "discarded" in out[0] and run(_grocery(name)) is None
    run(_undo(aid))
    back = run(_grocery(name))
    assert back is not None and back.id == gid and float(back.quantity) == 1


def test_undo_restores_an_edited_and_a_deleted_task():
    title = f"{TAG} dentist"
    run(_turn(("create_task", {"title": title, "priority": "low"})))
    aid, _ = run(_turn(("update_task", {"match": title, "priority": "high", "done": True})))
    run(_undo(aid))
    t = run(_task(title))
    assert t.priority == "low" and t.done is False

    run(_turn(("delete_task", {"match": title})))
    aid, out = run(_turn(("delete_task", {"match": title, "confirm": True})))
    assert out[0] == {"deleted": title} and run(_task(title)) is None
    run(_undo(aid))
    assert run(_task(title)) is not None


def test_undo_of_a_turn_that_created_and_then_edited_removes_the_record():
    title = f"{TAG} plants"
    aid, _ = run(_turn(("create_task", {"title": title}), ("update_task", {"match": title, "priority": "high"})))
    run(_undo(aid))
    assert run(_task(title)) is None


def test_an_action_cannot_be_undone_twice():
    title = f"{TAG} twice"
    aid, _ = run(_turn(("create_task", {"title": title})))
    run(_undo(aid))
    with pytest.raises(server.HTTPException):
        run(_undo(aid))
