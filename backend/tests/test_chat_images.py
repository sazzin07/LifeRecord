"""Images in saved chats: validated by content, stored with the conversation, served only to their owner and removed
when the conversation is deleted. The model is scripted, so nothing here calls a provider."""
import asyncio
import base64
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from support_auth import login, OWNER_EMAIL, OWNER_PASSWORD
from sqlalchemy import delete, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402  (loads backend/.env)
import chat_images  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from models import AIConversation, AIMessage, User  # noqa: E402
from security_utils import hash_password  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in (Path(__file__).resolve().parents[2] / "frontend" / ".env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

TAG = f"IMG_{uuid.uuid4().hex[:6]}"
STRANGER_EMAIL, STRANGER_PASSWORD = f"{TAG.lower()}@example.test", "Str4nger-pass!"

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
GIF = b"GIF89a" + b"\x00" * 16
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 16
data_url = lambda raw, mime="image/png": f"data:{mime};base64,{base64.b64encode(raw).decode()}"  # noqa: E731


def run(coro):
    return asyncio.run(coro)


def _login(email, password):
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {login(email, password)['token']}"
    return s


@pytest.fixture(scope="module")
def owner():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def stranger():
    async def make():
        async with AsyncSessionLocal() as db:
            db.add(User(id=str(uuid.uuid4()), email=STRANGER_EMAIL, password_hash=hash_password(STRANGER_PASSWORD), name="Stranger",
                        role="user", email_verified=True, created_at=datetime.now(timezone.utc).isoformat()))
            await db.commit()
    run(make())
    yield _login(STRANGER_EMAIL, STRANGER_PASSWORD)

    async def drop():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(User).where(User.email == STRANGER_EMAIL))
            await db.commit()
    run(drop())


@pytest.fixture(autouse=True, scope="module")
def tidy():
    yield

    async def drop():
        async with AsyncSessionLocal() as db:
            ids = (await db.execute(select(AIConversation.id).where(AIConversation.title.like("%IMG\\_%", escape="\\")))).scalars().all()
            for cid in ids:
                owner_id = (await db.execute(select(AIConversation.user_id).where(AIConversation.id == cid))).scalar_one()
                chat_images.delete_conversation_images(server, owner_id, cid)
            await db.execute(delete(AIMessage).where(AIMessage.session_id.in_(ids)))
            await db.execute(delete(AIConversation).where(AIConversation.id.in_(ids)))
            await db.commit()
    run(drop())


async def _owner_user():
    async with AsyncSessionLocal() as db:
        u = (await db.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
        return {"_id": u.id, "email": u.email, "name": u.name, "role": u.role}


def chat(monkeypatch, message, image=None, session=None):
    seen = {"image": None}

    async def fake(items, system, session_id, tools=None):
        seen["image"] = items[-1].get("image")
        yield ("text", "I can see it.")
    monkeypatch.setattr(server, "_provider_stream", fake)

    async def go():
        async with AsyncSessionLocal() as db:
            user = await _owner_user()
            return [e async for e in server.ai_chat_events(db, user, server.AIChatBody(message=message, image_base64=image, session_id=session))]
    return run(go()), seen


def first_message(owner, sid):
    return owner.get(f"{BASE_URL}/api/ai/conversations/{sid}").json()["messages"][0]


def test_an_attached_image_is_saved_with_the_chat_and_served_back_unchanged(owner, monkeypatch):
    events, seen = chat(monkeypatch, f"what is this {TAG}", data_url(PNG))
    sid = events[-1]["session_id"]
    assert events[-1]["type"] == "done" and seen["image"].startswith("data:image/png;base64,")  # the model still receives it
    msg = first_message(owner, sid)
    assert msg["meta"]["image"]["mime"] == "image/png" and msg["meta"]["image"]["bytes"] == len(PNG)
    r = owner.get(f"{BASE_URL}/api/ai/conversations/{sid}/images/{msg['id']}")
    assert r.status_code == 200 and r.content == PNG and r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"].startswith("private") and r.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("raw,mime", [(JPG, "image/jpeg"), (GIF, "image/gif"), (WEBP, "image/webp")])
def test_the_type_comes_from_the_file_not_the_claimed_type(owner, monkeypatch, raw, mime):
    events, _ = chat(monkeypatch, f"kind {TAG} {mime}", data_url(raw, "image/png"))  # claimed png, actually something else
    msg = first_message(owner, events[-1]["session_id"])
    assert msg["meta"]["image"]["mime"] == mime


def test_an_image_only_message_and_a_later_text_turn_keep_the_picture(owner, monkeypatch):
    events, _ = chat(monkeypatch, "", data_url(PNG))
    sid = events[-1]["session_id"]
    async def rename():
        async with AsyncSessionLocal() as db:
            c = (await db.execute(select(AIConversation).where(AIConversation.id == sid))).scalar_one()
            c.title = f"image only {TAG}"
            await db.commit()
    run(rename())
    chat(monkeypatch, "thanks", session=sid)
    opened = owner.get(f"{BASE_URL}/api/ai/conversations/{sid}").json()
    assert [bool(m.get("meta") and m["meta"].get("image")) for m in opened["messages"]] == [True, False, False, False]
    assert owner.get(f"{BASE_URL}/api/ai/conversations/{sid}/images/{opened['messages'][0]['id']}").status_code == 200


@pytest.mark.parametrize("kind,needle", [
    ("text", "not a supported image"), ("pdf", "not a supported image"), ("empty", "not a supported image"),
])
def test_files_that_are_not_images_or_are_too_big_are_refused_and_nothing_is_saved(monkeypatch, kind, needle):
    payload = {"text": lambda: data_url(b"this is not an image"), "pdf": lambda: data_url(b"%PDF-1.4 fake"),
               "empty": lambda: "data:image/png;base64,"}[kind]()
    events, seen = chat(monkeypatch, f"bad file {TAG}", payload)
    assert events[-1]["type"] == "error" and needle in events[-1]["message"] and seen["image"] is None

    async def saved():
        async with AsyncSessionLocal() as db:
            return (await db.execute(select(AIConversation).where(AIConversation.title.like(f"%bad file {TAG}%")))).scalars().all()
    assert run(saved()) == []


def test_only_the_owner_can_fetch_a_chat_image(owner, stranger, monkeypatch):
    events, _ = chat(monkeypatch, f"private picture {TAG}", data_url(PNG))
    sid = events[-1]["session_id"]
    mid = first_message(owner, sid)["id"]
    url = f"{BASE_URL}/api/ai/conversations/{sid}/images/{mid}"
    assert stranger.get(url).status_code == 404
    assert requests.get(url, timeout=10).status_code in (401, 403)
    assert owner.get(f"{BASE_URL}/api/ai/conversations/{uuid.uuid4()}/images/{mid}").status_code == 404   # wrong chat for that message
    assert owner.get(f"{BASE_URL}/api/ai/conversations/{sid}/images/{uuid.uuid4()}").status_code == 404
    assert owner.get(url).status_code == 200


def test_deleting_the_chat_deletes_its_pictures(owner, monkeypatch):
    events, _ = chat(monkeypatch, f"to be deleted {TAG}", data_url(PNG))
    sid = events[-1]["session_id"]
    mid = first_message(owner, sid)["id"]
    user = run(_owner_user())
    folder = server._safe_storage_path(f"chat_images/{user['_id']}/{sid}")
    assert folder.exists() and any(folder.iterdir())
    assert owner.delete(f"{BASE_URL}/api/ai/conversations/{sid}").status_code == 200
    assert not folder.exists()
    assert owner.get(f"{BASE_URL}/api/ai/conversations/{sid}/images/{mid}").status_code == 404


def test_archiving_keeps_the_pictures(owner, monkeypatch):
    events, _ = chat(monkeypatch, f"archive keeps {TAG}", data_url(PNG))
    sid = events[-1]["session_id"]
    mid = first_message(owner, sid)["id"]
    owner.patch(f"{BASE_URL}/api/ai/conversations/{sid}", json={"archived": True})
    assert owner.get(f"{BASE_URL}/api/ai/conversations/{sid}/images/{mid}").status_code == 200


def test_a_storage_failure_does_not_lose_the_chat(owner, monkeypatch):
    def boom(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(chat_images, "save", boom)
    events, _ = chat(monkeypatch, f"disk trouble {TAG}", data_url(PNG))
    assert events[-1]["type"] == "done"
    msg = first_message(owner, events[-1]["session_id"])
    assert msg["text"].startswith("disk trouble") and not (msg.get("meta") or {}).get("image")


def test_ids_cannot_be_used_to_escape_the_storage_folder():
    for bad in ("../x", "a/b", "a\\b", "", "a.b"):
        with pytest.raises(ValueError):
            chat_images._folder("user", bad)
    chat_images.delete_conversation_images(server, "../..", "..")  # silently ignored, never raises or deletes anything


def test_size_limits_apply_at_the_api_and_in_the_decoder(owner):
    too_big = "data:image/png;base64," + "A" * 8_100_000
    assert owner.post(f"{BASE_URL}/api/ai/chat", json={"message": "x", "image_base64": too_big}, timeout=60).status_code == 422
    with pytest.raises(ValueError, match="too large"):
        chat_images.decode(data_url(PNG), max_bytes=10)
