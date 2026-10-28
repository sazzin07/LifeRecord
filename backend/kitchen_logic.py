"""Pure kitchen logic: unit conversion and matching recipes against inventory.

Kept free of database and web code so it is easy to test. Inventory items and recipes are plain dicts.
"""
from datetime import date
from typing import Dict, List, Optional

_EPS = 1e-6

# Units that can be converted into each other: unit -> (family, factor to the family's base unit).
_UNITS = {
    "g": ("mass", 1.0), "kg": ("mass", 1000.0),
    "ml": ("volume", 1.0), "l": ("volume", 1000.0),
}


def convert(quantity: float, from_unit: Optional[str], to_unit: Optional[str]) -> Optional[float]:
    """Convert between compatible units (g/kg, ml/L). Same unit passes through; incompatible gives None."""
    a, b = (from_unit or "unit").strip().lower(), (to_unit or "unit").strip().lower()
    if a == b:
        return quantity
    fa, fb = _UNITS.get(a), _UNITS.get(b)
    if fa and fb and fa[0] == fb[0]:
        return quantity * fa[1] / fb[1]
    return None


def _norm(name: str) -> str:
    n = (name or "").strip().lower()
    for suffix in ("ies", "es", "s"):
        if n.endswith(suffix) and len(n) > len(suffix) + 2:
            return n[: -len(suffix)] + ("y" if suffix == "ies" else "")
    return n


def find_item(ingredient_name: str, inventory: List[dict]) -> Optional[dict]:
    """Match an ingredient to an inventory item: exact name, then singular/plural, then 'cherry tomatoes' ~ 'tomatoes'."""
    want = (ingredient_name or "").strip().lower()
    if not want:
        return None
    for it in inventory:
        if it["name"].strip().lower() == want:
            return it
    wn = _norm(want)
    for it in inventory:
        if _norm(it["name"]) == wn:
            return it
    loose = [it for it in inventory if len(wn) >= 4 and (_norm(it["name"]).endswith(" " + wn) or wn.endswith(" " + _norm(it["name"])))]
    return loose[0] if len(loose) == 1 else None


def days_until(expiration: Optional[str], today: Optional[date] = None) -> Optional[int]:
    if not expiration:
        return None
    try:
        return (date.fromisoformat(expiration) - (today or date.today())).days
    except ValueError:
        return None


def evaluate_recipe(recipe: dict, inventory: List[dict], today: Optional[date] = None) -> dict:
    """Score one recipe against what is in stock.

    Each ingredient is 'ok' (enough in stock), 'short' (some, not enough), 'missing', or 'check_units'
    (we hold it but its unit cannot be compared with the recipe's, so we assume there is enough and say so).
    """
    ingredients: List[Dict] = []
    for ing in recipe.get("ingredients") or []:
        need = float(ing.get("quantity") or 0)
        unit = ing.get("unit") or "unit"
        item = find_item(ing["name"], inventory)
        stock = float(item["quantity"]) if item else 0.0
        row = {"name": ing["name"], "needed": need, "unit": unit, "item_id": item["id"] if item else None,
               "storage_location": item.get("storage_location") if item else None,
               "expires_in": days_until(item.get("expiration"), today) if item and stock > 0 else None}
        have: Optional[float] = convert(stock, item.get("unit"), unit) if item else 0.0
        if item and stock > 0 and have is None:
            row.update(status="check_units", have=None, shortfall=0.0)
        else:
            have = have or 0.0
            short = round(max(0.0, need - have), 3)
            row.update(have=round(have, 3), shortfall=short,
                       status="ok" if short <= _EPS else ("short" if have > _EPS else "missing"))
        ingredients.append(row)

    total = len(ingredients)
    covered = sum(1 for r in ingredients if r["status"] in ("ok", "check_units"))
    missing = [r for r in ingredients if r["status"] in ("short", "missing")]
    soon = [r for r in ingredients if r["status"] != "missing" and r["expires_in"] is not None and r["expires_in"] <= 3]
    coverage = round(covered / total * 100, 1) if total else 0.0
    can_cook = total > 0 and not missing
    # Cookable and waste-saving recipes first; every missing ingredient costs a little.
    score = coverage + 12 * len(soon) + (10 if can_cook else 0) - 2 * len(missing)
    return {
        "recipe": recipe, "coverage": coverage, "can_cook_now": can_cook, "ingredients": ingredients,
        "missing": [{"name": r["name"], "quantity": r["shortfall"] or r["needed"], "unit": r["unit"]} for r in missing],
        "uses_expiring": [{"name": r["name"], "expires_in": r["expires_in"]} for r in soon],
        "score": round(score, 1),
    }


def suggest(recipes: List[dict], inventory: List[dict], today: Optional[date] = None) -> List[dict]:
    """Recipes with at least one ingredient, best first (score, then fewest missing, then name)."""
    out = [evaluate_recipe(r, inventory, today) for r in recipes if r.get("ingredients")]
    out.sort(key=lambda e: (-e["score"], len(e["missing"]), e["recipe"]["name"].lower()))
    return out
