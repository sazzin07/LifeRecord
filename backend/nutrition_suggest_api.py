"""GET /api/nutrition/suggestions: ideas for what to eat next, from what the person already uses, ranked by what is left of the day.

Candidates are the person's own recipes (with what the kitchen has in stock), favourite foods and recently logged foods, plus a few
foods that are new to them and rich in what is missing. Anything that clashes with their diet or allergy words is left out and counted,
never silently dropped. Everything is scoped to the signed-in user.
"""
from collections import Counter, defaultdict
from datetime import date, timedelta
from types import SimpleNamespace
from typing import Dict, List, Literal, Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import kitchen_logic
import nutrition_calc as calc
import nutrition_suggest as sg
from models import Food, FoodFavorite, Grocery, Meal, Recipe
from nutrition_api import ISO_DATE
from nutrition_data import BY_KEY, meta

SHOWN_KEYS = ("energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg")
RECENT_DAYS, VARIETY_DAYS, DISCOVER_NEW_DAYS = 60, 3, 14


def register(router, srv, nx):
    get_user, get_db = srv.get_current_user, srv.get_db

    def trim(nutrients: dict, extra=()) -> dict:
        keep = set(SHOWN_KEYS) | set(extra)
        return {k: round(v, 2) for k, v in nutrients.items() if k in keep}

    async def usual_meals(db, uid, day: date) -> Dict[str, List[str]]:
        """The meals each food or recipe is usually eaten at ("f:<id>" / "r:<id>" -> meal types), from the last two months of the diary."""
        since = (day - timedelta(days=RECENT_DAYS)).isoformat()
        rows = (await db.execute(select(Meal.food_id, Meal.recipe_id, Meal.meal_type).where(
            Meal.user_id == uid, Meal.date >= since, Meal.date <= day.isoformat(), or_(Meal.food_id.is_not(None), Meal.recipe_id.is_not(None))))).all()
        seen: Dict[str, Counter] = defaultdict(Counter)
        for fid, rid, mt in rows:
            if mt and mt != "other":
                seen[("f:" + fid) if fid else ("r:" + rid)][mt] += 1
        return {k: [t for t, n in c.most_common() if n >= max(1, 0.4 * c.most_common(1)[0][1])] for k, c in seen.items()}

    async def recipe_candidates(db, uid, prof, day: date, eaten: Dict[str, int]):
        recipes = (await db.execute(select(Recipe).where(Recipe.user_id == uid))).scalars().all()
        inventory = [srv.to_dict(g) for g in (await db.execute(select(Grocery).where(Grocery.user_id == uid))).scalars().all()]
        ids = {i["food_id"] for r in recipes for i in (r.ingredients or []) if i.get("food_id")}
        foods = {f.id: f for f in (await db.execute(select(Food).where(Food.id.in_(ids or {""}), or_(Food.user_id == uid, Food.user_id.is_(None))))).scalars().all()}
        out, excluded = [], 0
        for r in recipes:
            servings = max(int(r.servings or 1), 1)
            per = dict(r.nutrients or {})
            if not per and r.calories is not None:
                per = calc.quick_nutrients(float(r.calories) / servings, None if r.protein is None else float(r.protein) / servings,
                                           None if r.carbs is None else float(r.carbs) / servings, None if r.fat is None else float(r.fat) / servings)
            if not per:
                continue
            names = " ".join([r.name] + [i.get("name", "") for i in (r.ingredients or [])]).lower()
            hit = next((a for a in prof.get("allergies", []) if a and a in names), None)
            diet = [f for i in (r.ingredients or []) if i.get("food_id") in foods for f in nx.food_flags(foods[i["food_id"]], prof) if not f.startswith("Name contains")]
            if hit or diet:
                excluded += 1
                continue
            flags = []
            unlinked = [i for i in (r.ingredients or []) if not i.get("food_id")]
            if prof.get("diet_tags") and unlinked:
                flags.append(f"{len(unlinked)} ingredient{'s' if len(unlinked) != 1 else ''} not linked to a food, so not checked against your diet.")
            meta = r.nutrition_meta or {}
            if r.nutrients and meta.get("linked") and not meta.get("complete"):
                flags.append(f"Calculated from {meta['linked']} of {meta['total']} ingredients; the rest have no nutrient data.")
            pantry = None
            if r.ingredients:
                ev = kitchen_logic.evaluate_recipe(srv.to_dict(r), inventory, today=day)
                pantry = {"can_cook_now": ev["can_cook_now"], "missing": [m["name"] for m in ev["missing"]], "uses_expiring": ev["uses_expiring"]}
            out.append({"kind": "recipe", "id": r.id, "name": r.name, "nutrients": per, "portion": {"quantity": 1, "unit": "serving"},
                        "quality": "estimated" if (r.nutrients and meta.get("linked") and not meta.get("complete")) else (r.quality or "user"),
                        "pantry": pantry, "eaten_days_ago": eaten.get("r:" + r.id), "flags": flags,
                        "log": {"recipe_id": r.id, "quantity": 1, "unit": "serving"}})
        return out, excluded

    def food_candidate(f: Food, quantity: float, unit: str, eaten_days_ago: Optional[int], discover=False) -> Optional[dict]:
        spec = {"name": f.name, "category": f.category, "nutrients": f.nutrients, "portions": f.portions}
        try:
            e = calc.entry_from_food(spec, quantity, unit)
        except calc.PortionError:
            quantity, unit = 100.0, "g"
            e = calc.entry_from_food(spec, quantity, unit)
        label = f.name + (f" ({f.brand})" if f.brand else "")
        return {"kind": "food", "id": f.id, "name": label, "nutrients": e["nutrients"], "portion": {"quantity": quantity, "unit": unit, "grams": round(e["grams"], 1)},
                "quality": "estimated" if e["approximate"] else f.quality, "pantry": None, "eaten_days_ago": eaten_days_ago, "flags": [], "discover": discover,
                "log": {"food_id": f.id, "quantity": quantity, "unit": unit}}

    async def food_candidates(db, uid, prof, day: date):
        since = (day - timedelta(days=RECENT_DAYS)).isoformat()
        meals = (await db.execute(select(Meal).where(Meal.user_id == uid, Meal.date >= since, Meal.date <= day.isoformat())
                                  .order_by(Meal.date.desc(), Meal.created_at.desc()).limit(800))).scalars().all()
        last: Dict[str, Meal] = {}
        for m in meals:
            if m.food_id:
                last.setdefault(m.food_id, m)
        fav_ids = list((await db.execute(select(FoodFavorite.food_id).where(FoodFavorite.user_id == uid))).scalars().all())
        want = list(dict.fromkeys(list(last)[:30] + fav_ids))
        foods = {f.id: f for f in (await db.execute(select(Food).where(Food.id.in_(want or {""}), or_(Food.user_id == uid, Food.user_id.is_(None))))).scalars().all()}
        out, excluded = [], 0
        for fid in want:
            f = foods.get(fid)
            if not f:
                continue
            if nx.food_flags(f, prof):
                excluded += 1
                continue
            m = last.get(fid)
            days = (day - date.fromisoformat(m.date)).days if m else None
            qty, unit = (float(m.quantity), m.unit) if m and m.quantity and m.unit else (None, None)
            if qty is None:
                first = (f.portions or [None])[0]
                qty, unit = (1.0, first["label"]) if first else (100.0, "g")
            out.append(food_candidate(f, qty, unit, days))
        return out, excluded

    async def load_candidates(db, uid, prof, day: date, eaten: Optional[Dict[str, int]] = None):
        """Everything the person could be offered: their recipes, favourite and recent foods (diet and allergy words already applied).
        Returns (candidates, number left out for diet or allergy words)."""
        eaten = eaten or {}
        r_c, r_ex = await recipe_candidates(db, uid, prof, day, eaten)
        f_c, f_ex = await food_candidates(db, uid, prof, day)
        usual = await usual_meals(db, uid, day)
        for c in r_c + f_c:
            c["usual_meals"] = usual.get(("r:" if c["kind"] == "recipe" else "f:") + c["id"], [])
        return r_c + f_c, r_ex + f_ex

    @router.get("/nutrition/suggestions")
    async def suggestions(date_: Optional[str] = Query(None, alias="date", pattern=ISO_DATE), meal_type: Optional[Literal["breakfast", "lunch", "dinner", "snack", "other"]] = None,
                          focus: Optional[str] = Query(None, max_length=200), limit: int = Query(6, ge=1, le=12),
                          user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        d = await nx.get_day(date_=date_, user=user, db=db)
        day = date.fromisoformat(d["date"])
        _, prof, _, today = await nx.reference(db, uid)
        keys = [k.strip() for k in (focus or "").split(",") if k.strip()]
        if any(k not in BY_KEY for k in keys):
            raise HTTPException(422, "Unknown nutrient in focus.")
        slot = meal_type or (calc.default_meal_type(nx.local_now(prof).hour) if day == today else "other")
        if not d["energy_target"]:
            return {"date": d["date"], "meal_type": slot, "suggestions": [], "discover": [], "excluded_for_diet": 0, "context": None,
                    "note": "No energy reference is available yet, so there is nothing to compare with."}
        ctx = sg.build_context(d["progress"] or {}, d["energy_target"], d["totals"].get("energy_kcal", 0.0), slot, keys or None)
        context = {"energy_target": ctx["energy_target"], "remaining_kcal": round(ctx["remaining_kcal"]), "budget_kcal": round(ctx["budget_kcal"]), "meal_type": slot,
                   "focus": [{"nutrient": k, "name": meta(k)["name"], "unit": meta(k)["unit"], "remaining": round(ctx["remaining"][k], 1)} for k in ctx["focus"]],
                   "limits": [{"nutrient": k, "name": meta(k)["name"], "unit": meta(k)["unit"], "headroom": round(v, 1)} for k, v in ctx["headroom"].items()]}
        base = {"date": d["date"], "meal_type": slot, "context": context, "suggestions": [], "discover": [], "excluded_for_diet": 0}
        if ctx["remaining_kcal"] <= 0:
            return {**base, "note": "You have reached today's energy reference, so no suggestions are shown."}
        if not ctx["focus"]:
            return {**base, "note": "The nutrients on your focus list are already covered for today."}

        # what was eaten lately, in days before the viewed day (a recipe or food eaten today ranks lowest)
        recent = (await db.execute(select(Meal).where(Meal.user_id == uid, Meal.date >= (day - timedelta(days=VARIETY_DAYS)).isoformat(), Meal.date <= day.isoformat()))).scalars().all()
        eaten: Dict[str, int] = {}
        for m in recent:
            ago = (day - date.fromisoformat(m.date)).days
            for key in (("f:" + m.food_id) if m.food_id else None, ("r:" + m.recipe_id) if m.recipe_id else None):
                if key:
                    eaten[key] = min(ago, eaten.get(key, 99))
        r_c, r_ex = await recipe_candidates(db, uid, prof, day, eaten)
        f_c, f_ex = await food_candidates(db, uid, prof, day)
        for c in f_c:   # variety looks at the last few days only; older foods are fine to suggest again
            c["eaten_days_ago"] = eaten.get("f:" + c["id"])
        ranked = sg.rank(r_c + f_c, ctx, limit)

        # a few foods that are new to the person and rich in the top gaps (whole foods from the reference database)
        seen_ids = {c["id"] for c in f_c}
        known_recent = {m.food_id for m in (await db.execute(select(Meal).where(Meal.user_id == uid, Meal.food_id.is_not(None),
                                                                                  Meal.date >= (day - timedelta(days=DISCOVER_NEW_DAYS)).isoformat()))).scalars().all()}
        disc_pool: List[dict] = []
        for k in ctx["focus"][:2]:
            tip = await nx.suggest_foods(db, k, (ctx["remaining"][k] or None), prof, 10)
            fids = [t["food_id"] for t in tip if t["food_id"] not in seen_ids and t["food_id"] not in known_recent]
            for f in (await db.execute(select(Food).where(Food.id.in_(fids or {""})))).scalars().all():
                first = (f.portions or [None])[0]
                c = food_candidate(f, 1.0, first["label"], None, discover=True) if first and first.get("grams", 0) >= 20 else food_candidate(f, 100.0, "g", None, discover=True)
                disc_pool.append(c)
        discover = sg.rank(disc_pool, ctx, 4)
        for item in ranked + discover:
            c = next((x for x in r_c + f_c + disc_pool if x["kind"] == item["kind"] and x["id"] == item["id"]), None)
            item["log"] = c["log"] if c else None
            item["discover"] = bool(c and c.get("discover"))
            item["nutrients"] = trim(item["nutrients"], [x["nutrient"] for x in item["covers"]] + [w["nutrient"] for w in item["watch"]])
        note = None
        if not ranked and (r_c or f_c):
            note = " ".join(sg.diagnose(r_c + f_c, ctx)) or None
        if not r_c and not f_c:
            note = "Save recipes, star foods or log a few meals and your own ideas will appear here; meanwhile these foods are rich in what you still need."
        return {**base, "suggestions": ranked, "discover": discover, "excluded_for_diet": r_ex + f_ex, "note": note,
                "basis": "Ranked by how much of what you still need each portion covers, how well it fits the energy left for this meal, what your kitchen has, and "
                         "what you ate lately. Only nutrients a food reports count. Reference values describe healthy people of your age and are not medical advice."}

    return SimpleNamespace(suggestions=suggestions, load_candidates=load_candidates, food_candidate=food_candidate)
