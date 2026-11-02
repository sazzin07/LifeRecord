"""F-01: a freshly verified account can use Money straight away.

Before this, the starter categories existed only in the startup seed (attached to the owner), so a new account saw no
categories and, with no way to create a top-level account in the UI, could not enter its first expense."""
import asyncio

import requests

import starter_data
from database import AsyncSessionLocal
from support_auth import BASE_URL
from support_users import PASSWORD, api, create_verified_user, signup, verify

EXPECTED = ["Groceries", "Eating Out", "Transport", "Shopping", "Entertainment", "Work",
            "Fitness", "Health", "Travel", "Subscriptions", "Bills", "Other"]


def _categories(user):
    r = user["session"].get(api(user, "/categories"), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_starter_list_is_the_one_the_owner_has_always_had():
    assert [name for name, _icon, _colour in starter_data.STARTER_CATEGORIES] == EXPECTED
    assert all(c.startswith("#") and len(c) == 7 for _n, _i, c in starter_data.STARTER_CATEGORIES)


def test_verifying_a_new_account_creates_the_starter_categories():
    account = signup("onboard")
    unverified = requests.post(f"{BASE_URL}/api/auth/login", json={"email": account["email"], "password": account["password"]}, timeout=20)
    assert unverified.status_code == 200  # signed in but not verified yet: still nothing created
    user = verify(account)
    cats = _categories(user)
    assert sorted(c["name"] for c in cats) == sorted(EXPECTED)
    by_name = {c["name"]: c for c in cats}
    for name, icon, colour in starter_data.STARTER_CATEGORIES:
        assert (by_name[name]["icon"], by_name[name]["color"]) == (icon, colour)


def test_a_second_verification_attempt_adds_nothing():
    user = create_verified_user("onboard")
    again = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": user["email"], "code": "000000", "password": PASSWORD}, timeout=20)
    assert again.status_code == 400
    assert len(_categories(user)) == len(EXPECTED)


def test_each_new_user_gets_their_own_copy():
    a, b = create_verified_user("onboard"), create_verified_user("onboard")
    ids_a, ids_b = {c["id"] for c in _categories(a)}, {c["id"] for c in _categories(b)}
    assert len(ids_a) == len(ids_b) == len(EXPECTED) and ids_a.isdisjoint(ids_b)


def _ensure(user_id):
    async def go():
        async with AsyncSessionLocal() as db:
            added = await starter_data.ensure_starter_categories(db, user_id)
            await db.commit()
            return added
    return asyncio.run(go())


def test_ensure_starter_categories_is_idempotent():
    user = create_verified_user("onboard")
    assert _ensure(user["id"]) == 0
    assert len(_categories(user)) == len(EXPECTED)


def test_a_user_who_already_has_categories_is_left_alone():
    user = create_verified_user("onboard")
    for c in _categories(user):
        assert user["session"].delete(api(user, f"/categories/{c['id']}"), timeout=20).status_code == 200
    made = user["session"].post(api(user, "/categories"), json={"name": "Mine", "icon": "circle", "color": "#123456"}, timeout=20)
    assert made.status_code == 200, made.text
    assert _ensure(user["id"]) == 0
    assert [c["name"] for c in _categories(user)] == ["Mine"]


def test_a_new_user_has_no_accounts_and_no_balance_until_they_create_one():
    user = create_verified_user("onboard")
    assert user["session"].get(api(user, "/accounts"), timeout=20).json() == []


def test_the_first_account_and_first_expense_work_for_a_new_user():
    user = create_verified_user("onboard")
    s = user["session"]
    cash = s.post(api(user, "/accounts"), json={"name": "Money in hand", "type": "cash", "opening_balance": 50}, timeout=20)
    assert cash.status_code == 200, cash.text
    spend = s.post(api(user, "/transactions/expense"), json={
        "amount": 12.5, "merchant": "Corner shop", "description": "Corner shop", "category": "Groceries",
        "account": cash.json()["id"], "date": "2026-11-01"}, timeout=20)
    assert spend.status_code == 200, spend.text
    balances = {a["name"]: a["balance"] for a in s.get(api(user, "/accounts"), timeout=20).json()}
    assert balances == {"Money in hand": 37.5}


def test_money_is_never_booked_to_an_account_that_does_not_exist():
    """A new user has no accounts. Before this guard the API answered 200 and stored the transaction against 'cash',
    'revolut' or any text at all, where no balance would ever count it (the first expense was silently lost)."""
    user = create_verified_user("onboard")
    s = user["session"]
    expense = {"amount": 5, "merchant": "x", "description": "x", "category": "Groceries", "date": "2026-11-01"}
    for ref in ("cash", "revolut", "nonexistent", ""):
        r = s.post(api(user, "/transactions/expense"), json={**expense, "account": ref}, timeout=20)
        assert r.status_code == 400 and "account" in r.json()["detail"].lower(), (ref, r.text)
    r = s.post(api(user, "/transactions/income"), json={"account": "bank", "amount": 5, "description": "x", "date": "2026-11-01"}, timeout=20)
    assert r.status_code == 400, r.text
    r = s.post(api(user, "/transactions/transfer"), json={"from_account": "bank", "to_account": "cash", "amount": 5}, timeout=20)
    assert r.status_code == 400, r.text
    assert s.get(api(user, "/transactions"), timeout=20).json() == []
    # the same user, once they have an account, can book to it by id, by name and by the legacy alias
    acct = s.post(api(user, "/accounts"), json={"name": "Money in hand", "type": "cash", "opening_balance": 20}, timeout=20).json()
    for ref in (acct["id"], "Money in hand", "cash"):
        assert s.post(api(user, "/transactions/expense"), json={**expense, "amount": 1, "account": ref}, timeout=20).status_code == 200, ref
    balances = {a["name"]: a["balance"] for a in s.get(api(user, "/accounts"), timeout=20).json()}
    assert balances == {"Money in hand": 17.0}


def test_the_assistant_cannot_book_money_for_a_user_without_accounts():
    """The chat loop hands an HTTPException from a tool back to the model as {"error": ...}; this pins the message."""
    import pytest
    from fastapi import HTTPException

    import server
    user = create_verified_user("onboard")
    me = {"_id": user["id"], "email": user["email"], "name": "x", "role": "user"}

    async def attempt(name, args):
        async with server.AsyncSessionLocal() as db:
            with pytest.raises(HTTPException) as caught:
                await server.dispatch_tool(db, name, args, [], me, session_id="onboard-test")
            return caught.value

    for name, args in (("create_expense", {"amount": 5, "merchant": "Shop", "category": "Groceries"}),
                       ("record_income", {"amount": 5, "description": "Gift"})):
        exc = asyncio.run(attempt(name, args))
        assert exc.status_code == 400 and "account" in str(exc.detail).lower() and "Money" in str(exc.detail), (name, exc.detail)
    assert user["session"].get(api(user, "/transactions"), timeout=20).json() == []
