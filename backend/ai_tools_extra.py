"""AI tools that cover the pages beyond money and groceries: tasks and calendar, people, categories,
fitness, body weight and recipe deletion, plus a one-call overview (food and nutrition tools live in ai_tools_nutrition).

Every handler reuses the REST endpoint functions in `server` (so validation, ownership and balance logic
live in one place) and is scoped to the signed-in user. Deletes go through the same two-step confirmation
gate as the other destructive tools. `srv` is the imported `server` module, passed in to avoid a circular
import.
"""
from datetime import date as _date
from typing import Optional

from sqlalchemy import select

from models import Category, DebtEntry, Meal, Person, Recipe, Task, WeightEntry, Workout


def _fn(name, description, props=None, required=None):
    params = {"type": "object", "properties": props or {}}
    if required:
        params["required"] = required
    return {"type": "function", "function": {"name": name, "description": description, "parameters": params}}


_S = {"type": "string"}
_N = {"type": "number"}
_B = {"type": "boolean"}
_CONFIRM = {"type": "boolean", "description": "Leave unset on the first call, which only previews. Set true on a later call, only after the user has explicitly agreed in their latest message to this exact deletion."}

EXTRA_TOOLS = [
    _fn("get_overview",
        "One-call snapshot of the user's day for the Home page: spendable money, this month's spending, open and overdue "
        "tasks, today's calories and macros, latest weight, who owes whom, and grocery items that are low or expiring. "
        "Use it for broad questions such as 'how am I doing' or 'what's going on today'."),
    _fn("get_transactions",
        "List transactions (id, date, merchant, category, amount, type) for a month (YYYY-MM) or date range, newest first. "
        "Optional text search over merchant, description and category, and an optional type filter. Use it to find a transaction "
        "before changing it, or to answer 'what did I spend on X'.",
        {"month": _S, "start": _S, "end": _S, "search": _S, "type": {"type": "string", "enum": ["expense", "income", "transfer"]},
         "limit": _N}),
    _fn("get_categories", "List spending categories with their monthly budgets."),
    _fn("create_category", "Create a spending category, optionally with a monthly budget.",
        {"name": _S, "monthly_budget": _N, "color": _S, "icon": _S}, ["name"]),
    _fn("update_category", "Rename a category or change its monthly budget.",
        {"category": _S, "new_name": _S, "monthly_budget": _N, "color": _S, "icon": _S}, ["category"]),
    _fn("delete_category", "Delete a category (preview first, then confirm).", {"category": _S, "confirm": _CONFIRM}, ["category"]),
    _fn("get_tasks",
        "List tasks and calendar reminders (a task's due date is its calendar entry). status: open, done, overdue or all. "
        "Optional due-date range and text search.",
        {"status": {"type": "string", "enum": ["open", "done", "overdue", "all"]}, "start": _S, "end": _S, "search": _S}),
    _fn("update_task", "Edit a task: rename, change priority (low, normal, high), set or clear the due date, set how it repeats, "
        "or mark done / not done. Completing a repeating task with a due date creates the next one. "
        "Identify it by task_id or by a title match.",
        {"task_id": _S, "match": _S, "title": _S, "priority": _S, "due": {"type": "string", "description": "YYYY-MM-DD, or empty string to clear"},
         "recurring": {"type": "string", "enum": ["", "daily", "weekly", "monthly"], "description": "Empty string = does not repeat"},
         "done": _B}),
    _fn("delete_task", "Delete a task (preview first, then confirm).", {"task_id": _S, "match": _S, "confirm": _CONFIRM}),
    _fn("update_person", "Rename a person or change their notes / payment preference.",
        {"person": _S, "new_name": _S, "notes": _S, "payment_preference": _S}, ["person"]),
    _fn("delete_person",
        "Delete a person (preview first, then confirm). They are archived, not erased: every record is kept and they can be restored. If they owe or are owed money the "
        "preview says how much and deleting clears it (no payment is recorded).",
        {"person": _S, "confirm": _CONFIRM}, ["person"]),
    _fn("delete_recipe", "Delete a saved recipe (preview first, then confirm).", {"recipe": _S, "confirm": _CONFIRM}, ["recipe"]),
    _fn("get_workouts", "List recent workouts with exercises, plus personal records.", {"limit": _N}),
    _fn("delete_workout", "Delete a workout by id (preview first, then confirm).", {"workout_id": _S, "confirm": _CONFIRM}, ["workout_id"]),
    _fn("get_weight_history", "List body-weight entries (oldest first) with the change since the first entry.", {"limit": _N}),
    _fn("delete_weight_entry", "Delete a weight entry by id (preview first, then confirm).", {"weight_id": _S, "confirm": _CONFIRM}, ["weight_id"]),
]

EXTRA_NAMES = {t["function"]["name"] for t in EXTRA_TOOLS}


def _eur(x) -> str:
    return f"€{float(x or 0):,.2f}"


async def _find_task(srv, db, user, args) -> Optional[Task]:
    q = select(Task).where(Task.user_id == user["_id"])
    if args.get("task_id"):
        return (await db.execute(q.where(Task.id == args["task_id"]))).scalar_one_or_none()
    m = (args.get("match") or "").strip()
    if not m:
        return None
    rows = (await db.execute(q.where(Task.title.ilike(f"%{m}%")).order_by(Task.done, Task.created_at.desc()))).scalars().all()
    return rows[0] if rows else None


async def _find_person(db, user, name) -> Optional[Person]:
    name = (name or "").strip().lower()
    if not name:
        return None
    return (await db.execute(select(Person).where(Person.user_id == user["_id"], Person.name_lower == name))).scalars().first() or \
        (await db.execute(select(Person).where(Person.user_id == user["_id"], Person.name_lower.like(f"%{name}%")))).scalars().first()


async def _find_category(db, user, name) -> Optional[Category]:
    name = (name or "").strip().lower()
    if not name:
        return None
    rows = (await db.execute(select(Category).where(Category.user_id == user["_id"]))).scalars().all()
    return next((c for c in rows if c.name.lower() == name), None) or next((c for c in rows if name in c.name.lower()), None)


async def _confirm(srv, db, user, session_id, previewed, tool, target_id, args, message):
    """None when the user already confirmed on an earlier turn, otherwise the needs_confirmation payload."""
    return await srv._confirmation_gate(db, user["_id"], session_id, previewed, tool, target_id, args.get("confirm"), message)


async def _overview(srv, db, user):
    accounts = await srv.get_accounts(user, db)
    today = _date.today().isoformat()
    month = today[:7]
    summary = await srv.analytics_summary(month=month, user=user, db=db)
    tasks = (await db.execute(select(Task).where(Task.user_id == user["_id"]))).scalars().all()
    open_t = [t for t in tasks if not t.done]
    _, _, _, nutrition_today = await srv.nutrition.reference(db, user["_id"])  # the person's own day, not the server's
    meals = (await db.execute(select(Meal).where(Meal.user_id == user["_id"], Meal.date == nutrition_today.isoformat()))).scalars().all()
    weight = (await db.execute(select(WeightEntry).where(WeightEntry.user_id == user["_id"]).order_by(WeightEntry.date.desc()))).scalars().first()
    people = await srv.people_balances(db, user["_id"])
    kitchen = await srv.kitchen_overview(db, user["_id"])
    return {
        "date": today,
        "money": {k: summary.get(k) for k in ("total_available", "cash_available", "revolut", "cash_locked", "revolut_locked",
                                              "actual_spending", "total_spent", "month_spending") if k in summary},
        "accounts": [{"name": a.get("name"), "type": a.get("type"), "balance": a.get("balance")} for a in accounts],
        "tasks": {"open": len(open_t), "overdue": len([t for t in open_t if t.due and t.due < today]),
                  "due_today": [t.title for t in open_t if t.due == today]},
        "nutrition_today": {"meals": len(meals), "calories": round(sum(m.calories or 0 for m in meals)),
                            "protein": round(sum(m.protein or 0 for m in meals)), "carbs": round(sum(m.carbs or 0 for m in meals)),
                            "fat": round(sum(m.fat or 0 for m in meals))},
        "latest_weight": {"weight": weight.weight, "date": weight.date} if weight else None,
        "people": [{"name": p.get("name"), "balance": p.get("balance")} for p in people if p.get("balance")],
        "groceries": {"expired": [i["name"] for i in kitchen["expired"]],
                      "expiring_within_3_days": [i["name"] for i in kitchen["expiring_within_3_days"]],
                      "low_or_out_of_stock": [i["name"] for i in kitchen["low_or_out_of_stock"]]},
    }


async def dispatch_extra(srv, db, name, args, created, user, session_id=None, previewed=None) -> dict:
    uid = user["_id"]

    if name == "get_overview":
        return await _overview(srv, db, user)

    if name == "get_transactions":
        rows = await srv.get_transactions(month=args.get("month"), start=args.get("start"), end=args.get("end"), user=user, db=db)
        if args.get("type"):
            rows = [r for r in rows if r.get("type") == args["type"]]
        s = (args.get("search") or "").strip().lower()
        if s:
            rows = [r for r in rows if s in " ".join(str(r.get(k) or "") for k in ("merchant", "description", "category")).lower()]
        limit = max(1, min(int(args.get("limit") or 25), 100))
        return {"count": len(rows), "transactions": [
            {k: r.get(k) for k in ("id", "date", "type", "merchant", "description", "category", "gross_amount", "personal_amount", "payment_method")}
            for r in rows[:limit]]}

    if name == "get_categories":
        return {"categories": [{"name": c["name"], "monthly_budget": c.get("monthly_budget")} for c in await srv.get_categories(user, db)]}
    if name == "create_category":
        c = await srv.create_category(srv.CategoryBody(**{k: v for k, v in args.items() if k in ("name", "monthly_budget", "color", "icon")}), user, db)
        created.append({"collection": "categories", "id": c["id"]})
        return c
    if name == "update_category":
        c = await _find_category(db, user, args.get("category"))
        if not c:
            return {"error": f"No category matching '{args.get('category')}'"}
        body = srv.CategoryBody(name=args.get("new_name") or c.name, icon=args.get("icon") or c.icon, color=args.get("color") or c.color,
                                monthly_budget=args["monthly_budget"] if "monthly_budget" in args else c.monthly_budget)
        srv.remember_before(created, "categories", c)
        return {"updated": await srv.update_category(c.id, body, user, db)}
    if name == "delete_category":
        c = await _find_category(db, user, args.get("category"))
        if not c:
            return {"error": f"No category matching '{args.get('category')}'"}
        gate = await _confirm(srv, db, user, session_id, previewed, name, c.id, args,
                        f"This will delete the category '{c.name}'. Existing transactions keep their category text. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "categories", c)
        await srv.delete_category(c.id, user, db)
        return {"deleted": c.name}

    if name == "get_tasks":
        today = _date.today().isoformat()
        status = args.get("status") or "open"
        rows = (await db.execute(select(Task).where(Task.user_id == uid).order_by(Task.due, Task.created_at.desc()))).scalars().all()
        s = (args.get("search") or "").strip().lower()
        out = []
        for t in rows:
            if status == "open" and t.done or status == "done" and not t.done:
                continue
            if status == "overdue" and (t.done or not t.due or t.due >= today):
                continue
            if args.get("start") and (not t.due or t.due < args["start"]):
                continue
            if args.get("end") and (not t.due or t.due > args["end"]):
                continue
            if s and s not in t.title.lower():
                continue
            out.append({"id": t.id, "title": t.title, "priority": t.priority, "due": t.due, "done": t.done,
                        "overdue": bool(t.due and not t.done and t.due < today), "recurring": t.recurring})
        return {"today": today, "count": len(out), "tasks": out[:100]}
    if name == "update_task":
        t = await _find_task(srv, db, user, args)
        if not t:
            return {"error": "No task found. Use get_tasks to find the task id."}
        body = srv.TaskBody(title=args.get("title") or t.title, priority=args.get("priority") or t.priority,
                            due=(args["due"] or None) if "due" in args else t.due,
                            recurring=(args["recurring"] or None) if "recurring" in args else t.recurring,
                            done=args["done"] if "done" in args else t.done)
        srv.remember_before(created, "tasks", t)
        res = await srv.update_task(t.id, body, user, db)
        if res.get("next_task_id"):  # completing a repeating task created the next one
            created.append({"collection": "tasks", "id": res["next_task_id"]})
        return {"updated": res}
    if name == "delete_task":
        t = await _find_task(srv, db, user, args)
        if not t:
            return {"error": "No task found. Use get_tasks to find the task id."}
        gate = await _confirm(srv, db, user, session_id, previewed, name, t.id, args, f"This will delete the task '{t.title}'. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "tasks", t)
        await srv.delete_task(t.id, user, db)
        return {"deleted": t.title}

    if name == "update_person":
        p = await _find_person(db, user, args.get("person"))
        if not p:
            return {"error": f"No person matching '{args.get('person')}'"}
        body = srv.PersonBody(name=args.get("new_name") or p.name, photo=p.photo,
                              notes=args["notes"] if "notes" in args else p.notes,
                              payment_preference=args["payment_preference"] if "payment_preference" in args else p.payment_preference)
        srv.remember_before(created, "people", p)
        return {"updated": await srv.update_person(p.id, body, user, db)}
    if name == "delete_person":
        p = await _find_person(db, user, args.get("person"))
        if not p or p.archived:
            return {"error": f"No person matching '{args.get('person')}'"}
        import debts
        owed = {d: v for d, v in debts.outstanding(await debts.balance_of(db, uid, p.id)).items() if v > 0}
        what = (" They still have a balance: " + " and ".join(debts._phrase(d, v, p.name) for d, v in owed.items()) + "; deleting clears it (no payment recorded).") if owed else ""
        gate = await _confirm(srv, db, user, session_id, previewed, name, p.id, args,
                              f"This will delete {p.name}. Their records are kept and they can be restored.{what} Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "people", p)
        await srv._archive_people(db, uid, [p.id], True)
        for line in (await db.execute(select(DebtEntry).where(DebtEntry.user_id == uid, DebtEntry.person_id == p.id, DebtEntry.kind == "clear")
                                      .order_by(DebtEntry.created_ms.desc()).limit(len(owed)))).scalars():
            created.append({"collection": "debt_entries", "id": line.id})   # undo restores what deleting cleared
        return {"deleted": p.name, "archived": True, "cleared": {d: v / 100 for d, v in owed.items()}}

    if name == "delete_recipe":
        key = (args.get("recipe") or "").strip()
        r = (await db.execute(select(Recipe).where(Recipe.user_id == uid, (Recipe.id == key) | Recipe.name.ilike(key)))).scalars().first()
        if not r:
            return {"error": f"No recipe matching '{key}'"}
        gate = await _confirm(srv, db, user, session_id, previewed, name, r.id, args, f"This will delete the recipe '{r.name}'. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "recipes", r)
        await srv.delete_recipe(r.id, user, db)
        return {"deleted": r.name}

    if name == "get_workouts":
        limit = max(1, min(int(args.get("limit") or 10), 50))
        rows = await srv.get_workouts(user, db)
        return {"workouts": [{k: w.get(k) for k in ("id", "date", "type", "notes", "exercises")} for w in rows[:limit]],
                "personal_records": await srv.workout_prs(user, db)}
    if name == "delete_workout":
        w = (await db.execute(select(Workout).where(Workout.id == args.get("workout_id"), Workout.user_id == uid))).scalar_one_or_none()
        if not w:
            return {"error": "Workout not found"}
        gate = await _confirm(srv, db, user, session_id, previewed, name, w.id, args, f"This will delete the {w.type} workout from {w.date}. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "workouts", w)
        await srv.delete_workout(w.id, user, db)
        return {"deleted": f"{w.type} on {w.date}"}

    if name == "get_weight_history":
        rows = await srv.get_weight(user, db)
        limit = max(1, min(int(args.get("limit") or 30), 365))
        shown = rows[-limit:]
        change = round(rows[-1]["weight"] - rows[0]["weight"], 2) if len(rows) > 1 else None
        return {"entries": [{k: w.get(k) for k in ("id", "date", "weight", "note")} for w in shown], "change_since_first": change}
    if name == "delete_weight_entry":
        w = (await db.execute(select(WeightEntry).where(WeightEntry.id == args.get("weight_id"), WeightEntry.user_id == uid))).scalar_one_or_none()
        if not w:
            return {"error": "Weight entry not found"}
        gate = await _confirm(srv, db, user, session_id, previewed, name, w.id, args, f"This will delete the {w.weight} kg entry from {w.date}. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "weight", w)
        await srv.delete_weight(w.id, user, db)
        return {"deleted": f"{w.weight} kg on {w.date}"}

    return {"error": "unknown tool"}
