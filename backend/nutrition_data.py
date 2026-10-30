"""Nutrient registry and reference values for the Nutrition module.

Everything in here is DATA with a citation, not advice. Reference values come from:

  EFSA   European Food Safety Authority, "Dietary Reference Values for nutrients: Summary report",
         EFSA Supporting publication 2017:e15121 (approved 4 Dec 2017), doi:10.2903/sp.efsa.2017.e15121.
         Tables 1-3 (energy, macronutrients, fibre, water, protein), 5/7 (minerals), 9/11 (vitamins).
         Adults 18 years and over, pregnancy and lactation, and children and teenagers aged 1-17 (single years of age).
         PRI = population reference intake,
         AI = adequate intake, RI = reference intake range, AR = average requirement.
  WHO    World Health Organization, "Healthy diet" fact sheet (page dated 26 January 2026): free sugars,
         saturated fat, trans fat, sodium and potassium guidance.
  EU     Regulation (EU) No 1169/2011, Annex XIII: reference intakes for a general adult (2000 kcal, ...), used only
         when no profile is available.

  EFSA UL  EFSA, "Overview on Tolerable Upper Intake Levels" (SCF and NDA Panel), version 11, August 2025: tables 1-3.
         Shown beside a reference value; a level is compared with logged food only where its footnote says it covers total intake.

Not covered, on purpose: babies under 1 year, pregnancy or lactation under 18, supplements, medical conditions. Any value EFSA does not
publish for an age is left out, never scaled or estimated. EFSA has revised some values since 2017 (for example sodium and potassium
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


def meta(key: str) -> dict:
    """Name, unit and group of a nutrient key, stored or derived (EPA + DHA, available carbohydrate). Unknown keys give {}."""
    return BY_KEY.get(key) or DERIVED.get(key) or {}


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
                 "population": "Healthy people from 1 year of age (age-specific values for children and adolescents), adults, pregnancy and lactation",
                 "url": "https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf"},
    "efsa_ul": {"title": "Overview on Tolerable Upper Intake Levels as derived by the Scientific Committee on Food (SCF) and the EFSA Panel on Dietetic Products, Nutrition and Allergies (NDA)",
                "publisher": "European Food Safety Authority", "published": "2025-08", "id": "Version 11 (August 2025)",
                "population": "Children, adolescents and adults; pregnancy and lactation",
                "url": "https://www.efsa.europa.eu/sites/default/files/2024-05/ul-summary-report.pdf"},
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


# --------------------------------------------------------------------------------------------------------------
# Children and adolescents, 1-17 years (EFSA 2017 summary report, the same tables as the adult values above).
# Single years of age. A value that EFSA does not give for an age is left out; the app never fills a gap by scaling.
# --------------------------------------------------------------------------------------------------------------
CHILD_AGES = (1, 17)
# Table 1: ages 1-3 have one level (PAL 1.4), ages 4-9 three (1.4, 1.6, 1.8), ages 10-17 three (1.6, 1.8, 2.0). Pairs are (boys, girls), MJ/day.
CHILD_ENERGY_AR_MJ = {
    1: ((3.3,), (3.0,)), 2: ((4.3,), (4.0,)), 3: ((4.9,), (4.6,)),
    4: ((5.3, 6.0, 6.8), (4.9, 5.6, 6.3)), 5: ((5.6, 6.4, 7.2), (5.2, 5.9, 6.7)), 6: ((5.9, 6.7, 7.6), (5.5, 6.3, 7.1)),
    7: ((6.3, 7.2, 8.1), (5.8, 6.7, 7.5)), 8: ((6.7, 7.6, 8.6), (6.2, 7.1, 7.9)), 9: ((7.0, 8.1, 9.1), (6.6, 7.5, 8.4)),
    10: ((8.1, 9.1, 10.1), (7.6, 8.6, 9.5)), 11: ((8.5, 9.6, 10.7), (8.0, 9.0, 10.0)), 12: ((9.1, 10.2, 11.4), (8.4, 9.4, 10.5)),
    13: ((9.8, 11.0, 12.2), (8.8, 9.9, 11.0)), 14: ((10.5, 11.8, 13.1), (9.1, 10.2, 11.4)), 15: ((11.3, 12.7, 14.1), (9.3, 10.5, 11.7)),
    16: ((11.9, 13.4, 14.9), (9.5, 10.6, 11.8)), 17: ((12.3, 13.8, 15.4), (9.5, 10.7, 11.9)),
}
CHILD_PAL_LEVELS = {range(1, 4): (1.4,), range(4, 10): (1.4, 1.6, 1.8), range(10, 18): (1.6, 1.8, 2.0)}
# Table 3: PRI for protein, g per kg body weight per day, (boys, girls)
CHILD_PROTEIN_PRI = {1: (1.14, 1.14), 2: (0.97, 0.97), 3: (0.90, 0.90), 4: (0.86, 0.86), 5: (0.85, 0.85), 6: (0.89, 0.89), 7: (0.91, 0.91), 8: (0.92, 0.92),
                     9: (0.92, 0.92), 10: (0.91, 0.91), 11: (0.91, 0.90), 12: (0.90, 0.89), 13: (0.90, 0.88), 14: (0.89, 0.87), 15: (0.88, 0.85),
                     16: (0.87, 0.84), 17: (0.86, 0.83)}
# Table 2: dietary fibre AI (g/day), total fat RI (% of energy) and total water AI (litres/day, total incl. food moisture; (boys, girls))
CHILD_FIBRE_G = [((1, 3), 10), ((4, 6), 14), ((7, 10), 16), ((11, 14), 19), ((15, 17), 21)]
CHILD_FAT_PCT = [((1, 3), (35, 40)), ((4, 17), (20, 35))]
CHILD_WATER_L = [((1, 1), (1.1, 1.1)), ((2, 3), (1.3, 1.3)), ((4, 8), (1.6, 1.6)), ((9, 13), (2.1, 1.9)), ((14, 17), (2.5, 2.0))]  # age 1: EFSA gives 1.1-1.2, the lower is used
_STD = ((1, 3), (4, 6), (7, 10), (11, 14), (15, 17))


def _s(*values):
    return list(zip(_STD, values))


# Tables 5, 7, 9, 11: (kind, boys, girls); girls None = same as boys. Each is [((first age, last age), value), ...] because EFSA's age bands differ by nutrient.
CHILD_MICRO = {
    "calcium_mg": ("PRI", _s(450, 800, 800, 1150, 1150), None),
    "iodine_ug": ("AI", _s(90, 90, 90, 120, 130), None),
    "manganese_mg": ("AI", _s(0.5, 1.0, 1.5, 2.0, 3.0), None),
    "phosphorus_mg": ("AI", _s(250, 440, 440, 640, 640), None),
    "potassium_mg": ("AI", _s(800, 1100, 1800, 2700, 3500), None),
    "selenium_ug": ("AI", _s(15, 20, 35, 55, 70), None),
    "iron_mg": ("PRI", _s(7, 7, 11, 11, 11), [((1, 3), 7), ((4, 6), 7), ((7, 11), 11), ((12, 14), 13), ((15, 17), 13)]),
    "zinc_mg": ("PRI", _s(4.3, 5.5, 7.4, 10.7, 14.2), _s(4.3, 5.5, 7.4, 10.7, 11.9)),
    "copper_mg": ("AI", [((1, 2), 0.7), ((3, 9), 1.0), ((10, 17), 1.3)], [((1, 2), 0.7), ((3, 9), 1.0), ((10, 17), 1.1)]),
    "magnesium_mg": ("AI", [((1, 2), 170), ((3, 9), 230), ((10, 17), 300)], [((1, 2), 170), ((3, 9), 230), ((10, 17), 250)]),
    "vit_a_ug": ("PRI", _s(250, 300, 400, 600, 750), _s(250, 300, 400, 600, 650)),
    "vit_c_mg": ("PRI", _s(20, 30, 45, 70, 100), _s(20, 30, 45, 70, 90)),
    "vit_d_ug": ("AI", _s(15, 15, 15, 15, 15), None),
    "vit_e_mg": ("AI", [((1, 2), 6), ((3, 9), 9), ((10, 17), 13)], [((1, 2), 6), ((3, 9), 9), ((10, 17), 11)]),
    "vit_k_ug": ("AI", _s(12, 20, 30, 45, 65), None),
    "riboflavin_mg": ("PRI", _s(0.6, 0.7, 1.0, 1.4, 1.6), None),
    "vit_b6_mg": ("PRI", _s(0.6, 0.7, 1.0, 1.4, 1.7), _s(0.6, 0.7, 1.0, 1.4, 1.6)),
    "folate_ug": ("PRI", _s(120, 140, 200, 270, 330), None),
    "vit_b12_ug": ("AI", _s(1.5, 1.5, 2.5, 3.5, 4.0), None),
    "pantothenic_mg": ("AI", _s(4, 4, 4, 5, 5), None),
    "choline_mg": ("AI", _s(140, 170, 250, 340, 400), None),
    "biotin_ug": ("AI", _s(20, 25, 25, 35, 35), None),
}
CHILD_NOTE = ("These are EFSA's age-specific values for healthy children and adolescents. They are a reference, not a growth chart, and not advice about weight; "
              "questions about a child's eating, growth or weight belong with a doctor or dietitian.")

# --------------------------------------------------------------------------------------------------------------
# Tolerable upper intake levels (EFSA/SCF overview, version 11, August 2025). Tables 1-3 of that document.
# kind "UL": an upper level. kind "safe": a "safe level of intake", used where the data were too thin for a UL; going above it does
# not by itself mean harm. scope says what the number covers, which decides whether it can be compared with logged food.
# --------------------------------------------------------------------------------------------------------------
_UB = ((1, 3), (4, 6), (7, 10), (11, 14), (15, 17), (18, 150))


def _u(*values):
    """The six age bands EFSA prints for most nutrients (1-3, 4-6, 7-10, 11-14, 15-17, adults); None = not defined (ND) or no value."""
    return [(b, v) for b, v in zip(_UB, values) if v is not None]


_TOTAL = "Total usual daily intake from food, drinks and supplements. Supplements are not logged here, so this checks food only."
UPPER_LEVELS = {
    "calcium_mg": ("UL", "total", _u(None, None, None, None, None, 2500), _TOTAL + " EFSA sets no level for children."),
    "copper_mg": ("UL", "total", _u(1, 2, 3, 4, 4, 5), _TOTAL),
    "iodine_ug": ("UL", "total", _u(200, 250, 300, 450, 500, 600), _TOTAL),
    "selenium_ug": ("UL", "total", _u(70, 95, 130, 180, 230, 255), _TOTAL),
    "zinc_mg": ("UL", "total", _u(7, 10, 13, 18, 22, 25), _TOTAL),
    "vit_d_ug": ("UL", "total", _u(50, 50, 50, 100, 100, 100), _TOTAL),
    "vit_b6_mg": ("UL", "total", _u(3.2, 4.5, 6.1, 8.6, 10.7, 12), _TOTAL),
    "vit_e_mg": ("UL", "total", _u(100, 120, 160, 220, 260, 300), _TOTAL + " EFSA notes a review of this level is ongoing."),
    "magnesium_mg": ("UL", "added", _u(None, 250, 250, 250, 250, 250),
                     "EFSA's level covers magnesium from supplements, added to food or in water, and excludes magnesium naturally in food and drink, so it cannot be checked against what you log."),
    "folate_ug": ("UL", "added", _u(200, 300, 400, 600, 800, 1000),
                  "EFSA's level covers folic acid and similar forms added to food or taken as supplements, and excludes folate naturally in food, so it cannot be checked against what you log."),
    "vit_a_ug": ("UL", "preformed", _u(800, 1100, 1500, 2000, 2600, 3000),
                 "EFSA's level covers preformed vitamin A (retinol and retinyl esters). Food data here are retinol activity equivalents, which also count carotenoids, so the two cannot be compared."),
    "niacin_mg": ("UL", "forms", _u(150, 220, 350, 500, 700, 900),
                  "EFSA gives separate levels for nicotinamide (shown) and nicotinic acid (adults 10 mg a day). Food data list niacin as one number, so this cannot be checked against what you log."),
    "iron_mg": ("safe", "total", _u(10, 15, 20, 30, 35, 40),
                "EFSA found too little data for an upper level and gives a safe level of intake instead. Going above it does not by itself mean harm."),
    "manganese_mg": ("safe", "total", [((1, 2), 4), ((3, 6), 5), ((7, 13), 6), ((14, 17), 7), ((18, 150), 8)],
                     "EFSA found too little data for an upper level and gives a safe level of intake instead. Going above it does not by itself mean harm."),
}
_NO_DATA = "EFSA found too little data to set an upper level."
NO_UPPER_LEVEL = {k: _NO_DATA for k in ("vit_c_mg", "vit_k_ug", "thiamin_mg", "riboflavin_mg", "biotin_ug", "pantothenic_mg", "phosphorus_mg", "potassium_mg", "sodium_mg",
                                         "fat_g", "sat_fat_g", "protein_g", "sugars_g", "epa_dha_mg")}
NO_UPPER_LEVEL["vit_b12_ug"] = "EFSA found no adverse effects from high intakes of vitamin B12 and set no upper level."
UPPER_LABEL = {"UL": "Tolerable upper intake level", "safe": "Safe level of intake", "none": "No upper level"}


def upper_level_for(key: str, age: Optional[int]) -> Optional[dict]:
    """EFSA's upper level (or safe level) for one nutrient at this age. Unknown age = adult. None when EFSA gives nothing for the nutrient."""
    unit = BY_KEY[key]["unit"] if key in BY_KEY else ""
    if key in UPPER_LEVELS:
        kind, scope, bands, basis = UPPER_LEVELS[key]
        years = 18 if age is None else age
        value = next((v for (lo, hi), v in bands if lo <= years <= hi), None)
        if value is None:
            return {"kind": "none", "value": None, "unit": unit, "scope": scope, "comparable": False, "source": "efsa_ul",
                    "basis": "EFSA gives no upper level for this age." if age is not None and age >= 1 else _NO_DATA}
        return {"kind": kind, "value": value, "unit": unit, "scope": scope, "comparable": scope == "total", "source": "efsa_ul", "basis": basis}
    if key in NO_UPPER_LEVEL:
        return {"kind": "none", "value": None, "unit": unit, "scope": "none", "comparable": False, "source": "efsa_ul", "basis": NO_UPPER_LEVEL[key]}
    return None


def age_from_birth_year(birth_year: Optional[int], today_year: int) -> Optional[int]:
    return today_year - birth_year if birth_year else None


def _in_band(age: int, bands: list) -> Optional[float]:
    return next((v for (lo, hi), v in bands if lo <= age <= hi), None)


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
        return _reference_child(age, sex, status, p.get("activity"), weight_kg)
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
                                          + (", plus pregnancy/lactation allowance" if status in PREGNANCY_ENERGY_MJ and sex == "F" else "") + ".")
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
    _attach_upper_levels(items, age)
    return {"personalised": personalised, "supported": True, "basis": basis, "energy_kcal": energy, "items": items, "notes": notes,
            "sources": [SOURCES["efsa2017"], SOURCES["efsa_ul"], SOURCES["who2026"]] + ([SOURCES["eu1169"]] if basis == "eu1169" else [])}


def _attach_upper_levels(items: Dict[str, dict], age: Optional[int]) -> None:
    """Put EFSA's upper (or safe) level on each item that has one; an unknown age gets the adult level."""
    for key, item in items.items():
        upper = upper_level_for(key, age)
        if upper:
            item["upper"] = upper


def _unsupported(note: str) -> dict:
    return {"personalised": False, "supported": False, "basis": "none", "energy_kcal": None, "items": {}, "sources": [], "notes": [note]}


def _reference_child(age: int, sex: Optional[str], status: Optional[str], activity: Optional[str], weight_kg: Optional[float]) -> dict:
    """EFSA reference values for 1-17 year olds. Anything EFSA does not publish for this person is left out, never estimated."""
    if age < CHILD_AGES[0]:
        return _unsupported("EFSA's reference values start at 1 year of age. For babies, ask a doctor or health visitor; you can still log food and set your own targets.")
    if status:
        return _unsupported("EFSA's pregnancy and breastfeeding values are for adult women. Please ask a doctor or midwife for advice; you can still log food and set your own targets.")
    if sex not in ("M", "F"):
        return _unsupported("EFSA's tables for children are separate for girls and boys. Set sex to F or M in your details to see values for your age; you can still log food and set your own targets.")
    i = 0 if sex == "M" else 1
    notes = [CHILD_NOTE, "Age is worked out from the birth year alone, so it can be a year out; around a birthday the neighbouring age may fit better."]
    items: Dict[str, dict] = {}

    # ---- energy: the PAL levels EFSA gives depend on age, so the nearest one to the chosen activity level is used
    levels = next(v for r, v in CHILD_PAL_LEVELS.items() if age in r)
    chosen = activity if activity in PAL else DEFAULT_ACTIVITY
    wanted = PAL[chosen][1]
    pick = min(range(len(levels)), key=lambda k: (abs(levels[k] - wanted), k))
    if not activity:
        notes.append("Activity level not set; moderately active (PAL 1.6) is assumed.")
    if levels[pick] != wanted:
        notes.append(f"For age {age} EFSA gives energy at PAL {', '.join(f'{x:g}' for x in levels)} only, so PAL {levels[pick]:g} is used.")
    mj = CHILD_ENERGY_AR_MJ[age][i][pick]
    energy = round(mj * KCAL_PER_MJ / 10) * 10
    items["energy_kcal"] = _item("AR", "efsa2017", "kcal", target=energy,
                                 note=f"EFSA average requirement for a {age} year old {'boy' if sex == 'M' else 'girl'}, PAL {levels[pick]:g}.")

    # ---- macronutrients
    fat_lo, fat_hi = _in_band(age, CHILD_FAT_PCT)
    items["carbs_available_g"] = _item("RI", "efsa2017", "g", minimum=round(0.45 * energy / 4), target=round(0.50 * energy / 4), maximum=round(0.60 * energy / 4),
                                       note="EFSA: 45-60% of energy from carbohydrate (excluding fibre). Target shown is the 50% point.")
    fat_mid = (fat_lo + fat_hi) / 2 if fat_lo >= 35 else 30
    items["fat_g"] = _item("RI", "efsa2017", "g", minimum=round(fat_lo / 100 * energy / 9), target=round(fat_mid / 100 * energy / 9), maximum=round(fat_hi / 100 * energy / 9),
                           note=f"EFSA: {fat_lo}-{fat_hi}% of energy from total fat. Target shown is the {fat_mid:g}% point.")
    items["fiber_g"] = _item("AI", "efsa2017", "g", target=_in_band(age, CHILD_FIBRE_G), note="EFSA adequate intake for this age.")
    items["la_g"] = _item("AI", "efsa2017", "g", target=round(0.04 * energy / 9, 1), note="EFSA: 4% of energy.")
    items["ala_g"] = _item("AI", "efsa2017", "g", target=round(0.005 * energy / 9, 1), note="EFSA: 0.5% of energy.")
    if age >= 2:
        items["epa_dha_mg"] = _item("AI", "efsa2017", "mg", target=250, note="EFSA: 250 mg/day combined EPA and DHA.")
    else:
        notes.append("At 1 year EFSA gives a DHA value (100 mg) but no EPA+DHA value, so no omega-3 fish-fat target is shown.")
    if weight_kg:
        items["protein_g"] = _item("PRI", "efsa2017", "g", target=round(CHILD_PROTEIN_PRI[age][i] * weight_kg),
                                   note=f"EFSA PRI {CHILD_PROTEIN_PRI[age][i]:g} g per kg body weight at age {age}, for {weight_kg:g} kg.")
    else:
        notes.append("Body weight is needed for the protein target (EFSA gives it per kg). Add it in your details or log a weigh-in.")
    water_boys, water_girls = _in_band(age, CHILD_WATER_L)
    items["water_ml"] = _item("AI", "efsa2017", "ml", target=int(round((water_boys, water_girls)[i] * 1000)),
                              note="EFSA adequate intake of TOTAL water (drinks plus water in food)." + (" EFSA gives 1.1-1.2 L at this age; the lower value is used." if age == 1 else ""))

    # ---- vitamins and minerals
    mj_e = energy / KCAL_PER_MJ
    micro_notes = {**NUTRIENT_NOTES, "iron_mg": "EFSA's iron value for girls is higher from age 12." if (sex == "F" and age >= 12) else "",
                   "zinc_mg": "EFSA does not adjust children's zinc values for phytate intake."}
    for key, (kind, boys, girls) in CHILD_MICRO.items():
        value = _in_band(age, boys if (i == 0 or girls is None) else girls)
        items[key] = _item(kind, "efsa2017", BY_KEY[key]["unit"], target=value, note=micro_notes.get(key, ""))
    for key, (kind, per_mj) in PER_MJ.items():
        items[key] = _item(kind, "efsa2017", BY_KEY[key]["unit"], target=round(per_mj * mj_e, 1), note=f"EFSA: {per_mj} per MJ of energy ({mj_e:.1f} MJ).  " + micro_notes.get(key, ""))
    notes.append("Guideline limits for saturated fat, sugar and sodium come from WHO's adult advice and are not applied to children.")
    _attach_upper_levels(items, age)
    return {"personalised": True, "supported": True, "basis": "efsa2017", "energy_kcal": energy, "items": items, "notes": notes,
            "sources": [SOURCES["efsa2017"], SOURCES["efsa_ul"]]}
