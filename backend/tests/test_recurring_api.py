"""Recurring transactions over HTTP, and the tick that turns due rules into real transactions (F-11). No AI, no mail."""
import asyncio
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402,F401  (loads backend/.env)
import recurring_api  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from support_populate import _account, _post, _tag  # noqa: E402
from support_users import api, create_verified_user  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def tick(today: date) -> int:
    return run(recurring_api.run_due(server, AsyncSessionLocal, today))


@pytest.fixture()
def me():
    return create_verified_user("recur")


def get(user, path):
    r = user["session"].get(api(user, path), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def rule(user, account, **kw):
    body = {"kind": "expense", "amount": 10, "account": account, "category": "Bills", "description": f"Rent {_tag()}", "repeat": "monthly",
            "start_date": date.today().isoformat(), **kw}
    return _post(user, "/recurring", body)


def balance(user, account):
    return next(a["balance"] for a in get(user, "/accounts") if a["id"] == account)


def mine(user, rid):
    return [t for t in get(user, "/transactions") if t.get("recurring_id") == rid]


def test_a_rule_is_validated(me):
    acc = _account(me)
    bad = [{"amount": 0}, {"repeat": "daily"}, {"start_date": "2026-13-45"}, {"kind": "loan"}, {"end_date": "2000-01-01"}]
    for patch in bad:
        r = me["session"].post(api(me, "/recurring"), json={"kind": "expense", "amount": 10, "account": acc, "repeat": "monthly",
                                                            "start_date": "2026-01-01", **patch}, timeout=30)
        assert r.status_code in (409, 422), (patch, r.status_code)
    r = me["session"].post(api(me, "/recurring"), json={"kind": "expense", "amount": 5, "account": "nope", "repeat": "weekly", "start_date": "2026-01-01"}, timeout=30)
    assert r.status_code in (400, 404, 422)


def test_a_due_rule_creates_one_transaction_on_its_due_day_and_moves_the_balance(me):
    acc = _account(me, balance=100)
    start = date.today() - timedelta(days=1)
    r = rule(me, acc, amount=30, start_date=start.isoformat())
    assert r["next_due"] == start.isoformat() and r["status"] == "active"
    assert tick(date.today()) >= 1
    made = mine(me, r["id"])
    assert len(made) == 1 and made[0]["date"] == start.isoformat() and made[0]["type"] == "expense"
    assert balance(me, acc) == 70
    assert [x for x in get(me, "/recurring") if x["id"] == r["id"]][0]["next_due"] > date.today().isoformat()
    assert tick(date.today()) == 0                       # idempotent: nothing more is due today
    assert len(mine(me, r["id"])) == 1


def test_a_rule_that_was_missed_for_months_makes_each_due_day_once(me):
    acc = _account(me, balance=500)
    start = date.today() - timedelta(days=75)
    r = rule(me, acc, amount=20, repeat="weekly", start_date=start.isoformat())
    tick(date.today())
    days = sorted(t["date"] for t in mine(me, r["id"]))
    assert days == [(start + timedelta(days=7 * i)).isoformat() for i in range(len(days))] and len(days) == 11      # 75 days: weeks 0..10
    assert balance(me, acc) == 500 - 20 * 11


def test_income_adds_money_and_an_ended_rule_makes_nothing_more(me):
    acc = _account(me, balance=0)
    start = date.today() - timedelta(days=40)
    r = rule(me, acc, kind="income", amount=100, description="Salary", start_date=start.isoformat(), end_date=(start + timedelta(days=5)).isoformat())
    tick(date.today())
    assert len(mine(me, r["id"])) == 1 and balance(me, acc) == 100
    assert [x for x in get(me, "/recurring") if x["id"] == r["id"]][0]["status"] == "ended"
    assert tick(date.today()) == 0


def test_a_place_that_cannot_pay_pauses_the_rule_with_a_reason(me):
    acc = _account(me, balance=5)
    r = rule(me, acc, amount=50, start_date=(date.today() - timedelta(days=1)).isoformat())
    tick(date.today())
    now = [x for x in get(me, "/recurring") if x["id"] == r["id"]][0]
    assert now["status"] == "paused" and now["note"] and not mine(me, r["id"])
    assert tick(date.today()) == 0                       # not retried every tick


def test_pause_resume_skips_what_fell_due_while_paused_and_delete_keeps_history(me):
    acc = _account(me, balance=500)
    start = date.today() - timedelta(days=20)
    r = rule(me, acc, amount=10, repeat="weekly", start_date=start.isoformat())
    me["session"].post(api(me, f"/recurring/{r['id']}/pause"), timeout=30)
    assert tick(date.today()) == 0 and not mine(me, r["id"])
    back = me["session"].post(api(me, f"/recurring/{r['id']}/resume"), timeout=30).json()
    assert back["status"] == "active" and back["next_due"] >= date.today().isoformat()      # nothing is made up
    first = rule(me, acc, amount=10, start_date=date.today().isoformat())
    tick(date.today())
    assert len(mine(me, first["id"])) == 1
    assert me["session"].delete(api(me, f"/recurring/{first['id']}"), timeout=30).status_code == 200
    assert len(mine(me, first["id"])) == 1               # the transaction stays


def test_notices_list_what_was_created_until_seen(me):
    acc = _account(me, balance=100)
    r = rule(me, acc, amount=10, start_date=date.today().isoformat())
    tick(date.today())
    notes = get(me, "/recurring/notices")
    assert len(notes) == 1 and notes[0]["rule_id"] == r["id"] and notes[0]["count"] == 1 and notes[0]["total"] == 10
    me["session"].post(api(me, "/recurring/notices/seen"), timeout=30)
    assert get(me, "/recurring/notices") == []
