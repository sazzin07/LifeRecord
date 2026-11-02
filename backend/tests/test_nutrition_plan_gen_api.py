"""Meal-plan generation over HTTP: a preview writes nothing, the focus steers the week, the items kept are saved with the nutrients they had in the
preview, a bad item cancels the whole batch, and accounts never see each other's recipes."""
import uuid
from datetime import date, timedelta

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
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture
def a():
    return _user()


@pytest.fixture
def b():
    return _user()


def recipe_of(s, name, per100, grams=400):
    f = s.post(f"{N}/foods", json={"name": f"{name} base", "nutrients": per100}).json()
    r = s.post(f"{BASE_URL}/api/recipes", json={"name": name, "servings": 1, "ingredients": [{"name": name, "quantity": grams, "unit": "g", "food_id": f["id"]}]})
    assert r.status_code == 200, r.text
    return r.json()


def stock(s, prefix, n=6, **per100):
    return [recipe_of(s, f"{prefix} {i}", {"energy_kcal": 110 + i, **per100}) for i in range(n)]


def start_day(offset=7):
    return (date.today() + timedelta(days=offset)).isoformat()


def gen(s, **kw):
    r = s.post(f"{N}/plan/generate", json={"start": start_day(), **kw})
    assert r.status_code == 200, r.text
    return r.json()


def entries(s, start, days=7):
    end = (date.fromisoformat(start) + timedelta(days=days - 1)).isoformat()
    return [e for d in s.get(f"{N}/plan", params={"start": start, "end": end}).json()["days"] for e in d["entries"]]


def test_a_preview_writes_nothing_and_explains_itself(a):
    stock(a, "Lentil dish", protein_g=9, fiber_g=8)
    out = gen(a)
    assert out["preview"] is True and out["placed"] > 0 and out["digest"] and out["energy_target"] == 2000
    assert entries(a, out["start"]) == []                                    # the preview saved nothing
    for d in out["days"]:
        for i in d["items"]:
            assert i["covers"] and i["log"] and i["nutrients"]["energy_kcal"] > 0
        assert sum(i["nutrients"]["energy_kcal"] for i in d["items"]) <= 2000 * 1.25
        assert len({i["id"] for i in d["items"]}) == len(d["items"])         # nothing twice in a day
    assert [f["nutrient"] for f in out["focus"]][:2] == ["protein_g", "fiber_g"] and out["basis"]


def test_the_chosen_focus_steers_the_week(a):
    stock(a, "Bean bowl", protein_g=9, fiber_g=14)
    stock(a, "Chicken plate", protein_g=40, fiber_g=1)
    fibre_week = gen(a, slots=["lunch", "dinner"], days=3, focus=["fiber_g"], max_repeats=3)
    protein_week = gen(a, slots=["lunch", "dinner"], days=3, focus=["protein_g"], max_repeats=3)
    assert [f["nutrient"] for f in fibre_week["focus"]] == ["fiber_g"] and [f["nutrient"] for f in protein_week["focus"]] == ["protein_g"]
    fibre_total = sum(i["nutrients"].get("fiber_g", 0) for d in fibre_week["days"] for i in d["items"])
    protein_week_fibre = sum(i["nutrients"].get("fiber_g", 0) for d in protein_week["days"] for i in d["items"])
    assert fibre_total > protein_week_fibre                                       # aiming at fibre really brings more fibre
    names_f = {i["name"] for d in gen(a, slots=["lunch", "dinner"], days=3, focus=["fiber_g"], max_repeats=3)["days"] for i in d["items"]}
    names_p = {i["name"] for d in gen(a, slots=["lunch", "dinner"], days=3, focus=["protein_g"], max_repeats=3)["days"] for i in d["items"]}
    assert any(n.startswith("Bean bowl") for n in names_f) and any(n.startswith("Chicken plate") for n in names_p)
    assert sum(n.startswith("Bean bowl") for n in names_f) > sum(n.startswith("Bean bowl") for n in names_p)


def test_the_items_you_keep_are_saved_with_the_nutrients_they_had_in_the_preview(a):
    stock(a, "Stew", protein_g=10, fiber_g=7)
    out = gen(a, days=3)
    keep = [i for d in out["days"] for i in d["items"]][:4]
    r = a.post(f"{N}/plan/bulk", json={"items": [{"date": i["date"], "meal_type": i["meal_type"], **i["log"]} for i in keep]})
    assert r.status_code == 200 and r.json()["created"] == 4
    saved = entries(a, out["start"], 3)
    assert len(saved) == 4 and all(e["status"] == "planned" for e in saved)
    by_key = {(e["date"], e["meal_type"]): e for e in saved}
    for i in keep:
        assert by_key[(i["date"], i["meal_type"])]["nutrients"]["energy_kcal"] == pytest.approx(i["nutrients"]["energy_kcal"], rel=0.01)
    again = gen(a, days=3)                                                   # slots that now have a plan are left alone
    assert all(i["meal_type"] != k[1] or i["date"] != k[0] for d in again["days"] for i in d["items"] for k in by_key)
    assert sum(len(d["skipped"]) for d in again["days"]) == 4
    assert a.get(f"{N}/day", params={"date": out["start"]}).json()["entries"] == 0   # planned is not eaten


def test_a_bad_item_cancels_the_whole_batch(a):
    stock(a, "Dish", protein_g=9, fiber_g=8)
    good = [i for d in gen(a, days=1)["days"] for i in d["items"]][0]
    r = a.post(f"{N}/plan/bulk", json={"items": [{"date": good["date"], "meal_type": good["meal_type"], **good["log"]},
                                                   {"date": good["date"], "meal_type": "snack", "food_id": "no-such-food", "quantity": 100, "unit": "g"}]})
    assert r.status_code == 404
    assert entries(a, good["date"], 1) == []                                   # not even the good one was kept


def test_inputs_are_validated(a):
    stock(a, "Dish", protein_g=9, fiber_g=8)
    for body in ({"days": 0}, {"days": 15}, {"slots": []}, {"slots": ["brunch"]}, {"focus": ["unobtainium"]}, {"max_repeats": 0}, {"start": "2026-13-45"}):
        assert a.post(f"{N}/plan/generate", json={"start": start_day(), **body}).status_code == 422, body
    nofocus = a.post(f"{N}/plan/generate", json={"start": start_day(), "focus": ["carbs_g"]})            # carbohydrate has a range, not a target to aim at
    assert nofocus.status_code == 422 and "target" in nofocus.text
    assert a.post(f"{N}/plan/bulk", json={"items": []}).status_code == 422
    too_many = [{"date": start_day(), "meal_type": "lunch", "food_id": "x", "quantity": 1, "unit": "g"}] * 61
    assert a.post(f"{N}/plan/bulk", json={"items": too_many}).status_code == 422


def test_a_small_pool_says_so_and_database_foods_fill_gaps_only_when_asked(a):
    empty = gen(a)
    assert empty["placed"] == 0 and any("not enough" in n.lower() for n in empty["notes"])
    filled = gen(a, use_database_foods=True, days=2)
    assert filled["placed"] > 0
    assert all("reference database" in " ".join(i["flags"]) for d in filled["days"] for i in d["items"])   # clearly marked as new, not the person's own


def test_allergy_words_keep_things_out_of_the_plan(a):
    recipe_of(a, "Peanut curry", {"energy_kcal": 120, "protein_g": 10, "fiber_g": 8})
    recipe_of(a, "Lentil curry", {"energy_kcal": 120, "protein_g": 10, "fiber_g": 8})
    assert a.put(f"{N}/profile", json={"allergies": ["peanut"]}).status_code == 200
    out = gen(a, days=2, slots=["lunch"], max_repeats=4)
    names = {i["name"] for d in out["days"] for i in d["items"]}
    assert names == {"Lentil curry"} and out["excluded_for_diet"] >= 1


def test_nobody_else_can_plan_with_my_recipes(a, b):
    mine = stock(a, "Private", protein_g=9, fiber_g=8)[0]
    assert gen(b)["placed"] == 0
    assert b.post(f"{N}/plan/bulk", json={"items": [{"date": start_day(), "meal_type": "lunch", "recipe_id": mine["id"], "quantity": 1, "unit": "serving"}]}).status_code == 404
    assert entries(b, start_day()) == [] and entries(a, start_day()) == []


# ---------------------------------------------------------------- Delivery 3: swapping one ingredient of a recipe
def test_swapping_an_ingredient_shows_the_effect_on_the_whole_recipe(a):
    cracker = a.post(f"{N}/foods", json={"name": "Salted cracker", "nutrients": {"energy_kcal": 430, "sodium_mg": 1100, "protein_g": 9}}).json()
    a.post(f"{N}/foods", json={"name": "Plain cracker", "nutrients": {"energy_kcal": 420, "sodium_mg": 300, "protein_g": 9}})
    a.post(f"{N}/foods", json={"name": "Saltier cracker", "nutrients": {"energy_kcal": 430, "sodium_mg": 1500}})
    a.post(f"{N}/foods", json={"name": "No sodium data", "nutrients": {"energy_kcal": 430, "protein_g": 9}})
    butter = a.post(f"{N}/foods", json={"name": "Butter", "nutrients": {"energy_kcal": 717, "sodium_mg": 11}}).json()
    ings = [{"name": "Crackers", "quantity": 100, "unit": "g", "food_id": cracker["id"]}, {"name": "Butter", "quantity": 20, "unit": "g", "food_id": butter["id"]}]
    r = a.post(f"{N}/recipe-alternatives", json={"servings": 2, "ingredients": ings, "index": 0, "nutrient": "sodium_mg"}).json()
    assert r["direction"] == "lower" and [x["name"] for x in r["alternatives"]] == ["Plain cracker"]      # saltier and no-data foods are not alternatives
    alt = r["alternatives"][0]
    before = (1100 + 11 * 0.2) / 2                                                                         # 100 g crackers + 20 g butter, per serving of two
    after = (300 + 11 * 0.2) / 2
    assert alt["recipe_per_serving"]["before"] == pytest.approx(before) and alt["recipe_per_serving"]["after"] == pytest.approx(after)
    assert alt["recipe_per_serving"]["change_pct"] == pytest.approx((after - before) / before * 100, abs=0.01)
    assert alt["energy_per_serving"]["after"] == pytest.approx(alt["energy_per_serving"]["before"] - (430 - 420) / 2)
    assert alt["grams"] == 100 and r["grams"] == 100                                                       # the same weight of the replacement


def test_alternatives_need_a_linked_ingredient_and_valid_input(a, b):
    f = a.post(f"{N}/foods", json={"name": "Thing", "nutrients": {"energy_kcal": 100, "sodium_mg": 500}}).json()
    ings = [{"name": "Thing", "quantity": 100, "unit": "g", "food_id": f["id"]}, {"name": "Mystery", "quantity": 1, "unit": "unit"}]
    body = {"servings": 1, "ingredients": ings}
    assert a.post(f"{N}/recipe-alternatives", json={**body, "index": 1, "nutrient": "sodium_mg"}).status_code == 422      # not linked to a food
    assert a.post(f"{N}/recipe-alternatives", json={**body, "index": 7, "nutrient": "sodium_mg"}).status_code == 422      # no such ingredient
    assert a.post(f"{N}/recipe-alternatives", json={**body, "index": 0, "nutrient": "unobtainium"}).status_code == 404
    assert a.post(f"{N}/recipe-alternatives", json={**body, "index": -1, "nutrient": "sodium_mg"}).status_code == 422
    assert a.post(f"{N}/recipe-alternatives", json={**body, "index": 0, "nutrient": "fiber_g"}).json()["alternatives"] == []  # the food has no fibre value: said, not guessed
    assert b.post(f"{N}/recipe-alternatives", json={**body, "index": 0, "nutrient": "sodium_mg"}).status_code == 422        # someone else's food is not visible
