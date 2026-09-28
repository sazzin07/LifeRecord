from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import json
import logging
import tempfile
from datetime import datetime, timezone, timedelta

import jwt
import bcrypt
import requests
from bson import ObjectId
from fastapi import FastAPI, APIRouter, Request, HTTPException, Depends, UploadFile, File, Header, Query, Response
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
OWNER_NAME = os.environ.get('OWNER_NAME', 'Sá')
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

app = FastAPI(title="Life Manager")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lifemanager")


# ---------------------------------------------------------------------------
# Object storage (Emergent) for progress photos
# ---------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "life-manager"
_storage_key = None


def init_storage(force: bool = False):
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def month_of(date_str: str) -> str:
    # date_str like 2025-09-25 -> 2025-09
    return date_str[:7]


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email,
               "exp": datetime.now(timezone.utc) + timedelta(days=30), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(request: Request) -> dict:
    token = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginBody(BaseModel):
    email: str
    password: str


class PersonBody(BaseModel):
    name: str
    photo: Optional[str] = None
    notes: Optional[str] = ""
    payment_preference: Optional[str] = ""


class CategoryBody(BaseModel):
    name: str
    icon: str = "circle"
    color: str = "#64748B"


class ItemBody(BaseModel):
    name: str
    price: float
    assigned: List[str] = ["Me"]


class ExpenseBody(BaseModel):
    amount: Optional[float] = None
    description: str = ""
    category: str = "Other"
    account: str = "cash"          # cash | revolut
    merchant: str = ""
    date: Optional[str] = None      # yyyy-mm-dd
    notes: str = ""
    participants: List[str] = ["Me"]
    split_mode: str = "equal"      # equal | items | exact
    items: List[ItemBody] = []
    exact_shares: Dict[str, float] = {}
    paid_by: str = "Me"
    add_to_inventory: bool = False


class SettlementBody(BaseModel):
    person: str
    amount: float
    method: str = "Revolut"       # MB WAY | Revolut | Cash
    account: str = "revolut"       # which of my accounts receives/pays it
    direction: str = "in"          # in = they paid me ; out = I paid them
    date: Optional[str] = None
    transaction_id: Optional[str] = None


class TransferBody(BaseModel):
    from_account: str
    to_account: str
    amount: float
    date: Optional[str] = None
    notes: str = ""


class IncomeBody(BaseModel):
    account: str
    amount: float
    description: str = ""
    date: Optional[str] = None


class TaskBody(BaseModel):
    title: str
    priority: str = "normal"       # low | normal | high
    due: Optional[str] = None
    recurring: Optional[str] = None
    done: bool = False


class WeightBody(BaseModel):
    weight: float
    date: Optional[str] = None
    note: str = ""


class GroceryBody(BaseModel):
    name: str
    quantity: float = 1
    unit: str = "unit"
    category: str = "Other"
    price: Optional[float] = None
    store: Optional[str] = None
    low_threshold: float = 0
    notes: str = ""
    expiration: Optional[str] = None


class GroceryUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    store: Optional[str] = None
    low_threshold: Optional[float] = None
    notes: Optional[str] = None
    expiration: Optional[str] = None


class TxnUpdate(BaseModel):
    description: Optional[str] = None
    category: Optional[str] = None
    account: Optional[str] = None          # cash | revolut
    payment_method: Optional[str] = None   # cash | card
    date: Optional[str] = None
    notes: Optional[str] = None
    amount: Optional[float] = None
    personal_amount: Optional[float] = None


class MealBody(BaseModel):
    description: str
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    date: Optional[str] = None


class ShoppingBody(BaseModel):
    name: str
    quantity: float = 1
    unit: str = "unit"
    note: str = ""


class BuyBody(BaseModel):
    price: Optional[float] = None
    store: Optional[str] = None


class RecipeIngredient(BaseModel):
    name: str
    quantity: float = 1
    unit: str = "unit"


class RecipeBody(BaseModel):
    name: str
    servings: int = 1
    ingredients: List[RecipeIngredient] = []
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    notes: str = ""


class AIChatBody(BaseModel):
    message: Optional[str] = ""
    session_id: Optional[str] = None
    image_base64: Optional[str] = None
    confirm_token: Optional[str] = None


class WorkoutSet(BaseModel):
    reps: Optional[int] = None
    weight: Optional[float] = None


class WorkoutExercise(BaseModel):
    name: str
    is_isometric: bool = False
    sets: List[WorkoutSet] = []
    duration: Optional[int] = None
    note: str = ""


class WorkoutBody(BaseModel):
    type: str = "Push"
    date: Optional[str] = None
    exercises: List[WorkoutExercise] = []
    notes: str = ""


class PhotoNote(BaseModel):
    note: str = ""


# ---------------------------------------------------------------------------
# Finance core
# ---------------------------------------------------------------------------
async def resolve_person(name: str) -> dict:
    if name.strip().lower() in ("me", "eu", "sá", "sa"):
        return {"id": "me", "name": "Me"}
    p = await db.people.find_one({"name_lower": name.strip().lower()}, {"_id": 0})
    if not p:
        p = {"id": new_id(), "name": name.strip(), "name_lower": name.strip().lower(),
             "photo": None, "notes": "", "payment_preference": "", "created_at": now_iso()}
        await db.people.insert_one(dict(p))
    return {"id": p["id"], "name": p["name"]}


def compute_shares(gross: float, participants: List[str], items, split_mode, exact_shares):
    names = [n if n.strip().lower() not in ("me", "eu", "sá", "sa") else "Me" for n in participants]
    if "Me" not in names:
        names = ["Me"] + names
    shares = {n: 0.0 for n in names}
    if split_mode == "items" and items:
        for it in items:
            assigned = it.get("assigned") or ["Me"]
            assigned = [a if a.strip().lower() not in ("me", "eu", "sá", "sa") else "Me" for a in assigned]
            for a in assigned:
                shares.setdefault(a, 0.0)
                shares[a] += float(it["price"]) / len(assigned)
    elif split_mode == "exact" and exact_shares:
        for k, v in exact_shares.items():
            key = k if k.strip().lower() not in ("me", "eu", "sá", "sa") else "Me"
            shares[key] = float(v)
    else:
        each = gross / len(names) if names else gross
        for n in names:
            shares[n] = each
    shares = {k: round(v, 2) for k, v in shares.items() if v > 0 or k == "Me"}
    return shares


async def create_expense_record(body: ExpenseBody) -> dict:
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    gross = body.amount
    if gross is None and body.items:
        gross = round(sum(float(i.price) for i in body.items), 2)
    if gross is None:
        gross = 0.0
    items = [i.model_dump() for i in body.items] if body.items else []
    shares = compute_shares(gross, body.participants, items, body.split_mode, body.exact_shares)

    split_list = []
    for name, amt in shares.items():
        person = await resolve_person(name)
        split_list.append({"person_id": person["id"], "person_name": person["name"],
                           "amount": round(amt, 2), "is_me": person["id"] == "me"})

    personal = round(next((s["amount"] for s in split_list if s["is_me"]), 0.0), 2)
    reimbursable = round(gross - personal, 2)

    txn = {
        "id": new_id(),
        "type": "expense",
        "gross_amount": round(gross, 2),
        "personal_amount": personal,
        "reimbursable_amount": reimbursable,
        "description": body.description or body.merchant,
        "category": body.category,
        "account": body.account,
        "merchant": body.merchant,
        "date": date,
        "month": month_of(date),
        "notes": body.notes,
        "paid_by": "me" if body.paid_by.strip().lower() in ("me", "eu", "sá", "sa") else (await resolve_person(body.paid_by))["id"],
        "splits": split_list,
        "items": items,
        "created_at": now_iso(),
    }
    await db.transactions.insert_one(dict(txn))

    inventory_added = []
    if body.add_to_inventory and items:
        for it in items:
            g = {"id": new_id(), "name": it["name"], "name_lower": it["name"].lower(),
                 "quantity": 1, "unit": "unit", "category": "Other",
                 "price": it["price"], "store": body.merchant, "low_threshold": 0,
                 "created_at": now_iso()}
            await db.groceries.insert_one(dict(g))
            inventory_added.append(it["name"])

    txn.pop("_id", None)
    return {"transaction": txn, "inventory_added": inventory_added}


async def compute_account_balance(account: str) -> float:
    acc = await db.accounts.find_one({"id": account}, {"_id": 0})
    bal = acc["opening_balance"] if acc else 0.0
    async for t in db.transactions.find({}, {"_id": 0}):
        if t["type"] == "expense" and t.get("paid_by") == "me" and t["account"] == account:
            bal -= t["gross_amount"]
        elif t["type"] == "income" and t["account"] == account:
            bal += t["gross_amount"]
        elif t["type"] == "transfer":
            if t.get("from_account") == account:
                bal -= t["gross_amount"]
            if t.get("to_account") == account:
                bal += t["gross_amount"]
    async for s in db.settlements.find({}, {"_id": 0}):
        if s["account"] == account:
            bal += s["amount"] if s["direction"] == "in" else -s["amount"]
    return round(bal, 2)


async def people_balances() -> List[dict]:
    people = await db.people.find({}, {"_id": 0}).to_list(1000)
    result = []
    for p in people:
        owed = 0.0    # they owe me
        i_owe = 0.0
        async for t in db.transactions.find({"type": "expense"}, {"_id": 0}):
            for s in t.get("splits", []):
                if s["person_id"] == p["id"]:
                    if t.get("paid_by") == "me":
                        owed += s["amount"]
                    elif t.get("paid_by") == p["id"] and not s["is_me"]:
                        pass
            if t.get("paid_by") == p["id"]:
                mine = next((s["amount"] for s in t.get("splits", []) if s["is_me"]), 0.0)
                i_owe += mine
        async for s in db.settlements.find({"person_id": p["id"]}, {"_id": 0}):
            if s["direction"] == "in":
                owed -= s["amount"]
            else:
                i_owe -= s["amount"]
        net = round(owed - i_owe, 2)
        result.append({**p, "owes_me": round(owed, 2), "i_owe": round(i_owe, 2), "net": net})
    return result


# ---------------------------------------------------------------------------
# Price intelligence + shopping helpers
# ---------------------------------------------------------------------------
async def record_price(name: str, store: Optional[str], price: Optional[float], unit: str = "unit"):
    if not store or price is None:
        return
    await db.price_records.insert_one({
        "id": new_id(), "name": name, "name_lower": name.lower(), "store": store,
        "price": round(float(price), 2), "unit": unit,
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "created_at": now_iso()})


async def latest_prices(name_lower: str) -> dict:
    recs = await db.price_records.find({"name_lower": name_lower}, {"_id": 0}).sort("date", -1).to_list(200)
    per_store = {}
    for r in recs:
        if r.get("store") and r["store"] not in per_store:
            per_store[r["store"]] = {"price": r["price"], "date": r["date"]}
    return per_store


def cheapest_store(per_store: dict):
    if not per_store:
        return None
    s, v = min(per_store.items(), key=lambda kv: kv[1]["price"])
    return {"store": s, "price": v["price"], "date": v["date"]}


async def shopping_payload() -> dict:
    items = await db.shopping_items.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    enriched = []
    store_baskets = {}   # store -> {"total": x, "items": [names]}
    split_total = 0.0
    unknown = []
    for it in items:
        per_store = await latest_prices(it["name_lower"])
        ch = cheapest_store(per_store)
        if ch:
            split_total += ch["price"]
            for store, v in per_store.items():
                b = store_baskets.setdefault(store, {"total": 0.0, "items": []})
                b["total"] = round(b["total"] + v["price"], 2)
                b["items"].append(it["name"])
        else:
            unknown.append(it["name"])
        enriched.append({**it, "per_store": per_store, "best": ch, "known": ch is not None})

    priced_count = len(items) - len(unknown)
    stores = [{"store": s, "total": round(b["total"], 2), "covers": len(b["items"]), "items": b["items"]}
              for s, b in store_baskets.items()]
    # best single stop = most coverage, then cheapest
    stores_sorted = sorted(stores, key=lambda s: (-s["covers"], s["total"]))
    best_single = stores_sorted[0] if stores_sorted else None

    recommendation = ""
    if best_single and priced_count:
        if best_single["covers"] >= priced_count:
            saving = round(best_single["total"] - round(split_total, 2), 2)
            recommendation = (f"{best_single['store']} covers all {priced_count} priced items for about "
                              f"€{best_single['total']:.2f}. Splitting across stores would cost about "
                              f"€{split_total:.2f} — a saving of only €{max(saving,0):.2f}, so one stop is usually enough.")
        else:
            recommendation = (f"{best_single['store']} is your best single stop, covering {best_single['covers']} of "
                              f"{priced_count} priced items (~€{best_single['total']:.2f}).")
    if unknown:
        recommendation += f" No known price yet for: {', '.join(unknown)}."

    return {
        "items": enriched,
        "stores": stores_sorted,
        "best_single": best_single,
        "split_total": round(split_total, 2),
        "unknown": unknown,
        "recommendation": recommendation.strip(),
    }


async def add_shopping_item_doc(name: str, quantity: float = 1, unit: str = "unit", note: str = "") -> dict:
    existing = await db.shopping_items.find_one({"name_lower": name.lower(), "bought": False})
    if existing:
        return await db.shopping_items.find_one({"id": existing["id"]}, {"_id": 0})
    doc = {"id": new_id(), "name": name, "name_lower": name.lower(), "quantity": quantity,
           "unit": unit, "note": note, "bought": False, "created_at": now_iso()}
    await db.shopping_items.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


async def generate_shopping_doc(days: int = 7) -> dict:
    """Deterministic suggestions from low stock + previously purchased items not in stock."""
    groceries = await db.groceries.find({}, {"_id": 0}).to_list(1000)
    stock = {g["name_lower"]: g for g in groceries}
    added = []
    for g in groceries:
        if g.get("low_threshold") and g["quantity"] <= g["low_threshold"]:
            await add_shopping_item_doc(g["name"], max(1, round(days / 2)), g.get("unit", "unit"), "Running low")
            added.append(g["name"])
    # frequently seen priced items not currently stocked
    known_names = await db.price_records.distinct("name")
    for name in known_names:
        nl = name.lower()
        if nl not in stock or stock[nl]["quantity"] <= 0:
            doc = await add_shopping_item_doc(name, 1, "unit", "From your usual buys")
            if doc["name"] not in added:
                added.append(doc["name"])
    payload = await shopping_payload()
    payload["added"] = added
    return payload


async def cook_recipe_doc(recipe: dict) -> dict:
    changes = []
    for ing in recipe.get("ingredients", []):
        g = await db.groceries.find_one({"name_lower": ing["name"].lower()})
        if g:
            newq = max(0, round(g["quantity"] - (ing.get("quantity") or 0), 2))
            await db.groceries.update_one({"id": g["id"]}, {"$set": {"quantity": newq}})
            changes.append(f"{ing['name']} −{ing.get('quantity', 0)}{ing.get('unit', '')} (now {newq})")
        else:
            changes.append(f"{ing['name']} (not in inventory)")
    servings = recipe.get("servings") or 1
    meal = None
    if recipe.get("calories"):
        meal = {"id": new_id(), "description": f"{recipe['name']} (1 serving)",
                "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "calories": round((recipe.get("calories") or 0) / servings, 1),
                "protein": round((recipe.get("protein") or 0) / servings, 1),
                "carbs": round((recipe.get("carbs") or 0) / servings, 1),
                "fat": round((recipe.get("fat") or 0) / servings, 1), "created_at": now_iso()}
        await db.meals.insert_one(dict(meal))
        meal.pop("_id", None)
    return {"recipe": recipe["name"], "inventory_changes": changes, "meal_logged": meal is not None}


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/login")
async def login(body: LoginBody):
    email = body.email.strip().lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(str(user["_id"]), email)
    return {"token": token, "user": {"id": str(user["_id"]), "email": email, "name": user.get("name", OWNER_NAME)}}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["_id"], "email": user["email"], "name": user.get("name", OWNER_NAME)}


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
@api_router.get("/people")
async def get_people(user: dict = Depends(get_current_user)):
    return await people_balances()


@api_router.post("/people")
async def create_person(body: PersonBody, user: dict = Depends(get_current_user)):
    p = {"id": new_id(), "name": body.name, "name_lower": body.name.lower(),
         "photo": body.photo, "notes": body.notes or "",
         "payment_preference": body.payment_preference or "", "created_at": now_iso()}
    await db.people.insert_one(dict(p))
    p.pop("_id", None)
    return p


@api_router.delete("/people/{pid}")
async def delete_person(pid: str, user: dict = Depends(get_current_user)):
    await db.people.delete_one({"id": pid})
    return {"ok": True}


@api_router.get("/people/{pid}")
async def person_detail(pid: str, user: dict = Depends(get_current_user)):
    people = await people_balances()
    person = next((p for p in people if p["id"] == pid), None)
    if not person:
        raise HTTPException(404, "Person not found")
    txns = []
    async for t in db.transactions.find({"type": "expense"}, {"_id": 0}).sort("date", -1):
        for s in t.get("splits", []):
            if s["person_id"] == pid:
                txns.append({"id": t["id"], "date": t["date"], "merchant": t["merchant"] or t["description"],
                             "amount": s["amount"], "gross": t["gross_amount"]})
    settlements = await db.settlements.find({"person_id": pid}, {"_id": 0}).sort("date", -1).to_list(1000)
    return {"person": person, "transactions": txns, "settlements": settlements}


# ---------------------------------------------------------------------------
# Categories & Accounts
# ---------------------------------------------------------------------------
@api_router.get("/categories")
async def get_categories(user: dict = Depends(get_current_user)):
    return await db.categories.find({}, {"_id": 0}).to_list(1000)


@api_router.post("/categories")
async def create_category(body: CategoryBody, user: dict = Depends(get_current_user)):
    c = {"id": new_id(), "name": body.name, "icon": body.icon, "color": body.color, "created_at": now_iso()}
    await db.categories.insert_one(dict(c))
    c.pop("_id", None)
    return c


@api_router.delete("/categories/{cid}")
async def delete_category(cid: str, user: dict = Depends(get_current_user)):
    await db.categories.delete_one({"id": cid})
    return {"ok": True}


@api_router.get("/accounts")
async def get_accounts(user: dict = Depends(get_current_user)):
    accs = await db.accounts.find({}, {"_id": 0}).to_list(100)
    for a in accs:
        a["balance"] = await compute_account_balance(a["id"])
    return accs


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------
async def refund_map() -> dict:
    """Sum of settlements (direction=in) linked to each expense id."""
    m = {}
    async for s in db.settlements.find({"direction": "in", "transaction_id": {"$ne": None}}, {"_id": 0}):
        if s.get("transaction_id"):
            m[s["transaction_id"]] = round(m.get(s["transaction_id"], 0) + s["amount"], 2)
    return m


def serialize_txn(t: dict, rmap: dict) -> dict:
    if t.get("type") != "expense":
        return {**t, "payment_method": "cash" if t.get("account") == "cash" else "card"}
    reimb = t.get("reimbursable_amount", 0) or 0
    refunded = min(rmap.get(t["id"], 0.0), reimb)
    remaining = round(max(reimb - refunded, 0), 2)
    if reimb <= 0.005:
        status = "personal"
    elif remaining <= 0.005:
        status = "settled"
    elif refunded > 0.005:
        status = "partial"
    else:
        status = "pending"
    responsible = [s["person_name"] for s in t.get("splits", []) if not s["is_me"] and s["amount"] > 0.005]
    return {**t, "amount_refunded": round(refunded, 2), "remaining_refund": remaining,
            "refund_status": status, "responsible": responsible,
            "payment_method": "cash" if t.get("account") == "cash" else "card"}


def _date_query(month, start, end):
    q = {}
    if month:
        q["month"] = month
    if start or end:
        dq = {}
        if start:
            dq["$gte"] = start
        if end:
            dq["$lte"] = end
        q["date"] = dq
    return q


@api_router.get("/transactions")
async def get_transactions(month: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
                           payment_method: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = _date_query(month, start, end)
    rmap = await refund_map()
    rows = await db.transactions.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    out = [serialize_txn(t, rmap) for t in rows]
    if payment_method in ("cash", "card"):
        out = [t for t in out if t.get("payment_method") == payment_method]
    return out


@api_router.post("/transactions/expense")
async def add_expense(body: ExpenseBody, user: dict = Depends(get_current_user)):
    res = await create_expense_record(body)
    return res


@api_router.put("/transactions/{tid}")
async def update_transaction(tid: str, body: TxnUpdate, user: dict = Depends(get_current_user)):
    t = await db.transactions.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Transaction not found")
    updates = {}
    if body.description is not None:
        updates["description"] = body.description
        updates["merchant"] = body.description if not t.get("merchant") else t.get("merchant")
    if body.category is not None:
        updates["category"] = body.category
    if body.notes is not None:
        updates["notes"] = body.notes
    if body.payment_method in ("cash", "card"):
        updates["account"] = "cash" if body.payment_method == "cash" else "revolut"
    if body.account in ("cash", "revolut"):
        updates["account"] = body.account
    if body.date:
        updates["date"] = body.date
        updates["month"] = month_of(body.date)
    if body.amount is not None and t.get("type") == "expense":
        new_gross = round(float(body.amount), 2)
        old_gross = t.get("gross_amount", 0) or 0
        splits = t.get("splits", [])
        if body.personal_amount is not None:
            personal = round(min(float(body.personal_amount), new_gross), 2)
            splits = [{"person_id": "me", "person_name": "Me", "amount": personal, "is_me": True}]
            others = round(new_gross - personal, 2)
            existing_others = [s for s in t.get("splits", []) if not s["is_me"]]
            if existing_others and others > 0:
                each = round(others / len(existing_others), 2)
                for s in existing_others:
                    splits.append({**s, "amount": each})
            updates["personal_amount"] = personal
        elif len(splits) > 1 and old_gross > 0:
            factor = new_gross / old_gross
            splits = [{**s, "amount": round(s["amount"] * factor, 2)} for s in splits]
            updates["personal_amount"] = round(next((s["amount"] for s in splits if s["is_me"]), 0), 2)
        else:
            splits = [{"person_id": "me", "person_name": "Me", "amount": new_gross, "is_me": True}]
            updates["personal_amount"] = new_gross
        updates["gross_amount"] = new_gross
        updates["splits"] = splits
        updates["reimbursable_amount"] = round(new_gross - updates["personal_amount"], 2)
    elif body.personal_amount is not None and t.get("type") == "expense":
        gross = t.get("gross_amount", 0)
        personal = round(min(float(body.personal_amount), gross), 2)
        updates["personal_amount"] = personal
        updates["reimbursable_amount"] = round(gross - personal, 2)
    await db.transactions.update_one({"id": tid}, {"$set": updates})
    rmap = await refund_map()
    return serialize_txn(await db.transactions.find_one({"id": tid}, {"_id": 0}), rmap)


@api_router.delete("/transactions/{tid}")
async def delete_transaction(tid: str, user: dict = Depends(get_current_user)):
    await db.transactions.delete_one({"id": tid})
    await db.settlements.delete_many({"transaction_id": tid})
    return {"ok": True}


@api_router.post("/transactions/transfer")
async def add_transfer(body: TransferBody, user: dict = Depends(get_current_user)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    t = {"id": new_id(), "type": "transfer", "from_account": body.from_account,
         "to_account": body.to_account, "gross_amount": round(body.amount, 2),
         "description": body.notes or f"Transfer", "date": date, "month": month_of(date),
         "account": body.from_account, "created_at": now_iso()}
    await db.transactions.insert_one(dict(t))
    t.pop("_id", None)
    return t


@api_router.post("/transactions/income")
async def add_income(body: IncomeBody, user: dict = Depends(get_current_user)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    t = {"id": new_id(), "type": "income", "account": body.account,
         "gross_amount": round(body.amount, 2), "description": body.description or "Income",
         "date": date, "month": month_of(date), "created_at": now_iso()}
    await db.transactions.insert_one(dict(t))
    t.pop("_id", None)
    return t


# ---------------------------------------------------------------------------
# Settlements
# ---------------------------------------------------------------------------
@api_router.post("/settlements")
async def add_settlement(body: SettlementBody, user: dict = Depends(get_current_user)):
    person = await resolve_person(body.person)
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    s = {"id": new_id(), "person_id": person["id"], "person_name": person["name"],
         "amount": round(body.amount, 2), "method": body.method, "account": body.account,
         "direction": body.direction, "date": date, "transaction_id": body.transaction_id,
         "created_at": now_iso()}
    await db.settlements.insert_one(dict(s))
    s.pop("_id", None)
    return s


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
@api_router.get("/analytics/summary")
async def analytics_summary(month: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
                            user: dict = Depends(get_current_user)):
    accounts = await get_accounts(user)
    cash = next((a["balance"] for a in accounts if a["id"] == "cash"), 0)
    revolut = next((a["balance"] for a in accounts if a["id"] == "revolut"), 0)

    q = {**_date_query(month, start, end), "type": "expense"}
    gross = personal = cash_spent = card_spent = reimbursable = 0.0
    by_cat = {}
    by_day = {}
    async for t in db.transactions.find(q, {"_id": 0}):
        gross += t["gross_amount"]
        personal += t.get("personal_amount", 0)
        reimbursable += t.get("reimbursable_amount", 0)
        if t.get("account") == "cash":
            cash_spent += t["gross_amount"]
        else:
            card_spent += t["gross_amount"]
        by_cat[t["category"]] = by_cat.get(t["category"], 0) + t["gross_amount"]
        by_day[t["date"]] = by_day.get(t["date"], 0) + t["gross_amount"]

    # refunds received in the same window
    sq = _date_query(None, start, end)
    sq["direction"] = "in"
    if month:
        sq = {"direction": "in"}  # month filter uses settlement date prefix below
    refunded = 0.0
    async for s in db.settlements.find(sq, {"_id": 0}):
        if month and not str(s.get("date", "")).startswith(month):
            continue
        refunded += s["amount"]

    people = await people_balances()
    owed_to_me = round(sum(p["owes_me"] for p in people), 2)
    i_owe = round(sum(p["i_owe"] for p in people), 2)
    outstanding = round(sum(max(p["net"], 0) for p in people), 2)

    # grocery intelligence
    groceries = await db.groceries.find({}, {"_id": 0}).to_list(2000)
    out_of_stock = [g["name"] for g in groceries if (g.get("quantity") or 0) <= 0]
    low_stock = [g["name"] for g in groceries if (g.get("quantity") or 0) > 0 and g.get("low_threshold") and g["quantity"] <= g["low_threshold"]]
    unknown_price = [g["name"] for g in groceries if g.get("price") is None]

    months = await db.transactions.distinct("month")
    return {
        "cash": cash, "revolut": revolut, "total_available": round(cash + revolut, 2),
        "gross": round(gross, 2), "personal": round(personal, 2),
        "reimbursable": round(reimbursable, 2),
        "cash_spent": round(cash_spent, 2), "card_spent": round(card_spent, 2),
        "refunded": round(refunded, 2), "pending": outstanding,
        "owed_to_me": owed_to_me, "i_owe": i_owe, "outstanding": outstanding,
        "by_category": [{"name": k, "value": round(v, 2)} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
        "by_day": [{"date": k, "value": round(v, 2)} for k, v in sorted(by_day.items())],
        "grocery": {"total": len(groceries), "out_of_stock": out_of_stock, "low_stock": low_stock, "unknown_price": unknown_price},
        "months": sorted(months, reverse=True),
    }


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
@api_router.get("/tasks")
async def get_tasks(user: dict = Depends(get_current_user)):
    return await db.tasks.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api_router.post("/tasks")
async def create_task(body: TaskBody, user: dict = Depends(get_current_user)):
    t = {"id": new_id(), **body.model_dump(), "created_at": now_iso()}
    await db.tasks.insert_one(dict(t))
    t.pop("_id", None)
    return t


@api_router.put("/tasks/{tid}")
async def update_task(tid: str, body: TaskBody, user: dict = Depends(get_current_user)):
    await db.tasks.update_one({"id": tid}, {"$set": body.model_dump()})
    return await db.tasks.find_one({"id": tid}, {"_id": 0})


@api_router.delete("/tasks/{tid}")
async def delete_task(tid: str, user: dict = Depends(get_current_user)):
    await db.tasks.delete_one({"id": tid})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Body / Weight
# ---------------------------------------------------------------------------
@api_router.get("/weight")
async def get_weight(user: dict = Depends(get_current_user)):
    return await db.weight.find({}, {"_id": 0}).sort("date", 1).to_list(2000)


@api_router.post("/weight")
async def add_weight(body: WeightBody, user: dict = Depends(get_current_user)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    w = {"id": new_id(), "weight": body.weight, "date": date, "note": body.note, "created_at": now_iso()}
    await db.weight.insert_one(dict(w))
    w.pop("_id", None)
    return w


@api_router.delete("/weight/{wid}")
async def delete_weight(wid: str, user: dict = Depends(get_current_user)):
    await db.weight.delete_one({"id": wid})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Workouts
# ---------------------------------------------------------------------------
@api_router.get("/workouts")
async def get_workouts(user: dict = Depends(get_current_user)):
    return await db.workouts.find({}, {"_id": 0}).sort("date", -1).to_list(1000)


async def create_workout(body: WorkoutBody, user) -> dict:
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    w = {"id": new_id(), "type": body.type, "date": date, "notes": body.notes,
         "exercises": [e.model_dump() for e in body.exercises], "created_at": now_iso()}
    await db.workouts.insert_one(dict(w))
    w.pop("_id", None)
    return w


@api_router.post("/workouts")
async def post_workout(body: WorkoutBody, user: dict = Depends(get_current_user)):
    return await create_workout(body, user)


@api_router.delete("/workouts/{wid}")
async def delete_workout(wid: str, user: dict = Depends(get_current_user)):
    await db.workouts.delete_one({"id": wid})
    return {"ok": True}


@api_router.get("/workouts/prs")
async def workout_prs(user: dict = Depends(get_current_user)):
    prs = {}
    async for w in db.workouts.find({}, {"_id": 0}):
        for e in w.get("exercises", []):
            name = e["name"]
            p = prs.setdefault(name, {"name": name, "best_weight": 0, "best_reps": 0, "best_duration": 0, "is_isometric": e.get("is_isometric", False)})
            if e.get("duration"):
                p["best_duration"] = max(p["best_duration"], e["duration"])
                p["is_isometric"] = True
            for s in e.get("sets", []):
                if s.get("weight"):
                    p["best_weight"] = max(p["best_weight"], s["weight"])
                if s.get("reps"):
                    p["best_reps"] = max(p["best_reps"], s["reps"])
    return list(prs.values())


# ---------------------------------------------------------------------------
# Progress photos (object storage)
# ---------------------------------------------------------------------------
@api_router.post("/photos")
async def upload_photo(file: UploadFile = File(...), note: str = Query(""), user: dict = Depends(get_current_user)):
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg").lower()
    path = f"{APP_NAME}/photos/{user['_id']}/{new_id()}.{ext}"
    data = await file.read()
    ct = file.content_type or {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
    result = put_object(path, data, ct)
    doc = {"id": new_id(), "storage_path": result["path"], "content_type": ct, "note": note,
           "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "is_deleted": False, "created_at": now_iso()}
    await db.photos.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.get("/photos")
async def list_photos(user: dict = Depends(get_current_user)):
    rows = await db.photos.find({"is_deleted": False}, {"_id": 0}).sort("date", -1).to_list(1000)
    for r in rows:
        r["url"] = f"/api/photos/file/{r['storage_path']}"
    return rows


@api_router.delete("/photos/{pid}")
async def delete_photo(pid: str, user: dict = Depends(get_current_user)):
    await db.photos.update_one({"id": pid}, {"$set": {"is_deleted": True}})
    return {"ok": True}


@api_router.get("/photos/file/{path:path}")
async def serve_photo(path: str, auth: str = Query(None), authorization: str = Header(None)):
    token = auth or (authorization[7:] if authorization and authorization.startswith("Bearer ") else None)
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        raise HTTPException(401, "Not authenticated")
    record = await db.photos.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(404, "Not found")
    data, ct = get_object(path)
    return Response(content=data, media_type=record.get("content_type", ct))


# ---------------------------------------------------------------------------
# Groceries
# ---------------------------------------------------------------------------
@api_router.get("/groceries")
async def get_groceries(user: dict = Depends(get_current_user)):
    return await db.groceries.find({}, {"_id": 0}).sort("name", 1).to_list(2000)


@api_router.post("/groceries")
async def add_grocery(body: GroceryBody, user: dict = Depends(get_current_user)):
    await record_price(body.name, body.store, body.price, body.unit)
    existing = await db.groceries.find_one({"name_lower": body.name.lower()})
    if existing:
        await db.groceries.update_one({"id": existing["id"]}, {"$inc": {"quantity": body.quantity},
                                                                "$set": {"price": body.price if body.price is not None else existing.get("price"),
                                                                         "store": body.store or existing.get("store"),
                                                                         "updated_at": now_iso()}})
        return await db.groceries.find_one({"id": existing["id"]}, {"_id": 0})
    g = {"id": new_id(), "name": body.name, "name_lower": body.name.lower(),
         "quantity": body.quantity, "unit": body.unit, "category": body.category,
         "price": body.price, "store": body.store, "low_threshold": body.low_threshold,
         "notes": body.notes or "", "expiration": body.expiration,
         "created_at": now_iso(), "updated_at": now_iso()}
    await db.groceries.insert_one(dict(g))
    g.pop("_id", None)
    return g


@api_router.put("/groceries/{gid}")
async def update_grocery(gid: str, body: GroceryUpdate, user: dict = Depends(get_current_user)):
    g = await db.groceries.find_one({"id": gid}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Item not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "name" in updates:
        updates["name_lower"] = updates["name"].lower()
    if updates.get("price") is not None:
        await record_price(updates.get("name", g["name"]), updates.get("store", g.get("store")), updates["price"], updates.get("unit", g.get("unit", "unit")))
    updates["updated_at"] = now_iso()
    await db.groceries.update_one({"id": gid}, {"$set": updates})
    return await db.groceries.find_one({"id": gid}, {"_id": 0})


@api_router.delete("/groceries/{gid}")
async def delete_grocery(gid: str, user: dict = Depends(get_current_user)):
    await db.groceries.delete_one({"id": gid})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Meals / Nutrition
# ---------------------------------------------------------------------------
@api_router.get("/meals")
async def get_meals(date: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if date:
        q["date"] = date
    return await db.meals.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api_router.post("/meals")
async def add_meal(body: MealBody, user: dict = Depends(get_current_user)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    m = {"id": new_id(), "description": body.description, "date": date,
         "calories": body.calories, "protein": body.protein, "carbs": body.carbs,
         "fat": body.fat, "created_at": now_iso()}
    await db.meals.insert_one(dict(m))
    m.pop("_id", None)
    return m


@api_router.delete("/meals/{mid}")
async def delete_meal(mid: str, user: dict = Depends(get_current_user)):
    await db.meals.delete_one({"id": mid})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Shopping list + price intelligence
# ---------------------------------------------------------------------------
@api_router.get("/shopping")
async def get_shopping(user: dict = Depends(get_current_user)):
    return await shopping_payload()


@api_router.post("/shopping")
async def post_shopping(body: ShoppingBody, user: dict = Depends(get_current_user)):
    return await add_shopping_item_doc(body.name, body.quantity, body.unit, body.note)


@api_router.post("/shopping/generate")
async def gen_shopping(days: int = 7, user: dict = Depends(get_current_user)):
    return await generate_shopping_doc(days)


@api_router.delete("/shopping/{sid}")
async def del_shopping(sid: str, user: dict = Depends(get_current_user)):
    await db.shopping_items.delete_one({"id": sid})
    return {"ok": True}


@api_router.post("/shopping/{sid}/buy")
async def buy_shopping(sid: str, body: BuyBody, user: dict = Depends(get_current_user)):
    it = await db.shopping_items.find_one({"id": sid}, {"_id": 0})
    if not it:
        raise HTTPException(404, "Item not found")
    await add_grocery(GroceryBody(name=it["name"], quantity=it.get("quantity", 1), unit=it.get("unit", "unit"),
                                  price=body.price, store=body.store), user)
    await db.shopping_items.delete_one({"id": sid})
    return {"ok": True}


@api_router.get("/prices/{name}")
async def get_prices(name: str, user: dict = Depends(get_current_user)):
    per_store = await latest_prices(name.lower())
    history = await db.price_records.find({"name_lower": name.lower()}, {"_id": 0}).sort("date", -1).to_list(100)
    return {"name": name, "per_store": per_store, "cheapest": cheapest_store(per_store), "history": history}


# ---------------------------------------------------------------------------
# Recipes
# ---------------------------------------------------------------------------
@api_router.get("/recipes")
async def get_recipes(user: dict = Depends(get_current_user)):
    return await db.recipes.find({}, {"_id": 0}).sort("name", 1).to_list(1000)


@api_router.post("/recipes")
async def create_recipe(body: RecipeBody, user: dict = Depends(get_current_user)):
    r = {"id": new_id(), **body.model_dump(), "created_at": now_iso()}
    await db.recipes.insert_one(dict(r))
    r.pop("_id", None)
    return r


@api_router.delete("/recipes/{rid}")
async def delete_recipe(rid: str, user: dict = Depends(get_current_user)):
    await db.recipes.delete_one({"id": rid})
    return {"ok": True}


@api_router.post("/recipes/{rid}/cook")
async def cook_recipe(rid: str, user: dict = Depends(get_current_user)):
    r = await db.recipes.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Recipe not found")
    return await cook_recipe_doc(r)


# ---------------------------------------------------------------------------
# AI Actions log
# ---------------------------------------------------------------------------
@api_router.get("/ai/actions")
async def ai_actions(user: dict = Depends(get_current_user)):
    return await db.ai_actions.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api_router.post("/ai/actions/{aid}/undo")
async def ai_undo(aid: str, user: dict = Depends(get_current_user)):
    action = await db.ai_actions.find_one({"id": aid}, {"_id": 0})
    if not action or action.get("undone"):
        raise HTTPException(404, "Nothing to undo")
    for ref in action.get("created", []):
        await db[ref["collection"]].delete_one({"id": ref["id"]})
    await db.ai_actions.update_one({"id": aid}, {"$set": {"undone": True}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Speech to text
# ---------------------------------------------------------------------------
@api_router.post("/ai/transcribe")
async def transcribe(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    from emergentintegrations.llm.openai import OpenAISpeechToText
    data = await file.read()
    suffix = os.path.splitext(file.filename or "audio.webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        with open(tmp_path, "rb") as f:
            resp = await stt.transcribe(file=f, model="whisper-1", response_format="json")
        return {"text": resp.text}
    finally:
        os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# Receipt parsing (extract only, no save — for the review screen)
# ---------------------------------------------------------------------------
@api_router.post("/ai/receipt")
async def parse_receipt(body: AIChatBody, user: dict = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    if not body.image_base64:
        raise HTTPException(400, "No image provided")
    chat = (LlmChat(api_key=EMERGENT_LLM_KEY, session_id=new_id(),
                    system_message="You extract structured data from receipt photos. Respond ONLY with compact JSON, no prose.")
            .with_model("gemini", "gemini-3-flash-preview"))
    b64 = body.image_base64.split(",")[-1]
    prompt = ('Extract this receipt as JSON with this exact shape: '
              '{"merchant": string, "date": "YYYY-MM-DD" or null, "total": number, '
              '"items": [{"name": string, "price": number}]}. '
              'Only include line items and prices you can actually read. NEVER invent prices or a store name. '
              'If the image is not clearly a receipt, or you cannot read it, return {"merchant": "", "items": []} — do NOT guess. '
              'Respond with JSON only.')
    try:
        resp = await chat.send_message(UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)]))
        text = resp if isinstance(resp, str) else getattr(resp, "content", str(resp))
        import re
        m = re.search(r"\{.*\}", text, re.S)
        data = json.loads(m.group(0)) if m else {"items": []}
    except Exception as e:
        logger.exception("receipt parse failed")
        raise HTTPException(500, f"Could not read receipt: {e}")
    data.setdefault("items", [])
    data.setdefault("merchant", "")
    return data


# ---------------------------------------------------------------------------
# AI Assistant with tools
# ---------------------------------------------------------------------------
AI_TOOLS = [
    {"type": "function", "function": {
        "name": "create_expense",
        "description": "Create an expense/purchase. Handles shared expenses and item-level splitting. Always compute gross total. For shared expenses, list all participants (use 'Me' for the owner Sá).",
        "parameters": {"type": "object", "properties": {
            "amount": {"type": "number", "description": "Total gross amount paid"},
            "merchant": {"type": "string"},
            "description": {"type": "string"},
            "category": {"type": "string", "description": "One of the finance categories e.g. Groceries, Eating Out, Transport"},
            "account": {"type": "string", "enum": ["cash", "revolut"]},
            "date": {"type": "string", "description": "yyyy-mm-dd, default today"},
            "participants": {"type": "array", "items": {"type": "string"}, "description": "All people sharing this expense including 'Me'"},
            "split_mode": {"type": "string", "enum": ["equal", "items", "exact"]},
            "items": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"}, "price": {"type": "number"},
                "assigned": {"type": "array", "items": {"type": "string"}}}}},
            "exact_shares": {"type": "object", "description": "map of person name -> amount they owe"},
            "add_to_inventory": {"type": "boolean"},
        }, "required": ["amount"]},
    }},
    {"type": "function", "function": {
        "name": "record_payment",
        "description": "Record a reimbursement/settlement. direction 'in' = a person paid Sá back; 'out' = Sá paid someone.",
        "parameters": {"type": "object", "properties": {
            "person": {"type": "string"}, "amount": {"type": "number"},
            "method": {"type": "string", "enum": ["MB WAY", "Revolut", "Cash"]},
            "account": {"type": "string", "enum": ["cash", "revolut"]},
            "direction": {"type": "string", "enum": ["in", "out"]},
        }, "required": ["person", "amount"]},
    }},
    {"type": "function", "function": {
        "name": "create_person",
        "description": "Add a new person/contact.",
        "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "add_grocery",
        "description": "Add a grocery item to inventory with optional price and store.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "quantity": {"type": "number"}, "unit": {"type": "string"},
            "category": {"type": "string"}, "price": {"type": "number"}, "store": {"type": "string"}},
            "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "log_meal",
        "description": "Log a meal with estimated nutrition. Estimate calories/macros from the foods and quantities described.",
        "parameters": {"type": "object", "properties": {
            "description": {"type": "string"}, "calories": {"type": "number"},
            "protein": {"type": "number"}, "carbs": {"type": "number"}, "fat": {"type": "number"}},
            "required": ["description"]},
    }},
    {"type": "function", "function": {
        "name": "record_weight",
        "description": "Record a body weight measurement in kg.",
        "parameters": {"type": "object", "properties": {
            "weight": {"type": "number"}, "date": {"type": "string"}}, "required": ["weight"]},
    }},
    {"type": "function", "function": {
        "name": "create_task",
        "description": "Create a to-do task.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"}, "priority": {"type": "string", "enum": ["low", "normal", "high"]},
            "due": {"type": "string"}}, "required": ["title"]},
    }},
    {"type": "function", "function": {
        "name": "get_financial_summary",
        "description": "Get current balances, monthly spending, reimbursements and who owes what.",
        "parameters": {"type": "object", "properties": {"month": {"type": "string"}}},
    }},
    {"type": "function", "function": {
        "name": "get_people_balances",
        "description": "Get how much each person owes Sá and how much Sá owes them.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "update_expense",
        "description": "Modify an existing expense. Identify it by a text 'match' on its merchant/description. You can change amount, personal_amount, category, payment_method (cash or card), date or notes.",
        "parameters": {"type": "object", "properties": {
            "match": {"type": "string", "description": "Text to find the expense, e.g. 'restaurant' or 'Lidl'"},
            "amount": {"type": "number"}, "personal_amount": {"type": "number"},
            "category": {"type": "string"}, "payment_method": {"type": "string", "enum": ["cash", "card"]},
            "date": {"type": "string"}, "notes": {"type": "string"}, "description": {"type": "string"}},
            "required": ["match"]},
    }},
    {"type": "function", "function": {
        "name": "delete_expense",
        "description": "Delete an expense identified by a text 'match'. This is destructive: call first WITHOUT confirm to preview, then only call again with confirm=true after the user explicitly agrees.",
        "parameters": {"type": "object", "properties": {
            "match": {"type": "string"}, "confirm": {"type": "boolean"}}, "required": ["match"]},
    }},
    {"type": "function", "function": {
        "name": "mark_refunded",
        "description": "Record that a person refunded part or all of an expense. Links the refund to the matched expense so its remaining refund updates. direction is always 'in'.",
        "parameters": {"type": "object", "properties": {
            "match": {"type": "string", "description": "Text to find the expense being refunded"},
            "person": {"type": "string"}, "amount": {"type": "number"},
            "method": {"type": "string", "enum": ["MB WAY", "Revolut", "Cash"]},
            "account": {"type": "string", "enum": ["cash", "revolut"]}}, "required": ["person", "amount"]},
    }},
    {"type": "function", "function": {
        "name": "update_grocery",
        "description": "Update a grocery inventory item by name: change quantity/stock, price, unit, category, low_threshold or notes.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "quantity": {"type": "number"}, "price": {"type": "number"},
            "unit": {"type": "string"}, "category": {"type": "string"}, "low_threshold": {"type": "number"},
            "notes": {"type": "string"}}, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "generate_shopping_list",
        "description": "Build a shopping list from current inventory (low/out of stock) and the owner's usual buys, then return price intelligence and the cheaper store recommendation.",
        "parameters": {"type": "object", "properties": {"days": {"type": "number"}}},
    }},
    {"type": "function", "function": {
        "name": "create_recipe",
        "description": "Create a recipe with ingredients (name, quantity, unit) and optional nutrition per whole recipe.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "servings": {"type": "number"},
            "ingredients": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"}, "quantity": {"type": "number"}, "unit": {"type": "string"}}}},
            "calories": {"type": "number"}, "protein": {"type": "number"}, "carbs": {"type": "number"}, "fat": {"type": "number"}},
            "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "cook_recipe",
        "description": "Cook a recipe by name: subtract its ingredients from grocery inventory and log a meal.",
        "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "log_workout",
        "description": "Log a completed workout session. type is Push/Pull/Legs or custom. Each exercise has a name, optional is_isometric, a duration in seconds (for isometrics like dead hang) and/or a list of sets with reps and weight (kg, 0 for bodyweight).",
        "parameters": {"type": "object", "properties": {
            "type": {"type": "string"}, "date": {"type": "string"},
            "exercises": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"}, "is_isometric": {"type": "boolean"},
                "duration": {"type": "number"},
                "sets": {"type": "array", "items": {"type": "object", "properties": {
                    "reps": {"type": "number"}, "weight": {"type": "number"}}}}}}},
            "notes": {"type": "string"}}, "required": ["type"]},
    }},
]

AI_SYSTEM = f"""You are the intelligence layer of Life Manager, a private personal life-management app for its owner, {OWNER_NAME}.
You turn raw natural language into structured, connected data by calling tools. You handle money/expenses, shared expenses and reimbursements, groceries, meals/nutrition, workouts, weight and tasks.

Rules:
- When the owner refers to themselves, use the participant name "Me".
- Payment methods are "cash" and "card" (card = Revolut). When creating expenses, map card->account "revolut", cash->account "cash".
- For shared expenses, figure out each person's share. If items are assigned to specific people, use split_mode "items" with the items array. If the split is equal, use split_mode "equal". Never fabricate amounts you weren't given.
- To change an existing expense use update_expense; to remove one use delete_expense (preview first, then confirm). To record a refund use mark_refunded (or record_payment for a general person payment).
- NEVER invent expenses, refunds, prices, grocery prices, or totals. If you don't have a value, say it is unknown and ask.
- If something is genuinely ambiguous and financially important (who to split with, or an amount), ASK a short clarifying question instead of guessing.
- For destructive actions (delete, large bulk changes) always confirm with the user first.
- For nutrition you MAY estimate calories/macros from typical food values, but say they are estimates.
- After performing actions, give a concise summary of exactly what changed (amounts, shares, refunds, remaining owed, inventory). Be warm but brief. Use € for currency.
- Today's date is {{today}}.
"""


async def find_expense(match: str) -> Optional[dict]:
    match = (match or "").strip()
    if not match:
        rows = await db.transactions.find({"type": "expense"}, {"_id": 0}).sort("date", -1).to_list(1)
        return rows[0] if rows else None
    rx = {"$regex": match, "$options": "i"}
    return await db.transactions.find_one(
        {"type": "expense", "$or": [{"merchant": rx}, {"description": rx}, {"category": rx}]},
        {"_id": 0}, sort=[("date", -1)])


async def dispatch_tool(name: str, args: dict, created: list) -> dict:
    try:
        if name == "create_expense":
            body = ExpenseBody(
                amount=args.get("amount"), merchant=args.get("merchant", ""),
                description=args.get("description", "") or args.get("merchant", ""),
                category=args.get("category", "Other"), account=args.get("account", "cash"),
                date=args.get("date"), participants=args.get("participants", ["Me"]),
                split_mode=args.get("split_mode", "equal"),
                items=[ItemBody(**i) for i in args.get("items", [])],
                exact_shares=args.get("exact_shares", {}) or {},
                add_to_inventory=args.get("add_to_inventory", False),
            )
            res = await create_expense_record(body)
            created.append({"collection": "transactions", "id": res["transaction"]["id"]})
            return res
        if name == "record_payment":
            s = await add_settlement(SettlementBody(
                person=args["person"], amount=args["amount"], method=args.get("method", "Revolut"),
                account=args.get("account", "revolut"), direction=args.get("direction", "in")), {"_id": "ai"})
            created.append({"collection": "settlements", "id": s["id"]})
            return s
        if name == "create_person":
            p = await resolve_person(args["name"])
            return p
        if name == "add_grocery":
            g = await add_grocery(GroceryBody(**{k: v for k, v in args.items() if k in GroceryBody.model_fields}), {"_id": "ai"})
            if g.get("id"):
                created.append({"collection": "groceries", "id": g["id"]})
            return g
        if name == "log_meal":
            m = await add_meal(MealBody(**{k: v for k, v in args.items() if k in MealBody.model_fields}), {"_id": "ai"})
            created.append({"collection": "meals", "id": m["id"]})
            return m
        if name == "record_weight":
            w = await add_weight(WeightBody(weight=args["weight"], date=args.get("date")), {"_id": "ai"})
            created.append({"collection": "weight", "id": w["id"]})
            return w
        if name == "create_task":
            t = await create_task(TaskBody(title=args["title"], priority=args.get("priority", "normal"), due=args.get("due")), {"_id": "ai"})
            created.append({"collection": "tasks", "id": t["id"]})
            return t
        if name == "get_financial_summary":
            return await analytics_summary(month=args.get("month"), user={"_id": "ai"})
        if name == "get_people_balances":
            return await people_balances()
        if name == "update_expense":
            t = await find_expense(args.get("match", ""))
            if not t:
                return {"error": f"No expense found matching '{args.get('match')}'"}
            upd = TxnUpdate(amount=args.get("amount"), personal_amount=args.get("personal_amount"),
                            category=args.get("category"), payment_method=args.get("payment_method"),
                            date=args.get("date"), notes=args.get("notes"), description=args.get("description"))
            res = await update_transaction(t["id"], upd, {"_id": "ai"})
            return {"updated": res}
        if name == "delete_expense":
            t = await find_expense(args.get("match", ""))
            if not t:
                return {"error": f"No expense found matching '{args.get('match')}'"}
            if not args.get("confirm"):
                return {"needs_confirmation": True,
                        "message": f"This will permanently delete '{t.get('merchant') or t.get('description')}' (€{t.get('gross_amount')}) from {t.get('date')}. Ask the user to confirm before deleting."}
            await delete_transaction(t["id"], {"_id": "ai"})
            return {"deleted": t.get("merchant") or t.get("description"), "amount": t.get("gross_amount")}
        if name == "mark_refunded":
            tid = None
            if args.get("match"):
                t = await find_expense(args["match"])
                tid = t["id"] if t else None
            s = await add_settlement(SettlementBody(
                person=args["person"], amount=args["amount"], method=args.get("method", "Revolut"),
                account=args.get("account", "revolut"), direction="in", transaction_id=tid), {"_id": "ai"})
            created.append({"collection": "settlements", "id": s["id"]})
            return {"settlement": s, "linked_to_expense": tid is not None}
        if name == "update_grocery":
            g = await db.groceries.find_one({"name_lower": args["name"].lower()}, {"_id": 0})
            if not g:
                return {"error": f"No grocery item named '{args['name']}'"}
            upd = GroceryUpdate(**{k: v for k, v in args.items() if k in GroceryUpdate.model_fields and k != "name"})
            res = await update_grocery(g["id"], upd, {"_id": "ai"})
            return {"updated": res}
        if name == "generate_shopping_list":
            return await generate_shopping_doc(int(args.get("days", 7)))
        if name == "create_recipe":
            body = RecipeBody(name=args["name"], servings=int(args.get("servings", 1)),
                              ingredients=[RecipeIngredient(**i) for i in args.get("ingredients", [])],
                              calories=args.get("calories"), protein=args.get("protein"),
                              carbs=args.get("carbs"), fat=args.get("fat"))
            r = await create_recipe(body, {"_id": "ai"})
            created.append({"collection": "recipes", "id": r["id"]})
            return r
        if name == "cook_recipe":
            r = await db.recipes.find_one({"name": {"$regex": f"^{args['name']}$", "$options": "i"}}, {"_id": 0})
            if not r:
                return {"error": f"No recipe named '{args['name']}'"}
            return await cook_recipe_doc(r)
        if name == "log_workout":
            body = WorkoutBody(type=args.get("type", "Push"), date=args.get("date"), notes=args.get("notes", ""),
                               exercises=[WorkoutExercise(name=e["name"], is_isometric=e.get("is_isometric", False),
                                                          duration=e.get("duration"),
                                                          sets=[WorkoutSet(**s) for s in e.get("sets", [])]) for e in args.get("exercises", [])])
            w = await create_workout(body, {"_id": "ai"})
            created.append({"collection": "workouts", "id": w["id"]})
            return w
    except Exception as e:
        logger.exception("tool error")
        return {"error": str(e)}
    return {"error": "unknown tool"}


@api_router.post("/ai/chat")
async def ai_chat(body: AIChatBody, user: dict = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

    session_id = body.session_id or new_id()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d (%A)")
    system = AI_SYSTEM.replace("{today}", today)

    # load history
    history = await db.ai_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(200)

    chat = (LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system)
            .with_model("gemini", "gemini-3-flash-preview")
            .with_tools(AI_TOOLS, tool_choice="auto"))

    # replay context as a compact preamble (history persistence is our own)
    if history:
        convo = "\n".join(f"{h['role']}: {h['text']}" for h in history[-12:])
        system_ctx = f"Recent conversation so far:\n{convo}"
    else:
        system_ctx = ""

    kwargs = {}
    if body.image_base64:
        b64 = body.image_base64.split(",")[-1]
        kwargs["file_contents"] = [ImageContent(image_base64=b64)]

    prompt = body.message
    if system_ctx:
        prompt = system_ctx + "\n\nNew message from " + OWNER_NAME + ": " + body.message

    created = []
    tool_summary = []
    try:
        response = await chat.send_message_with_tools(UserMessage(text=prompt, **kwargs))
        guard = 0
        while getattr(response, "tool_calls", None) and guard < 6:
            guard += 1
            for tc in response.tool_calls:
                args = tc.arguments if isinstance(tc.arguments, dict) else json.loads(tc.arguments or "{}")
                result = await dispatch_tool(tc.name, args, created)
                tool_summary.append({"tool": tc.name, "args": args})
                chat.add_tool_result(tc.id, json.dumps(result, default=str))
            response = await chat.send_message_with_tools()
        reply = response.content if hasattr(response, "content") else str(response)
    except Exception as e:
        logger.exception("ai chat failed")
        raise HTTPException(500, f"AI request failed: {e}")

    # persist messages
    await db.ai_messages.insert_one({"session_id": session_id, "role": "user", "text": body.message, "created_at": now_iso()})
    await db.ai_messages.insert_one({"session_id": session_id, "role": "assistant", "text": reply or "", "created_at": now_iso()})

    if tool_summary:
        label = reply[:140] if reply else (tool_summary[0]["tool"].replace("_", " ").title())
        await db.ai_actions.insert_one({
            "id": new_id(), "label": label,
            "tools": [t["tool"] for t in tool_summary], "created": created,
            "undoable": len(created) > 0, "undone": False, "created_at": now_iso(),
        })

    return {"reply": reply, "session_id": session_id, "actions": tool_summary, "changed": len(created) > 0 or len(tool_summary) > 0}


@api_router.get("/ai/history")
async def ai_history(session_id: str, user: dict = Depends(get_current_user)):
    return await db.ai_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(200)


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
async def seed():
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_pw = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({"email": admin_email, "password_hash": hash_password(admin_pw),
                                   "name": OWNER_NAME, "role": "owner", "created_at": now_iso()})
    elif not verify_password(admin_pw, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_pw)}})

    if await db.categories.count_documents({}) == 0:
        cats = [
            ("Groceries", "shopping-cart", "#10B981"), ("Eating Out", "utensils", "#F59E0B"),
            ("Transport", "bus", "#6366F1"), ("Shopping", "shopping-bag", "#EC4899"),
            ("Entertainment", "clapperboard", "#8B5CF6"), ("Work", "briefcase", "#0EA5E9"),
            ("Fitness", "dumbbell", "#059669"), ("Health", "heart-pulse", "#EF4444"),
            ("Travel", "plane", "#14B8A6"), ("Subscriptions", "repeat", "#F97316"),
            ("Bills", "receipt", "#64748B"), ("Other", "circle", "#94A3B8"),
        ]
        await db.categories.insert_many([
            {"id": new_id(), "name": n, "icon": i, "color": c, "created_at": now_iso()} for n, i, c in cats])

    if await db.accounts.count_documents({}) == 0:
        await db.accounts.insert_many([
            {"id": "cash", "name": "Cash", "type": "cash", "opening_balance": 120.0, "created_at": now_iso()},
            {"id": "revolut", "name": "Revolut", "type": "revolut", "opening_balance": 640.0, "created_at": now_iso()},
        ])

    if await db.people.count_documents({}) == 0:
        for n in ["Ferreira", "Broca", "Sebas", "Mariana", "Faia"]:
            await db.people.insert_one({"id": new_id(), "name": n, "name_lower": n.lower(),
                                        "photo": None, "notes": "", "payment_preference": "", "created_at": now_iso()})

    if await db.transactions.count_documents({}) == 0:
        await seed_transactions()

    if await db.tasks.count_documents({}) == 0:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for title, pr in [("Record weekly weight", "high"), ("Pull workout", "normal"),
                          ("Ask Ferreira for payment", "normal"), ("Buy eggs and milk", "low")]:
            await db.tasks.insert_one({"id": new_id(), "title": title, "priority": pr, "due": today,
                                       "recurring": None, "done": False, "created_at": now_iso()})

    if await db.weight.count_documents({}) == 0:
        base = datetime.now(timezone.utc) - timedelta(weeks=6)
        weights = [81.2, 81.6, 82.0, 82.3, 82.7, 83.0]
        for i, w in enumerate(weights):
            d = (base + timedelta(weeks=i)).strftime("%Y-%m-%d")
            await db.weight.insert_one({"id": new_id(), "weight": w, "date": d, "note": "Weekly check-in", "created_at": now_iso()})

    if await db.groceries.count_documents({}) == 0:
        gs = [("Eggs", 3, "unit", "Eggs", 3.49, "Lidl", 6), ("Milk", 1, "L", "Dairy", 0.89, "Mercadona", 2),
              ("Chicken breast", 600, "g", "Meat", 5.20, "Mercadona", 200), ("Tuna", 4, "can", "Fish", 3.29, "Supeco", 2),
              ("Gouda", 200, "g", "Dairy", 4.98, "Lidl", 100), ("Rice", 1000, "g", "Carbohydrates", None, None, 300),
              ("Bread", 1, "unit", "Carbohydrates", 0.95, "Lidl", 1)]
        for n, q, u, c, p, s, lt in gs:
            await db.groceries.insert_one({"id": new_id(), "name": n, "name_lower": n.lower(), "quantity": q,
                                           "unit": u, "category": c, "price": p, "store": s, "low_threshold": lt,
                                           "notes": "", "expiration": None,
                                           "created_at": now_iso(), "updated_at": now_iso()})

    if await db.price_records.count_documents({}) == 0:
        pr = [
            ("Eggs", "Lidl", 3.49, "2025-09-25"), ("Eggs", "Mercadona", 3.89, "2025-09-17"), ("Eggs", "Supeco", 3.29, "2025-09-10"),
            ("Milk", "Mercadona", 0.89, "2025-09-17"), ("Milk", "Lidl", 0.95, "2025-09-25"),
            ("Chicken breast", "Mercadona", 5.20, "2025-10-08"), ("Chicken breast", "Lidl", 5.60, "2025-11-04"),
            ("Tuna", "Supeco", 3.29, "2025-09-10"), ("Tuna", "Lidl", 2.99, "2025-11-04"), ("Tuna", "Mercadona", 3.49, "2025-10-08"),
            ("Gouda", "Lidl", 4.98, "2025-09-25"), ("Gouda", "Mercadona", 5.20, "2025-10-08"),
            ("Bread", "Lidl", 0.95, "2025-11-04"), ("Bread", "Mercadona", 1.10, "2025-10-08"),
        ]
        for n, s, p, d in pr:
            await db.price_records.insert_one({"id": new_id(), "name": n, "name_lower": n.lower(), "store": s,
                                               "price": p, "unit": "unit", "date": d, "created_at": now_iso()})

    if await db.recipes.count_documents({}) == 0:
        await db.recipes.insert_one({"id": new_id(), "name": "Protein scramble", "servings": 1,
                                     "ingredients": [{"name": "Eggs", "quantity": 3, "unit": "unit"},
                                                     {"name": "Gouda", "quantity": 30, "unit": "g"},
                                                     {"name": "Bread", "quantity": 1, "unit": "unit"}],
                                     "calories": 520, "protein": 34, "carbs": 30, "fat": 28,
                                     "notes": "Quick high-protein breakfast.", "created_at": now_iso()})

    if await db.meals.count_documents({}) == 0:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await db.meals.insert_many([
            {"id": new_id(), "description": "Oats, whey & banana", "date": today, "calories": 520, "protein": 38, "carbs": 68, "fat": 12, "created_at": now_iso()},
            {"id": new_id(), "description": "200g alcatra, 3 eggs, 300ml milk", "date": today, "calories": 690, "protein": 62, "carbs": 14, "fat": 42, "created_at": now_iso()},
        ])

    if await db.workouts.count_documents({}) == 0:
        now = datetime.now(timezone.utc)
        await db.workouts.insert_many([
            {"id": new_id(), "type": "Pull", "date": (now - timedelta(days=3)).strftime("%Y-%m-%d"), "notes": "",
             "exercises": [
                 {"name": "Pull-ups", "is_isometric": False, "duration": None, "note": "", "sets": [{"reps": 8, "weight": 0}, {"reps": 7, "weight": 0}, {"reps": 6, "weight": 0}]},
                 {"name": "Rows", "is_isometric": False, "duration": None, "note": "", "sets": [{"reps": 10, "weight": 20}, {"reps": 10, "weight": 20}, {"reps": 9, "weight": 20}]},
                 {"name": "Dead hang", "is_isometric": True, "duration": 45, "note": "", "sets": []},
             ], "created_at": now_iso()},
            {"id": new_id(), "type": "Push", "date": (now - timedelta(days=1)).strftime("%Y-%m-%d"), "notes": "",
             "exercises": [
                 {"name": "Dips", "is_isometric": False, "duration": None, "note": "", "sets": [{"reps": 12, "weight": 0}, {"reps": 11, "weight": 0}, {"reps": 10, "weight": 0}]},
                 {"name": "Push-ups", "is_isometric": False, "duration": None, "note": "", "sets": [{"reps": 15, "weight": 0}, {"reps": 15, "weight": 0}]},
             ], "created_at": now_iso()},
        ])

    # write test credentials
    try:
        cred_path = Path("/app/memory/test_credentials.md")
        cred_path.parent.mkdir(parents=True, exist_ok=True)
        cred_path.write_text(
            f"# Test Credentials\n\n## Owner account (JWT email+password)\n"
            f"- Email: {admin_email}\n- Password: {admin_pw}\n- Name: {OWNER_NAME}\n\n"
            f"## Auth endpoints\n- POST /api/auth/login (body: email, password) -> returns token\n"
            f"- GET /api/auth/me (Authorization: Bearer <token>)\n\n"
            f"Token is returned in login response body and sent as `Authorization: Bearer <token>`.\n")
    except Exception:
        pass


async def seed_transactions():
    people = await db.people.find({}, {"_id": 0}).to_list(100)
    pmap = {p["name"]: p for p in people}

    async def exp(amount, merchant, cat, account, date, participants=None, items=None, split_mode="equal", desc=""):
        body = ExpenseBody(amount=amount, merchant=merchant, description=desc or merchant, category=cat,
                           account=account, date=date, participants=participants or ["Me"],
                           items=[ItemBody(**i) for i in items] if items else [],
                           split_mode=split_mode)
        await create_expense_record(body)

    # September
    await exp(26.10, "Lidl", "Groceries", "revolut", "2025-09-25",
              participants=["Me", "Ferreira", "Broca", "Sebas", "Mariana"], split_mode="items",
              items=[{"name": "Potatoes", "price": 3.58, "assigned": ["Me", "Ferreira", "Broca", "Sebas", "Mariana"]},
                     {"name": "Onion", "price": 1.69, "assigned": ["Me", "Ferreira", "Broca", "Sebas", "Mariana"]},
                     {"name": "Bread", "price": 1.20, "assigned": ["Me", "Ferreira", "Broca", "Sebas", "Mariana"]},
                     {"name": "Big escalopín", "price": 6.90, "assigned": ["Me", "Ferreira", "Broca", "Sebas", "Mariana"]},
                     {"name": "Juice", "price": 1.13, "assigned": ["Broca"]},
                     {"name": "Powdered cheese", "price": 0.95, "assigned": ["Me"]},
                     {"name": "Gouda", "price": 4.98, "assigned": ["Me"]},
                     {"name": "Small escalopín", "price": 3.18, "assigned": ["Me"]},
                     {"name": "Chow Mein", "price": 0.49, "assigned": ["Me"]}])
    await exp(14.00, "McDonald's", "Eating Out", "cash", "2025-09-12")
    await exp(38.90, "Mercadona", "Groceries", "revolut", "2025-09-17")
    await exp(9.50, "Selecta", "Eating Out", "cash", "2025-09-20", participants=["Me", "Sebas"], split_mode="equal")
    await exp(22.40, "Supeco", "Groceries", "revolut", "2025-09-10")

    # October
    await exp(11.80, "Popeyes", "Eating Out", "cash", "2025-10-03", participants=["Me", "Faia"], split_mode="equal")
    await exp(41.20, "Mercadona", "Groceries", "revolut", "2025-10-08")
    await exp(6.30, "MAS", "Groceries", "cash", "2025-10-11")
    await exp(19.99, "Netflix & Spotify", "Subscriptions", "revolut", "2025-10-01")
    await exp(15.50, "Uber", "Transport", "revolut", "2025-10-15", participants=["Me", "Broca", "Mariana"], split_mode="equal")

    # November
    await exp(27.60, "Lidl", "Groceries", "revolut", "2025-11-04")
    await exp(13.20, "McDonald's", "Eating Out", "cash", "2025-11-09", participants=["Me", "Ferreira"], split_mode="equal")
    await exp(52.00, "Decathlon", "Fitness", "revolut", "2025-11-12")

    # recent activity (so Day / Week views show real data relative to today)
    now = datetime.now(timezone.utc)
    d0 = now.strftime("%Y-%m-%d")
    d2 = (now - timedelta(days=2)).strftime("%Y-%m-%d")
    d5 = (now - timedelta(days=5)).strftime("%Y-%m-%d")
    await exp(8.60, "Mercadona", "Groceries", "cash", d0)
    await exp(23.40, "Lidl", "Groceries", "revolut", d2, participants=["Me", "Broca"], split_mode="equal")
    await exp(6.90, "McDonald's", "Eating Out", "cash", d5)

    # a couple of settlements
    ferreira = pmap.get("Ferreira")
    if ferreira:
        await db.settlements.insert_one({"id": new_id(), "person_id": ferreira["id"], "person_name": "Ferreira",
                                         "amount": 5.00, "method": "Revolut", "account": "revolut",
                                         "direction": "in", "date": "2025-10-20", "transaction_id": None, "created_at": now_iso()})


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.people.create_index("name_lower")
    await db.transactions.create_index("month")
    await seed()
    try:
        init_storage()
        logger.info("Storage initialized.")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    logger.info("Life Manager ready.")


@app.on_event("shutdown")
async def shutdown():
    client.close()


@api_router.get("/")
async def root():
    return {"app": "Life Manager", "status": "ok"}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
