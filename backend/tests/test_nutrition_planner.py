"""Meal-plan generation: pure functions. A plan is built only from things the person already has (recipes, foods), never fabricated,
spread across days without repeating beyond a limit, and aimed at the nutrients asked for."""
import sys
from collections import Counter
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import nutrition_planner as pl  # noqa: E402
import nutrition_suggest as sg  # noqa: E402

DAYS = [f"2026-11-0{i}" for i in range(2, 9)]   # a week


def base(focus=None, energy=2000.0):
    prog = {
        "protein_g": {"intake": 0.0, "min": None, "target": 60.0, "max": None, "status": "no_data", "unit": "g", "kind": "PRI"},
        "fiber_g": {"intake": 0.0, "min": None, "target": 25.0, "max": None, "status": "no_data", "unit": "g", "kind": "AI"},
        "sodium_mg": {"intake": 0.0, "min": None, "target": None, "max": 2000.0, "status": "no_data", "unit": "mg", "kind": "limit"},
    }
    return sg.build_context(prog, energy, 0.0, "other", focus)


def cand(name, kcal, id_=None, usual=None, **n):
    return {"kind": "recipe", "id": id_ or name, "name": name, "nutrients": {"energy_kcal": kcal, **n}, "portion": {"quantity": 1, "unit": "serving"},
            "quality": "user", "usual_meals": usual or [], "flags": []}


POOL = [cand(f"Dish {i}", 450 + 10 * i, protein_g=20 + i, fiber_g=6 + i) for i in range(8)]


def test_every_open_slot_gets_one_item_and_a_day_stays_near_its_energy():
    out = pl.plan_days(DAYS, POOL, base(), ["breakfast", "lunch", "dinner"], max_repeats=3)
    assert len(out["days"]) == 7
    for d in out["days"]:
        assert [i["meal_type"] for i in d["items"]] == ["breakfast", "lunch", "dinner"] and d["unfilled"] == []
        assert sum(i["nutrients"]["energy_kcal"] for i in d["items"]) <= 2000 * 1.25
        assert len({i["id"] for i in d["items"]}) == 3                              # nothing twice in one day


def test_nothing_is_used_more_often_than_allowed():
    out = pl.plan_days(DAYS, POOL, base(), ["breakfast", "lunch", "dinner"], max_repeats=2)
    uses = Counter(i["id"] for d in out["days"] for i in d["items"])
    assert uses and max(uses.values()) <= 2


def test_a_small_pool_leaves_slots_open_and_says_so_instead_of_inventing_things():
    pool = POOL[:3]
    out = pl.plan_days(DAYS, pool, base(), ["breakfast", "lunch", "dinner"], max_repeats=2)
    placed = [i for d in out["days"] for i in d["items"]]
    assert len(placed) <= 3 * 2 and {i["id"] for i in placed} <= {c["id"] for c in pool}   # only what exists, at most twice each
    assert any(d["unfilled"] for d in out["days"])
    assert any("not enough" in n.lower() for n in out["notes"])


def test_the_chosen_focus_steers_the_plan():
    fibre = [cand(f"Beans {i}", 480, protein_g=15, fiber_g=14) for i in range(4)]
    protein = [cand(f"Chicken {i}", 480, protein_g=40, fiber_g=2) for i in range(4)]
    pool = fibre + protein
    def total(out, key):
        return sum(i["nutrients"].get(key, 0) for d in out["days"] for i in d["items"])
    f = pl.plan_days(DAYS[:3], pool, base(focus=["fiber_g"]), ["lunch", "dinner"], max_repeats=3)
    p = pl.plan_days(DAYS[:3], pool, base(focus=["protein_g"]), ["lunch", "dinner"], max_repeats=3)
    assert total(f, "fiber_g") > total(p, "fiber_g") and total(p, "protein_g") > total(f, "protein_g")


def test_foods_are_placed_at_the_meals_they_are_usually_eaten_at():
    pool = [cand("Porridge", 400, usual=["breakfast"], protein_g=15, fiber_g=8), cand("Stew", 400, usual=["dinner"], protein_g=15, fiber_g=8)]
    out = pl.plan_days(DAYS[:1], pool, base(), ["breakfast", "dinner"], max_repeats=1)
    by = {i["meal_type"]: i["name"] for i in out["days"][0]["items"]}
    assert by == {"breakfast": "Porridge", "dinner": "Stew"}


def test_the_plan_is_the_same_whatever_order_the_candidates_arrive_in():
    a = pl.plan_days(DAYS, POOL, base(), ["breakfast", "lunch", "dinner"])
    b = pl.plan_days(DAYS, list(reversed(POOL)), base(), ["breakfast", "lunch", "dinner"])
    assert a == b


def test_slots_that_already_have_a_plan_are_left_alone():
    out = pl.plan_days(DAYS[:2], POOL, base(), ["breakfast", "lunch", "dinner"], occupied={(DAYS[0], "lunch")})
    assert [i["meal_type"] for i in out["days"][0]["items"]] == ["breakfast", "dinner"] and out["days"][0]["skipped"] == ["lunch"]
    assert [i["meal_type"] for i in out["days"][1]["items"]] == ["breakfast", "lunch", "dinner"]


def test_a_candidate_with_no_energy_value_or_too_large_a_portion_is_never_placed():
    pool = [cand("No energy", None, protein_g=30), cand("Enormous", 2500, protein_g=90), cand("Fine", 450, protein_g=25, fiber_g=8)]
    out = pl.plan_days(DAYS[:1], pool, base(), ["lunch"], max_repeats=1)
    assert [i["name"] for i in out["days"][0]["items"]] == ["Fine"]


def test_the_digest_changes_only_when_the_plan_does():
    a = pl.plan_days(DAYS, POOL, base(), ["breakfast", "lunch", "dinner"])
    b = pl.plan_days(DAYS, POOL, base(), ["breakfast", "lunch", "dinner"])
    c = pl.plan_days(DAYS, POOL[:5], base(), ["breakfast", "lunch", "dinner"])
    assert pl.digest(a) == pl.digest(b) and pl.digest(a) != pl.digest(c)


def test_a_week_that_cannot_be_planned_says_why():
    fibreless = [cand(f"Chicken {i}", 480, protein_g=35) for i in range(5)]
    out = pl.plan_days(DAYS, fibreless, base(focus=["fiber_g"]), ["lunch", "dinner"])
    assert all(not d["items"] for d in out["days"])
    assert "report no fibre value" in " ".join(out["notes"])                        # not just "save more recipes"
