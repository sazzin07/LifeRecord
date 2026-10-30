"""GET /api/nutrition/patterns: meal patterns, dietary variety and nutrient density over a period, with short insight cards that each state
the numbers behind them and what the data cannot say. Everything is scoped to the signed-in user.
"""
from datetime import timedelta
from types import SimpleNamespace
from typing import List, Optional

from fastapi import Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import nutrition_insights as ni
from models import Food, Meal, Recipe
from nutrition_api import ISO_DATE, valid_date

MIN_DAYS_FOR_INSIGHTS = 3
LOW_RATIO, RICH_RATIO = 0.7, 1.3
DOMINANT_MEAL, REPEAT_SHARE = 0.45, 0.20


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def _g(x: float) -> str:
    return f"{x:.3g}"


def build_insights(p: dict, v: dict, density: List[dict], diet_tags: List[str]) -> List[dict]:
    """Rule-based cards: {"id", "kind": positive|attention|info, "title", "why"}. Every number in `why` comes from the metrics above."""
    if p["days_logged"] < MIN_DAYS_FOR_INSIGHTS:
        return [{"id": "few-days", "kind": "info", "title": "Log a few more days",
                 "why": f"Only {p['days_logged']} of the last {p['days_in_range']} days have entries. Patterns and averages mean little before about {MIN_DAYS_FOR_INSIGHTS} logged days."}]
    out: List[dict] = []
    reliable = [r for r in density if r["reliable"]]
    for r in reliable[:2]:
        if r["ratio"] < LOW_RATIO:
            out.append({"id": f"density-low-{r['nutrient']}", "kind": "attention", "title": f"{r['name']} is on the low side for the energy you eat",
                        "why": f"{_g(r['per_1000_kcal'])} {r['unit']} per 1,000 kcal against about {_g(r['reference_per_1000_kcal'])} in your reference ({_pct(r['ratio'])}), from entries covering "
                               f"{_pct(r['coverage'])} of your energy. A low recorded density is not a deficiency."})
    for r in sorted((r for r in reliable if r["ratio"] >= RICH_RATIO), key=lambda r: -r["ratio"])[:2]:
        out.append({"id": f"density-rich-{r['nutrient']}", "kind": "positive", "title": f"{r['name']} is rich for the energy you eat",
                    "why": f"{_g(r['per_1000_kcal'])} {r['unit']} per 1,000 kcal against about {_g(r['reference_per_1000_kcal'])} in your reference ({_pct(r['ratio'])})."})
    unsure = [r["name"].lower() for r in density if not r["reliable"]][:4]
    if unsure:
        out.append({"id": "density-unsure", "kind": "info", "title": "Not enough data to judge some nutrients",
                    "why": f"Fewer than half of your entries report {', '.join(unsure)}, so their density is not judged. Foods from the database and recipes linked to foods report more."})
    if v["classified_share"] is not None and v["classified_share"] < 0.5:
        out.append({"id": "variety-unclassified", "kind": "info", "title": "Most entries cannot be sorted into food groups",
                    "why": f"{_pct(1 - v['classified_share'])} of entries are typed-in meals or recipes without linked ingredients, so variety cannot be judged. Choose foods from the database and link recipe ingredients."})
    elif v["groups_missing"]:
        out.append({"id": "variety-missing", "kind": "attention", "title": "No " + ", ".join(g.lower() for g in v["groups_missing"][:3]) + f" logged in the last {p['days_in_range']} days",
                    "why": f"{_pct(1 - v['classified_share'])} of entries could not be sorted into groups (typed-in meals, recipes without linked ingredients), so a group can be missing from the data rather than from your plate."
                           + (f" Your diet choices ({', '.join(diet_tags)}) are taken into account." if diet_tags else "")})
    if v["top"] and len(v["top"]) and v["top"][0]["share"] > REPEAT_SHARE and v["top"][0]["count"] >= 5:
        out.append({"id": "variety-repeat", "kind": "info", "title": f"{v['top'][0]['name']} makes up {_pct(v['top'][0]['share'])} of your entries",
                    "why": f"{v['top'][0]['count']} of your entries over {p['days_logged']} logged days. This is a description, not a verdict; some foods are staples."})
    top_meal = next(iter(p["meal_share"].items()), None)
    if top_meal and top_meal[0] != "other" and top_meal[1] > DOMINANT_MEAL:   # "other" only means no meal was chosen, which says nothing about eating patterns
        out.append({"id": "pattern-meal", "kind": "info", "title": f"{top_meal[0].capitalize()} provides {_pct(top_meal[1])} of the energy you logged",
                    "why": "Based on the entries that have an energy value. Entries typed in without calories are not counted."})
    if p["days_logged"] >= 5 and p["meal_days"]["breakfast"] < 0.5 * p["days_logged"]:
        out.append({"id": "pattern-breakfast", "kind": "info", "title": f"Breakfast is logged on {p['meal_days']['breakfast']} of {p['days_logged']} days",
                    "why": "If you eat breakfast but do not log it, your totals are lower than what you really ate."})
    if p["logged_share"] < 0.6:
        out.append({"id": "pattern-coverage", "kind": "info", "title": f"You logged {p['days_logged']} of the last {p['days_in_range']} days",
                    "why": "Averages use only the days with entries, so a day you did not log is not counted as zero, but gaps make any pattern less certain."})
    if p["current_streak"] >= 3:
        out.append({"id": "pattern-streak", "kind": "positive", "title": f"{p['current_streak']} days in a row", "why": f"Your longest run in this period is {p['longest_streak']} days."})
    return out


def register(router, srv, nx):
    get_user, get_db = srv.get_current_user, srv.get_db

    async def patterns(days: int = Query(30, ge=7, le=366), end: Optional[str] = Query(None, pattern=ISO_DATE), user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        ref, prof, _, today = await nx.reference(db, uid)
        last = valid_date(end) if end else today
        dates = [(last - timedelta(days=days - 1 - i)).isoformat() for i in range(days)]
        meals = (await db.execute(select(Meal).where(Meal.user_id == uid, Meal.date >= dates[0], Meal.date <= dates[-1]).order_by(Meal.date, Meal.created_at))).scalars().all()
        recipe_ids = {m.recipe_id for m in meals if m.recipe_id}
        recipes = {r.id: r for r in (await db.execute(select(Recipe).where(Recipe.user_id == uid, Recipe.id.in_(recipe_ids or {""})))).scalars().all()}
        food_ids = {m.food_id for m in meals if m.food_id} | {i["food_id"] for r in recipes.values() for i in (r.ingredients or []) if i.get("food_id")}
        category = {f.id: f.category for f in (await db.execute(select(Food.id, Food.category).where(Food.id.in_(food_ids or {""}), or_(Food.user_id == uid, Food.user_id.is_(None))))).all()}
        entries = []
        for m in meals:
            groups = ni.groups_for_category(category.get(m.food_id)) if m.food_id else []
            if m.recipe_id and m.recipe_id in recipes:
                groups = sorted({g for i in (recipes[m.recipe_id].ingredients or []) if i.get("food_id") for g in ni.groups_for_category(category.get(i["food_id"]))})
            entries.append({"date": m.date, "meal_type": m.meal_type or "other", "eaten_at": m.eaten_at, "name": m.description, "food_id": m.food_id, "recipe_id": m.recipe_id,
                            "groups": groups, "nutrients": nx.entry_nutrients(m)})
        overrides = prof["target_overrides"]
        energy = (overrides.get("energy_kcal") or {}).get("target") or ref["items"].get("energy_kcal", {}).get("target")
        items = {k: {**v, **{f: overrides[k][f] for f in ("min", "target", "max") if k in overrides and overrides[k].get(f) is not None}} for k, v in ref["items"].items()}
        pat = ni.patterns(entries, dates)
        var = ni.variety(entries, prof["diet_tags"], pat["days_logged"])
        dens = ni.nutrient_density(entries, items, energy) if energy else []
        return {"start": dates[0], "end": dates[-1], "days": days, "patterns": pat, "variety": var, "density": dens,
                "dense_foods": ni.dense_foods(entries, items, energy) if energy else [], "insights": build_insights(pat, var, dens, prof["diet_tags"]),
                "basis": "Calculated from your logged entries and your own reference values. Nutrient density compares what each 1,000 kcal brought with what your reference asks per "
                         "1,000 kcal, using only entries that report the nutrient. Food groups come from each food's database category. Descriptions, not medical advice."}

    router.add_api_route("/nutrition/patterns", patterns, methods=["GET"])
    return SimpleNamespace(patterns=patterns)
