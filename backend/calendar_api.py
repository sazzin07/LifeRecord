"""Calendar: everything with a date in one range, for the month/week grid.

Kinds: `task` (due date), `expiry` (food in stock that expires), `shopping` (when a recurring shopping list is
next due: last spawn + its interval, or today if it is overdue or was never spawned), `workout`, `weight`
(check-ins) and `meals` (one summary per day). Everything is scoped to the signed-in user.
"""
import calendar
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Grocery, Meal, RecurringList, Task, WeightEntry, Workout

MAX_DAYS = 100
ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"
INTERVAL_DAYS = {"weekly": 7, "biweekly": 14}


def next_shopping_date(last_spawned_at, schedule: str, today: date) -> date:
    if not last_spawned_at:
        return today
    last = datetime.fromisoformat(last_spawned_at[:10]).date()
    if schedule == "monthly":
        year, month = (last.year + 1, 1) if last.month == 12 else (last.year, last.month + 1)
        nxt = date(year, month, min(last.day, calendar.monthrange(year, month)[1]))
    else:
        nxt = last + timedelta(days=INTERVAL_DAYS.get(schedule, 7))
    return max(nxt, today)


def register(router, srv):
    get_user, get_db = srv.get_current_user, srv.get_db

    @router.get("/calendar")
    async def calendar_events(start: str = Query(..., pattern=ISO_DATE), end: str = Query(..., pattern=ISO_DATE),
                              user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        try:
            d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
        except ValueError:
            raise HTTPException(422, "Invalid date")
        if d1 < d0 or (d1 - d0).days > MAX_DAYS:
            raise HTTPException(422, f"Range must run forwards and cover at most {MAX_DAYS} days")
        uid = user["_id"]
        today = date.today()
        out = []

        def in_range(col):
            return and_(col >= start, col <= end)

        for t in (await db.execute(select(Task).where(Task.user_id == uid, in_range(Task.due)))).scalars():
            out.append({"kind": "task", "id": t.id, "date": t.due, "title": t.title,
                        "meta": {"priority": t.priority, "done": t.done, "recurring": t.recurring}})

        for g in (await db.execute(select(Grocery).where(Grocery.user_id == uid, Grocery.quantity > 0,
                                                         in_range(Grocery.expiration)))).scalars():
            out.append({"kind": "expiry", "id": g.id, "date": g.expiration, "title": g.name,
                        "meta": {"storage_location": g.storage_location, "expired": g.expiration < today.isoformat()}})

        for r in (await db.execute(select(RecurringList).where(RecurringList.user_id == uid))).scalars():
            due = next_shopping_date(r.last_spawned_at, r.schedule, today)
            if d0 <= due <= d1:
                out.append({"kind": "shopping", "id": r.id, "date": due.isoformat(), "title": r.name,
                            "meta": {"schedule": r.schedule, "item_count": len(r.items or [])}})

        for w in (await db.execute(select(Workout).where(Workout.user_id == uid, in_range(Workout.date)))).scalars():
            out.append({"kind": "workout", "id": w.id, "date": w.date, "title": f"{w.type} workout",
                        "meta": {"type": w.type, "exercises": len(w.exercises or [])}})

        for w in (await db.execute(select(WeightEntry).where(WeightEntry.user_id == uid, in_range(WeightEntry.date)))).scalars():
            out.append({"kind": "weight", "id": w.id, "date": w.date, "title": f"{float(w.weight):g} kg",
                        "meta": {"weight": float(w.weight)}})

        meals = defaultdict(lambda: {"count": 0, "calories": 0.0})
        for m in (await db.execute(select(Meal).where(Meal.user_id == uid, in_range(Meal.date)))).scalars():
            meals[m.date]["count"] += 1
            meals[m.date]["calories"] += float(m.calories or 0)
        for day, s in meals.items():
            label = f"{s['count']} meal{'s' if s['count'] != 1 else ''}"
            if s["calories"]:
                label += f" · {round(s['calories']):,} kcal"
            out.append({"kind": "meals", "id": f"meals-{day}", "date": day, "title": label,
                        "meta": {"count": s["count"], "calories": round(s["calories"], 1)}})

        order = {"task": 0, "expiry": 1, "shopping": 2, "workout": 3, "weight": 4, "meals": 5}
        out.sort(key=lambda e: (e["date"], order[e["kind"]], e["title"].lower()))
        return {"start": start, "end": end, "events": out}
