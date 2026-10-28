from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import sys
import uuid
import json
import logging
import re
import asyncio
import calendar
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any

import jwt
from fastapi import FastAPI, APIRouter, Request, HTTPException, Depends, UploadFile, File, Query, Response
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, delete, update, func, desc, asc
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import engine, AsyncSessionLocal, get_db
from models import (
    Base, User, Account, Category, Person, Transaction, Split, Settlement,
    Task, WeightEntry, Workout, Photo, Grocery, Product, StorageLocation,
    Appliance, PriceRecord, ShoppingItem, ShoppingList, RecurringList,
    Meal, Recipe, AIAction, AIMessage,
)
import kitchen_logic
import ai_tools_extra
import ai_opencode
import conversations_api
import chat_images
import scheduling
import scheduling_api
import calendar_api
from starlette.responses import StreamingResponse
from security_utils import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    create_password_reset_token, decode_token, generate_six_digit_code,
    is_valid_email, is_strong_password,
)
from email_service import send_verification_code, send_password_reset

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
_background_tasks: set = set()  # keeps fire-and-forget tasks alive until they finish
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


def delete_object(path: str) -> None:
    _safe_storage_path(path).unlink(missing_ok=True)


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
    archived: Optional[bool] = Field(default=False)


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
    account_id: Optional[str] = Field(default=None, max_length=36)
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
    account_id: Optional[str] = Field(default=None, max_length=36)
    amount: float
    description: str = Field(default="", max_length=500)
    date: Optional[str] = None


ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"
TASK_REPEATS = ("daily", "weekly", "monthly")


class TaskBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    priority: str = Field(default="normal", pattern=r"^(low|normal|high)$")
    due: Optional[str] = Field(default=None, pattern=ISO_DATE)
    recurring: Optional[str] = Field(default=None, pattern=r"^(daily|weekly|monthly)$")
    done: bool = False

    @field_validator("due", "recurring", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        return None if v == "" else v


def next_due(due: str, repeat: str) -> str:
    """Next occurrence of a recurring task. Monthly keeps the day, clamped to the month's last day."""
    d = datetime.strptime(due, "%Y-%m-%d")
    if repeat == "daily":
        return (d + timedelta(days=1)).strftime("%Y-%m-%d")
    if repeat == "weekly":
        return (d + timedelta(weeks=1)).strftime("%Y-%m-%d")
    year, month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return datetime(year, month, min(d.day, calendar.monthrange(year, month)[1])).strftime("%Y-%m-%d")


class WeightBody(BaseModel):
    weight: float = Field(..., ge=0, le=1000)
    date: Optional[str] = Field(default=None, pattern=ISO_DATE)
    note: str = Field(default="", max_length=1000)


class GroceryBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    quantity: float = Field(default=1, ge=0)
    unit: str = Field(default="unit", max_length=50)
    category: str = Field(default="Other", max_length=255)
    storage_location: Optional[str] = Field(default=None, max_length=50)
    price: Optional[float] = None
    store: Optional[str] = Field(default=None, max_length=255)
    low_threshold: float = Field(default=0, ge=0)
    notes: str = Field(default="", max_length=2000)
    expiration: Optional[str] = None
    is_favorite: bool = Field(default=False)
    default_quantity: Optional[float] = Field(default=None, ge=0)
    default_store: Optional[str] = Field(default=None, max_length=255)


class GroceryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    quantity: Optional[float] = Field(default=None, ge=0)
    unit: Optional[str] = Field(default=None, max_length=50)
    category: Optional[str] = Field(default=None, max_length=255)
    storage_location: Optional[str] = Field(default=None, max_length=50)
    price: Optional[float] = None
    store: Optional[str] = Field(default=None, max_length=255)
    low_threshold: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = Field(default=None, max_length=2000)
    expiration: Optional[str] = None
    is_favorite: Optional[bool] = Field(default=None)
    default_quantity: Optional[float] = Field(default=None, ge=0)
    default_store: Optional[str] = Field(default=None, max_length=255)


class TxnUpdate(BaseModel):
    description: Optional[str] = Field(default=None, max_length=500)
    category: Optional[str] = Field(default=None, max_length=255)
    account: Optional[str] = Field(default=None, max_length=50)
    payment_method: Optional[str] = Field(default=None, max_length=50)
    date: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=2000)
    amount: Optional[float] = None
    personal_amount: Optional[float] = None


class ProductBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = Field(default=None, max_length=255)
    subcategory: Optional[str] = Field(default=None, max_length=100)
    default_unit: str = Field(default="unit", max_length=50)
    typical_quantity: Optional[float] = Field(default=None, ge=0)
    synonyms: List[str] = Field(default=[])
    nutrition: Optional[Dict[str, Any]] = Field(default=None)
    tags: List[str] = Field(default=[])
    icon: Optional[str] = Field(default=None, max_length=16)
    is_favorite: bool = Field(default=False)


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    category: Optional[str] = Field(default=None, max_length=255)
    subcategory: Optional[str] = Field(default=None, max_length=100)
    default_unit: Optional[str] = Field(default=None, max_length=50)
    typical_quantity: Optional[float] = Field(default=None, ge=0)
    synonyms: Optional[List[str]] = Field(default=None)
    nutrition: Optional[Dict[str, Any]] = Field(default=None)
    tags: Optional[List[str]] = Field(default=None)
    icon: Optional[str] = Field(default=None, max_length=16)
    is_favorite: Optional[bool] = Field(default=None)


class StorageLocationBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    kind: str = Field(default="custom", max_length=50)
    icon: Optional[str] = Field(default=None, max_length=50)
    sort_order: int = Field(default=0)


class StorageLocationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    kind: Optional[str] = Field(default=None, max_length=50)
    icon: Optional[str] = Field(default=None, max_length=50)
    sort_order: Optional[int] = Field(default=None)


class ApplianceBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    kind: str = Field(default="other", max_length=50)
    icon: Optional[str] = Field(default=None, max_length=50)
    notes: Optional[str] = Field(default=None, max_length=2000)


class ApplianceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    kind: Optional[str] = Field(default=None, max_length=50)
    icon: Optional[str] = Field(default=None, max_length=50)
    notes: Optional[str] = Field(default=None, max_length=2000)


class MoveInventoryBody(BaseModel):
    storage_location: str = Field(..., min_length=1, max_length=50)


class ConsumeBody(BaseModel):
    quantity: float = Field(..., gt=0)


class DiscardBody(BaseModel):
    quantity: Optional[float] = Field(default=None, gt=0)


class AccountBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: str = Field(..., min_length=1, max_length=50)
    parent_id: Optional[str] = Field(default=None, max_length=36)
    currency: str = Field(default="EUR", max_length=10)
    opening_balance: float = Field(default=0, ge=0)
    initial_balance: Optional[float] = Field(default=None, ge=0)
    is_locked: bool = Field(default=False)
    sort_order: int = Field(default=0)
    is_active: bool = Field(default=True)


class AccountUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    type: Optional[str] = Field(default=None, max_length=50)
    parent_id: Optional[str] = Field(default=None, max_length=36)
    currency: Optional[str] = Field(default=None, max_length=10)
    opening_balance: Optional[float] = Field(default=None, ge=0)
    # Desired current balance. The server derives the opening balance so that
    # opening + transactions == balance, which is what "set my balance to X" means.
    balance: Optional[float] = Field(default=None, ge=0)
    initial_balance: Optional[float] = Field(default=None, ge=0)
    is_locked: Optional[bool] = Field(default=None)
    sort_order: Optional[int] = Field(default=None)
    is_active: Optional[bool] = Field(default=None)


class AccountTransferBody(BaseModel):
    from_account_id: str = Field(..., min_length=1, max_length=36)
    to_account_id: str = Field(..., min_length=1, max_length=36)
    amount: float = Field(..., gt=0)
    date: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=500)


class MealBody(BaseModel):
    description: str = Field(..., min_length=1, max_length=500)
    calories: Optional[float] = Field(default=None, ge=0, le=50000)
    protein: Optional[float] = Field(default=None, ge=0, le=5000)
    carbs: Optional[float] = Field(default=None, ge=0, le=5000)
    fat: Optional[float] = Field(default=None, ge=0, le=5000)
    date: Optional[str] = None


class ShoppingBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = Field(default=None, max_length=255)
    quantity: float = Field(default=1, ge=0)
    unit: str = Field(default="unit", max_length=50)
    estimated_price: Optional[float] = Field(default=None, ge=0)
    store: Optional[str] = Field(default=None, max_length=255)
    note: str = Field(default="", max_length=1000)
    list_id: Optional[str] = Field(default=None, max_length=36)
    sort_order: int = Field(default=0)
    storage_location: Optional[str] = Field(default=None, max_length=50)
    product_id: Optional[str] = Field(default=None, max_length=36)


class BuyBody(BaseModel):
    price: Optional[float] = None
    store: Optional[str] = Field(default=None, max_length=255)


class ShoppingItemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    category: Optional[str] = Field(default=None, max_length=255)
    quantity: Optional[float] = Field(default=None, ge=0)
    unit: Optional[str] = Field(default=None, max_length=50)
    estimated_price: Optional[float] = Field(default=None, ge=0)
    actual_price: Optional[float] = Field(default=None, ge=0)
    store: Optional[str] = Field(default=None, max_length=255)
    note: Optional[str] = Field(default=None, max_length=1000)
    sort_order: Optional[int] = Field(default=None)
    selected: Optional[bool] = Field(default=None)
    storage_location: Optional[str] = Field(default=None, max_length=50)
    product_id: Optional[str] = Field(default=None, max_length=36)


class ShoppingListBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    budget: Optional[float] = Field(default=None, ge=0)
    duplicate_of: Optional[str] = Field(default=None, max_length=36)


class ShoppingListUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    budget: Optional[float] = Field(default=None, ge=0)
    archived: Optional[bool] = Field(default=None)


class PurchaseItem(BaseModel):
    item_id: str = Field(..., max_length=36)
    quantity: Optional[float] = Field(default=None, ge=0)
    actual_price: Optional[float] = Field(default=None, ge=0)
    store: Optional[str] = Field(default=None, max_length=255)


class SubmitPurchaseBody(BaseModel):
    items: List[PurchaseItem] = []
    store: Optional[str] = Field(default=None, max_length=255)
    record_expense: bool = Field(default=False)
    payment_account: Optional[str] = Field(default=None, max_length=36)


class RecurringItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    quantity: float = Field(default=1, ge=0)
    unit: str = Field(default="unit", max_length=50)
    category: Optional[str] = Field(default=None, max_length=255)
    estimated_price: Optional[float] = Field(default=None, ge=0)


class RecurringListBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    schedule: str = Field(default="weekly", max_length=50)
    items: List[RecurringItem] = []


class RecurringListUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    schedule: Optional[str] = Field(default=None, max_length=50)
    items: Optional[List[RecurringItem]] = Field(default=None)


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
    page: Optional[str] = Field(default=None, max_length=40)  # which page the user is on, for context


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
    date: Optional[str] = Field(default=None, pattern=ISO_DATE)
    exercises: List[WorkoutExercise] = []
    notes: str = Field(default="", max_length=2000)


class PhotoNote(BaseModel):
    note: str = Field(default="", max_length=2000)
    date: Optional[str] = Field(default=None, pattern=ISO_DATE)


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


async def default_cash_account(db: AsyncSession, user_id: str) -> Optional[Account]:
    """Where a generic 'cash' payment comes from: the unlocked cash place holding the most money,
    or the Money in hand account itself when it has no places."""
    parent = (await db.execute(
        select(Account).where(Account.user_id == user_id, Account.type == "cash", Account.is_active == True)
    )).scalars().first()
    places = (await db.execute(
        select(Account).where(Account.user_id == user_id, Account.type == "cash_place",
                              Account.is_active == True, Account.is_locked == False)
        .order_by(Account.sort_order, Account.name)
    )).scalars().all()
    if not places:
        return parent
    balances = [(await compute_account_balance(db, p.id, user_id), p) for p in places]
    return max(balances, key=lambda b: b[0])[1]


async def normalize_account_ref(db: AsyncSession, ref: Optional[str], user_id: str) -> Optional[str]:
    """Turn any account reference (id, name, legacy 'cash'/'revolut'/'card') into an account id.
    Unresolvable references are returned unchanged."""
    if not ref:
        return ref
    acc = await resolve_account(db, ref, user_id)
    return acc.id if acc else ref


async def resolve_account(db: AsyncSession, ref: str, user_id: str) -> Optional[Account]:
    """Resolve an account by id, name, or legacy cash/revolut alias."""
    if not ref:
        return None
    ref_lower = ref.strip().lower()
    if ref_lower == "cash":
        return await default_cash_account(db, user_id)
    if ref_lower in ("revolut", "card"):
        return (await db.execute(
            select(Account).where(Account.user_id == user_id, Account.type == "revolut", Account.is_active == True)
        )).scalars().first()
    # Try by id first.
    acc = (await db.execute(
        select(Account).where(Account.id == ref, Account.user_id == user_id, Account.is_active == True)
    )).scalar_one_or_none()
    if acc:
        return acc
    # Try by name: an exact match wins over a partial one.
    accs = (await db.execute(
        select(Account).where(Account.user_id == user_id, Account.is_active == True)
        .order_by(Account.sort_order, Account.name)
    )).scalars().all()
    exact = next((a for a in accs if a.name.strip().lower() == ref_lower), None)
    return exact or next((a for a in accs if ref_lower in a.name.lower()), None)


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
        account=await normalize_account_ref(db, body.account, user_id), merchant=body.merchant, date=date, month=month_of(date),
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
        from collections import Counter
        counts = Counter(it.get("name", "").strip() for it in items if it.get("name"))
        for name, count in counts.items():
            g = (await db.execute(
                select(Grocery).where(Grocery.name_lower == name.lower(), Grocery.user_id == user_id)
            )).scalar_one_or_none()
            if g:
                g.quantity = float(g.quantity) + count
                g.updated_at = now_iso()
            else:
                first_item = next(it for it in items if it.get("name", "").strip() == name)
                g = Grocery(id=new_id(), user_id=user_id, name=name, name_lower=name.lower(),
                            quantity=count, unit="unit", category="Other",
                            price=first_item.get("price"), store=body.merchant, low_threshold=0,
                            notes="", expiration=None, created_at=now_iso(), updated_at=now_iso())
                db.add(g)
            inventory_added.extend([name] * count)

    await db.commit()
    await db.refresh(txn)
    return {"transaction": txn_to_dict(txn), "inventory_added": inventory_added}


def txn_to_dict(txn: Transaction, rmap: Dict[str, float] = None, account_types: dict = None) -> dict:
    d = to_dict(txn)
    d["splits"] = [to_dict(s) for s in txn.splits]
    d = serialize_txn(d, rmap or {}, account_types)
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

    # Settlements that created their own income/expense transaction are already counted above.
    result = await db.execute(select(Settlement).where(
        (Settlement.user_id == user_id) & (Settlement.account == account) &
        (Settlement.balance_transaction_id == None)
    ))
    for s in result.scalars():
        bal += float(s.amount) if s.direction == "in" else -float(s.amount)

    return round(bal, 2)


async def people_balances(db: AsyncSession, user_id: str) -> List[dict]:
    people = (await db.execute(
        select(Person).where(Person.user_id == user_id, Person.archived == False).order_by(Person.name)
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


async def shopping_payload(db: AsyncSession, user_id: str, list_id: Optional[str] = None) -> dict:
    lists = (await db.execute(
        select(ShoppingList).where(
            ShoppingList.user_id == user_id,
        ).order_by(desc(ShoppingList.created_at))
    )).scalars().all()
    list_map = {lst.id: to_dict(lst) for lst in lists}

    # Ensure at least a default list exists if there are items without a list.
    items_query = select(ShoppingItem).where(
        ShoppingItem.user_id == user_id,
        ShoppingItem.bought == False,
    )
    if list_id:
        items_query = items_query.where(ShoppingItem.list_id == list_id)
    items = (await db.execute(items_query.order_by(asc(ShoppingItem.sort_order), asc(ShoppingItem.created_at)))).scalars().all()

    if items and not lists:
        default_list = await get_or_create_default_list(db, user_id)
        list_map[default_list.id] = to_dict(default_list)
        for it in items:
            if not it.list_id:
                it.list_id = default_list.id
        await db.commit()

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
        enriched.append({**to_dict(it), "list": list_map.get(it.list_id),
                         "per_store": per_store, "best": ch, "known": ch is not None})

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

    # Budget summary for the requested/current list
    active_list = list_map.get(list_id) if list_id else None
    budget_summary = None
    if active_list:
        list_items = [it for it in items if it.list_id == active_list["id"]]
        estimated_total = round(sum(float(it.estimated_price or 0) * float(it.quantity) for it in list_items), 2)
        budget_summary = {
            "list_id": active_list["id"],
            "budget": float(active_list["budget"]) if active_list.get("budget") is not None else None,
            "estimated_total": estimated_total,
            "remaining": round(float(active_list["budget"]) - estimated_total, 2) if active_list.get("budget") is not None else None,
            "item_count": len(list_items),
            "selected_count": sum(1 for it in list_items if it.selected),
        }

    return {
        "items": enriched,
        "lists": list(list_map.values()),
        "stores": stores_sorted,
        "best_single": best_single,
        "split_total": round(split_total, 2),
        "unknown": unknown,
        "recommendation": recommendation.strip(),
        "budget_summary": budget_summary,
    }


async def get_or_create_default_list(db: AsyncSession, user_id: str) -> ShoppingList:
    lst = (await db.execute(
        select(ShoppingList).where(
            ShoppingList.user_id == user_id,
            ShoppingList.archived == False,
        ).order_by(asc(ShoppingList.created_at))
    )).scalars().first()
    if not lst:
        now = now_iso()
        lst = ShoppingList(id=new_id(), user_id=user_id, name="Shopping list",
                           archived=False, created_at=now, updated_at=now)
        db.add(lst)
        await db.commit()
        await db.refresh(lst)
    return lst


async def add_shopping_item_doc(db: AsyncSession, name: str, quantity: float = 1,
                                     unit: str = "unit", note: str = "", user_id: str = None,
                                     list_id: str = None, category: Optional[str] = None,
                                     estimated_price: Optional[float] = None,
                                     store: Optional[str] = None, sort_order: int = 0,
                                     storage_location: Optional[str] = None,
                                     product_id: Optional[str] = None) -> dict:
    if not list_id:
        default_list = await get_or_create_default_list(db, user_id)
        list_id = default_list.id
    existing = (await db.execute(
        select(ShoppingItem).where(
            ShoppingItem.user_id == user_id,
            ShoppingItem.list_id == list_id,
            ShoppingItem.name_lower == name.lower(),
            ShoppingItem.bought == False,
        )
    )).scalar_one_or_none()
    if existing:
        return to_dict(existing)
    doc = ShoppingItem(id=new_id(), user_id=user_id, list_id=list_id, name=name, name_lower=name.lower(),
                       category=category, quantity=quantity, unit=unit,
                       estimated_price=estimated_price, store=store,
                       storage_location=storage_location, product_id=product_id,
                       note=note, bought=False, sort_order=sort_order, created_at=now_iso())
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return to_dict(doc)


async def generate_shopping_doc(db: AsyncSession, days: int = 7, user_id: str = None, list_id: Optional[str] = None) -> dict:
    if not list_id:
        default_list = await get_or_create_default_list(db, user_id)
        list_id = default_list.id
    groceries = (await db.execute(
        select(Grocery).where(Grocery.user_id == user_id)
    )).scalars().all()
    stock = {g.name_lower: g for g in groceries}
    added = []
    for g in groceries:
        if g.low_threshold and float(g.quantity) <= float(g.low_threshold):
            await add_shopping_item_doc(db, g.name, max(1, round(days / 2)), g.unit or "unit", "Running low", user_id, list_id=list_id)
            added.append(g.name)
    known_names = [r[0] async for r in await db.stream(
        select(PriceRecord.name).where(PriceRecord.user_id == user_id).distinct()
    )]
    for name in known_names:
        nl = name.lower()
        if nl not in stock or float(stock[nl].quantity) <= 0:
            doc = await add_shopping_item_doc(db, name, 1, "unit", "From your usual buys", user_id, list_id=list_id)
            if doc["name"] not in added:
                added.append(doc["name"])
    payload = await shopping_payload(db, user_id, list_id=list_id)
    payload["added"] = added
    return payload


async def cook_recipe_doc(db: AsyncSession, recipe: dict, user_id: str) -> dict:
    """Use up a recipe's ingredients from inventory (unit-aware) and log one serving as a meal."""
    stock = (await db.execute(select(Grocery).where(Grocery.user_id == user_id))).scalars().all()
    by_id = {g.id: g for g in stock}
    inventory = [to_dict(g) for g in stock]
    changes = []
    for ing in recipe.get("ingredients", []):
        item = kitchen_logic.find_item(ing["name"], inventory)
        if not item:
            changes.append(f"{ing['name']} (not in inventory)")
            continue
        g = by_id[item["id"]]
        used = kitchen_logic.convert(float(ing.get("quantity") or 0), ing.get("unit"), g.unit)
        if used is None:
            changes.append(f"{ing['name']}: units differ ({ing.get('unit')} vs {g.unit}), adjust the stock by hand")
            continue
        newq = max(0, round(float(g.quantity) - used, 3))
        g.quantity = newq
        g.updated_at = now_iso()
        changes.append(f"{ing['name']} −{ing.get('quantity', 0)}{ing.get('unit', '')} (now {newq} {g.unit})")
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
class BulkDeleteBody(BaseModel):
    ids: List[str] = Field(..., min_length=1)


@api_router.get("/people")
async def get_people(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await people_balances(db, user["_id"])


@api_router.post("/people")
async def create_person(body: PersonBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = Person(id=new_id(), user_id=user["_id"], name=body.name, name_lower=body.name.lower(),
               photo=body.photo, notes=body.notes or "",
               payment_preference=body.payment_preference or "",
               archived=False, created_at=now_iso())
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return to_dict(p)


@api_router.put("/people/{pid}")
async def update_person(pid: str, body: PersonBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = (await db.execute(
        select(Person).where(Person.id == pid, Person.user_id == user["_id"])
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Person not found")
    p.name = body.name
    p.name_lower = body.name.lower()
    p.photo = body.photo
    p.notes = body.notes or ""
    p.payment_preference = body.payment_preference or ""
    await db.commit()
    await db.refresh(p)
    return to_dict(p)


async def _delete_people(db: AsyncSession, user_id: str, ids: List[str]) -> int:
    # Remove associated financial records first to keep the ledger consistent.
    txn_ids = select(Transaction.id).where(Transaction.user_id == user_id).scalar_subquery()
    await db.execute(
        delete(Split).where(Split.person_id.in_(ids), Split.transaction_id.in_(txn_ids))
    )
    await db.execute(
        delete(Settlement).where(Settlement.person_id.in_(ids), Settlement.user_id == user_id)
    )
    result = await db.execute(
        delete(Person).where(Person.id.in_(ids), Person.user_id == user_id)
    )
    await db.commit()
    return result.rowcount


@api_router.delete("/people/{pid}")
async def delete_person(pid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    count = await _delete_people(db, user["_id"], [pid])
    if count == 0:
        raise HTTPException(404, "Person not found")
    return {"deleted": count}


@api_router.post("/people/bulk-delete")
async def bulk_delete_people(body: BulkDeleteBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    count = await _delete_people(db, user["_id"], body.ids)
    return {"deleted": count}



@api_router.get("/people/{pid}")
async def person_detail(pid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    people = await people_balances(db, user["_id"])
    person = next((p for p in people if p["id"] == pid), None)
    if not person:
        raise HTTPException(404, "Person not found")

    account_names = {a.id: a.name for a in (await db.execute(
        select(Account).where(Account.user_id == user["_id"])
    )).scalars()}

    def acct(ref):
        return account_names.get(ref, ref)

    # Build a unified ledger of debts and repayments
    ledger = []
    total_original_debt = 0.0
    total_repaid = 0.0

    splits = (await db.execute(
        select(Split, Transaction).join(Transaction).where(
            Split.person_id == pid,
            Transaction.user_id == user["_id"],
        ).order_by(desc(Transaction.date))
    )).all()
    for sp, txn in splits:
        amount = float(sp.amount)
        if txn.paid_by == "me":
            total_original_debt += amount
            ledger.append({
                "id": sp.id, "transaction_id": txn.id, "type": "debt", "date": txn.date,
                "merchant": txn.merchant or txn.description or txn.category,
                "description": f"Paid by you · {acct(txn.account)}",
                "amount": amount, "balance_effect": +amount,
                "category": txn.category, "payment_method": acct(txn.account),
                "gross": float(txn.gross_amount),
            })
        elif txn.paid_by == pid and sp.is_me:
            total_original_debt -= amount  # they paid, I owe them this share
            ledger.append({
                "id": sp.id, "transaction_id": txn.id, "type": "credit", "date": txn.date,
                "merchant": txn.merchant or txn.description or txn.category,
                "description": f"Paid by {person['name']} · {acct(txn.account)}",
                "amount": amount, "balance_effect": -amount,
                "category": txn.category, "payment_method": acct(txn.account),
                "gross": float(txn.gross_amount),
            })

    settlements = (await db.execute(
        select(Settlement).where(
            Settlement.person_id == pid,
            Settlement.user_id == user["_id"],
        ).order_by(desc(Settlement.date))
    )).scalars().all()
    for s in settlements:
        amount = float(s.amount)
        if s.direction == "in":
            total_repaid += amount
            ledger.append({
                "id": s.id, "type": "repayment", "date": s.date,
                "merchant": f"Payment via {s.method}", "description": f"Received into {acct(s.account)}",
                "amount": amount, "balance_effect": -amount,
                "method": s.method, "account": acct(s.account),
                "transaction_id": s.transaction_id,
            })
        else:
            ledger.append({
                "id": s.id, "type": "payment_out", "date": s.date,
                "merchant": f"Payment via {s.method}", "description": f"Sent from {acct(s.account)}",
                "amount": amount, "balance_effect": +amount,
                "method": s.method, "account": acct(s.account),
                "transaction_id": s.transaction_id,
            })

    ledger.sort(key=lambda x: x["date"], reverse=True)

    return {
        "person": person,
        "summary": {
            "total_original_debt": round(total_original_debt, 2),
            "total_repaid": round(total_repaid, 2),
            "current_balance": round(person["net"], 2),
        },
        "ledger": ledger,
        "transactions": [l for l in ledger if l["type"] in ("debt", "credit")],
        "settlements": [to_dict(s) for s in settlements],
    }


@api_router.post("/people/{pid}/clear-balance")
async def clear_person_balance(pid: str, body: SettlementBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Create a settlement that zeros the balance with this person."""
    people = await people_balances(db, user["_id"])
    person = next((p for p in people if p["id"] == pid), None)
    if not person:
        raise HTTPException(404, "Person not found")
    net = person["net"]
    if abs(net) < 0.005:
        return {"ok": True, "message": "Already settled"}
    direction = "in" if net > 0 else "out"
    return await add_settlement(SettlementBody(
        person=person["name"], amount=abs(net), method=body.method,
        account=body.account, account_id=body.account_id, direction=direction,
    ), user, db)


@api_router.post("/people/clear-debts")
async def clear_all_debts(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Remove all debt records (splits and settlements) for the current user. Transactions remain."""
    # Delete settlements and any auto-created transactions they produced
    settlements = (await db.execute(
        select(Settlement).where(Settlement.user_id == user["_id"])
    )).scalars().all()
    txn_ids = {x for s in settlements for x in [s.transaction_id, s.balance_transaction_id] if x}
    if txn_ids:
        await db.execute(delete(Transaction).where(Transaction.id.in_(txn_ids), Transaction.user_id == user["_id"]))
    await db.execute(delete(Settlement).where(Settlement.user_id == user["_id"]))

    # Delete all splits
    await db.execute(delete(Split).where(Split.person_id.in_(
        select(Person.id).where(Person.user_id == user["_id"])
    )))

    await db.commit()
    return {"ok": True, "deleted_settlements": len(settlements), "deleted_splits": "all"}


@api_router.delete("/settlements/{sid}")
async def delete_settlement(sid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = (await db.execute(
        select(Settlement).where(Settlement.id == sid, Settlement.user_id == user["_id"])
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Settlement not found")
    txn_ids = {x for x in [s.transaction_id, s.balance_transaction_id] if x}
    if txn_ids:
        await db.execute(delete(Transaction).where(Transaction.id.in_(txn_ids), Transaction.user_id == user["_id"]))
    await db.execute(delete(Settlement).where(Settlement.id == sid, Settlement.user_id == user["_id"]))
    await db.commit()
    return {"ok": True}


@api_router.delete("/splits/{sid}")
async def delete_split(sid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sp = (await db.execute(
        select(Split).where(Split.id == sid)
    )).scalar_one_or_none()
    if not sp:
        raise HTTPException(404, "Split not found")
    txn = (await db.execute(
        select(Transaction).where(Transaction.id == sp.transaction_id, Transaction.user_id == user["_id"])
    )).scalar_one_or_none()
    if not txn:
        raise HTTPException(404, "Transaction not found")
    await db.execute(delete(Split).where(Split.id == sid))
    await db.commit()
    return {"ok": True}


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
        _user_owned_query(Account, user).where(Account.is_active == True).order_by(Account.sort_order, Account.name)
    )).scalars().all()
    out = []
    for a in accs:
        d = to_dict(a)
        d["balance"] = await compute_account_balance(db, a.id, user["_id"])
        out.append(d)
    return out


@api_router.post("/accounts")
async def create_account(body: AccountBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.parent_id:
        parent = (await db.execute(
            select(Account).where(Account.id == body.parent_id, Account.user_id == user["_id"])
        )).scalar_one_or_none()
        if not parent:
            raise HTTPException(400, "Parent account not found")
    acc = Account(
        id=new_id(), user_id=user["_id"], name=body.name, type=body.type,
        parent_id=body.parent_id, currency=body.currency,
        opening_balance=round(body.opening_balance, 2),
        initial_balance=round(body.initial_balance, 2) if body.initial_balance is not None else None,
        is_locked=body.is_locked,
        sort_order=body.sort_order,
        is_active=body.is_active, created_at=now_iso(),
    )
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return to_dict(acc)


@api_router.put("/accounts/{aid}")
async def update_account(aid: str, body: AccountUpdate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    acc = (await db.execute(
        select(Account).where(Account.id == aid, Account.user_id == user["_id"])
    )).scalar_one_or_none()
    if not acc:
        raise HTTPException(404, "Account not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    target_balance = updates.pop("balance", None)
    if target_balance is not None:
        current = await compute_account_balance(db, aid, user["_id"])
        updates["opening_balance"] = round(float(acc.opening_balance) + float(target_balance) - current, 2)
    if "parent_id" in updates:
        if updates["parent_id"] == aid:
            raise HTTPException(400, "Account cannot be its own parent")
        if updates["parent_id"]:
            parent = (await db.execute(
                select(Account).where(Account.id == updates["parent_id"], Account.user_id == user["_id"])
            )).scalar_one_or_none()
            if not parent:
                raise HTTPException(400, "Parent account not found")
    if updates:
        await db.execute(update(Account).where(Account.id == aid, Account.user_id == user["_id"]).values(**updates))
        await db.commit()
        await db.refresh(acc)
    acc = (await db.execute(
        select(Account).where(Account.id == aid, Account.user_id == user["_id"])
    )).scalar_one_or_none()
    return to_dict(acc)


@api_router.delete("/accounts/{aid}")
async def delete_account(aid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Prevent deleting accounts with children or transactions.
    children = (await db.execute(
        select(Account).where(Account.parent_id == aid, Account.user_id == user["_id"])
    )).scalars().first()
    if children:
        raise HTTPException(400, "Delete child accounts first")
    txn = (await db.execute(
        select(Transaction).where(
            ((Transaction.account == aid) & (Transaction.type == "expense")) |
            ((Transaction.account == aid) & (Transaction.type == "income")) |
            ((Transaction.from_account == aid) & (Transaction.type == "transfer")) |
            ((Transaction.to_account == aid) & (Transaction.type == "transfer"))
        ).where(Transaction.user_id == user["_id"])
    )).scalars().first()
    if txn:
        raise HTTPException(400, "Cannot delete account with transactions")
    result = await db.execute(delete(Account).where(Account.id == aid, Account.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Account not found")
    return {"ok": True}


@api_router.post("/accounts/transfer")
async def transfer_money(body: AccountTransferBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.from_account_id == body.to_account_id:
        raise HTTPException(400, "Source and destination must differ")
    from_acc = (await db.execute(
        select(Account).where(Account.id == body.from_account_id, Account.user_id == user["_id"])
    )).scalar_one_or_none()
    to_acc = (await db.execute(
        select(Account).where(Account.id == body.to_account_id, Account.user_id == user["_id"])
    )).scalar_one_or_none()
    if not from_acc or not to_acc:
        raise HTTPException(404, "Account not found")
    bal = await compute_account_balance(db, from_acc.id, user["_id"])
    if bal < body.amount - 0.005:
        raise HTTPException(400, "Insufficient funds")
    date = body.date or now_iso()[:10]
    txn = Transaction(
        id=new_id(), user_id=user["_id"], type="transfer",
        gross_amount=round(body.amount, 2), personal_amount=0, reimbursable_amount=0,
        description=body.note or f"Transfer to {to_acc.name}", category="Transfer",
        account=from_acc.id, from_account=from_acc.id, to_account=to_acc.id,
        date=date, month=month_of(date), created_at=now_iso(),
    )
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return {"ok": True, "transaction": txn_to_dict(txn, {})}


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


def _payment_method_for_account(account_id: str, account_types: dict) -> str:
    if not account_id:
        return "card"
    if account_types:
        t = account_types.get(account_id, "")
        if t in ("cash", "cash_place"):
            return "cash"
        if t:
            return "card"
    return "cash" if account_id == "cash" else "card"


def serialize_txn(t: dict, rmap: dict, account_types: dict = None) -> dict:
    if t.get("type") != "expense":
        return {**t, "payment_method": _payment_method_for_account(t.get("account"), account_types)}
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
            "payment_method": _payment_method_for_account(t.get("account"), account_types)}


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
    accs = (await db.execute(select(Account.id, Account.type).where(Account.user_id == user["_id"]))).all()
    account_types = {a.id: a.type for a in accs}
    out = [txn_to_dict(t, rmap, account_types) for t in rows]
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
    if body.payment_method:
        updates["account"] = await normalize_account_ref(db, body.payment_method, user["_id"])
    if body.account:
        updates["account"] = await normalize_account_ref(db, body.account, user["_id"])
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
        from collections import Counter
        counts = Counter(it.get("name", "").strip().lower() for it in txn.items if it.get("name"))
        for name_lower, count in counts.items():
            g = (await db.execute(
                select(Grocery).where(Grocery.name_lower == name_lower, Grocery.user_id == user["_id"])
            )).scalar_one_or_none()
            if g:
                new_qty = float(g.quantity) - count
                if new_qty <= 0:
                    await db.execute(delete(Grocery).where(Grocery.id == g.id))
                else:
                    g.quantity = new_qty
                    g.updated_at = now_iso()
    await db.execute(delete(Split).where(Split.transaction_id == tid))
    await db.execute(delete(Settlement).where(Settlement.transaction_id == tid, Settlement.user_id == user["_id"]))
    await db.execute(delete(Transaction).where(Transaction.id == tid, Transaction.user_id == user["_id"]))
    await db.commit()
    return {"ok": True}


@api_router.post("/transactions/transfer")
async def add_transfer(body: TransferBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    from_id = await normalize_account_ref(db, body.from_account, user["_id"])
    to_id = await normalize_account_ref(db, body.to_account, user["_id"])
    t = Transaction(id=new_id(), user_id=user["_id"], type="transfer", from_account=from_id,
                    to_account=to_id, gross_amount=round(body.amount, 2),
                    description=body.notes or "Transfer", date=date, month=month_of(date),
                    account=from_id, created_at=now_iso())
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return to_dict(t)


@api_router.post("/transactions/income")
async def add_income(body: IncomeBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    date = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    account_id = body.account_id or body.account
    acc = await resolve_account(db, account_id, user["_id"])
    account_id = acc.id if acc else body.account
    t = Transaction(id=new_id(), user_id=user["_id"], type="income", account=account_id,
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

    # Resolve account by id, then by name/type fallback for backwards compatibility
    account_id = body.account_id
    if account_id:
        account_id = await normalize_account_ref(db, account_id, user["_id"])
    else:
        acc = await resolve_account(db, body.account, user["_id"])
        if acc:
            account_id = acc.id

    s = Settlement(id=new_id(), user_id=user["_id"], person_id=person["id"], person_name=person["name"],
                   amount=round(body.amount, 2), method=body.method, account=account_id or body.account,
                   direction=body.direction, date=date, transaction_id=body.transaction_id,
                   created_at=now_iso())
    db.add(s)
    await db.flush()

    # Record a matching money transaction so the selected account balance changes automatically.
    if account_id:
        txn_type = "income" if body.direction == "in" else "expense"
        txn = Transaction(
            id=new_id(), user_id=user["_id"], type=txn_type,
            gross_amount=round(body.amount, 2),
            personal_amount=round(body.amount, 2),
            reimbursable_amount=0,
            description=f"{'Payment from' if body.direction == 'in' else 'Payment to'} {person['name']}",
            category="People",
            account=account_id,
            merchant=person["name"],
            date=date,
            month=date[:7],
            notes=f"Settlement via {body.method}",
            created_at=now_iso())
        db.add(txn)
        await db.flush()
        s.balance_transaction_id = txn.id

    await db.commit()
    await db.refresh(s)
    return to_dict(s)


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
def _account_type_lookup(accounts: list) -> dict:
    return {a["id"]: a["type"] for a in accounts}


@api_router.get("/analytics/summary")
async def analytics_summary(month: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
                            user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    accounts = await get_accounts(user, db)
    type_by_id = _account_type_lookup(accounts)

    def sum_by_types(*types):
        return round(sum(a["balance"] for a in accounts if a["type"] in types), 2)

    bank = sum_by_types("bank")
    bank_current = bank
    bank_initial = round(sum(a.get("initial_balance") if a.get("initial_balance") is not None else a["balance"] for a in accounts if a["type"] == "bank"), 2)
    money_left_bank = round(bank_initial - bank_current, 2)
    # Cash places: separate freely available from locked funds.
    cash_parent = round(sum(a["balance"] for a in accounts if a["type"] == "cash"), 2)
    cash_available = round(cash_parent + sum(a["balance"] for a in accounts if a["type"] == "cash_place" and not a.get("is_locked")), 2)
    cash_locked = round(sum(a["balance"] for a in accounts if a["type"] == "cash_place" and a.get("is_locked")), 2)
    cash = round(cash_available + cash_locked, 2)
    # Revolut spaces mirror cash places: locked ones are kept apart from freely available funds.
    revolut_parent = sum_by_types("revolut")
    revolut_spaces_available = round(sum(a["balance"] for a in accounts if a["type"] == "revolut_space" and not a.get("is_locked")), 2)
    revolut_locked = round(sum(a["balance"] for a in accounts if a["type"] == "revolut_space" and a.get("is_locked")), 2)
    revolut = round(revolut_parent + revolut_spaces_available, 2)
    revolut_total = round(revolut + revolut_locked, 2)
    # Locked money isn't available, so it isn't "in hand".
    in_hand = round(cash_available + revolut, 2)
    actual_spent = round(money_left_bank - in_hand, 2) if money_left_bank > 0 else None
    total_available = round(bank + cash_available + revolut, 2)

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
        acc_type = type_by_id.get(t.account, "")
        if acc_type in ("cash", "cash_place"):
            cash_spent += float(t.gross_amount)
        elif acc_type == "revolut":
            card_spent += float(t.gross_amount)
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
    # Same net-per-person totals the People tab shows.
    owed_to_me = round(sum(max(p["net"], 0) for p in people), 2)
    i_owe = round(sum(max(-p["net"], 0) for p in people), 2)
    outstanding = owed_to_me
    total_with_owed = round(total_available + owed_to_me, 2)

    groceries = (await db.execute(
        select(Grocery).where(Grocery.user_id == user["_id"])
    )).scalars().all()
    out_of_stock = [g.name for g in groceries if (float(g.quantity) if g.quantity else 0) <= 0]
    low_stock = [g.name for g in groceries if (float(g.quantity) if g.quantity else 0) > 0 and g.low_threshold and float(g.quantity) <= float(g.low_threshold)]
    unknown_price = [g.name for g in groceries if g.price is None]

    # Active shopping lists summary for dashboard
    active_lists = (await db.execute(
        select(ShoppingList).where(
            ShoppingList.user_id == user["_id"],
            ShoppingList.archived == False,
        ).order_by(desc(ShoppingList.created_at))
    )).scalars().all()
    list_ids = [lst.id for lst in active_lists]
    pending_items = []
    if list_ids:
        pending_items = (await db.execute(
            select(ShoppingItem).where(
                ShoppingItem.user_id == user["_id"],
                ShoppingItem.list_id.in_(list_ids),
                ShoppingItem.bought == False,
            ).order_by(asc(ShoppingItem.created_at))
        )).scalars().all()
    list_summaries = []
    for lst in active_lists:
        its = [it for it in pending_items if it.list_id == lst.id]
        estimated = round(sum(float(it.estimated_price or 0) * float(it.quantity) for it in its), 2)
        list_summaries.append({
            "id": lst.id,
            "name": lst.name,
            "budget": float(lst.budget) if lst.budget is not None else None,
            "pending_count": len(its),
            "estimated_total": estimated,
            "remaining": round(float(lst.budget) - estimated, 2) if lst.budget is not None else None,
        })

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

    by_category_out = []
    for k, v in sorted(by_cat.items(), key=lambda x: -x[1]):
        budget = cat_budgets.get(k)
        pct = round(v / gross * 100, 1) if gross else 0
        by_category_out.append({"name": k, "value": round(v, 2), "percentage": pct, "budget": budget})

    return {
        "bank": bank, "cash": cash, "revolut": revolut,
        "cash_available": cash_available, "cash_locked": cash_locked,
        "revolut_locked": revolut_locked, "revolut_total": revolut_total,
        "total_available": total_available, "owed_to_me": owed_to_me,
        "total_with_owed": total_with_owed,
        "bank_initial": bank_initial, "money_left_bank": money_left_bank,
        "in_hand": in_hand, "actual_spent": actual_spent,
        "accounts": accounts,
        "gross": round(gross, 2), "personal": round(personal, 2),
        "reimbursable": round(reimbursable, 2),
        "cash_spent": round(cash_spent, 2), "card_spent": round(card_spent, 2),
        "refunded": round(refunded, 2), "pending": outstanding,
        "i_owe": i_owe, "outstanding": outstanding,
        "by_category": by_category_out,
        "by_day": [{"date": k, "value": round(v, 2)} for k, v in sorted(by_day.items())],
        "top_merchants": top_merchants,
        "income": income_total, "net": round(income_total - gross, 2),
        "daily_average": daily_avg,
        "projected_month_spend": projected_month_spend,
        "previous_period_gross": prev_gross,
        "period_days": period_days,
        "grocery": {
            "total": len(groceries), "out_of_stock": out_of_stock, "low_stock": low_stock,
            "unknown_price": unknown_price, "active_lists": list_summaries,
            "pending_total": len(pending_items),
        },
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
    completing = body.done and not task.done
    await db.execute(update(Task).where(Task.id == tid, Task.user_id == user["_id"]).values(**body.model_dump()))
    if completing and body.recurring in TASK_REPEATS and body.due:
        # Completing a repeating task schedules the next one; only on the not-done -> done transition.
        db.add(Task(id=new_id(), user_id=user["_id"], title=body.title, priority=body.priority,
                    due=next_due(body.due, body.recurring), recurring=body.recurring, done=False, created_at=now_iso()))
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


@api_router.put("/weight/{wid}")
async def update_weight(wid: str, body: WeightBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    w = (await db.execute(
        select(WeightEntry).where(WeightEntry.id == wid, WeightEntry.user_id == user["_id"])
    )).scalar_one_or_none()
    if not w:
        raise HTTPException(404, "Weight entry not found")
    w.weight = body.weight
    w.note = body.note
    if body.date:
        w.date = body.date
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


@api_router.put("/workouts/{wid}")
async def update_workout(wid: str, body: WorkoutBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    w = (await db.execute(
        select(Workout).where(Workout.id == wid, Workout.user_id == user["_id"])
    )).scalar_one_or_none()
    if not w:
        raise HTTPException(404, "Workout not found")
    w.type = body.type
    w.notes = body.notes
    w.exercises = [e.model_dump() for e in body.exercises]
    if body.date:
        w.date = body.date
    await db.commit()
    await db.refresh(w)
    return to_dict(w)


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
    # A deleted progress photo is gone for good: the row and the file (removed once the row is).
    path = photo.storage_path
    await db.execute(delete(Photo).where(Photo.id == pid, Photo.user_id == user["_id"]))
    await db.commit()
    delete_object(path)
    return {"ok": True}


@api_router.put("/photos/{pid}")
async def update_photo(pid: str, body: PhotoNote, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    photo = (await db.execute(
        select(Photo).where(Photo.id == pid, Photo.user_id == user["_id"], Photo.is_deleted == False)
    )).scalar_one_or_none()
    if not photo:
        raise HTTPException(404, "Photo not found")
    photo.note = body.note
    if body.date:
        photo.date = body.date
    await db.commit()
    await db.refresh(photo)
    d = to_dict(photo)
    d["url"] = f"/api/photos/file/{photo.storage_path}"
    return d


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
async def resolve_storage_name(db: AsyncSession, user_id: str, value: Optional[str], strict: bool = False) -> Optional[str]:
    """Canonicalise a storage reference (location name or kind, any case) to the configured location's name.

    Inventory rows reference their location by name, so this keeps UI, REST and AI writes consistent.
    With strict=True an unknown reference raises a 400 that lists the valid choices.
    """
    if not value or not value.strip():
        return None
    rows = (await db.execute(select(StorageLocation).where(StorageLocation.user_id == user_id))).scalars().all()
    v = value.strip().lower()
    for loc in rows:
        if loc.name.lower() == v:
            return loc.name
    for loc in rows:
        if (loc.kind or "").lower() == v:
            return loc.name
    if strict:
        raise HTTPException(400, f"Unknown storage location '{value}'. Available: {', '.join(l.name for l in rows) or 'none yet'}")
    return value.strip()


async def find_grocery(db: AsyncSession, user_id: str, grocery_id: Optional[str] = None, name: Optional[str] = None):
    """Resolve an inventory item by id or (case-insensitive) name. Returns (grocery, error_message)."""
    if grocery_id:
        g = (await db.execute(select(Grocery).where(Grocery.id == grocery_id, Grocery.user_id == user_id))).scalar_one_or_none()
        return (g, None) if g else (None, "Item not found")
    q = (name or "").strip().lower()
    if not q:
        return None, "Provide grocery_id or name"
    rows = (await db.execute(select(Grocery).where(Grocery.user_id == user_id))).scalars().all()
    exact = [g for g in rows if g.name_lower == q]
    if len(exact) == 1:
        return exact[0], None
    partial = [g for g in rows if q in g.name_lower]
    if len(partial) == 1:
        return partial[0], None
    if not partial and not exact:
        return None, f"No inventory item matching '{name}'"
    return None, f"'{name}' matches several items: " + ", ".join(sorted(g.name for g in (exact or partial)))


@api_router.get("/groceries")
async def get_groceries(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(g) for g in (await db.execute(
        _user_owned_query(Grocery, user).order_by(Grocery.name)
    )).scalars().all()]


@api_router.post("/groceries")
async def add_grocery(body: GroceryBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    body.storage_location = await resolve_storage_name(db, user["_id"], body.storage_location)
    await record_price(db, body.name, body.store, body.price, body.unit, user_id=user["_id"])
    existing = (await db.execute(
        select(Grocery).where(Grocery.name_lower == body.name.lower(), Grocery.user_id == user["_id"])
    )).scalar_one_or_none()
    if existing:
        existing.quantity = float(existing.quantity) + body.quantity
        existing.purchase_count = int(existing.purchase_count or 0) + 1
        if body.price is not None:
            existing.price = body.price
        if body.store:
            existing.store = body.store
        if body.storage_location:
            existing.storage_location = body.storage_location
        if body.expiration:
            existing.expiration = body.expiration
        if body.is_favorite:
            existing.is_favorite = True
        if body.default_quantity is not None:
            existing.default_quantity = body.default_quantity
        if body.default_store:
            existing.default_store = body.default_store
        existing.updated_at = now_iso()
        await db.commit()
        await db.refresh(existing)
        return to_dict(existing)
    g = Grocery(id=new_id(), user_id=user["_id"], name=body.name, name_lower=body.name.lower(),
                quantity=body.quantity, unit=body.unit, category=body.category,
                storage_location=body.storage_location or await resolve_storage_name(db, user["_id"], "pantry") or "pantry",
                price=body.price, store=body.store, low_threshold=body.low_threshold,
                notes=body.notes or "", expiration=body.expiration,
                is_favorite=body.is_favorite,
                default_quantity=body.default_quantity,
                default_store=body.default_store,
                purchase_count=1,
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
    if updates.get("storage_location"):
        updates["storage_location"] = await resolve_storage_name(db, user["_id"], updates["storage_location"])
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


@api_router.get("/groceries/low-stock")
async def get_low_stock(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    groceries = (await db.execute(
        select(Grocery).where(Grocery.user_id == user["_id"]).order_by(Grocery.name)
    )).scalars().all()
    out = []
    for g in groceries:
        qty = float(g.quantity) if g.quantity else 0
        threshold = float(g.low_threshold) if g.low_threshold else 0
        if threshold > 0 and qty <= threshold:
            out.append({**to_dict(g), "status": "low" if qty > 0 else "out"})
    return out


@api_router.get("/groceries/suggestions")
async def get_grocery_suggestions(limit: int = 10, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Suggest frequently bought or favorite items that are not currently in shopping lists."""
    # Active list item names
    active_items = (await db.execute(
        select(ShoppingItem.name_lower).where(
            ShoppingItem.user_id == user["_id"],
            ShoppingItem.bought == False,
        )
    )).scalars().all()
    active_names = set(active_items)

    # Favorites and frequently bought
    favorites = (await db.execute(
        select(Grocery).where(
            Grocery.user_id == user["_id"],
            Grocery.is_favorite == True,
        ).order_by(desc(Grocery.purchase_count))
    )).scalars().all()

    frequent = (await db.execute(
        select(Grocery).where(
            Grocery.user_id == user["_id"],
            Grocery.purchase_count > 0,
        ).order_by(desc(Grocery.purchase_count))
    )).scalars().all()

    seen = set()
    out = []
    for g in list(favorites) + list(frequent):
        nl = g.name_lower
        if nl in seen or nl in active_names:
            continue
        seen.add(nl)
        out.append({**to_dict(g), "reason": "favorite" if g.is_favorite else "frequently bought"})
        if len(out) >= limit:
            break
    return out


@api_router.post("/groceries/{gid}/move")
async def move_grocery(gid: str, body: MoveInventoryBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    g = (await db.execute(
        select(Grocery).where(Grocery.id == gid, Grocery.user_id == user["_id"])
    )).scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Item not found")
    g.storage_location = await resolve_storage_name(db, user["_id"], body.storage_location)
    g.updated_at = now_iso()
    await db.commit()
    await db.refresh(g)
    return to_dict(g)


@api_router.post("/groceries/{gid}/consume")
async def consume_grocery(gid: str, body: ConsumeBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    g = (await db.execute(
        select(Grocery).where(Grocery.id == gid, Grocery.user_id == user["_id"])
    )).scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Item not found")
    current = float(g.quantity) if g.quantity else 0
    if body.quantity > current + 0.0001:
        raise HTTPException(400, "Cannot consume more than available")
    g.quantity = round(current - body.quantity, 2)
    g.updated_at = now_iso()
    await db.commit()
    await db.refresh(g)
    return to_dict(g)


@api_router.post("/groceries/{gid}/discard")
async def discard_grocery(gid: str, body: DiscardBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    g = (await db.execute(
        select(Grocery).where(Grocery.id == gid, Grocery.user_id == user["_id"])
    )).scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Item not found")
    current = float(g.quantity) if g.quantity else 0
    qty = body.quantity if body.quantity is not None else current
    if qty > current + 0.0001:
        raise HTTPException(400, "Cannot discard more than available")
    if qty >= current - 0.0001:
        await db.execute(delete(Grocery).where(Grocery.id == gid, Grocery.user_id == user["_id"]))
        await db.commit()
        return {"ok": True, "deleted": True, "quantity": current}
    g.quantity = round(current - qty, 2)
    g.updated_at = now_iso()
    await db.commit()
    await db.refresh(g)
    return to_dict(g)


@api_router.get("/groceries/expiring")
async def get_expiring_groceries(days: int = 7, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import date as _date
    cutoff = (_date.today() + timedelta(days=days)).isoformat()
    groceries = (await db.execute(
        _user_owned_query(Grocery, user).where(
            Grocery.expiration != None,
            Grocery.expiration <= cutoff,
            Grocery.quantity > 0,
        ).order_by(Grocery.expiration)
    )).scalars().all()
    return [to_dict(g) for g in groceries]


# ---------------------------------------------------------------------------
# Product catalog
# ---------------------------------------------------------------------------
@api_router.get("/products")
async def get_products(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(p) for p in (await db.execute(
        _user_owned_query(Product, user).order_by(Product.name)
    )).scalars().all()]


@api_router.get("/products/search")
async def search_products(q: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    term = (q or "").strip().lower()
    if not term:
        return []
    rows = (await db.execute(_user_owned_query(Product, user).order_by(Product.name))).scalars().all()

    def matches(p: Product) -> bool:
        haystack = [p.name_lower, (p.category or "").lower(), (p.subcategory or "").lower()]
        haystack += [str(s).lower() for s in (p.synonyms or [])] + [str(t).lower() for t in (p.tags or [])]
        return any(term in h for h in haystack)

    return [to_dict(p) for p in rows if matches(p)]


@api_router.post("/products")
async def create_product(body: ProductBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = Product(
        id=new_id(), user_id=user["_id"], name=body.name, name_lower=body.name.lower(),
        category=body.category, subcategory=body.subcategory, default_unit=body.default_unit,
        typical_quantity=round(body.typical_quantity, 2) if body.typical_quantity is not None else None,
        synonyms=body.synonyms or [], nutrition=body.nutrition, tags=body.tags or [], icon=body.icon,
        is_favorite=body.is_favorite, created_at=now_iso())
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return to_dict(p)


@api_router.post("/products/import-library")
async def import_product_library(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Add the built-in starter catalog. Products you already have are kept as they are: only their
    empty subcategory, icon, tags, nutrition and alternative names are filled in. Safe to run repeatedly."""
    from catalog_data import LIBRARY
    valid = {"Meat", "Fish", "Eggs", "Dairy", "Carbohydrates", "Fruit", "Vegetables", "Frozen", "Pantry", "Snacks", "Drinks", "Other"}
    rows = (await db.execute(_user_owned_query(Product, user))).scalars().all()
    by_name = {p.name_lower: p for p in rows}
    by_synonym = {str(s).lower(): p for p in rows for s in (p.synonyms or [])}
    added = enriched = 0
    for item in LIBRARY:
        key = item["name"].lower()
        existing = by_name.get(key) or by_synonym.get(key)
        if existing is None:
            p = Product(
                id=new_id(), user_id=user["_id"], name=item["name"], name_lower=key, category=item["category"],
                subcategory=item["subcategory"], default_unit=item["default_unit"],
                typical_quantity=item["typical_quantity"], synonyms=item["synonyms"], nutrition=item["nutrition"],
                tags=item["tags"], icon=item["icon"], is_favorite=False, created_at=now_iso())
            db.add(p)
            by_name[key] = p
            added += 1
            continue
        changed = False
        if existing.category not in valid:  # an alias such as "Produce"; adopt the app's own category
            existing.category, changed = item["category"], True
        if existing.category == item["category"] and not existing.subcategory:
            existing.subcategory, changed = item["subcategory"], True
        if not existing.icon and item["icon"]:
            existing.icon, changed = item["icon"], True
        if not existing.tags and item["tags"]:
            existing.tags, changed = item["tags"], True
        if not existing.nutrition and item["nutrition"]:
            existing.nutrition, changed = item["nutrition"], True
        if not existing.synonyms and item["synonyms"]:
            existing.synonyms, changed = item["synonyms"], True
        enriched += 1 if changed else 0
    await db.commit()
    return {"added": added, "enriched": enriched, "library_size": len(LIBRARY)}


@api_router.put("/products/{pid}")
async def update_product(pid: str, body: ProductUpdate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = (await db.execute(
        select(Product).where(Product.id == pid, Product.user_id == user["_id"])
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Product not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "name" in updates:
        updates["name_lower"] = updates["name"].lower()
    if "typical_quantity" in updates and updates["typical_quantity"] is not None:
        updates["typical_quantity"] = round(updates["typical_quantity"], 2)
    if updates:
        await db.execute(update(Product).where(Product.id == pid, Product.user_id == user["_id"]).values(**updates))
        await db.commit()
        await db.refresh(p)
    return to_dict(p)


@api_router.delete("/products/{pid}")
async def delete_product(pid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Product).where(Product.id == pid, Product.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Product not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Storage locations
# ---------------------------------------------------------------------------
@api_router.get("/storage-locations")
async def get_storage_locations(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(s) for s in (await db.execute(
        _user_owned_query(StorageLocation, user).order_by(StorageLocation.sort_order, StorageLocation.name)
    )).scalars().all()]


@api_router.post("/storage-locations")
async def create_storage_location(body: StorageLocationBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = StorageLocation(
        id=new_id(), user_id=user["_id"], name=body.name, kind=body.kind,
        icon=body.icon, sort_order=body.sort_order, created_at=now_iso())
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return to_dict(s)


@api_router.put("/storage-locations/{sid}")
async def update_storage_location(sid: str, body: StorageLocationUpdate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = (await db.execute(
        select(StorageLocation).where(StorageLocation.id == sid, StorageLocation.user_id == user["_id"])
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Storage location not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        old_name = s.name
        await db.execute(update(StorageLocation).where(StorageLocation.id == sid, StorageLocation.user_id == user["_id"]).values(**updates))
        new_name = updates.get("name")
        if new_name and new_name != old_name:
            # Items reference their location by name: keep them attached after a rename.
            for model in (Grocery, ShoppingItem):
                await db.execute(update(model).where(model.user_id == user["_id"], func.lower(model.storage_location) == old_name.lower())
                                 .values(storage_location=new_name))
        await db.commit()
        await db.refresh(s)
    return to_dict(s)


@api_router.delete("/storage-locations/{sid}")
async def delete_storage_location(sid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(StorageLocation).where(StorageLocation.id == sid, StorageLocation.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Storage location not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Appliances
# ---------------------------------------------------------------------------
@api_router.get("/appliances")
async def get_appliances(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [to_dict(a) for a in (await db.execute(
        _user_owned_query(Appliance, user).order_by(Appliance.name)
    )).scalars().all()]


@api_router.post("/appliances")
async def create_appliance(body: ApplianceBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    a = Appliance(
        id=new_id(), user_id=user["_id"], name=body.name, kind=body.kind,
        icon=body.icon, notes=body.notes, created_at=now_iso())
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return to_dict(a)


@api_router.put("/appliances/{aid}")
async def update_appliance(aid: str, body: ApplianceUpdate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    a = (await db.execute(
        select(Appliance).where(Appliance.id == aid, Appliance.user_id == user["_id"])
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Appliance not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await db.execute(update(Appliance).where(Appliance.id == aid, Appliance.user_id == user["_id"]).values(**updates))
        await db.commit()
        await db.refresh(a)
    return to_dict(a)


@api_router.delete("/appliances/{aid}")
async def delete_appliance(aid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(Appliance).where(Appliance.id == aid, Appliance.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Appliance not found")
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


@api_router.put("/meals/{mid}")
async def update_meal(mid: str, body: MealBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    meal = (await db.execute(select(Meal).where(Meal.id == mid, Meal.user_id == user["_id"]))).scalar_one_or_none()
    if not meal:
        raise HTTPException(404, "Meal not found")
    updates = body.model_dump()
    updates["date"] = updates.get("date") or meal.date
    await db.execute(update(Meal).where(Meal.id == mid, Meal.user_id == user["_id"]).values(**updates))
    await db.commit()
    await db.refresh(meal)
    return to_dict(meal)


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
async def get_shopping(list_id: Optional[str] = None, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await shopping_payload(db, user["_id"], list_id=list_id)


@api_router.get("/shopping/lists")
async def get_shopping_lists(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    lists = (await db.execute(
        select(ShoppingList).where(ShoppingList.user_id == user["_id"]).order_by(desc(ShoppingList.created_at))
    )).scalars().all()
    return [to_dict(lst) for lst in lists]


@api_router.post("/shopping/lists")
async def create_shopping_list(body: ShoppingListBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    now = now_iso()
    lst = ShoppingList(id=new_id(), user_id=user["_id"], name=body.name,
                       budget=round(body.budget, 2) if body.budget is not None else None,
                       archived=False, created_at=now, updated_at=now)
    db.add(lst)
    await db.flush()

    if body.duplicate_of:
        source = (await db.execute(
            select(ShoppingList).where(
                ShoppingList.id == body.duplicate_of,
                ShoppingList.user_id == user["_id"],
            )
        )).scalar_one_or_none()
        if source:
            items = (await db.execute(
                select(ShoppingItem).where(
                    ShoppingItem.list_id == source.id,
                    ShoppingItem.user_id == user["_id"],
                    ShoppingItem.bought == False,
                )
            )).scalars().all()
            for it in items:
                db.add(ShoppingItem(
                    id=new_id(), user_id=user["_id"], list_id=lst.id,
                    name=it.name, name_lower=it.name_lower, category=it.category,
                    quantity=it.quantity, unit=it.unit,
                    estimated_price=it.estimated_price, store=it.store,
                    storage_location=it.storage_location, product_id=it.product_id,
                    note=it.note or "", bought=False, selected=False,
                    sort_order=it.sort_order, created_at=now))

    await db.commit()
    await db.refresh(lst)
    return to_dict(lst)


@api_router.put("/shopping/lists/{lid}")
async def update_shopping_list(lid: str, body: ShoppingListUpdate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    lst = (await db.execute(
        select(ShoppingList).where(ShoppingList.id == lid, ShoppingList.user_id == user["_id"])
    )).scalar_one_or_none()
    if not lst:
        raise HTTPException(404, "List not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "budget" in updates:
        updates["budget"] = round(updates["budget"], 2)
    elif "budget" in body.model_fields_set:
        updates["budget"] = None  # an explicit null clears the budget ("no budget")
    if updates:
        updates["updated_at"] = now_iso()
        await db.execute(update(ShoppingList).where(ShoppingList.id == lid, ShoppingList.user_id == user["_id"]).values(**updates))
        await db.commit()
        await db.refresh(lst)
    return to_dict(lst)


@api_router.delete("/shopping/lists/{lid}")
async def delete_shopping_list(lid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    lst = (await db.execute(
        select(ShoppingList).where(ShoppingList.id == lid, ShoppingList.user_id == user["_id"])
    )).scalar_one_or_none()
    if not lst:
        raise HTTPException(404, "List not found")
    await db.execute(delete(ShoppingItem).where(ShoppingItem.list_id == lid, ShoppingItem.user_id == user["_id"]))
    await db.execute(delete(ShoppingList).where(ShoppingList.id == lid, ShoppingList.user_id == user["_id"]))
    await db.commit()
    return {"ok": True}


@api_router.post("/shopping")
async def post_shopping(body: ShoppingBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await add_shopping_item_doc(
        db, body.name, body.quantity, body.unit, body.note, user_id=user["_id"],
        list_id=body.list_id, category=body.category, estimated_price=body.estimated_price,
        store=body.store, sort_order=body.sort_order,
        storage_location=body.storage_location, product_id=body.product_id,
    )


@api_router.put("/shopping/{sid}")
async def update_shopping_item(sid: str, body: ShoppingItemUpdate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    it = (await db.execute(
        select(ShoppingItem).options(selectinload(ShoppingItem.list))
        .where(ShoppingItem.id == sid, ShoppingItem.user_id == user["_id"])
    )).scalar_one_or_none()
    if not it:
        raise HTTPException(404, "Item not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "name" in updates:
        updates["name_lower"] = updates["name"].lower()
    if updates:
        await db.execute(update(ShoppingItem).where(ShoppingItem.id == sid, ShoppingItem.user_id == user["_id"]).values(**updates))
        await db.commit()
        await db.refresh(it)
    return {**to_dict(it), "list": to_dict(it.list) if it.list else None}


@api_router.delete("/shopping/{sid}")
async def delete_shopping_item(sid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(ShoppingItem).where(ShoppingItem.id == sid, ShoppingItem.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Item not found")
    return {"ok": True}


@api_router.post("/shopping/{sid}/toggle")
async def toggle_shopping_item(sid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    it = (await db.execute(
        select(ShoppingItem).options(selectinload(ShoppingItem.list))
        .where(ShoppingItem.id == sid, ShoppingItem.user_id == user["_id"])
    )).scalar_one_or_none()
    if not it:
        raise HTTPException(404, "Item not found")
    it.selected = not it.selected
    await db.commit()
    await db.refresh(it)
    return {**to_dict(it), "list": to_dict(it.list) if it.list else None}


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


@api_router.post("/shopping/bulk-delete")
async def bulk_delete_shopping(body: dict, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ids = body.get("ids", [])
    if not ids:
        return {"deleted": 0}
    result = await db.execute(
        delete(ShoppingItem).where(ShoppingItem.id.in_(ids), ShoppingItem.user_id == user["_id"])
    )
    await db.commit()
    return {"deleted": result.rowcount}


@api_router.post("/shopping/bulk-update")
async def bulk_update_shopping(body: dict, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ids = body.get("ids", [])
    updates = body.get("updates", {})
    if not ids:
        return {"updated": 0}
    allowed = {"selected", "list_id", "category", "store", "storage_location"}
    safe = {k: v for k, v in updates.items() if k in allowed}
    if not safe:
        return {"updated": 0}
    result = await db.execute(
        update(ShoppingItem).where(ShoppingItem.id.in_(ids), ShoppingItem.user_id == user["_id"]).values(**safe)
    )
    await db.commit()
    return {"updated": result.rowcount}


async def _upsert_grocery_from_purchase(db: AsyncSession, user_id: str, name: str, quantity: float,
                                        unit: str, category: Optional[str], price: Optional[float],
                                        store: Optional[str],
                                        storage_location: Optional[str] = None) -> dict:
    """Add or update grocery inventory inside an existing transaction."""
    name_lower = name.lower()
    existing = (await db.execute(
        select(Grocery).where(Grocery.name_lower == name_lower, Grocery.user_id == user_id)
    )).scalar_one_or_none()

    if store and price is not None:
        pr = PriceRecord(id=new_id(), user_id=user_id, name=name, name_lower=name_lower, store=store,
                         price=round(float(price), 2), unit=unit or "unit",
                         date=datetime.now(timezone.utc).strftime("%Y-%m-%d"), created_at=now_iso())
        db.add(pr)

    if existing:
        existing.quantity = round(float(existing.quantity) + quantity, 2)
        existing.purchase_count = int(existing.purchase_count or 0) + 1
        if price is not None:
            existing.price = price
        if store:
            existing.store = store
        if category:
            existing.category = category
        if storage_location:
            existing.storage_location = storage_location
        existing.updated_at = now_iso()
        await db.flush()
        return to_dict(existing)

    g = Grocery(id=new_id(), user_id=user_id, name=name, name_lower=name_lower,
                quantity=round(float(quantity), 2), unit=unit or "unit", category=category or "Other",
                storage_location=storage_location or "pantry",
                price=price, store=store, low_threshold=0, notes="",
                is_favorite=False, purchase_count=1,
                created_at=now_iso(), updated_at=now_iso())
    db.add(g)
    await db.flush()
    return to_dict(g)


@api_router.post("/shopping/lists/{lid}/submit")
async def submit_purchase(lid: str, body: SubmitPurchaseBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Submit selected shopping items as a purchase. Only selected items update inventory."""
    item_ids = [p.item_id for p in body.items]
    if not item_ids:
        raise HTTPException(400, "No items selected")

    items = (await db.execute(
        select(ShoppingItem).where(
            ShoppingItem.id.in_(item_ids),
            ShoppingItem.user_id == user["_id"],
            ShoppingItem.list_id == lid,
            ShoppingItem.bought == False,
        )
    )).scalars().all()

    if len(items) != len(item_ids):
        raise HTTPException(400, "Some items were not found or already purchased")

    item_map = {p.item_id: p for p in body.items}
    now = now_iso()
    purchased = []
    total_cost = 0.0

    try:
        for it in items:
            p = item_map[it.id]
            qty = p.quantity if p.quantity is not None else float(it.quantity)
            price = p.actual_price if p.actual_price is not None else (float(it.actual_price) if it.actual_price else None)
            store = p.store or body.store or it.store
            storage_location = it.storage_location

            await _upsert_grocery_from_purchase(db, user["_id"], it.name, qty, it.unit or "unit",
                                                it.category, price, store, storage_location)

            it.bought = True
            it.selected = False
            it.completed_at = now
            it.actual_price = price
            purchased.append({"id": it.id, "name": it.name, "quantity": qty, "price": price, "store": store,
                              "storage_location": storage_location})
            if price:
                total_cost = round(total_cost + (price * qty), 2)

        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("submit_purchase failed")
        raise HTTPException(500, f"Failed to update inventory: {exc}")

    # Optionally record as expense
    expense = None
    if body.record_expense and total_cost > 0:
        try:
            acc = await resolve_account(db, body.payment_account or "revolut", user["_id"])
            account_id = acc.id if acc else (body.payment_account or "revolut")
            expense_body = ExpenseBody(
                amount=total_cost, merchant=body.store or "Grocery purchase",
                description=f"Shopping list purchase ({len(purchased)} items)",
                category="Groceries", account=account_id,
                date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                participants=["Me"],
            )
            expense = await create_expense_record(db, expense_body, user["_id"])
        except Exception:
            logger.exception("submit_purchase expense recording failed")

    return {"purchased": purchased, "total_cost": total_cost, "expense": expense}


@api_router.post("/shopping/generate")
async def gen_shopping(days: int = 7, list_id: Optional[str] = None, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await generate_shopping_doc(db, days, user_id=user["_id"], list_id=list_id)


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
# Recurring shopping lists
# ---------------------------------------------------------------------------
@api_router.get("/shopping/recurring")
async def get_recurring_lists(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(RecurringList).where(RecurringList.user_id == user["_id"]).order_by(desc(RecurringList.created_at))
    )).scalars().all()
    return [to_dict(r) for r in rows]


@api_router.post("/shopping/recurring")
async def create_recurring_list(body: RecurringListBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    now = now_iso()
    rl = RecurringList(
        id=new_id(), user_id=user["_id"], name=body.name, schedule=body.schedule,
        items=[i.model_dump() for i in body.items], created_at=now, updated_at=now)
    db.add(rl)
    await db.commit()
    await db.refresh(rl)
    return to_dict(rl)


@api_router.put("/shopping/recurring/{rid}")
async def update_recurring_list(rid: str, body: RecurringListUpdate, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rl = (await db.execute(
        select(RecurringList).where(RecurringList.id == rid, RecurringList.user_id == user["_id"])
    )).scalar_one_or_none()
    if not rl:
        raise HTTPException(404, "Recurring list not found")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "items" in updates:
        updates["items"] = [i.model_dump() for i in updates["items"]]
    if updates:
        updates["updated_at"] = now_iso()
        await db.execute(update(RecurringList).where(RecurringList.id == rid, RecurringList.user_id == user["_id"]).values(**updates))
        await db.commit()
        await db.refresh(rl)
    return to_dict(rl)


@api_router.delete("/shopping/recurring/{rid}")
async def delete_recurring_list(rid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(RecurringList).where(RecurringList.id == rid, RecurringList.user_id == user["_id"]))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Recurring list not found")
    return {"ok": True}


@api_router.post("/shopping/recurring/{rid}/spawn")
async def spawn_recurring_list(rid: str, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rl = (await db.execute(
        select(RecurringList).where(RecurringList.id == rid, RecurringList.user_id == user["_id"])
    )).scalar_one_or_none()
    if not rl:
        raise HTTPException(404, "Recurring list not found")
    now = now_iso()
    lst = ShoppingList(id=new_id(), user_id=user["_id"], name=rl.name, budget=None, archived=False, created_at=now, updated_at=now)
    db.add(lst)
    await db.flush()
    for it in (rl.items or []):
        db.add(ShoppingItem(
            id=new_id(), user_id=user["_id"], list_id=lst.id, name=it["name"],
            name_lower=it["name"].lower(), category=it.get("category"),
            quantity=it.get("quantity", 1), unit=it.get("unit", "unit"),
            estimated_price=it.get("estimated_price"), bought=False, selected=False,
            created_at=now))
    rl.last_spawned_at = now
    await db.commit()
    return {"list": to_dict(lst), "spawned": len(rl.items or [])}


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


@api_router.put("/recipes/{rid}")
async def update_recipe(rid: str, body: RecipeBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = (await db.execute(select(Recipe).where(Recipe.id == rid, Recipe.user_id == user["_id"]))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Recipe not found")
    updates = body.model_dump()  # ingredients are already plain dicts here
    await db.execute(update(Recipe).where(Recipe.id == rid, Recipe.user_id == user["_id"]).values(**updates))
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


class MissingIngredient(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    quantity: float = Field(..., gt=0, le=100000)
    unit: str = Field(default="unit", max_length=50)


class AddMissingBody(BaseModel):
    list_id: Optional[str] = Field(default=None, max_length=36)
    items: Optional[List[MissingIngredient]] = None


@api_router.get("/recipes/suggestions")
async def recipe_suggestions(limit: int = Query(default=20, ge=1, le=100), user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Recipes ranked by what you can cook now, with missing ingredients and what would help avoid waste."""
    recipes = [to_dict(r) for r in (await db.execute(_user_owned_query(Recipe, user))).scalars().all()]
    inventory = [to_dict(g) for g in (await db.execute(_user_owned_query(Grocery, user))).scalars().all()]
    return kitchen_logic.suggest(recipes, inventory)[:limit]


@api_router.post("/recipes/{rid}/add-missing")
async def add_missing_to_list(rid: str, body: AddMissingBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Put a recipe's missing ingredients on a shopping list (quantities can be edited). Never touches inventory."""
    r = (await db.execute(select(Recipe).where(Recipe.id == rid, Recipe.user_id == user["_id"]))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Recipe not found")
    if body.list_id:
        lst = (await db.execute(select(ShoppingList).where(ShoppingList.id == body.list_id, ShoppingList.user_id == user["_id"]))).scalar_one_or_none()
        if not lst:
            raise HTTPException(404, "List not found")
    if body.items is not None:
        wanted = [{"name": i.name, "quantity": i.quantity, "unit": i.unit} for i in body.items]
    else:
        inventory = [to_dict(g) for g in (await db.execute(_user_owned_query(Grocery, user))).scalars().all()]
        wanted = kitchen_logic.evaluate_recipe(to_dict(r), inventory)["missing"]
    added = []
    for w in wanted:
        added.append(await add_shopping_item_doc(db, w["name"], w["quantity"], w["unit"], note=f"For {r.name}",
                                                 user_id=user["_id"], list_id=body.list_id))
    return {"added": added, "count": len(added), "list_id": body.list_id}


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
            "account": {"type": "string", "description": "Account id, name or 'cash'/'revolut'"},
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
        "name": "record_income",
        "description": "Record income or money received (e.g. salary, refund, gift).",
        "parameters": {"type": "object", "properties": {
            "amount": {"type": "number"}, "description": {"type": "string"},
            "account": {"type": "string", "description": "Account id, name or 'cash'/'revolut'"},
            "date": {"type": "string", "description": "yyyy-mm-dd, default today"},
        }, "required": ["amount"]},
    }},
    {"type": "function", "function": {
        "name": "record_payment",
        "description": "Record a reimbursement/settlement. direction 'in' = a person paid Sá back; 'out' = Sá paid someone.",
        "parameters": {"type": "object", "properties": {
            "person": {"type": "string"}, "amount": {"type": "number"},
            "method": {"type": "string", "enum": ["MB WAY", "Revolut", "Cash"]},
            "account": {"type": "string", "description": "Account id, name or 'cash'/'revolut'"},
            "direction": {"type": "string", "enum": ["in", "out"]},
        }, "required": ["person", "amount"]},
    }},
    {"type": "function", "function": {
        "name": "create_person",
        "description": "Add a new person/contact.",
        "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "get_groceries",
        "description": "Get grocery inventory items with id, stock, unit, category, storage_location, expiration, price and low-stock status. Optionally filter by storage_location (name or kind, e.g. Fridge).",
        "parameters": {"type": "object", "properties": {"storage_location": {"type": "string"}}},
    }},
    {"type": "function", "function": {
        "name": "add_grocery",
        "description": "Add a grocery item to inventory with optional price, store, storage location and expiry date. Adding an item that already exists increases its quantity.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "quantity": {"type": "number"}, "unit": {"type": "string"},
            "category": {"type": "string"}, "price": {"type": "number"}, "store": {"type": "string"},
            "storage_location": {"type": "string", "description": "Name or kind of a storage location, e.g. Fridge, Freezer, Pantry"},
            "expiration": {"type": "string", "description": "Use-by date, YYYY-MM-DD"},
            "low_threshold": {"type": "number", "description": "Warn when stock falls at or below this quantity"}},
            "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "get_shopping_lists",
        "description": "Get all shopping lists and their outstanding items. Includes selection state for cart workflow.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "create_shopping_list",
        "description": "Create a new empty shopping list.",
        "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "add_shopping_item",
        "description": "Add an item to a shopping list. Does NOT change inventory.",
        "parameters": {"type": "object", "properties": {
            "list_id": {"type": "string"}, "name": {"type": "string"}, "quantity": {"type": "number"},
            "unit": {"type": "string"}, "category": {"type": "string"}, "estimated_price": {"type": "number"},
            "store": {"type": "string"}, "note": {"type": "string"}},
            "required": ["list_id", "name"]},
    }},
    {"type": "function", "function": {
        "name": "update_shopping_item",
        "description": "Update a shopping list item by id: quantity, unit, category, estimated_price, store, note, selected state, etc.",
        "parameters": {"type": "object", "properties": {
            "item_id": {"type": "string"}, "name": {"type": "string"}, "quantity": {"type": "number"},
            "unit": {"type": "string"}, "category": {"type": "string"}, "estimated_price": {"type": "number"},
            "actual_price": {"type": "number"}, "store": {"type": "string"}, "note": {"type": "string"},
            "selected": {"type": "boolean"}},
            "required": ["item_id"]},
    }},
    {"type": "function", "function": {
        "name": "delete_shopping_item",
        "description": "Remove an item from a shopping list. Destructive: confirm first.",
        "parameters": {"type": "object", "properties": {
            "item_id": {"type": "string"}, "confirm": {"type": "boolean"}}, "required": ["item_id"]},
    }},
    {"type": "function", "function": {
        "name": "submit_purchase",
        "description": "Submit selected shopping-list items as a purchase. This updates inventory and optionally records an expense. Only selected items are purchased; unselected items remain on the list. Destructive/Financial: call first WITHOUT confirm to preview, then only call again with confirm=true after the user explicitly agrees.",
        "parameters": {"type": "object", "properties": {
            "list_id": {"type": "string"}, "items": {"type": "array", "items": {"type": "object", "properties": {
                "item_id": {"type": "string"}, "quantity": {"type": "number"}, "actual_price": {"type": "number"}, "store": {"type": "string"}}}},
            "store": {"type": "string"}, "record_expense": {"type": "boolean"}, "payment_account": {"type": "string"}, "confirm": {"type": "boolean"}},
            "required": ["list_id", "items"]},
    }},
    {"type": "function", "function": {
        "name": "get_grocery_summary",
        "description": "Get a summary of grocery inventory, low/out-of-stock items, active shopping lists, pending items and budgets.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "set_shopping_list_budget",
        "description": "Set or clear the budget for a shopping list.",
        "parameters": {"type": "object", "properties": {
            "list_id": {"type": "string"}, "budget": {"type": "number", "description": "Set to null/omit to clear budget"}},
            "required": ["list_id"]},
    }},
    {"type": "function", "function": {
        "name": "get_price_history",
        "description": "Get historical prices for a grocery item across stores.",
        "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "get_grocery_suggestions",
        "description": "Get frequently bought or favorite grocery suggestions that are not already on a shopping list.",
        "parameters": {"type": "object", "properties": {"limit": {"type": "number"}}},
    }},
    {"type": "function", "function": {
        "name": "get_recurring_lists",
        "description": "Get recurring shopping list templates.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "create_recurring_list",
        "description": "Create a recurring shopping list template with items and a schedule (weekly/biweekly/monthly).",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "schedule": {"type": "string", "enum": ["weekly", "biweekly", "monthly"]},
            "items": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"}, "quantity": {"type": "number"}, "unit": {"type": "string"}, "category": {"type": "string"}, "estimated_price": {"type": "number"}}}}},
            "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "spawn_recurring_list",
        "description": "Spawn a shopping list from a recurring template now.",
        "parameters": {"type": "object", "properties": {"recurring_list_id": {"type": "string"}}, "required": ["recurring_list_id"]},
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
            "category": {"type": "string"}, "payment_method": {"type": "string", "description": "Account id, name or 'cash'/'card'/'revolut'"},
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
            "account": {"type": "string", "description": "Account id, name or 'cash'/'revolut'"}}, "required": ["person", "amount"]},
    }},
    {"type": "function", "function": {
        "name": "update_grocery",
        "description": "Update a grocery inventory item by name: set quantity/stock, price, unit, category, low_threshold, notes, expiration (YYYY-MM-DD) or storage_location.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "quantity": {"type": "number"}, "price": {"type": "number"},
            "expiration": {"type": "string"}, "storage_location": {"type": "string"},
            "unit": {"type": "string"}, "category": {"type": "string"}, "low_threshold": {"type": "number"},
            "notes": {"type": "string"}}, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "generate_shopping_list",
        "description": "Build a shopping list from current inventory (low/out of stock) and the owner's usual buys, then return price intelligence and the cheaper store recommendation. Optionally target a specific list_id.",
        "parameters": {"type": "object", "properties": {"days": {"type": "number"}, "list_id": {"type": "string"}}},
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
    {"type": "function", "function": {
        "name": "transfer_money",
        "description": "Move money between the user's own accounts/places, e.g. withdrawing cash from the bank or moving money from Revolut to cash.",
        "parameters": {"type": "object", "properties": {
            "from_account": {"type": "string", "description": "Source account id, name or 'bank'/'cash'/'revolut'"},
            "to_account": {"type": "string", "description": "Destination account id, name or 'bank'/'cash'/'revolut'"},
            "amount": {"type": "number"}, "date": {"type": "string"}, "note": {"type": "string"}},
            "required": ["from_account", "to_account", "amount"]},
    }},
    {"type": "function", "function": {
        "name": "update_account_balance",
        "description": "Correct/set the balance of a money place/account to an exact figure (e.g. 'my Revolut is actually 39.16'). Do NOT use this when the user received or spent money: use record_income, create_expense or transfer_money so it appears in the transaction history. For the bank account you can also set the initial balance used to calculate money that left the bank.",
        "parameters": {"type": "object", "properties": {
            "account": {"type": "string", "description": "Account id, name or 'bank'/'cash'/'revolut'"},
            "balance": {"type": "number", "description": "New current balance"},
            "initial_balance": {"type": "number", "description": "For bank only: the starting bank balance"}},
            "required": ["account", "balance"]},
    }},
    {"type": "function", "function": {
        "name": "get_accounts",
        "description": "Get all money accounts and their current balances. Use each account's `balance` as the real current balance (not `opening_balance`). Spaces/places have a parent_id pointing at Money in hand or Revolut.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "create_money_space",
        "description": "Create a new space/place inside Money in hand (e.g. a new envelope) or inside Revolut (e.g. savings, vault, trip pocket). Optionally give it a starting balance and mark it locked (not freely available).",
        "parameters": {"type": "object", "properties": {
            "parent": {"type": "string", "description": "'cash' / 'money in hand' or 'revolut'"},
            "name": {"type": "string"},
            "balance": {"type": "number", "description": "Starting balance, default 0"},
            "is_locked": {"type": "boolean", "description": "True if the money isn't freely available"}},
            "required": ["parent", "name"]},
    }},
    {"type": "function", "function": {
        "name": "update_money_space",
        "description": "Rename a space/place, lock or unlock it, or hide it. Use update_account_balance to change its balance.",
        "parameters": {"type": "object", "properties": {
            "account": {"type": "string", "description": "Account id or name of the space"},
            "name": {"type": "string"}, "is_locked": {"type": "boolean"}, "is_active": {"type": "boolean"}},
            "required": ["account"]},
    }},
    {"type": "function", "function": {
        "name": "delete_money_space",
        "description": "Delete a space/place. Only works when it has no transactions; otherwise suggest transferring its money elsewhere and hiding it. Ask the user to confirm first.",
        "parameters": {"type": "object", "properties": {
            "account": {"type": "string", "description": "Account id or name of the space"}},
            "required": ["account"]},
    }},
    {"type": "function", "function": {
        "name": "get_products",
        "description": "Search the product catalog by keyword. Returns matching products with category, default unit and nutrition info.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}}, "required": ["query"]},
    }},
    {"type": "function", "function": {
        "name": "add_product",
        "description": "Add a new reusable product to the catalog.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "category": {"type": "string"},
            "subcategory": {"type": "string", "description": "e.g. Poultry, Cheese, Leafy greens"},
            "default_unit": {"type": "string"}, "typical_quantity": {"type": "number"},
            "synonyms": {"type": "array", "items": {"type": "string"}},
            "tags": {"type": "array", "items": {"type": "string", "enum": ["vegan", "vegetarian", "gluten-free", "lactose-free"]}},
            "icon": {"type": "string", "description": "A single emoji"},
            "nutrition": {"type": "object"}, "is_favorite": {"type": "boolean"}},
            "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "update_grocery_storage",
        "description": "Move a grocery inventory item to a different storage location (e.g. fridge, pantry, freezer). Identify the item by grocery_id or name.",
        "parameters": {"type": "object", "properties": {
            "grocery_id": {"type": "string"}, "name": {"type": "string"}, "storage_location": {"type": "string"}},
            "required": ["storage_location"]},
    }},
    {"type": "function", "function": {
        "name": "consume_grocery",
        "description": "Reduce grocery quantity because it was used/consumed. Identify the item by grocery_id or name.",
        "parameters": {"type": "object", "properties": {
            "grocery_id": {"type": "string"}, "name": {"type": "string"}, "quantity": {"type": "number"}},
            "required": ["quantity"]},
    }},
    {"type": "function", "function": {
        "name": "discard_grocery",
        "description": "Throw away / remove an inventory item (spoiled, expired, or no longer wanted); omit quantity to remove all of it. Destructive: call first WITHOUT confirm to preview, then only call again with confirm=true after the user explicitly agrees. Use consume_grocery instead for food that was eaten or used.",
        "parameters": {"type": "object", "properties": {
            "grocery_id": {"type": "string"}, "name": {"type": "string"}, "quantity": {"type": "number"},
            "confirm": {"type": "boolean"}}},
    }},
    {"type": "function", "function": {
        "name": "update_storage_location",
        "description": "Rename a storage location or change its kind (fridge, freezer, pantry, custom). Items stored there stay attached after a rename.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string", "description": "Current name of the location"},
            "new_name": {"type": "string"}, "kind": {"type": "string", "enum": ["fridge", "pantry", "freezer", "custom"]}},
            "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "get_kitchen_overview",
        "description": "Read-only snapshot of the whole kitchen: every storage location with its items, plus items that are expired, expiring within 3 days, low or out of stock, and items stored in an unconfigured place. Use it to answer 'what is in my fridge', 'what should I use up' or to suggest where foods should be stored or replenished.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_expiring_items",
        "description": "List grocery items expiring within a number of days (default 7).",
        "parameters": {"type": "object", "properties": {"days": {"type": "number"}}},
    }},
    {"type": "function", "function": {
        "name": "get_storage_locations",
        "description": "List the user's storage locations (fridge, pantry, freezer, custom).",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "add_storage_location",
        "description": "Create a custom storage location.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "kind": {"type": "string", "enum": ["fridge", "pantry", "freezer", "custom"]},
            "icon": {"type": "string"}, "sort_order": {"type": "number"}},
            "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "get_appliances",
        "description": "List the user's kitchen appliances.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "add_appliance",
        "description": "Add a kitchen appliance.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "kind": {"type": "string", "enum": ["oven", "microwave", "air_fryer", "blender", "other"]},
            "icon": {"type": "string"}, "notes": {"type": "string"}},
            "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "suggest_recipes_from_inventory",
        "description": "Rank the user's recipes by what can be cooked from current inventory: coverage, missing ingredients (with the shortfall quantity) and which ingredients are about to expire. Read-only.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "add_missing_ingredients",
        "description": "Add a recipe's missing ingredients to a shopping list (not a purchase; inventory is unchanged). Optionally pass items to override names/quantities.",
        "parameters": {"type": "object", "properties": {
            "recipe_id": {"type": "string"}, "list_id": {"type": "string"},
            "items": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"}, "quantity": {"type": "number"}, "unit": {"type": "string"}}}}},
            "required": ["recipe_id"]},
    }},
]
AI_TOOLS += ai_tools_extra.EXTRA_TOOLS

AI_SYSTEM ="""You are Life Record's personal assistant, a friendly multi-user life-management helper.
You turn natural language into structured, connected data by calling tools. You handle money/expenses, shared expenses and reimbursements, groceries, meals/nutrition, workouts, weight and tasks for the current user.

Rules:
- When the user refers to themselves, use the participant name "Me".
- Accounts are dynamic: bank account, money-in-hand (with sub-places like wallet, envelope, coin pouch), and Revolut (which can have spaces such as savings or a vault). Locked spaces (is_locked) are not available money: when asked what the user has or can spend, use cash_available, revolut and total_available, and mention locked amounts (cash_locked, revolut_locked) separately. Each account has a `balance` field, which is the real current balance; `opening_balance` is only the starting amount, so never quote it as the balance. Any money received, spent or moved must be recorded with record_income / create_expense / transfer_money so it shows in the transaction history; only use update_account_balance to correct a balance to a known figure. Spaces can be created, renamed, locked and deleted with create_money_space / update_money_space / delete_money_space; setting a balance with update_account_balance works even if the account has no transactions. When the user mentions an account (including a space such as "savings" or "wallet"), pass its name/ID directly; you do not need to map to "cash"/"revolut" unless they explicitly say so.
- For shared expenses, figure out each person's share. If items are assigned to specific people, use split_mode "items" with the items array. If the split is equal, use split_mode "equal". Never fabricate amounts you weren't given.
- To change an existing expense use update_expense; to remove one use delete_expense (preview first, then confirm). To record income/money received use record_income. To record a refund use mark_refunded (or record_payment for a general person payment).
- To move money between the user's own places (e.g. "I withdrew 50€ from the bank") use transfer_money. To correct a balance or set the bank's initial balance use update_account_balance.
- Actual spending is calculated as: money that left the bank (initial bank balance - current bank balance) minus money still in hand (cash + Revolut). Do not double-count transfers between the user's own accounts as spending.
- Groceries: use get_groceries to inspect inventory and get_shopping_lists for lists. Adding a grocery (add_grocery) puts it in inventory. Adding a shopping item (add_shopping_item) only puts it on a list; it never changes inventory. To update inventory from a list, use submit_purchase and only selected items will be purchased. Generating a list (generate_shopping_list) creates suggestions, not purchases. Use get_grocery_suggestions for frequently bought items, get_price_history for prices, and create_recurring_list/spawn_recurring_list for recurring lists. Use get_products/add_product for the reusable product catalog, get_storage_locations/add_storage_location for storage places, and update_grocery_storage/consume_grocery/get_expiring_items to manage inventory location and usage. Use get_kitchen_overview to look across the whole kitchen (what is where, what is expiring, what is low); suggest better storage places or replenishment from it, and only move or change things after the user agrees. Use consume_grocery for food that was eaten and discard_grocery (preview first, then confirm) for food that is thrown away; update_storage_location renames or retypes a storage space. Pass storage_location and expiration (YYYY-MM-DD) to add_grocery/update_grocery when the user says where something is kept or when it expires. If a tool returns an error or needs_confirmation, say so plainly and never claim the change was made. Use suggest_recipes_from_inventory and add_missing_ingredients for recipe planning.
- NEVER invent expenses, refunds, prices, grocery prices, or totals. If you don't have a value, say it is unknown and ask.
- If something is genuinely ambiguous and financially important (who to split with, or an amount), ASK a short clarifying question instead of guessing.
- For destructive actions (delete, large bulk changes) always confirm with the user first.
- For nutrition you MAY estimate calories/macros from typical food values, but say they are estimates.
- Other pages: get_overview gives the whole day at a glance (Home); get_transactions searches the ledger; get_tasks lists tasks and calendar reminders (a due date is a calendar entry) and update_task / delete_task change them; get_people, update_person, delete_person manage contacts; get_categories and create/update/delete_category manage categories and monthly budgets; get_meals, update_meal, delete_meal and get_recipes / delete_recipe cover nutrition; get_workouts, delete_workout, get_weight_history and delete_weight_entry cover fitness and body. Look things up with a get_ tool before you change or delete them, and use the ids it returns. Deleting always needs a preview and the user's confirmation on a later message: when the user agrees to a previewed deletion, call the same tool again with confirm=true straight away (do not preview a second time). Call every lookup you need in one step rather than one at a time.
- Context: use the conversation and the "Context" notes below to resolve references such as "that expense", "it", "the rest" or "the remaining money". If the reference could match more than one record, or the change moves money, ask one short question instead of guessing. Never state a figure you did not get from a tool result or the user; do not do arithmetic on money yourself when a tool can return the number.
- Honesty: say a change was made only if its tool returned success. If a tool returned an error or needs_confirmation, say that plainly.
- After performing actions, give a concise summary of exactly what changed (amounts, shares, refunds, remaining owed, inventory). Be warm but brief.

Formatting (the chat renders Markdown):
- Write money as €14.00: the symbol first, two decimals, a comma for thousands (€1,250.00). Never write 14.00€ or 14 euros.
- Never wrap amounts, numbers, dates or units in ** or backticks. Do not bold figures. Use bold only for a short label or a name when it really helps, never next to a currency symbol.
- Keep answers short: a sentence or two, then a bulleted list if there are several items. Use a table only when comparing three or more rows with two or more columns. Dates read like 23 Oct 2026. No emojis. Do not show internal ids.
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


def build_gemini_tools(tools: Optional[list] = None):
    from google.genai import types
    declarations = []
    for t in (AI_TOOLS if tools is None else tools):
        fn = t["function"]
        declarations.append(types.FunctionDeclaration(
            name=fn["name"],
            description=fn["description"],
            parameters=types.Schema(**fn["parameters"]),
        ))
    return [types.Tool(function_declarations=declarations)]


def _json_default(o):
    from decimal import Decimal
    return float(o) if isinstance(o, Decimal) else str(o)


def _safe_json(obj):
    return json.dumps(obj, default=_json_default)


def _json_clean(obj):
    """Round-trip through JSON so tool results (Decimals, dates...) are always serialisable for the model."""
    return json.loads(json.dumps(obj, default=_json_default))


def _tool_response(result) -> dict:
    """A function response must be an object; tools that return a list are wrapped."""
    clean = _json_clean(result)
    return clean if isinstance(clean, dict) else {"result": clean}


# Short notes about what the assistant just did, per conversation, so "that transaction" or "the remaining
# money" can be resolved on the next turn (the chat history only keeps plain text, not tool results).
_session_notes: Dict[str, List[str]] = {}
_MAX_NOTES = 8


def _remember_tool(session_id: str, name: str, args: dict, result) -> None:
    if not isinstance(result, dict) or result.get("error") or result.get("needs_confirmation"):
        return
    if name.startswith("get_") or name == "suggest_recipes_from_inventory":
        return
    brief = {k: v for k, v in args.items() if k != "confirm" and not isinstance(v, (list, dict))}
    keep = ("id", "amount", "gross_amount", "merchant", "name", "title", "deleted", "balance", "date")
    out = {k: v for k, v in result.items() if k in keep and not isinstance(v, (list, dict))}
    txn = result.get("transaction")
    if isinstance(txn, dict):
        out.update({k: txn.get(k) for k in ("id", "gross_amount", "merchant", "date") if txn.get(k) is not None})
    notes = _session_notes.setdefault(session_id, [])
    notes.append(f"{name} {_safe_json(brief)[:200]} -> {_safe_json(out)[:240]}")
    del notes[:-_MAX_NOTES]
    if len(_session_notes) > 500:
        _session_notes.pop(next(iter(_session_notes)))


def _system_text(user: Optional[dict] = None, page: Optional[str] = None, session_id: Optional[str] = None):
    now = datetime.now(timezone.utc)
    text = AI_SYSTEM.replace("{today}", now.strftime("%Y-%m-%d (%A)"))
    ctx = []
    if user and user.get("name"):
        ctx.append(f"The user's name is {user['name']}.")
    page = re.sub(r"[^a-z ]", "", (page or "").lower())[:30]
    if page:
        ctx.append(f"They are currently on the {page} page.")
    notes = _session_notes.get(session_id or "")
    if notes:
        ctx.append("Changes you made earlier in this conversation (use them to resolve 'that', 'it', 'the rest'):\n- " + "\n- ".join(notes))
    return text + ("\nContext:\n" + "\n".join(ctx) if ctx else "")


def _text_part(text: str):
    from google.genai import types
    return types.Part(text=text)


def _image_part(b64_data_url: str):
    from google.genai import types
    data = __import__("base64").b64decode(b64_data_url.split(",")[-1])
    return types.Part.from_bytes(data=data, mime_type=chat_images.sniff(data) or "image/jpeg")


async def _gemini_stream(contents, config, timeout: float, operation: str):
    """Stream a Gemini reply, trying the configured models in order until one starts answering.

    Yields response chunks. Fallback only happens before the first chunk; once text is flowing the model is
    fixed. A stall of `timeout` seconds between chunks ends the attempt.
    """
    client = gemini_client()
    last_error: Optional[Exception] = None
    for model in _gemini_models_to_try():
        try:
            stream = await asyncio.wait_for(
                client.aio.models.generate_content_stream(model=model, contents=contents, config=config), timeout=timeout)
            it = stream.__aiter__()
            first = await asyncio.wait_for(it.__anext__(), timeout=timeout)
        except StopAsyncIteration:
            return
        except asyncio.TimeoutError as exc:
            last_error = exc
            logger.warning("%s timed out on model %s", operation, model)
            continue
        except Exception as exc:
            last_error = exc
            if _is_retryable_gemini_error(exc):
                logger.warning("%s failed on model %s: %s", operation, model, exc)
                if GEMINI_FALLBACK_DELAY > 0:
                    await asyncio.sleep(GEMINI_FALLBACK_DELAY)
                continue
            logger.exception("%s non-retryable error on model %s", operation, model)
            raise
        yield first
        while True:
            try:
                chunk = await asyncio.wait_for(it.__anext__(), timeout=timeout)
            except StopAsyncIteration:
                return
            yield chunk
    logger.error("%s exhausted all Gemini models", operation)
    if isinstance(last_error, asyncio.TimeoutError):
        raise HTTPException(504, "The assistant took too long to answer. Please try again.")
    raise HTTPException(503, "The assistant is busy right now. Please try again in a moment.")


AI_PROVIDER = os.environ.get("AI_PROVIDER", "opencode").strip().lower()
if AI_PROVIDER not in ("opencode", "gemini"):
    logger.warning("Unknown AI_PROVIDER %r; using opencode", AI_PROVIDER)
    AI_PROVIDER = "opencode"


def chat_unavailable() -> Optional[str]:
    """User-facing reason the chat provider cannot be used, or None when it is configured."""
    if AI_PROVIDER == "gemini":
        return None if GEMINI_API_KEY else "AI is not configured. Set GEMINI_API_KEY to enable the assistant."
    return None if ai_opencode.configured() else "AI is not configured. Set OPENCODE_API_KEY to enable the assistant."


async def _gemini_turn(items: list, system: str, tools: Optional[list] = None):
    """Gemini adapter: neutral conversation items in, ("text", s) / ("call", {...}) out."""
    from google.genai import types
    contents = []
    for it in items:
        if it["role"] == "user":
            parts = [_text_part(it["text"] or "")]
            if it.get("image"):
                parts.append(_image_part(it["image"]))
            contents.append(types.Content(role="user", parts=parts))
        elif it["role"] == "assistant":
            parts = [_text_part(it["text"])] if it.get("text") else []
            parts += [c.get("_raw") or types.Part(function_call=types.FunctionCall(name=c["name"], args=c["args"])) for c in it.get("calls", [])]
            contents.append(types.Content(role="model", parts=parts))
        else:
            contents.append(types.Content(role="user", parts=[
                types.Part.from_function_response(name=r["name"], response=r["response"]) for r in it["results"]]))
    config = types.GenerateContentConfig(system_instruction=system, tools=build_gemini_tools(tools) if tools != [] else None, temperature=0.2)
    timeout = int(os.environ.get("GEMINI_TIMEOUT_SECONDS", "25"))
    async for chunk in _gemini_stream(contents, config, timeout, "ai_chat"):
        if not chunk.candidates or not chunk.candidates[0].content or not chunk.candidates[0].content.parts:
            continue
        for part in chunk.candidates[0].content.parts:
            if part.function_call:
                yield ("call", {"id": new_id(), "name": part.function_call.name,
                                "args": dict(part.function_call.args) if part.function_call.args else {}, "_raw": part})
            elif part.text and not getattr(part, "thought", False):
                yield ("text", part.text)


async def _provider_stream(items: list, system: str, session_id: str, tools: Optional[list] = None):
    """One model turn from the configured chat provider, as ("text", s) / ("call", {id, name, args}) events.

    `tools` is a list of tool declarations; None means the assistant's full set and [] means no tools."""
    if AI_PROVIDER == "gemini":
        async for ev in _gemini_turn(items, system, tools):
            yield ev
    else:
        async for ev in ai_opencode.stream_turn(items, system, AI_TOOLS if tools is None else tools, session_id):
            yield ev


async def ai_chat_events(db: AsyncSession, user: dict, body: AIChatBody):
    """Run one assistant turn, yielding events: session, delta, tool, done or error.

    Tool calls go through `dispatch_tool`, so ownership checks, validation and confirmations are unchanged.
    """
    session_id = body.session_id or new_id()
    if await conversations_api.id_taken_by_someone_else(db, session_id, user["_id"]):
        session_id = new_id()  # never write into another user's conversation
    yield {"type": "session", "session_id": session_id}
    unavailable = chat_unavailable()
    if unavailable:
        yield {"type": "error", "message": unavailable}
        return
    image_bytes = image_mime = None
    if body.image_base64:
        try:
            image_bytes, image_mime = chat_images.decode(body.image_base64, MAX_UPLOAD_SIZE)
        except ValueError as exc:
            yield {"type": "error", "message": str(exc)}
            return

    history_rows = (await db.execute(
        select(AIMessage).where(AIMessage.session_id == session_id, AIMessage.user_id == user["_id"])
        .order_by(asc(AIMessage.created_at))
    )).scalars().all()

    system = _system_text(user, body.page, session_id)
    items = [{"role": "assistant" if h.role == "assistant" else "user", "text": h.text} for h in history_rows[-16:]]
    shown = f"data:{image_mime};base64,{__import__('base64').b64encode(image_bytes).decode()}" if image_bytes else None
    items.append({"role": "user", "text": body.message or "", "image": shown})

    created, tool_summary = [], []
    previewed_this_turn: set = set()
    reply = ""
    nudged = False
    failure: Optional[str] = None
    try:
        for step in range(7):
            calls, text_this_step = [], ""
            async for kind, value in _provider_stream(items, system, session_id):
                if kind == "text":
                    text_this_step += value
                    yield {"type": "delta", "text": value}
                else:
                    calls.append(value)
            reply += text_this_step
            if not calls:
                if not reply.strip() and tool_summary and not nudged:
                    # The model sometimes stops right after tool results without writing anything: ask once more.
                    nudged = True
                    items.append({"role": "user", "text": "Answer the user now, using the tool results above."})
                    continue
                break
            if step == 6:
                failure = "That took too many steps. Check what changed and ask me to continue."
                break
            items.append({"role": "assistant", "text": text_this_step, "calls": calls})
            results = []
            for call in calls:
                args = call["args"]
                yield {"type": "tool", "name": call["name"], "status": "running"}
                try:
                    result = await dispatch_tool(db, call["name"], args, created, user, session_id, previewed_this_turn)
                except HTTPException as exc:
                    # A rejected tool call goes back to the model as an error so it can explain or retry
                    # instead of failing the whole chat or claiming success.
                    await db.rollback()
                    result = {"error": str(exc.detail)}
                err = result.get("error") if isinstance(result, dict) else None
                _remember_tool(session_id, call["name"], args, result)
                tool_summary.append({"tool": call["name"], "args": args, "error": err,
                                     "pending": bool(isinstance(result, dict) and result.get("needs_confirmation"))})
                yield {"type": "tool", "name": call["name"], "status": "error" if err else "done"}
                results.append({"id": call["id"], "name": call["name"], "response": _tool_response(result)})
            items.append({"role": "tool", "results": results})
            if text_this_step:
                reply += "\n\n"
                yield {"type": "delta", "text": "\n\n"}
    except HTTPException as exc:
        failure = str(exc.detail)
    except Exception:
        logger.exception("ai chat failed")
        failure = "The assistant ran into a problem. Please try again."

    reply = reply.strip()
    if failure and not tool_summary:
        yield {"type": "error", "message": failure}
        return
    if failure and not reply:
        reply = failure

    changed = any(not t["error"] and not t.get("pending") and not t["tool"].startswith("get_") and t["tool"] != "suggest_recipes_from_inventory" for t in tool_summary)
    stored = reply or (f"({failure})" if failure else "")
    # The clock can tie on some systems; keep the reply strictly after the question so history loads in order.
    asked_at = datetime.now(timezone.utc)
    user_msg_id, user_meta = new_id(), None
    if image_bytes:
        try:  # a chat is still saved if the picture cannot be written; it just will not show the picture later
            user_meta = {"image": chat_images.save(sys.modules[__name__], user["_id"], session_id, user_msg_id, image_bytes, image_mime)}
        except Exception:
            logger.exception("could not store a chat image")
    db.add(AIMessage(id=user_msg_id, user_id=user["_id"], session_id=session_id, role="user", text=body.message or "", meta=user_meta,
                     created_at=asked_at.isoformat()))
    db.add(AIMessage(id=new_id(), user_id=user["_id"], session_id=session_id, role="assistant", text=stored,
                     meta={"actions": [{"tool": t["tool"], "error": t["error"], "pending": t.get("pending", False)} for t in tool_summary],
                           "changed": changed} if tool_summary else None,
                     created_at=(asked_at + timedelta(milliseconds=1)).isoformat()))
    await conversations_api.record_turn(db, user["_id"], session_id, body.message or "", stored, asked_at)
    if changed:
        label = reply[:140] if reply else (tool_summary[0]["tool"].replace("_", " ").title())
        db.add(AIAction(
            id=new_id(), user_id=user["_id"], label=label,
            tools=[t["tool"] for t in tool_summary], created=created,
            undoable=len(created) > 0, undone=False, created_at=now_iso(),
        ))
    await db.commit()
    yield {"type": "done", "reply": reply, "session_id": session_id, "actions": tool_summary,
           "changed": changed, "error": failure}


async def run_ai_chat(db: AsyncSession, user: dict, body: AIChatBody):
    result = None
    async for ev in ai_chat_events(db, user, body):
        if ev["type"] == "error":
            raise HTTPException(503, ev["message"])
        if ev["type"] == "done":
            result = ev
    result = result or {"reply": "", "session_id": body.session_id, "actions": [], "changed": False}
    return {k: result[k] for k in ("reply", "session_id", "actions", "changed")}


@api_router.post("/ai/chat")
async def ai_chat(body: AIChatBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await run_ai_chat(db, user, body)


@api_router.post("/ai/chat/stream")
async def ai_chat_stream(body: AIChatBody, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Server-sent events: the reply arrives as it is written, followed by a final `done` event."""
    unavailable = chat_unavailable()
    if unavailable:
        raise HTTPException(503, unavailable)

    async def gen():
        try:
            async for ev in ai_chat_events(db, user, body):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ai stream failed")
            yield f"data: {json.dumps({'type': 'error', 'message': 'The assistant ran into a problem. Please try again.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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


def _confirmation_gate(session_id: Optional[str], previewed_this_turn: Optional[set], tool: str, target_id: str, confirm, message: str):
    """Two-step guard for destructive AI tools.

    The first call records a pending confirmation and returns a preview; the action only proceeds when a
    *later* call (a later user turn, not the same model turn) passes confirm=true for the same target.
    Returns None when the action is confirmed, otherwise the needs_confirmation payload.
    """
    pending = _pending_confirmations.get(session_id or "")
    has_pending = bool(
        pending and pending.get("tool") == tool and pending.get("target_id") == target_id
        and datetime.now(timezone.utc) < pending.get("expires_at", datetime.min.replace(tzinfo=timezone.utc))
    )
    self_confirming = previewed_this_turn is not None and target_id in previewed_this_turn
    if confirm is True and has_pending and not self_confirming:
        _pending_confirmations.pop(session_id or "", None)
        return None
    _pending_confirmations[session_id or ""] = {
        "tool": tool, "target_id": target_id, "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    if previewed_this_turn is not None:
        previewed_this_turn.add(target_id)
    return {"needs_confirmation": True, "message": message}


async def kitchen_overview(db: AsyncSession, user_id: str) -> dict:
    """Read-only snapshot of every storage location and the items that need attention."""
    from datetime import date as _date
    locations = (await db.execute(
        select(StorageLocation).where(StorageLocation.user_id == user_id).order_by(StorageLocation.sort_order, StorageLocation.name)
    )).scalars().all()
    items = (await db.execute(select(Grocery).where(Grocery.user_id == user_id).order_by(Grocery.name))).scalars().all()
    by_name = {l.name.lower(): l.name for l in locations}
    by_kind = {}
    for l in locations:
        by_kind.setdefault((l.kind or "").lower(), l.name)
    today = _date.today()
    spaces = {l.name: [] for l in locations}
    elsewhere, expired, expiring, low = [], [], [], []
    for g in items:
        key = (g.storage_location or "").lower()
        place = by_name.get(key) or by_kind.get(key)
        row = {"id": g.id, "name": g.name, "quantity": float(g.quantity or 0), "unit": g.unit,
               "category": g.category, "expiration": g.expiration}
        (spaces[place] if place else elsewhere).append(row)
        qty = float(g.quantity or 0)
        if g.expiration and qty > 0:
            try:
                days = (_date.fromisoformat(g.expiration) - today).days
            except ValueError:
                days = None
            if days is not None and days < 0:
                expired.append({**row, "days_overdue": -days, "location": place})
            elif days is not None and days <= 3:
                expiring.append({**row, "days_left": days, "location": place})
        if qty <= 0 or (float(g.low_threshold or 0) > 0 and qty <= float(g.low_threshold)):
            low.append({**row, "out_of_stock": qty <= 0, "location": place})
    return {
        "storage_locations": [{"name": l.name, "kind": l.kind, "item_count": len(spaces[l.name]), "items": spaces[l.name]} for l in locations],
        "unassigned_location": elsewhere,
        "expired": expired, "expiring_within_3_days": expiring, "low_or_out_of_stock": low,
    }


async def dispatch_tool(db: AsyncSession, name: str, args: dict, created: list, user: dict, session_id: Optional[str] = None, previewed_this_turn: Optional[set] = None) -> dict:
    try:
        if name in ai_tools_extra.EXTRA_NAMES:
            return await ai_tools_extra.dispatch_extra(sys.modules[__name__], db, name, args, created, user, session_id, previewed_this_turn)
        if name == "create_expense":
            acc_ref = args.get("account", "cash")
            acc = await resolve_account(db, acc_ref, user["_id"])
            account_id = acc.id if acc else acc_ref
            body = ExpenseBody(
                amount=args.get("amount"), merchant=args.get("merchant", ""),
                description=args.get("description", "") or args.get("merchant", ""),
                category=args.get("category", "Other"), account=account_id,
                date=args.get("date"), participants=args.get("participants", ["Me"]),
                split_mode=args.get("split_mode", "equal"),
                items=[ItemBody(**i) for i in args.get("items", [])],
                exact_shares=args.get("exact_shares", {}) or {},
                add_to_inventory=args.get("add_to_inventory", False),
            )
            res = await create_expense_record(db, body, user["_id"])
            created.append({"collection": "transactions", "id": res["transaction"]["id"]})
            return res
        if name == "record_income":
            acc_ref = args.get("account", "revolut")
            acc = await resolve_account(db, acc_ref, user["_id"])
            account_id = acc.id if acc else acc_ref
            body = IncomeBody(
                account=acc_ref, account_id=account_id,
                amount=args.get("amount"), description=args.get("description", "Income"),
                date=args.get("date"))
            res = await add_income(body, user, db)
            created.append({"collection": "transactions", "id": res["id"]})
            return res
        if name == "record_payment":
            acc_ref = args.get("account", "revolut")
            acc = await resolve_account(db, acc_ref, user["_id"])
            account_id = acc.id if acc else acc_ref
            body = SettlementBody(
                person=args["person"], amount=args.get("amount"),
                method=args.get("method", "Revolut"),
                account=acc_ref, account_id=account_id,
                direction=args.get("direction", "in"),
                date=args.get("date"))
            res = await add_settlement(body, user, db)
            if res.get("id"):
                created.append({"collection": "settlements", "id": res["id"]})
                if res.get("transaction_id"):
                    created.append({"collection": "transactions", "id": res["transaction_id"]})
                if res.get("balance_transaction_id"):
                    created.append({"collection": "transactions", "id": res["balance_transaction_id"]})
            return res
        if name == "create_person":
            return await resolve_person(db, args["name"], user["_id"])
        if name == "add_grocery":
            fields = {k: v for k, v in args.items() if k in GroceryBody.model_fields}
            if fields.get("storage_location"):
                fields["storage_location"] = await resolve_storage_name(db, user["_id"], fields["storage_location"], strict=True)
            g = await add_grocery(GroceryBody(**fields), user, db)
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
            payment = args.get("payment_method")
            if payment:
                acc = await resolve_account(db, payment, user["_id"])
                payment = acc.id if acc else payment
            upd = TxnUpdate(amount=args.get("amount"), personal_amount=args.get("personal_amount"),
                            category=args.get("category"), payment_method=payment,
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
            acc_ref = args.get("account", "revolut")
            acc = await resolve_account(db, acc_ref, user["_id"])
            account_id = acc.id if acc else acc_ref
            s = Settlement(
                id=new_id(), user_id=user["_id"],
                person_id=(await resolve_person(db, args["person"], user["_id"]))["id"],
                person_name=args["person"], amount=round(args["amount"], 2),
                method=args.get("method", "Revolut"), account=account_id,
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
            fields = {k: v for k, v in args.items() if k in GroceryUpdate.model_fields and k != "name"}
            if fields.get("storage_location"):
                fields["storage_location"] = await resolve_storage_name(db, user["_id"], fields["storage_location"], strict=True)
            res = await update_grocery(g.id, GroceryUpdate(**fields), user, db)
            return {"updated": res}
        if name == "generate_shopping_list":
            return await generate_shopping_doc(db, int(args.get("days", 7)), user_id=user["_id"], list_id=args.get("list_id"))
        if name == "get_groceries":
            q = select(Grocery).where(Grocery.user_id == user["_id"]).order_by(Grocery.name)
            if args.get("storage_location"):
                q = q.where(Grocery.storage_location == await resolve_storage_name(db, user["_id"], args["storage_location"], strict=True))
            gs = (await db.execute(q)).scalars().all()
            return {"groceries": [to_dict(g) for g in gs]}
        if name == "get_shopping_lists":
            lists = await get_shopping_lists(user, db)
            payload = await shopping_payload(db, user["_id"])
            return {"lists": lists, "active": payload}
        if name == "create_shopping_list":
            lst = await create_shopping_list(ShoppingListBody(name=args["name"]), user, db)
            created.append({"collection": "shopping_lists", "id": lst["id"]})
            return lst
        if name == "add_shopping_item":
            item = await post_shopping(ShoppingBody(**{k: v for k, v in args.items() if k in ShoppingBody.model_fields}), user, db)
            created.append({"collection": "shopping_items", "id": item["id"]})
            return item
        if name == "update_shopping_item":
            item_id = args.get("item_id")
            if not item_id:
                return {"error": "item_id is required"}
            upd = ShoppingItemUpdate(**{k: v for k, v in args.items() if k in ShoppingItemUpdate.model_fields and k != "item_id"})
            return await update_shopping_item(item_id, upd, user, db)
        if name == "delete_shopping_item":
            item_id = args.get("item_id")
            if not item_id:
                return {"error": "item_id is required"}
            if not args.get("confirm"):
                it = (await db.execute(
                    select(ShoppingItem).where(ShoppingItem.id == item_id, ShoppingItem.user_id == user["_id"])
                )).scalar_one_or_none()
                if not it:
                    return {"error": "Item not found"}
                return {"needs_confirmation": True, "message": f"This will remove '{it.name}' from the shopping list. Ask the user to confirm."}
            await del_shopping(item_id, user, db)
            return {"deleted": item_id}
        if name == "submit_purchase":
            list_id = args.get("list_id")
            items = args.get("items", [])
            if not list_id or not items:
                return {"error": "list_id and items are required"}
            if not args.get("confirm"):
                return {"needs_confirmation": True, "message": f"This will purchase {len(items)} selected item(s) and update inventory. Ask the user to confirm."}
            body = SubmitPurchaseBody(
                items=[PurchaseItem(**i) for i in items],
                store=args.get("store"),
                record_expense=args.get("record_expense", False),
                payment_account=args.get("payment_account"),
            )
            res = await submit_purchase(list_id, body, user, db)
            if res.get("expense"):
                created.append({"collection": "transactions", "id": res["expense"]["transaction"]["id"]})
            return res
        if name == "get_grocery_summary":
            summary = await analytics_summary(user=user, db=db)
            low = await get_low_stock(user, db)
            return {"summary": summary.get("grocery"), "low_stock": low}
        if name == "set_shopping_list_budget":
            lid = args.get("list_id")
            budget = args.get("budget")
            upd = ShoppingListUpdate(budget=budget)
            return await update_shopping_list(lid, upd, user, db)
        if name == "get_price_history":
            return await get_prices(args.get("name", ""), user, db)
        if name == "get_grocery_suggestions":
            return await get_grocery_suggestions(args.get("limit", 10), user, db)
        if name == "get_recurring_lists":
            return await get_recurring_lists(user, db)
        if name == "create_recurring_list":
            rl = await create_recurring_list(RecurringListBody(
                name=args["name"], schedule=args.get("schedule", "weekly"),
                items=[RecurringItem(**i) for i in args.get("items", [])]), user, db)
            created.append({"collection": "recurring_lists", "id": rl["id"]})
            return rl
        if name == "spawn_recurring_list":
            return await spawn_recurring_list(args.get("recurring_list_id"), user, db)
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
        if name == "get_accounts":
            return await get_accounts(user, db)
        if name == "transfer_money":
            from_acc = await resolve_account(db, args.get("from_account", ""), user["_id"])
            to_acc = await resolve_account(db, args.get("to_account", ""), user["_id"])
            if not from_acc or not to_acc:
                return {"error": "Could not resolve source or destination account"}
            body = AccountTransferBody(
                from_account_id=from_acc.id, to_account_id=to_acc.id,
                amount=args.get("amount", 0), date=args.get("date"), note=args.get("note"),
            )
            res = await transfer_money(body, user, db)
            created.append({"collection": "transactions", "id": res["transaction"]["id"]})
            return res
        if name == "update_account_balance":
            acc = await resolve_account(db, args.get("account", ""), user["_id"])
            if not acc:
                return {"error": "Account not found"}
            upd = AccountUpdate(balance=args.get("balance"))
            if args.get("initial_balance") is not None:
                upd.initial_balance = args["initial_balance"]
            res = await update_account(acc.id, upd, user, db)
            res["balance"] = await compute_account_balance(db, acc.id, user["_id"])
            return {"updated": res}
        if name in ("create_money_space", "update_money_space", "delete_money_space"):
            try:
                if name == "create_money_space":
                    ref = (args.get("parent") or "").strip().lower()
                    parent_type = "cash" if ref in ("cash", "money in hand", "hand") else "revolut" if ref == "revolut" else None
                    parent = None
                    if parent_type:
                        parent = (await db.execute(select(Account).where(
                            Account.user_id == user["_id"], Account.type == parent_type, Account.is_active == True
                        ))).scalars().first()
                    else:
                        parent = await resolve_account(db, args.get("parent", ""), user["_id"])
                    if not parent or parent.type not in ("cash", "revolut"):
                        return {"error": "Spaces can only be created inside Money in hand or Revolut"}
                    res = await create_account(AccountBody(
                        name=args["name"], type="revolut_space" if parent.type == "revolut" else "cash_place",
                        parent_id=parent.id, opening_balance=args.get("balance") or 0,
                        is_locked=bool(args.get("is_locked", False)),
                    ), user, db)
                    created.append({"collection": "accounts", "id": res["id"]})
                    return res
                acc = await resolve_account(db, args.get("account", ""), user["_id"])
                if not acc:
                    return {"error": "Account not found"}
                if name == "update_money_space":
                    upd = AccountUpdate(name=args.get("name"), is_locked=args.get("is_locked"), is_active=args.get("is_active"))
                    return {"updated": await update_account(acc.id, upd, user, db)}
                return await delete_account(acc.id, user, db)
            except HTTPException as e:
                return {"error": e.detail}
        if name == "get_products":
            return {"products": await search_products(args.get("query", ""), user, db)}
        if name == "add_product":
            p = await create_product(ProductBody(**{k: v for k, v in args.items() if k in ProductBody.model_fields}), user, db)
            created.append({"collection": "products", "id": p["id"]})
            return p
        if name == "update_grocery_storage":
            g, err = await find_grocery(db, user["_id"], args.get("grocery_id"), args.get("name"))
            if err:
                return {"error": err}
            dest = await resolve_storage_name(db, user["_id"], args["storage_location"], strict=True)
            return await move_grocery(g.id, MoveInventoryBody(storage_location=dest), user, db)
        if name == "consume_grocery":
            g, err = await find_grocery(db, user["_id"], args.get("grocery_id"), args.get("name"))
            if err:
                return {"error": err}
            return await consume_grocery(g.id, ConsumeBody(quantity=args["quantity"]), user, db)
        if name == "discard_grocery":
            g, err = await find_grocery(db, user["_id"], args.get("grocery_id"), args.get("name"))
            if err:
                return {"error": err}
            qty = args.get("quantity")
            what = f"{qty:g} {g.unit} of {g.name}" if qty else f"all of {g.name} ({float(g.quantity):g} {g.unit})"
            gate = _confirmation_gate(session_id, previewed_this_turn, "discard_grocery", f"{g.id}:{qty}", args.get("confirm"),
                                      f"This will remove {what} from the inventory. Ask the user to confirm before discarding.")
            if gate:
                return gate
            res = await discard_grocery(g.id, DiscardBody(quantity=qty), user, db)
            return {"discarded": what, "result": res}
        if name == "update_storage_location":
            loc = (await db.execute(select(StorageLocation).where(
                StorageLocation.user_id == user["_id"], func.lower(StorageLocation.name) == (args.get("name") or "").strip().lower()
            ))).scalar_one_or_none()
            if not loc:
                return {"error": f"No storage location named '{args.get('name')}'"}
            return await update_storage_location(loc.id, StorageLocationUpdate(name=args.get("new_name"), kind=args.get("kind")), user, db)
        if name == "get_kitchen_overview":
            return await kitchen_overview(db, user["_id"])
        if name == "get_expiring_items":
            return {"items": await get_expiring_groceries(int(args.get("days", 7)), user, db)}
        if name == "get_storage_locations":
            return {"storage_locations": await get_storage_locations(user, db)}
        if name == "add_storage_location":
            s = await create_storage_location(StorageLocationBody(
                name=args["name"], kind=args.get("kind", "custom"),
                icon=args.get("icon"), sort_order=int(args.get("sort_order", 0))), user, db)
            created.append({"collection": "storage_locations", "id": s["id"]})
            return s
        if name == "get_appliances":
            return {"appliances": await get_appliances(user, db)}
        if name == "add_appliance":
            a = await create_appliance(ApplianceBody(
                name=args["name"], kind=args.get("kind", "other"),
                icon=args.get("icon"), notes=args.get("notes")), user, db)
            created.append({"collection": "appliances", "id": a["id"]})
            return a
        if name == "suggest_recipes_from_inventory":
            ranked = await recipe_suggestions(limit=10, user=user, db=db)
            return {"suggestions": [{
                "recipe_id": e["recipe"]["id"], "recipe": e["recipe"]["name"], "servings": e["recipe"].get("servings"),
                "coverage_percent": e["coverage"], "can_cook_now": e["can_cook_now"],
                "missing_ingredients": e["missing"], "uses_soon_to_expire": e["uses_expiring"],
            } for e in ranked]}
        if name == "add_missing_ingredients":
            rid = args.get("recipe_id")
            if not rid:
                return {"error": "recipe_id is required"}
            items = [MissingIngredient(**i) for i in args["items"]] if args.get("items") else None
            res = await add_missing_to_list(rid, AddMissingBody(list_id=args.get("list_id"), items=items), user, db)
            return {"added_to_shopping_list": [{"name": i.get("name"), "quantity": i.get("quantity"), "unit": i.get("unit")} for i in res["added"]],
                    "note": "These are shopping-list entries only; inventory was not changed."}
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

        # Demo transactions are only for a brand-new install. Without this guard, deleting all your
        # transactions made the next restart refill the app with demo data.
        fresh_install = (await db.execute(select(func.count(Account.id)))).scalar() == 0
        if fresh_install:
            db.add(Account(id="cash", user_id=admin_id, name="Cash", type="cash", opening_balance=120.0, created_at=now_iso()))
            db.add(Account(id="revolut", user_id=admin_id, name="Revolut", type="revolut", opening_balance=640.0, created_at=now_iso()))

        if (await db.execute(select(func.count(Person.id)))).scalar() == 0:
            for n in ["Ferreira", "Broca", "Sebas", "Mariana", "Faia"]:
                db.add(Person(id=new_id(), user_id=admin_id, name=n, name_lower=n.lower(),
                              photo=None, notes="", payment_preference="", created_at=now_iso()))

        if fresh_install and (await db.execute(select(func.count(Transaction.id)))).scalar() == 0:
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
async def migrate_legacy_account_refs():
    """Rewrite old 'cash'/'revolut'/'card' strings on transactions and settlements to real account ids,
    so they count towards the right balance. Idempotent: aliases that are real ids are left alone."""
    async with AsyncSessionLocal() as db:
        user_ids = (await db.execute(select(Account.user_id).distinct())).scalars().all()
        for uid in user_ids:
            real_ids = set((await db.execute(select(Account.id).where(Account.user_id == uid))).scalars().all())
            for alias in ("cash", "revolut", "card"):
                if alias in real_ids:
                    continue
                acc = await resolve_account(db, alias, uid)
                if not acc:
                    continue
                for col in (Transaction.account, Transaction.from_account, Transaction.to_account):
                    await db.execute(update(Transaction).where(Transaction.user_id == uid, col == alias).values({col.key: acc.id}))
                await db.execute(update(Settlement).where(Settlement.user_id == uid, Settlement.account == alias).values(account=acc.id))
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await seed()
    await migrate_legacy_account_refs()
    scheduler = scheduling.Scheduler(sys.modules[__name__], AsyncSessionLocal)
    if os.environ.get("SCHEDULER_ENABLED", "true").lower() not in ("0", "false", "no"):
        scheduler.start()
    logger.info("Life Record ready.")
    yield
    await scheduler.stop()
    await engine.dispose()


app.router.lifespan_context = lifespan


@api_router.get("/health")
async def health():
    return {"status": "ok"}


@api_router.get("/")
async def root():
    return {"app": "Life Record", "status": "ok"}


conversations_api.register(api_router, sys.modules[__name__])
chat_images.register(api_router, sys.modules[__name__])
scheduling_api.register(api_router, sys.modules[__name__])
calendar_api.register(api_router, sys.modules[__name__])
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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
