"""Saved chats: persistence, reopening, rename, search, archive, delete and isolation between users.

Turns are created in-process with a scripted model (no provider calls); the REST endpoints are exercised over HTTP
against the running backend, as a real client would. A second, throwaway user proves isolation and is deleted
afterwards (its rows cascade).
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from support_auth import login
from sqlalchemy import delete, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from models import AIConversation, AIMessage, User  # noqa: E402
from security_utils import hash_password  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in (Path(__file__).resolve().parents[2] / "frontend" / ".env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

TAG = f"CONV_{uuid.uuid4().hex[:6]}"
OWNER_EMAIL, OWNER_PASSWORD = "tiagosa743@gmail.com", "LifeRecord"
STRANGER_EMAIL, STRANGER_PASSWORD = f"{TAG.lower()}@example.test", "Str4nger-pass!"


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
def tidy_conversations():
    yield

    async def drop():
        async with AsyncSessionLocal() as db:
            ids = (await db.execute(select(AIConversation.id).where(AIConversation.title.like(r"%CONV\_%", escape="\\")))).scalars().all()
            await db.execute(delete(AIMessage).where(AIMessage.session_id.in_(ids)))
            await db.execute(delete(AIConversation).where(AIConversation.id.in_(ids)))
            await db.commit()
    run(drop())


async def _owner_user():
    async with AsyncSessionLocal() as db:
        u = (await db.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
        return {"_id": u.id, "email": u.email, "name": u.name, "role": u.role}


def turn(monkeypatch, message, reply, session=None, calls=()):
    """Run one chat turn with a scripted model and return the session id it was saved under."""
    state = {"n": 0}

    async def fake(items, system, session_id, tools=None):
        state["n"] += 1
        if calls and state["n"] == 1:
            for c in calls:
                yield ("call", c)
        else:
            yield ("text", reply)

    monkeypatch.setattr(server, "_provider_stream", fake)

    async def go():
        async with AsyncSessionLocal() as db:
            user = await _owner_user()
            events = [e async for e in server.ai_chat_events(db, user, server.AIChatBody(message=message, session_id=session))]
            return events[-1]["session_id"]
    return run(go())


def test_a_turn_is_saved_as_a_conversation_and_reopens_with_its_messages(owner, monkeypatch):
    sid = turn(monkeypatch, f"How much did I spend on coffee {TAG}?", "You spent €12.50 on coffee.")
    listing = owner.get(f"{BASE_URL}/api/ai/conversations").json()
    row = next(c for c in listing if c["id"] == sid)
    assert row["title"].startswith("How much did I spend on coffee") and row["title_source"] == "default"
    assert row["message_count"] == 2 and "€12.50" in row["preview"] and row["archived"] is False

    opened = owner.get(f"{BASE_URL}/api/ai/conversations/{sid}").json()
    assert [m["role"] for m in opened["messages"]] == ["user", "assistant"]
    assert opened["messages"][1]["text"] == "You spent €12.50 on coffee."


def test_tool_chips_survive_a_reopen_and_a_second_turn_extends_the_same_chat(owner, monkeypatch):
    sid = turn(monkeypatch, f"add a task {TAG} chips", "Added it.", calls=[{"id": "c1", "name": "create_task", "args": {"title": f"{TAG} chip task"}}])
    msgs = owner.get(f"{BASE_URL}/api/ai/conversations/{sid}").json()["messages"]
    assert msgs[1]["meta"]["changed"] is True and msgs[1]["meta"]["actions"][0]["tool"] == "create_task"
    sid2 = turn(monkeypatch, "thanks", "Anytime.", session=sid)
    assert sid2 == sid
    opened = owner.get(f"{BASE_URL}/api/ai/conversations/{sid}").json()
    assert opened["message_count"] == 4 and [m["role"] for m in opened["messages"]] == ["user", "assistant", "user", "assistant"]
    # clean up the task the scripted call created
    for t in owner.get(f"{BASE_URL}/api/tasks").json():
        if t["title"] == f"{TAG} chip task":
            owner.delete(f"{BASE_URL}/api/tasks/{t['id']}")


def test_search_sort_and_archive_filters(owner, monkeypatch):
    a = turn(monkeypatch, f"alpha {TAG} groceries", "Groceries were €40.00.")
    b = turn(monkeypatch, f"bravo {TAG} gym", f"You trained 3 times, mentioning zebracrossing{TAG}.")
    ids = lambda **kw: [c["id"] for c in owner.get(f"{BASE_URL}/api/ai/conversations", params=kw).json()]  # noqa: E731
    assert ids(q=f"zebracrossing{TAG}") == [b]                       # matches message text, not only titles
    assert set(ids(q=f"{TAG} groceries")) == {a}               # matches titles
    assert ids(q=f"{TAG}", sort="recent").index(b) < ids(q=f"{TAG}", sort="recent").index(a)
    assert ids(q=f"{TAG}", sort="oldest").index(a) < ids(q=f"{TAG}", sort="oldest").index(b)
    titles = [c["title"].lower() for c in owner.get(f"{BASE_URL}/api/ai/conversations", params={"q": TAG, "sort": "title"}).json()]
    assert titles == sorted(titles)

    assert owner.patch(f"{BASE_URL}/api/ai/conversations/{a}", json={"archived": True}).json()["archived"] is True
    assert a not in ids(q=TAG) and a in ids(q=TAG, archived="true")
    assert owner.patch(f"{BASE_URL}/api/ai/conversations/{a}", json={"archived": False}).json()["archived"] is False
    assert a in ids(q=TAG)


def test_new_activity_brings_an_archived_chat_back(owner, monkeypatch):
    sid = turn(monkeypatch, f"remember {TAG} archive", "Noted.")
    owner.patch(f"{BASE_URL}/api/ai/conversations/{sid}", json={"archived": True})
    turn(monkeypatch, "one more thing", "Sure.", session=sid)
    assert owner.get(f"{BASE_URL}/api/ai/conversations/{sid}").json()["archived"] is False


def test_rename_is_kept_and_auto_title_never_overwrites_it(owner, monkeypatch):
    sid = turn(monkeypatch, f"first words {TAG} rename", "Okay.")
    renamed = owner.patch(f"{BASE_URL}/api/ai/conversations/{sid}", json={"title": f"  My **plan** {TAG}  "}).json()
    assert renamed["title"] == f"My plan {TAG}" and renamed["title_source"] == "user"
    again = owner.post(f"{BASE_URL}/api/ai/conversations/{sid}/title").json()
    assert again["title"] == f"My plan {TAG}"
    assert owner.patch(f"{BASE_URL}/api/ai/conversations/{sid}", json={"title": ""}).status_code == 422


def test_auto_title_uses_the_model_and_falls_back_quietly(owner, monkeypatch):
    sid = turn(monkeypatch, f"what about {TAG} budgets for rent", "Here is the budget view.")

    async def titled(items, system, session_id, tools=None):
        assert tools == []
        yield ("text", f"\"Rent budget {TAG}\".")
    monkeypatch.setattr(server, "_provider_stream", titled)
    # the HTTP server would call the real provider, so the endpoint function is run in-process with the scripted one

    async def go():
        from fastapi import HTTPException  # noqa: F401
        async with AsyncSessionLocal() as db:
            user = await _owner_user()
            conv = (await db.execute(select(AIConversation).where(AIConversation.id == sid))).scalar_one()
            conv.title_source = "default"
            await db.commit()
            routes = {r.path + "".join(sorted(r.methods)): r for r in server.api_router.routes}
            fn = routes["/api/ai/conversations/{conv_id}/titlePOST"].endpoint
            return await fn(sid, user, db)
    result = run(go())
    assert result["title"] == f"Rent budget {TAG}" and result["title_source"] == "auto"

    async def broken(items, system, session_id, tools=None):
        raise RuntimeError("provider down")
        yield  # pragma: no cover
    monkeypatch.setattr(server, "_provider_stream", broken)

    async def reset_and_retry():
        async with AsyncSessionLocal() as db:
            user = await _owner_user()
            conv = (await db.execute(select(AIConversation).where(AIConversation.id == sid))).scalar_one()
            conv.title_source, conv.title = "default", f"what about {TAG} budgets"
            await db.commit()
            routes = {r.path + "".join(sorted(r.methods)): r for r in server.api_router.routes}
            return await routes["/api/ai/conversations/{conv_id}/titlePOST"].endpoint(sid, user, db)
    fallback = run(reset_and_retry())
    assert fallback["title"] == f"what about {TAG} budgets" and fallback["title_source"] == "default"


def test_delete_removes_the_chat_and_its_messages(owner, monkeypatch):
    sid = turn(monkeypatch, f"temporary {TAG} delete", "Fine.")
    assert owner.delete(f"{BASE_URL}/api/ai/conversations/{sid}").json() == {"deleted": sid}
    assert owner.get(f"{BASE_URL}/api/ai/conversations/{sid}").status_code == 404
    assert owner.delete(f"{BASE_URL}/api/ai/conversations/{sid}").status_code == 404

    async def left():
        async with AsyncSessionLocal() as db:
            return (await db.execute(select(AIMessage).where(AIMessage.session_id == sid))).scalars().all()
    assert run(left()) == []


def test_another_user_cannot_see_rename_archive_or_delete_a_chat(owner, stranger, monkeypatch):
    sid = turn(monkeypatch, f"private {TAG} thing", "Secret reply.")
    base = f"{BASE_URL}/api/ai/conversations"
    assert all(c["id"] != sid for c in stranger.get(base, params={"q": TAG}).json())
    assert all(c["id"] != sid for c in stranger.get(base, params={"q": "Secret reply"}).json())
    assert stranger.get(f"{base}/{sid}").status_code == 404
    assert stranger.patch(f"{base}/{sid}", json={"title": "mine now"}).status_code == 404
    assert stranger.patch(f"{base}/{sid}", json={"archived": True}).status_code == 404
    assert stranger.post(f"{base}/{sid}/title").status_code == 404
    assert stranger.delete(f"{base}/{sid}").status_code == 404
    still = owner.get(f"{base}/{sid}").json()
    assert still["title"].startswith("private") and not still["archived"] and len(still["messages"]) == 2


def test_chatting_with_someone_elses_session_id_starts_a_new_chat(owner, stranger, monkeypatch):
    sid = turn(monkeypatch, f"owned {TAG} session", "Mine.")

    async def go():
        async with AsyncSessionLocal() as db:
            ghost = {"_id": str(uuid.uuid4()), "email": "ghost@example.test", "name": "Ghost", "role": "user"}
            async for e in server.ai_chat_events(db, ghost, server.AIChatBody(message="hi", session_id=sid)):
                return e  # the first event carries the session id that will be used
    first = run(go())
    assert first["type"] == "session" and first["session_id"] != sid


def test_requests_without_a_token_are_rejected():
    for method, path in (("get", ""), ("get", "/x"), ("patch", "/x"), ("delete", "/x"), ("post", "/x/title")):
        r = getattr(requests, method)(f"{BASE_URL}/api/ai/conversations{path}", timeout=10)
        assert r.status_code in (401, 403), (method, path, r.status_code)


def test_browsers_are_allowed_to_send_patch_requests():
    """Rename and archive use PATCH; without it in the CORS settings a real browser blocks them (requests ignores CORS)."""
    r = requests.options(f"{BASE_URL}/api/ai/conversations/x", timeout=10, headers={
        "Origin": "http://localhost:3000", "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "authorization,content-type"})
    assert r.status_code == 200 and "PATCH" in r.headers.get("access-control-allow-methods", "")
