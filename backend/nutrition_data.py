"""Nutrient registry and reference values for the Nutrition module.

Everything in here is DATA with a citation, not advice. Reference values come from:

  EFSA   European Food Safety Authority, "Dietary Reference Values for nutrients: Summary report",
         EFSA Supporting publication 2017:e15121 (approved 4 Dec 2017), doi:10.2903/sp.efsa.2017.e15121.
         Tables 1-3 (energy, macronutrients, fibre, water, protein), 5/7 (minerals), 9/11 (vitamins).
         Adults 18 years and over, plus pregnancy and lactation. PRI = population reference intake,
         AI = adequate intake, RI = reference intake range, AR = average requirement.
  WHO    World Health Organization, "Healthy diet" fact sheet (page dated 26 January 2026): free sugars,
         saturated fat, trans fat, sodium and potassium guidance.
  EU     Regulation (EU) No 1169/2011, Annex XIII: reference intakes for a general adult (2000 kcal, ...), used only
         when no profile is available.

Not covered, on purpose: people under 18 (the tables are not encoded; no personalised values are produced),
upper limits (ULs), medical conditions. EFSA has revised some values since 2017 (for example sodium and potassium
in 2019); the app shows the 2017 summary values plus the WHO limits and says so.

Nutrient amounts everywhere are per 100 g in foods and absolute (in the stated unit) in entries and totals.
"""
from typing import Dict, List, Optional

KCAL_PER_MJ = 238.83  # EFSA Table 1 footnote (a)

# --------------------------------------------------------------------------------------------------------------
# Registry. usda: FoodData Central nutrient ids (nutrient.csv `id`) that supply the value, in order of preference.
# --------------------------------------------------------------------------------------------------------------
NUTRIENTS: List[dict] = [
    # energy and macronutrients
    dict(key="energy_kcal", name="Energy", unit="kcal", group="energy", usda=[1008, 2048, 2047],
         about="Energy from food. It is the sum of what protein, carbohydrate, fat, alcohol and fibre provide."),
    dict(key="protein_g", name="Protein", unit="g", group="macro", usda=[1003],
         about="Builds and repairs muscle and other tissue and makes enzymes and hormones."),
    dict(key="carbs_g", name="Carbohydrate", unit="g", group="macro", usda=[1005],
         about="The body's main fuel. This is total carbohydrate by difference, so it includes fibre."),
    dict(key="fat_g", name="Total fat", unit="g", group="macro", usda=[1004],
         about="Concentrated energy; carries fat-soluble vitamins and supplies essential fatty acids."),
    dict(key="fiber_g", name="Fibre", unit="g", group="macro", usda=[1079],
         about="Supports digestion and fullness and is linked to better cholesterol and blood sugar control."),
    dict(key="sugars_g", name="Total sugars", unit="g", group="macro", usda=[2000, 1063],
         about="Includes sugars naturally in fruit and milk as well as added sugar; free sugars cannot be separated."),
    dict(key="sat_fat_g", name="Saturated fat", unit="g", group="fat", usda=[1258],
         about="Mostly from animal fats, coconut and palm oil. Higher intakes raise LDL cholesterol."),
    dict(key="mono_fat_g", name="Monounsaturated fat", unit="g", group="fat", usda=[1292],
         about="Found in olive oil, nuts and avocado."),
    dict(key="poly_fat_g", name="Polyunsaturated fat", unit="g", group="fat", usda=[1293],
         about="Includes the essential omega-6 and omega-3 fatty acids."),
    dict(key="trans_fat_g", name="Trans fat", unit="g", group="fat", usda=[1257],
         about="Mostly from industrially hardened fats; the lower the better."),
    dict(key="la_g", name="Linoleic acid (omega-6)", unit="g", group="fat", usda=[1316],
         about="An essential omega-6 fatty acid, found in vegetable oils, nuts and seeds."),
    dict(key="ala_g", name="Alpha-linolenic acid (omega-3)", unit="g", group="fat", usda=[1404],
         about="An essential omega-3 fatty acid, found in flax, chia, walnuts and rapeseed oil."),
    dict(key="epa_g", name="EPA (omega-3)", unit="g", group="fat", usda=[1278],
         about="Long-chain omega-3 from oily fish."),
    dict(key="dha_g", name="DHA (omega-3)", unit="g", group="fat", usda=[1272],
         about="Long-chain omega-3 from oily fish; important for brain and eye function."),
    dict(key="cholesterol_mg", name="Cholesterol", unit="mg", group="other", usda=[1253],
         about="Found only in animal foods. EFSA sets no intake target for it."),
    dict(key="alcohol_g", name="Alcohol", unit="g", group="other", usda=[1018],
         about="Provides 7 kcal per gram. No intake is risk-free."),
    dict(key="water_g", name="Water in food", unit="g", group="other", usda=[1051],
         about="Moisture in food counts towards total water intake."),
    # vitamins
    dict(key="vit_a_ug", name="Vitamin A", unit="µg", group="vitamin", usda=[1106],
         about="Vision, immune function and skin. Here as retinol activity equivalents (RAE)."),
    dict(key="vit_c_mg", name="Vitamin C", unit="mg", group="vitamin", usda=[1162],
         about="Collagen formation, iron absorption and immune function."),
    dict(key="vit_d_ug", name="Vitamin D", unit="µg", group="vitamin", usda=[1114],
         about="Calcium absorption and bone health. Sunlight is also a major source, which food logs cannot see."),
    dict(key="vit_e_mg", name="Vitamin E", unit="mg", group="vitamin", usda=[1109],
         about="An antioxidant that protects cell membranes. Here as alpha-tocopherol."),
    dict(key="vit_k_ug", name="Vitamin K", unit="µg", group="vitamin", usda=[1185],
         about="Blood clotting and bone proteins. Here as phylloquinone, mainly from leafy greens."),
    dict(key="thiamin_mg", name="Thiamin (B1)", unit="mg", group="vitamin", usda=[1165],
         about="Releases energy from carbohydrate and supports nerves."),
    dict(key="riboflavin_mg", name="Riboflavin (B2)", unit="mg", group="vitamin", usda=[1166],
         about="Energy metabolism, skin and eyes. Dairy and eggs are rich sources."),
    dict(key="niacin_mg", name="Niacin (B3)", unit="mg", group="vitamin", usda=[1167],
         about="Energy metabolism. Food tables list niacin only; the body also makes some from tryptophan, so intake looks lower than it is."),
    dict(key="vit_b6_mg", name="Vitamin B6", unit="mg", group="vitamin", usda=[1175],
         about="Protein metabolism and red blood cell formation."),
    dict(key="folate_ug", name="Folate", unit="µg DFE", group="vitamin", usda=[1190],
         about="Cell division and DNA synthesis; important before and during pregnancy."),
    dict(key="vit_b12_ug", name="Vitamin B12", unit="µg", group="vitamin", usda=[1178],
         about="Nerves and red blood cells. Found almost only in animal foods and fortified products."),
    dict(key="pantothenic_mg", name="Pantothenic acid (B5)", unit="mg", group="vitamin", usda=[1170],
         about="Part of coenzyme A, needed for energy metabolism."),
    dict(key="choline_mg", name="Choline", unit="mg", group="vitamin", usda=[1180],
         about="Cell membranes and nerve signalling; eggs and meat are rich sources."),
    dict(key="biotin_ug", name="Biotin (B7)", unit="µg", group="vitamin", usda=[],
         about="Energy metabolism. The USDA tables used here do not include biotin, so it is never counted."),
    # minerals
    dict(key="calcium_mg", name="Calcium", unit="mg", group="mineral", usda=[1087],
         about="Bones and teeth, muscle and nerve function."),
    dict(key="iron_mg", name="Iron", unit="mg", group="mineral", usda=[1089],
         about="Carries oxygen in the blood. Plant iron is absorbed less well than iron from meat."),
    dict(key="magnesium_mg", name="Magnesium", unit="mg", group="mineral", usda=[1090],
         about="Muscle and nerve function, bone and energy metabolism."),
    dict(key="phosphorus_mg", name="Phosphorus", unit="mg", group="mineral", usda=[1091],
         about="Bones and energy transfer in cells; widespread in protein foods."),
    dict(key="potassium_mg", name="Potassium", unit="mg", group="mineral", usda=[1092],
         about="Fluid balance, muscle and nerve function; a higher intake is linked to lower blood pressure."),
    dict(key="sodium_mg", name="Sodium", unit="mg", group="mineral", usda=[1093],
         about="Fluid balance. Most intake comes from salt in processed food; 1 g of sodium is about 2.5 g of salt."),
    dict(key="zinc_mg", name="Zinc", unit="mg", group="mineral", usda=[1095],
         about="Immune function and wound healing. Absorption is reduced by phytate in whole grains and legumes."),
    dict(key="copper_mg", name="Copper", unit="mg", group="mineral", usda=[1098],
         about="Iron metabolism and connective tissue."),
    dict(key="manganese_mg", name="Manganese", unit="mg", group="mineral", usda=[1101],
         about="Bone formation and enzyme function."),
    dict(key="selenium_ug", name="Selenium", unit="µg", group="mineral", usda=[1103],
         about="Antioxidant enzymes and thyroid function."),
    dict(key="iodine_ug", name="Iodine", unit="µg", group="mineral", usda=[1100],
         about="Thyroid hormones. Few foods are tabulated for iodine, so recorded intake is often incomplete."),
]
BY_KEY: Dict[str, dict] = {n["key"]: n for n in NUTRIENTS}
GROUPS = [("energy", "Energy"), ("macro", "Macronutrients"), ("fat", "Fats"), ("vitamin", "Vitamins"), ("mineral", "Minerals"), ("other", "Other")]

# Derived values (computed from the above, never stored)
DERIVED = {
    "carbs_available_g": dict(name="Available carbohydrate", unit="g", group="macro",
                              about="Carbohydrate excluding fibre. EFSA's carbohydrate range applies to this."),
    "epa_dha_mg": dict(name="EPA + DHA", unit="mg", group="fat", about="Long-chain omega-3 from oily fish, the amount EFSA gives a target for."),
}


def derive(n: Dict[str, float]) -> Dict[str, float]:
    """Add the derived values that can be computed from what is present."""
    out = dict(n)
    if "carbs_g" in n:
        out["carbs_available_g"] = max(n["carbs_g"] - n.get("fiber_g", 0.0), 0.0)
    if "epa_g" in n or "dha_g" in n:
        out["epa_dha_mg"] = (n.get("epa_g", 0.0) + n.get("dha_g", 0.0)) * 1000.0
    return out


# --------------------------------------------------------------------------------------------------------------
# Reference values
# --------------------------------------------------------------------------------------------------------------
SOURCES = {
    "efsa2017": {"title": "EFSA Dietary Reference Values for nutrients: Summary report", "publisher": "European Food Safety Authority",
                 "published": "2017-12-04", "id": "EFSA Supporting publication 2017:e15121", "doi": "10.2903/sp.efsa.2017.e15121",
                 "population": "Healthy adults 18 years and over; pregnancy and lactation",
                 "url": "https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf"},
    "who2026": {"title": "Healthy diet (fact sheet)", "publisher": "World Health Organization", "published": "2026-01-26",
                "population": "Adults", "url": "https://www.who.int/news-room/fact-sheets/detail/healthy-diet"},
    "eu1169": {"title": "Regulation (EU) No 1169/2011, Annex XIII reference intakes", "publisher": "European Union",
               "published": "2011-10-25", "population": "General adult (used only when no profile is available)",
               "url": "https://eur-lex.europa.eu/eli/reg/2011/1169/oj"},
}
KIND_LABEL = {"PRI": "Population reference intake", "AI": "Adequate intake", "RI": "Reference intake range",
              "limit": "Guideline limit", "ref": "Labelling reference intake", "ALAP": "As low as possible"}

# EFSA Table 1: average requirement for energy, MJ/day, by age band and PAL 1.4 / 1.6 / 1.8 / 2.0 (sedentary..very active)
ENERGY_AR_MJ = {
    "M": {(18, 29): (9.8, 11.2, 12.6, 14.0), (30, 39): (9.5, 10.8, 12.2, 13.5), (40, 49): (9.3, 10.7, 12.0, 13.4),
          (50, 59): (9.2, 10.5, 11.9, 13.2), (60, 69): (8.4, 9.6, 10.9, 12.1), (70, 79): (8.3, 9.5, 10.7, 11.9)},
    "F": {(18, 29): (7.9, 9.0, 10.1, 11.2), (30, 39): (7.6, 8.7, 9.8, 10.8), (40, 49): (7.5, 8.6, 9.7, 10.7),
          (50, 59): (7.5, 8.5, 9.6, 10.7), (60, 69): (6.8, 7.8, 8.8, 9.7), (70, 79): (6.8, 7.7, 8.7, 9.6)},
}
PAL = {"sedentary": (0, 1.4), "moderate": (1, 1.6), "active": (2, 1.8), "very_active": (3, 2.0)}
DEFAULT_ACTIVITY = "moderate"
PREGNANCY_ENERGY_MJ = {"pregnant_t1": 0.29, "pregnant_t2": 1.1, "pregnant_t3": 2.1, "lactating_0_6": 2.1, "lactating_6plus": 2.1}
# EFSA Table 3 additions to the non-pregnant PRI for protein, g/day
PREGNANCY_PROTEIN_G = {"pregnant_t1": 1, "pregnant_t2": 9, "pregnant_t3": 28, "lactating_0_6": 19, "lactating_6plus": 13}
ZINC_PHYTATE_LEVEL = 600  # mg/day phytate intake assumed; EFSA gives PRIs for 300/600/900/1200
ZINC_PRI = {"M": {300: 9.4, 600: 11.7, 900: 14.0, 1200: 16.3}, "F": {300: 7.5, 600: 9.3, 900: 11.0, 1200: 12.7}}

# EFSA Tables 5/7/9/11: adults. (kind, male, female, pregnant, lactating). None = same as the female adult value.
MICRO_ADULT = {
    "vit_a_ug": ("PRI", 750, 650, 700, 1300), "vit_c_mg": ("PRI", 110, 95, 105, 155), "vit_d_ug": ("AI", 15, 15, 15, 15),
    "vit_e_mg": ("AI", 13, 11, 11, 11), "vit_k_ug": ("AI", 70, 70, 70, 70), "riboflavin_mg": ("PRI", 1.6, 1.6, 1.9, 2.0),
    "vit_b6_mg": ("PRI", 1.7, 1.6, 1.8, 1.7), "folate_ug": ("PRI", 330, 330, 600, 500), "vit_b12_ug": ("AI", 4.0, 4.0, 4.5, 5.0),
    "pantothenic_mg": ("AI", 5, 5, 5, 7), "choline_mg": ("AI", 400, 400, 480, 520), "biotin_ug": ("AI", 40, 40, 40, 45),
    "magnesium_mg": ("AI", 350, 300, 300, 300), "phosphorus_mg": ("AI", 550, 550, 550, 550), "potassium_mg": ("AI", 3500, 3500, 3500, 4000),
    "manganese_mg": ("AI", 3.0, 3.0, 3.0, 3.0), "selenium_ug": ("AI", 70, 70, 70, 85), "iodine_ug": ("AI", 150, 150, 200, 200),
    "copper_mg": ("AI", 1.6, 1.3, 1.5, 1.5),
}
# EFSA gives thiamin and niacin per MJ of energy
PER_MJ = {"thiamin_mg": ("PRI", 0.1), "niacin_mg": ("PRI", 1.6)}

# Notes shown next to specific nutrients
NUTRIENT_NOTES = {
    "vit_a_ug": "EFSA expresses vitamin A as retinol equivalents (RE); food data here are retinol activity equivalents (RAE), which count carotenoids half as strongly, so recorded intake from vegetables can look lower than the reference assumes.",
    "niacin_mg": "EFSA's value is in niacin equivalents (includes tryptophan); food data list niacin only, so intake is underestimated.",
    "zinc_mg": f"EFSA's zinc values depend on phytate intake (whole grains, legumes). The app assumes {ZINC_PHYTATE_LEVEL} mg/day; the range is 7.5-12.7 mg (women) and 9.4-16.3 mg (men).",
    "iron_mg": "Women before the menopause need more (EFSA 16 mg). The app assumes this up to age 49 and 11 mg from 50; change the target if that does not fit.",
    "vit_d_ug": "The EFSA value assumes minimal skin synthesis; sunlight lowers dietary need. Supplements are not tracked.",
    "sodium_mg": "EFSA's 2017 summary had no sodium value; the WHO limit (2 g sodium, about 5 g salt) is used.",
    "sugars_g": "The WHO limit applies to FREE sugars. Total sugars (including fruit and milk sugars) cannot be split, so treat this as an upper guide.",
    "sat_fat_g": "EFSA: as low as possible. The WHO limit (under 10% of energy) is shown as a practical ceiling.",
    "trans_fat_g": "EFSA: as low as possible. The WHO limit is under 1% of energy.",
}


def age_from_birth_year(birth_year: Optional[int], today_year: int) -> Optional[int]:
    return today_year - birth_year if birth_year else None


def _band(age: int, table: dict) -> Optional[tuple]:
    for lo, hi in table:
        if lo <= age <= hi:
            return (lo, hi)
    return None


def _item(kind, source, unit, target=None, minimum=None, maximum=None, note=""):
    return {"kind": kind, "source": source, "unit": unit, "target": target, "min": minimum, "max": maximum, "note": note}


def reference_for(profile: Optional[dict], weight_kg: Optional[float]) -> dict:
    """Reference values for this person, or a clearly labelled general adult set when the profile is too thin.

    profile keys used: age, sex ("F"/"M"), activity, pregnancy. Returns
    {personalised, supported, basis, notes[], energy_kcal, items{key: {...}}}.
    A user's own overrides are applied by the caller and never replaced here.
    """
    p = profile or {}
    age, sex = p.get("age"), (p.get("sex") or "").upper()[:1] or None
    status = p.get("pregnancy")
    notes: List[str] = []
    if age is not None and age < 18:
        return {"personalised": False, "supported": False, "basis": "none", "energy_kcal": None, "items": {}, "sources": [],
                "notes": ["Reference values for people under 18 are not included in this app. Please ask a doctor or dietitian for targets; you can still log food and set your own targets."]}
    if age is not None and age > 79:
        notes.append("EFSA gives no energy reference for people over 79; the 70-79 band is used for energy.")

    items: Dict[str, dict] = {}
    personalised = bool(sex in ("M", "F") and age is not None)

    # ---- energy
    if personalised:
        band = _band(min(age, 79), ENERGY_AR_MJ[sex])
        idx, pal = PAL.get(p.get("activity") or DEFAULT_ACTIVITY, PAL[DEFAULT_ACTIVITY])
        if not p.get("activity"):
            notes.append("Activity level not set; 'moderately active' (PAL 1.6) is assumed.")
        mj = ENERGY_AR_MJ[sex][band][idx]
        if sex == "F" and status in PREGNANCY_ENERGY_MJ:
            mj += PREGNANCY_ENERGY_MJ[status]
        energy = round(mj * KCAL_PER_MJ / 10) * 10  # to the nearest 10 kcal
        basis = "efsa2017"
        items["energy_kcal"] = _item("AR", "efsa2017", "kcal", target=energy,
                                     note=f"EFSA average requirement for age {age}, {'women' if sex == 'F' else 'men'}, PAL {pal}"
                                          + (f", plus pregnancy/lactation allowance" if status in PREGNANCY_ENERGY_MJ and sex == "F" else "") + ".")
    else:
        energy, basis = 2000, "eu1169"
        notes.append("Age and sex are needed for personalised values; the general adult labelling reference (2000 kcal) is shown instead.")
        items["energy_kcal"] = _item("ref", "eu1169", "kcal", target=2000, note="EU labelling reference intake for a general adult.")
    mj_e = energy / KCAL_PER_MJ

    # ---- macronutrients (grams from % of energy)
    items["carbs_available_g"] = _item("RI", "efsa2017", "g", minimum=round(0.45 * energy / 4), target=round(0.50 * energy / 4), maximum=round(0.60 * energy / 4),
                                       note="EFSA: 45-60% of energy from carbohydrate (excluding fibre). Target shown is the 50% point.")
    items["fat_g"] = _item("RI", "efsa2017", "g", minimum=round(0.20 * energy / 9), target=round(0.30 * energy / 9), maximum=round(0.35 * energy / 9),
                           note="EFSA: 20-35% of energy from total fat. Target shown is the 30% point.")
    items["fiber_g"] = _item("AI", "efsa2017", "g", target=25, note="EFSA adequate intake for adults.")
    items["sat_fat_g"] = _item("limit", "who2026", "g", maximum=round(0.10 * energy / 9), note=NUTRIENT_NOTES["sat_fat_g"])
    items["trans_fat_g"] = _item("limit", "who2026", "g", maximum=round(0.01 * energy / 9, 1), note=NUTRIENT_NOTES["trans_fat_g"])
    items["sugars_g"] = _item("limit", "who2026", "g", maximum=round(0.10 * energy / 4), note=NUTRIENT_NOTES["sugars_g"])
    items["la_g"] = _item("AI", "efsa2017", "g", target=round(0.04 * energy / 9, 1), note="EFSA: 4% of energy.")
    items["ala_g"] = _item("AI", "efsa2017", "g", target=round(0.005 * energy / 9, 1), note="EFSA: 0.5% of energy.")
    items["epa_dha_mg"] = _item("AI", "efsa2017", "mg", target=250 + (100 if status and sex == "F" else 0),
                                note="EFSA: 250 mg/day combined EPA and DHA" + ("; pregnancy and lactation add 100-200 mg DHA." if status else "."))
    # protein: g per kg body weight
    if weight_kg:
        prot = 0.83 * weight_kg + (PREGNANCY_PROTEIN_G.get(status, 0) if sex == "F" else 0)
        items["protein_g"] = _item("PRI", "efsa2017", "g", target=round(prot), note=f"EFSA PRI 0.83 g per kg body weight, for {weight_kg:g} kg.")
    else:
        items["protein_g"] = _item("ref", "eu1169", "g", target=50, note="EU labelling reference intake. Log your weight on the Body page for the EFSA value (0.83 g per kg).")
        notes.append("Body weight is needed for the personalised protein target.")
    # water: total water incl. food moisture
    water_l = {"F": 2.0, "M": 2.5}.get(sex, 2.0)
    if sex == "F" and status and status.startswith("pregnant"):
        water_l = 2.3
    elif sex == "F" and status and status.startswith("lactating"):
        water_l = 2.7
    items["water_ml"] = _item("AI", "efsa2017" if sex else "efsa2017", "ml", target=int(water_l * 1000),
                              note="EFSA adequate intake of TOTAL water (drinks plus water in food)." + ("" if sex else " Sex not set; the lower adult value is used."))

    # ---- vitamins and minerals
    col = {"M": 1, "F": 2}.get(sex, 2)
    if sex == "F" and status:
        col = 3 if status.startswith("pregnant") else 4
    for key, row in MICRO_ADULT.items():
        kind, value = row[0], row[col]
        items[key] = _item(kind, "efsa2017", BY_KEY[key]["unit"], target=value, note=NUTRIENT_NOTES.get(key, ""))
    for key, (kind, per_mj) in PER_MJ.items():
        items[key] = _item(kind, "efsa2017", BY_KEY[key]["unit"], target=round(per_mj * mj_e, 1), note=f"EFSA: {per_mj} per MJ of energy ({mj_e:.1f} MJ).  " + NUTRIENT_NOTES.get(key, ""))
    # calcium: 18-24 -> 1000, 25+ -> 950
    items["calcium_mg"] = _item("PRI", "efsa2017", "mg", target=1000 if (age is not None and age <= 24) else 950,
                                note="EFSA PRI: 1000 mg at 18-24, 950 mg from 25." + ("" if age is not None else " Age not set; 950 mg (25+) is shown."))
    # iron
    if sex == "M":
        iron = 11
    elif sex == "F":
        iron = 16 if (status or age is None or age < 50) else 11
        if age is None and not status:
            notes.append("Age not set; the premenopausal iron value (16 mg) is shown for women.")
    else:
        iron = 11
    items["iron_mg"] = _item("PRI", "efsa2017", "mg", target=iron, note=NUTRIENT_NOTES["iron_mg"])
    zsex = "M" if sex == "M" else "F"
    zinc = ZINC_PRI[zsex][ZINC_PHYTATE_LEVEL] + ({"pregnant": 1.6, "lactating": 2.9}.get((status or "").split("_")[0], 0.0) if sex == "F" else 0.0)
    items["zinc_mg"] = _item("PRI", "efsa2017", "mg", target=round(zinc, 1), note=NUTRIENT_NOTES["zinc_mg"])
    items["sodium_mg"] = _item("limit", "who2026", "mg", maximum=2000, note=NUTRIENT_NOTES["sodium_mg"])
    if not sex:
        notes.append("Sex is not set; the lower of the male/female EFSA values is shown where they differ.")
        for key, row in MICRO_ADULT.items():
            if row[1] != row[2]:
                items[key]["target"] = min(row[1], row[2])
    return {"personalised": personalised, "supported": True, "basis": basis, "energy_kcal": energy, "items": items, "notes": notes,
            "sources": [SOURCES["efsa2017"], SOURCES["who2026"]] + ([SOURCES["eu1169"]] if basis == "eu1169" else [])}
