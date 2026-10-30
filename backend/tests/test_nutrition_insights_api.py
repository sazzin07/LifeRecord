"""Patterns, variety, density and long trends over HTTP with a throwaway account that has a few weeks of diary."""
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


@pytest.fixture(scope="module")
def a():
    return _user()


@pytest.fixture(scope="module")
def b():
    return _user()


def find(s, q, starts):
    res = s.get(f"{N}/foods/search", params={"q": q, "limit": 30}).json()
    return next(f for f in res if f["name"].lower().startswith(starts))


@pytest.fixture(scope="module")
def diary(a):
    """Ten days: lentils, spinach and salmon, with meal times, and a typed snack every second day. No fruit, no dairy."""
    today = date.fromisoformat(a.get(f"{N}/day").json()["today"])
    foods = {"lentils": find(a, "lentils cooked", "lentils, mature seeds, cooked, boiled"), "spinach": find(a, "spinach raw", "spinach, raw"),
             "salmon": find(a, "salmon atlantic farmed cooked", "fish, salmon, atlantic, farmed, cooked")}
    for i in range(1, 11):
        d = (today - timedelta(days=i)).isoformat()
        for meal, key, grams, t in (("lunch", "lentils", 250, "13:00"), ("dinner", "salmon", 150, "20:30"), ("dinner", "spinach", 120, "20:30")):
            assert a.post(f"{N}/diary", json={"date": d, "meal_type": meal, "food_id": foods[key]["id"], "quantity": grams, "unit": "g", "eaten_at": t}).status_code == 200
        if i % 2 == 0:
            assert a.post(f"{N}/diary", json={"date": d, "meal_type": "snack", "description": "Typed snack", "calories": 150}).status_code == 200
    return today


def test_patterns_describe_what_was_logged_and_say_what_they_cannot_judge(a, diary):
    r = a.get(f"{N}/patterns", params={"days": 14}).json()
    p, v = r["patterns"], r["variety"]
    assert p["days_logged"] == 10 and p["days_in_range"] == 14 and p["longest_streak"] == 10 and p["current_streak"] == 10   # counted back from yesterday
    assert p["meal_share"]["dinner"] > p["meal_share"]["lunch"] and p["typical_time"]["dinner"] == "20:30" and p["typical_time"]["lunch"] == "13:00"
    assert p["meal_days"] == {"breakfast": 0, "lunch": 10, "dinner": 10, "snack": 5}
    assert v["distinct_items"] == 4 and {"Legumes", "Vegetables", "Fish and seafood"} <= set(v["groups_seen"])
    assert {"Fruits", "Dairy and eggs", "Nuts and seeds"} <= set(v["groups_missing"])
    assert v["unclassified"] == 5 and v["classified_share"] == pytest.approx(30 / 35, abs=0.01)             # the typed snacks could not be classified, and that is said
    ids = {i["id"]: i for i in r["insights"]}
    assert "variety-missing" in ids and "could not be sorted into groups" in ids["variety-missing"]["why"] and "fruits" in ids["variety-missing"]["title"].lower()
    assert all(i["why"] for i in r["insights"]) and r["basis"]


def test_density_uses_the_reference_per_calorie_and_flags_what_is_not_reported_enough(a, diary):
    r = a.get(f"{N}/patterns", params={"days": 14}).json()
    rows = {d["nutrient"]: d for d in r["density"]}
    assert rows["fiber_g"]["ratio"] > 1.0 and rows["fiber_g"]["reliable"]                                  # lentils and spinach are fibre-rich per calorie
    assert all(d["coverage"] > 0 for d in r["density"]) and all(d["per_1000_kcal"] > 0 for d in r["density"])
    targets = a.get(f"{N}/targets").json()["items"]
    assert rows["protein_g"]["reference_per_1000_kcal"] == pytest.approx(targets["protein_g"]["target"] / targets["energy_kcal"]["target"] * 1000, rel=0.001)
    assert r["dense_foods"] and all(f["nutrients_used"] >= 5 and f["index"] > 0 for f in r["dense_foods"])
    assert all(f["name"] != "Typed snack" for f in r["dense_foods"])                                        # typed numbers cannot be judged for density


def test_a_nearly_empty_period_gets_one_honest_card_instead_of_conclusions(b):
    r = b.get(f"{N}/patterns", params={"days": 14}).json()
    assert r["patterns"]["days_logged"] == 0 and r["density"] == [] and [i["id"] for i in r["insights"]] == ["few-days"]


def test_weekly_and_monthly_buckets_average_only_logged_days(a, diary):
    wk = a.get(f"{N}/trends", params={"days": 60, "bucket": "week"}).json()
    assert wk["bucket"] == "week" and 8 <= len(wk["series"]) <= 10 and all(date.fromisoformat(x["date"]).weekday() == 0 for x in wk["series"])
    logged = [x for x in wk["series"] if x["logged"]]
    assert sum(x["days_logged"] for x in wk["series"]) == 10 and all(x["energy_kcal"] > 0 for x in logged)
    assert all(x["energy_kcal"] is None for x in wk["series"] if not x["logged"])                           # a week with nothing logged is empty, not zero
    mo = a.get(f"{N}/trends", params={"days": 90, "bucket": "month"}).json()
    assert all(date.fromisoformat(x["date"]).day == 1 for x in mo["series"]) and sum(x["days_logged"] for x in mo["series"]) == 10
    daily = a.get(f"{N}/trends", params={"days": 14}).json()
    assert daily["bucket"] == "day" and len(daily["series"]) == 14
    assert a.get(f"{N}/trends", params={"days": 14, "bucket": "year"}).status_code == 422


def test_inputs_are_validated_and_accounts_are_separate(a, b, diary):
    for params in ({"days": 3}, {"days": 400}, {"end": "2026-13-45"}, {"end": "garbage"}):
        assert a.get(f"{N}/patterns", params=params).status_code == 422, params
    other = b.get(f"{N}/patterns", params={"days": 30}).json()
    assert other["patterns"]["days_logged"] == 0 and other["variety"]["distinct_items"] == 0
