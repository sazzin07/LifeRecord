"""The "what could I eat?" scoring: pure functions, no server or database. Every rule is also what the person is told in `why`."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import nutrition_suggest as sg  # noqa: E402


def progress(**kw):
    """A day's progress rows the way nutrition_calc.progress gives them."""
    base = {
        "protein_g": {"intake": 20.0, "min": None, "target": 60.0, "max": None, "status": "below", "unit": "g", "kind": "PRI"},
        "fiber_g": {"intake": 6.0, "min": None, "target": 25.0, "max": None, "status": "below", "unit": "g", "kind": "AI"},
        "sodium_mg": {"intake": 1200.0, "min": None, "target": None, "max": 2000.0, "status": "under", "unit": "mg", "kind": "limit"},
        "sat_fat_g": {"intake": 8.0, "min": None, "target": None, "max": 22.0, "status": "under", "unit": "g", "kind": "limit"},
        "calcium_mg": {"intake": 300.0, "min": None, "target": 950.0, "max": None, "status": "below", "unit": "mg", "kind": "PRI"},
    }
    base.update(kw)
    return base


def cand(name, kcal, id_=None, **nutrients):
    return {"kind": "recipe", "id": id_ or name, "name": name, "nutrients": {"energy_kcal": kcal, **nutrients},
            "portion": {"quantity": 1, "unit": "serving"}, "quality": "user", "pantry": None, "eaten_days_ago": None, "flags": []}


def context(**kw):
    c = sg.build_context(progress(), energy_target=2000.0, eaten_kcal=1000.0, meal_type="dinner", focus=None)
    c.update(kw)
    return c


# ---------------------------------------------------------------- context
def test_energy_budget_is_the_meal_share_but_never_more_than_what_is_left():
    ctx = sg.build_context(progress(), energy_target=2000.0, eaten_kcal=1000.0, meal_type="dinner", focus=None)
    assert ctx["remaining_kcal"] == 1000.0 and ctx["budget_kcal"] == 600.0       # 30% of 2000
    late = sg.build_context(progress(), energy_target=2000.0, eaten_kcal=1700.0, meal_type="lunch", focus=None)
    assert late["budget_kcal"] == 300.0                                          # only 300 left, though lunch "is" 700
    full = sg.build_context(progress(), energy_target=2000.0, eaten_kcal=2100.0, meal_type="snack", focus=None)
    assert full["remaining_kcal"] == 0 and full["budget_kcal"] == 0


def test_remaining_amounts_for_needs_and_headroom_for_limits():
    ctx = context()
    assert ctx["remaining"]["protein_g"] == pytest.approx(40.0) and ctx["remaining"]["fiber_g"] == pytest.approx(19.0)
    assert ctx["headroom"]["sodium_mg"] == pytest.approx(800.0) and "protein_g" not in ctx["headroom"]
    over = sg.build_context(progress(sodium_mg={"intake": 2600.0, "min": None, "target": None, "max": 2000.0, "status": "over", "unit": "mg", "kind": "limit"}),
                            energy_target=2000.0, eaten_kcal=500.0, meal_type="dinner", focus=None)
    assert over["headroom"]["sodium_mg"] == pytest.approx(-600.0)               # already over: negative room, never hidden


def test_automatic_focus_is_protein_and_fibre_plus_the_gaps_the_data_shows():
    ctx = context()
    assert ctx["focus"][:2] == ["protein_g", "fiber_g"] and "calcium_mg" in ctx["focus"]
    nodata = sg.build_context(progress(calcium_mg={"intake": None, "min": None, "target": 950.0, "max": None, "status": "no_data", "unit": "mg", "kind": "PRI"}),
                              energy_target=2000.0, eaten_kcal=500.0, meal_type="dinner", focus=None)
    assert "calcium_mg" not in nodata["focus"]                                    # no data is not a gap
    chosen = sg.build_context(progress(), energy_target=2000.0, eaten_kcal=500.0, meal_type="dinner", focus=["calcium_mg", "not_a_nutrient", "sodium_mg"])
    assert chosen["focus"] == ["calcium_mg"]                                      # the person's choice wins; unknown keys and limits are dropped


# ---------------------------------------------------------------- scoring
def test_a_dish_that_covers_what_is_left_beats_one_that_does_not():
    ctx = context()
    rich = sg.score(cand("Lentil stew", 520, protein_g=30, fiber_g=14), ctx)
    poor = sg.score(cand("White rice", 520, protein_g=4, fiber_g=1), ctx)
    assert rich["score"] > poor["score"] > 0
    assert [c["nutrient"] for c in rich["covers"]][:2] == ["protein_g", "fiber_g"]
    assert rich["covers"][0]["percent_of_remaining"] == pytest.approx(75.0)       # 30 of the 40 g still needed


def test_nothing_is_credited_for_a_nutrient_the_food_does_not_report():
    ctx = context()
    s = sg.score(cand("Mystery bar", 500, protein_g=20), ctx)                     # no fibre data at all
    assert all(c["nutrient"] != "fiber_g" for c in s["covers"])
    assert "fiber_g" in s["unknown"]                                              # and it says so


def test_too_big_for_the_meal_is_not_suggested_and_small_is_ranked_lower():
    ctx = context()                                                               # 600 kcal budget
    assert sg.score(cand("Huge", 900, protein_g=60), ctx) is None
    ok = sg.score(cand("Right size", 480, protein_g=30), ctx)
    tiny = sg.score(cand("Tiny", 90, protein_g=30), ctx)
    assert ok["score"] > tiny["score"]
    assert sg.score(cand("No energy data", None, protein_g=30), ctx) is None      # its fit cannot be judged
    assert sg.score(cand("Anything", 100, protein_g=5), context(budget_kcal=0, remaining_kcal=0)) is None


def test_limits_are_watched_not_hidden():
    ctx = context()
    salty = sg.score(cand("Salty ham", 450, protein_g=35, sodium_mg=1900), ctx)   # only 800 mg of room
    fine = sg.score(cand("Fresh chicken", 450, protein_g=35, sodium_mg=150), ctx)
    assert fine["score"] > salty["score"]
    assert salty["watch"][0]["nutrient"] == "sodium_mg" and salty["watch"][0]["headroom"] == pytest.approx(800.0)
    assert fine["watch"] == []
    already_over = context(headroom={"sodium_mg": -600.0})
    assert sg.score(cand("Any", 400, protein_g=30, sodium_mg=300), already_over)["watch"][0]["headroom"] == pytest.approx(-600.0)


def test_pantry_and_expiry_help_and_missing_ingredients_cost_a_little():
    ctx = context()
    base = cand("Chilli", 500, protein_g=30, fiber_g=10)
    stocked = {**base, "pantry": {"can_cook_now": True, "missing": [], "uses_expiring": [{"name": "Milk", "expires_in": 2}]}}
    short = {**base, "pantry": {"can_cook_now": False, "missing": ["Beans", "Tomatoes"], "uses_expiring": []}}
    a, b, c = sg.score(stocked, ctx), sg.score(base, ctx), sg.score(short, ctx)
    assert a["score"] > b["score"] > c["score"]
    assert "Milk" in sg.explain(stocked, a, ctx)
    assert "Beans" in sg.explain(short, c, ctx)


def test_foods_eaten_today_or_lately_rank_lower():
    ctx = context()
    new = sg.score(cand("New dish", 500, protein_g=30), ctx)
    today = sg.score({**cand("Same again", 500, protein_g=30), "eaten_days_ago": 0}, ctx)
    lately = sg.score({**cand("Last week", 500, protein_g=30), "eaten_days_ago": 2}, ctx)
    old = sg.score({**cand("Months ago", 500, protein_g=30), "eaten_days_ago": 30}, ctx)
    assert new["score"] > lately["score"] > today["score"]
    assert old["score"] == pytest.approx(new["score"])


def test_a_candidate_that_helps_with_nothing_is_not_suggested():
    ctx = context()
    assert sg.score(cand("Soda", 150), ctx) is None
    assert sg.score(cand("Only salt", 150, sodium_mg=800), ctx) is None


def test_ranking_is_stable_unique_and_limited():
    ctx = context()
    items = [cand(f"Dish {i}", 480, id_=f"id{i % 4}", protein_g=20 + i, fiber_g=5) for i in range(8)]   # repeated ids
    out = sg.rank(items, ctx, limit=3)
    assert len(out) == 3 and len({o["id"] for o in out}) == 3
    assert out == sg.rank(list(reversed(items)), ctx, limit=3)                    # input order does not matter
    assert [o["score"] for o in out] == sorted((o["score"] for o in out), reverse=True)


def test_the_explanation_only_states_facts_from_the_numbers():
    ctx = context()
    c = cand("Lentil stew", 520, protein_g=30, fiber_g=14, sodium_mg=1900)
    text = sg.explain(c, sg.score(c, ctx), ctx)
    assert "75%" in text and "protein" in text.lower()                            # 30 of 40 g
    assert "520 kcal" in text and "600" in text                                   # the budget it fits
    assert "sodium" in text.lower() and "800" in text                             # the room it takes up
    incomplete = {**c, "quality": "estimated", "flags": ["some ingredients have no nutrient data"]}
    assert "no nutrient data" in sg.explain(incomplete, sg.score(incomplete, ctx), ctx)


def test_when_little_can_be_suggested_the_reason_is_given_in_terms_of_the_persons_own_data():
    ctx = context(focus=["fiber_g"])
    pool = [cand("No fibre recipe", 480, protein_g=30), cand("Another", 450, protein_g=25), cand("Huge", 1500, fiber_g=40), cand("No energy", None, fiber_g=9)]
    why = sg.diagnose(pool, ctx)
    assert len(why) == 1 and "2 of your 4 saved recipes and foods report no fibre value" in why[0] and "1 are larger than a meal" in why[0] and "1 have no energy value" in why[0]
    assert sg.diagnose([], ctx) == []
    assert sg.diagnose([cand("Fine", 480, fiber_g=9)], ctx) == []              # nothing wrong with the data: no explanation is invented
