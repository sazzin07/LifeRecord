"""S-04: per-user limits on the endpoints that cost model quota or fill the disk.

The scratch server's assistant provider is a dead end on loopback and it has no Gemini key, so while under the limit the
chat/voice/receipt endpoints answer with an error rather than a result: no model is reachable, and the first refusal that
is a 429 is what this module is about."""
import asyncio
import hashlib
import struct
import time
import types
import zlib

from sqlalchemy import func, select

import usage_limits
from database import AsyncSessionLocal
from models import RateLimitEvent
from support_users import api, create_verified_user


# A chat message with a picture that is not a picture: refused right after the limit check and before any provider is
# touched, so the requests are fast and certainly cannot reach a model.
BAD_PICTURE = {"message": "hi", "image_base64": "data:text/plain;base64,aGk="}


def _png() -> bytes:
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b""))


def _hit_until_refused(call, limit):
    """Call `limit` times (each must be answered, not refused), then once more: return the refusal."""
    for i in range(limit):
        r = call()
        assert r.status_code != 429, f"refused too early, on request {i + 1} of {limit}"
    return call()


def _assert_human_429(r):
    assert r.status_code == 429, r.text
    detail = r.json()["detail"]
    assert "try again" in detail.lower() and len(detail) < 200
    assert int(r.headers["Retry-After"]) >= 1


def test_the_defaults_are_the_agreed_numbers():
    assert usage_limits.limit_for("ai_chat") == (20, 300)
    assert usage_limits.limit_for("ai_transcribe") == (10, 100)
    assert usage_limits.limit_for("ai_receipt") == (10, 50)
    assert usage_limits.limit_for("photo_upload") == (20, 100)


def test_limits_can_be_changed_from_the_environment(monkeypatch):
    monkeypatch.setenv("LIMIT_AI_CHAT_PER_MINUTE", "3")
    monkeypatch.setenv("LIMIT_AI_CHAT_PER_DAY", "7")
    assert usage_limits.limit_for("ai_chat") == (3, 7)
    monkeypatch.setenv("LIMIT_AI_CHAT_PER_MINUTE", "nonsense")  # a typo must not switch the limit off
    assert usage_limits.limit_for("ai_chat") == (20, 7)


def test_the_21st_chat_message_in_a_minute_is_refused_with_a_human_message():
    user = create_verified_user("limits")
    s = user["session"]
    r = _hit_until_refused(lambda: s.post(api(user, "/ai/chat"), json=BAD_PICTURE, timeout=20), 20)
    _assert_human_429(r)


def test_limits_belong_to_one_user_only():
    a, b = create_verified_user("limits"), create_verified_user("limits")
    _assert_human_429(_hit_until_refused(lambda: a["session"].post(api(a, "/ai/chat"), json=BAD_PICTURE, timeout=20), 20))
    assert b["session"].post(api(b, "/ai/chat"), json=BAD_PICTURE, timeout=20).status_code != 429


def test_streaming_chat_is_refused_as_a_normal_response_before_any_stream_starts():
    user = create_verified_user("limits")
    s = user["session"]
    r = _hit_until_refused(lambda: s.post(api(user, "/ai/chat/stream"), json=BAD_PICTURE, timeout=20), 20)
    _assert_human_429(r)
    assert r.headers["content-type"].startswith("application/json")


def test_receipt_scans_are_limited():
    user = create_verified_user("limits")
    s = user["session"]
    r = _hit_until_refused(lambda: s.post(api(user, "/ai/receipt"), json={"image_base64": "x"}, timeout=20), 10)
    _assert_human_429(r)


def test_voice_transcription_is_limited():
    user = create_verified_user("limits")
    s = user["session"]
    call = lambda: s.post(api(user, "/ai/transcribe"), files={"file": ("a.webm", b"x", "audio/webm")}, timeout=20)
    _assert_human_429(_hit_until_refused(call, 10))


def test_photo_uploads_are_limited():
    user = create_verified_user("limits")
    s = user["session"]
    png = _png()
    call = lambda: s.post(api(user, "/photos"), files={"file": ("p.png", png, "image/png")}, timeout=20)
    r = _hit_until_refused(call, 20)
    _assert_human_429(r)
    assert len(s.get(api(user, "/photos"), timeout=20).json()) == 20  # the refused one was not stored


# -- the daily window and the shared event table -------------------------------------------------------------------

def _bucket(user_id, scope):
    return hashlib.sha256(f"user:{user_id}:{scope}".encode()).hexdigest()


def _run(coro):
    return asyncio.run(coro)


def _insert_events(bucket, count, age_seconds):
    async def go():
        async with AsyncSessionLocal() as db:
            at = int(time.time() * 1000) - age_seconds * 1000
            db.add_all([RateLimitEvent(bucket=bucket, at_ms=at + i) for i in range(count)])
            await db.commit()
    _run(go())


def _count(bucket):
    async def go():
        async with AsyncSessionLocal() as db:
            return (await db.execute(select(func.count(RateLimitEvent.id)).where(RateLimitEvent.bucket == bucket))).scalar()
    return _run(go())


def test_the_daily_cap_counts_the_whole_day_and_says_so():
    user = create_verified_user("limits")
    _insert_events(_bucket(user["id"], "ai_receipt"), 50, age_seconds=3 * 3600)  # 50 scans, three hours ago
    r = user["session"].post(api(user, "/ai/receipt"), json={"image_base64": "x"}, timeout=20)
    assert r.status_code == 429
    assert "today" in r.json()["detail"].lower() and "try again" in r.json()["detail"].lower()
    assert int(r.headers["Retry-After"]) > 3600  # hours, not seconds


def test_the_daily_cap_survives_the_cleanup_that_the_login_limiter_runs(monkeypatch):
    """check_rate_limit used to delete every event older than two minutes, which would silently erase day counts."""
    import server
    user = create_verified_user("limits")
    bucket = _bucket(user["id"], "ai_receipt")
    _insert_events(bucket, 5, age_seconds=3 * 3600)
    monkeypatch.setattr(server.secrets, "randbelow", lambda n: 0)  # take the cleanup branch every time
    fake_request = types.SimpleNamespace(client=types.SimpleNamespace(host="127.0.0.1"))
    _run(server.check_rate_limit(fake_request, f"cleanup-probe-{user['id']}"))
    assert _count(bucket) == 5


def test_events_older_than_a_day_are_cleaned_up():
    user = create_verified_user("limits")
    bucket = _bucket(user["id"], "photo_upload")
    _insert_events(bucket, 3, age_seconds=26 * 3600)

    async def go():
        async with AsyncSessionLocal() as db:
            await usage_limits.prune_old_events(db, int(time.time() * 1000))
            await db.commit()
    _run(go())
    assert _count(bucket) == 0
