from sqlalchemy import (
    Column, String, Text, DECIMAL, Integer, BigInteger, Boolean, ForeignKey, Index, JSON
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True)
    email = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="user")
    email_verified = Column(Boolean, nullable=False, default=False)
    verification_code = Column(String(10), nullable=True)
    verification_code_expires_at = Column(String(32), nullable=True)
    verification_attempts = Column(Integer, nullable=False, default=0)
    last_verification_sent_at = Column(String(32), nullable=True)
    password_reset_token = Column(String(255), nullable=True, unique=True)
    password_reset_expires_at = Column(String(32), nullable=True)
    # Raised on password change/reset and "sign out everywhere"; tokens carry the value they were issued with.
    token_version = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(String(32), nullable=False)


class Account(Base):
    __tablename__ = "accounts"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)
    parent_id = Column(String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    currency = Column(String(10), nullable=False, default="EUR")
    opening_balance = Column(DECIMAL(12, 2), nullable=False, default=0.00)
    initial_balance = Column(DECIMAL(12, 2), nullable=True)
    is_locked = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(String(32), nullable=False)


class Category(Base):
    __tablename__ = "categories"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    icon = Column(String(50), nullable=False)
    color = Column(String(50), nullable=False)
    monthly_budget = Column(DECIMAL(12, 2), nullable=True)
    created_at = Column(String(32), nullable=False)


class Person(Base):
    __tablename__ = "people"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    name_lower = Column(String(255), nullable=False, index=True)
    photo = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    payment_preference = Column(String(255), nullable=True)
    archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(String(32), nullable=False)


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(50), nullable=False, index=True)
    gross_amount = Column(DECIMAL(12, 2), nullable=False, default=0.00)
    personal_amount = Column(DECIMAL(12, 2), nullable=False, default=0.00)
    reimbursable_amount = Column(DECIMAL(12, 2), nullable=False, default=0.00)
    description = Column(Text, nullable=True)
    category = Column(String(255), nullable=True)
    account = Column(String(50), nullable=True, index=True)
    merchant = Column(Text, nullable=True)
    date = Column(String(10), nullable=False, index=True)
    month = Column(String(7), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    paid_by = Column(String(36), nullable=True, index=True)
    items = Column(JSON, nullable=True)
    from_account = Column(String(50), nullable=True, index=True)
    to_account = Column(String(50), nullable=True, index=True)
    created_at = Column(String(32), nullable=False)

    splits = relationship("Split", back_populates="transaction", cascade="all, delete-orphan", lazy="selectin")


class Split(Base):
    __tablename__ = "splits"
    id = Column(String(36), primary_key=True)
    transaction_id = Column(String(36), ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False, index=True)
    person_id = Column(String(36), nullable=False, index=True)
    person_name = Column(String(255), nullable=False)
    amount = Column(DECIMAL(12, 2), nullable=False, default=0.00)
    is_me = Column(Boolean, nullable=False, default=False)
    created_at = Column(String(32), nullable=False)

    transaction = relationship("Transaction", back_populates="splits")


class Settlement(Base):
    __tablename__ = "settlements"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    person_id = Column(String(36), nullable=False, index=True)
    person_name = Column(String(255), nullable=False)
    amount = Column(DECIMAL(12, 2), nullable=False, default=0.00)
    method = Column(String(50), nullable=False)
    account = Column(String(50), nullable=False)
    direction = Column(String(10), nullable=False)
    date = Column(String(10), nullable=False, index=True)
    transaction_id = Column(String(36), ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    balance_transaction_id = Column(String(36), ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(String(32), nullable=False)


class Task(Base):
    __tablename__ = "tasks"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    priority = Column(String(50), nullable=False, default="normal")
    due = Column(String(10), nullable=True)
    recurring = Column(String(50), nullable=True)
    done = Column(Boolean, nullable=False, default=False)
    created_at = Column(String(32), nullable=False)


class WeightEntry(Base):
    __tablename__ = "weight_entries"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    weight = Column(DECIMAL(6, 2), nullable=False)
    date = Column(String(10), nullable=False, index=True)
    note = Column(Text, nullable=True)
    created_at = Column(String(32), nullable=False)


class Workout(Base):
    __tablename__ = "workouts"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(50), nullable=False)
    date = Column(String(10), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    exercises = Column(JSON, nullable=True)
    created_at = Column(String(32), nullable=False)


class Photo(Base):
    __tablename__ = "photos"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    storage_path = Column(String(512), nullable=False, unique=True)
    content_type = Column(String(100), nullable=False)
    note = Column(Text, nullable=True)
    date = Column(String(10), nullable=False, index=True)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(String(32), nullable=False)


class Grocery(Base):
    __tablename__ = "groceries"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    name_lower = Column(String(255), nullable=False, index=True)
    is_favorite = Column(Boolean, nullable=False, default=False)
    default_quantity = Column(DECIMAL(12, 2), nullable=True)
    default_store = Column(String(255), nullable=True)
    purchase_count = Column(Integer, nullable=False, default=0)
    quantity = Column(DECIMAL(12, 2), nullable=False, default=0.00)
    unit = Column(String(50), nullable=False, default="unit")
    category = Column(String(255), nullable=True)
    storage_location = Column(String(50), nullable=False, default="pantry")
    price = Column(DECIMAL(12, 2), nullable=True)
    store = Column(String(255), nullable=True)
    low_threshold = Column(DECIMAL(12, 2), nullable=False, default=0.00)
    notes = Column(Text, nullable=True)
    expiration = Column(String(10), nullable=True)
    created_at = Column(String(32), nullable=False)
    updated_at = Column(String(32), nullable=False)


class Product(Base):
    """Reusable food catalog. user_id NULL = the shared built-in catalog, visible to every account and read-only;
    a user_id marks a product that person added or edited, visible only to them."""
    __tablename__ = "products"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    name_lower = Column(String(255), nullable=False, index=True)
    category = Column(String(255), nullable=True)
    subcategory = Column(String(100), nullable=True)
    default_unit = Column(String(50), nullable=False, default="unit")
    typical_quantity = Column(DECIMAL(12, 2), nullable=True)
    synonyms = Column(JSON, nullable=True)
    nutrition = Column(JSON, nullable=True)
    tags = Column(JSON, nullable=True)  # dietary: vegan, vegetarian, gluten-free, lactose-free
    icon = Column(String(16), nullable=True)  # an emoji
    is_favorite = Column(Boolean, nullable=False, default=False)
    created_at = Column(String(32), nullable=False)


class StorageLocation(Base):
    __tablename__ = "storage_locations"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    kind = Column(String(50), nullable=False, default="custom")  # fridge, pantry, freezer, custom
    icon = Column(String(50), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(String(32), nullable=False)


class Appliance(Base):
    __tablename__ = "appliances"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    kind = Column(String(50), nullable=False, default="other")  # oven, microwave, air_fryer, blender, etc.
    icon = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(String(32), nullable=False)


class PriceRecord(Base):
    __tablename__ = "price_records"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    name_lower = Column(String(255), nullable=False, index=True)
    store = Column(String(255), nullable=True)
    price = Column(DECIMAL(12, 2), nullable=False)
    unit = Column(String(50), nullable=False, default="unit")
    date = Column(String(10), nullable=False, index=True)
    created_at = Column(String(32), nullable=False)


class ShoppingList(Base):
    __tablename__ = "shopping_lists"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    budget = Column(DECIMAL(12, 2), nullable=True)
    archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(String(32), nullable=False)
    updated_at = Column(String(32), nullable=False)
    items = relationship("ShoppingItem", back_populates="list", cascade="all, delete-orphan", lazy="selectin")


class RecurringList(Base):
    __tablename__ = "recurring_lists"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    schedule = Column(String(50), nullable=False, default="weekly")  # weekly, biweekly, monthly
    items = Column(JSON, nullable=False, default=list)
    last_spawned_at = Column(String(32), nullable=True)
    created_at = Column(String(32), nullable=False)
    updated_at = Column(String(32), nullable=False)


class ShoppingItem(Base):
    __tablename__ = "shopping_items"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    list_id = Column(String(36), ForeignKey("shopping_lists.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    name_lower = Column(String(255), nullable=False, index=True)
    category = Column(String(255), nullable=True)
    quantity = Column(DECIMAL(12, 2), nullable=False, default=1.00)
    unit = Column(String(50), nullable=False, default="unit")
    estimated_price = Column(DECIMAL(12, 2), nullable=True)
    actual_price = Column(DECIMAL(12, 2), nullable=True)
    store = Column(String(255), nullable=True)
    note = Column(Text, nullable=True)
    bought = Column(Boolean, nullable=False, default=False)
    selected = Column(Boolean, nullable=False, default=False)
    completed_at = Column(String(32), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    storage_location = Column(String(50), nullable=True)
    product_id = Column(String(36), nullable=True, index=True)
    created_at = Column(String(32), nullable=False)
    list = relationship("ShoppingList", back_populates="items")


class Meal(Base):
    __tablename__ = "meals"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(Text, nullable=False)
    date = Column(String(10), nullable=False, index=True)
    calories = Column(DECIMAL(8, 1), nullable=True)
    protein = Column(DECIMAL(8, 1), nullable=True)
    carbs = Column(DECIMAL(8, 1), nullable=True)
    fat = Column(DECIMAL(8, 1), nullable=True)
    created_at = Column(String(32), nullable=False)


class Recipe(Base):
    __tablename__ = "recipes"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    servings = Column(Integer, nullable=False, default=1)
    ingredients = Column(JSON, nullable=True)
    calories = Column(DECIMAL(8, 1), nullable=True)
    protein = Column(DECIMAL(8, 1), nullable=True)
    carbs = Column(DECIMAL(8, 1), nullable=True)
    fat = Column(DECIMAL(8, 1), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(String(32), nullable=False)


class AIAction(Base):
    __tablename__ = "ai_actions"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    label = Column(String(255), nullable=False)
    tools = Column(JSON, nullable=True)
    created = Column(JSON, nullable=True)
    undoable = Column(Boolean, nullable=False, default=False)
    undone = Column(Boolean, nullable=False, default=False)
    created_at = Column(String(32), nullable=False)


class AIPendingConfirmation(Base):
    """A destructive AI action previewed in one chat turn and awaiting the user's confirmation on a later one.
    One per user and chat; stored so it survives restarts and is shared by every server process."""
    __tablename__ = "ai_pending_confirmations"
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    session_id = Column(String(100), primary_key=True)
    tool = Column(String(64), nullable=False)
    target_id = Column(String(255), nullable=False)
    expires_at = Column(String(32), nullable=False)
    created_at = Column(String(32), nullable=False)


class AIMessage(Base):
    __tablename__ = "ai_messages"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(String(36), nullable=False, index=True)
    role = Column(String(50), nullable=False)
    text = Column(Text, nullable=False)
    meta = Column(JSON, nullable=True)  # what the assistant did on that turn (tool chips), so reopening shows it
    created_at = Column(String(32), nullable=False)

    __table_args__ = (
        Index("ix_ai_messages_session_created", "session_id", "created_at"),
    )


class AIConversation(Base):
    """A saved chat. Its id is the session id its AIMessage rows use."""
    __tablename__ = "ai_conversations"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False, default="New chat")
    title_source = Column(String(16), nullable=False, default="default")  # default | auto | user
    archived = Column(Boolean, nullable=False, default=False)
    preview = Column(String(300), nullable=False, default="")
    message_count = Column(Integer, nullable=False, default=0)
    created_at = Column(String(32), nullable=False)
    updated_at = Column(String(32), nullable=False)

    __table_args__ = (
        Index("ix_ai_conversations_user_updated", "user_id", "updated_at"),
    )


class ScheduledTask(Base):
    """A saved analysis that runs on a schedule and can email its report."""
    __tablename__ = "scheduled_tasks"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    instruction = Column(Text, nullable=False)
    schedule = Column(JSON, nullable=False)          # {"kind": "daily|weekly|monthly|interval|once", "time": "09:00", ...}
    timezone = Column(String(64), nullable=False)
    data_sources = Column(JSON, nullable=True)       # areas the run may read, e.g. ["money", "tasks"]
    recipients = Column(JSON, nullable=True)         # verified addresses the report is emailed to
    status = Column(String(16), nullable=False, default="draft")  # draft | active | paused | completed
    next_run_at = Column(String(32), nullable=True, index=True)   # UTC ISO
    last_run_at = Column(String(32), nullable=True)
    last_status = Column(String(16), nullable=True)
    confirmed_at = Column(String(32), nullable=True)
    created_at = Column(String(32), nullable=False)
    updated_at = Column(String(32), nullable=False)


class ScheduledTaskRun(Base):
    __tablename__ = "scheduled_task_runs"
    id = Column(String(36), primary_key=True)
    task_id = Column(String(36), ForeignKey("scheduled_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    run_key = Column(String(80), nullable=False)     # unique per task: "sched:<utc time>" or "manual:<id>"; blocks duplicates
    trigger = Column(String(16), nullable=False)     # schedule | manual | retry | preview
    scheduled_for = Column(String(32), nullable=False)
    status = Column(String(16), nullable=False, default="queued")  # queued | running | succeeded | failed | missed
    started_at = Column(String(32), nullable=True)
    finished_at = Column(String(32), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    output = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    tools_used = Column(JSON, nullable=True)
    data_errors = Column(JSON, nullable=True)
    delivery_status = Column(String(16), nullable=False, default="none")  # none | pending | sending | sent | failed | not_configured
    delivery_detail = Column(String(500), nullable=True)
    deliveries = Column(JSON, nullable=True)         # per recipient: [{"email", "status", "detail"}]
    delivered_at = Column(String(32), nullable=True)
    created_at = Column(String(32), nullable=False)

    __table_args__ = (
        Index("uq_task_run_key", "task_id", "run_key", unique=True),
    )


class ReportRecipient(Base):
    """An extra address a user may email reports to; usable only after the owner of the address enters its code."""
    __tablename__ = "report_recipients"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String(255), nullable=False)
    verified = Column(Boolean, nullable=False, default=False)
    code_hash = Column(String(128), nullable=True)
    code_expires_at = Column(String(32), nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    last_sent_at = Column(String(32), nullable=True)
    created_at = Column(String(32), nullable=False)

    __table_args__ = (
        Index("uq_report_recipient", "user_id", "email", unique=True),
    )


class RateLimitEvent(Base):
    """One row per rate-limited attempt. `bucket` is a SHA-256 of client + identifier (no emails stored)."""
    __tablename__ = "rate_limit_events"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    bucket = Column(String(64), nullable=False, index=True)
    at_ms = Column(BigInteger, nullable=False, index=True)


class EmailEvent(Base):
    """What happened to each account email (verification, reset, security notice). No address is stored: a hash
    to correlate repeated problems for one recipient, and the domain to spot provider-level trouble."""
    __tablename__ = "email_events"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    purpose = Column(String(32), nullable=False, index=True)
    recipient_hash = Column(String(64), nullable=False, index=True)
    recipient_domain = Column(String(255), nullable=False)
    provider = Column(String(16), nullable=False, default="")
    status = Column(String(16), nullable=False)  # sent, failed, skipped, not_configured
    attempts = Column(Integer, nullable=False, default=1)
    detail = Column(String(255), nullable=False, default="")
    created_at = Column(String(32), nullable=False)
