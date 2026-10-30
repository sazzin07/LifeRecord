"""Meal planning, shopping-list generation from a plan, and food swaps.

A plan entry says "I intend to eat this on that day". It lives in its own table so it never counts towards what was eaten;
logging it copies its nutrient snapshot into the diary and marks it logged. Everything is scoped to the signed-in user.
"""
from datetime import timedelta
from types import SimpleNamespace
from typing import Dict, List, Literal, Optional

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import kitchen_logic
import nutrition_calc as calc
from models import Food, Grocery, Meal, MealPlanEntry, Recipe, ShoppingList
from nutrition_api import DiaryBody, ISO_DATE, TIME_RE, ValidDate, valid_date
from nutrition_data import BY_KEY

MAX_PLAN_DAYS = 31
MAX_ENTRIES_PER_DAY = 40
MAX_COPY_ENTRIES = 200
# the numbers shown for a planned day: enough to judge it without sending all 41 nutrients for 31 days
PLAN_KEYS = ("energy_kcal", "protein_g", "carbs_available_g", "fat_g", "fiber_g", "sat_fat_g", "sugars_g", "sodium_mg")


class PlanBody(DiaryBody):
    note: Optional[str] = Field(default=None, max_length=500)


class PlanUpdate(BaseModel):
    date: Optional[ValidDate] = None
    meal_type: Optional[Literal["breakfast", "lunch", "dinner", "snack", "other"]] = None
    eaten_at: Optional[str] = Field(default=None, pattern=TIME_RE)
    quantity: Optional[float] = Field(default=None, gt=0, le=100000)
    unit: Optional[str] = Field(default=None, max_length=50)
    description: Optional[str] = Field(default=None, max_length=500)
    note: Optional[str] = Field(default=None, max_length=500)


class PlanLogBody(BaseModel):
    date: Optional[ValidDate] = None
    meal_type: Optional[Literal["breakfast", "lunch", "dinner", "snack", "other"]] = None
    eaten_at: Optional[str] = Field(default=None, pattern=TIME_RE)


class PlanCopyBody(BaseModel):
    from_start: ValidDate
    days: int = Field(default=1, ge=1, le=14)
    to_start: ValidDate
    meal_type: Optional[Literal["breakfast", "lunch", "dinner", "snack", "other"]] = None


class PlanShoppingBody(BaseModel):
    start: ValidDate
    end: ValidDate
    list_id: Optional[str] = Field(default=None, max_length=36)


def check_range(start: str, end: str, limit: int = MAX_PLAN_DAYS) -> None:
    span = (valid_date(end) - valid_date(start)).days
    if span < 0 or span >= limit:
        raise HTTPException(422, f"The range must run forwards and cover at most {limit} days.")


def register(router, srv, nx):
    get_user, get_db = srv.get_current_user, srv.get_db
    new_id, now_iso = srv.new_id, srv.now_iso

    def plan_view(p: MealPlanEntry) -> dict:
        return {"id": p.id, "date": p.date, "meal_type": p.meal_type or "other", "eaten_at": p.eaten_at, "description": p.description,
                "food_id": p.food_id, "recipe_id": p.recipe_id, "quantity": float(p.quantity) if p.quantity is not None else None,
                "unit": p.unit, "grams": float(p.grams) if p.grams is not None else None, "nutrients": p.nutrients or {},
                "quality": p.quality or "user", "source": p.entry_source, "note": p.note, "status": p.status or "planned",
                "meal_id": p.meal_id, "updated_at": p.updated_at or p.created_at}

    async def own_plan(db, uid, pid) -> MealPlanEntry:
        p = (await db.execute(select(MealPlanEntry).where(MealPlanEntry.id == pid, MealPlanEntry.user_id == uid))).scalar_one_or_none()
        if not p:
            raise HTTPException(404, "Plan entry not found")
        return p

    def day_block(day: str, entries: List[MealPlanEntry], ref: dict, overrides: dict) -> dict:
        views = [plan_view(p) for p in entries]
        s = calc.sum_nutrients([v["nutrients"] for v in views])
        prog = calc.progress(s["totals"], s["reported"], s["entries"], ref["items"], overrides) if ref.get("items") and views else {}
        energy_target = (overrides.get("energy_kcal") or {}).get("target") or ref["items"].get("energy_kcal", {}).get("target")
        return {"date": day, "entries": views, "totals": s["totals"], "macro_shares": calc.macro_shares(s["totals"]),
                "energy_target": energy_target,
                "progress": {k: {f: prog[k][f] for f in ("intake", "min", "target", "max", "percent", "status", "unit", "entries_reporting", "entries")}
                             for k in PLAN_KEYS if k in prog},
                "planned": sum(1 for v in views if v["status"] == "planned"), "logged": sum(1 for v in views if v["status"] == "logged")}

    @router.get("/nutrition/plan")
    async def get_plan(start: str = Query(..., pattern=ISO_DATE), end: str = Query(..., pattern=ISO_DATE),
                       user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        check_range(start, end)
        uid = user["_id"]
        ref, prof, _, today = await nx.reference(db, uid)
        rows = (await db.execute(select(MealPlanEntry).where(MealPlanEntry.user_id == uid, MealPlanEntry.date >= start, MealPlanEntry.date <= end)
                                 .order_by(MealPlanEntry.date, MealPlanEntry.eaten_at, MealPlanEntry.created_at))).scalars().all()
        by_day: Dict[str, list] = {}
        for p in rows:
            by_day.setdefault(p.date, []).append(p)
        days, d = [], valid_date(start)
        while d <= valid_date(end):
            days.append(day_block(d.isoformat(), by_day.get(d.isoformat(), []), ref, prof["target_overrides"]))
            d += timedelta(days=1)
        return {"start": start, "end": end, "today": today.isoformat(), "days": days, "basis": ref["basis"],
                "note": "Planned food is separate from your diary: it only counts once you log it."}

    @router.post("/nutrition/plan")
    async def add_plan(body: PlanBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        _, _, _, today = await nx.reference(db, uid)
        day = body.date or today.isoformat()
        n = (await db.execute(select(func.count(MealPlanEntry.id)).where(MealPlanEntry.user_id == uid, MealPlanEntry.date == day))).scalar_one()
        if n >= MAX_ENTRIES_PER_DAY:
            raise HTTPException(422, f"A day can hold at most {MAX_ENTRIES_PER_DAY} planned items.")
        e = await nx.build_entry(db, uid, body)
        p = MealPlanEntry(id=new_id(), user_id=uid, date=day, meal_type=body.meal_type, eaten_at=body.eaten_at, description=e["description"][:500],
                          food_id=body.food_id, recipe_id=body.recipe_id, quantity=body.quantity, unit=e["unit"], grams=e["grams"],
                          nutrients=e["nutrients"], quality=e["quality"], entry_source=e["source"], note=body.note, status="planned",
                          created_at=now_iso(), updated_at=now_iso())
        db.add(p)
        await db.commit()
        await db.refresh(p)
        return plan_view(p)

    @router.put("/nutrition/plan/{pid}")
    async def update_plan(pid: str, body: PlanUpdate, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        p = await own_plan(db, uid, pid)
        if p.status == "logged":
            raise HTTPException(409, "This item is already in your diary. Edit it there, or delete this plan entry.")
        for f in ("date", "meal_type", "eaten_at", "description", "note"):
            v = getattr(body, f)
            if v is not None:
                setattr(p, f, v)
        if body.quantity is not None or body.unit is not None:
            if p.food_id or p.recipe_id:
                e = await nx.build_entry(db, uid, DiaryBody(food_id=p.food_id, recipe_id=p.recipe_id, quantity=body.quantity or float(p.quantity or 1),
                                                           unit=body.unit or p.unit if p.food_id else None))
                p.quantity, p.unit, p.grams, p.quality, p.nutrients = body.quantity or p.quantity, e["unit"], e["grams"], e["quality"], e["nutrients"]
            else:
                raise HTTPException(422, "Quantity and unit only apply to foods and recipes.")
        p.updated_at = now_iso()
        await db.commit()
        await db.refresh(p)
        return plan_view(p)

    @router.delete("/nutrition/plan/{pid}")
    async def delete_plan(pid: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        r = await db.execute(delete(MealPlanEntry).where(MealPlanEntry.id == pid, MealPlanEntry.user_id == user["_id"]))
        await db.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Plan entry not found")
        return {"deleted": pid}

    async def log_plan_entry(db, uid, p: MealPlanEntry, body: PlanLogBody) -> dict:
        """Turn a plan entry into a diary entry using the nutrients saved when it was planned. Safe to repeat: only the request that
        flips the status from planned to logged creates the diary entry."""
        won = await db.execute(update(MealPlanEntry).where(MealPlanEntry.id == p.id, MealPlanEntry.user_id == uid, MealPlanEntry.status == "planned")
                               .values(status="logged", updated_at=now_iso()))
        if won.rowcount != 1:
            await db.rollback()
            await db.refresh(p)
            existing = (await db.execute(select(Meal).where(Meal.id == p.meal_id, Meal.user_id == uid))).scalar_one_or_none() if p.meal_id else None
            return {"duplicate": True, "plan": plan_view(p), "entry": nx.entry_view(existing) if existing else None}
        _, _, _, today = await nx.reference(db, uid)
        m = Meal(id=new_id(), user_id=uid, description=p.description, date=body.date or p.date or today.isoformat(), created_at=now_iso(), updated_at=now_iso(),
                 meal_type=body.meal_type or p.meal_type, eaten_at=body.eaten_at or p.eaten_at, food_id=p.food_id, recipe_id=p.recipe_id,
                 quantity=p.quantity, unit=p.unit, grams=p.grams, quality=p.quality, entry_source=p.entry_source, client_ref=f"plan:{p.id}")
        nx.apply_nutrients(m, dict(p.nutrients or {}))
        db.add(m)
        await db.execute(update(MealPlanEntry).where(MealPlanEntry.id == p.id).values(meal_id=m.id))
        await db.commit()
        await db.refresh(m)
        await db.refresh(p)
        return {"duplicate": False, "plan": plan_view(p), "entry": nx.entry_view(m)}

    @router.post("/nutrition/plan/{pid}/log")
    async def log_plan(pid: str, body: PlanLogBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        p = await own_plan(db, user["_id"], pid)
        return await log_plan_entry(db, user["_id"], p, body)

    @router.post("/nutrition/plan/copy")
    async def copy_plan(body: PlanCopyBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        """Repeat a day or a week of plans somewhere else (e.g. "next week the same as this week")."""
        uid = user["_id"]
        a, b = valid_date(body.from_start), valid_date(body.to_start)
        if a == b:
            raise HTTPException(422, "Choose a different start day to copy to.")
        end = (a + timedelta(days=body.days - 1)).isoformat()
        q = select(MealPlanEntry).where(MealPlanEntry.user_id == uid, MealPlanEntry.date >= body.from_start, MealPlanEntry.date <= end)
        if body.meal_type:
            q = q.where(MealPlanEntry.meal_type == body.meal_type)
        src = (await db.execute(q.order_by(MealPlanEntry.date, MealPlanEntry.eaten_at).limit(MAX_COPY_ENTRIES + 1))).scalars().all()
        if not src:
            raise HTTPException(404, "Nothing is planned in that range.")
        if len(src) > MAX_COPY_ENTRIES:
            raise HTTPException(422, f"That range has more than {MAX_COPY_ENTRIES} planned items; copy fewer days.")
        shift = b - a
        copies = []
        for s in src:
            p = MealPlanEntry(id=new_id(), user_id=uid, date=(valid_date(s.date) + shift).isoformat(), meal_type=s.meal_type, eaten_at=s.eaten_at,
                              description=s.description, food_id=s.food_id, recipe_id=s.recipe_id, quantity=s.quantity, unit=s.unit, grams=s.grams,
                              nutrients=s.nutrients, quality=s.quality, entry_source=s.entry_source, note=s.note, status="planned",
                              created_at=now_iso(), updated_at=now_iso())
            db.add(p)
            copies.append(p)
        await db.commit()
        return {"copied": len(copies), "entries": [plan_view(p) for p in copies]}

    @router.post("/nutrition/plan/shopping-list")
    async def plan_to_shopping_list(body: PlanShoppingBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        """Put what a plan needs, minus what is already in the kitchen, on a shopping list. Nothing is bought and inventory is untouched."""
        check_range(body.start, body.end)
        uid = user["_id"]
        if body.list_id:
            if not (await db.execute(select(ShoppingList.id).where(ShoppingList.id == body.list_id, ShoppingList.user_id == uid))).scalar_one_or_none():
                raise HTTPException(404, "List not found")
        entries = (await db.execute(select(MealPlanEntry).where(
            MealPlanEntry.user_id == uid, MealPlanEntry.date >= body.start, MealPlanEntry.date <= body.end, MealPlanEntry.status == "planned"))).scalars().all()
        recipes = {r.id: r for r in (await db.execute(select(Recipe).where(
            Recipe.user_id == uid, Recipe.id.in_({e.recipe_id for e in entries if e.recipe_id} or {""})))).scalars().all()}
        foods = {f.id: f for f in (await db.execute(select(Food).where(
            Food.id.in_({e.food_id for e in entries if e.food_id} or {""}), or_(Food.user_id == uid, Food.user_id.is_(None))))).scalars().all()}
        needs, skipped = [], []
        for e in entries:
            r = recipes.get(e.recipe_id) if e.recipe_id else None
            if r is not None:
                factor = float(e.quantity or 1) / max(int(r.servings or 1), 1)
                needs += [{"name": i["name"], "quantity": float(i.get("quantity") or 0) * factor, "unit": i.get("unit") or "unit"} for i in (r.ingredients or [])]
            elif e.food_id and e.food_id in foods and e.grams:
                needs.append({"name": calc.shopping_name(foods[e.food_id].name), "quantity": float(e.grams), "unit": "g"})
            else:
                skipped.append(e.description)  # typed-in entries, or a recipe/food that no longer exists: nothing to buy by name
        merged = calc.merge_needs(needs)
        stock = [srv.to_dict(g) for g in (await db.execute(select(Grocery).where(Grocery.user_id == uid))).scalars().all()]
        ev = kitchen_logic.evaluate_recipe({"name": "Meal plan", "ingredients": merged}, stock)
        lst = await srv.get_or_create_default_list(db, uid) if not body.list_id else None
        list_id = body.list_id or lst.id
        on_list = {n for n in (await db.execute(select(srv.ShoppingItem.name_lower).where(
            srv.ShoppingItem.user_id == uid, srv.ShoppingItem.list_id == list_id, srv.ShoppingItem.bought.is_(False)))).scalars().all()}
        added, already = [], []
        for m in ev["missing"]:
            if m["name"].lower() in on_list:
                already.append(m["name"])
                continue
            doc = await srv.add_shopping_item_doc(db, m["name"], m["quantity"], m["unit"], note=f"Meal plan {body.start} to {body.end}", user_id=uid, list_id=list_id)
            added.append({"id": doc["id"], "name": doc["name"], "quantity": float(doc["quantity"]), "unit": doc["unit"]})
        return {"list_id": list_id, "planned_items": len(entries), "added": added, "already_on_list": already,
                "in_stock": [r["name"] for r in ev["ingredients"] if r["status"] == "ok"],
                "units_not_comparable": [r["name"] for r in ev["ingredients"] if r["status"] == "check_units"],
                "skipped": skipped,
                "note": "Plain foods are listed by weight as eaten (cooked weights are usually higher than raw). Items already on the list are not "
                        "added twice, and nothing is marked as bought."}

    # ------------------------------------------------------------ swaps
    @router.get("/nutrition/foods/{fid}/swaps")
    async def food_swaps(fid: str, nutrient: str = Query(..., max_length=40), direction: Optional[Literal["lower", "higher"]] = None,
                         limit: int = Query(6, ge=1, le=20), user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        """Similar foods (same category, similar energy per 100 g) with less or more of one nutrient. Foods that do not report the nutrient are skipped."""
        if nutrient not in BY_KEY:
            raise HTTPException(404, "Unknown nutrient.")
        uid = user["_id"]
        f = await nx.visible_food(db, uid, fid)
        prof = nx.profile_dict(await nx.get_profile_row(db, uid))
        info = BY_KEY[nutrient]
        direction = direction or calc.swap_direction(nutrient)
        base = {"id": f.id, "name": f.name, "nutrients": f.nutrients or {}}
        if (f.nutrients or {}).get(nutrient) is None:
            return {"food": f.name, "nutrient": nutrient, "name": info["name"], "unit": info["unit"], "direction": direction, "swaps": [],
                    "note": f"{f.name} has no {info['name'].lower()} value in its source, so nothing can be compared."}
        q = select(Food).where(or_(Food.user_id == uid, Food.user_id.is_(None)), Food.id != f.id)
        q = q.where(Food.category == f.category) if f.category else q.where(Food.category.is_(None))
        cands = (await db.execute(q.limit(1500))).scalars().all()
        cands = [c for c in cands if not nx.food_flags(c, prof)]
        ranked = calc.rank_swaps(base, [{"id": c.id, "name": c.name, "nutrients": c.nutrients or {}} for c in cands], nutrient, direction, limit)
        by_id = {c.id: c for c in cands}
        favs = await nx.favorites_of(db, uid)
        out = [{**nx.food_summary(by_id[s["id"]], uid, favs), **{k: s[k] for k in ("per100", "original_per100", "change_pct", "energy_kcal")}} for s in ranked]
        return {"food": f.name, "nutrient": nutrient, "name": info["name"], "unit": info["unit"], "direction": direction,
                "original_per100": base["nutrients"].get(nutrient), "swaps": out,
                "note": "Compared per 100 g between foods of the same category with similar energy. Foods that clash with your diet or allergy words "
                        "(judged from names only) are left out. This is a comparison, not medical advice."}

    return SimpleNamespace(plan_view=plan_view, get_plan=get_plan, add_plan=add_plan, update_plan=update_plan, delete_plan=delete_plan,
                           log_plan=log_plan, copy_plan=copy_plan, plan_to_shopping_list=plan_to_shopping_list, food_swaps=food_swaps,
                           own_plan=own_plan, log_plan_entry=log_plan_entry)
