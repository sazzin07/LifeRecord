"""What a new account starts with, so its first expense can be entered without any set-up.

Categories are plain starting points (the person can rename, recolour or delete them). Accounts are deliberately not
created here: their names, types and balances belong to the person, so the app asks for them instead (Money page).
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Category

# (name, icon, colour). The same list the owner's account has always started with.
STARTER_CATEGORIES = [
    ("Groceries", "shopping-cart", "#10B981"), ("Eating Out", "utensils", "#F59E0B"),
    ("Transport", "bus", "#6366F1"), ("Shopping", "shopping-bag", "#EC4899"),
    ("Entertainment", "clapperboard", "#8B5CF6"), ("Work", "briefcase", "#0EA5E9"),
    ("Fitness", "dumbbell", "#059669"), ("Health", "heart-pulse", "#EF4444"),
    ("Travel", "plane", "#14B8A6"), ("Subscriptions", "repeat", "#F97316"),
    ("Bills", "receipt", "#64748B"), ("Other", "circle", "#94A3B8"),
]


async def ensure_starter_categories(db: AsyncSession, user_id: str) -> int:
    """Give `user_id` the starter categories if they have none at all. Returns how many rows were added.

    Not committed here: the caller commits, so the categories and the event that triggered them succeed or fail together.
    """
    have = (await db.execute(select(func.count(Category.id)).where(Category.user_id == user_id))).scalar() or 0
    if have:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    for name, icon, colour in STARTER_CATEGORIES:
        db.add(Category(id=str(uuid.uuid4()), user_id=user_id, name=name, icon=icon, color=colour, created_at=now))
    return len(STARTER_CATEGORIES)
