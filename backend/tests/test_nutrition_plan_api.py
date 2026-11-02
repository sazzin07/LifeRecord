"""Nutrition Delivery 2 over HTTP: recipes calculated from foods, meal plans, shopping lists from a plan, food swaps,
in-app reminders, copying a day and editing a drink. Throwaway accounts, so isolation is part of what is tested."""
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import requests
import support_db
from support_auth import BASE_URL

PW = "NutriPass123"
N = f"{BASE_URL}/api/nutrition"


def _user():
    email = f"nutri_{uuid.uuid4().hex[:8]}@example.com"
    assert requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": PW, "name": "n"}).status_code == 200
    code = support_db.verification_code_for(email)
    r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code, "password": PW})
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def a():
    return _user()


@pytest.fixture(scope="module")
def b():
    return _user()


@pytest.fixture(scope="module")
def c():
    return _user()


def today(s):
    return s.get(f"{N}/day").json()["today"]


def day_after(s, n):
    return (date.fromisoformat(today(s)) + timedelta(days=n)).isoformat()


def my_food(s, name, per100, portions=None):
    r = s.post(f"{N}/foods", json={"name": name, "nutrients": per100, "portions": portions or []})
    assert r.status_code == 200, r.text
    return r.json()


def recipe(s, name, ingredients, servings=2, **numbers):
    r = s.post(f"{BASE_URL}/api/recipes", json={"name": name, "servings": servings, "ingredients": ingredients, **numbers})
    assert r.status_code == 200, r.text
    return r.json()


FLOUR = {"energy_kcal": 364, "protein_g": 10, "carbs_g": 76, "fat_g": 1, "fiber_g": 2.7, "sodium_mg": 2}
BUTTER = {"energy_kcal": 717, "protein_g": 0.9, "carbs_g": 0.1, "fat_g": 81, "sodium_mg": 11}


# ---------------------------------------------------------------- recipes calculated from foods
def test_linked_recipe_is_calculated_per_serving_and_keeps_whole_recipe_fields(a):
    flour, butter = my_food(a, f"Flour {uuid.uuid4().hex[:5]}", FLOUR), my_food(a, f"Butter {uuid.uuid4().hex[:5]}", BUTTER)
    r = recipe(a, "Shortbread", [{"name": "Flour", "quantity": 300, "unit": "g", "food_id": flour["id"]},
                                 {"name": "Butter", "quantity": 200, "unit": "g", "food_id": butter["id"]}], servings=4,
               calories=1)  # a typed number must not survive: the calculation is authoritative
    # 300 g flour + 200 g butter = 3*364 + 2*717 = 2526 kcal, 4 servings -> 631.5 each
    assert r["nutrients"]["energy_kcal"] == pytest.approx(631.5)
    assert r["nutrients"]["fat_g"] == pytest.approx((3 * 1 + 2 * 81) / 4)
    assert r["nutrients"]["fiber_g"] == pytest.approx(3 * 2.7 / 4)  # butter reports no fibre: the sum uses what was reported, not zero
    assert r["calories"] == pytest.approx(2526.0, abs=0.1)           # whole-recipe legacy field follows the calculation
    assert r["nutrition_meta"] == {"linked": 2, "total": 2, "missing": [], "complete": True}
    assert r["quality"] == "user"
    prev = a.post(f"{N}/recipe-preview", json={"servings": 4, "ingredients": [
        {"name": "Flour", "quantity": 300, "unit": "g", "food_id": flour["id"]}, {"name": "Butter", "quantity": 200, "unit": "g", "food_id": butter["id"]}]}).json()
    assert prev["per_serving"]["energy_kcal"] == pytest.approx(631.5) and prev["complete"] is True


def test_partly_linked_recipe_says_what_is_missing_and_logs_as_estimated(a):
    flour = my_food(a, f"Flour {uuid.uuid4().hex[:5]}", FLOUR)
    r = recipe(a, "Pancakes", [{"name": "Flour", "quantity": 200, "unit": "g", "food_id": flour["id"]}, {"name": "Milk", "quantity": 300, "unit": "ml"}], servings=2)
    assert r["nutrition_meta"]["complete"] is False and r["nutrition_meta"]["missing"] == ["Milk"] and r["nutrition_meta"]["linked"] == 1
    assert r["nutrients"]["energy_kcal"] == pytest.approx(364.0)  # 200 g flour = 728 kcal over 2 servings; milk is NOT counted as zero or guessed
    e = a.post(f"{N}/diary", json={"recipe_id": r["id"], "quantity": 1, "meal_type": "lunch"}).json()
    assert e["nutrients"]["energy_kcal"] == pytest.approx(364.0) and e["quality"] == "estimated"


def test_unconvertible_unit_is_reported_not_guessed(a):
    egg = my_food(a, f"Egg {uuid.uuid4().hex[:5]}", {"energy_kcal": 143, "protein_g": 12.6}, portions=[{"label": "1 large", "grams": 50}])
    ok = a.post(f"{N}/recipe-preview", json={"servings": 1, "ingredients": [{"name": "Egg", "quantity": 3, "unit": "1 large", "food_id": egg["id"]}]}).json()
    assert ok["per_serving"]["energy_kcal"] == pytest.approx(143 * 1.5) and ok["ingredients"][0]["grams"] == 150
    bad = a.post(f"{N}/recipe-preview", json={"servings": 1, "ingredients": [{"name": "Egg", "quantity": 3, "unit": "unit", "food_id": egg["id"]}]}).json()
    assert bad["linked"] == 0 and bad["ingredients"][0]["status"] == "unit_unknown" and "Choose one of" in bad["ingredients"][0]["reason"]
    ghost = a.post(f"{N}/recipe-preview", json={"servings": 1, "ingredients": [{"name": "X", "quantity": 1, "unit": "g", "food_id": "no-such-food"}]}).json()
    assert ghost["ingredients"][0]["status"] == "food_missing" and ghost["linked"] == 0


def test_editing_or_deleting_a_food_updates_recipes_that_use_it(a):
    f = my_food(a, f"Oats {uuid.uuid4().hex[:5]}", {"energy_kcal": 370, "protein_g": 13})
    r = recipe(a, "Porridge", [{"name": "Oats", "quantity": 100, "unit": "g", "food_id": f["id"]}], servings=1)
    assert r["nutrients"]["energy_kcal"] == pytest.approx(370)
    up = a.put(f"{N}/foods/{f['id']}", json={"name": f["name"], "nutrients": {"energy_kcal": 400, "protein_g": 13}})
    assert up.status_code == 200
    now = next(x for x in a.get(f"{BASE_URL}/api/recipes").json() if x["id"] == r["id"])
    assert now["nutrients"]["energy_kcal"] == pytest.approx(400) and now["calories"] == pytest.approx(400)
    assert a.delete(f"{N}/foods/{f['id']}").status_code == 200
    gone = next(x for x in a.get(f"{BASE_URL}/api/recipes").json() if x["id"] == r["id"])
    assert gone["nutrition_meta"]["linked"] == 0 and gone["nutrients"] is None  # honest: no calculation any more


def test_cooking_logs_one_serving_with_full_nutrients_and_the_right_day(a):
    f = my_food(a, f"Rice {uuid.uuid4().hex[:5]}", {"energy_kcal": 130, "protein_g": 2.7, "iron_mg": 0.2})
    r = recipe(a, "Rice bowl", [{"name": f"cookrice{uuid.uuid4().hex[:4]}", "quantity": 1, "unit": "g"}, {"name": "Rice", "quantity": 400, "unit": "g", "food_id": f["id"]}], servings=2)
    c = a.post(f"{BASE_URL}/api/recipes/{r['id']}/cook").json()
    assert c["meal_logged"] is True and c["meal_id"]
    day = a.get(f"{N}/day").json()
    entry = next(e for m in day["meals"] for e in m["entries"] if e["id"] == c["meal_id"])
    assert entry["recipe_id"] == r["id"] and entry["unit"] == "serving" and entry["quantity"] == 1
    assert entry["nutrients"]["iron_mg"] == pytest.approx(0.4)  # a micronutrient survives (the old path kept only four numbers)
    assert entry["meal_type"] in ("breakfast", "lunch", "snack", "dinner")


# ---------------------------------------------------------------- meal planning
def test_plan_is_separate_from_the_diary_until_it_is_logged(a):
    f = my_food(a, f"Lentils {uuid.uuid4().hex[:5]}", {"energy_kcal": 116, "protein_g": 9, "fiber_g": 8})
    d = day_after(a, 2)
    p = a.post(f"{N}/plan", json={"date": d, "meal_type": "dinner", "food_id": f["id"], "quantity": 200, "unit": "g", "note": "batch cook"}).json()
    assert p["status"] == "planned" and p["nutrients"]["energy_kcal"] == pytest.approx(232) and p["note"] == "batch cook"
    plan = a.get(f"{N}/plan", params={"start": d, "end": d}).json()
    assert plan["days"][0]["totals"]["energy_kcal"] == pytest.approx(232) and plan["days"][0]["planned"] == 1
    assert plan["days"][0]["progress"]["fiber_g"]["intake"] == pytest.approx(16)
    assert a.get(f"{N}/day", params={"date": d}).json()["entries"] == 0   # nothing eaten yet

    logged = a.post(f"{N}/plan/{p['id']}/log", json={}).json()
    assert logged["duplicate"] is False and logged["entry"]["date"] == d and logged["entry"]["nutrients"]["energy_kcal"] == pytest.approx(232)
    assert logged["plan"]["status"] == "logged" and logged["plan"]["meal_id"] == logged["entry"]["id"]
    again = a.post(f"{N}/plan/{p['id']}/log", json={}).json()
    assert again["duplicate"] is True and again["entry"]["id"] == logged["entry"]["id"]
    assert a.get(f"{N}/day", params={"date": d}).json()["entries"] == 1   # exactly one diary entry, however often it is logged
    assert a.put(f"{N}/plan/{p['id']}", json={"quantity": 50}).status_code == 409
    assert a.delete(f"{N}/plan/{p['id']}").status_code == 200


def test_plan_edit_recalculates_and_validates(a):
    f = my_food(a, f"Tofu {uuid.uuid4().hex[:5]}", {"energy_kcal": 144, "protein_g": 17})
    d = day_after(a, 3)
    p = a.post(f"{N}/plan", json={"date": d, "meal_type": "lunch", "food_id": f["id"], "quantity": 100, "unit": "g"}).json()
    up = a.put(f"{N}/plan/{p['id']}", json={"quantity": 250, "meal_type": "dinner", "eaten_at": "19:30"}).json()
    assert up["grams"] == 250 and up["nutrients"]["energy_kcal"] == pytest.approx(360) and (up["meal_type"], up["eaten_at"]) == ("dinner", "19:30")
    assert a.put(f"{N}/plan/{p['id']}", json={"unit": "handful"}).status_code == 422
    assert a.post(f"{N}/plan", json={"date": d, "food_id": f["id"], "quantity": 0, "unit": "g"}).status_code == 422
    assert a.post(f"{N}/plan", json={"date": "2026-13-45", "food_id": f["id"], "quantity": 1, "unit": "g"}).status_code == 422
    assert a.get(f"{N}/plan", params={"start": d, "end": day_after(a, 60)}).status_code == 422   # at most 31 days
    assert a.get(f"{N}/plan", params={"start": d, "end": day_after(a, 1)}).status_code == 422     # must run forwards
    quick = a.post(f"{N}/plan", json={"date": d, "meal_type": "dinner", "description": "Dinner out", "calories": 800}).json()
    assert quick["nutrients"] == {"energy_kcal": 800.0} and quick["quality"] == "user"
    assert a.put(f"{N}/plan/{quick['id']}", json={"quantity": 2}).status_code == 422   # a typed-in item has no quantity to scale
    fixed = a.put(f"{N}/plan/{quick['id']}", json={"calories": 650, "protein": 30}).json()
    assert fixed["nutrients"] == {"energy_kcal": 650.0, "protein_g": 30.0}
    assert a.put(f"{N}/plan/{p['id']}", json={"calories": 5}).status_code == 422       # a food's numbers come from the food


def test_copy_a_week_of_plans_shifts_every_date(a):
    f = my_food(a, f"Beans {uuid.uuid4().hex[:5]}", {"energy_kcal": 90, "protein_g": 6})
    start = day_after(a, 20)
    for i in range(3):
        assert a.post(f"{N}/plan", json={"date": (date.fromisoformat(start) + timedelta(days=i)).isoformat(), "meal_type": "lunch",
                                         "food_id": f["id"], "quantity": 100, "unit": "g"}).status_code == 200
    to = day_after(a, 34)
    r = a.post(f"{N}/plan/copy", json={"from_start": start, "days": 7, "to_start": to}).json()
    assert r["copied"] == 3
    assert sorted(e["date"] for e in r["entries"]) == [to, (date.fromisoformat(to) + timedelta(days=1)).isoformat(), (date.fromisoformat(to) + timedelta(days=2)).isoformat()]
    assert a.post(f"{N}/plan/copy", json={"from_start": start, "days": 7, "to_start": start}).status_code == 422
    assert a.post(f"{N}/plan/copy", json={"from_start": day_after(a, 300), "days": 1, "to_start": day_after(a, 301)}).status_code == 404


def test_plans_are_private(a, b):
    f = my_food(a, f"Kale {uuid.uuid4().hex[:5]}", {"energy_kcal": 35})
    d = day_after(a, 5)
    p = a.post(f"{N}/plan", json={"date": d, "food_id": f["id"], "quantity": 100, "unit": "g"}).json()
    assert b.get(f"{N}/plan", params={"start": d, "end": d}).json()["days"][0]["entries"] == []
    assert b.put(f"{N}/plan/{p['id']}", json={"note": "x"}).status_code == 404
    assert b.post(f"{N}/plan/{p['id']}/log", json={}).status_code == 404
    assert b.delete(f"{N}/plan/{p['id']}").status_code == 404
    assert b.post(f"{N}/plan", json={"date": d, "food_id": f["id"], "quantity": 100, "unit": "g"}).status_code == 404   # a private food is invisible to others
    assert a.get(f"{N}/plan", params={"start": d, "end": d}).json()["days"][0]["entries"][0]["id"] == p["id"]


# ---------------------------------------------------------------- shopping list from a plan
def test_plan_to_shopping_list_subtracts_stock_and_never_buys(a):
    flour = my_food(a, f"Flour {uuid.uuid4().hex[:5]}", FLOUR)
    tag = uuid.uuid4().hex[:6]
    r = recipe(a, "Bread", [{"name": f"Flourx{tag}", "quantity": 500, "unit": "g", "food_id": flour["id"]},
                            {"name": f"Yeastx{tag}", "quantity": 10, "unit": "g"}], servings=2)
    stock = a.post(f"{BASE_URL}/api/groceries", json={"name": f"Flourx{tag}", "quantity": 200, "unit": "g"}).json()
    d = day_after(a, 50)
    # 2 servings of a 2-serving recipe = the whole recipe; plus the same recipe once more on another day
    for day in (d, day_after(a, 51)):
        assert a.post(f"{N}/plan", json={"date": day, "meal_type": "dinner", "recipe_id": r["id"], "quantity": 2}).status_code == 200
    lst = a.post(f"{BASE_URL}/api/shopping/lists", json={"name": f"Plan {tag}"}).json()
    res = a.post(f"{N}/plan/shopping-list", json={"start": d, "end": day_after(a, 51), "list_id": lst["id"]}).json()
    added = {x["name"]: x for x in res["added"]}
    assert added[f"Flourx{tag}"]["quantity"] == pytest.approx(800) and added[f"Yeastx{tag}"]["quantity"] == pytest.approx(20)   # 1000 g and 20 g needed, 200 g in stock
    assert res["planned_items"] == 2
    again = a.post(f"{N}/plan/shopping-list", json={"start": d, "end": day_after(a, 51), "list_id": lst["id"]}).json()
    assert again["added"] == [] and set(again["already_on_list"]) == {f"Flourx{tag}", f"Yeastx{tag}"}
    items = a.get(f"{BASE_URL}/api/shopping", params={"list_id": lst["id"]}).json()["items"]
    assert len(items) == 2 and all(not i["bought"] for i in items)
    assert next(g for g in a.get(f"{BASE_URL}/api/groceries").json() if g["id"] == stock["id"])["quantity"] == 200   # inventory untouched
    assert a.post(f"{N}/plan/shopping-list", json={"start": d, "end": d, "list_id": "not-mine"}).status_code == 404


def test_plain_foods_are_listed_by_weight_and_quick_entries_are_skipped(a):
    f = my_food(a, f"Salmon, Atlantic, raw {uuid.uuid4().hex[:4]}", {"energy_kcal": 208, "protein_g": 20})
    d = day_after(a, 40)
    a.post(f"{N}/plan", json={"date": d, "meal_type": "dinner", "food_id": f["id"], "quantity": 300, "unit": "g"})
    a.post(f"{N}/plan", json={"date": d, "meal_type": "lunch", "description": "Canteen lunch", "calories": 700})
    res = a.post(f"{N}/plan/shopping-list", json={"start": d, "end": d}).json()
    assert [(x["name"], x["quantity"], x["unit"]) for x in res["added"]] == [("Salmon", 300.0, "g")]
    assert res["skipped"] == ["Canteen lunch"]


# ---------------------------------------------------------------- swaps
def test_swaps_are_same_category_lower_in_the_nutrient_and_never_assume_missing_data(a):
    res = a.get(f"{N}/foods/search", params={"q": "cheese, cheddar", "limit": 5}).json()
    f = next(x for x in res if x["name"].lower().startswith("cheese, cheddar"))
    sw = a.get(f"{N}/foods/{f['id']}/swaps", params={"nutrient": "sodium_mg"}).json()
    assert sw["direction"] == "lower" and sw["swaps"], sw
    assert all(s["per100"] < sw["original_per100"] and s["category"] == f["category"] for s in sw["swaps"])
    assert all(abs(s["energy_kcal"] - f["per100"]["energy_kcal"]) / f["per100"]["energy_kcal"] <= 0.35 for s in sw["swaps"])
    assert a.get(f"{N}/foods/{f['id']}/swaps", params={"nutrient": "nope"}).status_code == 404
    mine = my_food(a, f"Mystery {uuid.uuid4().hex[:5]}", {"energy_kcal": 100})
    none = a.get(f"{N}/foods/{mine['id']}/swaps", params={"nutrient": "sodium_mg"}).json()
    assert none["swaps"] == [] and "no sodium" in none["note"].lower()


def test_swaps_respect_allergy_words(a):
    res = a.get(f"{N}/foods/search", params={"q": "cheese, cheddar", "limit": 5}).json()
    f = next(x for x in res if x["name"].lower().startswith("cheese, cheddar"))
    sw = a.get(f"{N}/foods/{f['id']}/swaps", params={"nutrient": "sodium_mg", "limit": 20}).json()["swaps"]
    word = sw[0]["name"].split(",")[1].strip().lower().split()[0] if "," in sw[0]["name"] else sw[0]["name"].split()[0].lower()
    assert a.put(f"{N}/profile", json={"allergies": [word]}).status_code == 200
    after = a.get(f"{N}/foods/{f['id']}/swaps", params={"nutrient": "sodium_mg", "limit": 20}).json()["swaps"]
    assert all(word not in s["name"].lower() for s in after)
    a.put(f"{N}/profile", json={"allergies": []})


# ---------------------------------------------------------------- reminders (in-app)
def test_reminders_fire_after_their_time_until_the_meal_is_logged(c, b):
    assert c.get(f"{N}/reminders").json() == {"enabled": False, "meals": {}, "water_by": None}
    assert c.get(f"{N}/reminders/due").json() == {"enabled": False, "due": []}
    assert c.put(f"{N}/reminders", json={"enabled": True, "meals": {"lunch": "25:00"}}).status_code == 422
    assert c.put(f"{N}/reminders", json={"enabled": True, "meals": {"brunch": "10:00"}}).status_code == 422
    assert c.put(f"{N}/reminders", json={"enabled": True, "meals": {"breakfast": "00:00", "lunch": "00:01", "dinner": "23:59"}, "water_by": "00:00"}).status_code == 200
    due = c.get(f"{N}/reminders/due").json()
    kinds = {d["id"] for d in due["due"]}
    assert {"meal:breakfast", "meal:lunch", "water"} <= kinds
    assert ("meal:dinner" in kinds) == (due["now"] >= "23:59")   # dinner is only due once 23:59 has passed
    f = my_food(c, f"Toast {uuid.uuid4().hex[:5]}", {"energy_kcal": 265})
    assert c.post(f"{N}/diary", json={"food_id": f["id"], "quantity": 50, "unit": "g", "meal_type": "breakfast"}).status_code == 200
    kinds = {d["id"] for d in c.get(f"{N}/reminders/due").json()["due"]}
    assert "meal:breakfast" not in kinds and "meal:lunch" in kinds
    assert c.put(f"{N}/reminders", json={"enabled": False}).status_code == 200
    assert c.get(f"{N}/reminders/due").json()["due"] == []
    assert b.get(f"{N}/reminders").json()["enabled"] is False   # another account is unaffected


def test_reminders_follow_the_profile_time_zone_and_survive_profile_edits(c):
    assert c.put(f"{N}/profile", json={"timezone": "Pacific/Kiritimati"}).status_code == 200   # UTC+14: a different calendar day from UTC for much of the day
    assert c.put(f"{N}/reminders", json={"enabled": True, "meals": {"lunch": "00:00"}}).status_code == 200
    due = c.get(f"{N}/reminders/due").json()
    assert due["date"] == datetime.now(ZoneInfo("Pacific/Kiritimati")).date().isoformat()
    assert any(d["id"] == "meal:lunch" for d in due["due"])
    assert c.put(f"{N}/profile", json={"timezone": "Europe/Lisbon"}).status_code == 200
    assert c.get(f"{N}/reminders").json()["meals"] == {"lunch": "00:00"}   # saving the profile never wipes reminders


# ---------------------------------------------------------------- copy a day, edit a drink, recents
def test_copy_a_meal_to_another_day(a):
    f = my_food(a, f"Yoghurt {uuid.uuid4().hex[:5]}", {"energy_kcal": 60, "protein_g": 10})
    src, dst = day_after(a, -10), day_after(a, -9)
    for meal in ("breakfast", "lunch"):
        assert a.post(f"{N}/diary", json={"date": src, "meal_type": meal, "food_id": f["id"], "quantity": 100, "unit": "g"}).status_code == 200
    r = a.post(f"{N}/diary/copy", json={"from_date": src, "to_date": dst, "meal_type": "breakfast"}).json()
    assert r["copied"] == 1 and r["entries"][0]["date"] == dst and r["entries"][0]["meal_type"] == "breakfast"
    assert r["entries"][0]["nutrients"]["energy_kcal"] == pytest.approx(60)
    assert a.get(f"{N}/day", params={"date": dst}).json()["entries"] == 1
    assert a.post(f"{N}/diary/copy", json={"from_date": src, "to_date": src}).status_code == 422
    assert a.post(f"{N}/diary/copy", json={"from_date": day_after(a, -200), "to_date": dst}).status_code == 404


def test_edit_a_drink(a):
    w = a.post(f"{N}/water", json={"amount_ml": 250}).json()
    up = a.put(f"{N}/water/{w['id']}", json={"amount_ml": 330, "beverage": "tea"}).json()
    assert (up["amount_ml"], up["beverage"]) == (330, "tea")
    assert a.put(f"{N}/water/{w['id']}", json={"amount_ml": 0}).status_code == 422
    assert a.put(f"{N}/water/nope", json={"amount_ml": 100}).status_code == 404


def test_recent_foods_remember_the_last_amount_used(a):
    f = my_food(a, f"Hummus {uuid.uuid4().hex[:5]}", {"energy_kcal": 166}, portions=[{"label": "1 tbsp", "grams": 15}])
    a.post(f"{N}/diary", json={"food_id": f["id"], "quantity": 100, "unit": "g", "meal_type": "snack"})
    a.post(f"{N}/diary", json={"food_id": f["id"], "quantity": 3, "unit": "1 tbsp", "meal_type": "lunch"})
    rec = next(x for x in a.get(f"{N}/foods/recent").json() if x["id"] == f["id"])
    assert rec["times_logged"] == 2 and rec["last_unit"] == "1 tbsp" and rec["last_quantity"] == 3 and rec["last_meal_type"] == "lunch"


# ---------------------------------------------------------------- Delivery 3: older endpoints follow the profile's day and stay bounded
def test_the_older_meal_endpoint_uses_the_profile_day_and_a_sensible_meal(c):
    assert c.put(f"{N}/profile", json={"timezone": "Pacific/Kiritimati"}).status_code == 200   # UTC+14: usually a different date from UTC
    m = c.post(f"{BASE_URL}/api/meals", json={"description": "Quick add from the header", "calories": 200}).json()
    now = datetime.now(ZoneInfo("Pacific/Kiritimati"))   # taken right after the request; the two only differ if the hour changes in between
    assert m["date"] == now.date().isoformat()
    assert m["meal_type"] == ("breakfast" if now.hour < 11 else "lunch" if now.hour < 15 else "snack" if now.hour < 18 else "dinner")
    day = c.get(f"{N}/day").json()
    assert day["today"] == m["date"] and any(e["id"] == m["id"] for mt in day["meals"] for e in mt["entries"])   # shows on the Nutrition page's today
    c.put(f"{N}/profile", json={"timezone": "Europe/Lisbon"})


def test_the_older_meal_list_is_bounded_when_no_day_is_given(c):
    for i in range(3):
        assert c.post(f"{BASE_URL}/api/meals", json={"description": f"bounded {i}", "calories": 10, "date": "2020-01-0%d" % (i + 1)}).status_code == 200
    assert len(c.get(f"{BASE_URL}/api/meals", params={"limit": 2}).json()) == 2
    assert len(c.get(f"{BASE_URL}/api/meals", params={"date": "2020-01-01", "limit": 1}).json()) == 1   # a named day is always complete
    assert c.get(f"{BASE_URL}/api/meals", params={"limit": 0}).status_code == 422
    assert c.get(f"{BASE_URL}/api/meals", params={"limit": 5000}).status_code == 422
    assert c.post(f"{BASE_URL}/api/meals", json={"description": "bad date", "calories": 1, "date": "2026-13-45"}).status_code == 422
