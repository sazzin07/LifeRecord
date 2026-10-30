"""Nutrient density, variety and meal patterns: pure functions. The numbers are derived from what was logged and the person's own references;
gaps in the data are shown as gaps (low coverage, unclassified entries), never filled in."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import nutrition_insights as ni  # noqa: E402

REF = {
    "protein_g": {"target": 60.0, "unit": "g"}, "fiber_g": {"target": 25.0, "unit": "g"}, "calcium_mg": {"target": 950.0, "unit": "mg"},
    "iron_mg": {"target": 11.0, "unit": "mg"}, "sodium_mg": {"max": 2000.0, "unit": "mg"},
}


def entry(date, meal, name, kcal, time=None, food_id=None, recipe_id=None, groups=None, **n):
    return {"date": date, "meal_type": meal, "eaten_at": time, "name": name, "food_id": food_id, "recipe_id": recipe_id, "groups": groups or [],
            "nutrients": {"energy_kcal": kcal, **n}}


# ---------------------------------------------------------------- nutrient density
def test_density_compares_what_each_calorie_brought_with_what_the_reference_asks_per_calorie():
    entries = [entry("2026-10-01", "lunch", "Beans", 400, fiber_g=20, protein_g=30), entry("2026-10-01", "dinner", "Rice", 600, fiber_g=5, protein_g=15)]
    rows = {r["nutrient"]: r for r in ni.nutrient_density(entries, REF, 2000.0)}
    # fibre: 25 g over 1,000 kcal = 25 per 1,000; the reference asks 25 g per 2,000 kcal = 12.5 per 1,000
    assert rows["fiber_g"]["per_1000_kcal"] == pytest.approx(25.0) and rows["fiber_g"]["reference_per_1000_kcal"] == pytest.approx(12.5)
    assert rows["fiber_g"]["ratio"] == pytest.approx(2.0) and rows["fiber_g"]["coverage"] == pytest.approx(1.0) and rows["fiber_g"]["reliable"]
    assert rows["protein_g"]["ratio"] == pytest.approx(1.5)
    assert "sodium_mg" not in rows                                   # a limit is not a target to be "dense" in


def test_a_nutrient_missing_from_most_entries_is_flagged_unreliable_not_treated_as_low():
    entries = [entry("2026-10-01", "lunch", "Beans", 200, calcium_mg=100), entry("2026-10-01", "dinner", "Mystery", 800)]   # calcium known for 20% of the energy
    row = next(r for r in ni.nutrient_density(entries, REF, 2000.0) if r["nutrient"] == "calcium_mg")
    assert row["coverage"] == pytest.approx(0.2) and row["reliable"] is False
    assert row["per_1000_kcal"] == pytest.approx(500.0)             # computed only over the entries that reported it, so the gap does not drag it down
    assert all(r["nutrient"] != "iron_mg" for r in ni.nutrient_density(entries, REF, 2000.0))   # nothing reported it at all: no row


def test_dense_foods_need_enough_data_and_real_energy():
    keys = {"protein_g": 20, "fiber_g": 12, "calcium_mg": 200, "iron_mg": 4, "magnesium_mg": 120, "potassium_mg": 900}
    ref = {**REF, "magnesium_mg": {"target": 300.0, "unit": "mg"}, "potassium_mg": {"target": 3500.0, "unit": "mg"}}
    entries = [entry("2026-10-01", "lunch", "Lentil stew", 350, **keys), entry("2026-10-01", "lunch", "Crisps", 500, protein_g=6),
               entry("2026-10-01", "snack", "Black tea", 2, calcium_mg=1, protein_g=0.1), entry("2026-10-02", "lunch", "Lentil stew", 350, **keys)]
    out = ni.dense_foods(entries, ref, 2000.0)
    assert [f["name"] for f in out] == ["Lentil stew"]                # crisps report too little to judge; tea has almost no energy
    assert out[0]["times"] == 2 and out[0]["nutrients_used"] == 6 and out[0]["index"] > 1.0


# ---------------------------------------------------------------- variety
def test_variety_counts_distinct_foods_and_names_the_groups_that_never_appeared():
    entries = [entry("2026-10-01", "lunch", "Oats", 300, food_id="a", groups=["Grains and cereals"]), entry("2026-10-02", "lunch", "Oats", 300, food_id="a", groups=["Grains and cereals"]),
               entry("2026-10-02", "dinner", "Salmon", 400, food_id="b", groups=["Fish and seafood"]), entry("2026-10-03", "dinner", "Stew", 500, recipe_id="r1", groups=["Vegetables", "Legumes"]),
               entry("2026-10-03", "snack", "Typed snack", 150)]
    v = ni.variety(entries, [], days_logged=3)
    assert v["distinct_items"] == 4 and v["per_logged_day"] == pytest.approx(4 / 3, abs=0.01)
    assert v["top"][0] == {"name": "Oats", "count": 2, "share": pytest.approx(0.4)}
    assert set(v["groups_seen"]) == {"Grains and cereals", "Fish and seafood", "Vegetables", "Legumes"}
    assert "Fruits" in v["groups_missing"] and "Dairy and eggs" in v["groups_missing"] and "Vegetables" not in v["groups_missing"]
    assert v["unclassified"] == 1 and v["classified_share"] == pytest.approx(0.8)             # the typed snack could not be classified, and that is said


def test_a_vegan_diet_does_not_flag_animal_groups_as_missing():
    v = ni.variety([entry("2026-10-01", "lunch", "Oats", 300, food_id="a", groups=["Grains and cereals"])], ["vegan"], days_logged=1)
    assert not {"Dairy and eggs", "Fish and seafood", "Meat and poultry"} & set(v["groups_missing"]) and "Fruits" in v["groups_missing"]
    veg = ni.variety([entry("2026-10-01", "lunch", "Oats", 300, food_id="a", groups=["Grains and cereals"])], ["vegetarian"], days_logged=1)
    assert "Dairy and eggs" in veg["groups_missing"] and "Meat and poultry" not in veg["groups_missing"]


def test_usda_categories_map_to_a_small_set_of_everyday_groups():
    assert ni.groups_for_category("Vegetables and Vegetable Products") == ["Vegetables"]
    assert ni.groups_for_category("Poultry Products") == ["Meat and poultry"] and ni.groups_for_category("Finfish and Shellfish Products") == ["Fish and seafood"]
    assert ni.groups_for_category("Baby Foods") == [] and ni.groups_for_category(None) == []   # not guessed


# ---------------------------------------------------------------- meal patterns
def test_patterns_show_where_the_energy_goes_when_meals_happen_and_how_steadily_it_is_logged():
    entries = [entry("2026-10-05", "breakfast", "Oats", 300, time="08:00"), entry("2026-10-05", "dinner", "Stew", 700, time="20:30"),
               entry("2026-10-06", "dinner", "Fish", 500, time="19:30"), entry("2026-10-07", "breakfast", "Toast", 200, time="09:00"),
               entry("2026-10-10", "dinner", "Pizza", 900, time="21:00")]
    dates = [f"2026-10-{d:02d}" for d in range(5, 12)]            # Mon 5 .. Sun 11
    p = ni.patterns(entries, dates)
    assert p["days_logged"] == 4 and p["days_in_range"] == 7 and p["logged_share"] == pytest.approx(4 / 7, abs=0.001)
    assert p["meal_share"]["dinner"] == pytest.approx(2100 / 2600, abs=0.001) and p["meal_share"]["breakfast"] == pytest.approx(500 / 2600, abs=0.001)
    assert p["meal_days"]["breakfast"] == 2 and p["meal_days"]["dinner"] == 3 and p["meal_days"]["lunch"] == 0
    assert p["typical_time"]["dinner"] == "20:30" and p["typical_time"]["breakfast"] in ("08:00", "08:30", "09:00") and "lunch" not in p["typical_time"]
    assert p["longest_streak"] == 3 and p["current_streak"] == 1 and p["last_logged"] == "2026-10-10"
    assert p["weekday_avg_kcal"] == pytest.approx((1000 + 500 + 200) / 3) and p["weekend_avg_kcal"] == pytest.approx(900)


def test_the_current_streak_counts_back_from_the_last_day_or_the_day_before():
    dates = [f"2026-10-{d:02d}" for d in range(1, 8)]
    e = [entry(f"2026-10-0{d}", "lunch", "x", 400) for d in (4, 5, 6)]
    assert ni.patterns(e, dates)["current_streak"] == 3                         # up to yesterday: today may simply not have been logged yet
    e2 = e + [entry("2026-10-07", "lunch", "x", 400)]
    assert ni.patterns(e2, dates)["current_streak"] == 4
    assert ni.patterns([], dates)["days_logged"] == 0 and ni.patterns([], dates)["meal_share"] == {}


def test_weekend_comparison_needs_data_on_both_sides():
    dates = [f"2026-10-{d:02d}" for d in range(5, 12)]
    p = ni.patterns([entry("2026-10-05", "lunch", "x", 400), entry("2026-10-06", "lunch", "x", 600)], dates)
    assert p["weekend_avg_kcal"] is None and p["weekday_avg_kcal"] == pytest.approx(500)


def test_an_unchosen_meal_is_not_reported_as_a_meal_pattern():
    import nutrition_insights_api as api
    p = ni.patterns([entry(f"2026-10-0{d}", "other", "Typed", 500) for d in range(1, 6)], [f"2026-10-0{d}" for d in range(1, 8)])
    v = ni.variety([entry(f"2026-10-0{d}", "other", "Typed", 500) for d in range(1, 6)], [], p["days_logged"])
    ids = [i["id"] for i in api.build_insights(p, v, [], [])]
    assert "pattern-meal" not in ids and "variety-unclassified" in ids          # "other provides 100%" says nothing; the unsorted entries are what matters
