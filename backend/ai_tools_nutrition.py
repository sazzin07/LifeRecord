"""AI tools for the Nutrition page: food search, logging with portions, the day, reports, targets, profile, recipes, meal plans,
shopping lists and reminders.

Every handler calls the same functions as the REST endpoints (`srv.nutrition`, `srv.nutrition_plan`), so validation, ownership,
unit conversion and nutrient arithmetic live in one place, and every row is scoped to the signed-in user. The model never
supplies a user id and never invents nutrient values: foods are found with `search_foods` and referred to by id; a food's
numbers come from its source, or from what the person typed from a label.

Deletes use the shared two-step confirmation. Changes to the nutrition profile and to daily targets also need a preview and a
confirmation on a later message, and that confirmation is bound to the exact values previewed, so values cannot change between
the preview and the apply. Everything that changes data can be undone from the AI actions log (`srv.remember_before`).
"""
import hashlib
import json
import re
from datetime import date as _date, timedelta
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

import nutrition_api as napi
import nutrition_calc as calc
import nutrition_plan_api as plan_api
from models import Food, FoodFavorite, HydrationEntry, Meal, MealPlanEntry, NutritionProfile, Recipe
from nutrition_data import BY_KEY, DERIVED


def _fn(name, description, props=None, required=None):
    params = {"type": "object", "properties": props or {}}
    if required:
        params["required"] = required
    return {"type": "function", "function": {"name": name, "description": description, "parameters": params}}


_S = {"type": "string"}
_N = {"type": "number"}
_B = {"type": "boolean"}
_DATE = {"type": "string", "description": "YYYY-MM-DD, or today / yesterday / tomorrow. Omit for today."}
_TIME = {"type": "string", "description": "Local time HH:MM (24-hour). Omit if unknown."}
_MEAL = {"type": "string", "enum": ["breakfast", "lunch", "dinner", "snack", "other"],
         "description": "Omit to use the meal that fits the current time."}
_CONFIRM = {"type": "boolean", "description": "Leave unset on the first call, which only previews. After the user has explicitly agreed in their latest "
                                              "message, call the same tool again with exactly the same arguments and confirm=true."}
_NUTRIENT = {"type": "string", "description": "A nutrient key such as energy_kcal, protein_g, carbs_g, fat_g, fiber_g, sugars_g, sat_fat_g, sodium_mg, "
                                              "potassium_mg, calcium_mg, iron_mg, magnesium_mg, zinc_mg, vit_a_ug, vit_c_mg, vit_d_ug, vit_b12_ug, folate_ug."}
_INGREDIENTS = {"type": "array", "items": {"type": "object", "properties": {
    "name": _S, "quantity": _N, "unit": {"type": "string", "description": "g, kg, ml, l, oz, lb, a portion label of the linked food such as '1 large', or 'unit'."},
    "food_id": {"type": "string", "description": "Id from search_foods. Links the ingredient so the recipe's nutrition is calculated."}}, "required": ["name"]}}

NUTRITION_TOOLS = [
    _fn("search_foods",
        "Search the food database (about 8,000 USDA reference foods, the user's own foods and packaged foods already looked up). Returns candidates with id, "
        "category, quality, nutrition per 100 g and the portions each food offers. Always search before logging a food, pick the candidate that best matches "
        "what the user ate, and use its id. If several candidates are plausible and the choice changes the numbers noticeably, ask the user.",
        {"query": _S, "scope": {"type": "string", "enum": ["all", "mine", "favorites"]}, "limit": _N}, ["query"]),
    _fn("get_food", "Everything a food reports per 100 g (only the values its source actually has; the rest are listed as not reported), its portions and data quality.",
        {"food_id": _S}, ["food_id"]),
    _fn("lookup_barcode", "Find a packaged food by its barcode (8 to 14 digits). Uses the user's saved foods first, then Open Food Facts (values are marked estimated).",
        {"code": _S}, ["code"]),
    _fn("get_nutrition_day",
        "The food diary for one day: every entry (with id), energy and macronutrients, totals per meal, drinks, and how each nutrient compares with the user's "
        "reference or own target (with how many entries reported it). Use it for 'what did I eat', 'how am I doing today' and before editing or deleting an entry.",
        {"date": _DATE}),
    _fn("get_nutrition_report",
        "Trend over the last N days (1 to 90): daily energy and macros, averages over the days that were logged (a day without entries is not counted as zero) "
        "compared with the reference. Pass nutrient to also get that nutrient's biggest food sources in the period.",
        {"days": _N, "end_date": _DATE, "nutrient": _NUTRIENT}),
    _fn("get_nutrition_insights",
        "Nutrients that are low so far (or above a guideline limit) on a day, why, and whole foods that are rich in them. Honest about incomplete data.",
        {"date": _DATE}),
    _fn("get_nutrition_targets",
        "The user's nutrition profile (age, sex, activity, diet, allergies), their effective daily reference values or own targets for each nutrient, the standards "
        "they come from, and their reminder settings. Check it before answering questions about what the user 'should' eat.",
        {}),
    _fn("suggest_food_swaps",
        "Similar foods (same category, similar energy) with less or more of one nutrient than a given food, for example a lower-sodium alternative. "
        "Foods that do not report the nutrient are skipped, and foods that clash with the user's diet or allergy words are left out.",
        {"food_id": _S, "nutrient": _NUTRIENT, "direction": {"type": "string", "enum": ["lower", "higher"]}, "limit": _N}, ["food_id", "nutrient"]),
    _fn("get_meal_plan", "The meal plan for up to 14 days from a start date: planned items (with id and status), planned totals per day and how they compare with the reference.",
        {"start": _DATE, "days": _N}),
    _fn("get_meals", "List the diary entries (id, description, calories, protein, carbs, fat) for a date with daily totals. Prefer get_nutrition_day for the full picture.",
        {"date": _DATE}),
    _fn("get_recipes", "List saved recipes with servings, ingredients (and whether each is linked to a food), nutrition per serving and whether it is complete.", {}),
    _fn("log_food",
        "Log something the user ate into the diary: a food (food_id from search_foods) with a quantity and unit, or a saved recipe (recipe_id) with a number of "
        "servings. Nutrients are calculated from the food's data and kept as a snapshot. Units: g, kg, oz, lb, ml/l (only for liquids) or a portion label the food "
        "offers, such as '1 cup'. Never use this with a food id you did not get from a tool.",
        {"food_id": _S, "recipe_id": _S, "quantity": _N, "unit": _S, "meal_type": _MEAL, "date": _DATE, "time": _TIME, "label": {"type": "string", "description": "Optional custom meal name, e.g. Post-workout."}},
        ["quantity"]),
    _fn("log_meal",
        "Log a meal the user described only roughly, with typed numbers. Use it ONLY when no suitable food can be found with search_foods or the user gave the "
        "calories/macros themselves. Estimated numbers are saved as estimates and show as such; tell the user they are estimates.",
        {"description": _S, "calories": _N, "protein": _N, "carbs": _N, "fat": _N, "meal_type": _MEAL, "date": _DATE, "time": _TIME,
         "estimate": {"type": "boolean", "description": "True (default) when the numbers are your estimate; false when the user gave them."}}, ["description"]),
    _fn("update_diary_entry",
        "Change a diary entry by id: its quantity or unit (nutrients are recalculated), meal, date, time or name, or the typed numbers of a typed-in entry. Also moves it.",
        {"entry_id": _S, "quantity": _N, "unit": _S, "meal_type": _MEAL, "date": _DATE, "time": _TIME, "description": _S,
         "calories": _N, "protein": _N, "carbs": _N, "fat": _N}, ["entry_id"]),
    _fn("copy_diary_entries",
        "Copy one diary entry (entry_id) to another day or meal, or copy a whole day or one meal of a day (from_date, optional meal_type) to another day, "
        "e.g. 'same breakfast as yesterday'.",
        {"entry_id": _S, "from_date": _DATE, "to_date": _DATE, "meal_type": _MEAL, "time": _TIME}),
    _fn("delete_diary_entry", "Delete a diary entry or a logged drink by id (preview first, then confirm).", {"entry_id": _S, "confirm": _CONFIRM}, ["entry_id"]),
    _fn("log_water", "Log a drink in millilitres (water, tea, coffee or other). Hydration is tracked as total water, which includes the water in food.",
        {"amount_ml": _N, "beverage": {"type": "string", "enum": ["water", "tea", "coffee", "other"]}, "date": _DATE, "time": _TIME}, ["amount_ml"]),
    _fn("save_custom_food",
        "Create (or, with food_id, update) a food of the user's own from a label or their own numbers, all per 100 g. Pass ONLY values that were given or printed on "
        "the label; omit the rest (never estimate or fill in zeros). salt_g is converted to sodium (salt = sodium x 2.5). Portions are like {label: '1 slice', grams: 30}.",
        {"food_id": {"type": "string", "description": "Only to update one of the user's own foods."}, "name": _S, "brand": _S, "category": _S,
         "calories": _N, "protein_g": _N, "carbs_g": _N, "fat_g": _N, "sat_fat_g": _N, "sugars_g": _N, "fiber_g": _N, "sodium_mg": _N, "salt_g": _N,
         "other_nutrients": {"type": "array", "items": {"type": "object", "properties": {"nutrient": _NUTRIENT, "per_100g": _N}, "required": ["nutrient", "per_100g"]}},
         "portions": {"type": "array", "items": {"type": "object", "properties": {"label": _S, "grams": _N}, "required": ["label", "grams"]}}}),
    _fn("delete_custom_food", "Delete one of the user's own foods (preview first, then confirm). Diary entries that used it keep their numbers.",
        {"food_id": _S, "confirm": _CONFIRM}, ["food_id"]),
    _fn("set_favorite_food", "Star or unstar a food so it appears in the user's favourites.", {"food_id": _S, "favorite": _B}, ["food_id", "favorite"]),
    _fn("update_nutrition_profile",
        "Change the user's nutrition profile (only the fields you pass; clear lists fields to empty). The reference values depend on it, so it is previewed first "
        "and applied only after the user agrees on a later message. Pregnancy or breastfeeding can only be set for sex F.",
        {"birth_year": _N, "sex": {"type": "string", "enum": ["F", "M"]}, "height_cm": _N, "weight_kg": _N,
         "activity": {"type": "string", "enum": ["sedentary", "moderate", "active", "very_active"]},
         "pregnancy": {"type": "string", "enum": ["pregnant_t1", "pregnant_t2", "pregnant_t3", "lactating_0_6", "lactating_6plus"]},
         "diet_tags": {"type": "array", "items": {"type": "string", "enum": ["vegan", "vegetarian", "gluten-free", "lactose-free"]}},
         "allergies": {"type": "array", "items": _S}, "timezone": {"type": "string", "description": "IANA name, e.g. Europe/Lisbon"},
         "clear": {"type": "array", "items": {"type": "string", "enum": ["birth_year", "sex", "height_cm", "weight_kg", "activity", "pregnancy", "timezone"]}},
         "confirm": _CONFIRM}),
    _fn("set_nutrition_target",
        "Set (min, target and/or max) or clear the user's own daily target for one nutrient. Their own target always overrides the suggested reference. "
        "Previewed first and applied only after the user agrees on a later message. An energy target under 1,200 kcal carries a safety warning.",
        {"nutrient": _NUTRIENT, "min": _N, "target": _N, "max": _N, "clear": {"type": "boolean", "description": "True to remove the user's own target for this nutrient."},
         "confirm": _CONFIRM}, ["nutrient"]),
    _fn("set_nutrition_reminders",
        "Turn the in-app nutrition reminders on or off and set the times (24-hour, user's time zone). They only appear inside the app; nothing is emailed or pushed. "
        "A meal reminder shows until that meal has been logged; the water reminder shows if less than half of the water reference was reached by that time.",
        {"enabled": _B, "breakfast": _TIME, "lunch": _TIME, "dinner": _TIME, "snack": _TIME, "water_by": _TIME,
         "clear_times": {"type": "array", "items": {"type": "string", "enum": ["breakfast", "lunch", "dinner", "snack", "water_by"]}}}, ["enabled"]),
    _fn("plan_meal",
        "Plan something to eat on a day (it does not count as eaten until logged). Give food_id + quantity + unit, or recipe_id + servings (quantity), or a "
        "description with typed calories. Pass plan_id to change an existing planned item.",
        {"plan_id": _S, "food_id": _S, "recipe_id": _S, "quantity": _N, "unit": _S, "description": _S, "calories": _N, "protein": _N, "carbs": _N, "fat": _N,
         "meal_type": _MEAL, "date": _DATE, "time": _TIME, "note": _S}),
    _fn("remove_plan_entry", "Remove a planned item by id (preview first, then confirm).", {"plan_id": _S, "confirm": _CONFIRM}, ["plan_id"]),
    _fn("log_planned_meal", "Log a planned item as eaten, using the nutrients saved when it was planned. Safe to repeat: it is logged once.",
        {"plan_id": _S, "date": _DATE, "meal_type": _MEAL, "time": _TIME}, ["plan_id"]),
    _fn("copy_meal_plan", "Repeat the plan for one or more days (up to 14) on other days, e.g. next week the same as this week.",
        {"from_start": _DATE, "days": _N, "to_start": _DATE, "meal_type": _MEAL}, ["from_start", "to_start"]),
    _fn("plan_shopping_list",
        "Put what a date range of the meal plan needs on a shopping list, minus what is already in the kitchen. Nothing is bought and inventory is unchanged. "
        "Plain foods are listed by weight as eaten.",
        {"start": _DATE, "end": _DATE, "list_id": _S}, ["start", "end"]),
    _fn("create_recipe",
        "Save a recipe. Link each ingredient to a food (food_id from search_foods) so its nutrition is calculated per serving; ingredients without a link are listed "
        "as missing, never counted as zero. Typed whole-recipe calories/protein/carbs/fat are only used when no ingredient is linked.",
        {"name": _S, "servings": _N, "ingredients": _INGREDIENTS, "calories": _N, "protein": _N, "carbs": _N, "fat": _N, "notes": _S}, ["name"]),
    _fn("update_recipe", "Change a saved recipe (found by name or id): rename it, change servings, replace its ingredients, or edit its notes.",
        {"recipe": _S, "new_name": _S, "servings": _N, "ingredients": _INGREDIENTS, "calories": _N, "protein": _N, "carbs": _N, "fat": _N, "notes": _S}, ["recipe"]),
]
NUTRITION_NAMES = {t["function"]["name"] for t in NUTRITION_TOOLS}
# the read-only subset a scheduled report may use
NUTRITION_READ_TOOLS = ["get_nutrition_day", "get_nutrition_report", "get_nutrition_insights", "get_nutrition_targets", "get_meal_plan", "get_meals",
                        "get_recipes", "search_foods", "get_food", "suggest_food_swaps"]


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def _digest(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _num(v, name):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        raise HTTPException(422, f"{name} must be a number.")


def _time(v) -> Optional[str]:
    if v in (None, ""):
        return None
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", str(v))
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise HTTPException(422, f"'{v}' is not a time. Use HH:MM (24-hour).")
    return f"{int(m.group(1)):02d}:{m.group(2)}"


async def _ctx(nx, db, user):
    """(today as the user's profile sees it, local hour)."""
    _, prof, _, today = await nx.reference(db, user["_id"])
    return today, nx.local_now(prof).hour


def _day(v, today: _date) -> Optional[str]:
    """YYYY-MM-DD from a date or today/yesterday/tomorrow; None when not given. Invalid values are refused, never guessed."""
    if v in (None, ""):
        return None
    t = str(v).strip().lower()
    if t in ("today", "yesterday", "tomorrow"):
        return (today + timedelta(days={"today": 0, "yesterday": -1, "tomorrow": 1}[t])).isoformat()
    try:
        return _date.fromisoformat(t).isoformat()
    except ValueError:
        raise HTTPException(422, f"'{v}' is not a date. Use YYYY-MM-DD, today, yesterday or tomorrow.")


def _entry(e: dict) -> dict:
    n = e.get("nutrients") or {}
    return {"id": e["id"], "date": e["date"], "meal_type": e["meal_type"], "time": e.get("eaten_at"), "name": e["description"],
            "quantity": e.get("quantity"), "unit": e.get("unit"), "grams": e.get("grams"),
            "energy_kcal": _r(n.get("energy_kcal")), "protein_g": _r(n.get("protein_g")), "carbs_g": _r(n.get("carbs_g")), "fat_g": _r(n.get("fat_g")),
            "quality": e.get("quality"), "source": e.get("source")}


def _r(v, d=1):
    return None if v is None else round(float(v), d)


def _name(key):
    return (BY_KEY.get(key) or DERIVED.get(key) or {}).get("name", key)


def _unit(key):
    return (BY_KEY.get(key) or DERIVED.get(key) or {}).get("unit", "")


def _status_rows(progress: dict, only_reported=True):
    rows = []
    for k, p in progress.items():
        if only_reported and p["status"] == "no_data":
            continue
        rows.append({"nutrient": k, "name": _name(k), "intake": _r(p["intake"], 2), "unit": p["unit"], "status": p["status"],
                     "percent_of_target": _r(p["percent"], 0), "min": p["min"], "target": p["target"], "max": p["max"],
                     "entries_reporting": p["entries_reporting"], "of_entries": p["entries"]})
    return rows


def _reported(detail: dict) -> dict:
    """Only the per-100 g values a food really reports, by nutrient key (the rest are not reported, which is not zero)."""
    return {n["key"]: _r(n["per100"], 3) for n in detail["nutrients"] if n["per100"] is not None}


def _food_line(f: dict) -> dict:
    return {"id": f["id"], "name": f["name"], "brand": f["brand"], "category": f["category"], "source": f["source"], "quality": f["quality"],
            "per_100g": {k: _r(v) for k, v in f["per100"].items()}, "portions": [p["label"] for p in (f.get("portions") or [])[:6]],
            "mine": f["mine"], "favorite": f["favorite"], "flags": f.get("flags") or []}


def _recipe_line(r: dict) -> dict:
    n = r.get("nutrients") or {}
    meta = r.get("nutrition_meta") or {}
    servings = max(int(r.get("servings") or 1), 1)
    per = ({k: _r(n.get(k)) for k in ("energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g")} if n
           else {"energy_kcal": _r(r["calories"] / servings) if r.get("calories") is not None else None,
                 "protein_g": _r(r["protein"] / servings) if r.get("protein") is not None else None,
                 "carbs_g": _r(r["carbs"] / servings) if r.get("carbs") is not None else None,
                 "fat_g": _r(r["fat"] / servings) if r.get("fat") is not None else None})
    return {"id": r["id"], "name": r["name"], "servings": servings,
            "ingredients": [{"name": i["name"], "quantity": i.get("quantity"), "unit": i.get("unit"), "linked_to_food": bool(i.get("food_id")), "food_id": i.get("food_id")}
                            for i in (r.get("ingredients") or [])],
            "per_serving": per, "nutrition": ("calculated from linked ingredients" if n else "typed by the user" if r.get("calories") is not None else "none yet"),
            "nutrition_complete": meta.get("complete") if meta else None, "ingredients_missing_nutrition": meta.get("missing") or []}


# ---------------------------------------------------------------------------
# dispatcher
# ---------------------------------------------------------------------------
async def dispatch_nutrition(srv, db, name, args, created, user, session_id=None, previewed=None) -> dict:
    try:
        return await _dispatch(srv, db, name, args, created, user, session_id, previewed)
    except HTTPException as exc:
        await db.rollback()
        return {"error": str(exc.detail)}
    except ValidationError as exc:
        await db.rollback()
        e = exc.errors()[0]
        where = ".".join(str(x) for x in e["loc"] if x != "body")
        return {"error": f"{where}: {e['msg']}" if where else e["msg"]}
    except calc.PortionError as exc:
        await db.rollback()
        return {"error": str(exc)}


async def _gate(srv, db, user, session_id, previewed, tool, target, args, message):
    return await srv._confirmation_gate(db, user["_id"], session_id, previewed, tool, target, args.get("confirm"), message)


async def _dispatch(srv, db, name, args, created, user, session_id, previewed) -> dict:
    nx, pl, uid = srv.nutrition, srv.nutrition_plan, user["_id"]
    today, hour = await _ctx(nx, db, user)

    # ------------------------------------------------------------ reads
    if name == "search_foods":
        q = str(args.get("query") or "").strip()
        if not q:
            return {"error": "Give a food name to search for."}
        rows = await nx.search_foods(q=q[:100], limit=max(1, min(int(_num(args.get("limit"), "limit") or 8), 20)), scope=args.get("scope") or "all", user=user, db=db)
        return {"count": len(rows), "foods": [_food_line(f) for f in rows],
                "note": "Per-100 g values from each food's source. Pick the best match by name and category; ask the user if several fit equally well." if rows
                        else "No food matches. Try a simpler or more general name, or ask the user for the label values and use save_custom_food."}
    if name == "get_food":
        f = await nx.get_food(fid=str(args.get("food_id") or ""), user=user, db=db)
        have = {n["name"]: {"per_100g": n["per100"], "unit": n["unit"]} for n in f["nutrients"] if n["per100"] is not None}
        return {"id": f["id"], "name": f["name"], "brand": f["brand"], "category": f["category"], "source": f["source"], "quality": f["quality"],
                "data_version": f["data_version"], "nutrients": have, "not_reported": [n["name"] for n in f["nutrients"] if n["per100"] is None],
                "portions": f["portions"], "units": f["units"], "completeness": f["completeness"]}
    if name == "lookup_barcode":
        f = await nx.food_by_barcode(code=re.sub(r"\s+", "", str(args.get("code") or "")), user=user, db=db)
        return {"id": f["id"], "name": f["name"], "brand": f["brand"], "quality": f["quality"], "source": f["source"],
                "per_100g": _reported(f), "portions": f["portions"],
                "note": "Packaged-food values are crowd-sourced and only cover energy, macros, sugar, fibre, saturated fat and sodium." if f["quality"] == "estimated" else ""}
    if name == "get_nutrition_day":
        d = await nx.get_day(date_=_day(args.get("date"), today), user=user, db=db)
        t = d["totals"]
        prog = d["progress"] or {}
        return {"date": d["date"], "today": d["today"], "entries": d["entries"],
                "energy": {"eaten_kcal": _r(t.get("energy_kcal")), "target_kcal": d["energy_target"],
                           "left_kcal": _r(d["energy_target"] - t["energy_kcal"]) if d["energy_target"] and "energy_kcal" in t else None},
                "meals": [{"meal_type": m["meal_type"], "energy_kcal": _r(m["totals"].get("energy_kcal")), "entries": [_entry(e) for e in m["entries"]]} for m in d["meals"]],
                "macro_energy_shares_pct": {k: _r(v, 0) for k, v in (d["macro_shares"] or {}).items()},
                "hydration": {"drinks_ml": d["hydration"]["drinks_ml"], "food_water_ml": d["hydration"]["food_water_ml"], "total_ml": d["hydration"]["total_ml"],
                              "reference_ml": d["hydration"]["target_ml"], "drinks": d["hydration"]["entries"]},
                "nutrients": _status_rows(prog), "nutrients_with_no_data": sum(1 for p in prog.values() if p["status"] == "no_data"),
                "data_quality": d["quality"], "reference": d["reference"],
                "note": "'no_data' means no logged entry reported the nutrient; it is not zero. Reference values are for healthy adults, not medical advice."}
    if name == "get_nutrition_report":
        days = max(1, min(int(_num(args.get("days"), "days") or 7), 90))
        end = _day(args.get("end_date"), today)
        tr = await nx.trends(days=days, end=end, user=user, db=db)
        out = {"start": tr["start"], "end": tr["end"], "days_logged": tr["days_logged"], "of_days": days,
               "daily": [{"date": s["date"], "logged": s["logged"], "energy_kcal": _r(s["energy_kcal"]), "protein_g": _r(s["protein_g"]), "carbs_g": _r(s["carbs_g"]),
                          "fat_g": _r(s["fat_g"]), "fiber_g": _r(s["fiber_g"]), "drinks_ml": s["drinks_ml"]} for s in tr["series"]],
               "average_per_logged_day": _status_rows(tr["progress"]), "note": tr["note"]}
        nutrient = args.get("nutrient")
        if nutrient:
            c = await nx.contributors(nutrient=nutrient, start=tr["start"], end=tr["end"], limit=8, user=user, db=db)
            out["sources_of"] = {"nutrient": c["name"], "unit": c["unit"], "total": _r(c["total"], 2), "entries_without_data": c["entries_without_data"],
                                 "top": [{"food": x["description"], "amount": _r(x["amount"], 2), "share_pct": _r(x["share_pct"], 0)} for x in c["top"]]}
        return out
    if name == "get_nutrition_insights":
        i = await nx.insights(date_=_day(args.get("date"), today), user=user, db=db)
        return {"date": i["date"], "insights": [{"nutrient": x["nutrient"], "title": x["title"], "why": x["why"], "rich_foods": [
            {"food_id": f["food_id"], "name": f["name"], "per_100g": _r(f["amount_per_100g"], 2)} for f in x.get("foods", [])]} for x in i["insights"]],
            "note": i.get("note") or "One low day is not a deficiency; incomplete entries can hide nutrients that were eaten."}
    if name == "get_nutrition_targets":
        t = await nx.get_targets(user=user, db=db)
        prof = await nx.get_profile(user=user, db=db)
        rem = await nx.get_reminders(user=user, db=db)
        return {"profile": {k: prof[k] for k in ("birth_year", "sex", "height_cm", "weight_kg", "activity", "pregnancy", "diet_tags", "allergies", "timezone")},
                "personalised": t["personalised"], "basis": t["basis"], "notes": t["notes"], "weight_used": t["weight"],
                "targets": [{"nutrient": k, "name": _name(k), "unit": v.get("unit") or _unit(k), "min": v.get("min"), "target": v.get("target"), "max": v.get("max"),
                             "kind": v.get("kind"), "source": v.get("source"), "user_set": v["overridden"]} for k, v in t["items"].items()],
                "reminders": rem, "disclaimer": t["disclaimer"]}
    if name == "suggest_food_swaps":
        s = await pl.food_swaps(fid=str(args.get("food_id") or ""), nutrient=str(args.get("nutrient") or ""), direction=args.get("direction"),
                                limit=max(1, min(int(_num(args.get("limit"), "limit") or 5), 10)), user=user, db=db)
        return {"food": s["food"], "nutrient": s["name"], "unit": s["unit"], "direction": s["direction"], "original_per_100g": _r(s.get("original_per100"), 2),
                "swaps": [{"food_id": x["id"], "name": x["name"], "per_100g": _r(x["per100"], 2), "change_pct": _r(x["change_pct"], 0), "energy_kcal_per_100g": _r(x["energy_kcal"], 0),
                           "quality": x["quality"]} for x in s["swaps"]], "note": s["note"]}
    if name == "get_meal_plan":
        start = _day(args.get("start"), today) or today.isoformat()
        days = max(1, min(int(_num(args.get("days"), "days") or 7), 14))
        end = (_date.fromisoformat(start) + timedelta(days=days - 1)).isoformat()
        p = await pl.get_plan(start=start, end=end, user=user, db=db)
        return {"start": start, "end": end, "days": [{"date": d["date"], "planned_energy_kcal": _r(d["totals"].get("energy_kcal")), "energy_target": d["energy_target"],
                                                      "items": [{"id": e["id"], "meal_type": e["meal_type"], "time": e["eaten_at"], "name": e["description"], "quantity": e["quantity"],
                                                                 "unit": e["unit"], "energy_kcal": _r(e["nutrients"].get("energy_kcal")), "status": e["status"], "note": e["note"]} for e in d["entries"]],
                                                      "progress": {k: {"intake": _r(v["intake"], 1), "status": v["status"]} for k, v in d["progress"].items()}} for d in p["days"]],
                "note": p["note"]}
    if name == "get_meals":
        d = await nx.get_day(date_=_day(args.get("date"), today), user=user, db=db)
        entries = [_entry(e) for m in d["meals"] for e in m["entries"]]
        t = d["totals"]
        return {"date": d["date"], "meals": [{"id": e["id"], "description": e["name"], "calories": e["energy_kcal"], "protein": e["protein_g"], "carbs": e["carbs_g"],
                                              "fat": e["fat_g"], "meal_type": e["meal_type"]} for e in entries],
                "totals": {"calories": round(t.get("energy_kcal", 0)), "protein": round(t.get("protein_g", 0)), "carbs": round(t.get("carbs_g", 0)), "fat": round(t.get("fat_g", 0))}}
    if name == "get_recipes":
        return {"recipes": [_recipe_line(r) for r in await srv.get_recipes(user, db)]}

    # ------------------------------------------------------------ diary writes
    if name == "log_food":
        qty = _num(args.get("quantity"), "quantity")
        if bool(args.get("food_id")) == bool(args.get("recipe_id")):
            return {"error": "Give exactly one of food_id (from search_foods) or recipe_id."}
        body = napi.DiaryBody(date=_day(args.get("date"), today), meal_type=args.get("meal_type") or calc.default_meal_type(hour), meal_label=args.get("label"),
                              eaten_at=_time(args.get("time")), food_id=args.get("food_id"), recipe_id=args.get("recipe_id"), quantity=qty,
                              unit=(args.get("unit") or ("serving" if args.get("recipe_id") else "g")))
        m = await nx.create_diary_entry(db, uid, body, today=today)
        created.append({"collection": "meals", "id": m.id})
        day = await nx.get_day(date_=m.date, user=user, db=db)
        return {"logged": _entry(nx.entry_view(m)), "day_total_kcal": _r(day["totals"].get("energy_kcal")), "day_entries": day["entries"],
                **({"note": "Some nutrients are missing for this entry, so the day's totals for them may be low."} if m.quality in ("estimated", "mixed") else {})}
    if name == "log_meal":
        body = napi.DiaryBody(date=_day(args.get("date"), today), meal_type=args.get("meal_type") or calc.default_meal_type(hour), eaten_at=_time(args.get("time")),
                              description=args.get("description"), calories=_num(args.get("calories"), "calories"), protein=_num(args.get("protein"), "protein"),
                              carbs=_num(args.get("carbs"), "carbs"), fat=_num(args.get("fat"), "fat"))
        m = await nx.create_diary_entry(db, uid, body, today=today, source="assistant", quality="estimated" if args.get("estimate", True) else "user")
        created.append({"collection": "meals", "id": m.id})
        return {"logged": _entry(nx.entry_view(m)), "note": "Saved as typed-in numbers" + (" marked as an estimate." if args.get("estimate", True) else ".")
                + " Only the numbers given are recorded; vitamins and minerals are not known for it."}
    if name == "update_diary_entry":
        m = await nx.own_entry(db, uid, str(args.get("entry_id") or ""))
        body = napi.DiaryUpdate(date=_day(args.get("date"), today), meal_type=args.get("meal_type"), eaten_at=_time(args.get("time")), quantity=_num(args.get("quantity"), "quantity"),
                                unit=args.get("unit"), description=args.get("description"), calories=_num(args.get("calories"), "calories"),
                                protein=_num(args.get("protein"), "protein"), carbs=_num(args.get("carbs"), "carbs"), fat=_num(args.get("fat"), "fat"))
        srv.remember_before(created, "meals", m)
        return {"updated": _entry(await nx.update_entry(mid=m.id, body=body, user=user, db=db))}
    if name == "copy_diary_entries":
        to = _day(args.get("to_date"), today)
        if args.get("entry_id"):
            src = await nx.own_entry(db, uid, str(args["entry_id"]))
            e = await nx.duplicate_entry(mid=src.id, body=napi.MoveBody(date=to or src.date, meal_type=args.get("meal_type"), eaten_at=_time(args.get("time"))), user=user, db=db)
            created.append({"collection": "meals", "id": e["id"]})
            return {"copied": [_entry(e)]}
        frm = _day(args.get("from_date"), today)
        if not frm or not to:
            return {"error": "Give entry_id, or both from_date and to_date."}
        r = await nx.copy_entries(body=napi.CopyBody(from_date=frm, to_date=to, meal_type=args.get("meal_type")), user=user, db=db)
        created.extend({"collection": "meals", "id": e["id"]} for e in r["entries"])
        return {"copied": [_entry(e) for e in r["entries"]]}
    if name == "delete_diary_entry":
        eid = str(args.get("entry_id") or "")
        m = (await db.execute(select(Meal).where(Meal.id == eid, Meal.user_id == uid))).scalar_one_or_none()
        h = None if m else (await db.execute(select(HydrationEntry).where(HydrationEntry.id == eid, HydrationEntry.user_id == uid))).scalar_one_or_none()
        if not m and not h:
            return {"error": "Entry not found"}
        label = f"'{m.description}' on {m.date}" if m else f"the {h.amount_ml} ml {h.beverage} on {h.date}"
        gate = await _gate(srv, db, user, session_id, previewed, name, eid, args, f"This will delete {label} from the diary. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "meals" if m else "hydration", m or h)
        await (nx.delete_entry(mid=eid, user=user, db=db) if m else nx.delete_water(hid=eid, user=user, db=db))
        return {"deleted": label}
    if name == "log_water":
        w = await nx.add_water(body=napi.WaterBody(amount_ml=int(_num(args.get("amount_ml"), "amount_ml") or 0), beverage=args.get("beverage") or "water",
                                                   date=_day(args.get("date"), today), eaten_at=_time(args.get("time"))), user=user, db=db)
        created.append({"collection": "hydration", "id": w["id"]})
        day = await nx.get_day(date_=w["date"], user=user, db=db)
        return {"logged": w, "total_water_ml_today": day["hydration"]["total_ml"], "reference_ml": day["hydration"]["target_ml"]}

    # ------------------------------------------------------------ foods
    if name == "save_custom_food":
        n = {}
        for arg, key in (("calories", "energy_kcal"), ("protein_g", "protein_g"), ("carbs_g", "carbs_g"), ("fat_g", "fat_g"), ("sat_fat_g", "sat_fat_g"),
                         ("sugars_g", "sugars_g"), ("fiber_g", "fiber_g"), ("sodium_mg", "sodium_mg")):
            if args.get(arg) is not None:
                n[key] = _num(args[arg], arg)
        if args.get("salt_g") is not None:
            if "sodium_mg" in n:
                return {"error": "Give sodium_mg or salt_g, not both."}
            n["sodium_mg"] = _num(args["salt_g"], "salt_g") * 1000.0 / 2.5  # EU 1169/2011: salt = sodium x 2.5
        for o in args.get("other_nutrients") or []:
            if o.get("nutrient") not in BY_KEY:
                return {"error": f"Unknown nutrient '{o.get('nutrient')}'."}
            n[o["nutrient"]] = _num(o.get("per_100g"), "per_100g")
        portions = args.get("portions")
        if args.get("food_id"):
            f = (await db.execute(select(Food).where(Food.id == args["food_id"], Food.user_id == uid))).scalar_one_or_none()
            if not f:
                return {"error": "That is not one of the user's own foods (shared reference foods cannot be edited; save a copy instead)."}
            body = napi.FoodBody(name=args.get("name") or f.name, brand=args.get("brand", f.brand), category=args.get("category", f.category),
                                 nutrients={**(f.nutrients or {}), **n}, portions=portions if portions is not None else (f.portions or []))
            srv.remember_before(created, "foods", f)
            r = await nx.update_food(fid=f.id, body=body, user=user, db=db)
            return {"updated": {"id": r["id"], "name": r["name"], "per_100g": _reported(r)}}
        if not args.get("name") or not n:
            return {"error": "Give a name and at least one nutrient value per 100 g (for example calories)."}
        r = await nx.create_food(body=napi.FoodBody(name=args["name"], brand=args.get("brand"), category=args.get("category"), nutrients=n, portions=portions or []), user=user, db=db)
        created.append({"collection": "foods", "id": r["id"]})
        return {"created": {"id": r["id"], "name": r["name"], "per_100g": _reported(r), "reported": r["completeness"]["reported"]},
                "note": "Only the values given are saved; everything else is 'not reported', not zero. It can now be logged with log_food."}
    if name == "delete_custom_food":
        f = (await db.execute(select(Food).where(Food.id == str(args.get("food_id") or ""), Food.user_id == uid))).scalar_one_or_none()
        if not f:
            return {"error": "That is not one of the user's own foods."}
        gate = await _gate(srv, db, user, session_id, previewed, name, f.id, args,
                           f"This will delete the food '{f.name}'. Diary entries that used it keep their numbers; recipes using it lose their calculation. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "foods", f)
        await nx.delete_food(fid=f.id, user=user, db=db)
        return {"deleted": f.name}
    if name == "set_favorite_food":
        fid = str(args.get("food_id") or "")
        if args.get("favorite"):
            await nx.favorite(fid=fid, user=user, db=db)
            row = (await db.execute(select(FoodFavorite).where(FoodFavorite.user_id == uid, FoodFavorite.food_id == fid))).scalar_one_or_none()
            if row and not any(c["collection"] == "food_favorites" and c["id"] == row.id for c in created):
                created.append({"collection": "food_favorites", "id": row.id})
        else:
            row = (await db.execute(select(FoodFavorite).where(FoodFavorite.user_id == uid, FoodFavorite.food_id == fid))).scalar_one_or_none()
            if row:
                srv.remember_before(created, "food_favorites", row)
            await nx.unfavorite(fid=fid, user=user, db=db)
        return {"food_id": fid, "favorite": bool(args.get("favorite"))}

    # ------------------------------------------------------------ profile, targets, reminders
    if name == "update_nutrition_profile":
        cur = await nx.get_profile(user=user, db=db)
        merged = {k: cur[k] for k in ("birth_year", "sex", "height_cm", "weight_kg", "activity", "pregnancy", "diet_tags", "allergies", "timezone")}
        for k in args.get("clear") or []:
            merged[k] = None
        for k in merged:
            if k in args and k != "clear":
                merged[k] = args[k]
        body = napi.ProfileBody(**merged)  # validates ranges and allowed values
        if body.pregnancy and body.sex != "F":
            return {"error": "Pregnancy or breastfeeding can only be set when sex is F."}
        if body.timezone:
            try:
                ZoneInfo(body.timezone)
            except (ZoneInfoNotFoundError, ValueError):
                return {"error": f"'{body.timezone}' is not a known time zone (use a name like Europe/Lisbon)."}
        new = body.model_dump()
        changes = [f"{k}: {cur[k] if cur[k] not in (None, []) else 'not set'} -> {new[k] if new[k] not in (None, []) else 'not set'}" for k in new if new[k] != cur[k]]
        if not changes:
            return {"unchanged": True, "message": "The profile already has those values."}
        gate = await _gate(srv, db, user, session_id, previewed, name, "profile:" + _digest(new), args,
                           "This will change the nutrition profile, which changes the user's reference values: " + "; ".join(changes) + ". Ask the user to confirm.")
        if gate:
            return gate
        row = await nx.get_profile_row(db, uid)
        if row:
            srv.remember_before(created, "nutrition_profiles", row)
        res = await nx.put_profile(body=body, user=user, db=db)
        if not row:
            created.append({"collection": "nutrition_profiles", "id": (await nx.get_profile_row(db, uid)).id})
        return {"updated": {k: res[k] for k in new}}
    if name == "set_nutrition_target":
        key = str(args.get("nutrient") or "")
        if key not in BY_KEY and key not in DERIVED:
            return {"error": f"Unknown nutrient '{key}'."}
        clear = bool(args.get("clear"))
        vals = {k: _num(args[k], k) for k in ("min", "target", "max") if args.get(k) is not None}
        if not clear:
            if not vals:
                return {"error": "Give at least one of min, target or max, or clear=true."}
            napi.OverrideBody(**vals)  # refuses negative values
            lo, tg, hi = vals.get("min"), vals.get("target"), vals.get("max")
            if lo is not None and hi is not None and lo > hi:
                return {"error": "The minimum cannot be above the maximum."}
            if tg is not None and ((hi is not None and tg > hi) or (lo is not None and tg < lo)):
                return {"error": "The target must lie between the minimum and the maximum."}
        warn = ""
        if key == "energy_kcal" and not clear and vals.get("target", 1e9) < napi.LOW_ENERGY_WARNING_KCAL:
            warn = (f" Safety note: a daily energy target under {napi.LOW_ENERGY_WARNING_KCAL} kcal is very low for most adults; recommend talking to a doctor "
                    "or dietitian before eating this little for more than a short time.")
        gate = await _gate(srv, db, user, session_id, previewed, name, f"target:{key}:" + _digest([clear, vals]), args,
                           (f"This will remove the user's own {_name(key)} target and go back to the suggested reference." if clear else
                            f"This will set the user's own {_name(key)} target to {vals} {_unit(key)}, replacing the suggested reference.") + warn + " Ask the user to confirm.")
        if gate:
            return gate
        row = await nx.get_profile_row(db, uid)
        if row:
            srv.remember_before(created, "nutrition_profiles", row)
        if clear:
            await nx.clear_target(key=key, user=user, db=db)
            res = {"key": key, "override": None, "warning": None}
        else:
            res = await nx.set_target(key=key, body=napi.OverrideBody(**vals), user=user, db=db)
        if not row:
            created.append({"collection": "nutrition_profiles", "id": (await nx.get_profile_row(db, uid)).id})
        return {"nutrient": _name(key), "own_target": res["override"], **({"warning": res["warning"]} if res.get("warning") else {})}
    if name == "set_nutrition_reminders":
        cur = await nx.get_reminders(user=user, db=db)
        meals = dict(cur["meals"])
        for mt in ("breakfast", "lunch", "dinner", "snack"):
            if args.get(mt):
                meals[mt] = _time(args[mt])
        water = _time(args["water_by"]) if args.get("water_by") else cur["water_by"]
        for k in args.get("clear_times") or []:
            if k == "water_by":
                water = None
            else:
                meals.pop(k, None)
        row = await nx.get_profile_row(db, uid)
        if row:
            srv.remember_before(created, "nutrition_profiles", row)
        res = await nx.put_reminders(body=napi.RemindersBody(enabled=bool(args.get("enabled")), meals=meals, water_by=water), user=user, db=db)
        if not row:
            created.append({"collection": "nutrition_profiles", "id": (await nx.get_profile_row(db, uid)).id})
        return {"reminders": res, "note": "These appear inside the app only; nothing is emailed or pushed."}

    # ------------------------------------------------------------ meal plan, shopping
    if name == "plan_meal":
        if args.get("plan_id"):
            p = await pl.own_plan(db, uid, str(args["plan_id"]))
            body = plan_api.PlanUpdate(date=_day(args.get("date"), today), meal_type=args.get("meal_type"), eaten_at=_time(args.get("time")), quantity=_num(args.get("quantity"), "quantity"),
                                       unit=args.get("unit"), description=args.get("description"), note=args.get("note"))
            srv.remember_before(created, "meal_plan", p)
            return {"updated": await pl.update_plan(pid=p.id, body=body, user=user, db=db)}
        body = plan_api.PlanBody(date=_day(args.get("date"), today), meal_type=args.get("meal_type") or "other", eaten_at=_time(args.get("time")), food_id=args.get("food_id"),
                                 recipe_id=args.get("recipe_id"), quantity=_num(args.get("quantity"), "quantity"), unit=args.get("unit") or ("serving" if args.get("recipe_id") else "g"),
                                 description=args.get("description"), calories=_num(args.get("calories"), "calories"), protein=_num(args.get("protein"), "protein"),
                                 carbs=_num(args.get("carbs"), "carbs"), fat=_num(args.get("fat"), "fat"), note=args.get("note"))
        p = await pl.add_plan(body=body, user=user, db=db)
        created.append({"collection": "meal_plan", "id": p["id"]})
        return {"planned": p}
    if name == "remove_plan_entry":
        p = await pl.own_plan(db, uid, str(args.get("plan_id") or ""))
        gate = await _gate(srv, db, user, session_id, previewed, name, p.id, args, f"This will remove '{p.description}' from the plan for {p.date}. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "meal_plan", p)
        await pl.delete_plan(pid=p.id, user=user, db=db)
        return {"removed": p.description}
    if name == "log_planned_meal":
        p = await pl.own_plan(db, uid, str(args.get("plan_id") or ""))
        srv.remember_before(created, "meal_plan", p)
        r = await pl.log_plan_entry(db, uid, p, plan_api.PlanLogBody(date=_day(args.get("date"), today), meal_type=args.get("meal_type"), eaten_at=_time(args.get("time"))))
        if r["entry"] and not r["duplicate"]:
            created.append({"collection": "meals", "id": r["entry"]["id"]})
        return {"logged": _entry(r["entry"]) if r["entry"] else None, "already_logged": r["duplicate"]}
    if name == "copy_meal_plan":
        r = await pl.copy_plan(body=plan_api.PlanCopyBody(from_start=_day(args.get("from_start"), today), days=int(_num(args.get("days"), "days") or 1),
                                                         to_start=_day(args.get("to_start"), today), meal_type=args.get("meal_type")), user=user, db=db)
        created.extend({"collection": "meal_plan", "id": e["id"]} for e in r["entries"])
        return {"copied": r["copied"], "dates": sorted({e["date"] for e in r["entries"]})}
    if name == "plan_shopping_list":
        r = await pl.plan_to_shopping_list(body=plan_api.PlanShoppingBody(start=_day(args.get("start"), today), end=_day(args.get("end"), today), list_id=args.get("list_id")),
                                           user=user, db=db)
        created.extend({"collection": "shopping_items", "id": a["id"]} for a in r["added"])
        return {"added": [{k: a[k] for k in ("name", "quantity", "unit")} for a in r["added"]], "already_on_list": r["already_on_list"], "in_stock": r["in_stock"],
                "units_not_comparable": r["units_not_comparable"], "not_listed": r["skipped"], "note": r["note"]}

    # ------------------------------------------------------------ recipes
    if name == "create_recipe":
        body = srv.RecipeBody(name=args.get("name"), servings=int(_num(args.get("servings"), "servings") or 1),
                              ingredients=[srv.RecipeIngredient(**{k: v for k, v in i.items() if k in ("name", "quantity", "unit", "food_id")}) for i in args.get("ingredients") or []],
                              calories=_num(args.get("calories"), "calories"), protein=_num(args.get("protein"), "protein"), carbs=_num(args.get("carbs"), "carbs"),
                              fat=_num(args.get("fat"), "fat"), notes=args.get("notes") or "")
        r = await srv.create_recipe(body, user, db)
        created.append({"collection": "recipes", "id": r["id"]})
        return {"created": _recipe_line(r)}
    if name == "update_recipe":
        key = str(args.get("recipe") or "").strip()
        r = (await db.execute(select(Recipe).where(Recipe.user_id == uid, (Recipe.id == key) | Recipe.name.ilike(key)))).scalars().first()
        if not r:
            return {"error": f"No recipe matching '{key}'"}
        ings = ([srv.RecipeIngredient(**{k: v for k, v in i.items() if k in ("name", "quantity", "unit", "food_id")}) for i in args["ingredients"]]
                if args.get("ingredients") is not None else [srv.RecipeIngredient(**i) for i in (r.ingredients or [])])
        body = srv.RecipeBody(name=args.get("new_name") or r.name, servings=int(_num(args.get("servings"), "servings") or r.servings), ingredients=ings,
                              calories=_num(args["calories"], "calories") if "calories" in args else (float(r.calories) if r.calories is not None else None),
                              protein=_num(args["protein"], "protein") if "protein" in args else (float(r.protein) if r.protein is not None else None),
                              carbs=_num(args["carbs"], "carbs") if "carbs" in args else (float(r.carbs) if r.carbs is not None else None),
                              fat=_num(args["fat"], "fat") if "fat" in args else (float(r.fat) if r.fat is not None else None),
                              notes=args["notes"] if "notes" in args else (r.notes or ""))
        srv.remember_before(created, "recipes", r)
        return {"updated": _recipe_line(await srv.update_recipe(r.id, body, user, db))}

    return {"error": "unknown tool"}
