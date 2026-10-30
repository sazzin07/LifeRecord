"""EFSA reference values for 1-17 year olds, and EFSA's upper levels, checked value by value.

The expected numbers come from efsa_tables.json, transcribed from EFSA's two PDFs by column position and re-checked against the
PDF text: the DRV summary report 2017 (Tables 1, 2, 3, 5, 7, 9, 11) and the Overview on Tolerable Upper
Intake Levels, version 11 (August 2025). Nothing here is derived from nutrition_data.py, so a typo in either place fails.
The same fixture also re-checks the adult values the app already used.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import nutrition_calc as calc  # noqa: E402
import nutrition_data as nd  # noqa: E402

FX = json.loads((Path(__file__).parent / "efsa_tables.json").read_text(encoding="utf-8"))
KCAL = 238.83  # EFSA: 1 MJ = 238.83 kcal

VIT = {"biotin": "biotin_ug", "choline": "choline_mg", "vit_b12": "vit_b12_ug", "folate": "folate_ug", "pantothenic": "pantothenic_mg", "riboflavin": "riboflavin_mg",
       "vit_a": "vit_a_ug", "vit_b6": "vit_b6_mg", "vit_c": "vit_c_mg", "vit_d": "vit_d_ug", "vit_k": "vit_k_ug", "vit_e": "vit_e_mg"}
MIN = {"calcium": "calcium_mg", "iodine": "iodine_ug", "manganese": "manganese_mg", "phosphorus": "phosphorus_mg", "potassium": "potassium_mg",
       "selenium": "selenium_ug", "iron": "iron_mg", "zinc": "zinc_mg", "copper": "copper_mg", "magnesium": "magnesium_mg"}
PAL_WANTED = {"sedentary": 1.4, "moderate": 1.6, "active": 1.8, "very_active": 2.0}


def ref(age, sex, weight=None, activity="moderate", pregnancy=None):
    return nd.reference_for({"age": age, "sex": sex, "activity": activity, "pregnancy": pregnancy}, weight)


def ages_of(band):
    """'1-3' -> [1, 2, 3]; months bands ('7-11mo') and adult bands are not children's years and are skipped."""
    if band.endswith("mo") or band in ("pregnancy", "lactation") or band.startswith(("18", "25")):
        return []
    lo, hi = band.split("-")
    return list(range(int(lo), int(hi) + 1))


def child_cases():
    """(sex, age, nutrient key, expected value, expected kind) for every child's year of age and every micronutrient EFSA prints."""
    for sex in "MF":
        for group, names in ((FX["vitamins"][sex], VIT), (FX["minerals"][sex], MIN)):
            for fx_key, app_key in names.items():
                for band, cell in group[fx_key].items():
                    for age in ages_of(band):
                        if 1 <= age <= 17:
                            yield sex, age, app_key, cell["value"], cell["kind"]


# ------------------------------------------------------------------ children: energy
@pytest.mark.parametrize("sex", ["M", "F"])
@pytest.mark.parametrize("activity", list(PAL_WANTED))
def test_child_energy_is_efsas_average_requirement_at_the_nearest_published_pal(sex, activity):
    for age in range(1, 18):
        published = FX["energy_ar_mj"][sex][str(age)]  # {"1.4": MJ, ...}: only the PAL levels EFSA gives for this age
        wanted = PAL_WANTED[activity]
        pal = min(published, key=lambda p: (abs(float(p) - wanted), float(p)))
        expected = round(published[pal] * KCAL / 10) * 10
        r = ref(age, sex, activity=activity)
        assert r["supported"] and r["items"]["energy_kcal"]["target"] == expected, (sex, age, activity, pal)
        assert r["energy_kcal"] == expected
        if float(pal) != wanted:
            assert any(f"PAL {float(pal):g} is used" in n for n in r["notes"]), (age, activity)


def test_child_energy_covers_every_age_exactly_once():
    for sex in "MF":
        assert sorted(map(int, FX["energy_ar_mj"][sex])) == list(range(1, 18))
        assert sorted(nd.CHILD_ENERGY_AR_MJ) == list(range(1, 18))


def test_unset_activity_assumes_moderate_and_says_so():
    r = nd.reference_for({"age": 8, "sex": "M"}, None)
    assert r["items"]["energy_kcal"]["target"] == round(FX["energy_ar_mj"]["M"]["8"]["1.6"] * KCAL / 10) * 10
    assert any("Activity level not set" in n for n in r["notes"])


# ------------------------------------------------------------------ children: protein
@pytest.mark.parametrize("sex", ["M", "F"])
def test_child_protein_is_the_pri_per_kg_times_body_weight(sex):
    for age in range(1, 18):
        pri = FX["protein_pri_g_per_kg"][sex][str(age)]
        r = ref(age, sex, weight=30)
        assert r["items"]["protein_g"]["target"] == round(pri * 30), (sex, age)
        assert r["items"]["protein_g"]["kind"] == "PRI"


def test_child_protein_needs_a_weight_and_is_left_out_without_one():
    r = ref(10, "F")
    assert "protein_g" not in r["items"] and any("Body weight is needed" in n for n in r["notes"])


# ------------------------------------------------------------------ children: vitamins and minerals, one assertion per value EFSA prints
def test_every_child_micronutrient_value_matches_the_published_tables():
    cases = list(child_cases())
    assert len(cases) == 22 * 17 * 2  # 12 vitamins + 10 minerals, every year of age 1-17, both sexes: guards against the fixture quietly shrinking
    for sex, age, key, value, kind in cases:
        item = ref(age, sex)["items"][key]
        assert item["target"] == pytest.approx(value), (sex, age, key)
        assert item["kind"] == kind, (sex, age, key)
        assert item["source"] == "efsa2017"


@pytest.mark.parametrize("sex", ["M", "F"])
def test_child_thiamin_and_niacin_follow_energy(sex):
    for age in range(1, 18):
        r = ref(age, sex)
        mj = r["energy_kcal"] / KCAL
        assert r["items"]["thiamin_mg"]["target"] == round(FX["vitamins"][sex]["thiamin_per_mj"]["1-3" if age <= 3 else "4-6"]["value"] * mj, 1)
        assert r["items"]["niacin_mg"]["target"] == round(FX["vitamins"][sex]["niacin_per_mj"]["1-3" if age <= 3 else "4-6"]["value"] * mj, 1)
        assert r["items"]["thiamin_mg"]["kind"] == "PRI" and r["items"]["niacin_mg"]["kind"] == "PRI"


# ------------------------------------------------------------------ children: Table 2 (macronutrients, fibre, water), read from page 23
def test_child_macronutrient_fibre_and_water_references():
    fibre = {1: 10, 2: 10, 3: 10, 4: 14, 5: 14, 6: 14, 7: 16, 8: 16, 9: 16, 10: 16, 11: 19, 12: 19, 13: 19, 14: 19, 15: 21, 16: 21, 17: 21}
    water = {1: ("M", 1.1), 2: ("M", 1.3), 3: ("M", 1.3), 4: ("M", 1.6), 8: ("M", 1.6), 9: ("M", 2.1), 13: ("M", 2.1), 14: ("M", 2.5), 17: ("M", 2.5)}
    water_f = {9: 1.9, 13: 1.9, 14: 2.0, 17: 2.0}
    for age in range(1, 18):
        r = ref(age, "M")
        e = r["energy_kcal"]
        it = r["items"]
        assert it["fiber_g"]["target"] == fibre[age] and it["fiber_g"]["kind"] == "AI"
        assert (it["carbs_available_g"]["min"], it["carbs_available_g"]["max"]) == (round(0.45 * e / 4), round(0.60 * e / 4))  # 45-60 E%
        lo, hi = (35, 40) if age <= 3 else (20, 35)
        assert (it["fat_g"]["min"], it["fat_g"]["max"]) == (round(lo / 100 * e / 9), round(hi / 100 * e / 9))
        assert it["la_g"]["target"] == round(0.04 * e / 9, 1) and it["ala_g"]["target"] == round(0.005 * e / 9, 1)
        if age in water:
            assert it["water_ml"]["target"] == round(water[age][1] * 1000)
        if age >= 2:
            assert it["epa_dha_mg"]["target"] == 250
        else:
            assert "epa_dha_mg" not in it and any("DHA value (100 mg)" in n for n in r["notes"])
    for age, litres in water_f.items():
        assert ref(age, "F")["items"]["water_ml"]["target"] == round(litres * 1000)


def test_child_references_carry_no_adult_guideline_limits_and_say_why():
    r = ref(12, "F")
    assert not {"sat_fat_g", "trans_fat_g", "sugars_g", "sodium_mg"} & set(r["items"])
    assert any("not applied to children" in n for n in r["notes"])
    assert all(i["kind"] != "limit" for i in r["items"].values())


def test_child_notes_do_not_borrow_adult_wording():
    z = ref(9, "M")["items"]["zinc_mg"]["note"]
    assert "phytate" in z and "does not adjust" in z and "600" not in z
    assert "menopause" not in ref(14, "F")["items"]["iron_mg"]["note"]
    assert "higher from age 12" in ref(14, "F")["items"]["iron_mg"]["note"] and ref(14, "M")["items"]["iron_mg"]["note"] == ""


# ------------------------------------------------------------------ who is not covered
def test_babies_pregnant_teenagers_and_missing_sex_are_not_guessed():
    for r, words in ((ref(0, "F"), "start at 1 year"), (ref(15, "F", pregnancy="pregnant_t2"), "adult women"), (ref(10, None), "Set sex")):
        assert r["supported"] is False and r["items"] == {} and r["energy_kcal"] is None and words in r["notes"][0]
    assert ref(17, "M")["supported"] and ref(18, "M")["supported"] and not ref(17, None)["supported"]


def test_children_are_personalised_and_cite_both_efsa_documents():
    r = ref(11, "M", weight=38)
    assert r["personalised"] and r["basis"] == "efsa2017"
    assert [s["title"].split(" ")[0] for s in r["sources"]] == ["EFSA", "Overview"] and [s["id"] for s in r["sources"]][1] == "Version 11 (August 2025)"
    assert any("not a growth chart" in n for n in r["notes"]) and any("year out" in n for n in r["notes"])


# ------------------------------------------------------------------ adults: the values the app already used, re-checked against the same tables
def test_adult_micronutrients_match_the_published_tables():
    for sex, col in (("M", 1), ("F", 2)):
        for group, names in ((FX["vitamins"][sex], VIT), (FX["minerals"][sex], MIN)):
            for fx_key, app_key in names.items():
                if app_key in ("calcium_mg", "iron_mg", "zinc_mg"):
                    continue  # these have their own rules below
                cell = group[fx_key]["18+"]
                kind, *vals = nd.MICRO_ADULT[app_key]
                assert vals[col - 1] == pytest.approx(cell["value"]), (sex, app_key)
                assert kind == cell["kind"], (sex, app_key)
    for status, fx_band, col in (("pregnant_t1", "pregnancy", 3), ("lactating_0_6", "lactation", 4)):
        for fx_key, app_key in VIT.items():
            cell = FX["vitamins"]["F"][fx_key][fx_band]
            assert nd.MICRO_ADULT[app_key][col] == pytest.approx(cell["value"]), (status, app_key)


def test_adult_calcium_iron_and_zinc_match_the_published_tables():
    for sex in "MF":
        ca = FX["minerals"][sex]["calcium"]
        assert ref(20, sex)["items"]["calcium_mg"]["target"] == ca["18-24"]["value"] and ref(40, sex)["items"]["calcium_mg"]["target"] == ca["25+"]["value"]
    assert ref(40, "M")["items"]["iron_mg"]["target"] == FX["minerals"]["M"]["iron"]["18+"]["value"]
    assert ref(40, "F")["items"]["iron_mg"]["target"] == FX["minerals"]["F"]["iron"]["18+premenopausal"]["value"]
    assert ref(60, "F")["items"]["iron_mg"]["target"] == FX["minerals"]["F"]["iron"]["18+postmenopausal"]["value"]
    for sex in "MF":
        for lpi, pri in FX["minerals"][sex]["zinc_adult_by_lpi"].items():
            assert nd.ZINC_PRI[sex][int(lpi)] == pri, (sex, lpi)


# ------------------------------------------------------------------ upper levels
UL_APP_KEYS = {"copper_mg": "copper_mg", "iodine_ug": "iodine_ug", "magnesium_mg": "magnesium_mg", "selenium_ug": "selenium_ug", "zinc_mg": "zinc_mg",
               "folate_ug": "folate_ug", "vit_a_ug": "vit_a_ug", "vit_b6_mg": "vit_b6_mg", "vit_e_mg": "vit_e_mg", "vit_d_ug": "vit_d_ug",
               "nicotinamide_mg": "niacin_mg", "calcium_mg": "calcium_mg"}
NO_UL_APP_KEYS = {"Vitamin C": "vit_c_mg", "Vitamin K": "vit_k_ug", "Vitamin B1": "thiamin_mg", "Vitamin B2": "riboflavin_mg", "Vitamin B12": "vit_b12_ug", "Biotin": "biotin_ug",
                  "Pantothenic acid": "pantothenic_mg", "Phosphorus": "phosphorus_mg", "Potassium": "potassium_mg", "Sodium": "sodium_mg", "Total fat": "fat_g",
                  "Saturated fatty acids": "sat_fat_g", "Proteins": "protein_g", "Sugars": "sugars_g", "DHA, EPA, DPA": "epa_dha_mg"}


def test_every_upper_level_matches_the_published_table_at_every_age():
    checked = 0
    for fx_key, app_key in UL_APP_KEYS.items():
        published = FX["upper_levels"]["uls"][fx_key]  # {"1-3": value or null, ... "18+": value}
        for band, value in published.items():
            for age in ([18, 30, 79] if band == "18+" else ages_of(band)):
                up = nd.upper_level_for(app_key, age)
                if value is None:
                    assert up["kind"] == "none" and up["value"] is None, (app_key, age)
                else:
                    assert up["kind"] == "UL" and up["value"] == value, (app_key, age)
                    checked += 1
        if "1-3" not in published:  # calcium: EFSA gives adults only
            assert nd.upper_level_for(app_key, 10)["value"] is None
    assert checked >= 12 * 6 - 12  # every nutrient x band that EFSA defines


def test_calcium_has_an_adult_level_only():
    assert FX["upper_levels"]["uls"]["calcium_mg"] == {"18+": 2500}
    assert nd.upper_level_for("calcium_mg", 40)["value"] == 2500 and nd.upper_level_for("calcium_mg", 12)["value"] is None


def test_safe_levels_for_iron_and_manganese_match_and_are_marked_as_not_limits():
    for fx_key, app_key, bands in (("iron_mg", "iron_mg", {"1-3": [1, 2, 3], "4-6": [4, 5, 6], "7-10": [7, 8, 9, 10], "11-14": [11, 12, 13, 14], "15-17": [15, 16, 17], "18+": [18, 50]}),
                                   ("manganese_mg", "manganese_mg", {"1-2": [1, 2], "3-6": [3, 4, 5, 6], "7-13": list(range(7, 14)), "14-17": [14, 15, 16, 17], "18+": [18, 50]})):
        for band, ages in bands.items():
            for age in ages:
                up = nd.upper_level_for(app_key, age)
                assert up["kind"] == "safe" and up["value"] == FX["upper_levels"]["safe_levels"][fx_key][band], (app_key, age)
                assert "does not by itself mean harm" in up["basis"]


def test_no_level_is_invented_for_nutrients_efsa_leaves_open():
    published = set(FX["upper_levels"]["no_upper_level"])
    for label, key in NO_UL_APP_KEYS.items():
        assert label in published, label
        up = nd.upper_level_for(key, 30)
        assert up["kind"] == "none" and up["value"] is None and up["comparable"] is False, key
    assert "no adverse effects" in nd.upper_level_for("vit_b12_ug", 30)["basis"]
    # and every app nutrient that has a level is one the document gives (nothing added from elsewhere)
    given = {UL_APP_KEYS[k] for k in FX["upper_levels"]["uls"] if k in UL_APP_KEYS} | set(FX["upper_levels"]["safe_levels"])
    assert {k for k, v in nd.UPPER_LEVELS.items()} == given


def test_only_levels_that_cover_total_intake_are_compared_with_logged_food():
    comparable = {k for k in nd.UPPER_LEVELS if nd.upper_level_for(k, 30)["comparable"]}
    assert comparable == {"calcium_mg", "copper_mg", "iodine_ug", "selenium_ug", "zinc_mg", "vit_d_ug", "vit_b6_mg", "vit_e_mg", "iron_mg", "manganese_mg"}
    for k in ("magnesium_mg", "folate_ug", "vit_a_ug", "niacin_mg"):
        up = nd.upper_level_for(k, 30)
        assert up["comparable"] is False and up["value"] is not None, k
        assert "cannot be checked" in up["basis"] or "cannot be compared" in up["basis"], k


def test_unknown_age_gets_the_adult_level_and_children_get_theirs():
    assert nd.upper_level_for("zinc_mg", None)["value"] == 25 and nd.upper_level_for("zinc_mg", 8)["value"] == 13
    assert ref(None, "F")["items"]["zinc_mg"]["upper"]["value"] == 25
    assert ref(8, "F")["items"]["zinc_mg"]["upper"]["value"] == 13
    assert ref(30, "F")["items"]["vit_a_ug"]["upper"]["value"] == 3000 and ref(30, "F")["items"]["vit_a_ug"]["upper"]["source"] == "efsa_ul"


def test_nutrients_the_app_does_not_track_are_not_listed():
    assert nd.upper_level_for("energy_kcal", 30) is None and nd.upper_level_for("choline_mg", 30) is None


# ------------------------------------------------------------------ progress: over an upper level
def _progress(sex, age, totals, weight=70):
    r = ref(age, sex, weight=weight)
    return calc.progress(totals, {k: 1 for k in totals}, 1, r["items"])


def test_going_above_a_comparable_level_is_flagged_and_equal_is_not():
    p = _progress("M", 30, {"zinc_mg": 25.0, "selenium_ug": 300.0})
    assert p["zinc_mg"]["upper"]["over"] is False and p["zinc_mg"]["upper"]["percent"] == pytest.approx(100.0)
    assert p["selenium_ug"]["upper"]["over"] is True and p["selenium_ug"]["upper"]["value"] == 255
    assert [x["key"] for x in calc.upper_exceeded(p)] == ["selenium_ug"]
    assert calc.upper_exceeded(p)[0] == {"key": "selenium_ug", "intake": 300.0, "limit": 255, "unit": "µg", "kind": "UL"}


def test_levels_that_cannot_be_compared_never_raise_a_flag():
    p = _progress("F", 30, {"magnesium_mg": 900.0, "folate_ug": 5000.0, "vit_a_ug": 9000.0, "niacin_mg": 500.0})
    for k in ("magnesium_mg", "folate_ug", "vit_a_ug", "niacin_mg"):
        assert p[k]["upper"]["over"] is False and p[k]["upper"]["percent"] is None and p[k]["upper"]["comparable"] is False
    assert calc.upper_exceeded(p) == []


def test_a_safe_level_is_reported_as_such():
    p = _progress("M", 30, {"iron_mg": 41.0})
    assert calc.upper_exceeded(p) == [{"key": "iron_mg", "intake": 41.0, "limit": 40, "unit": "mg", "kind": "safe"}]


def test_children_are_checked_against_their_own_level():
    assert calc.upper_exceeded(_progress("M", 5, {"zinc_mg": 11.0}, weight=18))[0]["limit"] == 10
    assert calc.upper_exceeded(_progress("M", 40, {"zinc_mg": 11.0})) == []


def test_a_nutrient_with_no_data_is_not_over():
    p = _progress("M", 30, {"energy_kcal": 2000.0})
    assert p["zinc_mg"]["upper"]["over"] is False and p["zinc_mg"]["intake"] is None


def test_the_target_does_not_change_when_the_user_sets_their_own():
    r = ref(30, "M", weight=70)
    p = calc.progress({"zinc_mg": 20.0}, {"zinc_mg": 1}, 1, r["items"], {"zinc_mg": {"target": 30}})
    assert p["zinc_mg"]["target"] == 30 and p["zinc_mg"]["upper"]["value"] == 25 and p["zinc_mg"]["overridden"] is True
