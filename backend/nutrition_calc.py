"""Pure nutrition calculations (no database, no network). All inputs/outputs are plain dicts.

Conventions
- A food's `nutrients` hold amounts PER 100 g, keyed as in nutrition_data.NUTRIENTS. A key that is missing means "not
  reported by the source" and is never treated as zero.
- An entry's nutrients are ABSOLUTE amounts for what was eaten.
- Totals remember how many entries reported each nutrient, so the app can say "3 of 7 entries have no vitamin C data".
- Rounding happens only when presenting; sums keep full precision.
"""
import re
from typing import Dict, Iterable, List, Optional, Tuple

from nutrition_data import BY_KEY, derive

MASS_G = {"g": 1.0, "gram": 1.0, "grams": 1.0, "kg": 1000.0, "mg": 0.001, "oz": 28.3495, "lb": 453.592}
VOLUME_ML = {"ml": 1.0, "l": 1000.0, "cl": 10.0, "dl": 100.0}
LIQUID_WATER_PCT = 80.0  # a liquid must be at least this watery; it is then treated as about 1 g per ml (flagged approximate)
LIQUID_CATEGORIES = {"Beverages", "Soups, Sauces, and Gravies"}
LIQUID_WORDS = ("milk", "juice", "broth", "soup", "smoothie", "kefir", "drink", "tea", "coffee", "beer", "wine", "water")


def is_liquid(food: dict) -> bool:
    """A drink or soup: watery AND described as one. Leafy vegetables and fruit are watery too but have no usable density."""
    water = (food.get("nutrients") or {}).get("water_g")
    if water is None or water < LIQUID_WATER_PCT:
        return False
    if food.get("category") in LIQUID_CATEGORIES:
        return True
    first = (food.get("name") or "").lower().split(",")[0]
    words = {w.rstrip("s") for w in re.split(r"\W+", first) if w}  # whole words only: "watermelon" is not water
    return any(w in words for w in LIQUID_WORDS)

KCAL_PER_G = {"protein_g": 4.0, "fat_g": 9.0, "alcohol_g": 7.0}


class PortionError(ValueError):
    pass


def to_grams(food: dict, quantity: float, unit: str) -> Tuple[float, bool]:
    """(grams, approximate). `unit` is a mass/volume unit or one of the food's own portion labels ("1 cup")."""
    if quantity is None or quantity <= 0:
        raise PortionError("The quantity must be greater than zero.")
    u = (unit or "g").strip().lower()
    if u in MASS_G:
        return quantity * MASS_G[u], False
    for p in food.get("portions") or []:
        if p["label"].strip().lower() == u:
            return quantity * float(p["grams"]), False
    if u in VOLUME_ML:
        if is_liquid(food):
            return quantity * VOLUME_ML[u], True
        raise PortionError(f"'{unit}' cannot be converted for {food.get('name', 'this food')}: it has no known density. Use grams or one of its portions.")
    choices = ", ".join(["g", "kg", "oz", "lb"] + [p["label"] for p in (food.get("portions") or [])[:6]])
    raise PortionError(f"Unknown unit '{unit}'. Choose one of: {choices}.")


def scale(per100: Dict[str, float], grams: float) -> Dict[str, float]:
    return {k: v * grams / 100.0 for k, v in (per100 or {}).items() if v is not None}


def entry_from_food(food: dict, quantity: float, unit: str) -> dict:
    grams, approx = to_grams(food, quantity, unit)
    return {"grams": grams, "approximate": approx, "nutrients": scale(food.get("nutrients") or {}, grams)}


def quick_nutrients(calories=None, protein=None, carbs=None, fat=None) -> Dict[str, float]:
    """Nutrients of a manual entry: only the four numbers the person typed, nothing else is assumed."""
    out = {}
    for key, v in (("energy_kcal", calories), ("protein_g", protein), ("carbs_g", carbs), ("fat_g", fat)):
        if v is not None:
            out[key] = float(v)
    return out


def sum_nutrients(entries: Iterable[Dict[str, float]]) -> dict:
    """{"totals": {key: sum}, "reported": {key: n entries that reported it}, "entries": n}."""
    totals: Dict[str, float] = {}
    reported: Dict[str, int] = {}
    n = 0
    for e in entries:
        n += 1
        for k, v in (e or {}).items():
            totals[k] = totals.get(k, 0.0) + float(v)
            reported[k] = reported.get(k, 0) + 1
    return {"totals": totals, "reported": reported, "entries": n}


def energy_from_macros(n: Dict[str, float]) -> Optional[dict]:
    """Energy implied by the macronutrients (fibre at 2 kcal/g, other carbohydrate 4, protein 4, fat 9, alcohol 7) and how far
    it is from the listed energy. Label values and calculated values rarely match exactly; differences under about 10% are normal."""
    if "energy_kcal" not in n or not all(k in n for k in ("protein_g", "carbs_g", "fat_g")):
        return None
    fiber = n.get("fiber_g", 0.0)
    calc = 4 * n["protein_g"] + 4 * max(n["carbs_g"] - fiber, 0.0) + 2 * fiber + 9 * n["fat_g"] + 7 * n.get("alcohol_g", 0.0)
    listed = n["energy_kcal"]
    diff = (calc - listed) / listed * 100.0 if listed else None
    return {"calculated_kcal": calc, "listed_kcal": listed, "difference_pct": diff}


def macro_shares(n: Dict[str, float]) -> Optional[dict]:
    """Share of macro-derived energy from protein, carbohydrate (net of fibre, plus fibre at 2 kcal), fat and alcohol."""
    if not all(k in n for k in ("protein_g", "carbs_g", "fat_g")):
        return None
    fiber = n.get("fiber_g", 0.0)
    parts = {"protein": 4 * n["protein_g"], "carbs": 4 * max(n["carbs_g"] - fiber, 0.0) + 2 * fiber, "fat": 9 * n["fat_g"], "alcohol": 7 * n.get("alcohol_g", 0.0)}
    total = sum(parts.values())
    if total <= 0:
        return None
    return {k: v / total * 100.0 for k, v in parts.items()}


def combine_quality(qualities: Iterable[Optional[str]]) -> str:
    qs = {q for q in qualities if q}
    if not qs:
        return "user"
    return next(iter(qs)) if len(qs) == 1 else "mixed"


def recipe_totals(ingredients: List[dict], servings: int) -> dict:
    """Nutrients per serving from ingredients that carry `grams` and `food_nutrients` (per 100 g).
    Ingredients without nutrient data are listed in `missing` and do not count as zero."""
    servings = max(int(servings or 1), 1)
    parts, missing = [], []
    for ing in ingredients:
        if ing.get("grams") and ing.get("food_nutrients"):
            parts.append(scale(ing["food_nutrients"], float(ing["grams"])))
        else:
            missing.append(ing.get("name", "?"))
    s = sum_nutrients(parts)
    per_serving = {k: v / servings for k, v in s["totals"].items()}
    return {"per_serving": per_serving, "total": s["totals"], "linked": len(parts), "missing": missing,
            "complete": not missing and bool(parts)}


def progress(totals: dict, reported: dict, entries: int, items: Dict[str, dict], overrides: Optional[dict] = None) -> Dict[str, dict]:
    """Compare totals with reference items. User overrides replace the suggested min/target/max for that nutrient (never silently)."""
    n = derive(totals)
    out: Dict[str, dict] = {}
    for key, ref in items.items():
        if key == "water_ml":
            continue  # hydration is tracked separately
        ov = (overrides or {}).get(key) or {}
        lo = ov.get("min", ref.get("min")) if ov else ref.get("min")
        tgt = ov.get("target", ref.get("target")) if ov else ref.get("target")
        hi = ov.get("max", ref.get("max")) if ov else ref.get("max")
        info = BY_KEY.get(key) or {}
        have = key in n
        # the derived values depend on several nutrients; count entries that reported their basis
        basis = {"carbs_available_g": "carbs_g", "epa_dha_mg": "epa_g"}.get(key, key)
        got = reported.get(basis, 0)
        intake = n.get(key)
        status = "no_data"
        pct = None
        if have:
            if tgt:
                pct = intake / tgt * 100.0
            if lo is not None and hi is not None:
                status = "within" if lo <= intake <= hi else ("below" if intake < lo else "above")
            elif hi is not None and tgt is None:
                status = "over" if intake > hi else "under"
            elif tgt is not None:
                status = "met" if intake >= tgt else "below"
        out[key] = {"key": key, "intake": intake, "min": lo, "target": tgt, "max": hi, "percent": pct, "status": status,
                    "unit": ref.get("unit") or info.get("unit"), "kind": ref.get("kind"), "source": ref.get("source"),
                    "overridden": bool(ov), "note": ref.get("note", ""), "entries_reporting": got, "entries": entries,
                    "complete": entries > 0 and got == entries}
    return out
