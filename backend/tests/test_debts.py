"""Two independent balances per person: they owe me / I owe them, entered by hand, paid, cleared, corrected and undone.

Each test signs up its own throw-away person. What is pinned: the balances are never netted; adjustments make no expense and no payment;
a payment is real (history, and an account only when one is chosen); an overpayment asks what the extra is before recording anything;
clearing is not a payment and keeps an audit trail with Restore; a mistake is undone by a cancelling line; expense splits count once;
deleting a person archives them; nobody reaches another person's records; simultaneous and repeated requests change the balance exactly
once; and a refused request leaves nothing behind. Everything over HTTP, so the rules are the ones the screen and the assistant get."""
import threading
import uuid

import pytest

from support_users import api, create_verified_user

THEY, I = "they_owe", "i_owe"


class Me:
    def __init__(self):
        self.user = create_verified_user("alloc")
        self.s = self.user["session"]

    def call(self, method, path, **kw):
        return getattr(self.s, method)(api(self.user, path), timeout=60, **kw)

    def ok(self, method, path, **kw):
        r = self.call(method, path, **kw)
        assert r.status_code == 200, f"{method} {path}: {r.status_code} {r.text}"
        return r.json()

    def refused(self, method, path, status=400, **kw):
        r = self.call(method, path, **kw)
        assert r.status_code == status, f"{method} {path} should be {status}, got {r.status_code} {r.text}"
        return r.json()["detail"]

    def person(self, name=None):
        return self.ok("post", "/people", json={"name": name or f"P_{uuid.uuid4().hex[:6]}"})

    def debt(self, person, op, direction=THEY, **body):
        return self.call("post", f"/debts/people/{person['id']}/adjust/{op}", json={"direction": direction, **body})

    def do(self, person, op, direction=THEY, **body):
        r = self.debt(person, op, direction, **body)
        assert r.status_code == 200, r.text
        return r.json()

    def pay(self, person, direction, amount, **body):
        return self.call("post", f"/debts/people/{person['id']}/payments", json={"direction": direction, "amount": amount, **body})

    def view(self, person):
        return self.ok("get", f"/debts/people/{person['id']}")

    def owed(self, person):
        b = self.view(person)["balances"]
        return b["they_owe_cents"], b["i_owe_cents"]

    def account(self, name="Money in hand", type_="cash", balance=500):
        return self.ok("post", "/accounts", json={"name": name, "type": type_, "opening_balance": balance})

    def total(self, account):
        return next(a["balance"] for a in self.ok("get", "/accounts") if a["id"] == account["id"])


@pytest.fixture
def me():
    return Me()


# -- two independent balances -------------------------------------------------------------------------------------------------------

def test_the_two_balances_are_independent_and_never_netted(me):
    ferreira = me.person("Ferreira")
    me.do(ferreira, "add", THEY, amount=100)
    me.do(ferreira, "add", I, amount=20)
    assert me.owed(ferreira) == (10000, 2000)
    listed = next(p for p in me.ok("get", "/people") if p["id"] == ferreira["id"])
    assert (listed["owes_me"], listed["i_owe"]) == (100, 20), "the list shows both, not 80"
    overview = me.ok("get", "/debts/overview")
    assert (overview["they_owe"], overview["i_owe"], overview["people_with_debt"]) == (100, 20, 1)


def test_adding_increasing_and_reducing_a_debt_changes_only_that_balance(me):
    p = me.person()
    me.do(p, "add", THEY, amount=20)
    assert me.do(p, "add", THEY, amount=10, description="lunch")["balances"]["they_owe"] == 30
    reduced = me.do(p, "reduce", THEY, amount=5)
    assert reduced["balances"]["they_owe"] == 25 and "Reduced by €5.00" in reduced["message"]
    assert me.owed(p) == (2500, 0)


def test_reducing_by_more_than_is_owed_is_refused_and_nothing_changes(me):
    p = me.person("Maria")
    me.do(p, "add", I, amount=10)
    detail = me.refused("post", f"/debts/people/{p['id']}/adjust/reduce", json={"direction": I, "amount": 15})
    assert "€10.00" in detail and "payment" in detail
    assert me.owed(p) == (0, 1000) and len(me.view(p)["items"]) == 1


def test_adjustments_create_no_expense_and_no_payment(me):
    p = me.person()
    cash = me.account()
    me.do(p, "add", THEY, amount=40)
    me.do(p, "reduce", THEY, amount=5)
    me.do(p, "correct", THEY, new_amount=12)
    me.do(p, "clear", THEY)
    assert me.ok("get", "/transactions") == []
    assert me.total(cash) == 500
    assert me.call("get", "/debts/overview").json()["recent"][0]["kind"] in ("clear", "correct", "reduce", "add")
    assert [i for i in me.view(p)["items"] if i["kind"].startswith("payment")] == [], "no payment was recorded"


def test_money_is_exact_in_cents(me):
    p = me.person()
    for _ in range(100):
        me.do(p, "add", THEY, amount=0.01)
    assert me.owed(p) == (100, 0)
    me.do(p, "add", THEY, amount=0.1)
    me.do(p, "add", THEY, amount=0.2)
    assert me.owed(p) == (130, 0), "0.1 + 0.2 is 30 cents, not 30.000000000000004"
    assert me.refused("post", f"/debts/people/{p['id']}/adjust/add", status=422, json={"direction": THEY, "amount": 0}) is not None


def test_a_correction_sets_the_balance_and_keeps_both_lines(me):
    p = me.person()
    me.do(p, "add", THEY, amount=50)
    out = me.do(p, "correct", THEY, new_amount=35, description="miscounted")
    assert out["balances"]["they_owe"] == 35
    kinds = [i["kind"] for i in me.view(p)["items"]]
    assert kinds.count("add") == 1 and kinds.count("correct") == 1, "the first entry is not overwritten"
    assert "already" in me.refused("post", f"/debts/people/{p['id']}/adjust/correct", json={"direction": THEY, "new_amount": 35})


def test_the_history_adds_up_to_the_balance(me):
    p = me.person()
    me.do(p, "add", THEY, amount=30)
    me.do(p, "add", I, amount=12.5)
    me.do(p, "reduce", THEY, amount=4)
    me.do(p, "correct", THEY, new_amount=40)
    view = me.view(p)
    for direction, key in ((THEY, "they_owe_cents"), (I, "i_owe_cents")):
        assert sum(i["effect_cents"] for i in view["items"] if i["direction"] == direction) == view["balances"][key], direction


# -- payments -----------------------------------------------------------------------------------------------------------------------

def test_a_payment_is_real_it_lowers_the_debt_and_is_in_the_payment_history(me):
    p = me.person("Ferreira")
    me.do(p, "add", THEY, amount=30)
    done = me.ok("post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 10})
    assert done["balances"]["they_owe"] == 20 and done["payment"]["recorded_in_account"] is False
    item = next(i for i in me.view(p)["items"] if i["kind"] == "payment_in")
    assert item["effect_cents"] == -1000 and item["origin"] == "payment"
    assert me.owed(p) == (2000, 0), "a payment in does not touch what I owe them"


def test_a_payment_moves_an_account_only_when_one_is_chosen(me):
    cash = me.account(balance=100)
    p = me.person()
    me.do(p, "add", THEY, amount=50)
    me.ok("post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 5})
    assert me.total(cash) == 100, "no account named: the money was not tracked in any account"
    me.ok("post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 8, "account": cash["id"]})
    assert me.total(cash) == 108
    me.do(p, "add", I, amount=20)
    me.ok("post", f"/debts/people/{p['id']}/payments", json={"direction": "out", "amount": 6, "account": cash["id"], "method": "Cash"})
    assert me.total(cash) == 102 and me.owed(p) == (3700, 1400)
    assert me.refused("post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 1, "account": "nope"})
    assert me.owed(p) == (3700, 1400), "a refused payment leaves no settlement behind"


def test_a_payment_larger_than_the_debt_asks_what_the_extra_is_and_records_nothing_until_told(me):
    p = me.person("Ferreira")
    cash = me.account(balance=0)
    me.do(p, "add", THEY, amount=20)
    asked = me.ok("post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 30, "account": cash["id"]})
    assert asked["needs_excess_choice"] is True and (asked["outstanding"], asked["excess"]) == (20, 10)
    assert {o["value"] for o in asked["options"]} == {"opposite", "tip"}
    assert next(o["label"] for o in asked["options"] if o["value"] == "opposite") == "I owe Ferreira the extra €10.00", "the choice says who owes whom"
    assert me.owed(p) == (2000, 0) and me.total(cash) == 0 and me.ok("get", "/transactions") == [], "nothing was recorded"

    tip = me.ok("post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 30, "account": cash["id"], "excess": "tip"})
    assert tip["balances"]["they_owe"] == 0 and tip["balances"]["i_owe"] == 0 and me.total(cash) == 30, "the whole €30 really arrived"

    q = me.person("Maria")
    me.do(q, "add", I, amount=5)
    opposite = me.ok("post", f"/debts/people/{q['id']}/payments", json={"direction": "out", "amount": 8, "excess": "opposite"})
    assert (opposite["balances"]["i_owe"], opposite["balances"]["they_owe"]) == (0, 3), "the €3 extra is now a debt the other way"
    assert "debt the other way" in opposite["message"]


def test_deleting_a_payment_also_cancels_the_extra_it_made(me):
    p = me.person()
    me.do(p, "add", THEY, amount=10)
    done = me.ok("post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 15, "excess": "opposite"})
    assert me.owed(p) == (0, 500)
    me.ok("delete", f"/settlements/{done['payment']['id']}")
    assert me.owed(p) == (1000, 0), "back to the debt before the payment, nothing left over"


# -- clearing ------------------------------------------------------------------------------------------------------------------------

def test_clearing_removes_the_amount_without_a_payment_and_keeps_an_audit_trail_with_restore(me):
    p = me.person("Ferreira")
    cash = me.account()
    me.do(p, "add", THEY, amount=30)
    me.do(p, "add", THEY, amount=20)
    cleared = me.do(p, "clear", THEY, description="forget it")
    assert cleared["balances"]["they_owe"] == 0 and "no payment" in cleared["message"]
    view = me.view(p)
    assert view["items"] == [] and me.ok("get", "/transactions") == [] and me.total(cash) == 500, "gone from view; no payment, no account change"
    assert not me.call("get", f"/settlements").status_code == 0
    cleared_entry = next(a for a in view["audit"] if a["kind"] == "clear" and a["can_restore"])
    assert len([a for a in view["audit"] if a["state"] == "cleared"]) == 2, "both lines are kept as cleared"
    back = me.ok("post", f"/debts/entries/{cleared_entry['id']}/reverse")
    assert back["balances"]["they_owe"] == 50 and len(me.view(p)["items"]) == 2, "Restore brings the amount and the lines back"


def test_clearing_one_line_leaves_the_rest(me):
    p = me.person()
    me.do(p, "add", THEY, amount=30)
    me.do(p, "add", THEY, amount=20)
    target = next(i for i in me.view(p)["items"] if i["effect_cents"] == 2000)
    out = me.do(p, "clear_line", None, line_type=target["ref_type"], line_id=target["ref_id"])
    assert out["balances"]["they_owe"] == 30 and [i["effect_cents"] for i in me.view(p)["items"]] == [3000]
    assert "already" in me.refused("post", f"/debts/people/{p['id']}/adjust/clear_line", json={"line_type": "entry", "line_id": target["ref_id"]})


def test_clearing_when_nothing_is_owed_is_refused(me):
    p = me.person()
    assert "nothing" in me.refused("post", f"/debts/people/{p['id']}/adjust/clear", json={"direction": THEY}).lower()
    assert "nothing" in me.refused("post", f"/debts/people/{p['id']}/adjust/clear", json={"direction": "both"}).lower()


def test_clearing_both_directions_and_each_clear_is_separate_from_a_payment(me):
    p = me.person()
    me.do(p, "add", THEY, amount=9)
    me.do(p, "add", I, amount=4)
    me.do(p, "clear", "both")
    assert me.owed(p) == (0, 0)
    assert me.ok("get", "/transactions") == []


# -- undo ----------------------------------------------------------------------------------------------------------------------------

def test_an_entry_is_undone_by_a_cancelling_line_and_only_once(me):
    p = me.person()
    first = me.do(p, "add", THEY, amount=10)
    me.do(p, "add", THEY, amount=5)
    entry = first["entries"][0]
    assert me.ok("post", f"/debts/entries/{entry['id']}/reverse")["balances"]["they_owe"] == 5
    assert "already" in me.refused("post", f"/debts/entries/{entry['id']}/reverse")
    audit = me.view(p)["audit"]
    assert {a["kind"] for a in audit} >= {"reversal"} and any(a["state"] == "reversed" for a in audit), "the original stays in the audit list"


def test_an_entry_cannot_be_undone_when_later_changes_need_it(me):
    p = me.person()
    entry = me.do(p, "add", THEY, amount=10)["entries"][0]
    me.ok("post", f"/debts/people/{p['id']}/payments", json={"direction": "in", "amount": 10})
    assert "below zero" in me.refused("post", f"/debts/entries/{entry['id']}/reverse")
    assert me.owed(p) == (0, 0)


# -- expense splits ------------------------------------------------------------------------------------------------------------------

def test_an_expense_split_counts_once_beside_manual_debt_and_i_owe_works_for_expenses_they_paid(me):
    cash = me.account(balance=300)
    ferreira = me.person("Ferreira")
    spend = me.call("post", "/transactions/expense", json={"amount": 60, "merchant": "Dinner", "account": cash["id"], "participants": ["Me", "Ferreira"], "split_mode": "equal"})
    assert spend.status_code == 200, spend.text
    assert me.owed(ferreira) == (3000, 0), "their half of a meal I paid"
    me.do(ferreira, "add", THEY, amount=10)
    assert me.owed(ferreira) == (4000, 0)
    assert me.total(cash) == 240, "only the dinner moved money; the manual debt did not"
    maria = me.person("Maria")
    theirs = me.call("post", "/transactions/expense", json={"amount": 40, "merchant": "Taxi", "account": cash["id"], "participants": ["Me", "Maria"], "paid_by": "Maria"})
    assert theirs.status_code == 200, theirs.text
    assert me.owed(maria) == (0, 2000), "my share of an expense Maria paid is what I owe her"
    line = next(i for i in me.view(ferreira)["items"] if i["kind"] == "expense")
    assert line["origin"] == "expense" and line["effect_cents"] == 3000


def test_clearing_an_expense_line_removes_the_share_but_keeps_the_expense(me):
    cash = me.account(balance=300)
    p = me.person("Ferreira")
    me.ok("post", "/transactions/expense", json={"amount": 60, "merchant": "Dinner", "account": cash["id"], "participants": ["Me", "Ferreira"]})
    line = next(i for i in me.view(p)["items"] if i["kind"] == "expense")
    out = me.do(p, "clear_line", None, line_type="split", line_id=line["ref_id"])
    assert out["balances"]["they_owe"] == 0
    assert any(t["merchant"] == "Dinner" for t in me.ok("get", "/transactions")), "the expense is untouched"


# -- deleting a person ---------------------------------------------------------------------------------------------------------------

def test_deleting_a_person_archives_them_and_never_hides_a_debt_silently(me):
    p = me.person("Ferreira")
    me.do(p, "add", THEY, amount=25)
    assert "balance" in me.refused("delete", f"/people/{p['id']}", status=409).lower()
    assert any(x["id"] == p["id"] for x in me.ok("get", "/people")), "refused: still listed"
    assert me.ok("delete", f"/people/{p['id']}?clear_balances=true")["archived"] is True
    assert all(x["id"] != p["id"] for x in me.ok("get", "/people"))
    archived = [x for x in me.ok("get", "/debts/archived") if x["id"] == p["id"]]
    assert archived and archived[0]["owes_me"] == 0, "cleared as part of deleting, kept in the archive"
    view = me.view(p)
    assert view["person"]["archived"] is True and any(a["kind"] == "clear" for a in view["audit"]), "the history is still there"
    assert me.ok("get", "/transactions") == [], "deleting is not a payment"
    me.ok("post", f"/debts/people/{p['id']}/restore")
    assert any(x["id"] == p["id"] for x in me.ok("get", "/people"))
    assert me.owed(p) == (0, 0)


def test_a_person_without_any_history_is_removed_outright_and_one_with_history_is_not(me):
    clean, used = me.person("Clean"), me.person("Used")
    me.do(used, "add", THEY, amount=5)
    me.do(used, "clear", THEY)
    assert me.ok("delete", f"/people/{clean['id']}")["deleted"] == 1
    assert me.call("get", f"/debts/people/{clean['id']}").status_code == 404
    me.ok("delete", f"/people/{used['id']}")
    assert me.call("get", f"/debts/people/{used['id']}").status_code == 200


def test_clear_all_debts_clears_without_erasing_anything(me):
    a, b = me.person(), me.person()
    me.do(a, "add", THEY, amount=10)
    me.do(b, "add", I, amount=7)
    me.ok("post", "/people/clear-debts")
    assert me.owed(a) == (0, 0) and me.owed(b) == (0, 0)
    assert any(x["kind"] == "clear" for x in me.view(a)["audit"])


# -- other people's records, simultaneous and repeated requests -------------------------------------------------------------------------

def test_nobody_reaches_another_persons_records(me):
    other = Me()
    theirs = other.person("Secret")
    other.do(theirs, "add", THEY, amount=99)
    entry = other.view(theirs)["items"][0]
    assert me.call("get", f"/debts/people/{theirs['id']}").status_code == 404
    assert me.call("post", f"/debts/people/{theirs['id']}/adjust/add", json={"direction": THEY, "amount": 1}).status_code == 404
    assert me.call("post", f"/debts/people/{theirs['id']}/payments", json={"direction": "in", "amount": 1}).status_code == 404
    assert me.call("post", f"/debts/people/{theirs['id']}/archive", json={"clear_balances": True}).status_code == 404
    assert me.call("post", f"/debts/entries/{entry['ref_id']}/reverse").status_code == 404
    assert me.call("post", f"/debts/people/{theirs['id']}/adjust/clear_line", json={"line_type": "entry", "line_id": entry["ref_id"]}).status_code == 404
    assert other.owed(theirs) == (9900, 0)
    assert all(x["id"] != theirs["id"] for x in me.ok("get", "/people")) and me.ok("get", "/debts/overview")["people"] == 0


def test_simultaneous_requests_add_up_exactly(me):
    p = me.person()
    results = []

    def add():
        results.append(me.debt(p, "add", THEY, amount=1).status_code)

    threads = [threading.Thread(target=add) for _ in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count(200) == 12 and me.owed(p) == (1200, 0)


def test_simultaneous_reductions_cannot_take_the_same_money_twice(me):
    p = me.person()
    me.do(p, "add", THEY, amount=5)
    results = []
    threads = [threading.Thread(target=lambda: results.append(me.debt(p, "reduce", THEY, amount=3).status_code)) for _ in range(5)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [200, 400, 400, 400, 400] and me.owed(p) == (200, 0)


def test_a_repeated_request_with_the_same_key_changes_nothing_twice(me):
    p = me.person()
    key = {"Idempotency-Key": uuid.uuid4().hex}
    url = f"/debts/people/{p['id']}/adjust/add"
    first = me.s.post(api(me.user, url), json={"direction": THEY, "amount": 10}, headers=key, timeout=60)
    again = me.s.post(api(me.user, url), json={"direction": THEY, "amount": 10}, headers=key, timeout=60)
    assert first.status_code == again.status_code == 200 and again.json()["duplicate"] is True
    assert again.json()["entries"][0]["id"] == first.json()["entries"][0]["id"] and me.owed(p) == (1000, 0)
    me.s.post(api(me.user, url), json={"direction": THEY, "amount": 10}, headers={"Idempotency-Key": uuid.uuid4().hex}, timeout=60)
    assert me.owed(p) == (2000, 0), "a different key is a different request"
    cash = me.account(balance=50)
    paykey = {"Idempotency-Key": uuid.uuid4().hex}
    for _ in range(3):
        me.s.post(api(me.user, f"/debts/people/{p['id']}/payments"), json={"direction": "in", "amount": 5, "account": cash["id"]}, headers=paykey, timeout=60)
    assert me.owed(p) == (1500, 0) and me.total(cash) == 55, "a payment sent three times is recorded once"


def test_the_same_key_for_two_people_is_two_requests(me):
    a, b = me.person(), me.person()
    key = {"Idempotency-Key": uuid.uuid4().hex}
    me.s.post(api(me.user, f"/debts/people/{a['id']}/adjust/add"), json={"direction": THEY, "amount": 3}, headers=key, timeout=60)
    other = Me()
    c = other.person()
    r = other.s.post(api(other.user, f"/debts/people/{c['id']}/adjust/add"), json={"direction": THEY, "amount": 3}, headers=key, timeout=60)
    assert r.status_code == 200 and "duplicate" not in r.json(), "keys belong to the person who sent them"
    assert b and other.owed(c) == (300, 0)


def test_a_refused_request_leaves_no_partial_state(me):
    p = me.person()
    me.do(p, "add", THEY, amount=10)
    before = me.view(p)
    for path, body in ((f"/debts/people/{p['id']}/adjust/reduce", {"direction": THEY, "amount": 50}),
                       (f"/debts/people/{p['id']}/adjust/add", {"direction": "sideways", "amount": 5}),
                       (f"/debts/people/{p['id']}/adjust/correct", {"direction": THEY, "new_amount": -1}),
                       (f"/debts/people/{p['id']}/payments", {"direction": "in", "amount": 5, "account": "no such account"})):
        assert me.call("post", path, json=body).status_code in (400, 422), path
    after = me.view(p)
    assert (after["balances"], [i["id"] for i in after["items"]]) == (before["balances"], [i["id"] for i in before["items"]])


def test_the_browser_is_allowed_to_send_the_idempotency_key():
    """Without this the browser's pre-flight check refuses every change that carries the key, and the screen cannot change a balance."""
    import os

    import requests
    from support_auth import BASE_URL
    origin = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")[0].strip()
    r = requests.options(f"{BASE_URL}/api/debts/people/x/adjust/add", timeout=30, headers={
        "Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "idempotency-key,content-type,authorization"})
    assert r.status_code == 200 and "idempotency-key" in r.headers.get("access-control-allow-headers", "").lower(), r.headers
