from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import json
import logging
import re
import asyncio
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any

import jwt
from fastapi import FastAPI, APIRouter, Request, HTTPException, Depends, UploadFile, File, Query, Response
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, update, func, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession

from database import engine, AsyncSessionLocal, get_db
from models import (
    Base, User, Account, Category, Person, Transaction, Split, Settlement,
    Task, WeightEntry, Workout, Photo, Grocery, PriceRecord, ShoppingItem,
    Meal, Recipe, AIAction, AIMessage,
)
from security_utils import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    create_password_reset_token, decode_token, generate_six_digit_code,
    is_valid_email, is_strong_password,
)
from email_service import send_verification_code, send_password_reset

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
# Session-scoped pending confirmations for destructive tool calls.
# Maps session_id -> {tool, target_id, match, expires_at}.
_pending_confirmations: Dict[str, Dict[str, Any]] = {}
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
OWNER_NAME = os.environ.get('OWNER_NAME', 'Sá')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')

# Gemini model configuration
# Primary default is Flash Lite because it has the highest free-tier quota.
# FALLBACKS is a comma-separated list tried in order when the API returns a
# quota/rate-limit / model-overloaded error.
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-3.5-flash-lite')
GEMINI_FALLBACKS = [
    m.strip()
    for m in os.environ.get(
        'GEMINI_MODEL_FALLBACKS',
        'gemini-3.5-flash-lite,gemini-3.5-flash,gemini-1.5-flash'
    ).split(',')
    if m.strip()
]
GEMINI_FALLBACK_DELAY = float(os.environ.get('GEMINI_FALLBACK_DELAY_SECONDS', '0.5'))
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000').rstrip('/')

# Rate-limit configuration for auth endpoints
AUTH_RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_AUTH_WINDOW_SECONDS", "60"))
AUTH_RATE_LIMIT_MAX = int(os.environ.get("RATE_LIMIT_AUTH_MAX_ATTEMPTS", "10"))

# In-memory rate-limit store: key -> list of timestamps
_rate_limit_store: Dict[str, List[float]] = {}


def _rate_limit_key(request: Request, identifier: str) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{client}:{identifier.lower().strip()}"


def _cleanup_rate_limit_store(now: float) -> None:
    """Remove stale rate-limit entries to prevent unbounded memory growth."""
    cutoff = now - (AUTH_RATE_LIMIT_WINDOW * 2)
    keys_to_remove = [k for k, v in _rate_limit_store.items() if not v or v[-1] < cutoff]
    for k in keys_to_remove:
        del _rate_limit_store[k]


def check_rate_limit(request: Request, identifier: str) -> None:
    now = datetime.now(timezone.utc).timestamp()
    key = _rate_limit_key(request, identifier)
    window = _rate_limit_store.setdefault(key, [])
    # Trim old entries
    cutoff = now - AUTH_RATE_LIMIT_WINDOW
    window[:] = [t for t in window if t > cutoff]
    if len(window) >= AUTH_RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many attempts. Please try again later.")
    window.append(now)
    # Periodic full cleanup (cheap: only when the store grows)
    if len(_rate_limit_store) % 100 == 0:
        _cleanup_rate_limit_store(now)


def _user_owned_query(model, user: dict):
    """Return a base select filtered to the current user."""
    return select(model).where(model.user_id == user["_id"])

app = FastAPI(title="Life Record")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("liferecord")


# ---------------------------------------------------------------------------
# Object storage (local filesystem) for progress photos
# ---------------------------------------------------------------------------
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", str(ROOT_DIR / "storage")))
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
APP_NAME = "life-record"


def storage_path(relative: str) -> Path:
    return STORAGE_DIR / relative


def _safe_storage_path(path: str) -> Path:
    """Resolve the path and ensure it stays inside STORAGE_DIR."""
    full = storage_path(path).resolve()
    root = STORAGE_DIR.resolve()
    try:
        full.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid storage path")
    return full


def save_object(path: str, data: bytes) -> str:
    full = _safe_storage_path(path)
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)
    return path


def read_object(path: str) -> bytes:
    return _safe_storage_path(path).read_bytes()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def month_of(date_str: str) -> str:
    return date_str[:7]


def to_dict(obj, exclude=None):
    """Convert a SQLAlchemy model instance to a dict mirroring the old {_id:0} projection."""
    if obj is None:
        return None
    d = {}
    for c in obj.__table__.columns:
        if exclude and c.name in exclude:
            continue
        val = getattr(obj, c.name)
        if isinstance(val, (int, float, str, bool, type(None))):
            d[c.name] = val
        elif hasattr(val, "__float__"):
            d[c.name] = float(val)
        elif isinstance(val, (dict, list)):
            d[c.name] = val
        else:
            d[c.name] = str(val) if val is not None else None
    return d


def row_to_dict(row) -> dict:
    """For ORM rows that are already model instances."""
    return to_dict(row)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
# Password hashing, token creation, and validation now live in security_utils.py

async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    token = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token, token_type="access")
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if not user.email_verified:
            raise HTTPException(status_code=403, detail="Email not verified")
        return {"_id": user.id, "email": user.email, "name": user.name, "role": user.role}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user_optional_unverified(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Used by verification/reset flows that need a logged-in-ish context but allow unverified users."""
    token = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token, token_type="access")
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return {"_id": user.id, "email": user.email, "name": user.name, "role": user.role, "email_verified": user.email_verified}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginBody(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., max_length=255)


class SignupBody(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., max_length=255)
    name: str = Field(..., min_length=1, max_length=255)


class VerifyCodeBody(BaseModel):
    email: str = Field(..., max_length=255)
    code: str = Field(..., min_length=6, max_length=6)


class ResendCodeBody(BaseModel):
    email: str = Field(..., max_length=255)


class ForgotPasswordBody(BaseModel):
    email: str = Field(..., max_length=255)


class ResetPasswordBody(BaseModel):
    token: str = Field(..., max_length=2048)
    password: str = Field(..., max_length=255)


class RefreshBody(BaseModel):
    token: str = Field(..., max_length=2048)


class ChangePasswordBody(BaseModel):
    current_password: str = Field(..., max_length=255)
    new_password: str = Field(..., max_length=255)


class PersonBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    photo: Optional[str] = Field(default=None, max_length=2048)
    notes: Optional[str] = Field(default="", max_length=2000)
    payment_preference: Optional[str] = Field(default="", max_length=255)


class CategoryBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    icon: str = Field(default="circle", max_length=50)
    color: str = Field(default="#64748B", max_length=50)
    monthly_budget: Optional[float] = Field(default=None, ge=0)


class ItemBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    price: float
    assigned: List[str] = ["Me"]


class ExpenseBody(BaseModel):
    amount: Optional[float] = None
    description: str = Field(default="", max_length=500)
    category: str = Field(default="Other", max_length=255)
    account: str = Field(default="cash", max_length=50)
    merchant: str = Field(default="", max_length=255)
    date: Optional[str] = None
    notes: str = Field(default="", max_length=2000)
    participants: List[str] = ["Me"]
    split_mode: str = Field(default="equal", max_length=20)
    items: List[ItemBody] = []
    exact_shares: Dict[str, float] = {}
    paid_by: str = Field(default="Me", max_length=255)
    add_to_inventory: bool = False


class SettlementBody(BaseModel):
    person: str = Field(..., min_length=1, max_length=255)
    amount: float
    method: str = Field(default="Revolut", max_length=50)
    account: str = Field(default="revolut", max_length=50)
    direction: str = Field(default="in", max_length=10)
    date: Optional[str] = None
    transaction_id: Optional[str] = None


class TransferBody(BaseModel):
    from_account: str = Field(..., max_length=50)
    to_account: str = Field(..., max_length=50)
    amount: float
    date: Optional[str] = None
    notes: str = Field(default="", max_length=2000)


class IncomeBody(BaseModel):
    account: str = Field(..., max_length=50)
    amount: float
    description: str = Field(default="", max_length=500)
    date: Optional[str] = None


class TaskBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    priority: str = Field(default="normal", max_length=50)
    due: Optional[str] = None
    recurring: Optional[str] = Field(default=None, max_length=50)
    done: bool = False


class WeightBody(BaseModel):
    weight: float = Field(..., ge=0, le=1000)
    date: Optional[str] = None
    note: str = Field(default="", max_length=1000)


class GroceryBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    quantity: float = Field(default=1, ge=0)
    unit: str = Field(default="unit", max_length=50)
    category: str = Field(default="Other", max_length=255)
    price: Optional[float] = None
    store: Optional[str] = Field(default=None, max_length=255)
    low_threshold: float = Field(default=0, ge=0)
    notes: str = Field(default="", max_length=2000)
    expiration: Optional[str] = None


class GroceryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    quantity: Optional[float] = Field(default=None, ge=0)
    unit: Optional[str] = Field(default=None, max_length=50)
    category: Optional[str] = Field(default=None, max_length=255)
    price: Optional[float] = None
    store: Optional[str] = Field(default=None, max_length=255)
    low_threshold: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = Field(default=None, max_length=2000)
    expiration: Optional[str] = None


class TxnUpdate(BaseModel):
    description: Optional[str] = Field(default=None, max_length=500)
    category: Optional[str] = Field(default=None, max_length=255)
    account: Optional[str] = Field(default=None, max_length=50)
    payment_method: Optional[str] = Field(default=None, max_length=50)
    date: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=2000)
    amount: Optional[float] = None
    personal_amount: Optional[float] = None


class MealBody(BaseModel):
    description: str = Field(..., min_length=1, max_length=500)
    calories: Optional[float] = Field(default=None, ge=0, le=50000)
    protein: Optional[float] = Field(default=None, ge=0, le=5000)
    carbs: Optional[float] = Field(default=None, ge=0, le=5000)
    fat: Optional[float] = Field(default=None, ge=0, le=5000)
    date: Optional[str] = None


class ShoppingBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    quantity: float = Field(default=1, ge=0)
    unit: str = Field(default="unit", max_length=50)
    note: str = Field(default="", max_length=1000)


class BuyBody(BaseModel):
    price: Optional[float] = None
    store: Optional[str] = Field(default=None, max_length=255)


class RecipeIngredient(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    quantity: float = Field(default=1, ge=0)
    unit: str = Field(default="unit", max_length=50)


class RecipeBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    servings: int = Field(default=1, ge=1, le=1000)
    ingredients: List[RecipeIngredient] = []
    calories: Optional[float] = Field(default=None, ge=0, le=50000)
    protein: Optional[float] = Field(default=None, ge=0, le=5000)
    carbs: Optional[float] = Field(default=None, ge=0, le=5000)
    fat: Optional[float] = Field(default=None, ge=0, le=5000)
    notes: str = Field(default="", max_length=2000)


class AIChatBody(BaseModel):
    message: Optional[str] = Field(default="", max_length=4000)
    session_id: Optional[str] = Field(default=None, max_length=36)
    image_base64: Optional[str] = Field(default=None, max_length=8_000_000)  # ~6 MB base64
    confirm_token: Optional[str] = Field(default=None, max_length=256)


class WorkoutSet(BaseModel):
    reps: Optional[int] = Field(default=None, ge=0, le=10000)
    weight: Optional[float] = Field(default=None, ge=0, le=50000)


class WorkoutExercise(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    is_isometric: bool = False
    sets: List[WorkoutSet] = []
    duration: Optional[int] = Field(default=None, ge=0, le=86400)
    note: str = Field(default="", max_length=1000)


class WorkoutBody(BaseModel):
    type: str = Field(default="Push", max_length=50)
    date: Optional[str] = None
    exercises: List[WorkoutExercise] = []
    notes: str = Field(default="", max_length=2000)


class PhotoNote(BaseModel):
    note: str = Field(default="", max_length=2000)


# ---------------------------------------------------------------------------
# Finance core
# ---------------------------------------------------------------------------
async def resolve_person(db: AsyncSession, name: str, user_id: str) -> dict:
    if name.strip().lower() in ("me", "eu", "sá", "sa"):
        return {"id": "me", "name": "Me"}
    nl = name.strip().lower()
    p = (await db.execute(
        select(Person).where(Person.name_lower == nl, Person.user_id == user_id)
    )).scalar_one_or_none()
    if not p:
        p = Person(id=new_id(), user_id=user_id, name=name.strip(), name_lower=nl,
                   photo=None, notes="", payment_preference="", created_at=now_iso())
        db.add(p)
        await db.commit()
        await db.refresh(p)
    return {"id": p.id, "name": p.name}


def normalize_name(n: str) -> str:
    return "Me" if n.strip().lower() in ("me", "eu", "sá", "sa") else n.strip()


def compute_shares(gross: float, participants: List[str], items, split_mode, exact_shares):
    names = [normalize_name(n) for n in participants]
    if "Me" not in names:
        names = ["Me"] + names
    shares = {n: 0.0 for n in names}
    if split_mode == "items" and items:
        for it in items:
            assigned = it.get("assigned") or ["Me"]
            assigned = [normalize_name(a) for a in assigned]
            for a in assigned:
                shares.setdefault(a, 0.0)
                shares[a] += float(it["price"]) / len(assigned)
    elif split_mode == "exact" and exact_shares:
        for k, v in exact_shares.items():
            key = normalize_name(k)
            shares[key] = float(v)
    else:
        each = gross / len(names) if names else gross
        for n in names:
            shares[n] = each
    shares = {k: round(v, 2) for k, v in shares.items() if v > 0 or k == "Me"}
    return shares


async def create_expense_record(db: AsyncSession, body: ExpenseBody, user_id: str) -> dict:
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
        person = await resolve_person(db, name, user_id)
        split_list.append({"person_id": person["id"], "person_name": person["name"],
                           "amount": round(amt, 2), "is_me": person["id"] == "me"})

    personal = round(next((s["amount"] for s in split_list if s["is_me"]), 0.0), 2)
    reimbursable = round(gross - personal, 2)

    paid_by = "me" if body.paid_by.strip().lower() in ("me", "eu", "sá", "sa") else (await resolve_person(db, body.paid_by, user_id))["id"]

    txn = Transaction(
        id=new_id(), user_id=user_id, type="expense", gross_amount=gross, personal_amount=personal,
        reimbursable_amount=reimbursable,
        description=body.description or body.merchant, category=body.category,
        account=body.account, merchant=body.merchant, date=date, month=month_of(date),
        notes=body.notes, paid_by=paid_by, items=items, created_at=now_iso(),
    )
    db.add(txn)
    await db.flush()

    for s in split_list:
        db.add(Split(id=new_id(), transaction_id=txn.id, person_id=s["person_id"],
                     person_name=s["person_name"], amount=s["amount"], is_me=s["is_me"],
                     created_at=now_iso()))

    inventory_added = []
    if body.add_to_inventory and items:
        for it in items:
            g = Grocery(id=new_id(), user_id=user_id, name=it["name"], name_lower=it["name"].lower(),
                        quantity=1, unit="unit", category="Other",
                        price=it["price"], store=body.merchant, low_threshold=0,
                        notes="", expiration=None, created_at=now_iso(), updated_at=now_iso())
            db.add(g)
            inventory_added.append(it["name"])

    await db.commit()
    await db.refresh(txn)
    return {"transaction": txn_to_dict(txn), "inventory_added": inventory_added}


def txn_to_dict(txn: Transaction, rmap: Dict[str, float] = None) -> dict:
    d = to_dict(txn)
    d["splits"] = [to_dict(s) for s in txn.splits]
    d = serialize_txn(d, rmap or {})
    return d


async def compute_account_balance(db: AsyncSession, account: str, user_id: str) -> float:
    acc = (await db.execute(
        select(Account).where(Account.id == account, Account.user_id == user_id)
    )).scalar_one_or_none()
    bal = float(acc.opening_balance) if acc else 0.0

    result = await db.execute(select(Transaction).where(
        (Transaction.user_id == user_id) &
        (Transaction.type == "expense") & (Transaction.paid_by == "me") & (Transaction.account == account)
    ))
    for t in result.scalars():
        bal -= float(t.gross_amount)

    result = await db.execute(select(Transaction).where(
        (Transaction.user_id == user_id) &
        (Transaction.type == "income") & (Transaction.account == account)
    ))
    for t in result.scalars():
        bal += float(t.gross_amount)

    result = await db.execute(select(Transaction).where(
        (Transaction.user_id == user_id) & (Transaction.type == "transfer")
    ))
    for t in result.scalars():
        if t.from_account == account:
            bal -= float(t.gross_amount)
        if t.to_account == account:
            bal += float(t.gross_amount)

    result = await db.execute(select(Settlement).where(
        (Settlement.user_id == user_id) & (Settlement.account == account)
    ))
    for s in result.scalars():
        bal += float(s.amount) if s.direction == "in" else -float(s.amount)

    return round(bal, 2)


async def people_balances(db: AsyncSession, user_id: str) -> List[dict]:
    people = (await db.execute(
        select(Person).where(Person.user_id == user_id).order_by(Person.name)
    )).scalars().all()
    result = []
    for p in people:
        owed = 0.0
        i_owe = 0.0

        # expenses where this person has a split
        splits = (await db.execute(
            select(Split, Transaction).join(Transaction).where(
                Split.person_id == p.id,
                Transaction.user_id == user_id,
            )
        )).all()
        for sp, txn in splits:
            if txn.paid_by == "me":
                owed += float(sp.amount)
            if txn.paid_by == p.id and not sp.is_me:
                pass
            if txn.paid_by == p.id:
                if sp.is_me:
                    i_owe += float(sp.amount)

        settlements = (await db.execute(
            select(Settlement).where(Settlement.person_id == p.id, Settlement.user_id == user_id)
        )).scalars().all()
        for s in settlements:
            if s.direction == "in":
                owed -= float(s.amount)
            else:
                i_owe -= float(s.amount)

        net = round(owed - i_owe, 2)
        d = to_dict(p)
        d["owes_me"] = round(owed, 2)
        d["i_owe"] = round(i_owe, 2)
        d["net"] = net
        result.append(d)
    return result


# ---------------------------------------------------------------------------
# Price intelligence + shopping helpers
# ---------------------------------------------------------------------------
async def record_price(db: AsyncSession, name: str, store: Optional[str], price: Optional[float],
                         unit: str = "unit", user_id: str = None):
    if not store or price is None:
        return
    pr = PriceRecord(id=new_id(), user_id=user_id, name=name, name_lower=name.lower(), store=store,
                     price=round(float(price), 2), unit=unit,
                     date=datetime.now(timezone.utc).strftime("%Y-%m-%d"), created_at=now_iso())
    db.add(pr)
    await db.commit()


async def latest_prices(db: AsyncSession, name_lower: str, user_id: str) -> dict:
    recs = (await db.execute(
        select(PriceRecord).where(
            PriceRecord.name_lower == name_lower,
            PriceRecord.user_id == user_id,
        ).order_by(desc(PriceRecord.date))
    )).scalars().all()
    per_store = {}
    for r in recs:
        if r.store and r.store not in per_store:
            per_store[r.store] = {"price": float(r.price), "date": r.date}
    return per_store


def cheapest_store(per_store: dict):
    if not per_store:
        return None
    s, v = min(per_store.items(), key=lambda kv: kv[1]["price"])
    return {"store": s, "price": v["price"], "date": v["date"]}


async def shopping_payload(db: AsyncSession, user_id: str) -> dict:
    items = (await db.execute(
        select(ShoppingItem).where(
            ShoppingItem.user_id == user_id,
            ShoppingItem.bought == False,
        ).order_by(asc(ShoppingItem.created_at))
    )).scalars().all()
    enriched = []
    store_baskets = {}
    split_total = 0.0
    unknown = []
    for it in items:
        per_store = await latest_prices(db, it.name_lower, user_id)
        ch = cheapest_store(per_store)
        if ch:
            split_total += ch["price"]
            for store, v in per_store.items():
                b = store_baskets.setdefault(store, {"total": 0.0, "items": []})
                b["total"] = round(b["total"] + v["price"], 2)
                b["items"].append(it.name)
        else:
            unknown.append(it.name)
        enriched.append({**to_dict(it), "per_store": per_store, "best": ch, "known": ch is not None})

    priced_count = len(items) - len(unknown)
    stores = [{"store": s, "total": round(b["total"], 2), "covers": len(b["items"]), "items": b["items"]}
              for s, b in store_baskets.items()]
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


async def add_shopping_item_doc(db: AsyncSession, name: str, quantity: float = 1,
                                     unit: str = "unit", note: str = "", user_id: str = None) -> dict:
    existing = (await db.execute(
        select(ShoppingItem).where(
            ShoppingItem.user_id == user_id,
            ShoppingItem.name_lower == name.lower(),
            ShoppingItem.bought == False,
        )
    )).scalar_one_or_none()
    if existing:
        return to_dict(existing)
    doc = ShoppingItem(id=new_id(), user_id=user_id, name=name, name_lower=name.lower(), quantity=quantity,
                       unit=unit, note=note, bought=False, created_at=now_iso())
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return to_dict(doc)


async def generate_shopping_doc(db: AsyncSession, days: int = 7, user_id: str = None) -> dict:
    groceries = (await db.execute(
        select(Grocery).where(Grocery.user_id == user_id)
    )).scalars().all()
    stock = {g.name_lower: g for g in groceries}
    added = []
    for g in groceries:
        if g.low_threshold and float(g.quantity) <= float(g.low_threshold):
            await add_shopping_item_doc(db, g.name, max(1, round(days / 2)), g.unit or "unit", "Running low", user_id)
            added.append(g.name)
    known_names = [r[0] async for r in await db.stream(
        select(PriceRecord.name).where(PriceRecord.user_id == user_id).distinct()
    )]
    for name in known_names:
        nl = name.lower()
        if nl not in stock or float(stock[nl].quantity) <= 0:
            doc = await add_shopping_item_doc(db, name, 1, "unit", "From your usual buys", user_id)
            if doc["name"] not in added:
                added.append(doc["name"])
    payload = await shopping_payload(db, user_id)
    payload["added"] = added
    return payload


async def cook_recipe_doc(db: AsyncSession, recipe: dict, user_id: str) -> dict:
    changes = []
    for ing in recipe.get("ingredients", []):
        g = (await db.execute(
            select(Grocery).where(Grocery.name_lower == ing["name"].lower(), Grocery.user_id == user_id)
        )).scalar_one_or_none()
        if g:
            newq = max(0, round(float(g.quantity) - (ing.get("quantity") or 0), 2))
            g.quantity = newq
            g.updated_at = now_iso()
            changes.append(f"{ing['name']} −{ing.get('quantity', 0)}{ing.get('unit', '')} (now {newq})")
        else:
            changes.append(f"{ing['name']} (not in inventory)")
    servings = recipe.get("servings") or 1
    meal = None
    if recipe.get("calories"):
        meal = Meal(id=new_id(), user_id=user_id, description=f"{recipe['name']} (1 serving)",
                    date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    calories=round((recipe.get("calories") or 0) / servings, 1),
                    protein=round((recipe.get("protein") or 0) / servings, 1),
                    carbs=round((recipe.get("carbs") or 0) / servings, 1),
                    fat=round((recipe.get("fat") or 0) / servings, 1),
                    created_at=now_iso())
        db.add(meal)
    await db.commit()
    return {"recipe": recipe["name"], "inventory_changes": changes, "meal_logged": meal is not None}





# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(body: SignupBody, request: Request, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    name = body.name.strip()

    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="Invalid email address")
    if not is_strong_password(body.password):
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters with a letter and a number")
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing:
        # Never disclose whether an email is registered
        return {"message": "If this email is not registered, you will receive a verification code shortly."}

    check_rate_limit(request, email)

    code = generate_six_digit_code()
    expires = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    user = User(
        id=new_id(), email=email, password_hash=hash_password(body.password),
        name=name, role="user", email_verified=False,
        verification_code=code, verification_code_expires_at=expires,
        verification_attempts=0, last_verification_sent_at=now_iso(),
        created_at=now_iso(),
    )
    db.add(user)
    await db.commit()

    # Fire-and-forget email ( awaited so we log failures )
    await send_verification_code(email, code, name)

    return {"message": "If this email is not registered, you will receive a verification code shortly."}


@api_router.post("/auth/resend-verification")
async def resend_verification(body: ResendCodeBody, request: Request, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user:
        # Silent success
        return {"message": "If this email is registered, a new code will be sent."}

    if user.email_verified:
        return {"message": "If this email is registered, a new code will be sent."}

    check_rate_limit(request, email)

    # Enforce 90-second cooldown between resends
    if user.last_verification_sent_at:
        try:
            last = datetime.fromisoformat(user.last_verification_sent_at)
            if datetime.now(timezone.utc) - last < timedelta(seconds=90):
                raise HTTPException(status_code=429, detail="Please wait before requesting a new code")
        except ValueError:
            pass

    code = generate_six_digit_code()
    user.verification_code = code
    user.verification_code_expires_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    user.last_verification_sent_at = now_iso()
    await db.commit()

    await send_verification_code(email, code, user.name)
    return {"message": "If this email is registered, a new code will be sent."}


@api_router.post("/auth/verify")
async def verify_code(body: VerifyCodeBody, request: Request, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    code = body.code.strip()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")

    check_rate_limit(request, f"{email}:verify")

    if user.email_verified:
        raise HTTPException(status_code=400, detail="Account already verified")

    # Brute-force protection
    if user.verification_attempts >= 5:
        raise HTTPException(status_code=400, detail="Too many failed attempts. Please request a new code.")

    if not user.verification_code or not user.verification_code_expires_at:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")

    try:
        expires = datetime.fromisoformat(user.verification_code_expires_at)
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=400, detail="Verification code expired")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")

    if user.verification_code != code:
        user.verification_attempts = (user.verification_attempts or 0) + 1
        await db.commit()
        raise HTTPException(status_code=400, detail="Invalid verification code")

    user.email_verified = True
    user.verification_code = None
    user.verification_code_expires_at = None
    user.verification_attempts = 0
    await db.commit()

    access_token = create_access_token(user.id, user.email)
    refresh_token = create_refresh_token(user.id)
    return {
        "token": access_token,
        "refresh_token": refresh_token,
        "user": {"id": user.id, "email": user.email, "name": user.name, "email_verified": True},
    }


@api_router.post("/auth/login")
async def login(body: LoginBody, request: Request, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    check_rate_limit(request, email)
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.email_verified:
        # Return a special token that only works for verification/resend endpoints
        token = create_access_token(user.id, user.email)
        return {
            "requires_verification": True,
            "token": token,
            "user": {"id": user.id, "email": user.email, "name": user.name, "email_verified": False},
        }

    access_token = create_access_token(user.id, email)
    refresh_token = create_refresh_token(user.id)
    return {
        "token": access_token,
        "refresh_token": refresh_token,
        "user": {"id": user.id, "email": email, "name": user.name, "email_verified": True},
    }


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordBody, request: Request, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    check_rate_limit(request, email)
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user:
        # Single-use, expiring token
        token = create_password_reset_token(user.id)
        user.password_reset_token = token
        user.password_reset_expires_at = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        await db.commit()
        await send_password_reset(email, token, user.name)
    # Always return the same message
    return {"message": "If this email is registered, you will receive password reset instructions."}


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordBody, request: Request, db: AsyncSession = Depends(get_db)):
    check_rate_limit(request, f"reset:{body.token[:8]}")
    try:
        payload = decode_token(body.token, token_type="password_reset")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    user_id = payload.get("sub")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or user.password_reset_token != body.token:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    try:
        expires = datetime.fromisoformat(user.password_reset_expires_at)
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=400, detail="Reset link expired")
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    if not is_strong_password(body.password):
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters with a letter and a number")

    user.password_hash = hash_password(body.password)
    user.password_reset_token = None
    user.password_reset_expires_at = None
    await db.commit()

    access_token = create_access_token(user.id, user.email)
    refresh_token = create_refresh_token(user.id)
    return {
        "token": access_token,
        "refresh_token": refresh_token,
        "user": {"id": user.id, "email": user.email, "name": user.name, "email_verified": user.email_verified},
    }


@api_router.post("/auth/refresh")
async def refresh_token(body: RefreshBody, db: AsyncSession = Depends(get_db)):
    """Exchange a valid refresh token for a new access token."""
    try:
        payload = decode_token(body.token, token_type="refresh")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user_id = payload.get("sub")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    access_token = create_access_token(user.id, user.email)
    new_refresh_token = create_refresh_token(user.id)
    return {"token": access_token, "refresh_token": new_refresh_token}


@api_router.post("/auth/change-password")
async def change_password(body: ChangePasswordBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    db_user = (await db.execute(select(User).where(User.id == user["_id"]))).scalar_one_or_none()
    if not db_user or not verify_password(body.current_password, db_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if not is_strong_password(body.new_password):
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters with a letter and a number")
    db_user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"message": "Password updated successfully"}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user_optional_unverified)):
    return {"id": user["_id"], "email": user["email"], "name": user.get("name", OWNER_NAME), "email_verified": user.get("email_verified", False)}


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
@api_router.get("/people")
async def get_people(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await people_balances(db, user["_id"])


@api_router.post("/people")
async def create_person(body: PersonBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = Person(id=new_id(), user_id=user["_id"], name=body.name, name_lower=body.name.lower(),
               photo=body.photo, notes=body.notes or "",
               payment_preference=body.payment_preference or "", created_at=now_iso())
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return to_dict(p)


@api_router.delete("/people/{pid}")
async def delete_person(pid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Person).where(Person.id == pid, Person.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Person not found")
    return {"ok": True}


@api_router.get("/people/{pid}")
async def person_detail(pid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    people = await people_balances(db, user["_id"])
    person = next((p for p in people if p["id"] == pid), None)
    if not person:
        raise HTTPException(404, "Person not found")
    txns = []
    result = await db.execute(
        select(Split, Transaction).join(Transaction).where(
            Split.person_id == pid,
            Transaction.user_id == user["_id"],
        ).order_by(desc(Transaction.date))
    )
    for sp, txn in result.all():
        txns.append({"id": txn.id, "date": txn.date,
                     "merchant": txn.merchant or txn.description,
                     "amount": float(sp.amount), "gross": float(txn.gross_amount)})
    settlements = [to_dict(s) for s in (await db.execute(
        select(Settlement).where(
            Settlement.person_id == pid,
            Settlement.user_id == user["_id"],
        ).order_by(desc(Settlement.date))
    )).scalars().all()]
    return {"person": person, "transactions": txns, "settlements": settlements}


# ---------------------------------------------------------------------------
# Categories & Accounts
# ---------------------------------------------------------------------------
@api_router.get("/categories")
async def get_categories(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(c) for c in (await db.execute(
        _user_owned_query(Category, user).order_by(Category.name)
    )).scalars().all()]


@api_router.post("/categories")
async def create_category(body: CategoryBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    c = Category(
        id=new_id(), user_id=user["_id"], name=body.name, icon=body.icon, color=body.color,
        monthly_budget=round(body.monthly_budget, 2) if body.monthly_budget is not None else None,
        created_at=now_iso(),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return to_dict(c)


@api_router.put("/categories/{cid}")
async def update_category(cid: str, body: CategoryBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    c = (await db.execute(
        select(Category).where(Category.id == cid, Category.user_id == user["_id"])
    )).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Category not found")
    c.name = body.name
    c.icon = body.icon
    c.color = body.color
    c.monthly_budget = round(body.monthly_budget, 2) if body.monthly_budget is not None else None
    await db.commit()
    await db.refresh(c)
    return to_dict(c)


@api_router.delete("/categories/{cid}")
async def delete_category(cid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Category).where(Category.id == cid, Category.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Category not found")
    return {"ok": True}


@api_router.get("/accounts")
async def get_accounts(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    accs = (await db.execute(
        _user_owned_query(Account, user).order_by(Account.name)
    )).scalars().all()
    out = []
    for a in accs:
        d = to_dict(a)
        d["balance"] = await compute_account_balance(db, a.id, user["_id"])
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------
async def refund_map(db: AsyncSession, user_id: str) -> dict:
    m = {}
    result = await db.execute(
        select(Settlement).where(
            Settlement.user_id == user_id,
            Settlement.direction == "in",
            Settlement.transaction_id != None,
        )
    )
    for s in result.scalars():
        if s.transaction_id:
            m[s.transaction_id] = round(m.get(s.transaction_id, 0.0) + float(s.amount), 2)
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
    responsible = [s["person_name"] for s in t.get("splits", []) if not s.get("is_me") and s["amount"] > 0.005]
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


def _date_filter(month, start, end):
    filters = []
    if month:
        filters.append(Transaction.month == month)
    if start:
        filters.append(Transaction.date >= start)
    if end:
        filters.append(Transaction.date <= end)
    return filters


@api_router.get("/transactions")
async def get_transactions(month: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
                           payment_method: Optional[str] = None, user: dict = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    filters = [Transaction.user_id == user["_id"]] + _date_filter(month, start, end)
    stmt = select(Transaction).where(*filters).order_by(desc(Transaction.date))
    rmap = await refund_map(db, user["_id"])
    rows = (await db.execute(stmt)).scalars().all()
    out = [txn_to_dict(t, rmap) for t in rows]
    if payment_method in ("cash", "card"):
        out = [t for t in out if t.get("payment_method") == payment_method]
    return out


@api_router.post("/transactions/expense")
async def add_expense(body: ExpenseBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await create_expense_record(db, body, user["_id"])


@api_router.put("/transactions/{tid}")
async def update_transaction(tid: str, body: TxnUpdate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = (await db.execute(
        select(Transaction).where(Transaction.id == tid, Transaction.user_id == user["_id"])
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Transaction not found")
    updates = {}
    if body.description is not None:
        updates["description"] = body.description
        updates["merchant"] = body.description if not t.merchant else t.merchant
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
    if body.amount is not None and t.type == "expense":
        new_gross = round(float(body.amount), 2)
        old_gross = float(t.gross_amount) if t.gross_amount else 0.0
        splits = [to_dict(s) for s in t.splits]
        if body.personal_amount is not None:
            personal = round(min(float(body.personal_amount), new_gross), 2)
            new_splits = [{"person_id": "me", "person_name": "Me", "amount": personal, "is_me": True}]
            others = round(new_gross - personal, 2)
            existing_others = [s for s in splits if not s["is_me"]]
            if existing_others and others > 0:
                each = round(others / len(existing_others), 2)
                for s in existing_others:
                    new_splits.append({**s, "amount": each})
            updates["personal_amount"] = personal
        elif len(splits) > 1 and old_gross > 0:
            factor = new_gross / old_gross
            new_splits = [{**s, "amount": round(s["amount"] * factor, 2)} for s in splits]
            updates["personal_amount"] = round(next((s["amount"] for s in new_splits if s["is_me"]), 0), 2)
        else:
            new_splits = [{"person_id": "me", "person_name": "Me", "amount": new_gross, "is_me": True}]
            updates["personal_amount"] = new_gross
        updates["gross_amount"] = new_gross
        updates["reimbursable_amount"] = round(new_gross - updates["personal_amount"], 2)
        # replace splits
        await db.execute(delete(Split).where(Split.transaction_id == tid))
        for s in new_splits:
            db.add(Split(id=new_id(), transaction_id=tid, person_id=s["person_id"],
                         person_name=s["person_name"], amount=s["amount"], is_me=s["is_me"],
                         created_at=now_iso()))
    elif body.personal_amount is not None and t.type == "expense":
        gross = float(t.gross_amount) if t.gross_amount else 0.0
        personal = round(min(float(body.personal_amount), gross), 2)
        updates["personal_amount"] = personal
        updates["reimbursable_amount"] = round(gross - personal, 2)
        # rescale splits: Me gets new personal, others share remainder equally
        old_splits = [to_dict(s) for s in t.splits]
        new_splits = []
        others = round(gross - personal, 2)
        existing_others = [s for s in old_splits if not s["is_me"]]
        me_split = next((s for s in old_splits if s["is_me"]), {"person_id": "me", "person_name": "Me", "amount": personal, "is_me": True})
        me_split["amount"] = personal
        new_splits.append(me_split)
        if existing_others and others > 0:
            each = round(others / len(existing_others), 2)
            # correct rounding drift on the last other split
            for i, s in enumerate(existing_others):
                amt = each if i < len(existing_others) - 1 else round(others - each * (len(existing_others) - 1), 2)
                new_splits.append({**s, "amount": amt})
        await db.execute(delete(Split).where(Split.transaction_id == tid))
        for s in new_splits:
            db.add(Split(id=new_id(), transaction_id=tid, person_id=s["person_id"],
                         person_name=s["person_name"], amount=s["amount"], is_me=s["is_me"],
                         created_at=now_iso()))

    if updates:
        await db.execute(update(Transaction).where(Transaction.id == tid, Transaction.user_id == user["_id"]).values(**updates))
    await db.commit()
    await db.refresh(t)
    rmap = await refund_map(db, user["_id"])
    return txn_to_dict(t, rmap)


@api_router.delete("/transactions/{tid}")
async def delete_transaction(tid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # roll back groceries created via add_to_inventory
    txn = (await db.execute(
        select(Transaction).where(Transaction.id == tid, Transaction.user_id == user["_id"])
    )).scalar_one_or_none()
    if not txn:
        raise HTTPException(404, "Transaction not found")
    if txn.items:
        for it in txn.items:
            g = (await db.execute(
                select(Grocery).where(Grocery.name_lower == it["name"].lower(), Grocery.user_id == user["_id"])
            )).scalar_one_or_none()
            if g:
                g.quantity = max(0, float(g.quantity) - 1)
                g.updated_at = now_iso()
    await db.execute(delete(Split).where(Split.transaction_id == tid))
    await db.execute(delete(Settlement).where(Settlement.transaction_id == tid, Settlement.user_id == user["_id"]))
    await db.execute(delete(Transaction).where(Transaction.id == tid, Transaction.user_id == user["_id"]))
    await db.commit()
    return {"ok": True}


@api_router.post("/transactions/transfer")
async def add_transfer(body: TransferBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    t = Transaction(id=new_id(), user_id=user["_id"], type="transfer", from_account=body.from_account,
                    to_account=body.to_account, gross_amount=round(body.amount, 2),
                    description=body.notes or "Transfer", date=date, month=month_of(date),
                    account=body.from_account, created_at=now_iso())
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return to_dict(t)


@api_router.post("/transactions/income")
async def add_income(body: IncomeBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    t = Transaction(id=new_id(), user_id=user["_id"], type="income", account=body.account,
                    gross_amount=round(body.amount, 2), description=body.description or "Income",
                    date=date, month=month_of(date), created_at=now_iso())
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return to_dict(t)


# ---------------------------------------------------------------------------
# Settlements
# ---------------------------------------------------------------------------
@api_router.post("/settlements")
async def add_settlement(body: SettlementBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    person = await resolve_person(db, body.person, user["_id"])
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    s = Settlement(id=new_id(), user_id=user["_id"], person_id=person["id"], person_name=person["name"],
                   amount=round(body.amount, 2), method=body.method, account=body.account,
                   direction=body.direction, date=date, transaction_id=body.transaction_id,
                   created_at=now_iso())
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return to_dict(s)


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
@api_router.get("/analytics/summary")
async def analytics_summary(month: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
                            user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    accounts = await get_accounts(user, db)
    cash = next((a["balance"] for a in accounts if a["id"] == "cash"), 0)
    revolut = next((a["balance"] for a in accounts if a["id"] == "revolut"), 0)

    filters = [Transaction.user_id == user["_id"]] + _date_filter(month, start, end)
    stmt = select(Transaction).where(Transaction.type == "expense").where(*filters)
    rows = (await db.execute(stmt)).scalars().all()

    gross = personal = cash_spent = card_spent = reimbursable = 0.0
    by_cat = {}
    by_day = {}
    for t in rows:
        gross += float(t.gross_amount)
        personal += float(t.personal_amount) if t.personal_amount else 0
        reimbursable += float(t.reimbursable_amount) if t.reimbursable_amount else 0
        if t.account == "cash":
            cash_spent += float(t.gross_amount)
        else:
            card_spent += float(t.gross_amount)
        by_cat[t.category] = by_cat.get(t.category, 0) + float(t.gross_amount)
        by_day[t.date] = by_day.get(t.date, 0) + float(t.gross_amount)

    sfilters = [Settlement.user_id == user["_id"], Settlement.direction == "in"]
    if start:
        sfilters.append(Settlement.date >= start)
    if end:
        sfilters.append(Settlement.date <= end)
    srows = (await db.execute(select(Settlement).where(*sfilters))).scalars().all()
    refunded = 0.0
    for s in srows:
        if month and not str(s.date).startswith(month):
            continue
        refunded += float(s.amount)

    people = await people_balances(db, user["_id"])
    owed_to_me = round(sum(p["owes_me"] for p in people), 2)
    i_owe = round(sum(p["i_owe"] for p in people), 2)
    outstanding = round(sum(max(p["net"], 0) for p in people), 2)

    groceries = (await db.execute(
        select(Grocery).where(Grocery.user_id == user["_id"])
    )).scalars().all()
    out_of_stock = [g.name for g in groceries if (float(g.quantity) if g.quantity else 0) <= 0]
    low_stock = [g.name for g in groceries if (float(g.quantity) if g.quantity else 0) > 0 and g.low_threshold and float(g.quantity) <= float(g.low_threshold)]
    unknown_price = [g.name for g in groceries if g.price is None]

    categories = (await db.execute(
        select(Category).where(Category.user_id == user["_id"])
    )).scalars().all()
    cat_budgets = {c.name: float(c.monthly_budget) if c.monthly_budget else None for c in categories}

    months = sorted({r[0] async for r in await db.stream(
        select(Transaction.month).where(Transaction.user_id == user["_id"]).distinct()
    )}, reverse=True)

    # Period metadata and projections
    from datetime import date as _date
    today = _date.today()
    period_start = start or (month and f"{month}-01") or None
    period_end = end or (month and f"{month}-31") or None
    period_days = 0
    if period_start and period_end:
        try:
            period_days = (max(_date.fromisoformat(period_end), today) - _date.fromisoformat(period_start)).days + 1
        except Exception:
            period_days = 0
    daily_avg = round(gross / max(period_days, 1), 2) if period_days else round(gross / max(len(by_day) or 1, 1), 2)
    days_in_month = 30
    try:
        if month:
            y, m = map(int, month.split("-"))
            import calendar
            days_in_month = calendar.monthrange(y, m)[1]
            spent_so_far_days = max(today.day if today.year == y and today.month == m else days_in_month, 1)
            projected_month_spend = round(daily_avg * days_in_month, 2) if spent_so_far_days < days_in_month else round(gross, 2)
        else:
            projected_month_spend = round(daily_avg * days_in_month, 2)
    except Exception:
        projected_month_spend = round(daily_avg * days_in_month, 2)

    # Previous period comparison
    prev_gross = 0.0
    if start and end:
        try:
            s = _date.fromisoformat(start)
            e = _date.fromisoformat(end)
            delta = (e - s).days + 1
            ps = (s - timedelta(days=delta)).isoformat()
            pe = (e - timedelta(days=delta)).isoformat()
            pfilters = [Transaction.user_id == user["_id"], Transaction.type == "expense", Transaction.date >= ps, Transaction.date <= pe]
            prev_rows = (await db.execute(select(Transaction).where(*pfilters))).scalars().all()
            prev_gross = round(sum(float(t.gross_amount) for t in prev_rows), 2)
        except Exception:
            prev_gross = 0.0
    elif month:
        try:
            y, m = map(int, month.split("-"))
            pm = m - 1 if m > 1 else 12
            py = y if m > 1 else y - 1
            pm_key = f"{py}-{str(pm).zfill(2)}"
            prev_rows = (await db.execute(
                select(Transaction).where(
                    Transaction.user_id == user["_id"],
                    Transaction.type == "expense",
                    Transaction.month == pm_key,
                )
            )).scalars().all()
            prev_gross = round(sum(float(t.gross_amount) for t in prev_rows), 2)
        except Exception:
            prev_gross = 0.0

    # Top merchants
    by_merchant = {}
    for t in rows:
        if t.merchant:
            by_merchant[t.merchant] = by_merchant.get(t.merchant, 0) + float(t.gross_amount)
    top_merchants = [{"name": k, "value": round(v, 2)} for k, v in sorted(by_merchant.items(), key=lambda x: -x[1])[:5]]

    # Income vs expense for the period
    income_rows = (await db.execute(
        select(Transaction).where(
            Transaction.user_id == user["_id"], Transaction.type == "income", *filters[1:]
        )
    )).scalars().all()
    income_total = round(sum(float(t.gross_amount) for t in income_rows), 2)

    total_available = round(cash + revolut, 2)
    by_category_out = []
    for k, v in sorted(by_cat.items(), key=lambda x: -x[1]):
        budget = cat_budgets.get(k)
        pct = round(v / gross * 100, 1) if gross else 0
        by_category_out.append({"name": k, "value": round(v, 2), "percentage": pct, "budget": budget})

    return {
        "cash": cash, "revolut": revolut, "total_available": total_available,
        "gross": round(gross, 2), "personal": round(personal, 2),
        "reimbursable": round(reimbursable, 2),
        "cash_spent": round(cash_spent, 2), "card_spent": round(card_spent, 2),
        "refunded": round(refunded, 2), "pending": outstanding,
        "owed_to_me": owed_to_me, "i_owe": i_owe, "outstanding": outstanding,
        "by_category": by_category_out,
        "by_day": [{"date": k, "value": round(v, 2)} for k, v in sorted(by_day.items())],
        "top_merchants": top_merchants,
        "income": income_total, "net": round(income_total - gross, 2),
        "daily_average": daily_avg,
        "projected_month_spend": projected_month_spend,
        "previous_period_gross": prev_gross,
        "period_days": period_days,
        "grocery": {"total": len(groceries), "out_of_stock": out_of_stock, "low_stock": low_stock, "unknown_price": unknown_price},
        "months": months,
    }


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
@api_router.get("/tasks")
async def get_tasks(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(t) for t in (await db.execute(
        _user_owned_query(Task, user).order_by(desc(Task.created_at))
    )).scalars().all()]


@api_router.post("/tasks")
async def create_task(body: TaskBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    t = Task(id=new_id(), user_id=user["_id"], title=body.title, priority=body.priority, due=body.due,
             recurring=body.recurring, done=body.done, created_at=now_iso())
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return to_dict(t)


@api_router.put("/tasks/{tid}")
async def update_task(tid: str, body: TaskBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    task = (await db.execute(
        select(Task).where(Task.id == tid, Task.user_id == user["_id"])
    )).scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    await db.execute(update(Task).where(Task.id == tid, Task.user_id == user["_id"]).values(**body.model_dump()))
    await db.commit()
    await db.refresh(task)
    return to_dict(task)


@api_router.delete("/tasks/{tid}")
async def delete_task(tid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Task).where(Task.id == tid, Task.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Task not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Body / Weight
# ---------------------------------------------------------------------------
@api_router.get("/weight")
async def get_weight(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(w) for w in (await db.execute(
        _user_owned_query(WeightEntry, user).order_by(asc(WeightEntry.date))
    )).scalars().all()]


@api_router.post("/weight")
async def add_weight(body: WeightBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    w = WeightEntry(id=new_id(), user_id=user["_id"], weight=body.weight, date=date, note=body.note, created_at=now_iso())
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return to_dict(w)


@api_router.delete("/weight/{wid}")
async def delete_weight(wid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(WeightEntry).where(WeightEntry.id == wid, WeightEntry.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Weight entry not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Workouts
# ---------------------------------------------------------------------------
@api_router.get("/workouts")
async def get_workouts(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(w) for w in (await db.execute(
        _user_owned_query(Workout, user).order_by(desc(Workout.date))
    )).scalars().all()]


async def create_workout(db: AsyncSession, body: WorkoutBody, user_id: str) -> dict:
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    w = Workout(id=new_id(), user_id=user_id, type=body.type, date=date, notes=body.notes,
                exercises=[e.model_dump() for e in body.exercises], created_at=now_iso())
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return to_dict(w)


@api_router.post("/workouts")
async def post_workout(body: WorkoutBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await create_workout(db, body, user["_id"])


@api_router.delete("/workouts/{wid}")
async def delete_workout(wid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Workout).where(Workout.id == wid, Workout.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Workout not found")
    return {"ok": True}


@api_router.get("/workouts/prs")
async def workout_prs(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    prs = {}
    rows = (await db.execute(_user_owned_query(Workout, user))).scalars().all()
    for w in rows:
        for e in (w.exercises or []):
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
# File upload limits and validation
# ---------------------------------------------------------------------------
MAX_UPLOAD_SIZE = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "10")) * 1024 * 1024
ALLOWED_PHOTO_EXTENSIONS = set(
    e.strip().lower() for e in os.environ.get("ALLOWED_PHOTO_EXTENSIONS", "jpg,jpeg,png,webp").split(",") if e.strip()
)
ALLOWED_PHOTO_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


# ---------------------------------------------------------------------------
# Progress photos (local storage)
# ---------------------------------------------------------------------------
@api_router.post("/photos")
async def upload_photo(file: UploadFile = File(...), note: str = Query(""), user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Validate extension
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "").lower()
    if ext not in ALLOWED_PHOTO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported image format")

    # Validate content type (when provided by the client)
    if file.content_type and file.content_type not in ALLOWED_PHOTO_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid content type")

    # Read with size limit
    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_SIZE // (1024 * 1024)} MB)")

    # Use a canonical content type based on extension; do not trust arbitrary client-supplied types
    ct = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[ext]
    relative = f"{APP_NAME}/photos/{user['_id']}/{new_id()}.{ext}"
    save_object(relative, data)
    doc = Photo(id=new_id(), user_id=user["_id"], storage_path=relative, content_type=ct, note=note,
                date=datetime.now(timezone.utc).strftime("%Y-%m-%d"), is_deleted=False, created_at=now_iso())
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    d = to_dict(doc)
    d["url"] = f"/api/photos/file/{relative}"
    return d


@api_router.get("/photos")
async def list_photos(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        _user_owned_query(Photo, user).where(Photo.is_deleted == False).order_by(desc(Photo.date))
    )).scalars().all()
    out = []
    for r in rows:
        d = to_dict(r)
        d["url"] = f"/api/photos/file/{r.storage_path}"
        out.append(d)
    return out


@api_router.delete("/photos/{pid}")
async def delete_photo(pid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    photo = (await db.execute(
        select(Photo).where(Photo.id == pid, Photo.user_id == user["_id"])
    )).scalar_one_or_none()
    if not photo:
        raise HTTPException(404, "Photo not found")
    await db.execute(update(Photo).where(Photo.id == pid, Photo.user_id == user["_id"]).values(is_deleted=True))
    await db.commit()
    return {"ok": True}


@api_router.get("/photos/file/{path:path}")
async def serve_photo(path: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    record = (await db.execute(
        select(Photo).where(
            Photo.storage_path == path,
            Photo.user_id == user["_id"],
            Photo.is_deleted == False,
        )
    )).scalar_one_or_none()
    if not record:
        raise HTTPException(404, "Not found")
    data = read_object(path)
    return Response(content=data, media_type=record.content_type)


# ---------------------------------------------------------------------------
# Groceries
# ---------------------------------------------------------------------------
@api_router.get("/groceries")
async def get_groceries(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(g) for g in (await db.execute(
        _user_owned_query(Grocery, user).order_by(Grocery.name)
    )).scalars().all()]


@api_router.post("/groceries")
async def add_grocery(body: GroceryBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await record_price(db, body.name, body.store, body.price, body.unit, user_id=user["_id"])
    existing = (await db.execute(
        select(Grocery).where(Grocery.name_lower == body.name.lower(), Grocery.user_id == user["_id"])
    )).scalar_one_or_none()
    if existing:
        existing.quantity = float(existing.quantity) + body.quantity
        if body.price is not None:
            existing.price = body.price
        if body.store:
            existing.store = body.store
        existing.updated_at = now_iso()
        await db.commit()
        await db.refresh(existing)
        return to_dict(existing)
    g = Grocery(id=new_id(), user_id=user["_id"], name=body.name, name_lower=body.name.lower(),
                quantity=body.quantity, unit=body.unit, category=body.category,
                price=body.price, store=body.store, low_threshold=body.low_threshold,
                notes=body.notes or "", expiration=body.expiration,
                created_at=now_iso(), updated_at=now_iso())
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return to_dict(g)


@api_router.put("/groceries/{gid}")
async def update_grocery(gid: str, body: GroceryUpdate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    g = (await db.execute(
        select(Grocery).where(Grocery.id == gid, Grocery.user_id == user["_id"])
    )).scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Item not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "name" in updates:
        updates["name_lower"] = updates["name"].lower()
    if updates.get("price") is not None:
        await record_price(db, updates.get("name", g.name), updates.get("store", g.store), updates["price"],
                           updates.get("unit", g.unit or "unit"), user_id=user["_id"])
    updates["updated_at"] = now_iso()
    await db.execute(update(Grocery).where(Grocery.id == gid, Grocery.user_id == user["_id"]).values(**updates))
    await db.commit()
    await db.refresh(g)
    return to_dict(g)


@api_router.delete("/groceries/{gid}")
async def delete_grocery(gid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Grocery).where(Grocery.id == gid, Grocery.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Item not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Meals / Nutrition
# ---------------------------------------------------------------------------
@api_router.get("/meals")
async def get_meals(date: Optional[str] = None, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stmt = _user_owned_query(Meal, user)
    if date:
        stmt = stmt.where(Meal.date == date)
    stmt = stmt.order_by(desc(Meal.created_at))
    return [to_dict(m) for m in (await db.execute(stmt)).scalars().all()]


@api_router.post("/meals")
async def add_meal(body: MealBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    m = Meal(id=new_id(), user_id=user["_id"], description=body.description, date=date,
             calories=body.calories, protein=body.protein, carbs=body.carbs,
             fat=body.fat, created_at=now_iso())
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return to_dict(m)


@api_router.delete("/meals/{mid}")
async def delete_meal(mid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Meal).where(Meal.id == mid, Meal.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Meal not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Shopping list + price intelligence
# ---------------------------------------------------------------------------
@api_router.get("/shopping")
async def get_shopping(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await shopping_payload(db, user["_id"])


@api_router.post("/shopping")
async def post_shopping(body: ShoppingBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await add_shopping_item_doc(db, body.name, body.quantity, body.unit, body.note, user_id=user["_id"])


@api_router.post("/shopping/generate")
async def gen_shopping(days: int = 7, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await generate_shopping_doc(db, days, user_id=user["_id"])


@api_router.delete("/shopping/{sid}")
async def del_shopping(sid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(ShoppingItem).where(ShoppingItem.id == sid, ShoppingItem.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Item not found")
    return {"ok": True}


@api_router.post("/shopping/{sid}/buy")
async def buy_shopping(sid: str, body: BuyBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    it = (await db.execute(
        select(ShoppingItem).where(ShoppingItem.id == sid, ShoppingItem.user_id == user["_id"])
    )).scalar_one_or_none()
    if not it:
        raise HTTPException(404, "Item not found")
    await add_grocery(GroceryBody(name=it.name, quantity=float(it.quantity), unit=it.unit or "unit",
                                  price=body.price, store=body.store), user, db)
    await db.execute(delete(ShoppingItem).where(ShoppingItem.id == sid, ShoppingItem.user_id == user["_id"]))
    await db.commit()
    return {"ok": True}


@api_router.get("/prices/{name}")
async def get_prices(name: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    per_store = await latest_prices(db, name.lower(), user["_id"])
    history = [to_dict(r) for r in (await db.execute(
        select(PriceRecord).where(
            PriceRecord.name_lower == name.lower(),
            PriceRecord.user_id == user["_id"],
        ).order_by(desc(PriceRecord.date))
    )).scalars().all()]
    return {"name": name, "per_store": per_store, "cheapest": cheapest_store(per_store), "history": history}


# ---------------------------------------------------------------------------
# Recipes
# ---------------------------------------------------------------------------
@api_router.get("/recipes")
async def get_recipes(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(r) for r in (await db.execute(
        _user_owned_query(Recipe, user).order_by(Recipe.name)
    )).scalars().all()]


@api_router.post("/recipes")
async def create_recipe(body: RecipeBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = Recipe(id=new_id(), user_id=user["_id"], name=body.name, servings=body.servings,
               ingredients=[i.model_dump() for i in body.ingredients],
               calories=body.calories, protein=body.protein, carbs=body.carbs,
               fat=body.fat, notes=body.notes, created_at=now_iso())
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return to_dict(r)


@api_router.delete("/recipes/{rid}")
async def delete_recipe(rid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Recipe).where(Recipe.id == rid, Recipe.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Recipe not found")
    return {"ok": True}


@api_router.post("/recipes/{rid}/cook")
async def cook_recipe(rid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = (await db.execute(
        select(Recipe).where(Recipe.id == rid, Recipe.user_id == user["_id"])
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Recipe not found")
    return await cook_recipe_doc(db, to_dict(r), user["_id"])


# ---------------------------------------------------------------------------
# AI Actions log
# ---------------------------------------------------------------------------
@api_router.get("/ai/actions")
async def ai_actions(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(a) for a in (await db.execute(
        _user_owned_query(AIAction, user).order_by(desc(AIAction.created_at))
    )).scalars().all()]


@api_router.post("/ai/actions/{aid}/undo")
async def ai_undo(aid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    action = (await db.execute(
        select(AIAction).where(AIAction.id == aid, AIAction.user_id == user["_id"])
    )).scalar_one_or_none()
    if not action or action.undone:
        raise HTTPException(404, "Nothing to undo")
    for ref in (action.created or []):
        model = {
            "transactions": Transaction, "settlements": Settlement, "groceries": Grocery,
            "meals": Meal, "tasks": Task, "weight": WeightEntry, "recipes": Recipe,
            "workouts": Workout,
        }.get(ref["collection"])
        if model:
            await db.execute(delete(model).where(model.id == ref["id"]))
    action.undone = True
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# AI tool schemas
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

AI_SYSTEM = """You are Life Record's personal assistant, a friendly multi-user life-management helper.
You turn natural language into structured, connected data by calling tools. You handle money/expenses, shared expenses and reimbursements, groceries, meals/nutrition, workouts, weight and tasks for the current user.

Rules:
- When the user refers to themselves, use the participant name "Me".
- Payment methods are "cash" and "card" (card = Revolut). When creating expenses, map card->account "revolut", cash->account "cash".
- For shared expenses, figure out each person's share. If items are assigned to specific people, use split_mode "items" with the items array. If the split is equal, use split_mode "equal". Never fabricate amounts you weren't given.
- To change an existing expense use update_expense; to remove one use delete_expense (preview first, then confirm). To record a refund use mark_refunded (or record_payment for a general person payment).
- NEVER invent expenses, refunds, prices, grocery prices, or totals. If you don't have a value, say it is unknown and ask.
- If something is genuinely ambiguous and financially important (who to split with, or an amount), ASK a short clarifying question instead of guessing.
- For destructive actions (delete, large bulk changes) always confirm with the user first.
- For nutrition you MAY estimate calories/macros from typical food values, but say they are estimates.
- After performing actions, give a concise summary of exactly what changed (amounts, shares, refunds, remaining owed, inventory). Be warm but brief. Use € for currency.
- Today's date is {today}.
"""


# ---------------------------------------------------------------------------
# Gemini AI integration
# ---------------------------------------------------------------------------
def gemini_client():
    if not GEMINI_API_KEY:
        raise HTTPException(503, "AI is not configured. Set GEMINI_API_KEY to enable the assistant.")
    from google import genai
    return genai.Client(api_key=GEMINI_API_KEY)


# HTTP status codes and transient error strings that mean "try another model"
_GEMINI_RETRY_STATUSES = {429, 503, 504, 529}
_GEMINI_RETRY_SUBSTRINGS = (
    "quota", "rate limit", "rate_limit", "resource exhausted", "capacity",
    "overload", "server error", "temporary", "timed out", "timeout",
)


def _is_retryable_gemini_error(exc: Exception) -> bool:
    """Return True if the exception looks like a quota/capacity/transient error."""
    # google.api_core exceptions
    status = getattr(exc, "code", None)
    if status is not None and status in _GEMINI_RETRY_STATUSES:
        return True
    http_status = getattr(exc, "status_code", None) or getattr(exc, "http_status", None)
    if http_status is not None and http_status in _GEMINI_RETRY_STATUSES:
        return True
    msg = str(exc).lower()
    return any(s in msg for s in _GEMINI_RETRY_SUBSTRINGS)


def _gemini_models_to_try() -> List[str]:
    """Return the preferred model followed by configured fallbacks (deduplicated)."""
    models = [GEMINI_MODEL]
    for m in GEMINI_FALLBACKS:
        if m not in models:
            models.append(m)
    return models


async def _gemini_generate_with_fallback(
    generate_coro_factory,
    timeout: float,
    operation: str = "ai_request",
):
    """Try the configured Gemini models in order until one succeeds.

    `generate_coro_factory(model: str)` must return a coroutine that calls
    `client.aio.models.generate_content(...)` for that model.
    """
    client = gemini_client()
    last_error: Optional[Exception] = None
    for model in _gemini_models_to_try():
        try:
            coro = generate_coro_factory(client, model)
            return await asyncio.wait_for(coro, timeout=timeout)
        except asyncio.TimeoutError as exc:
            last_error = exc
            logger.warning("%s timed out on model %s", operation, model)
        except Exception as exc:
            last_error = exc
            if _is_retryable_gemini_error(exc):
                logger.warning("%s failed on model %s: %s", operation, model, exc)
                if GEMINI_FALLBACK_DELAY > 0:
                    await asyncio.sleep(GEMINI_FALLBACK_DELAY)
                continue
            # Non-retryable error (e.g., 400 bad request, 401 auth) — fail fast
            logger.exception("%s non-retryable error on model %s", operation, model)
            raise
    logger.error("%s exhausted all Gemini models", operation)
    if last_error is None:
        raise HTTPException(503, "AI service unavailable. No models configured.")
    if isinstance(last_error, asyncio.TimeoutError):
        raise HTTPException(504, "AI request timed out. Please try again in a moment.")
    raise HTTPException(503, "AI service is temporarily unavailable. Please try again in a moment.")


def build_gemini_tools():
    from google.genai import types
    declarations = []
    for t in AI_TOOLS:
        fn = t["function"]
        declarations.append(types.FunctionDeclaration(
            name=fn["name"],
            description=fn["description"],
            parameters=types.Schema(**fn["parameters"]),
        ))
    return [types.Tool(function_declarations=declarations)]


def _safe_json(obj):
    return json.dumps(obj, default=str)


def _system_text():
    return AI_SYSTEM.replace("{today}", datetime.now(timezone.utc).strftime("%Y-%m-%d (%A)"))


def _text_part(text: str):
    from google.genai import types
    return types.Part(text=text)


def _image_part(b64_data_url: str):
    from google.genai import types
    b64 = b64_data_url.split(",")[-1]
    return types.Part.from_bytes(data=__import__("base64").b64decode(b64), mime_type="image/jpeg")


async def run_ai_chat(db: AsyncSession, user: dict, body: AIChatBody):
    from google.genai import types
    session_id = body.session_id or new_id()

    # load history (strictly scoped to the current user)
    history_rows = (await db.execute(
        select(AIMessage).where(
            AIMessage.session_id == session_id,
            AIMessage.user_id == user["_id"],
        ).order_by(asc(AIMessage.created_at))
    )).scalars().all()

    tools = build_gemini_tools()
    config = types.GenerateContentConfig(
        system_instruction=_system_text(),
        tools=tools,
        temperature=0.2,
    )

    contents = []
    for h in history_rows[-12:]:
        contents.append(types.Content(role=h.role, parts=[_text_part(h.text)]))

    user_parts = [_text_part(body.message or "")]
    if body.image_base64:
        user_parts.append(_image_part(body.image_base64))
    contents.append(types.Content(role="user", parts=user_parts))

    created = []
    tool_summary = []
    previewed_this_turn: set = set()
    AI_TIMEOUT = int(os.environ.get("GEMINI_TIMEOUT_SECONDS", "25"))
    reply = ""
    try:
        resp = await _gemini_generate_with_fallback(
            lambda client, model: client.aio.models.generate_content(model=model, contents=contents, config=config),
            timeout=AI_TIMEOUT,
            operation="ai_chat",
        )
        guard = 0
        while resp.candidates and resp.candidates[0].content.parts and any(p.function_call for p in resp.candidates[0].content.parts) and guard < 6:
            guard += 1
            fc_parts = [p for p in resp.candidates[0].content.parts if p.function_call]
            # add model function-call turn
            contents.append(types.Content(role="model", parts=fc_parts))
            tool_responses = []
            for part in fc_parts:
                call = part.function_call
                args = dict(call.args) if call.args else {}
                result = await dispatch_tool(db, call.name, args, created, user, session_id, previewed_this_turn)
                tool_summary.append({"tool": call.name, "args": args})
                tool_responses.append(types.Part.from_function_response(name=call.name, response=result))
            contents.append(types.Content(role="user", parts=tool_responses))
            resp = await _gemini_generate_with_fallback(
                lambda client, model: client.aio.models.generate_content(model=model, contents=contents, config=config),
                timeout=AI_TIMEOUT,
                operation="ai_chat_tool_followup",
            )
        reply = ""
        if resp.candidates:
            for part in resp.candidates[0].content.parts:
                if part.text:
                    reply += part.text
    except HTTPException:
        raise
    except Exception:
        logger.exception("ai chat failed")
        raise HTTPException(500, "AI request failed. Please try again later.")

    # persist messages
    db.add(AIMessage(id=new_id(), user_id=user["_id"], session_id=session_id, role="user", text=body.message or "", created_at=now_iso()))
    db.add(AIMessage(id=new_id(), user_id=user["_id"], session_id=session_id, role="assistant", text=reply or "", created_at=now_iso()))

    if tool_summary:
        label = reply[:140] if reply else (tool_summary[0]["tool"].replace("_", " ").title())
        db.add(AIAction(
            id=new_id(), user_id=user["_id"], label=label,
            tools=[t["tool"] for t in tool_summary], created=created,
            undoable=len(created) > 0, undone=False, created_at=now_iso(),
        ))

    await db.commit()
    return {"reply": reply, "session_id": session_id, "actions": tool_summary, "changed": len(created) > 0 or len(tool_summary) > 0}


@api_router.post("/ai/chat")
async def ai_chat(body: AIChatBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await run_ai_chat(db, user, body)


@api_router.get("/ai/history")
async def ai_history(session_id: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(m) for m in (await db.execute(
        select(AIMessage).where(
            AIMessage.session_id == session_id,
            AIMessage.user_id == user["_id"],
        ).order_by(asc(AIMessage.created_at))
    )).scalars().all()]


@api_router.post("/ai/transcribe")
async def transcribe(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if not GEMINI_API_KEY:
        raise HTTPException(503, "AI is not configured. Set GEMINI_API_KEY to enable transcription.")
    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail=f"Audio too large (max {MAX_UPLOAD_SIZE // (1024 * 1024)} MB)")
    suffix = os.path.splitext(file.filename or "audio.webm")[1] or ".webm"
    ext = suffix.lstrip(".").lower()
    allowed_audio = {"webm": "audio/webm", "mp3": "audio/mpeg", "mp4": "audio/mp4", "m4a": "audio/mp4", "wav": "audio/wav"}
    if ext not in allowed_audio:
        raise HTTPException(status_code=400, detail="Unsupported audio format")
    mime = allowed_audio[ext]
    try:
        from google.genai import types
        content = types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(data=data, mime_type=mime),
                types.Part(text="Transcribe this audio to text. Return only the spoken words, no commentary.")
            ]
        )
        config = types.GenerateContentConfig(system_instruction="You are a speech-to-text transcriber.")
        AI_TIMEOUT = int(os.environ.get("GEMINI_TIMEOUT_SECONDS", "25"))
        resp = await _gemini_generate_with_fallback(
            lambda client, model: client.aio.models.generate_content(model=model, contents=[content], config=config),
            timeout=AI_TIMEOUT,
            operation="transcribe",
        )
        return {"text": resp.text or ""}
    except HTTPException:
        raise
    except Exception:
        logger.exception("transcription failed")
        raise HTTPException(500, "Could not transcribe audio. Please try again later.")


@api_router.post("/ai/receipt")
async def parse_receipt(body: AIChatBody, user: dict = Depends(get_current_user)):
    if not GEMINI_API_KEY:
        raise HTTPException(503, "AI is not configured. Set GEMINI_API_KEY to enable receipt scanning.")
    if not body.image_base64:
        raise HTTPException(400, "No image provided")
    # Rough estimate: base64 is ~4/3 of binary size
    if len(body.image_base64) > MAX_UPLOAD_SIZE * 2:
        raise HTTPException(status_code=413, detail=f"Image too large (max {MAX_UPLOAD_SIZE // (1024 * 1024)} MB)")
    try:
        from google.genai import types
        b64 = body.image_base64.split(",")[-1]
        raw = __import__("base64").b64decode(b64)
        if len(raw) > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail=f"Image too large (max {MAX_UPLOAD_SIZE // (1024 * 1024)} MB)")
        prompt = ('Extract this receipt as JSON with this exact shape: '
                  '{"merchant": string, "date": "YYYY-MM-DD" or null, "total": number, '
                  '"items": [{"name": string, "price": number}]}. '
                  'Only include line items and prices you can actually read. NEVER invent prices or a store name. '
                  'If the image is not clearly a receipt, or you cannot read it, return {"merchant": "", "items": []} — do NOT guess. '
                  'Respond with JSON only.')
        content = types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(data=raw, mime_type="image/jpeg"),
                types.Part(text=prompt)
            ]
        )
        config = types.GenerateContentConfig(system_instruction="You extract structured data from receipt photos. Respond ONLY with compact JSON, no prose.")
        AI_TIMEOUT = int(os.environ.get("GEMINI_TIMEOUT_SECONDS", "25"))
        resp = await _gemini_generate_with_fallback(
            lambda client, model: client.aio.models.generate_content(model=model, contents=[content], config=config),
            timeout=AI_TIMEOUT,
            operation="receipt_parse",
        )
        text = resp.text or ""
        m = re.search(r"\{.*\}", text, re.S)
        data = json.loads(m.group(0)) if m else {"items": []}
    except HTTPException:
        raise
    except Exception:
        logger.exception("receipt parse failed")
        raise HTTPException(500, "Could not read receipt. Please try again later.")
    data.setdefault("items", [])
    data.setdefault("merchant", "")
    return data


# ---------------------------------------------------------------------------
# AI tool dispatch
# ---------------------------------------------------------------------------
async def find_expense(db: AsyncSession, match: str, user_id: str) -> Optional[dict]:
    match = (match or "").strip()
    if not match:
        return None
    stmt = select(Transaction).where(
        (Transaction.user_id == user_id) &
        (Transaction.type == "expense") & (
            Transaction.merchant.ilike(f"%{match}%") |
            Transaction.description.ilike(f"%{match}%") |
            Transaction.category.ilike(f"%{match}%")
        )
    ).order_by(desc(Transaction.date))
    t = (await db.execute(stmt)).scalars().first()
    return txn_to_dict(t) if t else None


async def dispatch_tool(db: AsyncSession, name: str, args: dict, created: list, user: dict, session_id: Optional[str] = None, previewed_this_turn: Optional[set] = None) -> dict:
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
            res = await create_expense_record(db, body, user["_id"])
            created.append({"collection": "transactions", "id": res["transaction"]["id"]})
            return res
        if name == "record_payment":
            s = Settlement(
                id=new_id(), user_id=user["_id"],
                person_id=(await resolve_person(db, args["person"], user["_id"]))["id"],
                person_name=args["person"], amount=round(args["amount"], 2),
                method=args.get("method", "Revolut"), account=args.get("account", "revolut"),
                direction=args.get("direction", "in"),
                date=args.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                transaction_id=args.get("transaction_id"), created_at=now_iso())
            db.add(s)
            await db.commit()
            await db.refresh(s)
            created.append({"collection": "settlements", "id": s.id})
            return to_dict(s)
        if name == "create_person":
            return await resolve_person(db, args["name"], user["_id"])
        if name == "add_grocery":
            g = await add_grocery(GroceryBody(**{k: v for k, v in args.items() if k in GroceryBody.model_fields}), user, db)
            if g.get("id"):
                created.append({"collection": "groceries", "id": g["id"]})
            return g
        if name == "log_meal":
            m = await add_meal(MealBody(**{k: v for k, v in args.items() if k in MealBody.model_fields}), user, db)
            created.append({"collection": "meals", "id": m["id"]})
            return m
        if name == "record_weight":
            w = await add_weight(WeightBody(weight=args["weight"], date=args.get("date")), user, db)
            created.append({"collection": "weight", "id": w["id"]})
            return w
        if name == "create_task":
            t = await create_task(TaskBody(title=args["title"], priority=args.get("priority", "normal"), due=args.get("due")), user, db)
            created.append({"collection": "tasks", "id": t["id"]})
            return t
        if name == "get_financial_summary":
            return await analytics_summary(month=args.get("month"), user=user, db=db)
        if name == "get_people_balances":
            return await people_balances(db, user["_id"])
        if name == "update_expense":
            t = await find_expense(db, args.get("match", ""), user["_id"])
            if not t:
                return {"error": f"No expense found matching '{args.get('match')}'"}
            upd = TxnUpdate(amount=args.get("amount"), personal_amount=args.get("personal_amount"),
                            category=args.get("category"), payment_method=args.get("payment_method"),
                            date=args.get("date"), notes=args.get("notes"), description=args.get("description"))
            res = await update_transaction(t["id"], upd, user, db)
            return {"updated": res}
        if name == "delete_expense":
            match = args.get("match", "")
            if not (match or "").strip():
                return {"error": "A search term is required to identify which expense to delete."}
            t = await find_expense(db, match, user["_id"])
            if not t:
                return {"error": f"No expense found matching '{match}'"}
            pending = _pending_confirmations.get(session_id or "")
            has_pending = (
                pending
                and pending.get("tool") == "delete_expense"
                and pending.get("target_id") == t["id"]
                and datetime.now(timezone.utc) < pending.get("expires_at", datetime.min.replace(tzinfo=timezone.utc))
            )
            self_confirming = previewed_this_turn is not None and t["id"] in previewed_this_turn
            confirmed = args.get("confirm") is True and has_pending and not self_confirming
            if not confirmed:
                _pending_confirmations[session_id or ""] = {
                    "tool": "delete_expense",
                    "target_id": t["id"],
                    "match": match,
                    "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
                }
                if previewed_this_turn is not None:
                    previewed_this_turn.add(t["id"])
                return {"needs_confirmation": True,
                        "message": f"This will permanently delete '{t.get('merchant') or t.get('description')}' (€{t.get('gross_amount')}) from {t.get('date')}. Ask the user to confirm before deleting."}
            await delete_transaction(t["id"], user, db)
            _pending_confirmations.pop(session_id or "", None)
            return {"deleted": t.get("merchant") or t.get('description'), "amount": t.get("gross_amount")}
        if name == "mark_refunded":
            tid = None
            if args.get("match"):
                t = await find_expense(db, args["match"], user["_id"])
                tid = t["id"] if t else None
            s = Settlement(
                id=new_id(), user_id=user["_id"],
                person_id=(await resolve_person(db, args["person"], user["_id"]))["id"],
                person_name=args["person"], amount=round(args["amount"], 2),
                method=args.get("method", "Revolut"), account=args.get("account", "revolut"),
                direction="in", date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                transaction_id=tid, created_at=now_iso())
            db.add(s)
            await db.commit()
            await db.refresh(s)
            created.append({"collection": "settlements", "id": s.id})
            return {"settlement": to_dict(s), "linked_to_expense": tid is not None}
        if name == "update_grocery":
            g = (await db.execute(
                select(Grocery).where(Grocery.name_lower == args["name"].lower(), Grocery.user_id == user["_id"])
            )).scalar_one_or_none()
            if not g:
                return {"error": f"No grocery item named '{args['name']}'"}
            upd = GroceryUpdate(**{k: v for k, v in args.items() if k in GroceryUpdate.model_fields and k != "name"})
            res = await update_grocery(g.id, upd, user, db)
            return {"updated": res}
        if name == "generate_shopping_list":
            return await generate_shopping_doc(db, int(args.get("days", 7)), user_id=user["_id"])
        if name == "create_recipe":
            body = RecipeBody(name=args["name"], servings=int(args.get("servings", 1)),
                              ingredients=[RecipeIngredient(**i) for i in args.get("ingredients", [])],
                              calories=args.get("calories"), protein=args.get("protein"),
                              carbs=args.get("carbs"), fat=args.get("fat"))
            r = await create_recipe(body, user, db)
            created.append({"collection": "recipes", "id": r["id"]})
            return r
        if name == "cook_recipe":
            r = (await db.execute(
                select(Recipe).where(Recipe.name.ilike(args["name"]), Recipe.user_id == user["_id"])
            )).scalar_one_or_none()
            if not r:
                return {"error": f"No recipe named '{args['name']}'"}
            return await cook_recipe_doc(db, to_dict(r), user["_id"])
        if name == "log_workout":
            body = WorkoutBody(
                type=args.get("type", "Push"), date=args.get("date"), notes=args.get("notes", ""),
                exercises=[WorkoutExercise(name=e["name"], is_isometric=e.get("is_isometric", False),
                                           duration=e.get("duration"),
                                           sets=[WorkoutSet(**s) for s in e.get("sets", [])]) for e in args.get("exercises", [])])
            w = await create_workout(db, body, user["_id"])
            created.append({"collection": "workouts", "id": w["id"]})
            return w
    except HTTPException:
        raise
    except Exception:
        logger.exception("tool error")
        return {"error": "Tool execution failed. Please try again or rephrase your request."}
    return {"error": "unknown tool"}


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
async def seed():
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_pw = os.environ["ADMIN_PASSWORD"]

    async with AsyncSessionLocal() as db:
        # Always keep the single owner account in sync with environment variables.
        existing = (await db.execute(select(User).where(User.role == "owner"))).scalar_one_or_none()
        if not existing:
            admin_id = new_id()
            db.add(User(id=admin_id, email=admin_email, password_hash=hash_password(admin_pw),
                        name=OWNER_NAME, role="owner", email_verified=True,
                        created_at=now_iso()))
        else:
            admin_id = existing.id
            existing.email = admin_email
            existing.name = OWNER_NAME
            existing.email_verified = True
            if not verify_password(admin_pw, existing.password_hash):
                existing.password_hash = hash_password(admin_pw)

        if (await db.execute(select(func.count(Category.id)))).scalar() == 0:
            cats = [
                ("Groceries", "shopping-cart", "#10B981"), ("Eating Out", "utensils", "#F59E0B"),
                ("Transport", "bus", "#6366F1"), ("Shopping", "shopping-bag", "#EC4899"),
                ("Entertainment", "clapperboard", "#8B5CF6"), ("Work", "briefcase", "#0EA5E9"),
                ("Fitness", "dumbbell", "#059669"), ("Health", "heart-pulse", "#EF4444"),
                ("Travel", "plane", "#14B8A6"), ("Subscriptions", "repeat", "#F97316"),
                ("Bills", "receipt", "#64748B"), ("Other", "circle", "#94A3B8"),
            ]
            for n, i, c in cats:
                db.add(Category(id=new_id(), user_id=admin_id, name=n, icon=i, color=c, created_at=now_iso()))

        if (await db.execute(select(func.count(Account.id)))).scalar() == 0:
            db.add(Account(id="cash", user_id=admin_id, name="Cash", type="cash", opening_balance=120.0, created_at=now_iso()))
            db.add(Account(id="revolut", user_id=admin_id, name="Revolut", type="revolut", opening_balance=640.0, created_at=now_iso()))

        if (await db.execute(select(func.count(Person.id)))).scalar() == 0:
            for n in ["Ferreira", "Broca", "Sebas", "Mariana", "Faia"]:
                db.add(Person(id=new_id(), user_id=admin_id, name=n, name_lower=n.lower(),
                              photo=None, notes="", payment_preference="", created_at=now_iso()))

        if (await db.execute(select(func.count(Transaction.id)))).scalar() == 0:
            await seed_transactions(db, admin_id)

        if (await db.execute(select(func.count(Task.id)))).scalar() == 0:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            for title, pr in [("Record weekly weight", "high"), ("Pull workout", "normal"),
                              ("Ask Ferreira for payment", "normal"), ("Buy eggs and milk", "low")]:
                db.add(Task(id=new_id(), user_id=admin_id, title=title, priority=pr, due=today,
                            recurring=None, done=False, created_at=now_iso()))

        if (await db.execute(select(func.count(WeightEntry.id)))).scalar() == 0:
            base = datetime.now(timezone.utc) - timedelta(weeks=6)
            weights = [81.2, 81.6, 82.0, 82.3, 82.7, 83.0]
            for i, w in enumerate(weights):
                d = (base + timedelta(weeks=i)).strftime("%Y-%m-%d")
                db.add(WeightEntry(id=new_id(), user_id=admin_id, weight=w, date=d, note="Weekly check-in", created_at=now_iso()))

        if (await db.execute(select(func.count(Grocery.id)))).scalar() == 0:
            gs = [("Eggs", 3, "unit", "Eggs", 3.49, "Lidl", 6), ("Milk", 1, "L", "Dairy", 0.89, "Mercadona", 2),
                  ("Chicken breast", 600, "g", "Meat", 5.20, "Mercadona", 200), ("Tuna", 4, "can", "Fish", 3.29, "Supeco", 2),
                  ("Gouda", 200, "g", "Dairy", 4.98, "Lidl", 100), ("Rice", 1000, "g", "Carbohydrates", None, None, 300),
                  ("Bread", 1, "unit", "Carbohydrates", 0.95, "Lidl", 1)]
            for n, q, u, c, p, s, lt in gs:
                db.add(Grocery(id=new_id(), user_id=admin_id, name=n, name_lower=n.lower(), quantity=q,
                               unit=u, category=c, price=p, store=s, low_threshold=lt,
                               notes="", expiration=None, created_at=now_iso(), updated_at=now_iso()))

        if (await db.execute(select(func.count(PriceRecord.id)))).scalar() == 0:
            pr = [
                ("Eggs", "Lidl", 3.49, "2025-09-25"), ("Eggs", "Mercadona", 3.89, "2025-09-17"), ("Eggs", "Supeco", 3.29, "2025-09-10"),
                ("Milk", "Mercadona", 0.89, "2025-09-17"), ("Milk", "Lidl", 0.95, "2025-09-25"),
                ("Chicken breast", "Mercadona", 5.20, "2025-10-08"), ("Chicken breast", "Lidl", 5.60, "2025-11-04"),
                ("Tuna", "Supeco", 3.29, "2025-09-10"), ("Tuna", "Lidl", 2.99, "2025-11-04"), ("Tuna", "Mercadona", 3.49, "2025-10-08"),
                ("Gouda", "Lidl", 4.98, "2025-09-25"), ("Gouda", "Mercadona", 5.20, "2025-10-08"),
                ("Bread", "Lidl", 0.95, "2025-11-04"), ("Bread", "Mercadona", 1.10, "2025-10-08"),
            ]
            for n, s, p, d in pr:
                db.add(PriceRecord(id=new_id(), user_id=admin_id, name=n, name_lower=n.lower(), store=s,
                                   price=p, unit="unit", date=d, created_at=now_iso()))

        if (await db.execute(select(func.count(Recipe.id)))).scalar() == 0:
            db.add(Recipe(id=new_id(), user_id=admin_id, name="Protein scramble", servings=1,
                          ingredients=[{"name": "Eggs", "quantity": 3, "unit": "unit"},
                                       {"name": "Gouda", "quantity": 30, "unit": "g"},
                                       {"name": "Bread", "quantity": 1, "unit": "unit"}],
                          calories=520, protein=34, carbs=30, fat=28,
                          notes="Quick high-protein breakfast.", created_at=now_iso()))

        if (await db.execute(select(func.count(Meal.id)))).scalar() == 0:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            db.add(Meal(id=new_id(), user_id=admin_id, description="Oats, whey & banana", date=today, calories=520, protein=38, carbs=68, fat=12, created_at=now_iso()))
            db.add(Meal(id=new_id(), user_id=admin_id, description="200g alcatra, 3 eggs, 300ml milk", date=today, calories=690, protein=62, carbs=14, fat=42, created_at=now_iso()))

        if (await db.execute(select(func.count(Workout.id)))).scalar() == 0:
            now = datetime.now(timezone.utc)
            db.add(Workout(id=new_id(), user_id=admin_id, type="Pull", date=(now - timedelta(days=3)).strftime("%Y-%m-%d"), notes="",
                           exercises=[
                               {"name": "Pull-ups", "is_isometric": False, "duration": None, "note": "", "sets": [{"reps": 8, "weight": 0}, {"reps": 7, "weight": 0}, {"reps": 6, "weight": 0}]},
                               {"name": "Rows", "is_isometric": False, "duration": None, "note": "", "sets": [{"reps": 10, "weight": 20}, {"reps": 10, "weight": 20}, {"reps": 9, "weight": 20}]},
                               {"name": "Dead hang", "is_isometric": True, "duration": 45, "note": "", "sets": []},
                           ], created_at=now_iso()))
            db.add(Workout(id=new_id(), user_id=admin_id, type="Push", date=(now - timedelta(days=1)).strftime("%Y-%m-%d"), notes="",
                           exercises=[
                               {"name": "Dips", "is_isometric": False, "duration": None, "note": "", "sets": [{"reps": 12, "weight": 0}, {"reps": 11, "weight": 0}, {"reps": 10, "weight": 0}]},
                               {"name": "Push-ups", "is_isometric": False, "duration": None, "note": "", "sets": [{"reps": 15, "weight": 0}, {"reps": 15, "weight": 0}]},
                           ], created_at=now_iso()))

        await db.commit()


async def seed_transactions(db: AsyncSession, user_id: str):
    people = (await db.execute(
        select(Person).where(Person.user_id == user_id)
    )).scalars().all()
    pmap = {p.name: p for p in people}

    async def exp(amount, merchant, cat, account, date, participants=None, items=None, split_mode="equal", desc=""):
        body = ExpenseBody(amount=amount, merchant=merchant, description=desc or merchant, category=cat,
                           account=account, date=date, participants=participants or ["Me"],
                           items=[ItemBody(**i) for i in items] if items else [],
                           split_mode=split_mode)
        await create_expense_record(db, body, user_id)

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

    await exp(11.80, "Popeyes", "Eating Out", "cash", "2025-10-03", participants=["Me", "Faia"], split_mode="equal")
    await exp(41.20, "Mercadona", "Groceries", "revolut", "2025-10-08")
    await exp(6.30, "MAS", "Groceries", "cash", "2025-10-11")
    await exp(19.99, "Netflix & Spotify", "Subscriptions", "revolut", "2025-10-01")
    await exp(15.50, "Uber", "Transport", "revolut", "2025-10-15", participants=["Me", "Broca", "Mariana"], split_mode="equal")

    await exp(27.60, "Lidl", "Groceries", "revolut", "2025-11-04")
    await exp(13.20, "McDonald's", "Eating Out", "cash", "2025-11-09", participants=["Me", "Ferreira"], split_mode="equal")
    await exp(52.00, "Decathlon", "Fitness", "revolut", "2025-11-12")

    now = datetime.now(timezone.utc)
    d0 = now.strftime("%Y-%m-%d")
    d2 = (now - timedelta(days=2)).strftime("%Y-%m-%d")
    d5 = (now - timedelta(days=5)).strftime("%Y-%m-%d")
    await exp(8.60, "Mercadona", "Groceries", "cash", d0)
    await exp(23.40, "Lidl", "Groceries", "revolut", d2, participants=["Me", "Broca"], split_mode="equal")
    await exp(6.90, "McDonald's", "Eating Out", "cash", d5)

    ferreira = pmap.get("Ferreira")
    if ferreira:
        db.add(Settlement(id=new_id(), user_id=user_id, person_id=ferreira.id, person_name="Ferreira",
                          amount=5.00, method="Revolut", account="revolut",
                          direction="in", date="2025-10-20", transaction_id=None, created_at=now_iso()))
        await db.commit()


# ---------------------------------------------------------------------------
# App lifespan and startup
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await seed()
    logger.info("Life Record ready.")
    yield
    await engine.dispose()


app.router.lifespan_context = lifespan


@api_router.get("/health")
async def health():
    return {"status": "ok"}


@api_router.get("/")
async def root():
    return {"app": "Life Record", "status": "ok"}


app.include_router(api_router)

# ---------------------------------------------------------------------------
# Security middleware
# ---------------------------------------------------------------------------
# CORS: never default to '*' when credentials are enabled.
_cors_origins = [o.strip() for o in os.environ.get('CORS_ORIGINS', 'http://localhost:3000').split(',') if o.strip()]
if not _cors_origins:
    _cors_origins = ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    max_age=600,
)

# Optional: restrict Host header in production by setting ALLOWED_HOSTS.
_allowed_hosts = [h.strip() for h in os.environ.get('ALLOWED_HOSTS', '').split(',') if h.strip()]
if _allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_allowed_hosts)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    # Note: a restrictive Content-Security-Policy would break the React dev server;
    # set it at the reverse-proxy / production build layer instead.
    return response
