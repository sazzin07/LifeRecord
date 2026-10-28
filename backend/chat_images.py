"""Images attached to chat messages: validated, stored on disk next to the progress photos, served only to their owner,
and removed when the conversation is deleted.

Files live at `chat_images/<user id>/<conversation id>/<message id>.<ext>`; the message's `meta.image` records the file
name and type. The type is decided from the file's own bytes, never from what the browser claimed.
"""
import base64
import binascii
import logging
import shutil
from typing import Optional, Tuple

from fastapi import Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AIMessage

logger = logging.getLogger("liferecord")

TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
UNSUPPORTED = "That file is not a supported image. Use a JPEG, PNG, WebP or GIF."


def sniff(data: bytes) -> Optional[str]:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def decode(data_url: str, max_bytes: int) -> Tuple[bytes, str]:
    """Bytes and MIME type of a base64 data URL (or bare base64). Raises ValueError with a user-safe message."""
    raw = (data_url or "").split(",", 1)[-1].strip()
    try:
        data = base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError):
        raise ValueError(UNSUPPORTED)
    if not data:
        raise ValueError(UNSUPPORTED)
    if len(data) > max_bytes:
        raise ValueError(f"That image is too large (max {max_bytes // (1024 * 1024)} MB).")
    mime = sniff(data)
    if not mime:
        raise ValueError(UNSUPPORTED)
    return data, mime


def _folder(user_id: str, conv_id: str) -> str:
    # ids are server-generated UUIDs, but never let one carry a path separator into the file system
    for part in (user_id, conv_id):
        if not part or any(c in part for c in "/\\.") :
            raise ValueError("invalid id")
    return f"chat_images/{user_id}/{conv_id}"


def save(srv, user_id: str, conv_id: str, message_id: str, data: bytes, mime: str) -> dict:
    name = f"{message_id}.{TYPES[mime]}"
    srv.save_object(f"{_folder(user_id, conv_id)}/{name}", data)
    return {"file": name, "mime": mime, "bytes": len(data)}


def delete_conversation_images(srv, user_id: str, conv_id: str) -> None:
    try:
        folder = srv._safe_storage_path(_folder(user_id, conv_id))
    except (ValueError, HTTPException):
        return
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)


def register(router, srv):
    @router.get("/ai/conversations/{conv_id}/images/{message_id}")
    async def chat_image(conv_id: str, message_id: str, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        msg = (await db.execute(select(AIMessage).where(AIMessage.id == message_id, AIMessage.session_id == conv_id,
                                                        AIMessage.user_id == user["_id"]))).scalar_one_or_none()
        info = (msg.meta or {}).get("image") if msg else None
        if not info:
            raise HTTPException(404, "Image not found")
        try:
            data = srv.read_object(f"{_folder(user['_id'], conv_id)}/{info['file']}")
        except Exception:
            raise HTTPException(404, "Image not found")
        return Response(content=data, media_type=info["mime"], headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})
