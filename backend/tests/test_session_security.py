"""Session security: tokens die when the password changes or the user signs out everywhere (SEC-006 groundwork)."""
import asyncio
import uuid

import pytest
import requests
import support_db
from support_auth import BASE_URL

import server  # noqa: E402  (loads backend/.env)
from security_utils import create_refresh_token, hash_token  # noqa: E402

PW = "SessionPass1"


def _register(verified=True):
    email = f"session_{uuid.uuid4().hex[:8]}@example.com"
    assert requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": PW, "name": "s"}).status_code == 200
    code = support_db.verification_code_for(email)
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email=%s", (email,))
            uid = cur.fetchone()[0]
    finally:
        conn.close()
    if not verified:
        return email, uid, None
    r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code, "password": PW})
    assert r.status_code == 200, r.text
    return email, uid, r.json()


def _me(token):
    return requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code


def _refresh(token):
    return requests.post(f"{BASE_URL}/api/auth/refresh", json={"token": token})


def test_password_change_ends_other_sessions_but_keeps_this_one():
    email, uid, s = _register()
    other = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PW}).json()  # a second device
    r = requests.post(f"{BASE_URL}/api/auth/change-password", headers={"Authorization": f"Bearer {s['token']}"},
                      json={"current_password": PW, "new_password": "BrandNewPass2"})
    assert r.status_code == 200
    fresh = r.json()
    assert fresh["token"] and fresh["refresh_token"]  # this device continues without signing in again
    assert _me(fresh["token"]) == 200 and _refresh(fresh["refresh_token"]).status_code == 200
    for old in (s, other):  # every earlier access and refresh token is dead
        assert _me(old["token"]) == 401
        assert _refresh(old["refresh_token"]).status_code == 401


def test_sign_out_everywhere_revokes_every_token_including_this_one():
    email, uid, s = _register()
    other = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PW}).json()
    r = requests.post(f"{BASE_URL}/api/auth/logout-all", headers={"Authorization": f"Bearer {s['token']}"})
    assert r.status_code == 200
    for t in (s, other):
        assert _me(t["token"]) == 401 and _refresh(t["refresh_token"]).status_code == 401
    assert requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PW}).status_code == 200  # can sign in again


def test_logout_all_needs_a_session():
    assert requests.post(f"{BASE_URL}/api/auth/logout-all").status_code == 401


def test_refresh_gives_a_working_session():
    email, uid, s = _register()
    r = _refresh(s["refresh_token"])
    assert r.status_code == 200 and _me(r.json()["token"]) == 200


def test_password_reset_ends_existing_sessions_and_the_token_is_single_use():
    email, uid, s = _register()
    token = support_db.issue_reset_token(email)
    r = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": token, "password": "ResetPass123"})
    assert r.status_code == 200
    assert _me(s["token"]) == 401 and _refresh(s["refresh_token"]).status_code == 401
    assert _me(r.json()["token"]) == 200
    assert requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": token, "password": "Another123"}).status_code == 400


def test_a_stored_reset_token_hash_is_never_accepted_as_the_token():
    # Someone who reads the database sees only the hash; presenting it must not work.
    email, uid, s = _register()
    token = support_db.issue_reset_token(email)
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT password_reset_token FROM users WHERE email=%s", (email,))
            stored = cur.fetchone()[0]
    finally:
        conn.close()
    assert stored == hash_token(token) and stored != token
    assert requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": stored, "password": "Hacked12345"}).status_code == 400


def test_an_unverified_account_cannot_refresh_into_a_session():
    email, uid, _ = _register(verified=False)
    r = _refresh(create_refresh_token(uid))
    assert r.status_code in (401, 403)


# ---- rate limit kept in the database (survives restarts, shared by processes) ----

class _Req:
    client = type("C", (), {"host": "203.0.113.9"})()


def test_rate_limit_counts_in_the_database_and_blocks_after_the_maximum():
    ident = f"rl-{uuid.uuid4().hex}"

    async def go():
        from fastapi import HTTPException
        for _ in range(server.AUTH_RATE_LIMIT_MAX):
            await server.check_rate_limit(_Req(), ident)
        with pytest.raises(HTTPException) as exc:
            await server.check_rate_limit(_Req(), ident)
        assert exc.value.status_code == 429
        await server.check_rate_limit(_Req(), ident + "-other")  # a different identifier is unaffected

    asyncio.run(go())


def test_rate_limit_rows_hold_a_hash_not_the_email():
    ident = f"someone-{uuid.uuid4().hex}@example.com"
    asyncio.run(server.check_rate_limit(_Req(), ident))
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT bucket FROM rate_limit_events ORDER BY id DESC LIMIT 20")
            buckets = [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
    assert buckets and all(len(b) == 64 and "@" not in b for b in buckets)
