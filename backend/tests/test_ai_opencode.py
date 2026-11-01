"""Tests for the OpenCode Go adapter, using an in-process fake of the provider (no network, no cost).

They pin down what the service requires: the Go endpoint path, bearer auth, the per-conversation session header,
the Responses event shapes for text and function calls, and that failures become short user-safe messages that
never contain the API key.
"""
import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ai_opencode  # noqa: E402

KEY = "oc_sk_test_secret_value_123"
TOOLS = [{"type": "function", "function": {"name": "get_tasks", "description": "List tasks",
                                           "parameters": {"type": "object", "properties": {"status": {"type": "string"}}}}}]


def run(coro):
    return asyncio.run(coro)


def sse(*events, split_at=None):
    raw = "".join(f"event: {e['type']}\ndata: {json.dumps(e, ensure_ascii=False)}\n\n" for e in events).encode("utf-8")
    return [raw] if split_at is None else [raw[:split_at], raw[split_at:]]


@pytest.fixture
def provider(monkeypatch):
    """Install a fake provider; `state` records requests and `queue` holds the responses to give."""
    monkeypatch.setenv("OPENCODE_API_KEY", KEY)
    # The documented default address: what these tests pin must not depend on the environment they run in (the scratch
    # stack points the provider at a dead end on purpose).
    monkeypatch.setattr(ai_opencode, "BASE_URL", "https://opencode.ai/inference/go")
    state = {"requests": [], "queue": []}

    def handler(request: httpx.Request):
        state["requests"].append(request)
        status, content, headers = state["queue"].pop(0)
        return httpx.Response(status, content=b"".join(content) if isinstance(content, list) else content, headers=headers)

    real = httpx.AsyncClient
    monkeypatch.setattr(ai_opencode.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))

    async def no_sleep(_):
        return None
    monkeypatch.setattr(ai_opencode.asyncio, "sleep", no_sleep)
    return state


def ok(*events, split_at=None):
    return (200, sse(*events, split_at=split_at), {"content-type": "text/event-stream"})


def err(status, type_, message="x"):
    return (status, json.dumps({"error": {"type": type_, "message": message}}).encode(), {"content-type": "application/json"})


async def collect(items=None, session="sess-1"):
    return [e async for e in ai_opencode.stream_turn(items or [{"role": "user", "text": "hi"}], "system text", TOOLS, session)]


def test_request_uses_the_go_endpoint_bearer_auth_and_session_header(provider):
    provider["queue"].append(ok({"type": "response.output_text.delta", "delta": "ok"}))
    run(collect(session="conversation-42"))
    req = provider["requests"][0]
    assert str(req.url) == "https://opencode.ai/inference/go/openai/v1/responses"
    assert req.headers["authorization"] == f"Bearer {KEY}"
    assert req.headers["x-opencode-session"] == "conversation-42"
    assert req.headers["user-agent"] == "liferecord/1.0"
    body = json.loads(req.content)
    assert body["model"] == "gpt-6-luna" and body["stream"] is True and body["instructions"] == "system text"
    assert body["tools"][0] == {"type": "function", "name": "get_tasks", "description": "List tasks",
                                "parameters": TOOLS[0]["function"]["parameters"], "strict": False}


def test_text_deltas_and_function_calls_are_parsed_even_when_a_character_is_split_across_chunks(provider):
    events = [
        {"type": "response.output_text.delta", "delta": "Pay “rent” "},
        {"type": "response.output_text.delta", "delta": "today"},
        {"type": "response.output_item.done", "item": {"type": "function_call", "call_id": "call_1", "name": "get_tasks", "arguments": "{\"status\":\"open\"}"}},
        {"type": "response.completed", "response": {}},
    ]
    provider["queue"].append(ok(*events, split_at=40))  # cuts inside the multi-byte quote characters
    out = run(collect())
    assert [k for k, _ in out] == ["text", "text", "call"]
    assert "".join(v for k, v in out if k == "text") == "Pay “rent” today"
    assert out[-1][1] == {"id": "call_1", "name": "get_tasks", "args": {"status": "open"}}


def test_conversation_items_become_responses_input(provider):
    provider["queue"].append(ok({"type": "response.output_text.delta", "delta": "x"}))
    items = [
        {"role": "user", "text": "tasks?", "image": "data:image/png;base64,AAAA"},
        {"role": "assistant", "text": "Checking.", "calls": [{"id": "c1", "name": "get_tasks", "args": {"status": "open"}}]},
        {"role": "tool", "results": [{"id": "c1", "name": "get_tasks", "response": {"count": 1}}]},
    ]
    run(collect(items))
    sent = json.loads(provider["requests"][0].content)["input"]
    assert sent[0]["content"][1] == {"type": "input_image", "image_url": "data:image/png;base64,AAAA"}
    assert sent[1] == {"role": "assistant", "content": [{"type": "output_text", "text": "Checking."}]}
    assert sent[2] == {"type": "function_call", "call_id": "c1", "name": "get_tasks", "arguments": "{\"status\": \"open\"}"}
    assert sent[3] == {"type": "function_call_output", "call_id": "c1", "output": "{\"count\": 1}"}


@pytest.mark.parametrize("status,type_,needle", [
    (402, "server_error", "balance or plan"),
    (401, "AuthError", "rejected the API key"),
    (403, "Forbidden", "rejected the API key"),
    (400, "MissingSessionID", "session id"),
])
def test_failures_become_short_safe_messages(provider, status, type_, needle):
    provider["queue"].append(err(status, type_, f"detail mentioning {KEY}"))
    with pytest.raises(HTTPException) as exc:
        run(collect())
    assert needle in exc.value.detail and KEY not in exc.value.detail
    assert len(provider["requests"]) == 1  # not retried


def test_rate_limit_is_retried_once_then_reported(provider):
    provider["queue"] += [err(429, "RateLimit"), err(429, "RateLimit")]
    with pytest.raises(HTTPException) as exc:
        run(collect())
    assert "usage limit" in exc.value.detail and len(provider["requests"]) == 2


def test_transient_server_error_is_retried_and_can_succeed(provider):
    provider["queue"] += [err(503, "server_error"), ok({"type": "response.output_text.delta", "delta": "fine"})]
    assert run(collect()) == [("text", "fine")]
    assert len(provider["requests"]) == 2


def test_a_failed_stream_event_is_reported(provider):
    provider["queue"].append(ok({"type": "response.failed", "response": {"error": {"type": "overloaded"}}}))
    with pytest.raises(HTTPException) as exc:
        run(collect())
    assert "busy" in exc.value.detail


def test_missing_key_is_a_configuration_error(monkeypatch):
    monkeypatch.delenv("OPENCODE_API_KEY", raising=False)
    with pytest.raises(HTTPException) as exc:
        run(collect())
    assert exc.value.status_code == 503 and "OPENCODE_API_KEY" in exc.value.detail
