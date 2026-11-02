"""S-12: no account can read, change or delete another account's data, for every user-owned table and every route that
takes an object id.

How it works. For each resource, user A creates an object. User B then tries every route that takes that object's id
and must be refused with 403 or 404 (a 422 would only prove the request was malformed, so every body here is valid);
A's object must still be there and unchanged; B's own list must not show it. Two completeness tests then fail when a
user-owned table or an id-route has neither a case nor a written reason, so a new table cannot slip through unproven.
"""
import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

import pytest

from support_populate import (  # noqa: E402,F401
    SCHEDULED_BODY, TODAY, _db, _ids, _tag, v_food_is_still_a_favourite,
    c_account,
    c_category,
    c_person,
    c_task,
    c_weight,
    c_workout,
    c_photo,
    c_grocery,
    c_product,
    c_shopping_item,
    c_shopping_list,
    c_recurring,
    c_storage,
    c_appliance,
    c_meal,
    c_recipe,
    c_transaction,
    c_settlement,
    c_food,
    c_diary,
    c_plan,
    c_water,
    c_scheduled_task,
    c_recipient,
    c_run,
    c_conversation,
    c_action,
)
from support_users import api, create_verified_user


# -- the cases -----------------------------------------------------------------------------------------------------------

@dataclass
class Case:
    tables: Tuple[str, ...]
    create: Callable
    attempts: List[tuple]  # (method, path, json body[, accepted statuses]); the default is 403 or 404
    list_path: Optional[str] = None  # B's listing must not contain A's object; A's must
    verify: Optional[Callable] = None  # extra proof that the owner's state is untouched: verify(a, made)


CASES: Dict[str, Case] = {
    "accounts": Case(("accounts",), c_account, [("PUT", "/accounts/{id}", {"name": "hijacked"}), ("DELETE", "/accounts/{id}", None)], "/accounts"),
    "categories": Case(("categories",), c_category, [("PUT", "/categories/{id}", {"name": "hijacked", "icon": "circle", "color": "#000000"}),
                                                    ("DELETE", "/categories/{id}", None)], "/categories"),
    "people": Case(("people",), c_person, [("GET", "/people/{id}", None), ("PUT", "/people/{id}", {"name": "hijacked"}),
                                           ("DELETE", "/people/{id}", None), ("POST", "/people/{id}/clear-balance", {"person": "x", "amount": 1})], "/people"),
    "tasks": Case(("tasks",), c_task, [("PUT", "/tasks/{id}", {"title": "hijacked"}), ("DELETE", "/tasks/{id}", None)], "/tasks"),
    "weight_entries": Case(("weight_entries",), c_weight, [("PUT", "/weight/{id}", {"weight": 1}), ("DELETE", "/weight/{id}", None)], "/weight"),
    "workouts": Case(("workouts",), c_workout, [("PUT", "/workouts/{id}", {"notes": "hijacked"}), ("DELETE", "/workouts/{id}", None)], "/workouts"),
    "photos": Case(("photos",), c_photo, [("GET", "/photos/file/{file}", None), ("PUT", "/photos/{id}", {"note": "hijacked"}),
                                          ("DELETE", "/photos/{id}", None)], "/photos"),
    "groceries": Case(("groceries",), c_grocery, [("PUT", "/groceries/{id}", {"name": "hijacked"}), ("DELETE", "/groceries/{id}", None),
                                                  ("POST", "/groceries/{id}/consume", {"quantity": 1}),
                                                  ("POST", "/groceries/{id}/discard", {}), ("POST", "/groceries/{id}/move", {"storage_location": "Fridge"})],
                      "/groceries"),
    "products": Case(("products",), c_product, [("PUT", "/products/{id}", {"name": "hijacked"}), ("DELETE", "/products/{id}", None)], "/products"),
    "shopping_items": Case(("shopping_items",), c_shopping_item, [("PUT", "/shopping/{id}", {"name": "hijacked"}), ("DELETE", "/shopping/{id}", None),
                                                                 ("POST", "/shopping/{id}/buy", {}), ("POST", "/shopping/{id}/toggle", {})], "/shopping"),
    "shopping_lists": Case(("shopping_lists",), c_shopping_list, [("PUT", "/shopping/lists/{id}", {"name": "hijacked"}),
                                                                 ("DELETE", "/shopping/lists/{id}", None),
                                                                 # 400: submit only ever looks at the CALLER's own items, so another user's list has "none selected"; nothing is read or changed
                                                                 ("POST", "/shopping/lists/{id}/submit", {}, (400, 403, 404))],
                           "/shopping/lists"),
    "recurring_lists": Case(("recurring_lists",), c_recurring, [("PUT", "/shopping/recurring/{id}", {"name": "hijacked"}),
                                                               ("DELETE", "/shopping/recurring/{id}", None), ("POST", "/shopping/recurring/{id}/spawn", {})],
                            "/shopping/recurring"),
    "storage_locations": Case(("storage_locations",), c_storage, [("PUT", "/storage-locations/{id}", {"name": "hijacked"}),
                                                                 ("DELETE", "/storage-locations/{id}", None)], "/storage-locations"),
    "appliances": Case(("appliances",), c_appliance, [("PUT", "/appliances/{id}", {"name": "hijacked"}), ("DELETE", "/appliances/{id}", None)], "/appliances"),
    "meals": Case(("meals",), c_meal, [("PUT", "/meals/{id}", {"description": "hijacked"}), ("DELETE", "/meals/{id}", None)]),
    "recipes": Case(("recipes",), c_recipe, [("PUT", "/recipes/{id}", {"name": "hijacked"}), ("DELETE", "/recipes/{id}", None),
                                             ("POST", "/recipes/{id}/cook", {}), ("POST", "/recipes/{id}/add-missing", {})], "/recipes"),
    "transactions": Case(("transactions",), c_transaction, [("PUT", "/transactions/{id}", {"description": "hijacked"}), ("DELETE", "/transactions/{id}", None),
                                                           ("DELETE", "/splits/{split_id}", None)], "/transactions"),
    "settlements": Case(("settlements",), c_settlement, [("DELETE", "/settlements/{id}", None)]),
    "foods": Case(("foods", "food_favorites"), c_food, [("GET", "/nutrition/foods/{id}", None), ("PUT", "/nutrition/foods/{id}", {"name": "hijacked", "nutrients": {"energy_kcal": 1}}),
                                                       ("POST", "/nutrition/foods/{id}/favorite", {}),
                                                       # 200: it deletes only the CALLER's own favourite row (none here), so it is an idempotent no-op
                                                       ("DELETE", "/nutrition/foods/{id}/favorite", None, (200, 403, 404)),
                                                       ("GET", "/nutrition/foods/{id}/swaps?nutrient=sodium_mg", None), ("DELETE", "/nutrition/foods/{id}", None)],
                  verify=v_food_is_still_a_favourite),
    "diary": Case(("meals",), c_diary, [("PUT", "/nutrition/diary/{id}", {"quantity": 1}), ("POST", "/nutrition/diary/{id}/duplicate", {}),
                                        ("POST", "/nutrition/diary/{id}/move", {"meal_type": "lunch"}), ("DELETE", "/nutrition/diary/{id}", None)]),
    "meal_plan_entries": Case(("meal_plan_entries",), c_plan, [("PUT", "/nutrition/plan/{id}", {"note": "hijacked"}), ("POST", "/nutrition/plan/{id}/log", {}),
                                                              ("DELETE", "/nutrition/plan/{id}", None)]),
    "hydration_entries": Case(("hydration_entries",), c_water, [("PUT", "/nutrition/water/{id}", {"amount_ml": 1}), ("DELETE", "/nutrition/water/{id}", None)]),
    "scheduled_tasks": Case(("scheduled_tasks",), c_scheduled_task, [
        ("GET", "/scheduled/tasks/{id}", None), ("PUT", "/scheduled/tasks/{id}", {**SCHEDULED_BODY, "title": "hijacked"}), ("GET", "/scheduled/tasks/{id}/runs", None),
        ("POST", "/scheduled/tasks/{id}/activate", {"confirm": True, "confirm_recipients": []}), ("POST", "/scheduled/tasks/{id}/duplicate", {}),
        ("POST", "/scheduled/tasks/{id}/pause", {}), ("POST", "/scheduled/tasks/{id}/preview", {}), ("POST", "/scheduled/tasks/{id}/resume", {}),
        ("POST", "/scheduled/tasks/{id}/run", {}), ("DELETE", "/scheduled/tasks/{id}", None)]),
    "report_recipients": Case(("report_recipients",), c_recipient, [("POST", "/scheduled/recipients/{id}/verify", {"code": "000000"}),
                                                                   ("DELETE", "/scheduled/recipients/{id}", None)]),
    "scheduled_task_runs": Case(("scheduled_task_runs",), c_run, [("GET", "/scheduled/runs/{id}", None), ("POST", "/scheduled/runs/{id}/retry", {})]),
    "ai_conversations": Case(("ai_conversations", "ai_messages"), c_conversation, [
        ("GET", "/ai/conversations/{id}", None), ("PATCH", "/ai/conversations/{id}", {"title": "hijacked"}),
        ("GET", "/ai/conversations/{id}/images/{message_id}", None), ("POST", "/ai/conversations/{id}/title", {}),
        ("DELETE", "/ai/conversations/{id}", None)]),
    "ai_actions": Case(("ai_actions",), c_action, [("POST", "/ai/actions/{id}/undo", {})]),
}

# User tables without a REST case of their own, and why that is safe. Each reason names the test that proves it.
TABLE_EXEMPT = {
    "auth_sessions": "internal: no route lists or takes a session id; a session is only ever reached through the token that names it, "
                     "and test_session_lifecycle.py proves one user's token can neither read nor end another user's session",
    "ai_pending_confirmations": "internal: written and consumed by the assistant, no route takes its id; "
                                "test_ai_confirmations.py proves a confirmation cannot be used from another chat or account",
    "nutrition_profiles": "one row per user, never addressed by id; see test_the_profile_and_targets_of_one_user_never_reach_another",
    "price_records": "reached only by name through GET /prices/{name}; see test_price_history_is_per_user",
}

# Routes that take a path parameter which is not the id of a user-owned object.
ROUTE_EXEMPT = {
    ("GET", "/nutrition/foods/barcode/{}"): "a barcode, not an id; looks up shared reference data and the caller's own foods",
    ("PUT", "/nutrition/targets/{}"): "a nutrient key; covered by test_the_profile_and_targets_of_one_user_never_reach_another",
    ("DELETE", "/nutrition/targets/{}"): "a nutrient key; covered by test_the_profile_and_targets_of_one_user_never_reach_another",
    ("GET", "/prices/{}"): "a product name; covered by test_price_history_is_per_user",
}


@pytest.fixture(scope="module")
def pair():
    return create_verified_user("isolation"), create_verified_user("isolation")


@pytest.mark.parametrize("name", sorted(CASES))
def test_other_user_cannot_read_change_or_delete(pair, name):
    a, b = pair
    case = CASES[name]
    made = case.create(a)
    for method, template, body, *accepted in case.attempts:
        path = template.format(**made)
        r = b["session"].request(method, api(b, path), json=body, timeout=30)
        assert r.status_code in (accepted[0] if accepted else (403, 404)), f"{method} {path} as another user -> {r.status_code}: {r.text[:200]}"
    if case.verify:
        case.verify(a, made)
    if case.list_path:
        mine = a["session"].get(api(a, case.list_path), timeout=30)
        theirs = b["session"].get(api(b, case.list_path), timeout=30)
        assert mine.status_code == theirs.status_code == 200
        assert made["id"] in _ids(mine.json()), f"{name}: the owner lost the object after the other user's attempts"
        assert made["id"] not in _ids(theirs.json()), f"{name}: another user's list shows the object"


# -- tables and routes reached by name rather than by id -------------------------------------------------------------------

def test_the_profile_and_targets_of_one_user_never_reach_another(pair):
    a, b = pair
    _db("DELETE FROM nutrition_profiles WHERE user_id IN (%s,%s)", (a["id"], b["id"]))
    _db("INSERT INTO nutrition_profiles (id,user_id,birth_year,sex,height_cm,weight_kg,updated_at) VALUES (%s,%s,1971,'M',191,88,%s)",
        (str(uuid.uuid4()), a["id"], dt.datetime.now(dt.timezone.utc).isoformat()))
    seen_by_b = b["session"].get(api(b, "/nutrition/profile"), timeout=30)
    assert seen_by_b.status_code == 200 and "191" not in seen_by_b.text and "1971" not in seen_by_b.text
    b["session"].put(api(b, "/nutrition/targets/protein_g"), json={"value": 123}, timeout=30)
    row = _db("SELECT target_overrides, height_cm FROM nutrition_profiles WHERE user_id=%s", (a["id"],), fetch=True)[0]
    assert not row["target_overrides"] and float(row["height_cm"]) == 191


def test_price_history_is_per_user(pair):
    a, b = pair
    name = f"isoprice{_tag()}"
    _db("INSERT INTO price_records (id,user_id,name,name_lower,store,price,unit,date,created_at) VALUES (%s,%s,%s,%s,'Secret Store',1.23,'unit',%s,%s)",
        (str(uuid.uuid4()), a["id"], name, name, TODAY, dt.datetime.now(dt.timezone.utc).isoformat()))
    assert "Secret Store" in a["session"].get(api(a, f"/prices/{name}"), timeout=30).text
    assert "Secret Store" not in b["session"].get(api(b, f"/prices/{name}"), timeout=30).text


# -- completeness: a new table or route must come with proof ------------------------------------------------------------------

def test_every_user_owned_table_has_a_case_or_a_written_reason():
    from models import Base
    user_tables = {t for t, table in Base.metadata.tables.items() if "user_id" in table.c}
    covered = {t for case in CASES.values() for t in case.tables} | set(TABLE_EXEMPT)
    assert user_tables - covered == set(), f"user-owned tables with no isolation proof: {sorted(user_tables - covered)}"
    assert covered - user_tables == set(), f"cases that name tables which are not user-owned: {sorted(covered - user_tables)}"


def _shape(path):
    import re
    return re.sub(r"\{[^}]*\}", "{}", path.split("?")[0])


def test_every_route_that_takes_an_id_has_a_case_or_a_written_reason():
    import server
    in_app = set()
    for path, ops in server.app.openapi()["paths"].items():
        for method in ops:
            if method.lower() in ("get", "post", "put", "patch", "delete") and "{" in path:
                in_app.add((method.upper(), _shape(path.replace("/api", "", 1))))
    covered = {(a[0], _shape(a[1])) for case in CASES.values() for a in case.attempts} | set(ROUTE_EXEMPT)
    assert in_app - covered == set(), f"id-routes with no isolation proof: {sorted(in_app - covered)}"
    assert covered - in_app == set(), f"cases that name routes the app does not have: {sorted(covered - in_app)}"


def test_the_matrix_would_notice_a_leak(pair):
    """Negative control: if "the other user" were really the owner, the very first attempt succeeds and the case fails."""
    a, _ = pair
    with pytest.raises(AssertionError):
        test_other_user_cannot_read_change_or_delete((a, a), "accounts")
