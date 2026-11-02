"""A main account and its sub-accounts are one amount of money.

The main account's balance is the total; sub-accounts are allocations of it; what is not allocated is the main
account's unallocated balance. total == unallocated + sum(sub-accounts) must hold after every operation, and no
operation may create money from nothing, count it twice or leave an account below zero.
Each test signs up its own throw-away person, so nothing is shared with other modules."""
import threading

import pytest

from support_users import api, create_verified_user


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

    def main(self, type_="cash", name="Money in hand", balance=200):
        return self.account(type_, name, balance)

    def sub(self, parent, name, amount, new_money=False, type_="cash_place"):
        return self.account(type_, name, amount, parent, add_as_new_money=new_money)

    def state(self, main):
        """The main account's three figures and its sub-accounts' balances, after checking they add up."""
        accounts = self.ok("get", "/accounts")
        root = next(a for a in accounts if a["id"] == main["id"])
        subs = {a["name"]: a["balance"] for a in accounts if a["parent_id"] == main["id"]}
        out = {"total": root["total_balance"], "unallocated": root["unallocated_balance"],
               "allocated": root["allocated_balance"], "subs": subs}
        assert root["balance"] == out["total"], "a main account's balance is its total"
        assert out["unallocated"] >= 0, f"unallocated went negative: {out}"
        assert all(v >= 0 for v in subs.values()), f"a sub-account went negative: {out}"
        assert round(out["unallocated"] + sum(subs.values()), 2) == out["total"], f"does not add up: {out}"
        assert round(sum(subs.values()), 2) == out["allocated"], f"allocated is wrong: {out}"
        return out

    def expense(self, account, amount):
        return self.call("post", "/transactions/expense", json={"amount": amount, "merchant": "TEST", "account": account["id"], "participants": ["Me"]})

    def income(self, account, amount):
        return self.call("post", "/transactions/income", json={"amount": amount, "account": account["id"], "description": "TEST"})

    def transfer(self, src, dst, amount):
        return self.call("post", "/accounts/transfer", json={"from_account_id": src["id"], "to_account_id": dst["id"], "amount": amount})


@pytest.fixture
def me():
    return Person()


def test_a_new_sub_account_is_carved_out_of_the_main_account_not_added_to_it(me):
    cash = me.main(balance=200)
    me.sub(cash, "Wallet", 50)
    assert me.state(cash) == {"total": 200, "unallocated": 150, "allocated": 50, "subs": {"Wallet": 50}}
    me.sub(cash, "Jar", 30)
    assert me.state(cash) == {"total": 200, "unallocated": 120, "allocated": 80, "subs": {"Wallet": 50, "Jar": 30}}


def test_allocating_more_than_is_available_is_refused_and_says_how_much_is_available(me):
    cash = me.main(balance=200)
    me.sub(cash, "Wallet", 50)
    detail = me.refused("post", "/accounts", json={"name": "Greedy", "type": "cash_place", "parent_id": cash["id"], "opening_balance": 160})
    assert "exceeds the available balance of €150.00" in detail and "€160.00" in detail
    assert me.state(cash) == {"total": 200, "unallocated": 150, "allocated": 50, "subs": {"Wallet": 50}}  # nothing was created


def test_allocating_exactly_what_is_available_is_allowed(me):
    cash = me.main(balance=200)
    me.sub(cash, "Everything", 200)
    assert me.state(cash) == {"total": 200, "unallocated": 0, "allocated": 200, "subs": {"Everything": 200}}


def test_new_money_raises_the_main_total_when_asked_for(me):
    cash = me.main(balance=200)
    me.sub(cash, "Wallet", 50)
    me.sub(cash, "Gift", 40, new_money=True)
    assert me.state(cash) == {"total": 240, "unallocated": 150, "allocated": 90, "subs": {"Wallet": 50, "Gift": 40}}


def test_new_money_is_not_limited_by_the_unallocated_balance(me):
    cash = me.main(balance=10)
    me.sub(cash, "Big", 500, new_money=True)
    assert me.state(cash) == {"total": 510, "unallocated": 10, "allocated": 500, "subs": {"Big": 500}}


def test_a_sub_account_started_empty_changes_nothing(me):
    cash = me.main(balance=200)
    me.sub(cash, "Empty", 0)
    assert me.state(cash) == {"total": 200, "unallocated": 200, "allocated": 0, "subs": {"Empty": 0}}


def test_moving_money_between_sub_accounts_keeps_the_total(me):
    cash = me.main(balance=200)
    a, b = me.sub(cash, "A", 50), me.sub(cash, "B", 30)
    me.ok("post", "/accounts/transfer", json={"from_account_id": a["id"], "to_account_id": b["id"], "amount": 20})
    assert me.state(cash) == {"total": 200, "unallocated": 120, "allocated": 80, "subs": {"A": 30, "B": 50}}
    detail = me.refused("post", "/accounts/transfer", json={"from_account_id": a["id"], "to_account_id": b["id"], "amount": 31})
    assert "exceeds the available balance of €30.00" in detail


def test_funding_a_sub_account_by_transfer_is_limited_to_the_unallocated_balance(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    detail = me.refused("post", "/accounts/transfer", json={"from_account_id": cash["id"], "to_account_id": a["id"], "amount": 151})
    assert "exceeds the available balance of €150.00" in detail
    me.ok("post", "/accounts/transfer", json={"from_account_id": cash["id"], "to_account_id": a["id"], "amount": 150})
    assert me.state(cash) == {"total": 200, "unallocated": 0, "allocated": 200, "subs": {"A": 200}}


def test_the_other_transfer_endpoint_is_held_to_the_same_rule(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    detail = me.refused("post", "/transactions/transfer", json={"from_account": cash["id"], "to_account": a["id"], "amount": 151})
    assert "exceeds the available balance of €150.00" in detail
    assert me.state(cash)["unallocated"] == 150


def test_a_deposit_adds_to_the_total_and_a_withdrawal_takes_from_it(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    me.ok("post", "/transactions/income", json={"amount": 25, "account": a["id"], "description": "TEST"})
    assert me.state(cash) == {"total": 225, "unallocated": 150, "allocated": 75, "subs": {"A": 75}}
    me.ok("post", "/transactions/income", json={"amount": 10, "account": cash["id"], "description": "TEST"})
    assert me.state(cash)["total"] == 235 and me.state(cash)["unallocated"] == 160
    me.expense(a, 15).raise_for_status()
    me.expense(cash, 60).raise_for_status()
    assert me.state(cash) == {"total": 160, "unallocated": 100, "allocated": 60, "subs": {"A": 60}}


def test_spending_more_than_a_sub_account_holds_is_refused(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    r = me.expense(a, 60)
    assert r.status_code == 400 and "€50.00" in r.json()["detail"]
    assert me.state(cash)["subs"] == {"A": 50}


def test_the_main_account_cannot_spend_money_that_is_allocated_to_sub_accounts(me):
    cash = me.main(balance=200)
    me.sub(cash, "A", 50)
    r = me.expense(cash, 160)  # the total is 200 but only 150 is not allocated
    assert r.status_code == 400 and "€150.00" in r.json()["detail"]
    assert me.expense(cash, 150).status_code == 200
    assert me.state(cash) == {"total": 50, "unallocated": 0, "allocated": 50, "subs": {"A": 50}}


def test_a_refused_operation_leaves_no_trace_in_the_history(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    before = len(me.ok("get", "/transactions"))
    assert me.expense(a, 60).status_code == 400
    assert me.transfer(cash, a, 999).status_code == 400
    assert len(me.ok("get", "/transactions")) == before


def test_deleting_or_editing_a_transaction_cannot_overdraw_an_account(me):
    cash = me.main(balance=0)
    a = me.sub(cash, "A", 0)
    dep = me.income(a, 100).json()
    spend = me.expense(a, 80).json()["transaction"]
    me.refused("delete", f"/transactions/{dep['id']}")  # would leave A at -80
    me.refused("put", f"/transactions/{spend['id']}", json={"amount": 120})  # would leave A at -20
    me.ok("put", f"/transactions/{spend['id']}", json={"amount": 100})
    assert me.state(cash)["subs"] == {"A": 0}
    me.ok("delete", f"/transactions/{spend['id']}")
    assert me.state(cash)["subs"] == {"A": 100}


def test_raising_a_sub_accounts_balance_takes_the_difference_from_the_unallocated_balance(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    me.ok("put", f"/accounts/{a['id']}", json={"balance": 80})
    assert me.state(cash) == {"total": 200, "unallocated": 120, "allocated": 80, "subs": {"A": 80}}
    detail = me.refused("put", f"/accounts/{a['id']}", json={"balance": 201})
    assert "exceeds the available balance of €120.00" in detail
    assert me.state(cash)["subs"] == {"A": 80}


def test_lowering_a_sub_accounts_balance_gives_the_difference_back(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    me.ok("put", f"/accounts/{a['id']}", json={"balance": 20})
    assert me.state(cash) == {"total": 200, "unallocated": 180, "allocated": 20, "subs": {"A": 20}}


def test_raising_a_sub_accounts_balance_can_be_new_money(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    me.ok("put", f"/accounts/{a['id']}", json={"balance": 90, "add_as_new_money": True})
    assert me.state(cash) == {"total": 240, "unallocated": 150, "allocated": 90, "subs": {"A": 90}}


def test_renaming_a_sub_account_does_not_touch_the_money(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    me.ok("put", f"/accounts/{a['id']}", json={"name": "Renamed", "balance": 50})
    assert me.state(cash) == {"total": 200, "unallocated": 150, "allocated": 50, "subs": {"Renamed": 50}}


def test_setting_the_main_total_changes_the_unallocated_part_only(me):
    cash = me.main(balance=200)
    me.sub(cash, "A", 50)
    me.ok("put", f"/accounts/{cash['id']}", json={"balance": 300})
    assert me.state(cash) == {"total": 300, "unallocated": 250, "allocated": 50, "subs": {"A": 50}}
    detail = me.refused("put", f"/accounts/{cash['id']}", json={"balance": 40})
    assert "€50.00" in detail and "sub-accounts" in detail
    assert me.state(cash)["total"] == 300


def test_deleting_a_sub_account_returns_its_money_to_the_unallocated_balance(me):
    cash = me.main(balance=200)
    a, _ = me.sub(cash, "A", 50), me.sub(cash, "B", 30)
    me.ok("delete", f"/accounts/{a['id']}")
    assert me.state(cash) == {"total": 200, "unallocated": 170, "allocated": 30, "subs": {"B": 30}}


def test_deleting_a_sub_account_with_history_keeps_the_money_and_the_history(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    me.expense(a, 10).raise_for_status()
    me.income(a, 5).raise_for_status()
    me.ok("delete", f"/accounts/{a['id']}")
    assert me.state(cash) == {"total": 195, "unallocated": 195, "allocated": 0, "subs": {}}
    history = me.ok("get", "/transactions")
    assert any(t["account"] == a["id"] and t["type"] == "expense" for t in history)


def test_deleting_new_money_sub_account_keeps_that_money_in_the_main_account(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "Gift", 40, new_money=True)
    me.ok("delete", f"/accounts/{a['id']}")
    assert me.state(cash) == {"total": 240, "unallocated": 240, "allocated": 0, "subs": {}}


def test_deactivating_a_sub_account_also_returns_its_money(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "A", 50)
    me.ok("put", f"/accounts/{a['id']}", json={"is_active": False})
    assert me.state(cash) == {"total": 200, "unallocated": 200, "allocated": 0, "subs": {}}


def test_a_main_account_with_sub_accounts_cannot_be_deleted(me):
    cash = me.main(balance=0)
    me.sub(cash, "A", 0)
    assert "sub-account" in me.refused("delete", f"/accounts/{cash['id']}").lower()


def test_main_accounts_are_independent_of_each_other(me):
    cash, revolut = me.main("cash", "Money in hand", 200), me.main("revolut", "Revolut", 100)
    me.sub(cash, "Wallet", 50)
    rev_space = me.sub(revolut, "Holiday", 70, type_="revolut_space")
    assert me.state(cash) == {"total": 200, "unallocated": 150, "allocated": 50, "subs": {"Wallet": 50}}
    assert me.state(revolut) == {"total": 100, "unallocated": 30, "allocated": 70, "subs": {"Holiday": 70}}
    detail = me.refused("post", "/accounts", json={"name": "Too much", "type": "revolut_space", "parent_id": revolut["id"], "opening_balance": 31})
    assert "€30.00" in detail  # Money in hand's 150 is not Revolut's to give
    me.ok("post", "/accounts/transfer", json={"from_account_id": rev_space["id"], "to_account_id": cash["id"], "amount": 20})
    assert me.state(cash)["total"] == 220 and me.state(revolut)["total"] == 80


def test_the_summary_counts_a_main_account_once(me):
    cash = me.main(balance=200)
    me.sub(cash, "A", 50)
    me.sub(cash, "Gift", 30, new_money=True)
    s = me.ok("get", "/analytics/summary")
    assert round(s["cash_available"] + s["cash_locked"], 2) == s["cash"] == 230  # 200 + 30 new; the 50 is not counted again


def test_a_locked_sub_account_is_part_of_the_total_but_not_available(me):
    cash = me.main(balance=200)
    me.account("cash_place", "Envelope", 60, cash, is_locked=True)
    s = me.ok("get", "/analytics/summary")
    assert s["cash"] == 200 and s["cash_locked"] == 60 and s["cash_available"] == 140


def test_a_sub_account_cannot_have_sub_accounts_and_money_cannot_change_main_account_by_moving_parent(me):
    cash, revolut = me.main("cash", "Money in hand", 200), me.main("revolut", "Revolut", 100)
    a = me.sub(cash, "A", 50)
    me.refused("post", "/accounts", json={"name": "Nested", "type": "cash_place", "parent_id": a["id"], "opening_balance": 0})
    me.refused("put", f"/accounts/{a['id']}", json={"parent_id": revolut["id"]})  # would move 50 between mains
    assert me.state(cash)["total"] == 200 and me.state(revolut)["total"] == 100


def test_simultaneous_allocations_cannot_hand_out_the_same_money_twice(me):
    cash = me.main(balance=200)
    me.sub(cash, "Existing", 50)  # 150 left to give
    results = []

    def allocate(i):
        r = me.call("post", "/accounts", json={"name": f"Race{i}", "type": "cash_place", "parent_id": cash["id"], "opening_balance": 40})
        results.append(r.status_code)

    threads = [threading.Thread(target=allocate, args=(i,)) for i in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [200] * 3 + [400] * 5, results  # 3 x 40 fit in 150; the rest are refused
    st = me.state(cash)
    assert st["total"] == 200 and st["unallocated"] == 30


def test_simultaneous_spending_cannot_overdraw_a_sub_account(me):
    cash = me.main(balance=100)
    a = me.sub(cash, "A", 100)
    results = []

    def spend():
        results.append(me.expense(a, 30).status_code)

    threads = [threading.Thread(target=spend) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [200] * 3 + [400] * 5, results
    assert me.state(cash) == {"total": 10, "unallocated": 0, "allocated": 10, "subs": {"A": 10}}


def test_simultaneous_transfers_in_both_directions_keep_the_total(me):
    cash = me.main(balance=200)
    a, b = me.sub(cash, "A", 100), me.sub(cash, "B", 100)
    results = []

    def move(src, dst):
        results.append(me.transfer(src, dst, 30).status_code)

    threads = [threading.Thread(target=move, args=(a, b) if i % 2 else (b, a)) for i in range(10)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert set(results) == {200}
    st = me.state(cash)
    assert st["total"] == 200 and st["unallocated"] == 0


def test_money_with_cents_adds_up_exactly(me):
    cash = me.main(balance=100.10)
    me.sub(cash, "A", 33.33)
    me.sub(cash, "B", 33.33)
    me.sub(cash, "C", 33.33)
    assert me.state(cash) == {"total": 100.10, "unallocated": 0.11, "allocated": 99.99, "subs": {"A": 33.33, "B": 33.33, "C": 33.33}}
    me.refused("post", "/accounts", json={"name": "D", "type": "cash_place", "parent_id": cash["id"], "opening_balance": 0.12})
    me.sub(cash, "D", 0.11)
    assert me.state(cash)["unallocated"] == 0


def test_an_account_without_sub_accounts_behaves_as_before(me):
    bank = me.main("bank", "Bank", 100)
    assert me.expense(bank, 30).status_code == 200
    s = me.ok("get", "/accounts")
    assert s[0]["balance"] == 70
    assert me.ok("put", f"/accounts/{bank['id']}", json={"balance": 55})["opening_balance"] is not None
    assert me.ok("get", "/accounts")[0]["balance"] == 55


def test_history_keeps_the_names_of_places_that_were_deleted(me):
    cash = me.main(balance=200)
    a = me.sub(cash, "Trip fund", 50)
    me.expense(a, 10).raise_for_status()
    me.ok("delete", f"/accounts/{a['id']}")
    history = me.ok("get", "/transactions")
    spent = next(t for t in history if t["type"] == "expense")
    assert spent["account_name"] == "Trip fund"
    moves = [t for t in history if t["type"] == "transfer"]
    assert {(t["from_account_name"], t["to_account_name"]) for t in moves} == {("Money in hand", "Trip fund"), ("Trip fund", "Money in hand")}


def test_a_main_account_says_how_many_places_it_has(me):
    cash, bank = me.main(balance=200), me.main("bank", "Bank", 50)
    me.sub(cash, "Empty", 0)
    me.sub(cash, "Wallet", 30)
    by_name = {a["name"]: a for a in me.ok("get", "/accounts")}
    assert by_name["Money in hand"]["place_count"] == 2
    assert by_name["Bank"]["place_count"] == 0
    wallet = by_name["Wallet"]
    me.ok("delete", f"/accounts/{wallet['id']}")
    assert {a["name"]: a for a in me.ok("get", "/accounts")}["Money in hand"]["place_count"] == 1


def test_editing_a_main_account_answers_with_its_total_not_just_the_unassigned_part(me):
    cash = me.main(balance=200)
    me.sub(cash, "Wallet", 50)
    answer = me.ok("put", f"/accounts/{cash['id']}", json={"name": "Cash box"})
    assert (answer["balance"], answer["total_balance"], answer["unallocated_balance"], answer["allocated_balance"], answer["place_count"]) == (200, 200, 150, 50, 1)
    answer = me.ok("put", f"/accounts/{cash['id']}", json={"balance": 260})
    assert (answer["balance"], answer["unallocated_balance"]) == (260, 210)
