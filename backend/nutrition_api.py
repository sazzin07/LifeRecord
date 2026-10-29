"""Nutrition: profile and targets, food database, food diary, hydration, trends, contributors and insights.

Everything is scoped to the signed-in user. Shared reference foods (`foods.user_id IS NULL`) are read-only. Diary entries
live in the existing `meals` table (so Home, the Calendar and older clients keep working) and carry a snapshot of the
nutrients at the time they were logged, so later changes to food data never rewrite history.
"""
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import nutrition_calc as calc
from models import Food, FoodFavorite, HydrationEntry, Meal, NutritionProfile, Recipe, WeightEntry
from nutrition_data import BY_KEY, DERIVED, GROUPS, KIND_LABEL, NUTRIENTS, SOURCES, derive, reference_for

ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"
TIME_RE = r"^([01]\d|2[0-3]):[0-5]\d$"
MEAL_TYPES = ("breakfast", "lunch", "dinner", "snack", "other")
BEVERAGES = ("water", "tea", "coffee", "other")
DIET_TAGS = ("vegan", "vegetarian", "gluten-free", "lactose-free")
ACTIVITY = ("sedentary", "moderate", "active", "very_active")
PREGNANCY = ("pregnant_t1", "pregnant_t2", "pregnant_t3", "lactating_0_6", "lactating_6plus")
MAX_RANGE_DAYS = 366
LOW_ENERGY_WARNING_KCAL = 1200  # an app safety rule, not an EFSA value
OFF_USER_AGENT = "LifeRecord/1.0 (personal nutrition diary)"
TRACKED_KEYS = [n["key"] for n in NUTRIENTS if n["key"] != "biotin_ug"]

# food categories used for "foods that could help" suggestions (whole foods; not oils, spices, baby food, fast food ...)
SUGGEST_CATEGORIES = {"Vegetables and Vegetable Products", "Fruits and Fruit Juices", "Dairy and Egg Products", "Cereal Grains and Pasta",
                      "Finfish and Shellfish Products", "Legumes and Legume Products", "Beef Products", "Nut and Seed Products",
                      "Poultry Products", "Pork Products"}
ANIMAL_CATS = {"Dairy and Egg Products", "Finfish and Shellfish Products", "Beef Products", "Poultry Products", "Pork Products", "Lamb, Veal, and Game Products"}
MEAT_CATS = ANIMAL_CATS - {"Dairy and Egg Products"}
DAIRY_WORDS = ("milk", "cheese", "yogurt", "yoghurt", "cream", "butter", "whey", "kefir")
GLUTEN_WORDS = ("wheat", "barley", "rye", "spelt", "couscous", "bulgur", "semolina", "pasta", "bread", "oat")


# ---------------------------------------------------------------- request models
class ProfileBody(BaseModel):
    birth_year: Optional[int] = Field(default=None, ge=1900, le=2100)
    sex: Optional[Literal["F", "M"]] = None
    height_cm: Optional[float] = Field(default=None, ge=50, le=250)
    weight_kg: Optional[float] = Field(default=None, ge=20, le=400)
    activity: Optional[Literal["sedentary", "moderate", "active", "very_active"]] = None
    pregnancy: Optional[Literal["pregnant_t1", "pregnant_t2", "pregnant_t3", "lactating_0_6", "lactating_6plus"]] = None
    diet_tags: List[Literal["vegan", "vegetarian", "gluten-free", "lactose-free"]] = []
    allergies: List[str] = Field(default=[], max_length=20)
    timezone: Optional[str] = Field(default=None, max_length=64)

    @field_validator("allergies")
    @classmethod
    def _clean_allergies(cls, v):
        out = []
        for a in v:
            a = (a or "").strip().lower()
            if a and len(a) <= 40 and a not in out:
                out.append(a)
        return out


class OverrideBody(BaseModel):
    min: Optional[float] = Field(default=None, ge=0)
    target: Optional[float] = Field(default=None, ge=0)
    max: Optional[float] = Field(default=None, ge=0)


class FoodBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    brand: Optional[str] = Field(default=None, max_length=255)
    category: Optional[str] = Field(default=None, max_length=150)
    nutrients: Dict[str, float]
    portions: List[Dict[str, Any]] = []


class DiaryBody(BaseModel):
    date: Optional[str] = Field(default=None, pattern=ISO_DATE)
    meal_type: Literal["breakfast", "lunch", "dinner", "snack", "other"] = "other"
    meal_label: Optional[str] = Field(default=None, max_length=100)
    eaten_at: Optional[str] = Field(default=None, pattern=TIME_RE)
    food_id: Optional[str] = Field(default=None, max_length=36)
    recipe_id: Optional[str] = Field(default=None, max_length=36)
    quantity: Optional[float] = Field(default=None, gt=0, le=100000)
    unit: Optional[str] = Field(default=None, max_length=50)
    description: Optional[str] = Field(default=None, max_length=500)
    calories: Optional[float] = Field(default=None, ge=0, le=50000)
    protein: Optional[float] = Field(default=None, ge=0, le=5000)
    carbs: Optional[float] = Field(default=None, ge=0, le=5000)
    fat: Optional[float] = Field(default=None, ge=0, le=5000)
    client_ref: Optional[str] = Field(default=None, max_length=64)


class DiaryUpdate(BaseModel):
    date: Optional[str] = Field(default=None, pattern=ISO_DATE)
    meal_type: Optional[Literal["breakfast", "lunch", "dinner", "snack", "other"]] = None
    meal_label: Optional[str] = Field(default=None, max_length=100)
    eaten_at: Optional[str] = Field(default=None, pattern=TIME_RE)
    quantity: Optional[float] = Field(default=None, gt=0, le=100000)
    unit: Optional[str] = Field(default=None, max_length=50)
    description: Optional[str] = Field(default=None, max_length=500)
    calories: Optional[float] = Field(default=None, ge=0, le=50000)
    protein: Optional[float] = Field(default=None, ge=0, le=5000)
    carbs: Optional[float] = Field(default=None, ge=0, le=5000)
    fat: Optional[float] = Field(default=None, ge=0, le=5000)
    if_updated_at: Optional[str] = Field(default=None, max_length=40)  # optimistic concurrency: refuse if changed meanwhile


class MoveBody(BaseModel):
    date: Optional[str] = Field(default=None, pattern=ISO_DATE)
    meal_type: Optional[Literal["breakfast", "lunch", "dinner", "snack", "other"]] = None
    eaten_at: Optional[str] = Field(default=None, pattern=TIME_RE)


class WaterBody(BaseModel):
    amount_ml: int = Field(..., gt=0, le=5000)
    beverage: Literal["water", "tea", "coffee", "other"] = "water"
    date: Optional[str] = Field(default=None, pattern=ISO_DATE)
    eaten_at: Optional[str] = Field(default=None, pattern=TIME_RE)


# ---------------------------------------------------------------- pure helpers
def clean_food_nutrients(raw: Dict[str, float]) -> Dict[str, float]:
    """Validate per-100 g values typed by a person. Unknown keys and impossible amounts are rejected."""
    out: Dict[str, float] = {}
    for k, v in raw.items():
        info = BY_KEY.get(k)
        if not info:
            raise HTTPException(422, f"Unknown nutrient '{k}'.")
        v = float(v)
        cap = {"kcal": 950, "g": 100, "mg": 100_000, "µg": 100_000_000, "µg DFE": 100_000_000}[info["unit"]]
        if v < 0 or v > cap:
            raise HTTPException(422, f"{info['name']} must be between 0 and {cap:g} {info['unit']} per 100 g.")
        out[k] = v
    if "energy_kcal" not in out:
        raise HTTPException(422, "Energy (kcal per 100 g) is required.")
    mass = sum(out.get(k, 0.0) for k in ("protein_g", "carbs_g", "fat_g", "alcohol_g", "water_g"))
    if mass > 105:
        raise HTTPException(422, "Protein, carbohydrate, fat, alcohol and water add up to more than 100 g per 100 g.")
    if out.get("sugars_g", 0) > out.get("carbs_g", 0) + 0.5 and "carbs_g" in out:
        raise HTTPException(422, "Sugars cannot exceed total carbohydrate.")
    if out.get("fiber_g", 0) > out.get("carbs_g", 0) + 0.5 and "carbs_g" in out:
        raise HTTPException(422, "Fibre cannot exceed total carbohydrate.")
    return out


def clean_portions(raw: List[Dict[str, Any]]) -> List[dict]:
    out = []
    for p in raw[:20]:
        label, grams = str(p.get("label", "")).strip()[:100], p.get("grams")
        if not label or not isinstance(grams, (int, float)) or not 0 < grams <= 5000:
            raise HTTPException(422, "Each portion needs a label and grams between 0 and 5000.")
        out.append({"label": label, "grams": round(float(grams), 2)})
    return out


def map_off_product(js: dict) -> Optional[dict]:
    """Open Food Facts product -> {name, brand, nutrients per 100 g, portions}. Only values the product actually lists;
    salt is converted to sodium (salt g x 0.4); micronutrients are not imported because OFF units are inconsistent."""
    p = (js or {}).get("product") or {}
    n = p.get("nutriments") or {}
    name = (p.get("product_name") or p.get("generic_name") or "").strip()
    kcal = n.get("energy-kcal_100g")
    if kcal is None and n.get("energy_100g") is not None:
        kcal = float(n["energy_100g"]) / 4.184  # kJ -> kcal
    if not name or kcal is None:
        return None
    mapping = {"protein_g": "proteins_100g", "carbs_g": "carbohydrates_100g", "fat_g": "fat_100g", "fiber_g": "fiber_100g",
               "sugars_g": "sugars_100g", "sat_fat_g": "saturated-fat_100g", "trans_fat_g": "trans-fat_100g"}
    out = {"energy_kcal": round(float(kcal), 1)}
    for key, off in mapping.items():
        if isinstance(n.get(off), (int, float)):
            out[key] = round(float(n[off]), 2)
    if isinstance(n.get("sodium_100g"), (int, float)):
        out["sodium_mg"] = round(float(n["sodium_100g"]) * 1000, 1)
    elif isinstance(n.get("salt_100g"), (int, float)):
        out["sodium_mg"] = round(float(n["salt_100g"]) * 0.4 * 1000, 1)
    try:
        out = clean_food_nutrients(out)
    except HTTPException:
        return None
    portions = []
    q = str(p.get("serving_quantity") or "")
    if re.fullmatch(r"\d+(\.\d+)?", q) and 0 < float(q) <= 5000 and (p.get("serving_size") or "").strip():
        portions.append({"label": f"1 serving ({p['serving_size'].strip()[:40]})", "grams": float(q)})
    return {"name": name[:255], "brand": ((p.get("brands") or "").split(",")[0].strip() or None), "nutrients": out, "portions": portions}


def search_rank(name_lower: str, q: str, source: str, mine: bool) -> tuple:
    words = re.split(r"[^a-z0-9]+", name_lower)
    first = q.split()[0] if q.split() else q
    return (0 if mine else 1, 0 if name_lower.startswith(q) else (1 if first in words else 2),
            {"user": 0, "usda_foundation": 1, "open_food_facts": 2, "usda_sr_legacy": 3}.get(source, 4), len(name_lower))


def like_escape(t: str) -> str:
    return t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def valid_date(s: str) -> date:
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, "Invalid date.")


def register(router, srv):
    get_user, get_db = srv.get_current_user, srv.get_db
    new_id, now_iso = srv.new_id, srv.now_iso

    # ------------------------------------------------------------ profile and targets
    def profile_dict(row: Optional[NutritionProfile]) -> dict:
        if not row:
            return {"birth_year": None, "sex": None, "height_cm": None, "weight_kg": None, "activity": None, "pregnancy": None,
                    "diet_tags": [], "allergies": [], "timezone": None, "target_overrides": {}, "exists": False}
        return {"birth_year": row.birth_year, "sex": row.sex, "height_cm": float(row.height_cm) if row.height_cm is not None else None,
                "weight_kg": float(row.weight_kg) if row.weight_kg is not None else None, "activity": row.activity, "pregnancy": row.pregnancy,
                "diet_tags": row.diet_tags or [], "allergies": row.allergies or [], "timezone": row.timezone,
                "target_overrides": row.target_overrides or {}, "exists": True}

    async def get_profile_row(db, uid) -> Optional[NutritionProfile]:
        return (await db.execute(select(NutritionProfile).where(NutritionProfile.user_id == uid))).scalar_one_or_none()

    def local_today(profile: dict) -> date:
        tz = profile.get("timezone")
        try:
            return datetime.now(ZoneInfo(tz)).date() if tz else datetime.now(timezone.utc).date()
        except ZoneInfoNotFoundError:
            return datetime.now(timezone.utc).date()

    async def reference(db, uid):
        prof = profile_dict(await get_profile_row(db, uid))
        weight, weight_src = prof["weight_kg"], "profile"
        if weight is None:
            w = (await db.execute(select(WeightEntry).where(WeightEntry.user_id == uid).order_by(WeightEntry.date.desc()).limit(1))).scalar_one_or_none()
            weight, weight_src = (float(w.weight), "latest weigh-in") if w else (None, None)
        today = local_today(prof)
        age = today.year - prof["birth_year"] if prof["birth_year"] else None
        ref = reference_for({"age": age, "sex": prof["sex"], "activity": prof["activity"], "pregnancy": prof["pregnancy"]}, weight)
        return ref, prof, {"kg": weight, "source": weight_src}, today

    @router.get("/nutrition/meta")
    async def meta():
        """The nutrient registry, groups, reference sources and the units the diary accepts."""
        return {"nutrients": [{k: n[k] for k in ("key", "name", "unit", "group", "about")} for n in NUTRIENTS]
                + [{"key": k, "name": v["name"], "unit": v["unit"], "group": v["group"], "about": v["about"], "derived": True} for k, v in DERIVED.items()],
                "groups": [{"key": k, "name": n} for k, n in GROUPS], "sources": SOURCES, "kinds": KIND_LABEL,
                "meal_types": MEAL_TYPES, "beverages": BEVERAGES, "diet_tags": DIET_TAGS, "activity": ACTIVITY, "pregnancy": PREGNANCY,
                "food_data": [{"name": "USDA FoodData Central", "licence": "Public domain (CC0)", "url": "https://fdc.nal.usda.gov",
                               "datasets": ["Foundation Foods 2025-12-18", "SR Legacy April 2018"]},
                              {"name": "Open Food Facts", "licence": "ODbL database licence", "url": "https://world.openfoodfacts.org",
                               "note": "Crowd-sourced packaged-food data, looked up by barcode; marked as estimated."}]}

    @router.get("/nutrition/profile")
    async def get_profile(user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        return profile_dict(await get_profile_row(db, user["_id"]))

    @router.put("/nutrition/profile")
    async def put_profile(body: ProfileBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        if body.timezone:
            try:
                ZoneInfo(body.timezone)
            except (ZoneInfoNotFoundError, ValueError):
                raise HTTPException(422, "Unknown time zone.")
        if body.pregnancy and body.sex != "F":
            raise HTTPException(422, "Pregnancy or breastfeeding can only be set when sex is F (the reference tables are defined for F/M).")
        row = await get_profile_row(db, user["_id"])
        if not row:
            row = NutritionProfile(id=new_id(), user_id=user["_id"], target_overrides={})
            db.add(row)
        for f in ("birth_year", "sex", "height_cm", "weight_kg", "activity", "pregnancy", "timezone"):
            setattr(row, f, getattr(body, f))
        row.diet_tags, row.allergies, row.updated_at = body.diet_tags, body.allergies, now_iso()
        await db.commit()
        return profile_dict(row)

    @router.delete("/nutrition/profile")
    async def delete_profile(user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        await db.execute(delete(NutritionProfile).where(NutritionProfile.user_id == user["_id"]))
        await db.commit()
        return {"deleted": True}

    @router.get("/nutrition/targets")
    async def get_targets(user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        ref, prof, weight, today = await reference(db, user["_id"])
        overrides = prof["target_overrides"]
        items = {}
        for key, it in ref["items"].items():
            ov = overrides.get(key)
            eff = {**it, **{k: ov[k] for k in ("min", "target", "max") if ov and ov.get(k) is not None}} if ov else dict(it)
            items[key] = {**eff, "suggested": {k: it.get(k) for k in ("min", "target", "max")}, "overridden": bool(ov)}
        return {"personalised": ref["personalised"], "supported": ref["supported"], "basis": ref["basis"], "notes": ref["notes"],
                "sources": ref["sources"], "weight": weight, "items": items, "overrides": overrides,
                "disclaimer": "Reference values describe what healthy adults generally need. They are not medical advice, and a low "
                              "recorded intake is not a diagnosis of deficiency. Talk to a doctor or dietitian about medical conditions."}

    @router.put("/nutrition/targets/{key}")
    async def set_target(key: str, body: OverrideBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        if key not in BY_KEY and key not in DERIVED:
            raise HTTPException(404, "Unknown nutrient.")
        vals = {k: v for k, v in body.model_dump().items() if v is not None}
        if not vals:
            raise HTTPException(422, "Give at least one of min, target or max.")
        if "min" in vals and "max" in vals and vals["min"] > vals["max"]:
            raise HTTPException(422, "The minimum cannot be above the maximum.")
        if "target" in vals and "max" in vals and vals["target"] > vals["max"] or "target" in vals and "min" in vals and vals["target"] < vals["min"]:
            raise HTTPException(422, "The target must lie between the minimum and the maximum.")
        row = await get_profile_row(db, user["_id"])
        if not row:
            row = NutritionProfile(id=new_id(), user_id=user["_id"], target_overrides={})
            db.add(row)
        ov = dict(row.target_overrides or {})
        ov[key] = vals
        row.target_overrides, row.updated_at = ov, now_iso()
        await db.commit()
        warning = None
        if key == "energy_kcal" and vals.get("target", 1e9) < LOW_ENERGY_WARNING_KCAL:
            warning = (f"A daily energy target under {LOW_ENERGY_WARNING_KCAL} kcal is very low for most adults. It was saved because it is your "
                       "choice, but please talk to a doctor or dietitian before eating this little for more than a short time.")
        return {"key": key, "override": vals, "warning": warning}

    @router.delete("/nutrition/targets/{key}")
    async def clear_target(key: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        row = await get_profile_row(db, user["_id"])
        if row and row.target_overrides and key in row.target_overrides:
            ov = dict(row.target_overrides)
            ov.pop(key)
            row.target_overrides = ov
            await db.commit()
        return {"key": key, "override": None}

    # ------------------------------------------------------------ foods
    def food_summary(f: Food, uid: str, favs: set) -> dict:
        n = f.nutrients or {}
        reported = sum(1 for k in TRACKED_KEYS if k in n)
        return {"id": f.id, "name": f.name, "brand": f.brand, "category": f.category, "source": f.source, "quality": f.quality,
                "data_version": f.data_version, "barcode": f.barcode, "mine": f.user_id == uid, "favorite": f.id in favs,
                "per100": {k: n.get(k) for k in ("energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g")},
                "completeness": {"reported": reported, "of": len(TRACKED_KEYS)}, "portions": f.portions or []}

    async def favorites_of(db, uid) -> set:
        return set((await db.execute(select(FoodFavorite.food_id).where(FoodFavorite.user_id == uid))).scalars().all())

    def food_flags(f: Food, prof: dict) -> List[str]:
        """Name-based hints only; ingredient lists are not known for generic foods."""
        flags, name, cat = [], f.name_lower, f.category or ""
        for a in prof.get("allergies", []):
            if a and a in name:
                flags.append(f"Name contains '{a}' (one of your allergies/avoids)")
        tags = prof.get("diet_tags", [])
        if "vegan" in tags and cat in ANIMAL_CATS:
            flags.append("Animal product (you chose vegan)")
        elif "vegetarian" in tags and cat in MEAT_CATS:
            flags.append("Meat or fish (you chose vegetarian)")
        if "lactose-free" in tags and any(w in name for w in DAIRY_WORDS):
            flags.append("Looks like a dairy food (you chose lactose-free)")
        if "gluten-free" in tags and any(w in name for w in GLUTEN_WORDS):
            flags.append("May contain gluten (you chose gluten-free)")
        return flags

    @router.get("/nutrition/foods/search")
    async def search_foods(q: str = Query(..., min_length=1, max_length=100), limit: int = Query(25, ge=1, le=100),
                           scope: Literal["all", "mine", "favorites"] = "all", user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        terms = [t for t in re.split(r"\s+", q.strip().lower()) if t][:6]
        if not terms:
            return []
        conds = [Food.name_lower.like(f"%{like_escape(t)}%", escape="\\") for t in terms]
        stmt = select(Food).where(or_(Food.user_id == uid, Food.user_id.is_(None)), and_(*conds))
        favs = await favorites_of(db, uid)
        if scope == "mine":
            stmt = stmt.where(Food.user_id == uid)
        elif scope == "favorites":
            stmt = stmt.where(Food.id.in_(favs or {""}))
        rows = (await db.execute(stmt.order_by(func.length(Food.name_lower)).limit(400))).scalars().all()
        qn = " ".join(terms)
        rows.sort(key=lambda f: search_rank(f.name_lower, qn, "user" if f.user_id else f.source, f.user_id == uid))
        prof = profile_dict(await get_profile_row(db, uid))
        out = []
        for f in rows[:limit]:
            s = food_summary(f, uid, favs)
            s["flags"] = food_flags(f, prof)
            out.append(s)
        return out

    @router.get("/nutrition/foods/recent")
    async def recent_foods(limit: int = Query(12, ge=1, le=50), user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        since = (date.today() - timedelta(days=60)).isoformat()
        rows = (await db.execute(select(Meal.food_id, func.count(Meal.id), func.max(Meal.date)).where(
            Meal.user_id == uid, Meal.food_id.is_not(None), Meal.date >= since).group_by(Meal.food_id)
            .order_by(func.max(Meal.date).desc(), func.count(Meal.id).desc()).limit(limit))).all()
        ids = [r[0] for r in rows]
        foods = {f.id: f for f in (await db.execute(select(Food).where(Food.id.in_(ids or [""])))).scalars().all()}
        favs = await favorites_of(db, uid)
        return [{**food_summary(foods[i], uid, favs), "times_logged": c, "last_logged": d} for i, c, d in rows if i in foods]

    @router.get("/nutrition/foods/mine")
    async def my_foods(user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        favs = await favorites_of(db, uid)
        foods = (await db.execute(select(Food).where(Food.user_id == uid).order_by(Food.name))).scalars().all()
        return [food_summary(f, uid, favs) for f in foods]

    @router.get("/nutrition/foods/favorites")
    async def favorite_foods(user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        favs = await favorites_of(db, uid)
        foods = (await db.execute(select(Food).where(Food.id.in_(favs or {""})).order_by(Food.name))).scalars().all()
        return [food_summary(f, uid, favs) for f in foods]

    async def visible_food(db, uid, fid) -> Food:
        f = (await db.execute(select(Food).where(Food.id == fid, or_(Food.user_id == uid, Food.user_id.is_(None))))).scalar_one_or_none()
        if not f:
            raise HTTPException(404, "Food not found")
        return f

    def food_detail(f: Food, uid: str, favs: set) -> dict:
        base = food_summary(f, uid, favs)
        n = f.nutrients or {}
        base["nutrients"] = [{"key": x["key"], "name": x["name"], "unit": x["unit"], "group": x["group"], "per100": n.get(x["key"])} for x in NUTRIENTS]
        base["energy_check"] = calc.energy_from_macros(n)
        base["units"] = ["g", "oz"] + [p["label"] for p in (f.portions or [])]
        base["liquid"] = calc.is_liquid({"name": f.name, "category": f.category, "nutrients": n})
        return base

    @router.get("/nutrition/foods/barcode/{code}")
    async def food_by_barcode(code: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        if not re.fullmatch(r"\d{8,14}", code):
            raise HTTPException(422, "A barcode has 8 to 14 digits.")
        uid = user["_id"]
        f = (await db.execute(select(Food).where(Food.barcode == code, or_(Food.user_id == uid, Food.user_id.is_(None))))).scalars().first()
        if f:
            return food_detail(f, uid, await favorites_of(db, uid))
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10, connect=5), headers={"User-Agent": OFF_USER_AGENT}) as client:
                r = await client.get(f"https://world.openfoodfacts.org/api/v2/product/{code}.json",
                                     params={"fields": "product_name,generic_name,brands,nutriments,serving_size,serving_quantity"})
        except httpx.HTTPError:
            raise HTTPException(503, "The packaged-food database (Open Food Facts) is not reachable right now. Try again, or add the food by hand.")
        if r.status_code == 404 or (r.status_code == 200 and r.json().get("status") == 0):
            raise HTTPException(404, "This barcode is not in Open Food Facts. You can add the food by hand from its label.")
        if r.status_code != 200:
            raise HTTPException(503, "Open Food Facts could not answer right now.")
        mapped = map_off_product(r.json())
        if not mapped:
            raise HTTPException(404, "Open Food Facts has this product but without usable nutrition values. Add the food by hand from its label.")
        f = Food(id=new_id(), user_id=None, source="open_food_facts", source_id=code, name=mapped["name"], name_lower=mapped["name"].lower()[:255],
                 brand=mapped["brand"], barcode=code, category="Packaged food", quality="estimated", nutrients=mapped["nutrients"],
                 portions=mapped["portions"], data_version="Open Food Facts (looked up " + date.today().isoformat() + ")",
                 created_at=now_iso(), updated_at=now_iso())
        db.add(f)
        await db.commit()
        return food_detail(f, uid, await favorites_of(db, uid))

    @router.get("/nutrition/foods/{fid}")
    async def get_food(fid: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        f = await visible_food(db, user["_id"], fid)
        return food_detail(f, user["_id"], await favorites_of(db, user["_id"]))

    @router.post("/nutrition/foods")
    async def create_food(body: FoodBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        name = body.name.strip()
        dup = (await db.execute(select(Food).where(Food.user_id == uid, Food.name_lower == name.lower()[:255],
                                                   func.coalesce(Food.brand, "") == (body.brand or "").strip()))).scalar_one_or_none()
        if dup:
            raise HTTPException(409, "You already have a food with this name and brand.")
        f = Food(id=new_id(), user_id=uid, source="user", name=name, name_lower=name.lower()[:255], brand=(body.brand or "").strip() or None,
                 category=body.category, quality="user", nutrients=clean_food_nutrients(body.nutrients), portions=clean_portions(body.portions),
                 data_version="Entered by you", created_at=now_iso(), updated_at=now_iso())
        db.add(f)
        await db.commit()
        return food_detail(f, uid, set())

    @router.put("/nutrition/foods/{fid}")
    async def update_food(fid: str, body: FoodBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        f = (await db.execute(select(Food).where(Food.id == fid, Food.user_id == user["_id"]))).scalar_one_or_none()
        if not f:
            raise HTTPException(404, "Food not found (shared reference foods cannot be edited; create your own version instead).")
        f.name, f.name_lower, f.brand, f.category = body.name.strip(), body.name.strip().lower()[:255], (body.brand or "").strip() or None, body.category
        f.nutrients, f.portions, f.updated_at = clean_food_nutrients(body.nutrients), clean_portions(body.portions), now_iso()
        await db.commit()
        return food_detail(f, user["_id"], await favorites_of(db, user["_id"]))

    @router.delete("/nutrition/foods/{fid}")
    async def delete_food(fid: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        r = await db.execute(delete(Food).where(Food.id == fid, Food.user_id == user["_id"]))
        await db.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Food not found (shared reference foods cannot be removed).")
        return {"deleted": fid}  # diary entries keep their own nutrient snapshot

    @router.post("/nutrition/foods/{fid}/favorite")
    async def favorite(fid: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        await visible_food(db, user["_id"], fid)
        if fid not in await favorites_of(db, user["_id"]):
            db.add(FoodFavorite(id=new_id(), user_id=user["_id"], food_id=fid, created_at=now_iso()))
            await db.commit()
        return {"id": fid, "favorite": True}

    @router.delete("/nutrition/foods/{fid}/favorite")
    async def unfavorite(fid: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        await db.execute(delete(FoodFavorite).where(FoodFavorite.user_id == user["_id"], FoodFavorite.food_id == fid))
        await db.commit()
        return {"id": fid, "favorite": False}

    # ------------------------------------------------------------ diary
    def entry_nutrients(m: Meal) -> dict:
        if m.nutrients:
            return {k: float(v) for k, v in m.nutrients.items()}
        return calc.quick_nutrients(None if m.calories is None else float(m.calories), None if m.protein is None else float(m.protein),
                                    None if m.carbs is None else float(m.carbs), None if m.fat is None else float(m.fat))

    def entry_view(m: Meal) -> dict:
        n = entry_nutrients(m)
        return {"id": m.id, "date": m.date, "meal_type": m.meal_type or "other", "meal_label": m.meal_label, "eaten_at": m.eaten_at,
                "description": m.description, "food_id": m.food_id, "recipe_id": m.recipe_id,
                "quantity": float(m.quantity) if m.quantity is not None else None, "unit": m.unit,
                "grams": float(m.grams) if m.grams is not None else None, "nutrients": n,
                "quality": m.quality or "user", "source": m.entry_source or "quick", "updated_at": m.updated_at or m.created_at,
                "created_at": m.created_at}

    def apply_nutrients(m: Meal, n: dict):
        m.nutrients = n
        m.calories = round(n["energy_kcal"], 1) if "energy_kcal" in n else None
        m.protein = round(n["protein_g"], 1) if "protein_g" in n else None
        m.carbs = round(n["carbs_g"], 1) if "carbs_g" in n else None
        m.fat = round(n["fat_g"], 1) if "fat_g" in n else None

    async def recipe_entry(db, uid, rid, servings) -> dict:
        r = (await db.execute(select(Recipe).where(Recipe.id == rid, Recipe.user_id == uid))).scalar_one_or_none()
        if not r:
            raise HTTPException(404, "Recipe not found")
        # A recipe's own numbers (calories, protein, ...) are for the WHOLE recipe, as in the recipes screen and "cook"; one
        # serving is that divided by the number of servings. Calculated `nutrients` are already per serving.
        n_serv = max(int(r.servings or 1), 1)
        per = r.nutrients or {k: v / n_serv for k, v in calc.quick_nutrients(
            None if r.calories is None else float(r.calories), None if r.protein is None else float(r.protein),
            None if r.carbs is None else float(r.carbs), None if r.fat is None else float(r.fat)).items()}
        if not per:
            raise HTTPException(422, "This recipe has no nutrition values yet. Add them or link its ingredients to foods first.")
        return {"description": f"{r.name}", "nutrients": {k: float(v) * servings for k, v in per.items()}, "quality": r.quality or "user"}

    async def build_entry(db, uid, body) -> dict:
        """Everything a new/replaced entry needs, from either a food, a recipe or typed numbers."""
        if body.food_id and body.recipe_id:
            raise HTTPException(422, "Choose either a food or a recipe, not both.")
        if body.food_id:
            if body.quantity is None:
                raise HTTPException(422, "Give a quantity.")
            f = await visible_food(db, uid, body.food_id)
            try:
                e = calc.entry_from_food({"name": f.name, "category": f.category, "nutrients": f.nutrients, "portions": f.portions}, body.quantity, body.unit or "g")
            except calc.PortionError as exc:
                raise HTTPException(422, str(exc))
            label = f.name + (f" ({f.brand})" if f.brand else "")
            return {"description": body.description or label, "nutrients": e["nutrients"], "grams": e["grams"],
                    "quality": "estimated" if e["approximate"] else f.quality, "source": "food", "unit": body.unit or "g"}
        if body.recipe_id:
            servings = body.quantity or 1
            r = await recipe_entry(db, uid, body.recipe_id, servings)
            return {**r, "grams": None, "source": "recipe", "unit": "serving"}
        if not body.description or all(v is None for v in (body.calories, body.protein, body.carbs, body.fat)):
            raise HTTPException(422, "Pick a food or recipe, or describe the meal and give at least its calories.")
        return {"description": body.description, "nutrients": calc.quick_nutrients(body.calories, body.protein, body.carbs, body.fat),
                "grams": None, "quality": "user", "source": "quick", "unit": None}

    @router.post("/nutrition/diary")
    async def add_entry(body: DiaryBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        if body.client_ref:
            dup = (await db.execute(select(Meal).where(Meal.user_id == uid, Meal.client_ref == body.client_ref))).scalar_one_or_none()
            if dup:
                return {**entry_view(dup), "duplicate": True}
        _, prof, _, today = await reference(db, uid)
        e = await build_entry(db, uid, body)
        m = Meal(id=new_id(), user_id=uid, description=e["description"], date=body.date or today.isoformat(), created_at=now_iso(), updated_at=now_iso(),
                 meal_type=body.meal_type, meal_label=body.meal_label, eaten_at=body.eaten_at, food_id=body.food_id, recipe_id=body.recipe_id,
                 quantity=body.quantity, unit=e["unit"], grams=e["grams"], quality=e["quality"], entry_source=e["source"], client_ref=body.client_ref)
        apply_nutrients(m, e["nutrients"])
        db.add(m)
        await db.commit()
        await db.refresh(m)
        return entry_view(m)

    async def own_entry(db, uid, mid) -> Meal:
        m = (await db.execute(select(Meal).where(Meal.id == mid, Meal.user_id == uid))).scalar_one_or_none()
        if not m:
            raise HTTPException(404, "Diary entry not found")
        return m

    @router.put("/nutrition/diary/{mid}")
    async def update_entry(mid: str, body: DiaryUpdate, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        m = await own_entry(db, uid, mid)
        if body.if_updated_at and body.if_updated_at != (m.updated_at or m.created_at):
            raise HTTPException(409, "This entry was changed somewhere else. Reload it and try again.")
        for f in ("date", "meal_type", "meal_label", "eaten_at", "description"):
            v = getattr(body, f)
            if v is not None:
                setattr(m, f, v)
        if m.food_id and (body.quantity is not None or body.unit is not None):
            f = await visible_food(db, uid, m.food_id)
            qty, unit = body.quantity or float(m.quantity), body.unit or m.unit or "g"
            try:
                e = calc.entry_from_food({"name": f.name, "category": f.category, "nutrients": f.nutrients, "portions": f.portions}, qty, unit)
            except calc.PortionError as exc:
                raise HTTPException(422, str(exc))
            m.quantity, m.unit, m.grams = qty, unit, e["grams"]
            m.quality = "estimated" if e["approximate"] else f.quality
            apply_nutrients(m, e["nutrients"])
        elif m.recipe_id and body.quantity is not None:
            r = await recipe_entry(db, uid, m.recipe_id, body.quantity)
            m.quantity = body.quantity
            apply_nutrients(m, r["nutrients"])
        elif not m.food_id and not m.recipe_id and any(getattr(body, k) is not None for k in ("calories", "protein", "carbs", "fat")):
            cur = entry_nutrients(m)
            for key, v in (("energy_kcal", body.calories), ("protein_g", body.protein), ("carbs_g", body.carbs), ("fat_g", body.fat)):
                if v is not None:
                    cur[key] = float(v)
            apply_nutrients(m, cur)
        m.updated_at = now_iso()
        await db.commit()
        await db.refresh(m)
        return entry_view(m)

    @router.delete("/nutrition/diary/{mid}")
    async def delete_entry(mid: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        r = await db.execute(delete(Meal).where(Meal.id == mid, Meal.user_id == user["_id"]))
        await db.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Diary entry not found")
        return {"deleted": mid}

    @router.post("/nutrition/diary/{mid}/duplicate")
    async def duplicate_entry(mid: str, body: MoveBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        src = await own_entry(db, user["_id"], mid)
        m = Meal(id=new_id(), user_id=user["_id"], description=src.description, date=body.date or src.date, created_at=now_iso(), updated_at=now_iso(),
                 meal_type=body.meal_type or src.meal_type, meal_label=src.meal_label, eaten_at=body.eaten_at or src.eaten_at, food_id=src.food_id,
                 recipe_id=src.recipe_id, quantity=src.quantity, unit=src.unit, grams=src.grams, quality=src.quality, entry_source=src.entry_source)
        apply_nutrients(m, entry_nutrients(src))
        db.add(m)
        await db.commit()
        await db.refresh(m)
        return entry_view(m)

    @router.post("/nutrition/diary/{mid}/move")
    async def move_entry(mid: str, body: MoveBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        m = await own_entry(db, user["_id"], mid)
        for f in ("date", "meal_type", "eaten_at"):
            v = getattr(body, f)
            if v is not None:
                setattr(m, f, v)
        m.updated_at = now_iso()
        await db.commit()
        await db.refresh(m)
        return entry_view(m)

    # ------------------------------------------------------------ hydration
    @router.post("/nutrition/water")
    async def add_water(body: WaterBody, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        _, _, _, today = await reference(db, user["_id"])
        h = HydrationEntry(id=new_id(), user_id=user["_id"], date=body.date or today.isoformat(), eaten_at=body.eaten_at,
                           amount_ml=body.amount_ml, beverage=body.beverage, created_at=now_iso())
        db.add(h)
        await db.commit()
        return {"id": h.id, "date": h.date, "eaten_at": h.eaten_at, "amount_ml": h.amount_ml, "beverage": h.beverage}

    @router.delete("/nutrition/water/{hid}")
    async def delete_water(hid: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        r = await db.execute(delete(HydrationEntry).where(HydrationEntry.id == hid, HydrationEntry.user_id == user["_id"]))
        await db.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Entry not found")
        return {"deleted": hid}

    # ------------------------------------------------------------ the day
    def day_summary(entries: List[dict], water_rows: List[HydrationEntry], ref: dict, overrides: dict) -> dict:
        s = calc.sum_nutrients([e["nutrients"] for e in entries])
        totals = s["totals"]
        groups: Dict[str, dict] = {}
        for t in MEAL_TYPES:
            group = [e for e in entries if e["meal_type"] == t]
            if group:
                gs = calc.sum_nutrients([e["nutrients"] for e in group])
                groups[t] = {"meal_type": t, "entries": group, "totals": gs["totals"], "macro_shares": calc.macro_shares(gs["totals"])}
        drinks = sum(w.amount_ml for w in water_rows)
        food_water = totals.get("water_g", 0.0)
        water_target = ref["items"].get("water_ml", {}).get("target")
        quality_counts: Dict[str, int] = defaultdict(int)
        for e in entries:
            quality_counts[e["quality"]] += 1
        energy_target = (overrides.get("energy_kcal") or {}).get("target") or ref["items"].get("energy_kcal", {}).get("target")
        return {"totals": totals, "reported": s["reported"], "entries": s["entries"], "meals": list(groups.values()),
                "progress": calc.progress(totals, s["reported"], s["entries"], ref["items"], overrides) if ref.get("items") else {},
                "macro_shares": calc.macro_shares(totals), "energy_check": calc.energy_from_macros(totals), "quality": dict(quality_counts),
                "energy_target": energy_target,
                "hydration": {"drinks_ml": drinks, "food_water_ml": round(food_water), "total_ml": round(drinks + food_water), "target_ml": water_target,
                              "entries": [{"id": w.id, "amount_ml": w.amount_ml, "beverage": w.beverage, "eaten_at": w.eaten_at} for w in water_rows],
                              "note": "EFSA's value is for TOTAL water: drinks plus the water in food. Food water counts only for foods logged with data."}}

    @router.get("/nutrition/day")
    async def get_day(date_: Optional[str] = Query(None, alias="date", pattern=ISO_DATE), user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        ref, prof, weight, today = await reference(db, uid)
        day = date_ or today.isoformat()
        valid_date(day)
        meals = (await db.execute(select(Meal).where(Meal.user_id == uid, Meal.date == day).order_by(Meal.eaten_at, Meal.created_at))).scalars().all()
        water = (await db.execute(select(HydrationEntry).where(HydrationEntry.user_id == uid, HydrationEntry.date == day).order_by(HydrationEntry.eaten_at, HydrationEntry.created_at))).scalars().all()
        out = day_summary([entry_view(m) for m in meals], water, ref, prof["target_overrides"])
        out.update({"date": day, "today": today.isoformat(), "reference": {"personalised": ref["personalised"], "basis": ref["basis"], "notes": ref["notes"], "supported": ref["supported"]}})
        return out

    # ------------------------------------------------------------ trends, contributors, insights
    @router.get("/nutrition/trends")
    async def trends(days: int = Query(7, ge=1, le=MAX_RANGE_DAYS), end: Optional[str] = Query(None, pattern=ISO_DATE),
                     user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        ref, prof, _, today = await reference(db, uid)
        last = valid_date(end) if end else today
        start = last - timedelta(days=days - 1)
        s, e = start.isoformat(), last.isoformat()
        meals = (await db.execute(select(Meal).where(Meal.user_id == uid, Meal.date >= s, Meal.date <= e))).scalars().all()
        water = (await db.execute(select(HydrationEntry).where(HydrationEntry.user_id == uid, HydrationEntry.date >= s, HydrationEntry.date <= e))).scalars().all()
        by_day: Dict[str, list] = defaultdict(list)
        for m in meals:
            by_day[m.date].append(entry_nutrients(m))
        drinks: Dict[str, int] = defaultdict(int)
        for w in water:
            drinks[w.date] += w.amount_ml
        series, logged = [], []
        for i in range(days):
            d = (start + timedelta(days=i)).isoformat()
            tot = calc.sum_nutrients(by_day.get(d, []))["totals"] if d in by_day else {}
            series.append({"date": d, "logged": d in by_day, "entries": len(by_day.get(d, [])), "drinks_ml": drinks.get(d, 0),
                           **{k: tot.get(k) for k in ("energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sat_fat_g", "sodium_mg")}})
            if d in by_day:
                logged.append((d, tot))
        reported_days = {k: sum(1 for _, t in logged if k in t) for k in TRACKED_KEYS}
        # average over the days that REPORTED a nutrient: a day with no data for it is unknown, not zero
        avg = {k: (sum(t[k] for _, t in logged if k in t) / reported_days[k]) if reported_days[k] else None for k in TRACKED_KEYS}
        prog = calc.progress({k: v for k, v in avg.items() if v is not None}, {k: reported_days[k] for k in TRACKED_KEYS if avg[k] is not None},
                             len(logged), ref["items"], prof["target_overrides"]) if logged else {}
        return {"start": s, "end": e, "days": days, "days_logged": len(logged), "series": series, "daily_average": avg, "days_reporting": reported_days,
                "progress": prog, "note": "Averages use only the days with something logged; a day without entries is not counted as zero."}

    @router.get("/nutrition/contributors")
    async def contributors(nutrient: str, start: str = Query(..., pattern=ISO_DATE), end: str = Query(..., pattern=ISO_DATE), limit: int = Query(10, ge=1, le=50),
                           user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        if nutrient not in BY_KEY:
            raise HTTPException(404, "Unknown nutrient.")
        if (valid_date(end) - valid_date(start)).days < 0 or (valid_date(end) - valid_date(start)).days >= MAX_RANGE_DAYS:
            raise HTTPException(422, f"Range must run forwards and cover at most {MAX_RANGE_DAYS} days.")
        meals = (await db.execute(select(Meal).where(Meal.user_id == user["_id"], Meal.date >= start, Meal.date <= end))).scalars().all()
        per: Dict[str, float] = defaultdict(float)
        total, missing = 0.0, 0
        for m in meals:
            v = entry_nutrients(m).get(nutrient)
            if v is None:
                missing += 1
                continue
            per[m.description] += v
            total += v
        top = sorted(per.items(), key=lambda kv: -kv[1])[:limit]
        info = BY_KEY[nutrient]
        return {"nutrient": nutrient, "name": info["name"], "unit": info["unit"], "total": total, "entries": len(meals), "entries_without_data": missing,
                "top": [{"description": d, "amount": a, "share_pct": a / total * 100 if total else None} for d, a in top]}

    async def suggest_foods(db, key: str, target: float, prof: dict, limit: int = 4) -> List[dict]:
        """Whole foods that are rich in a nutrient (per 100 g), honouring diet choices. Transparent: shows the amount."""
        # Foundation Foods only: ~380 analysed whole foods. The much larger SR Legacy set is full of by-products, flours and
        # brand-style entries that make poor suggestions.
        cond = [Food.user_id.is_(None), Food.category.in_(SUGGEST_CATEGORIES), Food.source == "usda_foundation"]
        rows = (await db.execute(select(Food).where(*cond))).scalars().all()
        scored = []
        for f in rows:
            v = (f.nutrients or {}).get(key)
            if v is None or v <= 0 or food_flags(f, prof):
                continue
            if f.nutrients.get("energy_kcal", 0) > 900:
                continue
            scored.append((v, f))
        scored.sort(key=lambda x: -x[0])
        seen, out = set(), []
        for v, f in scored:
            stem = f.name_lower.split(",")[0]
            if stem in seen:
                continue
            seen.add(stem)
            out.append({"food_id": f.id, "name": f.name, "amount_per_100g": v, "percent_of_target_per_100g": v / target * 100 if target else None})
            if len(out) >= limit:
                break
        return out

    @router.get("/nutrition/insights")
    async def insights(date_: Optional[str] = Query(None, alias="date", pattern=ISO_DATE), user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        uid = user["_id"]
        ref, prof, _, today = await reference(db, uid)
        day = date_ or today.isoformat()
        valid_date(day)
        meals = (await db.execute(select(Meal).where(Meal.user_id == uid, Meal.date == day))).scalars().all()
        if not meals:
            return {"date": day, "insights": [], "note": "Nothing is logged for this day yet, so there is nothing to compare."}
        s = calc.sum_nutrients([entry_nutrients(m) for m in meals])
        prog = calc.progress(s["totals"], s["reported"], s["entries"], ref["items"], prof["target_overrides"])
        out = []
        for key in ("fiber_g", "protein_g", "vit_c_mg", "calcium_mg", "iron_mg", "magnesium_mg", "potassium_mg", "vit_a_ug", "folate_ug", "vit_d_ug"):
            p = prog.get(key)
            if not p or p["status"] == "no_data" or not p["target"] or p["percent"] >= 60:
                continue
            tip = await suggest_foods(db, key, p["target"], prof)
            out.append({"nutrient": key, "title": f"{BY_KEY[key]['name']} is low so far today", "percent": p["percent"], "complete": p["complete"],
                        "why": f"{p['intake']:.3g} of {p['target']:.3g} {p['unit']} ({p['percent']:.0f}%) from what you have logged"
                               + ("" if p["complete"] else f"; {p['entries'] - p['entries_reporting']} of {p['entries']} entries have no {BY_KEY[key]['name'].lower()} data, so the true amount may be higher")
                               + ". A low recorded intake for one day is not a deficiency.",
                        "foods": tip, "foods_note": "Whole foods richest in this nutrient per 100 g in the USDA data" + (", respecting your diet choices" if prof["diet_tags"] or prof["allergies"] else "") + "."})
        for key in ("sodium_mg", "sat_fat_g", "sugars_g"):
            p = prog.get(key)
            if p and p["status"] == "over":
                out.append({"nutrient": key, "title": f"{BY_KEY[key]['name']} is above the guideline limit", "percent": p["percent"] if p["percent"] else None,
                            "why": f"{p['intake']:.3g} {p['unit']} against a limit of {p['max']:.3g}. {p['note']}", "foods": []})
        return {"date": day, "insights": out[:6], "reference_basis": ref["basis"]}

    @router.get("/nutrition/rich-in")
    async def rich_in(nutrient: str, limit: int = Query(6, ge=1, le=20), user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        """Whole foods with the most of a nutrient per 100 g in the USDA data, honouring the person's diet choices."""
        if nutrient not in BY_KEY:
            raise HTTPException(404, "Unknown nutrient.")
        ref, prof, _, _ = await reference(db, user["_id"])
        target = (ref["items"].get(nutrient) or {}).get("target")
        return {"nutrient": nutrient, "foods": await suggest_foods(db, nutrient, target, prof, limit),
                "note": "Whole foods richest in this nutrient per 100 g. Food data can be incomplete, so a food missing from this list is not necessarily low in it."}

    return {"entry_view": entry_view, "entry_nutrients": entry_nutrients}
