"""Deterministic tests for the AI kitchen tools.

These call the tool dispatcher in-process (no Gemini, no HTTP) so they verify what the AI can actually do to
the owner's data: validated writes, name-based lookup, strict storage names, the discard confirmation gate,
and the read-only kitchen overview. Test rows carry a unique tag and are removed afterwards.
"""
import asyncio
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import delete, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402  (loads backend/.env)
from database import AsyncSessionLocal  # noqa: E402
from models import Grocery, StorageLocation, User  # noqa: E402

TAG = f"AIK_{uuid.uuid4().hex[:6]}"
OWNER_EMAIL = "tiagosa743@gmail.com"


def run(coro):
    return asyncio.run(coro)


async def _owner(db):
    u = (await db.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
    return {"_id": u.id, "email": u.email, "name": u.name, "role": u.role}


async def _tool(name, args, session_id="sess-" + TAG, previewed=None):
    async with AsyncSessionLocal() as db:
        user = await _owner(db)
        return await server.dispatch_tool(db, name, args, [], user, session_id=session_id,
                                          previewed_this_turn=previewed if previewed is not None else set())


async def _cleanup():
    async with AsyncSessionLocal() as db:
        user = await _owner(db)
        await db.execute(delete(Grocery).where(Grocery.user_id == user["_id"], Grocery.name.like(f"{TAG}%")))
        await db.execute(delete(StorageLocation).where(StorageLocation.user_id == user["_id"], StorageLocation.name.like(f"{TAG}%")))
        await db.commit()


@pytest.fixture(autouse=True)
def tidy():
    yield
    run(_cleanup())


async def _ensure_fridge():
    async with AsyncSessionLocal() as db:
        user = await _owner(db)
        found = (await db.execute(select(StorageLocation).where(
            StorageLocation.user_id == user["_id"], StorageLocation.kind == "fridge"))).scalars().first()
        if found:
            return found.name
    res = await _tool("add_storage_location", {"name": f"{TAG}_fridge", "kind": "fridge"})
    return res["name"]


def test_add_grocery_places_item_and_resolves_location_by_kind():
    fridge = run(_ensure_fridge())
    exp = (date.today() + timedelta(days=5)).isoformat()
    res = run(_tool("add_grocery", {"name": f"{TAG}_milk", "quantity": 2, "unit": "L",
                                    "storage_location": "fridge", "expiration": exp}))
    assert res["storage_location"] == fridge  # "fridge" (a kind, lower-case) became the real space name
    assert res["expiration"] == exp
    assert float(res["quantity"]) == 2


def test_unknown_storage_location_is_rejected_with_choices():
    with pytest.raises(server.HTTPException) as exc:
        run(_tool("add_grocery", {"name": f"{TAG}_ghost", "quantity": 1, "storage_location": "attic"}))
    assert exc.value.status_code == 400
    assert "Available" in exc.value.detail


def test_move_and_consume_by_name():
    run(_ensure_fridge())
    run(_tool("add_grocery", {"name": f"{TAG}_yogurt", "quantity": 4, "storage_location": "fridge"}))
    moved = run(_tool("update_grocery_storage", {"name": f"{TAG}_yogurt", "storage_location": "pantry"}))
    assert (moved["storage_location"] or "").lower() == "pantry"
    used = run(_tool("consume_grocery", {"name": f"{TAG}_yogurt", "quantity": 1}))
    assert float(used["quantity"]) == 3
    with pytest.raises(server.HTTPException) as exc:
        run(_tool("consume_grocery", {"name": f"{TAG}_yogurt", "quantity": 50}))
    assert exc.value.status_code == 400
    missing = run(_tool("consume_grocery", {"name": f"{TAG}_does_not_exist", "quantity": 1}))
    assert "error" in missing


def test_discard_requires_a_later_confirmation_and_never_self_confirms():
    run(_tool("add_grocery", {"name": f"{TAG}_bread", "quantity": 1}))
    sid = f"sess-discard-{TAG}"

    # Preview: nothing removed
    first = run(_tool("discard_grocery", {"name": f"{TAG}_bread"}, session_id=sid, previewed=set()))
    assert first["needs_confirmation"] is True
    assert run(_tool("get_groceries", {}))["groceries"], "inventory should still be readable"
    assert any(g["name"] == f"{TAG}_bread" for g in run(_tool("get_groceries", {}))["groceries"])

    # Confirming inside the same model turn (same previewed set) must not discard
    same_turn = set()
    run(_tool("discard_grocery", {"name": f"{TAG}_bread"}, session_id=sid, previewed=same_turn))
    still = run(_tool("discard_grocery", {"name": f"{TAG}_bread", "confirm": True}, session_id=sid, previewed=same_turn))
    assert still.get("needs_confirmation") is True
    assert any(g["name"] == f"{TAG}_bread" for g in run(_tool("get_groceries", {}))["groceries"])

    # A later turn with confirm=true does discard
    run(_tool("discard_grocery", {"name": f"{TAG}_bread"}, session_id=sid, previewed=set()))
    done = run(_tool("discard_grocery", {"name": f"{TAG}_bread", "confirm": True}, session_id=sid, previewed=set()))
    assert "discarded" in done
    assert not any(g["name"] == f"{TAG}_bread" for g in run(_tool("get_groceries", {}))["groceries"])


def test_rename_storage_location_keeps_items_attached():
    res = run(_tool("add_storage_location", {"name": f"{TAG}_shelf", "kind": "custom"}))
    run(_tool("add_grocery", {"name": f"{TAG}_jam", "quantity": 1, "storage_location": res["name"]}))
    renamed = run(_tool("update_storage_location", {"name": f"{TAG}_shelf", "new_name": f"{TAG}_cupboard"}))
    assert renamed["name"] == f"{TAG}_cupboard"
    inside = run(_tool("get_groceries", {"storage_location": f"{TAG}_cupboard"}))["groceries"]
    assert [g["name"] for g in inside] == [f"{TAG}_jam"]


def test_kitchen_overview_flags_expired_expiring_and_low():
    fridge = run(_ensure_fridge())
    today = date.today()
    run(_tool("add_grocery", {"name": f"{TAG}_old", "quantity": 1, "storage_location": fridge,
                              "expiration": (today - timedelta(days=2)).isoformat()}))
    run(_tool("add_grocery", {"name": f"{TAG}_soon", "quantity": 1, "storage_location": fridge,
                              "expiration": (today + timedelta(days=1)).isoformat()}))
    run(_tool("add_grocery", {"name": f"{TAG}_scarce", "quantity": 1, "low_threshold": 2, "storage_location": fridge}))
    ov = run(_tool("get_kitchen_overview", {}))
    assert any(i["name"] == f"{TAG}_old" and i["days_overdue"] == 2 for i in ov["expired"])
    assert any(i["name"] == f"{TAG}_soon" and i["days_left"] == 1 for i in ov["expiring_within_3_days"])
    assert any(i["name"] == f"{TAG}_scarce" for i in ov["low_or_out_of_stock"])
    space = next(s for s in ov["storage_locations"] if s["name"] == fridge)
    assert space["item_count"] >= 3
