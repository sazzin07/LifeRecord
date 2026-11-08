"""Saved screen layouts: how a person arranged a page (today only the Groceries "Today" page), kept on the server so every browser
and the assistant see the same arrangement. One row per person and page. No row means "never arranged": the page then shows its defaults.

The Groceries layout is the order, size and visibility of the Today widgets plus the space the page is focused on:
    {"widgets": [{"id": "needs", "size": "m"}, ...], "focus": "all" | <storage location id>}
`srv` is the imported `server` module, passed in to avoid a circular import.
"""
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import UserLayout

GROCERIES = "groceries"
WIDGET_IDS = ("needs", "kitchen", "list", "low", "risk", "cook", "week")
WIDGET_SIZES = ("s", "m", "l")
DEFAULT_GROCERIES = {
    "widgets": [{"id": "needs", "size": "m"}, {"id": "kitchen", "size": "m"}, {"id": "list", "size": "m"}, {"id": "cook", "size": "m"},
                {"id": "low", "size": "s"}, {"id": "risk", "size": "s"}, {"id": "week", "size": "s"}],
    "focus": "all",
}
PAGES = {GROCERIES: DEFAULT_GROCERIES}


def clean_groceries(layout: Any) -> Dict[str, Any]:
    """Check a Groceries layout and return it in its stored shape. Raises ValueError with a sentence the person can read."""
    if not isinstance(layout, dict):
        raise ValueError("The layout must be an object with 'widgets' and 'focus'.")
    unknown = sorted(set(layout) - {"widgets", "focus"})
    if unknown:
        raise ValueError(f"Unknown layout field '{unknown[0]}'. The fields are: widgets, focus.")
    widgets = layout.get("widgets", DEFAULT_GROCERIES["widgets"])
    if not isinstance(widgets, list):
        raise ValueError("'widgets' must be a list.")
    seen, out = set(), []
    for w in widgets:
        if not isinstance(w, dict) or w.get("id") not in WIDGET_IDS:
            raise ValueError(f"A widget must be one of: {', '.join(WIDGET_IDS)}.")
        if w["id"] in seen:
            raise ValueError(f"The widget '{w['id']}' is listed twice.")
        size = w.get("size", "m")
        if size not in WIDGET_SIZES:
            raise ValueError(f"A widget size can be: {', '.join(WIDGET_SIZES)} (small, medium, large).")
        seen.add(w["id"])
        out.append({"id": w["id"], "size": size})
    focus = layout.get("focus", "all")
    if not isinstance(focus, str) or not focus or len(focus) > 36:
        raise ValueError("'focus' must be 'all' or the id of a storage space.")
    return {"widgets": out, "focus": focus}


CLEANERS = {GROCERIES: clean_groceries}


async def read_layout(db: AsyncSession, user_id: str, page: str) -> tuple:
    """(layout, saved): the arrangement that applies now, and whether this person ever saved one."""
    row = (await db.execute(select(UserLayout).where(UserLayout.user_id == user_id, UserLayout.page == page))).scalar_one_or_none()
    if row is None:
        return PAGES[page], False
    return row.layout, True


async def save_layout(db: AsyncSession, user_id: str, page: str, layout: dict, now: str) -> dict:
    row = (await db.execute(select(UserLayout).where(UserLayout.user_id == user_id, UserLayout.page == page))).scalar_one_or_none()
    if row is None:
        db.add(UserLayout(user_id=user_id, page=page, layout=layout, updated_at=now))
    else:
        row.layout, row.updated_at = layout, now
    await db.commit()
    return layout


async def reset_layout(db: AsyncSession, user_id: str, page: str) -> None:
    await db.execute(delete(UserLayout).where(UserLayout.user_id == user_id, UserLayout.page == page))
    await db.commit()


class LayoutBody(BaseModel):
    widgets: Optional[List[Dict[str, Any]]] = None
    focus: Optional[str] = None


def register(api_router, srv):
    def _page(page: str) -> str:
        if page not in PAGES:
            raise HTTPException(404, "No such page")
        return page

    async def _answer(db, uid: str, page: str) -> dict:
        layout, saved = await read_layout(db, uid, page)
        return {"layout": layout, "saved": saved, "options": {"widgets": list(WIDGET_IDS), "sizes": list(WIDGET_SIZES)}}

    @api_router.get("/layouts/{page}")
    async def get_layout(page: str, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        return await _answer(db, user["_id"], _page(page))

    @api_router.put("/layouts/{page}")
    async def put_layout(page: str, body: LayoutBody, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        page = _page(page)
        current, _ = await read_layout(db, user["_id"], page)
        changes = {k: v for k, v in body.model_dump().items() if v is not None}
        try:
            layout = CLEANERS[page]({**current, **changes})
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        await save_layout(db, user["_id"], page, layout, srv.now_iso())
        return await _answer(db, user["_id"], page)

    @api_router.delete("/layouts/{page}")
    async def delete_layout(page: str, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        page = _page(page)
        await reset_layout(db, user["_id"], page)
        return await _answer(db, user["_id"], page)
