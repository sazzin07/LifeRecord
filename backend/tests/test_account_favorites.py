"""Every main account has a starred "Default" place, one place per main account is its favourite, one main account is the overall
favourite, and entries made against a main account (or with no account named) go to the favourite place. Money outside every place
only ever shows up when something unusual left some there. These tests drive it over HTTP, plus the start-up conversion of
existing money and the assistant's "from your favourite account?" question in-process."""
import asyncio
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import account_favorites  # noqa: E402
import server  # noqa: E402
import support_db  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from support_users import api, create_verified_user  # noqa: E402


class Person:
    def __init__(self):
        self.user = create_verified_user("alloc")
        self.s = self.user["session"]

    def call(self, method, path, **kw):
        return getattr(self.s, method)(api(self.user, path), timeout=60, **kw)

    def ok(self, method, path, **kw):
        r = self.call(method, path, **kw)
        assert r.status_code == 200, f"{method} {path}: {r.status_code} {r.text}"
        return r.json()

    def refused(self, method, path, **kw):
        r = self.call(method, path, **kw)
        assert r.status_code == 400, f"{method} {path} should be refused, got {r.status_code} {r.text}"
        return r.json()["detail"]

    def account(self, type_, name, balance=0, parent=None, **extra):
        body = {"name": name, "type": type_, "opening_balance": balance, **extra}
        if parent:
            body["parent_id"] = parent["id"]
        return self.ok("post", "/accounts", json=body)

    def accounts(self):
        return {a["id"]: a for a in self.ok("get", "/accounts")}

    def places(self, main):
        return {a["name"]: a for a in self.accounts().values() if a.get("parent_id") == main["id"]}

    def spend(self, account_ref, amount):
        return self.call("post", "/transactions/expense", json={"amount": amount, "merchant": "TEST", "account": account_ref, "participants": ["Me"]})


@pytest.fixture
def me():
    return Person()


def run(coro):
    return asyncio.run(coro)


# -- the Default place ---------------------------------------------------------------------------------------------------------

def test_a_new_main_account_opens_with_a_starred_default_place_holding_its_money(me):
    cash = me.account("cash", "Money in hand", 200)
    places = me.places(cash)
    assert list(places) == ["Default"] and places["Default"]["balance"] == 200 and places["Default"]["is_favorite"] is True
    main = me.accounts()[cash["id"]]
    assert main["total_balance"] == 200 and main["unallocated_balance"] == 0 and main["unplaced_balance"] == 0
    assert main["favorite_place_id"] == places["Default"]["id"] and main["place_count"] == 1
    assert me.ok("get", "/transactions") == [], "opening the account made no transfer or other record"


def test_the_default_place_has_the_kind_that_matches_its_main_account(me):
    assert list(me.places(me.account("revolut", "Revolut", 10)).values())[0]["type"] == "revolut_space"
    assert list(me.places(me.account("bank", "Bank", 10)).values())[0]["type"] == "bank_place"
    assert list(me.places(me.account("cash", "Money in hand", 10)).values())[0]["type"] == "cash_place"


def test_an_entry_against_a_main_account_goes_to_its_favourite_place(me):
    cash = me.account("cash", "Money in hand", 100)
    wallet = me.account("cash_place", "Wallet", 30, cash)
    assert me.spend(cash["id"], 10).status_code == 200
    places = me.places(cash)
    assert (places["Default"]["balance"], places["Wallet"]["balance"]) == (60, 30)
    me.ok("post", f"/accounts/{wallet['id']}/favorite")
    assert me.spend("cash", 5).status_code == 200, "the legacy word 'cash' follows the favourite too"
    places = me.places(cash)
    assert (places["Default"]["balance"], places["Wallet"]["balance"]) == (60, 25)
    assert places["Wallet"]["is_favorite"] is True and places["Default"]["is_favorite"] is False


def test_a_place_is_named_under_its_main_account_when_several_mains_have_a_default(me):
    cash, revolut = me.account("cash", "Money in hand", 50), me.account("revolut", "Revolut", 80)
    assert me.spend("Revolut › Default", 20).status_code == 200
    assert me.spend("Money in hand > Default", 5).status_code == 200
    assert me.places(revolut)["Default"]["balance"] == 60 and me.places(cash)["Default"]["balance"] == 45


def test_spending_more_than_the_favourite_place_holds_is_refused_even_when_other_places_have_money(me):
    cash = me.account("cash", "Money in hand", 100)
    me.account("cash_place", "Wallet", 90, cash)
    refused = me.spend(cash["id"], 20)
    assert refused.status_code == 400 and "€10.00" in refused.json()["detail"]


# -- the favourites ---------------------------------------------------------------------------------------------------------------

def test_one_main_account_is_the_overall_favourite_and_it_can_be_changed(me):
    cash, revolut = me.account("cash", "Money in hand", 50), me.account("revolut", "Revolut", 80)
    assert me.ok("get", "/accounts/favorite")["label"] == "Money in hand › Default", "the first one, until another is chosen"
    me.ok("post", f"/accounts/{revolut['id']}/favorite")
    assert me.ok("get", "/accounts/favorite") == {"main": {"id": revolut["id"], "name": "Revolut"}, "place": {"id": me.places(revolut)["Default"]["id"], "name": "Default"},
                                                  "label": "Revolut › Default"}
    accounts = me.accounts()
    assert accounts[revolut["id"]]["is_favorite"] is True and accounts[cash["id"]]["is_favorite"] is False


def test_nobody_can_star_or_move_someone_elses_account(me):
    other = Person()
    theirs = other.account("cash", "Their cash", 40)
    assert me.call("post", f"/accounts/{theirs['id']}/favorite").status_code == 404
    assert me.call("post", f"/accounts/{theirs['id']}/place-unplaced").status_code == 404
    assert other.ok("get", "/accounts/favorite")["label"] == "Their cash › Default"


def test_deleting_the_favourite_place_gives_its_money_and_its_star_to_the_next(me):
    cash = me.account("cash", "Money in hand", 100)
    wallet = me.account("cash_place", "Wallet", 20, cash)
    default = me.places(cash)["Default"]
    me.ok("delete", f"/accounts/{default['id']}")
    places = me.places(cash)
    assert list(places) == ["Wallet"] and places["Wallet"]["balance"] == 100 and places["Wallet"]["is_favorite"] is True
    assert wallet["id"] == places["Wallet"]["id"]


def test_the_only_place_of_a_main_account_cannot_be_deleted_or_hidden(me):
    cash = me.account("cash", "Money in hand", 10)
    default = me.places(cash)["Default"]
    assert "at least one place" in me.refused("delete", f"/accounts/{default['id']}")
    assert "at least one place" in me.refused("put", f"/accounts/{default['id']}", json={"is_active": False})
    assert me.places(cash)["Default"]["balance"] == 10


def test_setting_the_favourite_places_balance_is_a_deposit_or_withdrawal(me):
    cash = me.account("cash", "Money in hand", 100)
    me.account("cash_place", "Wallet", 30, cash)
    default = me.places(cash)["Default"]
    me.ok("put", f"/accounts/{default['id']}", json={"balance": 90})
    assert me.accounts()[cash["id"]]["total_balance"] == 120, "70 -> 90 is new money, the total grows by 20"


def test_a_transfer_from_a_main_account_moves_money_out_of_its_favourite_place(me):
    cash = me.account("cash", "Money in hand", 100)
    wallet = me.account("cash_place", "Wallet", 30, cash)
    me.ok("post", "/accounts/transfer", json={"from_account_id": cash["id"], "to_account_id": wallet["id"], "amount": 20})
    places = me.places(cash)
    assert (places["Default"]["balance"], places["Wallet"]["balance"]) == (50, 50)


# -- money outside every place ------------------------------------------------------------------------------------------------------

def test_money_left_on_the_main_account_itself_is_reported_and_one_call_places_it(me):
    cash = me.account("cash", "Money in hand", 100)
    # something unusual: an old-style income booked against the main account itself
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO transactions (id,user_id,type,gross_amount,personal_amount,reimbursable_amount,description,account,date,month,created_at) "
                        "VALUES (%s,%s,'income',15,0,0,'stray',%s,'2026-01-05','2026-01',%s)", (str(uuid.uuid4()), me.user["id"], cash["id"], "2026-01-05T00:00:00"))
        conn.commit()
    finally:
        conn.close()
    main = me.accounts()[cash["id"]]
    assert (main["unplaced_balance"], main["total_balance"]) == (15, 115)
    moved = me.ok("post", f"/accounts/{cash['id']}/place-unplaced")
    assert moved["moved"] == 15 and moved["place"]["name"] == "Default"
    main = me.accounts()[cash["id"]]
    assert (main["unplaced_balance"], main["total_balance"], me.places(cash)["Default"]["balance"]) == (0, 115, 115)


# -- existing money is converted at start-up ------------------------------------------------------------------------------------------

def test_start_up_gives_old_accounts_their_default_and_moves_the_unassigned_money_by_a_recorded_transfer(me):
    # an account made the old way: 200 on the main account, 50 of it set aside in a place, no Default, no favourite
    main_id, place_id, uid = str(uuid.uuid4()), str(uuid.uuid4()), me.user["id"]
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO accounts (id,user_id,name,type,parent_id,currency,opening_balance,is_locked,sort_order,is_active,created_at) VALUES "
                        "(%s,%s,'Old cash','cash',NULL,'EUR',200,0,0,1,'2026-01-01'),(%s,%s,'Wallet','cash_place',%s,'EUR',0,0,0,1,'2026-01-01')",
                        (main_id, uid, place_id, uid, main_id))
            cur.execute("INSERT INTO transactions (id,user_id,type,gross_amount,personal_amount,reimbursable_amount,description,account,from_account,to_account,date,month,created_at) "
                        "VALUES (%s,%s,'transfer',50,0,0,'Set aside',%s,%s,%s,'2026-01-02','2026-01','2026-01-02T00:00:00')", (str(uuid.uuid4()), uid, main_id, main_id, place_id))
        conn.commit()
    finally:
        conn.close()
    before = me.accounts()[main_id]
    assert (before["unallocated_balance"], before["total_balance"]) == (150, 200)

    async def convert():
        return await account_favorites.ensure_all(server, AsyncSessionLocal)
    assert run(convert()) >= 1
    after = me.accounts()
    assert (after[main_id]["unallocated_balance"], after[main_id]["unplaced_balance"], after[main_id]["total_balance"]) == (0, 0, 200)
    places = me.places({"id": main_id})
    assert (places["Default"]["balance"], places["Wallet"]["balance"], places["Default"]["is_favorite"]) == (150, 50, True)
    moves = [t for t in me.ok("get", "/transactions") if t["type"] == "transfer" and t["description"] == "Moved into Default"]
    assert len(moves) == 1 and moves[0]["gross_amount"] == 150, "the conversion is on record"
    assert run(convert()) == 0 and len([t for t in me.ok("get", "/transactions") if t["description"] == "Moved into Default"]) == 1, "and it runs only once"


# -- the assistant ------------------------------------------------------------------------------------------------------------------

async def _call(user, name, args):
    created = []
    async with AsyncSessionLocal() as db:
        who = {"_id": user["id"], "email": user["email"], "name": user["name"], "role": "user"}
        return await server.dispatch_tool(db, name, args, created, who, session_id="sess-fav", previewed_this_turn=set()), created


def test_an_expense_or_income_without_an_account_is_not_recorded_and_the_assistant_is_told_what_to_ask(me):
    cash = me.account("cash", "Money in hand", 100)
    revolut = me.account("revolut", "Revolut", 50)
    me.ok("post", f"/accounts/{revolut['id']}/favorite")
    for tool, args in (("create_expense", {"amount": 12, "merchant": "Cafe"}), ("record_income", {"amount": 12, "description": "Gift"}), ("create_expense", {"amount": 5, "account": "  "})):
        answer, created = run(_call(me.user, tool, args))
        assert answer["needs_confirmation"] is True and answer["recorded"] is False and created == []
        assert answer["favorite"] == "Revolut › Default" and "Money in hand › Default" in answer["options"] and "Revolut › Default" in answer["options"]
        assert "favorite account (Revolut › Default)" in answer["message"]
    assert me.ok("get", "/transactions") == [], "nothing was booked"
    assert me.places(cash)["Default"]["balance"] == 100 and me.places(revolut)["Default"]["balance"] == 50


def test_once_the_user_answers_the_assistant_records_it_in_the_named_place(me):
    me.account("cash", "Money in hand", 100)
    revolut = me.account("revolut", "Revolut", 50)
    answer, created = run(_call(me.user, "create_expense", {"amount": 12, "merchant": "Cafe", "account": "Revolut › Default"}))
    assert "transaction" in answer and created and me.places(revolut)["Default"]["balance"] == 38
    answer, _ = run(_call(me.user, "record_income", {"amount": 7, "description": "Gift", "account": "Money in hand"}))
    assert answer.get("id")


def test_the_assistant_can_name_a_main_account_for_balances_and_new_places_without_landing_on_its_favourite_place(me):
    cash = me.account("cash", "Money in hand", 100)
    answer, _ = run(_call(me.user, "create_money_space", {"parent": "Money in hand", "name": "Jar", "balance": 25}))
    assert answer.get("id") and me.places(cash)["Jar"]["balance"] == 25 and me.places(cash)["Default"]["balance"] == 75
    answer, _ = run(_call(me.user, "update_account_balance", {"account": "Money in hand", "balance": 140}))
    assert me.accounts()[cash["id"]]["total_balance"] == 140, "a balance set on the main account is its total"
