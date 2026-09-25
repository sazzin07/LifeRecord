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
from bson import ObjectId
from fastapi import FastAPI, APIRouter, Request, HTTPException, Depends, UploadFile, File
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


class MealBody(BaseModel):
    description: str
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    date: Optional[str] = None


class AIChatBody(BaseModel):
    message: str
    session_id: Optional[str] = None
    image_base64: Optional[str] = None
    confirm_token: Optional[str] = None


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
@api_router.get("/transactions")
async def get_transactions(month: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if month:
        q["month"] = month
    return await db.transactions.find(q, {"_id": 0}).sort("date", -1).to_list(2000)


@api_router.post("/transactions/expense")
async def add_expense(body: ExpenseBody, user: dict = Depends(get_current_user)):
    res = await create_expense_record(body)
    return res


@api_router.delete("/transactions/{tid}")
async def delete_transaction(tid: str, user: dict = Depends(get_current_user)):
    await db.transactions.delete_one({"id": tid})
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
         "direction": body.direction, "date": date, "created_at": now_iso()}
    await db.settlements.insert_one(dict(s))
    s.pop("_id", None)
    return s


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
@api_router.get("/analytics/summary")
async def analytics_summary(month: Optional[str] = None, user: dict = Depends(get_current_user)):
    accounts = await get_accounts(user)
    cash = next((a["balance"] for a in accounts if a["id"] == "cash"), 0)
    revolut = next((a["balance"] for a in accounts if a["id"] == "revolut"), 0)

    q = {"type": "expense"}
    if month:
        q["month"] = month
    gross = personal = 0.0
    by_cat = {}
    by_day = {}
    async for t in db.transactions.find(q, {"_id": 0}):
        gross += t["gross_amount"]
        personal += t["personal_amount"]
        by_cat[t["category"]] = by_cat.get(t["category"], 0) + t["gross_amount"]
        by_day[t["date"]] = by_day.get(t["date"], 0) + t["gross_amount"]

    people = await people_balances()
    owed_to_me = round(sum(p["owes_me"] for p in people), 2)
    i_owe = round(sum(p["i_owe"] for p in people), 2)
    outstanding = round(sum(max(p["net"], 0) for p in people), 2)

    months = await db.transactions.distinct("month")
    return {
        "cash": cash, "revolut": revolut, "total_available": round(cash + revolut, 2),
        "gross": round(gross, 2), "personal": round(personal, 2),
        "reimbursable": round(gross - personal, 2),
        "owed_to_me": owed_to_me, "i_owe": i_owe, "outstanding": outstanding,
        "by_category": [{"name": k, "value": round(v, 2)} for k, v in sorted(by_cat.items(), key=lambda x: -x[1])],
        "by_day": [{"date": k, "value": round(v, 2)} for k, v in sorted(by_day.items())],
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
# Groceries
# ---------------------------------------------------------------------------
@api_router.get("/groceries")
async def get_groceries(user: dict = Depends(get_current_user)):
    return await db.groceries.find({}, {"_id": 0}).sort("name", 1).to_list(2000)


@api_router.post("/groceries")
async def add_grocery(body: GroceryBody, user: dict = Depends(get_current_user)):
    existing = await db.groceries.find_one({"name_lower": body.name.lower()})
    if existing:
        await db.groceries.update_one({"id": existing["id"]}, {"$inc": {"quantity": body.quantity},
                                                                "$set": {"price": body.price or existing.get("price"),
                                                                         "store": body.store or existing.get("store")}})
        return await db.groceries.find_one({"id": existing["id"]}, {"_id": 0})
    g = {"id": new_id(), "name": body.name, "name_lower": body.name.lower(),
         "quantity": body.quantity, "unit": body.unit, "category": body.category,
         "price": body.price, "store": body.store, "low_threshold": body.low_threshold,
         "created_at": now_iso()}
    await db.groceries.insert_one(dict(g))
    g.pop("_id", None)
    return g


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
]

AI_SYSTEM = f"""You are the intelligence layer of Life Manager, a private personal life-management app for its owner, {OWNER_NAME}.
You turn raw natural language into structured, connected data by calling tools. You handle money/expenses, shared expenses and reimbursements, groceries, meals/nutrition, workouts, weight and tasks.

Rules:
- When the owner refers to themselves, use the participant name "Me".
- For shared expenses, figure out each person's share. If items are assigned to specific people, use split_mode "items" with the items array. If the split is equal, use split_mode "equal". Never fabricate amounts you weren't given.
- If something is genuinely ambiguous and financially important (e.g. who to split with, or an amount), ASK a short clarifying question instead of guessing.
- For nutrition you MAY estimate calories/macros from typical food values, but keep estimates reasonable and mention they are estimates.
- After performing actions, give a concise summary of exactly what changed (amounts, shares, reimbursements, inventory). Be warm but brief. Use € for currency.
- Today's date is {{today}}.
"""


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

    if created:
        label = tool_summary[0]["tool"].replace("_", " ").title() if tool_summary else "AI action"
        await db.ai_actions.insert_one({
            "id": new_id(), "label": reply[:120] if reply else label,
            "tools": [t["tool"] for t in tool_summary], "created": created,
            "undone": False, "created_at": now_iso(),
        })

    return {"reply": reply, "session_id": session_id, "actions": tool_summary, "changed": len(created) > 0}


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
                                           "created_at": now_iso()})

    if await db.meals.count_documents({}) == 0:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await db.meals.insert_many([
            {"id": new_id(), "description": "Oats, whey & banana", "date": today, "calories": 520, "protein": 38, "carbs": 68, "fat": 12, "created_at": now_iso()},
            {"id": new_id(), "description": "200g alcatra, 3 eggs, 300ml milk", "date": today, "calories": 690, "protein": 62, "carbs": 14, "fat": 42, "created_at": now_iso()},
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

    # a couple of settlements
    ferreira = pmap.get("Ferreira")
    if ferreira:
        await db.settlements.insert_one({"id": new_id(), "person_id": ferreira["id"], "person_name": "Ferreira",
                                         "amount": 5.00, "method": "Revolut", "account": "revolut",
                                         "direction": "in", "date": "2025-10-20", "created_at": now_iso()})


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.people.create_index("name_lower")
    await db.transactions.create_index("month")
    await seed()
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
