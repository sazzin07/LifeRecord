"""The person's own profile and preferences: saved app choices and the display name.

Preferences are low-risk and the assistant may change them (ai_tools_settings.py calls the same functions). The sign-in address is
deliberately NOT changeable: it is the account's identity and where every security message goes, and nothing here (or anywhere) edits it.
"""
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import User, UserPreference

# What each preference may be, in the order a screen offers it. The first value is the default for someone who never chose.
PREFERENCE_OPTIONS = {
    "theme": ["system", "light", "dark"],
    "animations": [True, False],
    "week_start": ["monday", "sunday"],
    "money_period": ["week", "day", "all"],
}
PREFERENCE_LABELS = {
    "theme": "Theme", "animations": "Animations", "week_start": "Calendar weeks start on", "money_period": "Money opens on",
}
DEFAULTS = {k: v[0] for k, v in PREFERENCE_OPTIONS.items()}
NAME_MAX = 80


def clean_changes(changes: dict) -> dict:
    """Only known preferences with allowed values, or a ValueError that says which and what is allowed."""
    out = {}
    for key, value in (changes or {}).items():
        if key not in PREFERENCE_OPTIONS:
            raise ValueError(f"Unknown setting '{key}'. The settings are: {', '.join(PREFERENCE_OPTIONS)}.")
        if isinstance(value, str):
            value = value.strip().lower()
        if key == "animations":
            if isinstance(value, str):
                value = {"on": True, "off": False, "true": True, "false": False}.get(value, value)
            if not isinstance(value, bool):
                raise ValueError("animations must be on or off.")
        elif value not in PREFERENCE_OPTIONS[key]:
            raise ValueError(f"{PREFERENCE_LABELS[key]} can be: {', '.join(str(o) for o in PREFERENCE_OPTIONS[key])}.")
        out[key] = value
    return out


async def read_preferences(db: AsyncSession, user_id: str) -> tuple:
    """(preferences, saved): what applies now, and whether this person ever saved any."""
    row = (await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))).scalar_one_or_none()
    if row is None:
        return dict(DEFAULTS), False
    return {k: getattr(row, k) for k in DEFAULTS}, True


async def save_preferences(db: AsyncSession, user_id: str, changes: dict, now: str) -> dict:
    """Apply already-cleaned changes on top of what is saved (or the defaults) and return the result."""
    row = (await db.execute(select(UserPreference).where(UserPreference.user_id == user_id))).scalar_one_or_none()
    if row is None:
        row = UserPreference(user_id=user_id, updated_at=now, **DEFAULTS)
        db.add(row)
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = now
    await db.commit()
    return {k: getattr(row, k) for k in DEFAULTS}


class PreferencesBody(BaseModel):
    theme: Optional[str] = Field(None, max_length=10)
    animations: Optional[bool] = None
    week_start: Optional[str] = Field(None, max_length=10)
    money_period: Optional[str] = Field(None, max_length=10)


class NameBody(BaseModel):
    name: str = Field(..., max_length=255)


def register(api_router, srv):
    async def _db_user(db, user) -> User:
        row = (await db.execute(select(User).where(User.id == user["_id"]))).scalar_one_or_none()
        if row is None:
            raise HTTPException(401, "User not found")
        return row

    def _me(db_user: User) -> dict:
        return {"id": db_user.id, "email": db_user.email, "name": db_user.name, "email_verified": bool(db_user.email_verified)}

    async def _preferences_answer(db, uid: str) -> dict:
        prefs, saved = await read_preferences(db, uid)
        return {"preferences": prefs, "saved": saved, "options": PREFERENCE_OPTIONS}

    @api_router.get("/preferences")
    async def get_preferences(user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        return await _preferences_answer(db, user["_id"])

    @api_router.put("/preferences")
    async def put_preferences(body: PreferencesBody, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        changes = {k: v for k, v in body.model_dump().items() if v is not None}
        try:
            changes = clean_changes(changes)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        await save_preferences(db, user["_id"], changes, srv.now_iso())
        return await _preferences_answer(db, user["_id"])

    @api_router.patch("/auth/me")
    async def change_name(body: NameBody, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        name = " ".join(body.name.split())
        if not name:
            raise HTTPException(400, "Your name cannot be empty.")
        if len(name) > NAME_MAX:
            raise HTTPException(400, f"Your name can have at most {NAME_MAX} characters.")
        db_user = await _db_user(db, user)
        db_user.name = name
        await db.commit()
        return _me(db_user)
