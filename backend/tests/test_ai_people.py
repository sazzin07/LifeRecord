"""The assistant's people and debt tools, in-process like test_ai_undo.py. The model itself is not called: each test plays the calls a
model would make for the examples in the brief ("Ferreira owes me 10", "add another 15", "she just paid half", "forget the rest, I won't
collect it") and checks what is really saved, with the same rules the screen has. The model's side (does it choose these calls) is
checked separately, once, against the live assistant."""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from models import AIAction  # noqa: E402
from support_users import api, create_verified_user  # noqa: E402


def run(coro):
    return asyncio.run(coro)


class Chat:
    """One signed-in user, and a way to make the calls a model would make in one chat request."""

    def __init__(self):
        self.user = create_verified_user("aiiso")
        self.who = {"_id": self.user["id"], "email": self.user["email"], "name": self.user["name"], "role": "user"}
        self.request = "req-" + self.user["id"][:8]

    def calls(self, *calls, request_id=None, previewed=None):
        async def go():
            created, out = [], []
            async with AsyncSessionLocal() as db:
                for name, args in calls:
                    out.append(await server.dispatch_tool(db, name, args, created, self.who, "sess-ppl", previewed if previewed is not None else set(),
                                                          {"request_id": request_id or self.request}))
                aid = server.new_id()
                db.add(AIAction(id=aid, user_id=self.user["id"], label="ppl", tools=[n for n, _ in calls], created=created,
                                undoable=len(created) > 0, undone=False, created_at=server.now_iso()))
                await db.commit()
            return aid, out
        return run(go())

    def one(self, name, args, **kw):
        return self.calls((name, args), **kw)[1][0]

    def undo(self, aid):
        async def go():
            async with AsyncSessionLocal() as db:
                return await server.ai_undo(aid, self.who, db)
        return run(go())

    def owed(self, name):
        found = self.one("find_person", {"query": name})["matches"]
        assert len(found) == 1, found
        return found[0]["they_owe"], found[0]["i_owe"]

    def http(self, method, path, **kw):
        return getattr(self.user["session"], method)(api(self.user, path), timeout=60, **kw)


@pytest.fixture
def chat():
    return Chat()


def person(chat, name):
    assert chat.one("create_person", {"name": name})["ok"]


# -- the brief's examples -----------------------------------------------------------------------------------------------------------

def test_ferreira_owes_me_ten_then_add_another_fifteen(chat):
    person(chat, "Ferreira")
    first = chat.one("adjust_debt", {"person": "Ferreira", "direction": "they_owe", "operation": "add", "amount": 10})
    assert first["ok"] and first["balances"]["they_owe"] == 10 and "€10.00" in first["message"]
    second = chat.one("adjust_debt", {"person": "ferreira", "direction": "they_owe", "operation": "add", "amount": 15}, request_id="next-turn")
    assert second["balances"]["they_owe"] == 25 and chat.owed("Ferreira") == (25, 0)
    assert chat.http("get", "/transactions").json() == [], "a debt made no expense and no payment"


def test_i_owe_maria_forty_and_i_paid_maria_twenty(chat):
    person(chat, "Maria")
    chat.one("adjust_debt", {"person": "Maria", "direction": "i_owe", "operation": "add", "amount": 40})
    paid = chat.one("record_payment", {"person": "Maria", "direction": "out", "amount": 20})
    assert paid["ok"] and paid["balances"]["i_owe"] == 20 and "not recorded in any of your accounts" in paid["message"]
    assert chat.owed("Maria") == (0, 20)


def test_ferreira_paid_me_five_is_a_payment_not_an_adjustment(chat):
    person(chat, "Ferreira")
    chat.one("adjust_debt", {"person": "Ferreira", "direction": "they_owe", "operation": "add", "amount": 20})
    paid = chat.one("record_payment", {"person": "Ferreira", "direction": "in", "amount": 5})
    assert paid["balances"]["they_owe"] == 15
    history = chat.one("get_person_debts", {"person": "Ferreira"})["history"]
    assert [h["kind"] for h in history][0] == "payment_in" and history[0]["origin"] == "payment"
    reduced = chat.one("adjust_debt", {"person": "Ferreira", "direction": "they_owe", "operation": "reduce", "amount": 10})
    assert reduced["balances"]["they_owe"] == 5
    assert [h["kind"] for h in chat.one("get_person_debts", {"person": "Ferreira"})["history"]].count("payment_in") == 1, "reducing is not a payment"


def test_clear_everything_ferreira_owes_me_asks_first_then_clears_without_a_payment(chat):
    person(chat, "Ferreira")
    chat.one("adjust_debt", {"person": "Ferreira", "direction": "they_owe", "operation": "add", "amount": 50})
    previewed = set()
    asked = chat.one("clear_debt", {"person": "Ferreira", "direction": "they_owe"}, previewed=previewed)
    assert asked["needs_confirmation"] is True and "€50.00" in asked["message"] and "No payment is recorded" in asked["message"]
    assert chat.owed("Ferreira") == (50, 0), "nothing happened yet"
    done = chat.one("clear_debt", {"person": "Ferreira", "direction": "they_owe", "confirm": True}, request_id="turn-2")
    assert done["ok"] and done["balances"]["they_owe"] == 0 and "no payment" in done["message"].lower()
    assert chat.http("get", "/transactions").json() == []
    assert all(h["kind"] != "payment_in" for h in chat.one("get_person_debts", {"person": "Ferreira"})["history"])


def test_remove_marias_debt_without_recording_a_payment(chat):
    person(chat, "Maria")
    chat.one("adjust_debt", {"person": "Maria", "direction": "i_owe", "operation": "add", "amount": 30})
    chat.one("clear_debt", {"person": "Maria", "direction": "i_owe"})
    out = chat.one("clear_debt", {"person": "Maria", "direction": "i_owe", "confirm": True}, request_id="t2")
    assert out["balances"]["i_owe"] == 0 and chat.http("get", "/transactions").json() == []


def test_questions_about_balances(chat):
    for name, they, i in (("Ferreira", 60, 0), ("John", 25, 5), ("Maria", 0, 40)):
        person(chat, name)
        if they:
            chat.one("adjust_debt", {"person": name, "direction": "they_owe", "operation": "add", "amount": they})
        if i:
            chat.one("adjust_debt", {"person": name, "direction": "i_owe", "operation": "add", "amount": i}, request_id=f"r-{name}")
    everyone = chat.one("get_people", {"sort": "they_owe", "only_with_balance": True})
    assert [p["name"] for p in everyone["people"]] == ["Ferreira", "John", "Maria"], "who owes me the most comes first"
    assert everyone["totals"] == {"they_owe_me": 85, "i_owe_them": 45}, "how much I owe other people, and how much they owe me, separately"
    assert chat.one("get_people", {"sort": "i_owe"})["people"][0]["name"] == "Maria"


def test_she_just_paid_half_is_two_steps_the_model_can_make_from_the_balance(chat):
    person(chat, "Sarah")
    chat.one("adjust_debt", {"person": "Sarah", "direction": "they_owe", "operation": "add", "amount": 30})
    owed = chat.one("get_person_debts", {"person": "Sarah"})["balances"]["they_owe"]
    paid = chat.one("record_payment", {"person": "Sarah", "direction": "in", "amount": owed / 2}, request_id="half")
    assert paid["balances"]["they_owe"] == 15


# -- who is meant -------------------------------------------------------------------------------------------------------------------

def test_two_people_with_similar_names_are_never_guessed_between(chat):
    person(chat, "John Smith")
    person(chat, "John Doe")
    out = chat.one("adjust_debt", {"person": "John", "direction": "they_owe", "operation": "add", "amount": 5})
    assert "More than one person" in out["error"] and {c["name"] for c in out["candidates"]} == {"John Smith", "John Doe"} and out["needs_confirmation"] is True
    assert chat.owed("John Smith") == (0, 0) and chat.owed("John Doe") == (0, 0), "nothing was recorded"
    assert chat.one("adjust_debt", {"person": "John Doe", "direction": "they_owe", "operation": "add", "amount": 5}, request_id="b")["ok"]


def test_names_are_matched_without_case_or_accents(chat):
    person(chat, "José Álvaro")
    assert chat.one("adjust_debt", {"person": "jose alvaro", "direction": "they_owe", "operation": "add", "amount": 3})["ok"]
    assert chat.one("adjust_debt", {"person": "Álvaro", "direction": "they_owe", "operation": "add", "amount": 2}, request_id="b")["ok"]
    assert chat.owed("José") == (5, 0)


def test_an_unknown_person_is_not_created_silently_and_the_model_is_told_to_offer_it(chat):
    out = chat.one("adjust_debt", {"person": "Nobody", "direction": "they_owe", "operation": "add", "amount": 5})
    assert "No person named 'Nobody'" in out["error"] and out["suggest_create"] == "Nobody" and out["needs_confirmation"] is True
    assert chat.one("find_person", {"query": "Nobody"})["count"] == 0


def test_a_missing_or_impossible_amount_or_direction_is_refused_and_changes_nothing(chat):
    person(chat, "Ferreira")
    for args in ({"direction": "they_owe", "operation": "add"}, {"direction": "they_owe", "operation": "add", "amount": 0}, {"direction": "they_owe", "operation": "add", "amount": -4},
                 {"direction": "sideways", "operation": "add", "amount": 5}, {"direction": "they_owe", "operation": "reduce", "amount": 5}):
        assert "error" in chat.one("adjust_debt", {"person": "Ferreira", **args}, request_id=str(args)), args
    assert chat.owed("Ferreira") == (0, 0)


# -- payments, extra, undo ---------------------------------------------------------------------------------------------------------

def test_an_overpayment_is_not_recorded_until_the_user_says_what_the_extra_is(chat):
    person(chat, "Ferreira")
    chat.one("adjust_debt", {"person": "Ferreira", "direction": "they_owe", "operation": "add", "amount": 20})
    asked = chat.one("record_payment", {"person": "Ferreira", "direction": "in", "amount": 30}, request_id="a")
    assert asked["needs_confirmation"] is True and asked["recorded"] is False and (asked["outstanding"], asked["excess"]) == (20, 10)
    assert chat.owed("Ferreira") == (20, 0)
    done = chat.one("record_payment", {"person": "Ferreira", "direction": "in", "amount": 30, "excess": "opposite"}, request_id="b")
    assert (done["balances"]["they_owe"], done["balances"]["i_owe"]) == (0, 10) and "debt the other way" in done["message"]


def test_a_payment_into_a_named_account_moves_it_and_an_unknown_account_is_asked_about(chat):
    cash = chat.http("post", "/accounts", json={"name": "Money in hand", "type": "cash", "opening_balance": 100}).json()
    person(chat, "Ferreira")
    chat.one("adjust_debt", {"person": "Ferreira", "direction": "they_owe", "operation": "add", "amount": 30})
    bad = chat.one("record_payment", {"person": "Ferreira", "direction": "in", "amount": 5, "account": "Nowhere"}, request_id="x")
    assert "No account or place called 'Nowhere'" in bad["error"] and chat.owed("Ferreira") == (30, 0)
    ok = chat.one("record_payment", {"person": "Ferreira", "direction": "in", "amount": 5, "account": "Money in hand"}, request_id="y")
    assert "recorded in your account" in ok["message"]
    total = next(a["balance"] for a in chat.http("get", "/accounts").json() if a["id"] == cash["id"])
    assert total == 105


def test_repeated_calls_cannot_apply_a_change_twice(chat):
    person(chat, "Ferreira")
    args = {"person": "Ferreira", "direction": "they_owe", "operation": "add", "amount": 10}
    first = chat.one("adjust_debt", args, request_id="same-request")
    again = chat.one("adjust_debt", args, request_id="same-request")
    assert first["ok"] and again["duplicate"] is True and chat.owed("Ferreira") == (10, 0)
    _, both = chat.calls(("adjust_debt", args), ("adjust_debt", args), request_id="another-request")
    assert [b.get("duplicate", False) for b in both] == [False, True] and chat.owed("Ferreira") == (20, 0)
    chat.one("adjust_debt", args, request_id="a-new-send")
    assert chat.owed("Ferreira") == (30, 0), "a later, separate request is a real new instruction"
    pay = {"person": "Ferreira", "direction": "in", "amount": 5}
    chat.calls(("record_payment", pay), ("record_payment", pay), request_id="pay-request")
    assert chat.owed("Ferreira") == (25, 0), "a payment repeated in one request is recorded once"


def test_an_ai_action_is_undone_by_cancelling_lines_and_the_originals_stay(chat):
    person(chat, "Ferreira")
    aid, _ = chat.calls(("adjust_debt", {"person": "Ferreira", "direction": "they_owe", "operation": "add", "amount": 10}), request_id="u1")
    assert chat.owed("Ferreira") == (10, 0)
    chat.undo(aid)
    assert chat.owed("Ferreira") == (0, 0)
    view = chat.http("get", f"/debts/people/{chat.one('find_person', {'query': 'Ferreira'})['matches'][0]['id']}").json()
    assert view["items"] == [] and any(a["state"] == "reversed" for a in view["audit"]), "undone, and still on record"


def test_undoing_a_clear_restores_the_debt_and_undoing_a_payment_removes_it_with_its_extra(chat):
    person(chat, "Ferreira")
    chat.one("adjust_debt", {"person": "Ferreira", "direction": "they_owe", "operation": "add", "amount": 40})
    aid, _ = chat.calls(("clear_debt", {"person": "Ferreira", "direction": "they_owe", "confirm": True}), request_id="c1", previewed={"x"})
    if chat.owed("Ferreira") != (0, 0):   # the first call only previewed: confirm in a later request
        aid, _ = chat.calls(("clear_debt", {"person": "Ferreira", "direction": "they_owe", "confirm": True}), request_id="c2")
    assert chat.owed("Ferreira") == (0, 0)
    chat.undo(aid)
    assert chat.owed("Ferreira") == (40, 0)
    aid, out = chat.calls(("record_payment", {"person": "Ferreira", "direction": "in", "amount": 50, "excess": "opposite"}), request_id="p1")
    assert chat.owed("Ferreira") == (0, 10)
    chat.undo(aid)
    assert chat.owed("Ferreira") == (40, 0)


def test_deleting_a_person_through_the_assistant_archives_after_confirming_and_says_what_it_clears(chat):
    person(chat, "Ferreira")
    chat.one("adjust_debt", {"person": "Ferreira", "direction": "they_owe", "operation": "add", "amount": 12})
    previewed = set()
    asked = chat.one("delete_person", {"person": "Ferreira"}, previewed=previewed)
    assert asked["needs_confirmation"] is True and "€12.00" in asked["message"] and "restored" in asked["message"]
    assert chat.owed("Ferreira") == (12, 0)
    done = chat.one("delete_person", {"person": "Ferreira", "confirm": True}, request_id="d2")
    assert done["archived"] is True and done["cleared"] == {"they_owe": 12.0}
    assert chat.one("find_person", {"query": "Ferreira"})["count"] == 0 and chat.http("get", "/debts/archived").json()[0]["name"] == "Ferreira"


# -- isolation ----------------------------------------------------------------------------------------------------------------------

def test_the_assistant_cannot_see_or_change_another_persons_people(chat):
    other = Chat()
    person(other, "Secret Sam")
    other.one("adjust_debt", {"person": "Secret Sam", "direction": "they_owe", "operation": "add", "amount": 77})
    sam_id = other.one("find_person", {"query": "Sam"})["matches"][0]["id"]
    assert chat.one("find_person", {"query": "Sam"})["count"] == 0 and chat.one("get_people", {})["people"] == []
    assert "No person" in chat.one("adjust_debt", {"person": "Secret Sam", "direction": "i_owe", "operation": "add", "amount": 1})["error"]
    assert "No person" in chat.one("adjust_debt", {"person": sam_id, "direction": "they_owe", "operation": "reduce", "amount": 1}, request_id="id")["error"]
    assert "No person" in chat.one("get_person_debts", {"person": sam_id})["error"]
    assert other.owed("Secret Sam") == (77, 0)
