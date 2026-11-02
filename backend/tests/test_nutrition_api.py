"""Nutrition API against the running backend, with throwaway accounts (isolation is part of what is tested)."""
import sys
import time
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
import requests
import support_db
from support_auth import BASE_URL

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import nutrition_api as napi  # noqa: E402

PW = "NutriPass123"
N = f"{BASE_URL}/api/nutrition"
TODAY = date.today().isoformat()


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


def find(s, q, contains=None):
    res = s.get(f"{N}/foods/search", params={"q": q, "limit": 50}).json()
    assert res, f"no food found for {q}"
    return next((f for f in res if contains is None or contains in f["name"].lower()), res[0])


def log(s, food, qty, unit="g", **kw):
    r = s.post(f"{N}/diary", json={"food_id": food["id"], "quantity": qty, "unit": unit, **kw})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- food database
def test_search_ranks_exact_starts_first_and_is_safe_with_odd_characters(a):
    res = a.get(f"{N}/foods/search", params={"q": "spinach raw"}).json()
    assert res and "spinach" in res[0]["name"].lower()
    assert all(f["source"] in ("usda_foundation", "usda_sr_legacy") for f in res[:3])
    for odd in ("%", "_", "'; DROP TABLE foods;--", "a\\b"):
        assert a.get(f"{N}/foods/search", params={"q": odd}).status_code == 200


def test_food_detail_lists_every_tracked_nutrient_and_says_what_is_missing(a):
    f = find(a, "spinach, raw", "spinach, raw")
    d = a.get(f"{N}/foods/{f['id']}").json()
    keys = {n["key"]: n["per100"] for n in d["nutrients"]}
    assert keys["vit_c_mg"] and keys["energy_kcal"] > 0
    assert keys["biotin_ug"] is None  # not in the source: reported as unavailable, never as 0
    assert d["source"].startswith("usda") and d["quality"] == "verified" and d["data_version"]
    assert d["completeness"]["of"] == 41 and 0 < d["completeness"]["reported"] <= 41  # 42 nutrients, minus biotin which no source here has


# ---------------------------------------------------------------- diary
def test_logging_a_food_scales_nutrients_and_persists_in_the_day(a):
    f = find(a, "egg, whole, raw, fresh", "egg, whole, raw")
    e = log(a, f, 150, "g", meal_type="breakfast", eaten_at="08:15")
    assert e["grams"] == 150 and e["meal_type"] == "breakfast" and e["quality"] == "verified" and e["source"] == "food"
    per100 = {n["key"]: n["per100"] for n in a.get(f"{N}/foods/{f['id']}").json()["nutrients"]}
    assert e["nutrients"]["energy_kcal"] == pytest.approx(per100["energy_kcal"] * 1.5)
    assert e["nutrients"]["protein_g"] == pytest.approx(per100["protein_g"] * 1.5)
    day = a.get(f"{N}/day", params={"date": TODAY}).json()
    assert day["totals"]["energy_kcal"] == pytest.approx(e["nutrients"]["energy_kcal"]) and day["entries"] == 1
    assert [m["meal_type"] for m in day["meals"]] == ["breakfast"]
    # the older meals endpoint (Home, Calendar) sees the same calories
    legacy = [m for m in a.get(f"{BASE_URL}/api/meals", params={"date": TODAY}).json() if m["id"] == e["id"]][0]
    assert legacy["calories"] == pytest.approx(e["nutrients"]["energy_kcal"], abs=0.1)


def test_portion_units_and_validation(a):
    f = find(a, "spinach, raw", "spinach, raw")
    cup = log(a, f, 2, "1 cup")
    assert cup["grams"] == 60.0
    for body, text in (({"food_id": f["id"], "quantity": 0, "unit": "g"}, None), ({"food_id": f["id"], "quantity": 5, "unit": "handful"}, "Choose one of"),
                       ({"food_id": f["id"], "quantity": 5, "unit": "ml"}, "density")):
        r = a.post(f"{N}/diary", json=body)
        assert r.status_code == 422, (body, r.text)
        if text:
            assert text in r.text
    oil = find(a, "oil, olive", "oil, olive")
    r = a.post(f"{N}/diary", json={"food_id": oil["id"], "quantity": 10, "unit": "ml"})
    assert r.status_code == 422 and "density" in r.text  # no guessing for non-watery foods
    assert a.post(f"{N}/diary", json={"quantity": 5, "unit": "g"}).status_code == 422  # nothing to log
    assert a.post(f"{N}/diary", json={"food_id": f["id"], "recipe_id": f["id"], "quantity": 1}).status_code == 422


def test_edit_move_duplicate_delete(a):
    f = find(a, "banana", "bananas, raw")
    e = log(a, f, 100, "g", meal_type="snack")
    up = a.put(f"{N}/diary/{e['id']}", json={"quantity": 200, "meal_type": "lunch"}).json()
    assert up["grams"] == 200 and up["meal_type"] == "lunch" and up["nutrients"]["energy_kcal"] == pytest.approx(e["nutrients"]["energy_kcal"] * 2)
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    moved = a.post(f"{N}/diary/{e['id']}/move", json={"date": tomorrow, "meal_type": "dinner", "eaten_at": "19:30"}).json()
    assert (moved["date"], moved["meal_type"], moved["eaten_at"]) == (tomorrow, "dinner", "19:30")
    dup = a.post(f"{N}/diary/{e['id']}/duplicate", json={"date": TODAY}).json()
    assert dup["id"] != e["id"] and dup["date"] == TODAY and dup["nutrients"] == moved["nutrients"]
    assert a.delete(f"{N}/diary/{dup['id']}").status_code == 200
    assert a.delete(f"{N}/diary/{dup['id']}").status_code == 404
    assert a.delete(f"{N}/diary/{e['id']}").status_code == 200


def test_retried_requests_and_concurrent_edits_are_handled(a):
    f = find(a, "apple", "apples, raw")
    ref = f"c-{uuid.uuid4().hex}"
    first = log(a, f, 100, "g", client_ref=ref)
    again = a.post(f"{N}/diary", json={"food_id": f["id"], "quantity": 100, "unit": "g", "client_ref": ref}).json()
    assert again["id"] == first["id"] and again["duplicate"] is True
    assert a.put(f"{N}/diary/{first['id']}", json={"quantity": 120}).status_code == 200
    stale = a.put(f"{N}/diary/{first['id']}", json={"quantity": 130, "if_updated_at": first["updated_at"]})
    assert stale.status_code == 409


def test_quick_entries_count_but_only_with_what_was_typed(a):
    r = a.post(f"{BASE_URL}/api/meals", json={"description": "Mystery stew", "calories": 450, "date": TODAY}).json()
    day = a.get(f"{N}/day", params={"date": TODAY}).json()
    stew = next(e for m in day["meals"] for e in m["entries"] if e["id"] == r["id"])
    assert stew["nutrients"] == {"energy_kcal": 450.0} and stew["source"] == "quick"
    assert day["progress"]["vit_c_mg"]["complete"] is False  # the stew has no vitamin C data; the app says so
    assert a.get(f"{N}/day", params={"date": "2001-01-01"}).json()["totals"] == {}
    # editing through the older endpoint turns it into a plain quick entry
    up = a.put(f"{BASE_URL}/api/meals/{r['id']}", json={"description": "Mystery stew", "calories": 500, "date": TODAY}).json()
    assert up["calories"] == 500


def test_users_cannot_touch_each_others_diary_or_foods(a, b):
    f = find(a, "rice, white", "rice, white")
    e = log(a, f, 100)
    assert b.put(f"{N}/diary/{e['id']}", json={"quantity": 1}).status_code == 404
    assert b.delete(f"{N}/diary/{e['id']}").status_code == 404
    assert b.post(f"{N}/diary/{e['id']}/duplicate", json={}).status_code == 404
    assert all(x["id"] != e["id"] for m in b.get(f"{N}/day", params={"date": TODAY}).json()["meals"] for x in m["entries"])
    mine = a.post(f"{N}/foods", json={"name": f"Private {uuid.uuid4().hex[:6]}", "nutrients": {"energy_kcal": 100, "protein_g": 5}}).json()
    assert b.get(f"{N}/foods/{mine['id']}").status_code == 404
    assert b.post(f"{N}/diary", json={"food_id": mine["id"], "quantity": 10, "unit": "g"}).status_code == 404
    assert not b.get(f"{N}/foods/search", params={"q": mine["name"][:12]}).json()


# ---------------------------------------------------------------- user foods
def test_user_foods_are_validated_deduplicated_and_editable(a):
    name = f"My granola {uuid.uuid4().hex[:6]}"
    ok = a.post(f"{N}/foods", json={"name": name, "brand": "Home", "nutrients": {"energy_kcal": 450, "protein_g": 10, "carbs_g": 60, "fat_g": 18, "fiber_g": 7},
                                    "portions": [{"label": "1 bowl", "grams": 45}]})
    assert ok.status_code == 200, ok.text
    food = ok.json()
    assert food["quality"] == "user" and food["source"] == "user" and food["mine"] is True
    assert a.post(f"{N}/foods", json={"name": name, "brand": "Home", "nutrients": {"energy_kcal": 1}}).status_code == 409
    bad = [{"energy_kcal": 100, "protein_g": 80, "carbs_g": 60},            # more than 100 g of macros
           {"energy_kcal": 100, "mystery": 3},                               # unknown nutrient
           {"protein_g": 10},                                                # no energy
           {"energy_kcal": 100, "carbs_g": 10, "sugars_g": 30},              # sugars above carbohydrate
           {"energy_kcal": -5}]
    for n in bad:
        assert a.post(f"{N}/foods", json={"name": f"x{uuid.uuid4().hex[:5]}", "nutrients": n}).status_code == 422, n
    e = log(a, food, 2, "1 bowl")
    assert e["grams"] == 90 and e["quality"] == "user" and e["nutrients"]["fiber_g"] == pytest.approx(6.3)
    assert a.put(f"{N}/foods/{food['id']}", json={"name": name, "nutrients": {"energy_kcal": 400}, "portions": [{"label": "1 bowl", "grams": 45}]}).status_code == 200
    assert a.put(f"{N}/diary/{e['id']}", json={"quantity": 1}).json()["nutrients"]["energy_kcal"] == pytest.approx(180.0)  # recalculated from the new food values
    shared = find(a, "spinach, raw", "spinach, raw")
    assert a.put(f"{N}/foods/{shared['id']}", json={"name": "x", "nutrients": {"energy_kcal": 1}}).status_code == 404
    assert a.delete(f"{N}/foods/{shared['id']}").status_code == 404
    assert a.delete(f"{N}/foods/{food['id']}").status_code == 200
    kept = [x for m in a.get(f"{N}/day", params={"date": TODAY}).json()["meals"] for x in m["entries"] if x["id"] == e["id"]][0]
    assert kept["nutrients"]["energy_kcal"] == pytest.approx(180.0)  # history keeps its snapshot


def test_favorites_and_recents(a):
    f = find(a, "broccoli, raw", "broccoli, raw")
    assert a.post(f"{N}/foods/{f['id']}/favorite").json()["favorite"] is True
    assert a.post(f"{N}/foods/{f['id']}/favorite").status_code == 200  # idempotent
    assert any(x["id"] == f["id"] for x in a.get(f"{N}/foods/favorites").json())
    assert next(x for x in a.get(f"{N}/foods/search", params={"q": "broccoli raw"}).json() if x["id"] == f["id"])["favorite"] is True
    log(a, f, 80)
    assert any(x["id"] == f["id"] and x["times_logged"] >= 1 for x in a.get(f"{N}/foods/recent").json())
    assert a.delete(f"{N}/foods/{f['id']}/favorite").json()["favorite"] is False


def test_barcode_validation_and_open_food_facts_mapping():
    assert requests.get(f"{N}/foods/barcode/abc", headers=_user().headers).status_code == 422
    product = {"status": 1, "product": {"product_name": "Hazelnut spread", "brands": "Acme, Other", "serving_size": "15 g", "serving_quantity": "15",
                                         "nutriments": {"energy-kcal_100g": 539, "proteins_100g": 6.3, "carbohydrates_100g": 57.5, "fat_100g": 30.9,
                                                        "sugars_100g": 56.3, "saturated-fat_100g": 10.6, "salt_100g": 0.107, "calcium_100g": 0.1}}}
    m = napi.map_off_product(product)
    assert m["name"] == "Hazelnut spread" and m["brand"] == "Acme"
    assert m["nutrients"]["energy_kcal"] == 539 and m["nutrients"]["sodium_mg"] == pytest.approx(42.8)  # salt x 0.4
    assert "calcium_mg" not in m["nutrients"]  # micronutrients are deliberately not imported from Open Food Facts
    assert m["portions"] == [{"label": "1 serving (15 g)", "grams": 15.0}]
    assert napi.map_off_product({"product": {"product_name": "No data", "nutriments": {}}}) is None
    kj = napi.map_off_product({"product": {"product_name": "Juice", "nutriments": {"energy_100g": 188}}})
    assert kj["nutrients"]["energy_kcal"] == pytest.approx(44.9, abs=0.1)
    assert napi.map_off_product({"product": {"product_name": "Impossible", "nutriments": {"energy-kcal_100g": 100, "proteins_100g": 90, "fat_100g": 80}}}) is None


# ---------------------------------------------------------------- profile, targets, hydration
def test_profile_validation_and_personalised_targets():
    s = _user()
    assert s.get(f"{N}/targets").json()["personalised"] is False
    assert s.put(f"{N}/profile", json={"sex": "M", "pregnancy": "pregnant_t1"}).status_code == 422
    assert s.put(f"{N}/profile", json={"timezone": "Mars/Phobos"}).status_code == 422
    assert s.put(f"{N}/profile", json={"birth_year": 1800}).status_code == 422
    thisyear = date.today().year
    ok = s.put(f"{N}/profile", json={"birth_year": thisyear - 35, "sex": "F", "weight_kg": 62, "activity": "moderate", "diet_tags": ["vegan"],
                                     "allergies": ["Peanut", " peanut ", ""], "timezone": "Europe/Lisbon"})
    assert ok.status_code == 200 and ok.json()["allergies"] == ["peanut"]
    t = s.get(f"{N}/targets").json()
    assert t["personalised"] and t["items"]["energy_kcal"]["target"] == 2080 and t["items"]["protein_g"]["target"] == round(0.83 * 62)
    assert t["items"]["iron_mg"]["target"] == 16 and any(src["doi"] == "10.2903/sp.efsa.2017.e15121" for src in t["sources"] if src.get("doi"))
    s.put(f"{N}/profile", json={"birth_year": thisyear - 15, "sex": "F", "weight_kg": 50})
    teen = s.get(f"{N}/targets").json()
    assert teen["supported"] and teen["personalised"] and teen["items"]["protein_g"]["target"] == round(0.85 * 50)  # EFSA PRI for a 15 year old girl, 0.85 g/kg
    assert teen["items"]["zinc_mg"]["upper"]["value"] == 22 and all(src["publisher"].startswith("European Food Safety") for src in teen["sources"])
    s.put(f"{N}/profile", json={"birth_year": thisyear, "sex": "F"})
    assert s.get(f"{N}/targets").json()["supported"] is False  # a baby: EFSA's tables start at 1 year
    s.put(f"{N}/profile", json={"birth_year": thisyear - 35, "sex": "F", "weight_kg": 62, "activity": "moderate"})
    assert s.delete(f"{N}/profile").status_code == 200 and s.get(f"{N}/profile").json()["exists"] is False


def test_user_targets_win_and_unsafe_ones_are_flagged_not_silently_changed():
    s = _user()
    s.put(f"{N}/profile", json={"birth_year": date.today().year - 40, "sex": "M", "weight_kg": 80, "activity": "sedentary"})
    base = s.get(f"{N}/targets").json()["items"]["fiber_g"]["target"]
    assert base == 25
    r = s.put(f"{N}/targets/fiber_g", json={"target": 35})
    assert r.status_code == 200 and r.json()["warning"] is None
    eff = s.get(f"{N}/targets").json()["items"]["fiber_g"]
    assert eff["target"] == 35 and eff["overridden"] and eff["suggested"]["target"] == 25
    f = find(s, "lentils, raw", "lentils, raw")
    log(s, f, 100)
    p = s.get(f"{N}/day", params={"date": TODAY}).json()["progress"]["fiber_g"]
    assert p["target"] == 35 and p["overridden"] is True
    low = s.put(f"{N}/targets/energy_kcal", json={"target": 900}).json()
    assert "very low" in low["warning"] and s.get(f"{N}/targets").json()["items"]["energy_kcal"]["target"] == 900  # kept: the choice is theirs
    assert s.put(f"{N}/targets/fiber_g", json={"min": 40, "max": 30}).status_code == 422
    assert s.put(f"{N}/targets/nonsense", json={"target": 1}).status_code == 404
    assert s.delete(f"{N}/targets/fiber_g").status_code == 200
    assert s.get(f"{N}/targets").json()["items"]["fiber_g"]["target"] == 25


def test_hydration_counts_drinks_and_food_water_separately(a):
    f = find(a, "spinach, raw", "spinach, raw")
    log(a, f, 200)
    w = a.post(f"{N}/water", json={"amount_ml": 300, "beverage": "tea"}).json()
    a.post(f"{N}/water", json={"amount_ml": 500})
    h = a.get(f"{N}/day", params={"date": TODAY}).json()["hydration"]
    assert h["drinks_ml"] >= 800 and h["food_water_ml"] > 0 and h["total_ml"] == h["drinks_ml"] + h["food_water_ml"] and h["target_ml"]
    assert a.post(f"{N}/water", json={"amount_ml": 0}).status_code == 422
    assert a.post(f"{N}/water", json={"amount_ml": 100, "beverage": "beer"}).status_code == 422
    assert a.delete(f"{N}/water/{w['id']}").status_code == 200
    assert a.delete(f"{N}/water/{w['id']}").status_code == 404


# ---------------------------------------------------------------- trends, contributors, insights
def test_trends_average_only_logged_days_and_contributors_rank_foods():
    s = _user()
    d0 = (date.today() - timedelta(days=2)).isoformat()
    s.post(f"{BASE_URL}/api/meals", json={"description": "Soup", "calories": 300, "protein": 10, "date": d0})
    s.post(f"{BASE_URL}/api/meals", json={"description": "Soup", "calories": 100, "date": TODAY})
    t = s.get(f"{N}/trends", params={"days": 7}).json()
    assert t["days"] == 7 and t["days_logged"] == 2 and len(t["series"]) == 7
    assert t["daily_average"]["energy_kcal"] == pytest.approx(200)  # (300 + 100) / 2 logged days, not / 7
    assert t["daily_average"]["protein_g"] == pytest.approx(10) and t["days_reporting"]["protein_g"] == 1
    assert sum(1 for d in t["series"] if d["logged"]) == 2
    c = s.get(f"{N}/contributors", params={"nutrient": "energy_kcal", "start": d0, "end": TODAY}).json()
    assert c["top"][0]["description"] == "Soup" and c["total"] == 400 and c["top"][0]["share_pct"] == pytest.approx(100)
    assert s.get(f"{N}/contributors", params={"nutrient": "nope", "start": d0, "end": TODAY}).status_code == 404
    assert s.get(f"{N}/trends", params={"days": 500}).status_code == 422


def test_insights_explain_why_and_respect_diet_choices():
    s = _user()
    s.put(f"{N}/profile", json={"birth_year": date.today().year - 30, "sex": "F", "weight_kg": 60, "diet_tags": ["vegan"]})
    assert s.get(f"{N}/insights").json()["insights"] == []  # nothing logged: nothing to say
    f = find(s, "egg, whole, raw", "egg, whole, raw")
    log(s, f, 100)
    out = s.get(f"{N}/insights").json()["insights"]
    assert not any(i["nutrient"] in ("vit_c_mg", "fiber_g") for i in out)  # this egg record has no value for them: unknown is not "low"
    c = next(i for i in out if i["nutrient"] == "calcium_mg")
    assert "not a deficiency" in c["why"] and c["foods"] and c["percent"] < 60
    animal = {"Dairy and Egg Products", "Beef Products", "Poultry Products", "Pork Products", "Finfish and Shellfish Products"}
    for i in out:
        for food in i["foods"]:
            assert s.get(f"{N}/foods/{food['food_id']}").json()["category"] not in animal


def test_reference_foods_have_no_negative_or_impossible_values():
    """USDA's carbohydrate-by-difference can be slightly negative in the source; the importer stores 0. Nothing else may be negative either."""
    import json
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT name, nutrients FROM foods WHERE user_id IS NULL")
            bad = []
            for name, raw in cur.fetchall():
                n = json.loads(raw) if isinstance(raw, str) else raw
                if any(v < 0 for v in n.values()) or n.get("energy_kcal", 0) > 950 or sum(n.get(k, 0) for k in ("protein_g", "carbs_g", "fat_g", "water_g", "alcohol_g")) > 106:
                    bad.append(name)
            cur.execute("SELECT COUNT(*) FROM foods WHERE user_id IS NULL")
            total = cur.fetchone()[0]
    finally:
        conn.close()
    assert total > 8000 and not bad[:5], bad[:5]


def test_logging_a_recipe_serving_divides_the_whole_recipe_by_its_servings(a):
    r = a.post(f"{BASE_URL}/api/recipes", json={"name": f"Stew {uuid.uuid4().hex[:5]}", "servings": 3, "calories": 600, "protein": 45, "carbs": 60, "fat": 18}).json()
    try:
        one = a.post(f"{N}/diary", json={"recipe_id": r["id"], "quantity": 1}).json()
        assert one["nutrients"]["energy_kcal"] == pytest.approx(200) and one["nutrients"]["protein_g"] == pytest.approx(15)
        assert one["source"] == "recipe" and one["unit"] == "serving"
        half_more = a.post(f"{N}/diary", json={"recipe_id": r["id"], "quantity": 1.5}).json()
        assert half_more["nutrients"]["energy_kcal"] == pytest.approx(300)
        assert a.put(f"{N}/diary/{one['id']}", json={"quantity": 2}).json()["nutrients"]["energy_kcal"] == pytest.approx(400)
        empty = a.post(f"{BASE_URL}/api/recipes", json={"name": f"Bare {uuid.uuid4().hex[:5]}", "servings": 1}).json()
        assert a.post(f"{N}/diary", json={"recipe_id": empty["id"], "quantity": 1}).status_code == 422  # no numbers yet: refuse, do not log zero
        a.delete(f"{BASE_URL}/api/recipes/{empty['id']}")
        assert b_user().post(f"{N}/diary", json={"recipe_id": r["id"], "quantity": 1}).status_code == 404  # someone else's recipe
    finally:
        a.delete(f"{BASE_URL}/api/recipes/{r['id']}")


def b_user():
    return _user()
