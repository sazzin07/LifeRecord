"""Saved chats: list, search, open, rename, archive and delete the user's assistant conversations.

A conversation's id is the session id its `ai_messages` rows already use, so every existing chat path keeps
working. Everything is scoped to the signed-in user; another user's id behaves exactly like a missing one.
"""
import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import asc, delete, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import chat_images
from models import AIConversation, AIMessage

PREVIEW_LEN = 140
TITLE_LEN = 60


def clean_title(text: str, limit: int = TITLE_LEN) -> str:
    text = re.sub(r"\s+", " ", re.sub(r"[`*#>\"“”]", "", text or "")).strip(" .:-")
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip(" ,;:") + "…"
    return text or "New chat"


def preview_of(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[`*_#>|]", "", text or "")).strip()[:PREVIEW_LEN]


async def owned(db: AsyncSession, conv_id: str, user_id: str) -> Optional[AIConversation]:
    return (await db.execute(select(AIConversation).where(AIConversation.id == conv_id, AIConversation.user_id == user_id))).scalar_one_or_none()


async def id_taken_by_someone_else(db: AsyncSession, conv_id: str, user_id: str) -> bool:
    row = (await db.execute(select(AIConversation.user_id).where(AIConversation.id == conv_id))).scalar_one_or_none()
    return row is not None and row != user_id


async def record_turn(db: AsyncSession, user_id: str, conv_id: str, user_text: str, reply: str, when: datetime) -> AIConversation:
    """Create or update the conversation row after a saved turn (the caller commits)."""
    stamp = when.astimezone(timezone.utc).isoformat()
    conv = await owned(db, conv_id, user_id)
    if conv is None:
        conv = AIConversation(id=conv_id, user_id=user_id, title=clean_title(user_text), title_source="default", archived=False,
                              preview="", message_count=0, created_at=stamp, updated_at=stamp)
        db.add(conv)
    conv.preview = preview_of(reply or user_text)
    conv.message_count = (conv.message_count or 0) + 2
    conv.updated_at = stamp
    conv.archived = False  # new activity brings an archived chat back
    return conv


class ConversationPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    archived: Optional[bool] = None


def conversation_dict(c: AIConversation) -> dict:
    return {"id": c.id, "title": c.title, "title_source": c.title_source, "archived": bool(c.archived), "preview": c.preview,
            "message_count": c.message_count, "created_at": c.created_at, "updated_at": c.updated_at}


def register(router, srv):
    get_user, get_db = srv.get_current_user, srv.get_db

    @router.get("/ai/conversations")
    async def list_conversations(q: Optional[str] = Query(default=None, max_length=100), archived: bool = False,
                                 sort: str = Query(default="recent", pattern="^(recent|oldest|title)$"),
                                 limit: int = Query(default=100, ge=1, le=200), offset: int = Query(default=0, ge=0),
                                 user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        stmt = select(AIConversation).where(AIConversation.user_id == user["_id"], AIConversation.archived == archived)
        term = (q or "").strip()
        if term:
            escaped = term.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
            like = f"%{escaped}%"
            in_messages = select(AIMessage.session_id).where(AIMessage.user_id == user["_id"], AIMessage.text.ilike(like, escape="\\"))
            stmt = stmt.where(or_(AIConversation.title.ilike(like, escape="\\"), AIConversation.id.in_(in_messages)))
        order = {"recent": desc(AIConversation.updated_at), "oldest": asc(AIConversation.created_at),
                 "title": asc(func.lower(AIConversation.title))}[sort]
        rows = (await db.execute(stmt.order_by(order).limit(limit).offset(offset))).scalars().all()
        return [conversation_dict(c) for c in rows]

    @router.get("/ai/conversations/{conv_id}")
    async def open_conversation(conv_id: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        conv = await owned(db, conv_id, user["_id"])
        if not conv:
            raise HTTPException(404, "Conversation not found")
        msgs = (await db.execute(select(AIMessage).where(AIMessage.session_id == conv_id, AIMessage.user_id == user["_id"])
                                 .order_by(asc(AIMessage.created_at)))).scalars().all()
        return {**conversation_dict(conv), "messages": [srv.to_dict(m) for m in msgs]}

    @router.patch("/ai/conversations/{conv_id}")
    async def update_conversation(conv_id: str, body: ConversationPatch, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        conv = await owned(db, conv_id, user["_id"])
        if not conv:
            raise HTTPException(404, "Conversation not found")
        if body.title is not None:
            title = clean_title(body.title, 120)
            conv.title, conv.title_source = title, "user"
        if body.archived is not None:
            conv.archived = body.archived
        await db.commit()
        return conversation_dict(conv)

    @router.delete("/ai/conversations/{conv_id}")
    async def delete_conversation(conv_id: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        conv = await owned(db, conv_id, user["_id"])
        if not conv:
            raise HTTPException(404, "Conversation not found")
        await db.execute(delete(AIMessage).where(AIMessage.session_id == conv_id, AIMessage.user_id == user["_id"]))
        await db.delete(conv)
        await db.commit()
        chat_images.delete_conversation_images(srv, user["_id"], conv_id)
        return {"deleted": conv_id}

    @router.post("/ai/conversations/{conv_id}/title")
    async def generate_title(conv_id: str, user: dict = Depends(get_user), db: AsyncSession = Depends(get_db)):
        """Name an untitled chat from its first exchange. A title the user chose is never overwritten."""
        conv = await owned(db, conv_id, user["_id"])
        if not conv:
            raise HTTPException(404, "Conversation not found")
        if conv.title_source != "default":
            return conversation_dict(conv)
        msgs = (await db.execute(select(AIMessage).where(AIMessage.session_id == conv_id, AIMessage.user_id == user["_id"])
                                 .order_by(asc(AIMessage.created_at)).limit(2))).scalars().all()
        if len(msgs) < 2:
            return conversation_dict(conv)
        prompt = (f"Write a title of at most 6 words for this conversation. Reply with the title only: no quotes, no punctuation at the end.\n\n"
                  f"User: {msgs[0].text[:400]}\nAssistant: {msgs[1].text[:400]}")
        title = ""
        try:
            async for kind, value in srv._provider_stream([{"role": "user", "text": prompt}], "You name conversations.", conv_id, tools=[]):
                if kind == "text":
                    title += value
        except Exception:
            title = ""  # keep the first-words title; naming is a nicety, not a requirement
        title = clean_title(title.splitlines()[0] if title.strip() else "", 60)
        if title != "New chat":
            conv.title, conv.title_source = title, "auto"
            await db.commit()
        return conversation_dict(conv)
