"""Sessions end when they should: sign-out, sign-out everywhere, password change, expiry, and a server restart.

A signed JWT is valid until it expires, wherever a copy of it ended up. These tests keep copies of the tokens, end the
session in every supported way, and prove the copies stop working on every protected route and on refresh. They use
several accounts, so one user's sign-out is also shown not to touch another user's session.
"""
import asyncio
import time
import uuid

import pymysql
import pytest
import requests

import support_db
from support_auth import BASE_URL
from support_users import PASSWORD, api, create_verified_user

import server  # noqa: E402  (loads backend/.env)
from security_utils import create_access_token, create_refresh_token  # noqa: E402

COOKIE = {"X-Auth-Mode": "cookie"}


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _me(token):
    return requests.get(f"{BASE_URL}/api/auth/me", headers=_bearer(token), timeout=30).status_code


def _data(token):
    """A route that returns the user's own data (needs a verified session)."""
    return requests.get(f"{BASE_URL}/api/tasks", headers=_bearer(token), timeout=30).status_code


def _login(user, **headers):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": user["password"]}, headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    return r


def _refresh(token=None, cookies=None, headers=None):
    return requests.post(f"{BASE_URL}/api/auth/refresh", json={"token": token} if token else {}, cookies=cookies, headers=headers or {}, timeout=30)


def _sql(query, args=(), fetch=False):
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(query, args)
            rows = cur.fetchall() if fetch else None
        conn.commit()
        return rows
    finally:
        conn.close()


def _session_ids(user_id):
    return {r[0] for r in _sql("SELECT id FROM auth_sessions WHERE user_id=%s", (user_id,), fetch=True)}


# -- signing out ends THIS session, for every copy of its tokens -----------------------------------------------------------

def test_logging_out_kills_the_access_token_and_the_refresh_token_even_when_copies_exist():
    user = create_verified_user("session")
    body = _login(user).json()  # a second sign-in: tokens in the JSON, as an API client or a stolen copy would hold them
    access, refresh = body["token"], body["refresh_token"]
    assert _data(access) == 200 and _refresh(refresh).status_code == 200

    assert requests.post(f"{BASE_URL}/api/auth/logout", headers=_bearer(access), timeout=30).status_code == 200

    assert _me(access) == 401 and _data(access) == 401, "the access token still works after signing out"
    assert _refresh(refresh).status_code == 401, "the refresh token still works after signing out"


def test_logging_out_with_only_the_refresh_cookie_still_ends_the_session():
    """An expired access token must not stop a user from signing out for real."""
    user = create_verified_user("session")
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": user["password"]}, headers=COOKIE, timeout=30)
    access = r.json()["token"]
    copy_of_cookie = s.cookies.get("lr_refresh", path="/api/auth")
    assert copy_of_cookie
    assert s.post(f"{BASE_URL}/api/auth/logout", headers=COOKIE, timeout=30).status_code == 200  # no Authorization header at all
    assert _data(access) == 401
    assert _refresh(copy_of_cookie, headers=COOKIE).status_code == 401


def test_logging_out_one_device_leaves_the_users_other_device_signed_in():
    user = create_verified_user("session")
    phone, laptop = _login(user).json()["token"], _login(user).json()["token"]
    assert len(_session_ids(user["id"])) == 3  # the signup verification plus these two
    requests.post(f"{BASE_URL}/api/auth/logout", headers=_bearer(phone), timeout=30)
    assert _data(phone) == 401 and _data(laptop) == 200 and _data(user["token"]) == 200


def test_logging_out_is_harmless_when_repeated_or_when_the_token_is_garbage():
    user = create_verified_user("session")
    for headers in (_bearer(user["token"]), _bearer(user["token"]), _bearer("not.a.token"), {}):
        assert requests.post(f"{BASE_URL}/api/auth/logout", headers=headers, timeout=30).status_code == 200


def test_one_users_sign_out_cannot_end_another_users_session():
    """The token names a session, but the session must also belong to the token's user."""
    a, b = create_verified_user("session"), create_verified_user("session")
    b_session = next(iter(_session_ids(b["id"])))
    forged = create_access_token(a["id"], a["email"], 0, b_session)  # A's identity, B's session id
    assert _data(forged) == 401
    requests.post(f"{BASE_URL}/api/auth/logout", headers=_bearer(forged), timeout=30)
    assert b_session in _session_ids(b["id"]) and _data(b["token"]) == 200


# -- other ways a session ends ------------------------------------------------------------------------------------------

def test_signing_out_everywhere_removes_every_session_row_and_kills_every_token():
    user = create_verified_user("session")
    tokens = [user["token"], _login(user).json()["token"], _login(user).json()["token"]]
    other = create_verified_user("session")
    assert requests.post(f"{BASE_URL}/api/auth/logout-all", headers=_bearer(tokens[1]), timeout=30).status_code == 200
    assert [_data(t) for t in tokens] == [401, 401, 401]
    assert _session_ids(user["id"]) == set()
    assert _data(other["token"]) == 200 and _session_ids(other["id"])


def test_changing_the_password_ends_every_other_session_and_gives_this_device_a_new_one():
    user = create_verified_user("session")
    other_device = _login(user).json()["token"]
    r = requests.post(f"{BASE_URL}/api/auth/change-password", headers=_bearer(user["token"]),
                      json={"current_password": PASSWORD, "new_password": "ChangedPass456"}, timeout=30)
    assert r.status_code == 200, r.text
    assert _data(user["token"]) == 401 and _data(other_device) == 401
    assert _data(r.json()["token"]) == 200 and len(_session_ids(user["id"])) == 1


def test_a_session_past_its_expiry_is_refused_and_cannot_be_refreshed():
    user = create_verified_user("session")
    refresh = _login(user).json()["refresh_token"]
    _sql("UPDATE auth_sessions SET expires_ms=%s WHERE user_id=%s", (int(time.time() * 1000) - 1000, user["id"]))
    assert _data(user["token"]) == 401
    assert _refresh(refresh).status_code == 401


def test_a_session_older_than_the_maximum_age_must_sign_in_again_however_active_it_was():
    user = create_verified_user("session")
    refresh = _login(user).json()["refresh_token"]
    long_ago = int(time.time() * 1000) - 400 * 86_400_000
    _sql("UPDATE auth_sessions SET created_ms=%s WHERE user_id=%s", (long_ago, user["id"]))  # still "recently used"
    assert _data(user["token"]) == 401 and _refresh(refresh).status_code == 401


def test_expired_sessions_are_deleted_when_someone_signs_in_so_they_do_not_pile_up():
    """An expired row is refused anyway, but nothing else removes it until the server restarts."""
    old = create_verified_user("session")
    refresh = _login(old).json()["refresh_token"]
    _sql("UPDATE auth_sessions SET expires_ms=%s WHERE user_id=%s", (int(time.time() * 1000) - 1000, old["id"]))
    assert len(_session_ids(old["id"])) == 2
    live = create_verified_user("session")  # any new sign-in
    assert _session_ids(old["id"]) == set(), "the expired sessions are still in the table"
    assert _refresh(refresh).status_code == 401 and _data(live["token"]) == 200


def test_refreshing_keeps_the_same_session_and_does_not_create_new_ones():
    user = create_verified_user("session")
    refresh = _login(user).json()["refresh_token"]
    before = _session_ids(user["id"])
    r = _refresh(refresh)
    assert r.status_code == 200 and _data(r.json()["token"]) == 200
    assert _session_ids(user["id"]) == before


# -- tokens that never had a session ---------------------------------------------------------------------------------------

def test_a_token_that_names_no_session_or_a_made_up_one_is_refused():
    user = create_verified_user("session")
    no_sid = create_access_token(user["id"], user["email"], 0)
    made_up = create_access_token(user["id"], user["email"], 0, str(uuid.uuid4()))
    assert _data(no_sid) == 401 and _data(made_up) == 401
    assert _refresh(create_refresh_token(user["id"], 0)).status_code == 401
    assert _refresh(create_refresh_token(user["id"], 0, str(uuid.uuid4()))).status_code == 401


def test_the_pre_verification_token_only_reaches_the_verification_screens_and_dies_once_verified():
    from support_users import signup, _code_for
    account = signup("session")
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": account["email"], "password": PASSWORD}, timeout=30)
    assert r.json()["requires_verification"] is True
    early = r.json()["token"]
    assert _me(early) == 200 and _data(early) == 403  # may ask who it is, may not touch data
    v = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": account["email"], "code": _code_for(account["email"])}, timeout=30)
    assert v.status_code == 200
    assert _me(early) == 401, "the pre-verification token must not become a full session"
    assert _data(v.json()["token"]) == 200


def test_an_access_token_in_a_cookie_is_not_a_credential():
    """Only the Authorization header counts: a browser sends cookies by itself, which is what cross-site attacks rely on."""
    user = create_verified_user("session")
    r = requests.get(f"{BASE_URL}/api/tasks", cookies={"access_token": user["token"]}, timeout=30)
    assert r.status_code == 401


def test_the_interactive_api_docs_and_schema_are_not_served():
    for path in ("/docs", "/redoc", "/openapi.json", "/api/docs", "/api/openapi.json"):
        assert requests.get(f"{BASE_URL}{path}", timeout=30).status_code in (404, 405), path


# -- the assistant stops when the session ends -------------------------------------------------------------------------------

def test_a_reply_that_is_running_when_the_user_signs_out_makes_no_further_change(monkeypatch):
    """The model answers with a tool call; the user signs out before it is carried out; the tool must not run."""
    user = create_verified_user("session")
    marker = f"after-logout-{uuid.uuid4().hex[:8]}"

    async def model(items, system, session_id, tools=None):
        requests.post(f"{BASE_URL}/api/auth/logout", headers=_bearer(user["token"]), timeout=30)  # signed out mid-reply
        yield ("call", {"id": "1", "name": "create_task", "args": {"title": marker}})

    monkeypatch.setattr(server, "_provider_stream", model)
    monkeypatch.setattr(server, "chat_unavailable", lambda: None)

    async def run():
        from database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            principal = {"_id": user["id"], "email": user["email"], "name": user["name"], "role": "user",
                         "_sid": next(iter(_session_ids(user["id"])))}
            return [ev async for ev in server.ai_chat_events(db, principal, server.AIChatBody(message="add a task"))]

    events = asyncio.run(run())
    assert events[-1]["type"] == "error" and events[-1]["status"] == 401
    assert not any(e["type"] == "tool" for e in events), events
    assert _sql("SELECT COUNT(*) FROM tasks WHERE user_id=%s AND title=%s", (user["id"], marker), fetch=True)[0][0] == 0


# -- a restart signs everyone out ----------------------------------------------------------------------------------------------

def test_restarting_the_server_signs_everyone_out_and_new_sign_ins_work():
    """A real second server on its own scratch schema, killed the hard way (as a crash would) and started again."""
    import isolated_env
    env = isolated_env.start(register_user=True, user_email="restart.test@example.com")
    try:
        base = env.base_url
        login = requests.post(f"{base}/api/auth/login", json={"email": env.user_email, "password": env.user_password}, timeout=30).json()
        access, refresh = login["token"], login["refresh_token"]
        assert requests.get(f"{base}/api/tasks", headers=_bearer(access), timeout=30).status_code == 200

        env.restart()

        assert requests.get(f"{base}/api/tasks", headers=_bearer(access), timeout=30).status_code == 401, "a restart must end the session"
        assert requests.post(f"{base}/api/auth/refresh", json={"token": refresh}, timeout=30).status_code == 401
        again = requests.post(f"{base}/api/auth/login", json={"email": env.user_email, "password": env.user_password}, timeout=30).json()
        assert requests.get(f"{base}/api/tasks", headers=_bearer(again["token"]), timeout=30).status_code == 200
    finally:
        env.stop()
