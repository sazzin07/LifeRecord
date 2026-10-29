"""Deterministic tests for the AI tools that cover tasks/calendar, people, categories, nutrition, fitness and body,
plus the streaming chat loop (with the model replaced by a scripted stream).

Everything runs in-process against the dispatcher, so it shows what the assistant can really do to the owner's
data: reads are scoped to the user, writes reuse the REST logic, deletes need a preview and a later confirmation.
Test rows carry a unique tag and are removed afterwards.
"""
import asyncio
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import delete, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402  (loads backend/.env)
from database import AsyncSessionLocal  # noqa: E402
from models import AIAction, AIMessage, AIPendingConfirmation, Category, Meal, Person, Task, User, WeightEntry  # noqa: E402
from support_auth import OWNER_EMAIL  # noqa: E402

TAG = f"AIX_{uuid.uuid4().hex[:6]}"
SESSION = "sess-" + TAG


def run(coro):
    return asyncio.run(coro)


async def _owner(db):
    u = (await db.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
    return {"_id": u.id, "email": u.email, "name": u.name, "role": u.role}


async def _tool(name, args, previewed=None, user=None):
    async with AsyncSessionLocal() as db:
        u = user or await _owner(db)
        return await server.dispatch_tool(db, name, args, [], u, session_id=SESSION,
                                          previewed_this_turn=previewed if previewed is not None else set())


async def _cleanup():
    async with AsyncSessionLocal() as db:
        u = await _owner(db)
        await db.execute(delete(Task).where(Task.user_id == u["_id"], Task.title.like(f"{TAG}%")))
        await db.execute(delete(Person).where(Person.user_id == u["_id"], Person.name.like(f"{TAG}%")))
        await db.execute(delete(Category).where(Category.user_id == u["_id"], Category.name.like(f"{TAG}%")))
        await db.execute(delete(Meal).where(Meal.user_id == u["_id"], Meal.description.like(f"{TAG}%")))
        await db.execute(delete(WeightEntry).where(WeightEntry.user_id == u["_id"], WeightEntry.note.like(f"{TAG}%")))
        await db.execute(delete(AIMessage).where(AIMessage.user_id == u["_id"], AIMessage.session_id.like(f"{SESSION}%")))
        await db.execute(delete(AIPendingConfirmation).where(AIPendingConfirmation.session_id.like(f"{SESSION}%")))
        await db.commit()


@pytest.fixture(autouse=True)
def tidy():
    run(_cleanup())  # no confirmation left over from an earlier test
    yield
    run(_cleanup())


def _confirm_flow(tool, args):
    """Preview on one turn, confirm on a later one. Returns (preview, final)."""
    preview = run(_tool(tool, args))
    final = run(_tool(tool, {**args, "confirm": True}))
    return preview, final


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------
def test_every_tool_is_declared_once_and_dispatchable():
    names = [t["function"]["name"] for t in server.AI_TOOLS]
    assert len(names) == len(set(names))
    for n in server.ai_tools_extra.EXTRA_NAMES:
        assert n in names


def test_tool_schemas_load_into_gemini():
    assert server.build_gemini_tools()[0].function_declarations


# ---------------------------------------------------------------------------
# Tasks / calendar
# ---------------------------------------------------------------------------
def test_task_edit_complete_and_delete_with_confirmation():
    title = f"{TAG} renew passport"
    run(_tool("create_task", {"title": title, "due": (date.today() - timedelta(days=2)).isoformat()}))

    overdue = run(_tool("get_tasks", {"status": "overdue", "search": TAG}))
    assert [t["title"] for t in overdue["tasks"]] == [title] and overdue["tasks"][0]["overdue"] is True

    new_due = (date.today() + timedelta(days=5)).isoformat()
    upd = run(_tool("update_task", {"match": "renew passport", "due": new_due, "priority": "high"}))
    assert upd["updated"]["due"] == new_due and upd["updated"]["priority"] == "high"

    done = run(_tool("update_task", {"match": "renew passport", "done": True}))
    assert done["updated"]["done"] is True
    assert run(_tool("get_tasks", {"status": "open", "search": TAG}))["count"] == 0
    assert run(_tool("get_tasks", {"status": "done", "search": TAG}))["count"] == 1

    preview, final = _confirm_flow("delete_task", {"match": "renew passport"})
    assert preview.get("needs_confirmation") and final == {"deleted": title}
    assert run(_tool("get_tasks", {"status": "all", "search": TAG}))["count"] == 0


def test_task_delete_cannot_confirm_in_the_same_turn():
    title = f"{TAG} same turn"
    run(_tool("create_task", {"title": title}))
    seen = set()
    first = run(_tool("delete_task", {"match": title}, previewed=seen))
    second = run(_tool("delete_task", {"match": title, "confirm": True}, previewed=seen))
    assert first.get("needs_confirmation") and second.get("needs_confirmation")
    assert run(_tool("get_tasks", {"status": "all", "search": TAG}))["count"] == 1


def test_calendar_range_filter():
    inside = (date.today() + timedelta(days=3)).isoformat()
    run(_tool("create_task", {"title": f"{TAG} inside", "due": inside}))
    run(_tool("create_task", {"title": f"{TAG} outside", "due": (date.today() + timedelta(days=40)).isoformat()}))
    res = run(_tool("get_tasks", {"status": "open", "search": TAG, "start": date.today().isoformat(),
                                  "end": (date.today() + timedelta(days=7)).isoformat()}))
    assert [t["title"] for t in res["tasks"]] == [f"{TAG} inside"]


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
def test_person_rename_notes_and_confirmed_delete():
    name = f"{TAG} Marta"
    run(_tool("create_person", {"name": name}))
    upd = run(_tool("update_person", {"person": name, "new_name": f"{TAG} Marta S", "notes": "pays by MB WAY"}))
    assert upd["updated"]["name"] == f"{TAG} Marta S" and upd["updated"]["notes"] == "pays by MB WAY"
    assert any(p["name"] == f"{TAG} Marta S" for p in run(_tool("get_people", {}))["people"])

    preview, final = _confirm_flow("delete_person", {"person": f"{TAG} Marta S"})
    assert preview.get("needs_confirmation") and final == {"deleted": f"{TAG} Marta S"}
    assert not any(TAG in p["name"] for p in run(_tool("get_people", {}))["people"])


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------
def test_category_budget_lifecycle():
    name = f"{TAG} Hobbies"
    c = run(_tool("create_category", {"name": name, "monthly_budget": 60}))
    assert c["monthly_budget"] == 60
    upd = run(_tool("update_category", {"category": name, "monthly_budget": 80, "new_name": f"{TAG} Crafts"}))
    assert upd["updated"]["monthly_budget"] == 80 and upd["updated"]["name"] == f"{TAG} Crafts"
    preview, final = _confirm_flow("delete_category", {"category": f"{TAG} Crafts"})
    assert preview.get("needs_confirmation") and final == {"deleted": f"{TAG} Crafts"}


# ---------------------------------------------------------------------------
# Nutrition, body
# ---------------------------------------------------------------------------
def test_meal_edit_and_delete_update_the_daily_totals():
    desc = f"{TAG} porridge"
    meal = run(_tool("log_meal", {"description": desc, "calories": 300, "protein": 10, "carbs": 50, "fat": 6}))
    before = run(_tool("get_meals", {}))["totals"]["calories"]
    run(_tool("update_meal", {"meal_id": meal["id"], "calories": 450}))
    assert run(_tool("get_meals", {}))["totals"]["calories"] == before + 150
    preview, final = _confirm_flow("delete_meal", {"meal_id": meal["id"]})
    assert preview.get("needs_confirmation") and final == {"deleted": desc}
    assert run(_tool("get_meals", {}))["totals"]["calories"] == before - 300


def test_weight_history_and_delete():
    w = run(_tool("record_weight", {"weight": 71.4}))
    async def tag_it():
        async with AsyncSessionLocal() as db:
            row = (await db.execute(select(WeightEntry).where(WeightEntry.id == w["id"]))).scalar_one()
            row.note = f"{TAG} test"
            await db.commit()
    run(tag_it())
    hist = run(_tool("get_weight_history", {"limit": 500}))
    assert any(e["id"] == w["id"] for e in hist["entries"])
    preview, final = _confirm_flow("delete_weight_entry", {"weight_id": w["id"]})
    assert preview.get("needs_confirmation") and "71.4" in final["deleted"]


# ---------------------------------------------------------------------------
# Reads and isolation
# ---------------------------------------------------------------------------
def test_overview_and_transaction_search_shapes():
    ov = run(_tool("get_overview", {}))
    for key in ("money", "accounts", "tasks", "nutrition_today", "people", "groceries"):
        assert key in ov
    tx = run(_tool("get_transactions", {"month": date.today().strftime("%Y-%m"), "limit": 5}))
    assert tx["count"] >= len(tx["transactions"]) and len(tx["transactions"]) <= 5


def test_another_user_cannot_see_or_change_the_owners_records():
    title = f"{TAG} private"
    task = run(_tool("create_task", {"title": title}))
    stranger = {"_id": "00000000-0000-0000-0000-000000000000", "email": "x@example.com", "name": "X", "role": "user"}
    assert run(_tool("get_tasks", {"status": "all", "search": TAG}, user=stranger))["count"] == 0
    assert "error" in run(_tool("update_task", {"task_id": task["id"], "done": True}, user=stranger))
    assert "error" in run(_tool("delete_task", {"task_id": task["id"], "confirm": True}, user=stranger))
    assert run(_tool("get_tasks", {"status": "open", "search": TAG}))["count"] == 1


# ---------------------------------------------------------------------------
# Streaming chat loop with a scripted model (provider-neutral events)
# ---------------------------------------------------------------------------
def _text(s):
    return ("text", s)


def _call(name, args, cid=None):
    return ("call", {"id": cid or f"call_{uuid.uuid4().hex[:8]}", "name": name, "args": args})


def _script(monkeypatch, *turns):
    """Replace the provider with scripted turns (lists of events). Records each system prompt and conversation."""
    seen = {"system": [], "items": [], "calls": 0}

    async def fake(items, system, session_id, tools=None):
        seen["system"].append(system)
        seen["items"].append([dict(i) for i in items])
        events = turns[min(seen["calls"], len(turns) - 1)]
        seen["calls"] += 1
        for e in events:
            yield e

    monkeypatch.setattr(server, "_provider_stream", fake)
    return seen


async def _collect(message, session=SESSION, page=None):
    async with AsyncSessionLocal() as db:
        user = await _owner(db)
        return [e async for e in server.ai_chat_events(db, user, server.AIChatBody(message=message, session_id=session, page=page))]


def test_stream_emits_deltas_then_done_and_persists(monkeypatch):
    _script(monkeypatch, [_text("You have "), _text("no overdue tasks.")])
    events = run(_collect("any overdue tasks?"))
    kinds = [e["type"] for e in events]
    assert kinds[0] == "session" and kinds[-1] == "done"
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "You have no overdue tasks."
    assert events[-1]["reply"] == "You have no overdue tasks." and events[-1]["changed"] is False

    async def stored():
        async with AsyncSessionLocal() as db:
            u = await _owner(db)
            return (await db.execute(select(AIMessage).where(AIMessage.user_id == u["_id"], AIMessage.session_id == SESSION))).scalars().all()
    assert sorted(m.role for m in run(stored())) == ["assistant", "user"]


def test_stream_runs_tools_and_reports_them(monkeypatch):
    seen = _script(monkeypatch, [_call("create_task", {"title": f"{TAG} from chat"}, "c1")], [_text("Added the task.")])
    events = run(_collect("add a task"))
    tools = [(e["name"], e["status"]) for e in events if e["type"] == "tool"]
    assert tools == [("create_task", "running"), ("create_task", "done")]
    assert events[-1]["changed"] is True and events[-1]["reply"] == "Added the task."
    assert run(_tool("get_tasks", {"status": "open", "search": TAG}))["count"] == 1
    assert seen["calls"] == 2
    # the second turn sees the assistant's call and the tool result, linked by the call id
    follow = seen["items"][1]
    assert follow[-2]["calls"][0]["id"] == "c1" and follow[-1]["results"][0]["id"] == "c1"
    assert follow[-1]["results"][0]["response"]["title"] == f"{TAG} from chat"


def test_context_notes_and_page_reach_the_next_turn(monkeypatch):
    _script(monkeypatch, [_call("create_task", {"title": f"{TAG} context"})], [_text("Done.")])
    run(_collect("add a task", session=SESSION + "-ctx", page="tasks"))
    seen = _script(monkeypatch, [_text("ok")])
    run(_collect("make it high priority", session=SESSION + "-ctx", page="tasks"))
    prompt = seen["system"][0]
    assert "currently on the tasks page" in prompt and "create_task" in prompt and f"{TAG} context" in prompt
    # earlier turns of the saved conversation are sent as history
    assert [i["role"] for i in seen["items"][0]] == ["user", "assistant", "user"]


def test_tool_error_is_not_reported_as_success(monkeypatch):
    _script(monkeypatch, [_call("update_task", {"match": f"{TAG} does not exist", "done": True})], [_text("I could not find that task.")])
    events = run(_collect("finish the missing task"))
    assert ("update_task", "error") in [(e["name"], e["status"]) for e in events if e["type"] == "tool"]
    assert events[-1]["actions"][0]["error"]
    assert events[-1]["changed"] is False


def test_provider_failure_before_any_text_is_an_error_event(monkeypatch):
    from fastapi import HTTPException

    async def boom(items, system, session_id, tools=None):
        raise HTTPException(503, "The assistant is busy right now. Please try again in a moment.")
        yield  # pragma: no cover

    monkeypatch.setattr(server, "_provider_stream", boom)
    events = run(_collect("hello"))
    assert events[-1] == {"type": "error", "message": "The assistant is busy right now. Please try again in a moment."}


def test_empty_reply_after_tools_is_retried_once_and_reads_do_not_count_as_changes(monkeypatch):
    seen = _script(monkeypatch, [_call("get_tasks", {"status": "open", "search": TAG})], [], [_text("Nothing open.")])
    events = run(_collect("what is open?"))
    assert events[-1]["reply"] == "Nothing open." and seen["calls"] == 3
    assert events[-1]["changed"] is False


def test_missing_provider_key_is_a_clear_error_not_a_silent_switch(monkeypatch):
    monkeypatch.setattr(server, "AI_PROVIDER", "opencode")
    monkeypatch.setattr(server.ai_opencode, "api_key", lambda: None)
    events = run(_collect("hello"))
    assert events[-1]["type"] == "error" and "OPENCODE_API_KEY" in events[-1]["message"]


def test_tool_results_are_json_clean_for_the_model():
    from decimal import Decimal
    assert server._json_clean({"a": Decimal("2.50"), "d": date(2026, 10, 23)}) == {"a": 2.5, "d": "2026-10-23"}
    assert server._json_clean(run(_tool("get_overview", {})))["accounts"] is not None
    assert server._json_clean(run(_tool("get_accounts", {}))) is not None


def test_list_results_are_wrapped_into_an_object_for_the_model():
    wrapped = server._tool_response(run(_tool("get_accounts", {})))
    assert isinstance(wrapped, dict) and ("result" in wrapped or "accounts" in wrapped)


def test_a_delete_preview_is_not_counted_as_a_change(monkeypatch):
    title = f"{TAG} preview only"
    run(_tool("create_task", {"title": title}))
    _script(monkeypatch, [_call("delete_task", {"match": title})], [_text("Please confirm.")])
    events = run(_collect("delete it"))
    assert events[-1]["changed"] is False and events[-1]["actions"][0]["pending"] is True
    assert run(_tool("get_tasks", {"status": "open", "search": TAG}))["count"] == 1


def test_confirmation_tools_explain_when_confirm_may_be_set():
    for name in ("delete_task", "delete_person", "delete_meal", "delete_workout", "delete_category"):
        props = next(t for t in server.AI_TOOLS if t["function"]["name"] == name)["function"]["parameters"]["properties"]
        assert "explicitly agreed" in props["confirm"]["description"]
