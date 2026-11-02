"""Refresh tokens are used once: every refresh hands out a new one, and a copy of an old one is noticed.

A refresh token that never changes is valid for as long as its session lives, so a copy taken from a disk, a backup or a
proxy log works for weeks and nobody can tell. Here each refresh replaces it; the one just replaced still works for a short
grace period (two tabs refreshing at the same moment are normal and must both succeed), and anything older ends the whole
session, because a stolen copy is the likeliest explanation.
"""
import concurrent.futures as futures
import time

import requests

import support_db
from support_auth import BASE_URL
from support_users import PASSWORD, create_verified_user

from security_utils import create_refresh_token

COOKIE = {"X-Auth-Mode": "cookie"}


def _login(user):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _refresh(refresh_token):
    return requests.post(f"{BASE_URL}/api/auth/refresh", json={"token": refresh_token}, timeout=30)


def _me(access_token):
    return requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {access_token}"}, timeout=30).status_code


def _sql(query, args=()):
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(query, args)
            rows = cur.fetchall()
        conn.commit()
        return rows
    finally:
        conn.close()


def _session_of(user):
    return _sql("SELECT s.id FROM auth_sessions s JOIN auth_session_info i ON i.session_id = s.id WHERE s.user_id=%s ORDER BY i.last_seen_ms DESC", (user["id"],))[0][0]


def test_every_refresh_hands_out_a_new_refresh_token_and_each_one_works():
    user = create_verified_user("authtest")
    first = _login(user)["refresh_token"]
    second = _refresh(first)
    assert second.status_code == 200
    newer = second.json()["refresh_token"]
    assert newer and newer != first
    third = _refresh(newer)
    assert third.status_code == 200 and third.json()["refresh_token"] != newer


def test_the_token_just_replaced_still_works_for_a_moment_so_two_tabs_can_refresh_together():
    user = create_verified_user("authtest")
    old = _login(user)["refresh_token"]
    assert _refresh(old).status_code == 200
    again = _refresh(old)  # the other tab, a moment later, still holding what the first one held
    assert again.status_code == 200 and _me(again.json()["token"]) == 200
    assert _refresh(again.json()["refresh_token"]).status_code == 200, "the token the second tab was given must be a good one"


def test_six_simultaneous_refreshes_with_one_token_all_succeed_and_the_session_survives():
    user = create_verified_user("authtest")
    token = _login(user)["refresh_token"]
    with futures.ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda _: _refresh(token), range(6)))
    assert [a.status_code for a in answers] == [200] * 6, [a.text for a in answers if a.status_code != 200]
    assert all(_me(a.json()["token"]) == 200 for a in answers)
    assert _refresh(answers[0].json()["refresh_token"]).status_code == 200


def test_an_old_token_used_after_the_grace_period_ends_the_session_for_everyone_holding_it():
    user = create_verified_user("authtest")
    stolen = _login(user)["refresh_token"]
    legit = _refresh(stolen).json()  # the real browser refreshed; the copy is now one step behind
    sid = _session_of(user)
    _sql("UPDATE auth_session_info SET rotated_ms = rotated_ms - %s WHERE session_id=%s", (10 * 60 * 1000, sid))  # ten minutes pass

    assert _refresh(stolen).status_code == 401, "an old token after the grace period must be refused"
    assert _refresh(legit["refresh_token"]).status_code == 401, "the session cannot be trusted any more: the real holder signs in again"
    assert _me(legit["token"]) == 401
    assert _sql("SELECT COUNT(*) FROM auth_sessions WHERE id=%s", (sid,))[0][0] == 0


def test_a_token_two_steps_old_is_refused_at_once_even_inside_the_grace_period():
    user = create_verified_user("authtest")
    t0 = _login(user)["refresh_token"]
    t1 = _refresh(t0).json()["refresh_token"]
    t2 = _refresh(t1).json()
    assert _refresh(t0).status_code == 401
    assert _me(t2["token"]) == 401, "using it ended the session"


def test_a_refresh_token_that_names_no_generation_is_refused_and_ends_the_session():
    user = create_verified_user("authtest")
    sid = _session_of(user)
    no_generation = create_refresh_token(user["id"], 0, sid)  # signed and real, but from before tokens had generations
    assert _refresh(no_generation).status_code == 401
    assert _me(user["token"]) == 401


def test_signing_out_with_a_replaced_cookie_still_ends_the_session():
    user = create_verified_user("authtest")
    s = requests.Session()
    s.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD}, headers=COOKIE, timeout=30)
    old = s.cookies.get("lr_refresh", path="/api/auth")
    assert s.post(f"{BASE_URL}/api/auth/refresh", json={}, headers=COOKIE, timeout=30).status_code == 200
    new = s.cookies.get("lr_refresh", path="/api/auth")
    assert old and new and old != new, "the cookie is replaced on every refresh"
    # the copy of the OLD cookie is all that is presented: signing out must still work, it never fails
    assert requests.post(f"{BASE_URL}/api/auth/logout", cookies={"lr_refresh": old}, timeout=30).status_code == 200
    assert requests.post(f"{BASE_URL}/api/auth/refresh", json={}, cookies={"lr_refresh": new}, headers=COOKIE, timeout=30).status_code == 401


def test_each_session_has_one_row_of_generations_and_it_goes_with_the_session():
    user = create_verified_user("authtest")
    second = _login(user)
    assert _sql("SELECT COUNT(*) FROM auth_session_info WHERE user_id=%s", (user["id"],))[0][0] == 2
    requests.post(f"{BASE_URL}/api/auth/logout", headers={"Authorization": f"Bearer {second['token']}"}, timeout=30)
    assert _sql("SELECT COUNT(*) FROM auth_session_info WHERE user_id=%s", (user["id"],))[0][0] == 1
    requests.post(f"{BASE_URL}/api/auth/logout-all", headers={"Authorization": f"Bearer {user['token']}"}, timeout=30)
    assert _sql("SELECT COUNT(*) FROM auth_session_info WHERE user_id=%s", (user["id"],))[0][0] == 0


def test_a_refresh_moves_the_last_seen_time_forward():
    user = create_verified_user("authtest")
    token = _login(user)["refresh_token"]
    sid = _session_of(user)
    _sql("UPDATE auth_session_info SET last_seen_ms = last_seen_ms - %s WHERE session_id=%s", (3_600_000, sid))
    before = _sql("SELECT last_seen_ms FROM auth_session_info WHERE session_id=%s", (sid,))[0][0]
    _refresh(token)
    after = _sql("SELECT last_seen_ms FROM auth_session_info WHERE session_id=%s", (sid,))[0][0]
    assert after >= before + 3_000_000 and after <= int(time.time() * 1000) + 1000


def test_extending_a_session_that_was_ended_a_moment_ago_is_a_refusal_not_a_server_error():
    """A refresh and a sign-out can cross: the refresh has found the session and, by the time it extends it, the row is gone."""
    import asyncio

    import pytest
    from fastapi import HTTPException

    import auth_sessions
    from database import AsyncSessionLocal

    user = create_verified_user("authtest")

    async def go():
        async with AsyncSessionLocal() as db:  # one database session throughout, as a request has
            session, _ = await auth_sessions.start(db, user["id"])
            _sql("DELETE FROM auth_sessions WHERE id=%s", (session.id,))  # a sign-out from somewhere else, in between
            with pytest.raises(HTTPException) as refused:
                await auth_sessions.extend(db, session)
            assert refused.value.status_code == 401

    asyncio.run(go())


# -- a refresh whose answer never arrived ------------------------------------------------------------------------------------
# The server replaced the token, the network dropped before the browser heard, and the browser asks again with the OLD token.
# That must not look like theft. The browser sends a random key with each refresh and repeats the same key when it asks
# again; the server remembers (a hash of) the key that produced the current token and answers a repeat with the same token,
# however late (within REFRESH_RETRY_HOURS). A copy of the cookie alone has no key, so it gets nothing extra.

HOUR_MS = 3_600_000


def _refresh_keyed(refresh_token, key):
    return requests.post(f"{BASE_URL}/api/auth/refresh", json={"token": refresh_token}, headers={"X-Refresh-Key": key}, timeout=30)


def _jti(token):
    import jwt
    return jwt.decode(token, options={"verify_signature": False}).get("jti")


def _age_rotation(user, hours):
    _sql("UPDATE auth_session_info SET rotated_ms = rotated_ms - %s WHERE user_id=%s", (int(hours * HOUR_MS), user["id"]))


KEY = "k" * 32


def test_a_retry_with_the_same_key_gets_the_same_new_token_however_late():
    user = create_verified_user("authtest")
    old = _login(user)["refresh_token"]
    lost = _refresh_keyed(old, KEY).json()["refresh_token"]   # the server rotated; imagine this answer never arrived
    _age_rotation(user, 6)                                       # the laptop was shut for six hours
    again = _refresh_keyed(old, KEY)
    assert again.status_code == 200, again.text
    assert _jti(again.json()["refresh_token"]) == _jti(lost), "the retry is answered with the SAME generation, not a new one"
    assert _me(again.json()["token"]) == 200
    assert _refresh(again.json()["refresh_token"]).status_code == 200, "and the session carries on from there"


def test_the_same_late_retry_without_the_key_is_what_a_stolen_copy_looks_like():
    user = create_verified_user("authtest")
    old = _login(user)["refresh_token"]
    legit = _refresh_keyed(old, KEY).json()
    _age_rotation(user, 6)
    assert _refresh(old).status_code == 401, "no key: the old token, hours later, is a copy"
    assert _me(legit["token"]) == 401, "and the session is ended for whoever holds it"


def test_a_different_key_is_no_better_than_none():
    user = create_verified_user("authtest")
    old = _login(user)["refresh_token"]
    _refresh_keyed(old, KEY)
    _age_rotation(user, 6)
    assert _refresh_keyed(old, "z" * 32).status_code == 401


def test_the_key_stops_helping_after_the_retry_window():
    user = create_verified_user("authtest")
    old = _login(user)["refresh_token"]
    _refresh_keyed(old, KEY)
    _age_rotation(user, 25)
    assert _refresh_keyed(old, KEY).status_code == 401


def test_a_retry_does_not_rotate_again_so_the_token_that_did_arrive_still_works():
    """If the first answer DID arrive after all (the browser only thought it had not), both are the same token."""
    user = create_verified_user("authtest")
    old = _login(user)["refresh_token"]
    first = _refresh_keyed(old, KEY).json()["refresh_token"]
    _age_rotation(user, 2)
    assert _refresh_keyed(old, KEY).status_code == 200
    assert _refresh(first).status_code == 200


def test_a_key_that_is_junk_is_ignored_not_an_error():
    user = create_verified_user("authtest")
    token = _login(user)["refresh_token"]
    assert _refresh_keyed(token, "x").status_code == 200   # too short to be a key: treated as no key


def test_the_key_works_in_cookie_mode_and_the_cookie_is_the_same_generation():
    user = create_verified_user("authtest")
    s = requests.Session()
    s.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD}, headers=COOKIE, timeout=30)
    old_cookie = s.cookies.get("lr_refresh", path="/api/auth")
    headers = {**COOKIE, "X-Refresh-Key": KEY}
    first = requests.post(f"{BASE_URL}/api/auth/refresh", json={}, cookies={"lr_refresh": old_cookie}, headers=headers, timeout=30)
    new_cookie = next(c for c in first.raw.headers.getlist("Set-Cookie") if c.startswith("lr_refresh=")).split(";")[0].split("=", 1)[1]
    _age_rotation(user, 3)
    retry = requests.post(f"{BASE_URL}/api/auth/refresh", json={}, cookies={"lr_refresh": old_cookie}, headers=headers, timeout=30)
    assert retry.status_code == 200
    retried = next(c for c in retry.raw.headers.getlist("Set-Cookie") if c.startswith("lr_refresh=")).split(";")[0].split("=", 1)[1]
    assert _jti(retried) == _jti(new_cookie)


def test_the_browser_is_allowed_to_send_the_key_across_origins():
    r = requests.options(f"{BASE_URL}/api/auth/refresh", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST",
                                                                  "Access-Control-Request-Headers": "x-auth-mode,x-refresh-key,content-type"}, timeout=30)
    assert r.status_code == 200 and "x-refresh-key" in r.headers.get("access-control-allow-headers", "").lower(), r.headers
