"""Meal-plan generation: preview a week built from the person's own recipes and foods, then apply the items they keep.

POST /nutrition/plan/generate never writes anything: it returns a proposal with the reasons, the day totals against the references and a digest.
POST /nutrition/plan/bulk creates the chosen items as ordinary planned entries, all or nothing. Everything is scoped to the signed-in user.
"""
from datetime import date, timedelta
from types import SimpleNamespace
from typing import Dict, List, Literal, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import nutrition_calc as calc
import nutrition_planner as pl
import nutrition_suggest as sg
from models import Food, MealPlanEntry
from nutrition_api import DiaryBody, ValidDate
from nutrition_data import BY_KEY
from nutrition_plan_api import MAX_ENTRIES_PER_DAY, PLAN_KEYS

Slot = Literal["breakfast", "lunch", "dinner", "snack"]
MAX_BULK = 60


class GenerateBody(BaseModel):
    start: ValidDate
    days: int = Field(default=7, ge=1, le=14)
    slots: List[Slot] = Field(default=["breakfast", "lunch", "dinner"], min_length=1, max_length=4)
    focus: List[str] = Field(default=[], max_length=4)
    max_repeats: int = Field(default=2, ge=1, le=4)
    use_database_foods: bool = False

    @field_validator("slots")
    @classmethod
    def _unique(cls, v):
        return list(dict.fromkeys(v))


class BulkItem(BaseModel):
    date: ValidDate
    meal_type: Slot
    food_id: Optional[str] = Field(default=None, max_length=36)
    recipe_id: Optional[str] = Field(default=None, max_length=36)
    quantity: float = Field(..., gt=0, le=100000)
    unit: Optional[str] = Field(default=None, max_length=50)


class BulkBody(BaseModel):
    items: List[BulkItem] = Field(..., min_length=1, max_length=MAX_BULK)


def register(router, srv, nx, plan, suggest):
    get_user, get_db = srv.get_current_user, srv.get_db
    new_id, now_iso = srv.new_id, srv.now_iso

    async def generate(db, user: dict, body: GenerateBody) -> dict:
        uid = user["_id"]
        ref, prof, _, today = await nx.reference(db, uid)
        overrides = prof["target_overrides"]
        energy = (overrides.get("energy_kcal") or {}).get("target") or ref["items"].get("energy_kcal", {}).get("target")
        if not energy:
            raise HTTPException(422, "No energy reference is available yet, so a plan cannot be balanced.")
        bad = [k for k in body.focus if k not in BY_KEY]
        if bad:
            raise HTTPException(422, f"Unknown nutrient in focus: {bad[0]}.")
        base = sg.build_context(calc.progress({}, {}, 0, ref["items"], overrides), energy, 0.0, "other", body.focus or None)
        if not base["focus"]:
            raise HTTPException(422, "None of the chosen nutrients has a daily target to aim at. Pick protein, fibre or a vitamin or mineral.")
        start = date.fromisoformat(body.start)
        dates = [(start + timedelta(days=i)).isoformat() for i in range(body.days)]

        cands, excluded = await suggest.load_candidates(db, uid, prof, today)
        if body.use_database_foods:
            have = {(c["kind"], c["id"]) for c in cands}
            for k in base["focus"][:2]:
                tip = await nx.suggest_foods(db, k, base["remaining"].get(k) or None, prof, 12)
                ids = [t["food_id"] for t in tip]
                for f in (await db.execute(select(Food).where(Food.id.in_(ids or {""})))).scalars().all():
                    first = (f.portions or [None])[0]
                    c = suggest.food_candidate(f, 1.0, first["label"], None, discover=True) if first and first.get("grams", 0) >= 20 else suggest.food_candidate(f, 100.0, "g", None, discover=True)
                    if (c["kind"], c["id"]) not in have:
                        c["usual_meals"], c["flags"] = [], ["From the reference database, new to you."]
                        cands.append(c)
                        have.add((c["kind"], c["id"]))
        occupied = {(p.date, p.meal_type) for p in (await db.execute(select(MealPlanEntry).where(
            MealPlanEntry.user_id == uid, MealPlanEntry.date >= dates[0], MealPlanEntry.date <= dates[-1]))).scalars().all()}
        result = pl.plan_days(dates, cands, base, body.slots, body.max_repeats, occupied)

        focus_pct: Dict[str, List[float]] = {k: [] for k in base["focus"]}
        for d in result["days"]:
            s = calc.sum_nutrients([i["nutrients"] for i in d["items"]])
            prog = calc.progress(s["totals"], s["reported"], s["entries"], ref["items"], overrides) if d["items"] else {}
            d["totals"] = {k: round(v, 1) for k, v in s["totals"].items() if k in PLAN_KEYS or k in base["focus"]}
            d["progress"] = {k: {f: prog[k][f] for f in ("intake", "percent", "status", "unit")} for k in PLAN_KEYS if k in prog}
            for k in base["focus"]:
                if k in prog and prog[k]["percent"] is not None:
                    focus_pct[k].append(prog[k]["percent"])
        placed = sum(len(d["items"]) for d in result["days"])
        return {"start": dates[0], "end": dates[-1], "slots": body.slots, "days": result["days"], "notes": result["notes"], "digest": pl.digest(result),
                "placed": placed, "excluded_for_diet": excluded, "energy_target": energy,
                "focus": [{"nutrient": k, "name": BY_KEY[k]["name"], "unit": BY_KEY[k]["unit"], "target": base["remaining"][k],
                           "average_percent": round(sum(v) / len(v)) if v else None} for k, v in focus_pct.items()],
                "basis": "Built from your own recipes and foods only, with the energy and nutrient references you see on the Goals tab. Items already planned in these "
                         "slots are left alone. Only nutrients a food reports count. Reference values describe healthy adults and are not medical advice."}

    async def bulk_create(db, uid: str, items: List[BulkItem]) -> List[dict]:
        """All or nothing: either every item is planned, or none is."""
        per_day: Dict[str, int] = {}
        out = []
        for it in sorted(items, key=lambda x: (x.date, x.meal_type)):
            day = it.date
            if day not in per_day:
                per_day[day] = (await db.execute(select(func.count(MealPlanEntry.id)).where(MealPlanEntry.user_id == uid, MealPlanEntry.date == day))).scalar_one()
            if per_day[day] >= MAX_ENTRIES_PER_DAY:
                raise HTTPException(422, f"{day} already holds {MAX_ENTRIES_PER_DAY} planned items.")
            body = DiaryBody(food_id=it.food_id, recipe_id=it.recipe_id, quantity=it.quantity, unit=it.unit or ("serving" if it.recipe_id else "g"))
            e = await nx.build_entry(db, uid, body)
            p = MealPlanEntry(id=new_id(), user_id=uid, date=day, meal_type=it.meal_type, description=e["description"][:500], food_id=it.food_id, recipe_id=it.recipe_id,
                              quantity=it.quantity, unit=e["unit"], grams=e["grams"], nutrients=e["nutrients"], quality=e["quality"], entry_source=e["source"],
                              status="planned", created_at=now_iso(), updated_at=now_iso())
            db.add(p)
            per_day[day] += 1
            out.append(p)
        await db.commit()
        return [plan.plan_view(p) for p in out]

    @router.post("/nutrition/plan/generate")
    async def generate_route(body: GenerateBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        """Preview only: nothing is saved."""
        return {**(await generate(db, user, body)), "preview": True}

    @router.post("/nutrition/plan/bulk")
    async def bulk_route(body: BulkBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        created = await bulk_create(db, user["_id"], body.items)
        return {"created": len(created), "entries": created}

    return SimpleNamespace(generate=generate, bulk_create=bulk_create, GenerateBody=GenerateBody, BulkItem=BulkItem)
