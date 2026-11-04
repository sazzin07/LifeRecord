"""Debts and people in more than one currency (F-19): each currency is its own ledger, nothing is converted, the main currency's behaviour is unchanged."""
import uuid

import pytest

from support_populate import _account, _post, _put
from support_users import api, create_verified_user

THEY, I = "they_owe", "i_owe"


@pytest.fixture()
def me():
    user = create_verified_user("dcur")
    bank = _post(user, "/accounts", {"name": "Bank", "type": "bank", "currency": "EUR", "opening_balance": 500})["id"]
    revolut = _post(user, "/accounts", {"name": "Rev", "type": "revolut", "currency": "USD", "opening_balance": 300})["id"]
    return {"u": user, "s": user["session"], "bank": bank, "revolut": revolut}


def call(me, method, path, **kw):
    return getattr(me["s"], method)(api(me["u"], path), timeout=60, **kw)


def ok(me, method, path, **kw):
    r = call(me, method, path, **kw)
    assert r.status_code == 200, f"{method} {path}: {r.status_code} {r.text}"
    return r.json()


def person(me):
    return _post(me["u"], "/people", {"name": f"P_{uuid.uuid4().hex[:6]}"})


def debt(me, p, op, direction=THEY, **body):
    return call(me, "post", f"/debts/people/{p['id']}/adjust/{op}", json={"direction": direction, **body})


def detail(me, p, currency=None):
    return ok(me, "get", f"/debts/people/{p['id']}" + (f"?currency={currency}" if currency else ""))


def test_the_main_currency_is_the_banks_and_a_plain_debt_lands_in_it(me):
    p = person(me)
    assert debt(me, p, "add", amount=20).status_code == 200
    d = detail(me, p)
    assert d["currency"] == "EUR" == d["main_currency"] and d["balances"]["they_owe"] == 20
    assert detail(me, p, "USD")["balances"]["they_owe"] == 0


def test_a_debt_in_another_currency_is_its_own_ledger_and_never_added_to_the_main_one(me):
    p = person(me)
    debt(me, p, "add", amount=20)
    r = debt(me, p, "add", amount=30, currency="usd")
    assert r.status_code == 200 and r.json()["balances"]["currency"] == "USD" and r.json()["balances"]["they_owe"] == 30
    assert detail(me, p)["balances"]["they_owe"] == 20                     # the main ledger is untouched
    assert detail(me, p, "USD")["balances"]["they_owe"] == 30
    every = {c["currency"]: c["they_owe"] for c in detail(me, p)["currencies"]}
    assert every == {"EUR": 20, "USD": 30}
    listed = next(x for x in ok(me, "get", "/people") if x["id"] == p["id"])
    assert listed["owes_me"] == 20 and listed["other_currencies"] == [{"currency": "USD", "owes_me": 30, "i_owe": 0}]
    assert ok(me, "get", "/debts/overview")["other_currencies"] == [{"currency": "USD", "they_owe": 30, "i_owe": 0}]


def test_reducing_clearing_and_correcting_work_inside_one_currency(me):
    p = person(me)
    debt(me, p, "add", amount=20)
    debt(me, p, "add", amount=30, currency="USD")
    assert debt(me, p, "reduce", amount=25, currency="USD").status_code == 200
    assert detail(me, p, "USD")["balances"]["they_owe"] == 5 and detail(me, p)["balances"]["they_owe"] == 20
    refused = debt(me, p, "reduce", amount=21)                             # EUR has only 20, whatever USD holds
    assert refused.status_code == 400 and "€20.00" in refused.json()["detail"]
    assert debt(me, p, "clear", currency="USD").status_code == 200
    assert detail(me, p, "USD")["balances"]["they_owe"] == 0 and detail(me, p)["balances"]["they_owe"] == 20


def test_a_payment_counts_in_the_currency_of_its_account(me):
    p = person(me)
    debt(me, p, "add", amount=20)
    debt(me, p, "add", amount=30, currency="USD")
    paid = ok(me, "post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 10, "account": me["revolut"]})
    assert paid["balances"]["currency"] == "USD" and paid["balances"]["they_owe"] == 20
    assert detail(me, p)["balances"]["they_owe"] == 20                     # EUR did not move
    over = ok(me, "post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 25, "account": me["revolut"]})
    assert over.get("needs_excess_choice") and over["currency"] == "USD" and over["outstanding"] == 20
    assert detail(me, p, "USD")["balances"]["they_owe"] == 20               # nothing was recorded for the ambiguous one
    nothing = ok(me, "post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 5, "currency": "USD"})
    assert nothing["balances"]["they_owe"] == 15 and nothing["payment"]["recorded_in_account"] is False


def test_history_and_undo_stay_in_their_currency(me):
    p = person(me)
    debt(me, p, "add", amount=20, description="lunch")
    usd = debt(me, p, "add", amount=30, currency="USD", description="tickets").json()
    assert [i["label"] for i in detail(me, p)["items"]] == ["Debt added"] and detail(me, p)["items"][0]["effect"] == 20
    assert detail(me, p, "USD")["items"][0]["effect"] == 30
    entry_id = usd["entries"][0]["id"]
    assert ok(me, "post", f"/debts/entries/{entry_id}/reverse")["balances"]["currency"] == "USD"
    assert detail(me, p, "USD")["balances"]["they_owe"] == 0 and detail(me, p)["balances"]["they_owe"] == 20


def test_deleting_a_person_with_a_debt_in_another_currency_asks_first_and_clears_every_ledger(me):
    p = person(me)
    debt(me, p, "add", amount=30, currency="USD")
    r = call(me, "post", f"/debts/people/{p['id']}/archive", json={"clear_balances": False})
    assert r.status_code == 409 and "USD" in r.json()["detail"]
    done = ok(me, "post", f"/debts/people/{p['id']}/archive", json={"clear_balances": True})
    assert done["archived"] and done["cleared_other_currencies"] == {"USD": {"they_owe": 30.0}}
    assert detail(me, p, "USD")["balances"]["they_owe"] == 0


def test_a_single_currency_user_sees_the_same_shapes_as_before():
    user = create_verified_user("dcur1")
    _post(user, "/accounts", {"name": "Bank", "type": "bank", "currency": "EUR", "opening_balance": 10})
    me = {"u": user, "s": user["session"]}
    p = person(me)
    debt(me, p, "add", amount=7)
    listed = next(x for x in ok(me, "get", "/people") if x["id"] == p["id"])
    assert "other_currencies" not in listed and listed["owes_me"] == 7
    assert ok(me, "get", "/debts/overview")["other_currencies"] == []
