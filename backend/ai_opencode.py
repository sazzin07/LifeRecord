"""OpenCode Go adapter for the chat assistant (OpenAI Responses protocol, streaming, function tools).

Go is a subscription product with its own endpoint (`.../inference/go/...`); the pay-as-you-go Console endpoint
bills prepaid credits instead and answers 402 "Insufficient account funds" when that balance is empty. Go also
requires a stable `x-opencode-session` header per conversation and asks clients to identify themselves.

The API key comes from the server environment only and is never logged or returned. Errors raised from here
carry short, user-safe messages; the provider's status and error type go to the server log.
"""
import asyncio
import json
import logging
import os
from typing import AsyncIterator, Optional, Tuple

import httpx
from fastapi import HTTPException

logger = logging.getLogger("liferecord")

BASE_URL = os.environ.get("OPENCODE_BASE_URL", "https://opencode.ai/inference/go").rstrip("/")
MODEL = os.environ.get("OPENCODE_MODEL", "gpt-6-luna")
TIMEOUT = float(os.environ.get("OPENCODE_TIMEOUT_SECONDS", "60"))
USER_AGENT = "liferecord/1.0"
RETRY_STATUSES = {429, 500, 502, 503, 504, 529}
MAX_ATTEMPTS = 2


def api_key() -> Optional[str]:
    return os.environ.get("OPENCODE_API_KEY") or None


def configured() -> bool:
    return bool(api_key())


def _user_message(status: int, error_type: str) -> Tuple[int, str]:
    """HTTP status and message shown to the user for a provider failure."""
    if status == 402:
        return 503, "The AI provider reports an account balance or plan problem. Check your OpenCode account."
    if status in (401, 403):
        return 503, "The AI provider rejected the API key. Check OPENCODE_API_KEY and that your OpenCode plan is active."
    if status == 429:
        return 503, "The AI usage limit for this plan has been reached for now (5-hour, weekly or monthly). Try again later."
    if error_type == "MissingSessionID":
        return 500, "The AI request was missing its session id (server configuration problem)."
    if status == 400:
        return 500, "The AI provider rejected the request."
    return 503, "The assistant is busy right now. Please try again in a moment."


def _tools_payload(declarations: list) -> list:
    return [{"type": "function", "name": t["function"]["name"], "description": t["function"]["description"],
             "parameters": t["function"]["parameters"], "strict": False} for t in declarations]


def to_input(items: list) -> list:
    """Neutral conversation items -> Responses API input items."""
    out = []
    for it in items:
        if it["role"] == "user":
            content = [{"type": "input_text", "text": it["text"] or " "}]
            if it.get("image"):
                url = it["image"] if it["image"].startswith("data:") else f"data:image/jpeg;base64,{it['image']}"
                content.append({"type": "input_image", "image_url": url})
            out.append({"role": "user", "content": content})
        elif it["role"] == "assistant":
            if it.get("text"):
                out.append({"role": "assistant", "content": [{"type": "output_text", "text": it["text"]}]})
            for c in it.get("calls", []):
                out.append({"type": "function_call", "call_id": c["id"], "name": c["name"], "arguments": json.dumps(c["args"])})
        elif it["role"] == "tool":
            for r in it["results"]:
                out.append({"type": "function_call_output", "call_id": r["id"], "output": json.dumps(r["response"])})
    return out


async def stream_turn(items: list, system: str, tool_declarations: list, session_id: str,
                      timeout: Optional[float] = None) -> AsyncIterator[tuple]:
    """Yield ("text", delta) and ("call", {"id", "name", "args"}) for one model turn."""
    key = api_key()
    if not key:
        raise HTTPException(503, "AI is not configured. Set OPENCODE_API_KEY to enable the assistant.")
    timeout = timeout or TIMEOUT
    body = {"model": MODEL, "instructions": system, "input": to_input(items), "stream": True, "max_output_tokens": 4096}
    if tool_declarations:
        body["tools"] = _tools_payload(tool_declarations)
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "text/event-stream",
               "x-opencode-session": session_id, "User-Agent": USER_AGENT}
    url = f"{BASE_URL}/openai/v1/responses"

    last: Optional[Tuple[int, str]] = None
    for attempt in range(MAX_ATTEMPTS):
        started = False
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10)) as client:
                async with client.stream("POST", url, headers=headers, json=body) as resp:
                    if resp.status_code != 200:
                        raw = (await resp.aread()).decode("utf-8", "replace")
                        try:
                            err = json.loads(raw).get("error", {})
                        except ValueError:
                            err = {}
                        etype = err.get("type", "") if isinstance(err, dict) else ""
                        logger.warning("opencode request failed: status=%s type=%s", resp.status_code, etype)
                        last = (resp.status_code, etype)
                        if resp.status_code in RETRY_STATUSES and attempt + 1 < MAX_ATTEMPTS:
                            await asyncio.sleep(1.0)
                            continue
                        code, msg = _user_message(resp.status_code, etype)
                        raise HTTPException(code, msg)

                    buffer = b""
                    async for chunk in resp.aiter_bytes():
                        buffer += chunk
                        while b"\n\n" in buffer:
                            frame, buffer = buffer.split(b"\n\n", 1)
                            for line in frame.decode("utf-8", "replace").split("\n"):
                                if not line.startswith("data: "):
                                    continue
                                try:
                                    ev = json.loads(line[6:])
                                except ValueError:
                                    continue
                                kind = ev.get("type")
                                if kind == "response.output_text.delta":
                                    started = True
                                    yield ("text", ev.get("delta", ""))
                                elif kind == "response.output_item.done" and ev.get("item", {}).get("type") == "function_call":
                                    item = ev["item"]
                                    started = True
                                    try:
                                        args = json.loads(item.get("arguments") or "{}")
                                    except ValueError:
                                        args = {}
                                    yield ("call", {"id": item.get("call_id"), "name": item.get("name"), "args": args})
                                elif kind in ("response.failed", "error"):
                                    detail = ev.get("response", {}).get("error") or ev.get("error") or {}
                                    logger.warning("opencode stream error: type=%s", detail.get("type") if isinstance(detail, dict) else "")
                                    raise HTTPException(503, "The assistant is busy right now. Please try again in a moment.")
                    return
        except HTTPException:
            raise
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            logger.warning("opencode transport problem: %s", type(exc).__name__)
            last = (0, type(exc).__name__)
            if started:
                raise HTTPException(503, "The connection to the assistant dropped. Please try again.")
            if attempt + 1 < MAX_ATTEMPTS:
                await asyncio.sleep(1.0)
                continue
            raise HTTPException(504 if isinstance(exc, httpx.TimeoutException) else 503,
                                "The assistant took too long to answer. Please try again." if isinstance(exc, httpx.TimeoutException)
                                else "Could not reach the AI provider. Please try again.")
    code, msg = _user_message(*(last or (503, "")))
    raise HTTPException(code, msg)
