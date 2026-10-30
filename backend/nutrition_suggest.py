"""What could I eat? Explainable ranking of things the person already uses (recipes, favourites, recent foods) against what is
left of today's targets. Pure functions: no database, no network.

Rules (each one is also what the person is told in `why`):
- A suggestion must fit the energy left for the meal and help with at least one nutrient the day still needs.
- Credit is given only for nutrients the food REPORTS. A missing value earns nothing and is listed as unknown, never read as zero.
- Nutrients with a guideline limit (sodium, saturated fat, sugars) are watched: going past the room left is penalised and shown.
- Recipes that can be cooked with the kitchen's stock rank higher, so do ones that use food about to expire; missing ingredients cost a little.
- Something eaten today or in the last two days ranks lower, so suggestions do not repeat the same food.
"""
from typing import Dict, Iterable, List, Optional

from nutrition_data import BY_KEY

MEAL_SHARE = {"breakfast": 0.25, "lunch": 0.35, "dinner": 0.30, "snack": 0.10, "other": 0.15}
DEFAULT_FOCUS = ("protein_g", "fiber_g")
GAP_BELOW = 0.6          # a nutrient under 60% of its target (with data) is a gap worth focusing on
MAX_FOCUS = 4
TOO_BIG = 1.25           # a portion above this share of the meal budget is not suggested
W_BENEFIT, W_FIT = 0.55, 0.25


def _name(key: str) -> str:
    return (BY_KEY.get(key) or {}).get("name", key)


def _n(v: float) -> str:
    return f"{v:.3g}"


def build_context(progress: Dict[str, dict], energy_target: float, eaten_kcal: float, meal_type: str, focus: Optional[List[str]]) -> dict:
    """What is left of the day. `progress` is nutrition_calc.progress() for what has been eaten so far."""
    remaining_kcal = max(float(energy_target or 0) - float(eaten_kcal or 0), 0.0)
    budget = min(remaining_kcal, MEAL_SHARE.get(meal_type, MEAL_SHARE["other"]) * float(energy_target or 0)) if remaining_kcal > 0 else 0.0
    remaining: Dict[str, float] = {}
    headroom: Dict[str, float] = {}
    limit_max: Dict[str, float] = {}
    pct: Dict[str, float] = {}
    nodata = set()
    for key, p in progress.items():
        if key == "energy_kcal":
            continue
        have = p.get("intake")
        if p.get("status") == "no_data":
            nodata.add(key)
        used = have or 0.0
        if p.get("kind") == "limit" or (p.get("max") is not None and p.get("target") is None and p.get("min") is None):
            if p.get("max") is not None:
                headroom[key] = float(p["max"]) - used
                limit_max[key] = float(p["max"])
            continue
        need = p.get("target") if p.get("target") is not None else p.get("min")
        if need:
            remaining[key] = max(float(need) - used, 0.0)
            pct[key] = used / float(need)
    if focus:
        chosen = [k for k in dict.fromkeys(focus) if k in remaining]
    else:
        chosen = [k for k in DEFAULT_FOCUS if remaining.get(k, 0) > 0]
        gaps = sorted((k for k in remaining if k not in chosen and k not in nodata and pct[k] < GAP_BELOW and remaining[k] > 0), key=lambda k: pct[k])
        chosen = (chosen + gaps)[:MAX_FOCUS]
    return {"remaining_kcal": remaining_kcal, "budget_kcal": budget, "meal_type": meal_type, "energy_target": float(energy_target or 0),
            "remaining": remaining, "headroom": headroom, "limit_max": limit_max, "focus": chosen, "no_data": sorted(nodata)}


def _fit(kcal: float, budget: float) -> float:
    if kcal >= 0.5 * budget:
        return 1.0 if kcal <= budget else 1.0 - (kcal - budget) / (0.25 * budget) * 0.5
    return kcal / (0.5 * budget)   # a very small portion is less likely to be a meal


def score(c: dict, ctx: dict) -> Optional[dict]:
    """None when the candidate should not be suggested at all (no energy value, too big, or it helps with nothing)."""
    n = c.get("nutrients") or {}
    kcal, budget = n.get("energy_kcal"), ctx["budget_kcal"]
    if kcal is None or budget <= 0 or kcal > budget * TOO_BIG:
        return None
    active = [k for k in ctx["focus"] if ctx["remaining"].get(k, 0) > 0]
    covers, unknown = [], []
    for k in active:
        v = n.get(k)
        if v is None:
            unknown.append(k)
            continue
        share = min(v / ctx["remaining"][k], 1.0)
        if share > 0:
            covers.append({"nutrient": k, "name": _name(k), "amount": v, "unit": (BY_KEY.get(k) or {}).get("unit", ""),
                           "remaining": ctx["remaining"][k], "percent_of_remaining": round(share * 100, 1)})
    if not covers:
        return None
    covers.sort(key=lambda x: (-x["percent_of_remaining"], x["nutrient"]))
    benefit = sum(x["percent_of_remaining"] for x in covers) / 100.0 / len(active)
    fit = _fit(kcal, budget)
    watch, penalty = [], 0.0
    for k, head in ctx["headroom"].items():
        v = n.get(k)
        if v is None:
            continue
        room = max(head, 0.0)
        if v > room:
            watch.append({"nutrient": k, "name": _name(k), "amount": v, "unit": (BY_KEY.get(k) or {}).get("unit", ""), "headroom": head})
            penalty += 0.5 * min((v - room) / (ctx["limit_max"].get(k) or v), 1.0)
    bonus = 0.0
    p = c.get("pantry")
    if p:
        bonus += 0.12 if p.get("can_cook_now") else 0.0
        bonus += 0.08 * min(len(p.get("uses_expiring") or []), 2)
        bonus -= 0.03 * min(len(p.get("missing") or []), 5)
    d = c.get("eaten_days_ago")
    if d is not None:
        penalty += 0.25 if d <= 0 else 0.12 if d <= 2 else 0.0
    if c.get("quality") == "estimated":
        penalty += 0.03
    total = W_BENEFIT * benefit + W_FIT * fit + bonus - penalty
    return {"score": round(total, 4), "benefit": round(benefit, 4), "fit": round(fit, 4), "covers": covers, "watch": watch, "unknown": unknown}


def explain(c: dict, s: dict, ctx: dict) -> str:
    """One short paragraph of facts taken from the numbers above: why this is on the list."""
    parts = []
    top = s["covers"][:2]
    if top:
        first = f"Covers {top[0]['percent_of_remaining']:.0f}% of the {top[0]['name'].lower()} you have left ({_n(top[0]['remaining'])} {top[0]['unit']})"
        if len(top) > 1:
            first += f" and {top[1]['percent_of_remaining']:.0f}% of the {top[1]['name'].lower()} ({_n(top[1]['remaining'])} {top[1]['unit']})"
        parts.append(first + ".")
    kcal = c["nutrients"]["energy_kcal"]
    parts.append(f"About {kcal:.0f} kcal, which fits the roughly {ctx['budget_kcal']:.0f} kcal planned for {ctx['meal_type']}.")
    p = c.get("pantry")
    if p:
        if p.get("can_cook_now"):
            parts.append("You can cook it now with what is in your kitchen.")
        elif p.get("missing"):
            parts.append("You would need to buy: " + ", ".join(p["missing"][:4]) + ".")
        for e in (p.get("uses_expiring") or [])[:2]:
            days = e.get("expires_in")
            parts.append(f"Uses {e['name']}, which {'has expired' if days is not None and days < 0 else 'expires today' if days == 0 else f'expires in {days} day' + ('s' if days != 1 else '')}.")
    for w in s["watch"]:
        room = max(w["headroom"], 0.0)
        parts.append(f"Adds {_n(w['amount'])} {w['unit']} {w['name'].lower()}, with {_n(room)} {w['unit']} of room left under your limit.")
    if s["unknown"]:
        parts.append("No " + ", ".join(_name(k).lower() for k in s["unknown"]) + " data for this, so it is not counted.")
    parts.extend(c.get("flags") or [])
    if c.get("quality") == "estimated":
        parts.append("Some values are estimated.")
    return " ".join(parts)


def diagnose(candidates: Iterable[dict], ctx: dict) -> List[str]:
    """When little or nothing can be suggested, say WHY in terms of the person's own data (a recipe with no fibre value cannot help with fibre)."""
    pool = [c for c in candidates if c.get("nutrients")]
    if not pool:
        return []
    focus = [k for k in ctx["focus"] if ctx["remaining"].get(k, 0) > 0]
    names = " or ".join(_name(k).lower() for k in focus)
    no_energy = [c for c in pool if c["nutrients"].get("energy_kcal") is None]
    sized = [c for c in pool if c["nutrients"].get("energy_kcal") is not None]
    no_data = [c for c in sized if focus and all(c["nutrients"].get(k) is None for k in focus)]
    too_big = [c for c in sized if ctx["budget_kcal"] > 0 and c["nutrients"]["energy_kcal"] > ctx["budget_kcal"] * TOO_BIG]
    parts = []
    if no_data:
        parts.append(f"{len(no_data)} of your {len(pool)} saved recipes and foods report no {names} value, so they cannot count toward it")
    if too_big:
        parts.append(f"{len(too_big)} are larger than a meal at your energy reference")
    if no_energy:
        parts.append(f"{len(no_energy)} have no energy value")
    return ["Why so few: " + "; ".join(parts) + "."] if parts else []


def rank(candidates: Iterable[dict], ctx: dict, limit: int = 6) -> List[dict]:
    """Best first, one entry per food or recipe, independent of the order the candidates arrive in."""
    best: Dict[tuple, dict] = {}
    for c in candidates:
        s = score(c, ctx)
        if not s:
            continue
        key = (c["kind"], c["id"])
        item = {"kind": c["kind"], "id": c["id"], "name": c["name"], "portion": c.get("portion"), "nutrients": c["nutrients"], "quality": c.get("quality"),
                "pantry": c.get("pantry"), "flags": c.get("flags") or [], **s, "why": explain(c, s, ctx)}
        if key not in best or (item["score"], item["name"]) > (best[key]["score"], best[key]["name"]):
            best[key] = item
    return sorted(best.values(), key=lambda x: (-x["score"], x["name"], str(x["id"])))[:limit]
