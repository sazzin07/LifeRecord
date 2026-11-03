"""Saved preferences, the display name, the sign-in address that can NOT be changed, the second-step proof on a password change, the assistant's
settings tools (in-process, like test_ai_people.py) and category renames."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402
import support_two_factor as tf  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from models import AIAction  # noqa: E402
from support_auth import BASE_URL  # noqa: E402
from support_users import PASSWORD, api, create_verified_user  # noqa: E402


def call(user, method, path, token=None, **kw):
    headers = {"Authorization": f"Bearer {token or user['token']}"}
    return requests.request(method, api(user, path), headers=headers, timeout=60, **kw)


# -- preferences ----------------------------------------------------------------------------------------------------------

def test_preferences_start_as_defaults_unsaved_and_change_one_at_a_time():
    u = create_verified_user("prefs")
    first = call(u, "get", "/preferences").json()
    assert first["saved"] is False and first["preferences"] == {"theme": "system", "animations": True, "week_start": "monday", "money_period": "week"}
    r = call(u, "put", "/preferences", json={"theme": "dark"})
    assert r.status_code == 200 and r.json()["preferences"]["theme"] == "dark" and r.json()["saved"] is True
    r = call(u, "put", "/preferences", json={"week_start": "sunday", "animations": False})
    p = r.json()["preferences"]
    assert p == {"theme": "dark", "animations": False, "week_start": "sunday", "money_period": "week"}   # earlier choice kept
    assert call(u, "get", "/preferences").json()["preferences"] == p


def test_a_value_that_is_not_allowed_is_refused_and_nothing_changes():
    u = create_verified_user("prefsbad")
    call(u, "put", "/preferences", json={"theme": "light"})
    for bad in ({"theme": "neon"}, {"week_start": "friday"}, {"money_period": "year"}):
        r = call(u, "put", "/preferences", json=bad)
        assert r.status_code == 400, (bad, r.text)
    assert call(u, "get", "/preferences").json()["preferences"]["theme"] == "light"
    assert call(u, "put", "/preferences", json={"animations": "maybe"}).status_code == 422


def test_nobody_sees_or_changes_another_persons_preferences():
    a, b = create_verified_user("prefsa"), create_verified_user("prefsb")
    call(a, "put", "/preferences", json={"theme": "dark", "week_start": "sunday"})
    pb = call(b, "get", "/preferences").json()
    assert pb["saved"] is False and pb["preferences"]["theme"] == "system"
    call(b, "put", "/preferences", json={"theme": "light"})
    assert call(a, "get", "/preferences").json()["preferences"]["theme"] == "dark"
    assert requests.get(f"{BASE_URL}/api/preferences", timeout=30).status_code in (401, 403)


# -- display name ---------------------------------------------------------------------------------------------------------

def test_the_name_changes_trimmed_and_cannot_be_empty_or_huge():
    u = create_verified_user("name")
    r = call(u, "patch", "/auth/me", json={"name": "  Alma   Quinn  "})
    assert r.status_code == 200 and r.json()["name"] == "Alma Quinn"
    assert call(u, "get", "/auth/me").json()["name"] == "Alma Quinn"
    assert call(u, "patch", "/auth/me", json={"name": "   "}).status_code == 400
    assert call(u, "patch", "/auth/me", json={"name": "x" * 81}).status_code == 400
    assert call(u, "get", "/auth/me").json()["name"] == "Alma Quinn"


# -- the sign-in address and the password ------------------------------------------------------------------------------------

def test_the_sign_in_address_cannot_be_changed_by_any_route():
    u = create_verified_user("fixedmail")
    before = call(u, "get", "/auth/me").json()["email"]
    # the name route ignores an address sent along with it
    r = call(u, "patch", "/auth/me", json={"name": "Same Person", "email": "someone_else@example.com"})
    assert r.status_code == 200 and r.json()["email"] == before
    for method, path in (("post", "/auth/email-change"), ("put", "/auth/me"), ("post", "/auth/email"), ("patch", "/auth/email")):
        assert call(u, method, path, json={"new_email": "x@example.com", "email": "x@example.com", "password": PASSWORD}).status_code in (404, 405)
    assert call(u, "put", "/preferences", json={"email": "x@example.com"}).json()["preferences"].get("email") is None
    assert call(u, "get", "/auth/me").json()["email"] == before


def test_with_two_step_on_changing_the_password_needs_a_code_too():
    u = create_verified_user("pw2fa")
    secret, _ = tf.add_totp(u)
    r = call(u, "post", "/auth/change-password", json={"current_password": PASSWORD, "new_password": "BrandNew456x"})
    assert r.status_code == 400 and "Confirm it is you first" in r.json()["detail"]
    assert requests.post(f"{BASE_URL}/api/auth/login", json={"email": u["email"], "password": PASSWORD}, timeout=30).json().get("requires_totp") is True
    tf.forget_used_steps(u)
    r = call(u, "post", "/auth/change-password", json={"current_password": PASSWORD, "new_password": "BrandNew456x", "code": tf.totp.code_at(secret, tf.step())})
    assert r.status_code == 200, r.text


# -- the assistant ---------------------------------------------------------------------------------------------------------

class Chat:
    def __init__(self):
        self.user = create_verified_user("aiset")
        self.who = {"_id": self.user["id"], "email": self.user["email"], "name": self.user["name"], "role": "user"}

    def one(self, name, args):
        async def go():
            created = []
            async with AsyncSessionLocal() as db:
                out = await server.dispatch_tool(db, name, args, created, self.who, "sess-set", set(), {"request_id": "r-" + os.urandom(4).hex()})
                aid = server.new_id()
                db.add(AIAction(id=aid, user_id=self.user["id"], label="set", tools=[name], created=created, undoable=len(created) > 0, undone=False, created_at=server.now_iso()))
                await db.commit()
            return aid, out
        return asyncio.run(go())

    def undo(self, aid):
        async def go():
            async with AsyncSessionLocal() as db:
                return await server.ai_undo(aid, self.who, db)
        return asyncio.run(go())

    def prefs(self):
        return call(self.user, "get", "/preferences").json()


def test_the_assistant_reads_and_changes_low_risk_settings_and_undo_puts_them_back():
    c = Chat()
    _, got = c.one("get_settings", {})
    assert got["settings"]["theme"] == "system" and "Profile" in got["not_changeable_here"]
    aid, out = c.one("update_settings", {"theme": "dark", "week_start": "sunday", "display_name": "  Nova  "})
    assert out["ok"] and out["settings"]["theme"] == "dark" and out["settings"]["display_name"] == "Nova"
    assert c.prefs()["preferences"]["week_start"] == "sunday" and c.prefs()["saved"] is True
    assert call(c.user, "get", "/auth/me").json()["name"] == "Nova"
    c.undo(aid)
    assert c.prefs()["saved"] is False and c.prefs()["preferences"]["theme"] == "system"        # it was never saved before: back to unsaved
    assert call(c.user, "get", "/auth/me").json()["name"] == c.user["name"]


def test_undo_restores_the_earlier_choice_when_one_was_saved():
    c = Chat()
    call(c.user, "put", "/preferences", json={"theme": "light", "money_period": "all"})
    aid, _ = c.one("update_settings", {"theme": "dark"})
    assert c.prefs()["preferences"]["theme"] == "dark"
    c.undo(aid)
    p = c.prefs()
    assert p["saved"] is True and p["preferences"]["theme"] == "light" and p["preferences"]["money_period"] == "all"


def test_the_assistant_refuses_a_bad_value_and_has_no_tool_for_the_keys_to_the_account():
    c = Chat()
    _, out = c.one("update_settings", {"theme": "neon"})
    assert "error" in out and c.prefs()["saved"] is False
    _, out = c.one("update_settings", {})
    assert "error" in out
    names = {t["function"]["name"] for t in server.AI_TOOLS}
    assert {"get_settings", "update_settings"} <= names
    for forbidden in ("change_password", "change_email", "set_email", "disable_two_factor", "sign_out_everywhere", "delete_account", "update_password"):
        assert forbidden not in names
    props = next(t for t in server.AI_TOOLS if t["function"]["name"] == "update_settings")["function"]["parameters"]["properties"]
    assert not ({"email", "password", "new_email", "two_factor"} & set(props))


# -- categories -------------------------------------------------------------------------------------------------------------

def test_renaming_a_category_carries_its_past_transactions_and_duplicates_are_refused():
    u = create_verified_user("cats")
    cat = call(u, "post", "/categories", json={"name": "Coffee", "monthly_budget": 30}).json()
    assert call(u, "post", "/categories", json={"name": "  coffee "}).status_code == 400          # same name, any case
    other = call(u, "post", "/categories", json={"name": "Tea"}).json()
    acc = call(u, "get", "/accounts").json()
    place = next((a for a in acc if a["type"] == "cash"), acc[0] if acc else None)
    body = {"type": "expense", "gross_amount": 3.5, "category": "Coffee", "merchant": "Cafe", "date": "2026-11-01", "payment_method": "cash"}
    if place:
        call(u, "post", "/transactions", json=body)
    r = call(u, "put", f"/categories/{cat['id']}", json={"name": "Espresso", "monthly_budget": 45})
    assert r.status_code == 200 and r.json()["name"] == "Espresso" and r.json()["monthly_budget"] == 45
    assert call(u, "put", f"/categories/{other['id']}", json={"name": "espresso"}).status_code == 400   # taken by another
    assert call(u, "put", f"/categories/{other['id']}", json={"name": "Tea", "monthly_budget": 5}).status_code == 200   # its own name is fine
    if place:
        cats = {t["category"] for t in call(u, "get", "/transactions").json() if t["type"] == "expense"}
        assert "Espresso" in cats and "Coffee" not in cats
    assert call(u, "delete", f"/categories/{cat['id']}").status_code == 200
