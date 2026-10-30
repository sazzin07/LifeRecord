"""Nutrient density, dietary variety and meal patterns from logged entries. Pure functions: no database, no network.

Everything here is arithmetic on what was logged and on the person's own reference values; nothing is judged against a new standard.
- Density compares what each calorie brought with what the reference asks per calorie (the reference amount divided by the reference energy).
  A nutrient is averaged only over the entries that REPORT it, and `coverage` says how much of the energy that was, so missing data is never read as low.
- Variety counts distinct foods and the everyday food groups that appeared, using the food's own category; entries that cannot be classified
  (typed-in meals, recipes with unlinked ingredients) are counted and reported as unclassified, not guessed.
- Patterns describe when and how much was logged. They do not say what is good or bad.
"""
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Dict, Iterable, List, Optional

from nutrition_data import BY_KEY

KEY_DENSITY = ["protein_g", "fiber_g", "calcium_mg", "iron_mg", "magnesium_mg", "potassium_mg", "zinc_mg", "vit_a_ug", "vit_c_mg", "vit_d_ug", "folate_ug", "vit_b12_ug"]
MIN_COVERAGE = 0.5
INDEX_CAP = 2.0          # one very rich nutrient cannot make a food look dense on its own
MIN_KEYS_FOR_FOOD = 5    # a food needs this many density nutrients reported before it is ranked
MIN_FOOD_KCAL = 20.0     # black tea and spices have almost no energy, so "per calorie" is meaningless for them

MAIN_GROUPS = ["Vegetables", "Fruits", "Legumes", "Grains and cereals", "Dairy and eggs", "Fish and seafood", "Meat and poultry", "Nuts and seeds"]
_CATEGORY_GROUP = {
    "Vegetables and Vegetable Products": "Vegetables", "Fruits and Fruit Juices": "Fruits", "Legumes and Legume Products": "Legumes",
    "Cereal Grains and Pasta": "Grains and cereals", "Breakfast Cereals": "Grains and cereals", "Baked Products": "Grains and cereals",
    "Dairy and Egg Products": "Dairy and eggs", "Finfish and Shellfish Products": "Fish and seafood",
    "Beef Products": "Meat and poultry", "Pork Products": "Meat and poultry", "Poultry Products": "Meat and poultry",
    "Lamb, Veal, and Game Products": "Meat and poultry", "Sausages and Luncheon Meats": "Meat and poultry", "Nut and Seed Products": "Nuts and seeds",
}
_NOT_EXPECTED = {"vegan": {"Dairy and eggs", "Fish and seafood", "Meat and poultry"}, "vegetarian": {"Fish and seafood", "Meat and poultry"}, "lactose-free": {"Dairy and eggs"}}


def groups_for_category(category: Optional[str]) -> List[str]:
    g = _CATEGORY_GROUP.get(category or "")
    return [g] if g else []


def _energy(e: dict) -> Optional[float]:
    return (e.get("nutrients") or {}).get("energy_kcal")


def _target(ref_items: dict, key: str) -> Optional[float]:
    r = ref_items.get(key) or {}
    return r.get("target") if r.get("target") else r.get("min")


# ---------------------------------------------------------------- nutrient density
def nutrient_density(entries: Iterable[dict], ref_items: dict, energy_target: float, keys: Iterable[str] = KEY_DENSITY, min_coverage: float = MIN_COVERAGE) -> List[dict]:
    """Per 1,000 kcal against the reference's own per-1,000-kcal amount. Lowest ratio first. Only nutrients with a target and at least one reporting entry."""
    entries = [e for e in entries if _energy(e)]
    total = sum(_energy(e) for e in entries)
    if not entries or total <= 0 or not energy_target:
        return []
    rows = []
    for k in keys:
        tgt = _target(ref_items, k)
        rep = [e for e in entries if k in e["nutrients"]]
        e_k = sum(_energy(e) for e in rep)
        if not tgt or e_k <= 0:
            continue
        per = sum(e["nutrients"][k] for e in rep) / e_k * 1000.0
        ref_per = tgt / energy_target * 1000.0
        cov = e_k / total
        rows.append({"nutrient": k, "name": BY_KEY[k]["name"], "unit": BY_KEY[k]["unit"], "per_1000_kcal": per, "reference_per_1000_kcal": ref_per,
                     "ratio": per / ref_per, "coverage": cov, "reliable": cov >= min_coverage})
    return sorted(rows, key=lambda r: (r["ratio"], r["nutrient"]))


def dense_foods(entries: Iterable[dict], ref_items: dict, energy_target: float, limit: int = 5) -> List[dict]:
    """Foods ranked by how rich they were per calorie across the density nutrients they report (each capped), best first. A food that reports
    too few of those nutrients is not ranked at all: it would only look good or bad because of what its source happens to list."""
    if not energy_target:
        return []
    acc: Dict[str, dict] = {}
    for e in entries:
        if not _energy(e):
            continue
        key = e.get("food_id") or e.get("recipe_id") or e["name"].lower()
        a = acc.setdefault(key, {"name": e["name"], "times": 0, "kcal": 0.0, "n": defaultdict(float)})
        a["times"] += 1
        a["kcal"] += _energy(e)
        for k, v in e["nutrients"].items():
            a["n"][k] += v
    out = []
    for a in acc.values():
        if a["kcal"] < MIN_FOOD_KCAL:
            continue
        ratios = []
        for k in KEY_DENSITY:
            tgt = _target(ref_items, k)
            if tgt and k in a["n"]:
                ratios.append(min((a["n"][k] / a["kcal"] * 1000.0) / (tgt / energy_target * 1000.0), INDEX_CAP))
        if len(ratios) >= MIN_KEYS_FOR_FOOD:
            out.append({"name": a["name"], "times": a["times"], "kcal": round(a["kcal"]), "nutrients_used": len(ratios), "index": round(sum(ratios) / len(ratios), 2)})
    return sorted(out, key=lambda r: (-r["index"], r["name"]))[:limit]


# ---------------------------------------------------------------- variety
def variety(entries: List[dict], diet_tags: Iterable[str], days_logged: int) -> dict:
    keys = [e.get("food_id") or e.get("recipe_id") or e["name"].lower() for e in entries]
    names = {}
    for e, k in zip(entries, keys):
        names.setdefault(k, e["name"])
    counts = Counter(keys)
    seen = sorted({g for e in entries for g in (e.get("groups") or [])})
    unexpected = set().union(*(_NOT_EXPECTED.get(t, set()) for t in diet_tags)) if diet_tags else set()
    unclassified = sum(1 for e in entries if not e.get("groups"))
    n = len(entries)
    return {"distinct_items": len(counts), "per_logged_day": (len(counts) / days_logged) if days_logged else None,
            "top": [{"name": names[k], "count": c, "share": c / n} for k, c in sorted(counts.items(), key=lambda kv: (-kv[1], names[kv[0]]))[:5]] if n else [],
            "groups_seen": seen, "groups_missing": [g for g in MAIN_GROUPS if g not in seen and g not in unexpected],
            "unclassified": unclassified, "classified_share": (1 - unclassified / n) if n else None}


# ---------------------------------------------------------------- meal patterns
def _median_time(times: List[str]) -> str:
    mins = sorted(int(t[:2]) * 60 + int(t[3:5]) for t in times)
    m = len(mins)
    mid = mins[m // 2] if m % 2 else round((mins[m // 2 - 1] + mins[m // 2]) / 2)
    return f"{mid // 60:02d}:{mid % 60:02d}"


def _streaks(logged: set, dates: List[str]):
    longest = run = 0
    prev = None
    for d in sorted(logged):
        cur = date.fromisoformat(d)
        run = run + 1 if prev and (cur - prev).days == 1 else 1
        longest, prev = max(longest, run), cur
    current = 0
    if dates:
        last = date.fromisoformat(dates[-1])
        start = last if dates[-1] in logged else last - timedelta(days=1)   # today may simply not be logged yet
        d = start
        while d.isoformat() in logged:
            current += 1
            d -= timedelta(days=1)
    return longest, current


def patterns(entries: List[dict], dates: List[str]) -> dict:
    by_day: Dict[str, float] = defaultdict(float)
    by_meal: Dict[str, float] = defaultdict(float)
    meal_days: Dict[str, set] = defaultdict(set)
    times: Dict[str, List[str]] = defaultdict(list)
    logged = set()
    for e in entries:
        logged.add(e["date"])
        meal_days[e["meal_type"]].add(e["date"])
        if e.get("eaten_at"):
            times[e["meal_type"]].append(e["eaten_at"])
        kcal = _energy(e)
        if kcal:
            by_day[e["date"]] += kcal
            by_meal[e["meal_type"]] += kcal
    total = sum(by_meal.values())
    weekday = [v for d, v in by_day.items() if date.fromisoformat(d).weekday() < 5]
    weekend = [v for d, v in by_day.items() if date.fromisoformat(d).weekday() >= 5]
    longest, current = _streaks(logged, dates)
    return {"days_in_range": len(dates), "days_logged": len(logged), "logged_share": (len(logged) / len(dates)) if dates else 0.0,
            "meal_share": {m: v / total for m, v in sorted(by_meal.items(), key=lambda kv: -kv[1])} if total else {},
            "meal_days": {m: len(meal_days.get(m, ())) for m in ("breakfast", "lunch", "dinner", "snack")},
            "typical_time": {m: _median_time(t) for m, t in times.items()},
            "entries_per_logged_day": (len(entries) / len(logged)) if logged else None,
            "longest_streak": longest, "current_streak": current, "last_logged": max(logged) if logged else None,
            "weekday_avg_kcal": (sum(weekday) / len(weekday)) if weekday else None, "weekend_avg_kcal": (sum(weekend) / len(weekend)) if weekend else None}


# ---------------------------------------------------------------- long trends: weekly and monthly buckets
BUCKET_KEYS = ("energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sat_fat_g", "sodium_mg")


def aggregate_series(series: List[dict], bucket: str) -> List[dict]:
    """Daily trend points -> weeks (Monday to Sunday) or calendar months. Each value is the average over the LOGGED days of the bucket that
    reported it, so a day with nothing logged is never a zero and a nutrient most entries lack is not halved. A bucket with no logged day is empty."""
    if bucket == "day":
        return series
    if bucket not in ("week", "month"):
        raise ValueError("bucket must be day, week or month")
    groups: Dict[str, List[dict]] = {}
    for p in series:
        d = date.fromisoformat(p["date"])
        start = d - timedelta(days=d.weekday()) if bucket == "week" else d.replace(day=1)
        groups.setdefault(start.isoformat(), []).append(p)
    out = []
    for start, pts in sorted(groups.items()):
        logged = [p for p in pts if p.get("logged")]
        row = {"date": start, "end": pts[-1]["date"], "days": len(pts), "days_logged": len(logged), "logged": bool(logged), "entries": sum(p.get("entries", 0) for p in pts),
               "drinks_ml": round(sum(p.get("drinks_ml", 0) for p in logged) / len(logged)) if logged else 0}
        if bucket == "week":
            row["end"] = (date.fromisoformat(start) + timedelta(days=6)).isoformat()
        for k in BUCKET_KEYS:
            vals = [p[k] for p in logged if p.get(k) is not None]
            row[k] = sum(vals) / len(vals) if vals else None
        out.append(row)
    return out
