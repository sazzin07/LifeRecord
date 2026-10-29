"""Reference values (EFSA/WHO) and nutrition arithmetic. Pure functions: no server or database needed.
Expected numbers below were read from the EFSA 2017 summary report tables (see nutrition_data.py), not derived from the code."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import nutrition_calc as calc  # noqa: E402
from nutrition_data import BY_KEY, MICRO_ADULT, NUTRIENTS, reference_for  # noqa: E402


def ref(**profile):
    weight = profile.pop("weight", None)
    return reference_for(profile, weight)


def target(r, key):
    return r["items"][key]["target"]


# ---------------------------------------------------------------- registry
def test_registry_is_consistent():
    keys = [n["key"] for n in NUTRIENTS]
    assert len(keys) == len(set(keys))
    assert all(n["unit"] and n["about"] and n["group"] for n in NUTRIENTS)
    assert all(n["usda"] for n in NUTRIENTS if n["key"] != "biotin_ug")  # biotin is honestly unavailable
    assert set(MICRO_ADULT) <= set(BY_KEY)


# ---------------------------------------------------------------- reference values
def test_energy_follows_the_efsa_table_and_pal():
    # EFSA Table 1: women 30-39 at PAL 1.6 need 8.7 MJ; 1 MJ = 238.83 kcal
    assert target(ref(age=35, sex="F", activity="moderate"), "energy_kcal") == 2080
    # men 18-29 at PAL 1.4: 9.8 MJ
    assert target(ref(age=25, sex="M", activity="sedentary"), "energy_kcal") == 2340
    # men 70-79 at PAL 2.0: 11.9 MJ
    assert target(ref(age=72, sex="M", activity="very_active"), "energy_kcal") == 2840


def test_missing_activity_is_assumed_and_said_so():
    r = ref(age=35, sex="F")
    assert target(r, "energy_kcal") == 2080 and any("Activity level not set" in n for n in r["notes"])


def test_pregnancy_adds_the_efsa_allowances():
    base = target(ref(age=30, sex="F", activity="moderate"), "energy_kcal")
    t3 = ref(age=30, sex="F", activity="moderate", pregnancy="pregnant_t3", weight=65)
    assert target(t3, "energy_kcal") == round((8.7 + 2.1) * 238.83 / 10) * 10 and target(t3, "energy_kcal") > base
    assert target(t3, "protein_g") == round(0.83 * 65 + 28)  # PRI + 28 g in the third trimester
    assert target(t3, "folate_ug") == 600 and target(t3, "iodine_ug") == 200
    lact = ref(age=30, sex="F", pregnancy="lactating_0_6", weight=65)
    assert target(lact, "potassium_mg") == 4000 and target(lact, "vit_a_ug") == 1300 and target(lact, "vit_c_mg") == 155


def test_protein_uses_body_weight_or_falls_back_with_a_note():
    assert target(ref(age=40, sex="M", weight=80), "protein_g") == round(0.83 * 80)
    r = ref(age=40, sex="M")
    assert target(r, "protein_g") == 50 and r["items"]["protein_g"]["source"] == "eu1169"
    assert any("weight" in n.lower() for n in r["notes"])


def test_macro_ranges_scale_with_energy():
    r = ref()  # no profile: 2000 kcal
    assert target(r, "energy_kcal") == 2000 and not r["personalised"] and r["basis"] == "eu1169"
    assert (r["items"]["carbs_available_g"]["min"], r["items"]["carbs_available_g"]["max"]) == (225, 300)
    assert (r["items"]["fat_g"]["min"], r["items"]["fat_g"]["max"]) == (44, 78)
    assert r["items"]["sat_fat_g"]["max"] == 22  # WHO: under 10% of energy
    assert r["items"]["fiber_g"]["target"] == 25
    assert r["items"]["epa_dha_mg"]["target"] == 250


def test_micronutrients_follow_sex_and_age():
    w, m = ref(age=35, sex="F"), ref(age=35, sex="M")
    assert (target(w, "vit_c_mg"), target(m, "vit_c_mg")) == (95, 110)
    assert (target(w, "vit_a_ug"), target(m, "vit_a_ug")) == (650, 750)
    assert (target(w, "magnesium_mg"), target(m, "magnesium_mg")) == (300, 350)
    assert (target(w, "iron_mg"), target(m, "iron_mg")) == (16, 11)
    assert target(ref(age=55, sex="F"), "iron_mg") == 11
    assert target(ref(age=22, sex="F"), "calcium_mg") == 1000 and target(w, "calcium_mg") == 950
    assert (target(w, "zinc_mg"), target(m, "zinc_mg")) == (9.3, 11.7)
    assert target(m, "vit_d_ug") == 15 and target(m, "potassium_mg") == 3500


def test_thiamin_and_niacin_scale_with_energy_per_mj():
    r = ref(age=35, sex="F", activity="moderate")
    mj = 2080 / 238.83
    assert target(r, "thiamin_mg") == round(0.1 * mj, 1) and target(r, "niacin_mg") == round(1.6 * mj, 1)


def test_kinds_distinguish_pri_ai_ri_and_limits():
    r = ref(age=35, sex="F", weight=60)
    kinds = {k: v["kind"] for k, v in r["items"].items()}
    assert kinds["iron_mg"] == "PRI" and kinds["vit_c_mg"] == "PRI" and kinds["protein_g"] == "PRI"
    assert kinds["magnesium_mg"] == "AI" and kinds["vit_d_ug"] == "AI" and kinds["fiber_g"] == "AI"
    assert kinds["fat_g"] == "RI" and kinds["sodium_mg"] == "limit" and kinds["sugars_g"] == "limit"
    assert all(v["source"] in ("efsa2017", "who2026", "eu1169") for v in r["items"].values())


def test_people_under_18_get_no_personalised_values():
    r = ref(age=15, sex="F")
    assert r["supported"] is False and r["items"] == {} and "under 18" in r["notes"][0]


def test_sources_are_cited():
    r = ref(age=35, sex="F")
    efsa = next(s for s in r["sources"] if s["publisher"].startswith("European Food Safety"))
    assert efsa["doi"] == "10.2903/sp.efsa.2017.e15121" and efsa["published"] == "2017-12-04"


def test_missing_sex_uses_the_lower_adult_value_and_says_so():
    r = ref(age=35)
    assert target(r, "vit_c_mg") == 95 and any("Sex is not set" in n for n in r["notes"]) and not r["personalised"]


# ---------------------------------------------------------------- portions
FOOD = {"name": "Spinach, raw", "category": "Vegetables and Vegetable Products", "nutrients": {"energy_kcal": 23, "protein_g": 2.86, "water_g": 91.4, "vit_c_mg": 28.1},
        "portions": [{"label": "1 cup", "grams": 30.0}, {"label": "1 bunch", "grams": 340.0}]}
OIL = {"name": "Olive oil", "nutrients": {"energy_kcal": 884, "water_g": 0.0}, "portions": []}
MILK = {"name": "Milk, whole, 3.25% milkfat", "category": "Dairy and Egg Products", "nutrients": {"energy_kcal": 61, "water_g": 88.1}, "portions": []}


def test_units_convert_to_grams():
    assert calc.to_grams(FOOD, 150, "g") == (150, False)
    assert calc.to_grams(FOOD, 0.2, "kg") == (pytest.approx(200), False)
    assert calc.to_grams(FOOD, 2, "oz")[0] == pytest.approx(56.699)
    assert calc.to_grams(FOOD, 2, "1 cup") == (60.0, False)  # two of the food's own portion
    assert calc.to_grams(MILK, 250, "ml") == (250, True)  # a drink: about 1 g per ml, flagged approximate
    assert calc.to_grams(MILK, 0.5, "L") == (500, True)


def test_bad_units_and_quantities_are_rejected_with_help():
    with pytest.raises(calc.PortionError, match="no known density"):
        calc.to_grams(OIL, 10, "ml")
    with pytest.raises(calc.PortionError, match="no known density"):
        calc.to_grams(FOOD, 100, "ml")  # spinach is 91% water but is not a liquid
    with pytest.raises(calc.PortionError, match="Choose one of"):
        calc.to_grams(FOOD, 1, "handful")
    for q in (0, -5, None):
        with pytest.raises(calc.PortionError):
            calc.to_grams(FOOD, q, "g")


def test_entry_from_food_scales_every_reported_nutrient():
    e = calc.entry_from_food(FOOD, 1, "1 cup")
    assert e["grams"] == 30 and e["nutrients"]["energy_kcal"] == pytest.approx(6.9) and e["nutrients"]["vit_c_mg"] == pytest.approx(8.43)
    assert "fiber_g" not in e["nutrients"]  # not reported -> not invented


# ---------------------------------------------------------------- totals and completeness
def test_totals_track_which_entries_reported_a_nutrient():
    s = calc.sum_nutrients([{"energy_kcal": 100, "vit_c_mg": 10}, {"energy_kcal": 50}, {"energy_kcal": 25, "vit_c_mg": 5}])
    assert s["totals"] == {"energy_kcal": 175, "vit_c_mg": 15} and s["reported"] == {"energy_kcal": 3, "vit_c_mg": 2} and s["entries"] == 3


def test_quick_entries_only_carry_what_was_typed():
    assert calc.quick_nutrients(calories=300, protein=None) == {"energy_kcal": 300.0}


def test_energy_cross_check_reports_the_difference_instead_of_hiding_it():
    chk = calc.energy_from_macros({"energy_kcal": 500, "protein_g": 30, "carbs_g": 50, "fat_g": 20, "fiber_g": 5})
    assert chk["calculated_kcal"] == pytest.approx(4 * 30 + 4 * 45 + 2 * 5 + 9 * 20)  # 490
    assert chk["difference_pct"] == pytest.approx(-2.0)
    assert calc.energy_from_macros({"energy_kcal": 500}) is None


def test_macro_shares_add_up_to_100():
    s = calc.macro_shares({"protein_g": 30, "carbs_g": 50, "fat_g": 20, "fiber_g": 5, "alcohol_g": 0})
    assert sum(s.values()) == pytest.approx(100) and s["fat"] == pytest.approx(180 / 490 * 100)


def test_quality_combines_honestly():
    assert calc.combine_quality(["verified", "verified"]) == "verified"
    assert calc.combine_quality(["verified", "user"]) == "mixed"
    assert calc.combine_quality([None, None]) == "user"


# ---------------------------------------------------------------- recipes
def test_recipe_totals_per_serving_and_missing_ingredients():
    r = calc.recipe_totals([
        {"name": "Rice", "grams": 200, "food_nutrients": {"energy_kcal": 130, "protein_g": 2.7}},
        {"name": "Mystery sauce", "grams": 50},
    ], servings=2)
    assert r["per_serving"] == {"energy_kcal": 130.0, "protein_g": pytest.approx(2.7)} and r["missing"] == ["Mystery sauce"] and not r["complete"]


# ---------------------------------------------------------------- progress
def test_progress_statuses_and_overrides():
    r = ref(age=35, sex="F", weight=60)
    totals = {"energy_kcal": 1500, "protein_g": 60, "fat_g": 50, "carbs_g": 190, "fiber_g": 10, "vit_c_mg": 120, "sodium_mg": 2600}
    reported = {k: 2 for k in totals}
    p = calc.progress(totals, reported, 2, r["items"])
    assert p["vit_c_mg"]["status"] == "met" and p["vit_c_mg"]["percent"] > 100
    assert p["fiber_g"]["status"] == "below" and p["fiber_g"]["percent"] == pytest.approx(40)
    assert p["fat_g"]["status"] == "within"  # 44-78 g at 2080 kcal
    assert p["sodium_mg"]["status"] == "over"
    assert p["iron_mg"]["status"] == "no_data" and p["iron_mg"]["intake"] is None  # nothing recorded -> not zero
    assert p["carbs_available_g"]["intake"] == 180  # fibre excluded
    # a person's own target replaces the suggestion and is flagged as such
    mine = calc.progress(totals, reported, 2, r["items"], {"fiber_g": {"target": 10}})
    assert mine["fiber_g"]["target"] == 10 and mine["fiber_g"]["overridden"] and mine["fiber_g"]["status"] == "met"


def test_progress_marks_incomplete_data():
    r = ref(age=35, sex="F")
    p = calc.progress({"vit_c_mg": 30}, {"vit_c_mg": 1}, 3, r["items"])
    assert p["vit_c_mg"]["entries_reporting"] == 1 and p["vit_c_mg"]["entries"] == 3 and not p["vit_c_mg"]["complete"]
