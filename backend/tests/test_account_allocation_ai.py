"""Undoing an assistant action on a main account's places puts all the money back: the transfers that carried the money
between the main account and a place are part of the action, so undo removes them too. In-process, like test_ai_undo.py."""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402  (loads backend/.env)
from database import AsyncSessionLocal  # noqa: E402
from models import AIAction  # noqa: E402
from support_users import api, create_verified_user  # noqa: E402


def run(coro):
    return asyncio.run(coro)


async def _turn(user, *calls):
    created = []
    async with AsyncSessionLocal() as db:
        who = {"_id": user["id"], "email": user["email"], "name": user["name"], "role": "user"}
        out = [await server.dispatch_tool(db, n, a, created, who, session_id="sess-alloc", previewed_this_turn=set()) for n, a in calls]
        aid = server.new_id()
        db.add(AIAction(id=aid, user_id=user["id"], label="alloc", tools=[n for n, _ in calls], created=created,
                        undoable=len(created) > 0, undone=False, created_at=server.now_iso()))
        await db.commit()
        return aid, out


async def _undo(user, aid):
    async with AsyncSessionLocal() as db:
        return await server.ai_undo(aid, {"_id": user["id"], "email": user["email"], "name": user["name"], "role": "user"}, db)


@pytest.fixture
def me():
    user = create_verified_user("alloc")
    cash = user["session"].post(api(user, "/accounts"), json={"name": "Money in hand", "type": "cash", "opening_balance": 200}).json()
    return {**user, "cash": cash}


def state(me):
    accounts = me["session"].get(api(me, "/accounts")).json()
    cash = next(a for a in accounts if a["id"] == me["cash"]["id"])
    subs = {a["name"]: a["balance"] for a in accounts if a["parent_id"] == cash["id"]}
    assert round(cash["unallocated_balance"] + sum(subs.values()), 2) == cash["total_balance"]
    return {"total": cash["total_balance"], "unallocated": cash["unallocated_balance"], "subs": subs}


def test_the_assistant_sets_money_aside_without_creating_any(me):
    run(_turn(me, ("create_money_space", {"parent": "cash", "name": "Pot", "balance": 50})))
    assert state(me) == {"total": 200, "unallocated": 150, "subs": {"Pot": 50}}


def test_the_assistant_cannot_set_aside_more_than_is_available(me):
    _, out = run(_turn(me, ("create_money_space", {"parent": "cash", "name": "Pot", "balance": 250})))
    assert "exceeds the available balance of €200.00" in out[0]["error"]
    assert state(me) == {"total": 200, "unallocated": 200, "subs": {}}


def test_undoing_a_new_place_gives_the_money_back(me):
    aid, _ = run(_turn(me, ("create_money_space", {"parent": "cash", "name": "Pot", "balance": 50})))
    run(_undo(me, aid))
    assert state(me) == {"total": 200, "unallocated": 200, "subs": {}}


def test_undoing_a_balance_change_gives_the_money_back(me):
    run(_turn(me, ("create_money_space", {"parent": "cash", "name": "Pot", "balance": 50})))
    aid, _ = run(_turn(me, ("update_account_balance", {"account": "Pot", "balance": 80})))
    assert state(me) == {"total": 200, "unallocated": 120, "subs": {"Pot": 80}}
    run(_undo(me, aid))
    assert state(me) == {"total": 200, "unallocated": 150, "subs": {"Pot": 50}}


def test_undoing_hiding_a_place_brings_it_and_its_money_back(me):
    run(_turn(me, ("create_money_space", {"parent": "cash", "name": "Pot", "balance": 50})))
    aid, _ = run(_turn(me, ("update_money_space", {"account": "Pot", "is_active": False})))
    assert state(me) == {"total": 200, "unallocated": 200, "subs": {}}
    run(_undo(me, aid))
    assert state(me) == {"total": 200, "unallocated": 150, "subs": {"Pot": 50}}


def test_new_money_from_the_assistant_raises_the_total_and_undo_removes_it(me):
    aid, _ = run(_turn(me, ("create_money_space", {"parent": "cash", "name": "Gift", "balance": 40, "add_as_new_money": True})))
    assert state(me) == {"total": 240, "unallocated": 200, "subs": {"Gift": 40}}
    run(_undo(me, aid))
    assert state(me) == {"total": 200, "unallocated": 200, "subs": {}}


def test_a_place_that_has_been_used_since_cannot_be_undone_away(me):
    aid, _ = run(_turn(me, ("create_money_space", {"parent": "cash", "name": "Pot", "balance": 50})))
    pot = next(a for a in me["session"].get(api(me, "/accounts")).json() if a["name"] == "Pot")
    assert me["session"].post(api(me, "/transactions/expense"), json={"amount": 20, "merchant": "TEST", "account": pot["id"], "participants": ["Me"]}).status_code == 200
    with pytest.raises(Exception) as refused:
        run(_undo(me, aid))
    assert "used since" in str(refused.value.detail)
    assert state(me) == {"total": 180, "unallocated": 150, "subs": {"Pot": 30}}  # nothing was undone


def test_undoing_a_top_up_that_has_been_spent_is_refused(me):
    run(_turn(me, ("create_money_space", {"parent": "cash", "name": "Pot", "balance": 50})))
    aid, _ = run(_turn(me, ("update_account_balance", {"account": "Pot", "balance": 80})))
    pot = next(a for a in me["session"].get(api(me, "/accounts")).json() if a["name"] == "Pot")
    assert me["session"].post(api(me, "/transactions/expense"), json={"amount": 70, "merchant": "TEST", "account": pot["id"], "participants": ["Me"]}).status_code == 200
    with pytest.raises(Exception) as refused:
        run(_undo(me, aid))  # would leave the place at 50 - 70
    assert "exceeds the available balance" in str(refused.value.detail)
    assert state(me) == {"total": 130, "unallocated": 120, "subs": {"Pot": 10}}
