"""GET /api/nutrition/suggestions over HTTP with throwaway accounts: the ranking follows what is left of the day, nothing is credited for
values a food does not report, diet and allergy words exclude (and are counted), the kitchen's stock matters, and accounts never see each other."""
import uuid

import pytest
import requests
import support_db
from support_auth import BASE_URL

PW = "NutriPass123"
N = f"{BASE_URL}/api/nutrition"


def _user():
    email = f"nutri_{uuid.uuid4().hex[:8]}@example.com"
    assert requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": PW, "name": "n"}).status_code == 200
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT verification_code FROM users WHERE email=%s", (email,))
            code = cur.fetchone()[0]
    finally:
        conn.close()
    r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code})
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture
def a():
    return _user()


@pytest.fixture
def b():
    return _user()


def food(s, name, per100, portions=None):
    r = s.post(f"{N}/foods", json={"name": name, "nutrients": per100, "portions": portions or []})
    assert r.status_code == 200, r.text
    return r.json()


def recipe(s, name, ingredients, servings=1, **numbers):
    r = s.post(f"{BASE_URL}/api/recipes", json={"name": name, "servings": servings, "ingredients": ingredients, **numbers})
    assert r.status_code == 200, r.text
    return r.json()


def ask(s, **params):
    r = s.get(f"{N}/suggestions", params={"meal_type": "dinner", **params})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_new_account_gets_reference_foods_to_discover_with_reasons_and_nothing_invented(a):
    out = ask(a)
    assert out["context"]["energy_target"] == 2000 and out["context"]["budget_kcal"] == 600       # dinner is 30% of the general adult reference
    assert [f["nutrient"] for f in out["context"]["focus"]][:2] == ["protein_g", "fiber_g"]
    assert out["suggestions"] == [] and out["note"].startswith("Save recipes")                      # nothing of its own to suggest yet
    assert out["discover"], "foods that are new to the person and rich in what is needed"
    for d in out["discover"]:
        assert d["discover"] is True and d["why"] and d["covers"] and d["log"]["food_id"]
        assert d["nutrients"]["energy_kcal"] <= 600 * 1.25
        assert d["quality"] in ("verified", "estimated")                                            # the source's own label, kept


def test_the_ranking_follows_what_is_left_and_logging_a_suggestion_changes_it(a):
    beans = food(a, f"Beans {uuid.uuid4().hex[:4]}", {"energy_kcal": 120, "protein_g": 9, "fiber_g": 8})
    rice = food(a, f"Rice {uuid.uuid4().hex[:4]}", {"energy_kcal": 130, "protein_g": 2.5, "fiber_g": 0.4})
    stew = recipe(a, "Bean stew", [{"name": "Beans", "quantity": 400, "unit": "g", "food_id": beans["id"]}])      # 480 kcal, 36 g protein, 32 g fibre
    plain = recipe(a, "Plain rice", [{"name": "Rice", "quantity": 400, "unit": "g", "food_id": rice["id"]}])      # 520 kcal, 10 g protein, 1.6 g fibre
    out = ask(a)
    names = [s["name"] for s in out["suggestions"]]
    assert names[0] == "Bean stew" and "Plain rice" in names
    top = out["suggestions"][0]
    covers = {c["nutrient"]: c["percent_of_remaining"] for c in top["covers"]}
    assert covers["fiber_g"] == 100.0                                    # 32 g against 25 g still needed: capped, never above 100%
    protein_target = a.get(f"{N}/targets").json()["items"]["protein_g"]["target"]
    assert covers["protein_g"] == pytest.approx(36 / protein_target * 100, abs=0.1)   # 36 g of whatever the reference says is still needed
    assert top["log"] == {"recipe_id": stew["id"], "quantity": 1, "unit": "serving"} and "Covers" in top["why"] and "480 kcal" in top["why"]
    # log exactly what was suggested: it is then the least suggested thing, and the day's remaining energy has dropped
    assert a.post(f"{N}/diary", json={**top["log"], "meal_type": "dinner"}).status_code == 200
    again = ask(a)
    assert again["context"]["remaining_kcal"] == out["context"]["remaining_kcal"] - 480
    assert [s["name"] for s in again["suggestions"]][0] != "Bean stew" or len(again["suggestions"]) == 1
    stew_after = next((s for s in again["suggestions"] if s["name"] == "Bean stew"), None)
    assert stew_after is None or stew_after["score"] < top["score"]                                 # eaten today: ranked lower
    assert plain["id"]


def test_a_value_the_food_does_not_report_earns_nothing_and_is_said_to_be_unknown(a):
    food(a, f"Shake {uuid.uuid4().hex[:4]}", {"energy_kcal": 160, "protein_g": 24})                 # no fibre value at all
    fid = a.get(f"{N}/foods/mine").json()[0]["id"]
    assert a.post(f"{N}/foods/{fid}/favorite").status_code == 200
    out = ask(a)
    s = next(x for x in out["suggestions"] if x["kind"] == "food")
    assert s["unknown"] == ["fiber_g"] and "No fibre data" in s["why"]
    assert all(c["nutrient"] != "fiber_g" for c in s["covers"])


def test_allergy_and_diet_words_exclude_and_are_counted_not_hidden(a):
    nuts = food(a, f"Peanut butter {uuid.uuid4().hex[:4]}", {"energy_kcal": 590, "protein_g": 25, "fiber_g": 6})
    ok = food(a, f"Lentils {uuid.uuid4().hex[:4]}", {"energy_kcal": 116, "protein_g": 9, "fiber_g": 8})
    recipe(a, "Peanut stew", [{"name": "Peanut butter", "quantity": 100, "unit": "g", "food_id": nuts["id"]}])
    recipe(a, "Lentil soup", [{"name": "Lentils", "quantity": 300, "unit": "g", "food_id": ok["id"]}])
    assert a.put(f"{N}/profile", json={"allergies": ["peanut"]}).status_code == 200
    out = ask(a)
    assert [s["name"] for s in out["suggestions"]] == ["Lentil soup"]
    assert out["excluded_for_diet"] >= 1
    assert a.put(f"{N}/profile", json={"allergies": []}).status_code == 200
    assert "Peanut stew" in [s["name"] for s in ask(a)["suggestions"]]


def test_the_kitchen_matters_stock_expiry_and_missing_ingredients(a):
    tag = uuid.uuid4().hex[:5]
    lentils = food(a, f"Lentils {tag}", {"energy_kcal": 116, "protein_g": 9, "fiber_g": 8})
    cookable = recipe(a, "Pantry chilli", [{"name": f"lentils{tag}", "quantity": 300, "unit": "g", "food_id": lentils["id"]}])
    needs = recipe(a, "Shop-first chilli", [{"name": f"lentils{tag}", "quantity": 300, "unit": "g", "food_id": lentils["id"]}, {"name": f"saffron{tag}", "quantity": 1, "unit": "g"}])
    soon = (__import__("datetime").date.today() + __import__("datetime").timedelta(days=2)).isoformat()
    assert a.post(f"{BASE_URL}/api/groceries", json={"name": f"lentils{tag}", "quantity": 500, "unit": "g", "expiration": soon}).status_code == 200
    out = ask(a)
    by = {s["name"]: s for s in out["suggestions"]}
    assert by["Pantry chilli"]["pantry"]["can_cook_now"] is True and by["Pantry chilli"]["pantry"]["uses_expiring"][0]["expires_in"] == 2
    assert f"saffron{tag}" in by["Shop-first chilli"]["pantry"]["missing"] and "You would need to buy" in by["Shop-first chilli"]["why"]
    assert by["Pantry chilli"]["score"] > by["Shop-first chilli"]["score"]
    assert "expires in 2 days" in by["Pantry chilli"]["why"] and cookable["id"] and needs["id"]


def test_when_the_energy_is_used_up_nothing_is_suggested(a):
    assert a.post(f"{N}/diary", json={"description": "Banquet", "calories": 2600, "meal_type": "dinner"}).status_code == 200
    out = ask(a)
    assert out["suggestions"] == [] and out["discover"] == [] and "reached today's energy reference" in out["note"]


def test_focus_limit_and_date_are_validated(a):
    assert [f["nutrient"] for f in ask(a, focus="calcium_mg")["context"]["focus"]] == ["calcium_mg"]
    assert a.get(f"{N}/suggestions", params={"focus": "unobtainium"}).status_code == 422
    assert a.get(f"{N}/suggestions", params={"limit": 0}).status_code == 422
    assert a.get(f"{N}/suggestions", params={"limit": 99}).status_code == 422
    assert a.get(f"{N}/suggestions", params={"meal_type": "brunch"}).status_code == 422
    assert a.get(f"{N}/suggestions", params={"date": "2026-13-45"}).status_code == 422
    past = a.get(f"{N}/suggestions", params={"date": "2026-01-15"}).json()
    assert past["date"] == "2026-01-15" and past["meal_type"] == "other"


def test_one_account_never_sees_anothers_recipes_or_foods(a, b):
    secret = food(a, f"Secret {uuid.uuid4().hex[:4]}", {"energy_kcal": 100, "protein_g": 20, "fiber_g": 10})
    recipe(a, "Private casserole", [{"name": "Secret", "quantity": 300, "unit": "g", "food_id": secret["id"]}])
    assert a.post(f"{N}/foods/{secret['id']}/favorite").status_code == 200
    mine = [s["name"] for s in ask(a)["suggestions"]]
    theirs = ask(b)
    assert "Private casserole" in mine
    assert all("Private casserole" not in s["name"] and "Secret" not in s["name"] for s in theirs["suggestions"] + theirs["discover"])
