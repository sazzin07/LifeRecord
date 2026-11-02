"""Authentication hardening: what the 2026-11 audit found beyond sessions.

Each test names one way the sign-up, verification, reset and sign-in paths could be abused, and proves it cannot be. They
use several throw-away accounts (prefix `authtest`, removed by conftest) and only the public API; the only database access
is for what a person would read in an email (the code) or set by waiting (an expiry).

Sign-in attempts from "other addresses" are simulated with X-Forwarded-For, which the test server honours because the
requests come from 127.0.0.1, the one address uvicorn trusts to name a client.
"""
import concurrent.futures as futures
import os
import subprocess
import sys
import uuid
from pathlib import Path

import bcrypt
import pytest
import requests

import support_db
from support_auth import BASE_URL
from support_users import PASSWORD, create_verified_user, signup

BACKEND = Path(__file__).resolve().parents[1]
FAILED = "That code is invalid or has expired. Check the newest email we sent, or request a new code."
LONG = "Aa1" + "x" * 70  # 73 bytes: one more than bcrypt reads


def _post(path, body, ip=None, token=None):
    headers = {}
    if ip:
        headers["X-Forwarded-For"] = ip
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.post(f"{BASE_URL}/api{path}", json=body, headers=headers, timeout=60)


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


def _verify(email, code, password=PASSWORD):
    return _post("/auth/verify", {"email": email, "code": code, "password": password})


def _fresh_email():
    return f"authtest_{uuid.uuid4().hex[:8]}@example.com"


def _wrong_code(email):
    real = support_db.verification_code_for(email)
    return "000000" if real != "000000" else "000001"


# -- the emailed code ----------------------------------------------------------------------------------------------------

def test_the_code_alone_is_not_enough_the_password_chosen_at_sign_up_goes_with_it():
    account = signup("authtest")
    code = support_db.verification_code_for(account["email"])
    assert _verify(account["email"], code, "Wrong-pass-1").status_code == 400
    assert _post("/auth/verify", {"email": account["email"], "code": code}).status_code == 422  # a client that omits it is told so
    ok = _verify(account["email"], code)
    assert ok.status_code == 200 and ok.json()["user"]["email_verified"] is True


def test_the_database_holds_a_fingerprint_of_the_emailed_code_and_never_the_code():
    account = signup("authtest")
    stored = _sql("SELECT verification_code FROM users WHERE email=%s", (account["email"],))[0][0]
    assert len(stored) == 10 and not (stored.isdigit() and len(stored) == 6), f"stored as {stored!r}"
    # a row that still held the plain code (an old row, or one written by hand) is not accepted
    _sql("UPDATE users SET verification_code=%s WHERE email=%s", ("135790", account["email"]))
    assert _verify(account["email"], "135790").status_code == 400


def test_a_fingerprint_belongs_to_one_code_for_one_account_and_one_secret():
    import verification_codes as vc
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    base = vc.fingerprint("s" * 32, a, "123456")
    assert len(base) == vc.FINGERPRINT_LENGTH and base == vc.fingerprint("s" * 32, a, "123456")
    assert base != vc.fingerprint("s" * 32, b, "123456"), "moved to another account"
    assert base != vc.fingerprint("s" * 32, a, "123457"), "another code"
    assert base != vc.fingerprint("t" * 32, a, "123456"), "another secret"
    assert vc.matches(base, "s" * 32, a, "123456") and not vc.matches(base, "s" * 32, a, "000000") and not vc.matches("", "s" * 32, a, "123456")


def test_registering_an_address_that_is_waiting_for_a_code_replaces_what_the_first_registration_chose():
    """Someone who signs up with another person's address first must not be able to hand that person a password."""
    email = _fresh_email()
    assert _post("/auth/register", {"email": email, "password": "Mallory123", "name": "Mallory"}).status_code == 200
    assert _post("/auth/register", {"email": email, "password": "Owner12345", "name": "The Owner"}).status_code == 200
    code = support_db.verification_code_for(email)
    assert _verify(email, code, "Mallory123").status_code == 400, "the first registration's password must be gone"
    done = _verify(email, code, "Owner12345")
    assert done.status_code == 200 and done.json()["user"]["name"] == "The Owner"
    assert _post("/auth/login", {"email": email, "password": "Mallory123"}).status_code == 401


def test_a_registration_that_arrives_after_the_owners_cannot_hand_over_a_password_either():
    email = _fresh_email()
    _post("/auth/register", {"email": email, "password": "Owner12345", "name": "The Owner"})
    _post("/auth/register", {"email": email, "password": "Mallory123", "name": "Mallory"})  # replaces it, nothing is verified yet
    code = support_db.verification_code_for(email)
    assert _verify(email, code, "Owner12345").status_code == 400  # fails closed: the owner is asked to start again


def test_a_verified_account_is_left_alone_by_a_later_registration():
    user = create_verified_user("authtest")
    assert _post("/auth/register", {"email": user["email"], "password": "Mallory123", "name": "Mallory"}).status_code == 200
    assert _post("/auth/login", {"email": user["email"], "password": PASSWORD}).status_code == 200
    assert _post("/auth/login", {"email": user["email"], "password": "Mallory123"}).status_code == 401
    assert user["session"].get(f"{BASE_URL}/api/auth/me").json()["name"] == user["name"]


def test_parallel_wrong_codes_use_up_exactly_the_five_attempts():
    """The attempt counter is advanced by the database, so ten simultaneous guesses cannot all read the same count."""
    account = signup("authtest")
    wrong = _wrong_code(account["email"])
    with futures.ThreadPoolExecutor(10) as pool:
        list(pool.map(lambda i: _verify(account["email"], f"{900000 + i:06d}" if f"{900000 + i:06d}" != wrong else "900100"), range(10)))
    attempts = _sql("SELECT verification_attempts FROM users WHERE email=%s", (account["email"],))[0][0]
    assert attempts == 5, f"{attempts} attempts were counted for ten guesses; the limit is five"
    assert _verify(account["email"], support_db.verification_code_for(account["email"])).status_code in (400, 429)


def test_every_way_a_code_can_fail_reads_the_same_so_nobody_can_tell_who_has_an_account():
    waiting = signup("authtest")
    locked = signup("authtest")
    expired = signup("authtest")
    verified = create_verified_user("authtest")
    ghost = _fresh_email()
    _sql("UPDATE users SET verification_code_expires_at=%s WHERE email=%s", ("2020-01-01T00:00:00+00:00", expired["email"]))
    for _ in range(5):
        _verify(locked["email"], _wrong_code(locked["email"]))
    cases = {
        "nobody": (ghost, "123456"),
        "already verified": (verified["email"], "123456"),
        "waiting, wrong code": (waiting["email"], _wrong_code(waiting["email"])),
        "waiting, locked out": (locked["email"], support_db.verification_code_for(locked["email"])),
        "waiting, expired": (expired["email"], support_db.verification_code_for(expired["email"])),
    }
    answers = {}
    for name, (email, code) in cases.items():
        r = _verify(email, code)
        answers[name] = (r.status_code, r.json().get("detail"))
    assert set(answers.values()) == {(400, FAILED)}, answers


def test_asking_for_another_code_does_not_reveal_whether_an_address_is_waiting_for_one():
    waiting = signup("authtest")
    ghost = _fresh_email()
    _sql("UPDATE users SET last_verification_sent_at='2000-01-01T00:00:00+00:00' WHERE email=%s", (waiting["email"],))
    first = _post("/auth/resend-verification", {"email": waiting["email"]})   # really sends
    second = _post("/auth/resend-verification", {"email": waiting["email"]})  # inside the 90-second wait
    nobody = _post("/auth/resend-verification", {"email": ghost})
    shape = lambda r: (r.status_code, r.json())  # noqa: E731
    assert shape(first) == shape(second) == shape(nobody), (shape(first), shape(second), shape(nobody))


# -- sign-up -------------------------------------------------------------------------------------------------------------

def test_registering_an_address_that_already_has_an_account_is_rate_limited_like_any_other_attempt():
    user = create_verified_user("authtest")
    answers = [_post("/auth/register", {"email": user["email"], "password": "Another123", "name": "x"}).status_code for _ in range(14)]
    assert 429 in answers, answers


def test_a_password_bcrypt_would_cut_short_is_refused_with_a_reason_at_sign_up_change_and_reset():
    r = _post("/auth/register", {"email": _fresh_email(), "password": LONG, "name": "Long"})
    assert r.status_code == 400 and "72" in r.json()["detail"], r.text
    user = create_verified_user("authtest")
    r = _post("/auth/change-password", {"current_password": PASSWORD, "new_password": LONG}, token=user["token"])
    assert r.status_code == 400 and "72" in r.json()["detail"], r.text
    token = support_db.issue_reset_token(user["email"])
    r = _post("/auth/reset-password", {"token": token, "password": LONG})
    assert r.status_code == 400 and "72" in r.json()["detail"], r.text
    assert _post("/auth/reset-password", {"token": token, "password": "Fine-pass-9"}).status_code == 200, "a refused reset must not use up the link"


def test_72_bytes_is_the_limit_and_it_counts_bytes_not_characters():
    exactly = "Aa1" + "x" * 69
    assert len(exactly.encode()) == 72
    assert _post("/auth/register", {"email": _fresh_email(), "password": exactly, "name": "Edge"}).status_code == 200
    accents = "Aa1" + "é" * 36  # 36 characters, 72 + 3 bytes
    assert len(accents) < 72 < len(accents.encode())
    assert _post("/auth/register", {"email": _fresh_email(), "password": accents, "name": "Edge"}).status_code == 400


def test_an_account_whose_password_was_set_before_the_limit_still_signs_in():
    user = create_verified_user("authtest")
    old = "Zz9" + "y" * 97
    _sql("UPDATE users SET password_hash=%s WHERE id=%s", (bcrypt.hashpw(old.encode(), bcrypt.gensalt()).decode(), user["id"]))
    assert _post("/auth/login", {"email": user["email"], "password": old}).status_code == 200
    assert _post("/auth/login", {"email": user["email"], "password": old[:72]}).status_code == 200  # what bcrypt always compared


# -- password reset -----------------------------------------------------------------------------------------------------

def test_using_a_reset_link_also_proves_the_address_so_the_account_is_confirmed():
    account = signup("authtest")  # never entered the code
    token = support_db.issue_reset_token(account["email"])
    r = _post("/auth/reset-password", {"token": token, "password": "Brand-new-1"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email_verified"] is True
    assert requests.get(f"{BASE_URL}/api/tasks", headers={"Authorization": f"Bearer {r.json()['token']}"}, timeout=30).status_code == 200


def test_changing_the_password_cancels_a_reset_link_that_was_already_sent():
    user = create_verified_user("authtest")
    link = support_db.issue_reset_token(user["email"])
    assert _post("/auth/change-password", {"current_password": PASSWORD, "new_password": "Changed-pass-2"}, token=user["token"]).status_code == 200
    assert _post("/auth/reset-password", {"token": link, "password": "Taken-over-3"}).status_code == 400
    assert _post("/auth/login", {"email": user["email"], "password": "Changed-pass-2"}).status_code == 200


# -- guessing passwords --------------------------------------------------------------------------------------------------

def test_simultaneous_requests_cannot_slip_past_the_limit():
    """A burst must not all see an empty window. (Sign-in is slow enough on its own, bcrypt holds the server for each check,
    so the burst is aimed at an endpoint that does no hashing.)"""
    user = create_verified_user("authtest")
    with futures.ThreadPoolExecutor(30) as pool:
        answers = list(pool.map(lambda _: _post("/auth/forgot-password", {"email": user["email"]}).status_code, range(30)))
    allowed = answers.count(200)
    assert allowed <= 12, f"{allowed} of 30 simultaneous requests were let through; the limit is 10 a minute"


def _fail(email, n):
    return _post("/auth/login", {"email": email, "password": "Wrong-pass-1"}, ip=f"198.51.100.{n}").status_code


def _browser(user):
    """A browser that has signed in to this account before: it holds the cookies the app sets in cookie mode."""
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD},
               headers={"X-Auth-Mode": "cookie", "X-Forwarded-For": "192.0.2.10"}, timeout=60)
    assert r.status_code == 200, r.text
    return s


def _sign_in_from(browser, user, password=PASSWORD, ip="192.0.2.11"):
    return browser.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": password},
                        headers={"X-Auth-Mode": "cookie", "X-Forwarded-For": ip}, timeout=60)


def test_guessing_one_accounts_password_from_many_addresses_is_stopped():
    user = create_verified_user("authtest")
    answers = [_fail(user["email"], n) for n in range(1, 31)]
    assert answers.count(401) <= 20 and 429 in answers, answers
    # a stranger holding even the right password waits, because nothing tells them apart from the one guessing
    r = _post("/auth/login", {"email": user["email"], "password": PASSWORD}, ip="198.51.100.200")
    assert r.status_code == 429 and "try again" in r.json()["detail"].lower(), r.text


def test_someone_who_only_knows_the_address_cannot_lock_the_owner_out_of_a_browser_they_already_use():
    user = create_verified_user("authtest")
    mine = _browser(user)
    assert 429 in [_fail(user["email"], n) for n in range(1, 31)], "the attack must have locked the account for new devices"
    again = _sign_in_from(mine, user)
    assert again.status_code == 200, f"the owner's own browser was held up by someone else's guessing: {again.text}"
    # the owner signing in with the right password ends the run of failures for everyone: the next new device gets in too
    assert _post("/auth/login", {"email": user["email"], "password": PASSWORD}, ip="198.51.100.201").status_code == 200


def test_a_device_cookie_from_another_account_or_a_forged_one_is_no_help():
    victim, other = create_verified_user("authtest"), create_verified_user("authtest")
    others_browser = _browser(other)
    assert 429 in [_fail(victim["email"], n) for n in range(1, 31)]
    borrowed = {"lr_device": others_browser.cookies.get("lr_device", path="/api/auth")}
    assert borrowed["lr_device"], "the other browser should have been given a device cookie"
    for cookies in (borrowed, {"lr_device": "not-a-token"}, {"lr_device": borrowed["lr_device"][:-3] + "abc"}):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": victim["email"], "password": PASSWORD}, cookies=cookies,
                          headers={"X-Forwarded-For": "198.51.100.210"}, timeout=60)
        assert r.status_code == 429, (cookies, r.text)


def test_wrong_passwords_typed_on_a_familiar_browser_do_not_count_against_new_devices():
    user = create_verified_user("authtest")
    mine = _browser(user)
    assert [_sign_in_from(mine, user, "Wrong-pass-1", ip=f"192.0.2.{50 + n}").status_code for n in range(6)] == [401] * 6
    assert [_fail(user["email"], n) for n in range(1, 21)].count(401) == 20, "familiar-browser typos used up the new-device allowance"


def test_a_familiar_browser_has_its_own_larger_allowance_so_a_stolen_cookie_is_not_a_free_pass(monkeypatch):
    import asyncio
    import server
    monkeypatch.setattr(server, "LOGIN_LOCK_FAMILIAR_MAX", 3)
    email = _fresh_email()

    async def go():
        for _ in range(3):
            await server.throttle_login(email, familiar=True)
        with pytest.raises(server.HTTPException) as refused:
            await server.throttle_login(email, familiar=True)
        assert refused.value.status_code == 429
        await server.throttle_login(email, familiar=False)  # the strangers' count is separate

    asyncio.run(go())


def test_using_the_reset_link_lifts_the_lock_for_every_device():
    user = create_verified_user("authtest")
    assert 429 in [_fail(user["email"], n) for n in range(1, 31)]
    link = support_db.issue_reset_token(user["email"])
    assert _post("/auth/reset-password", {"token": link, "password": "Back-in-4"}).status_code == 200
    assert _post("/auth/login", {"email": user["email"], "password": "Back-in-4"}, ip="198.51.100.220").status_code == 200


def test_the_device_cookie_is_http_only_scoped_to_sign_in_and_only_given_to_browsers():
    user = create_verified_user("authtest")
    cookie_mode = requests.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD},
                                headers={"X-Auth-Mode": "cookie"}, timeout=60)
    header = next(c for c in cookie_mode.raw.headers.getlist("Set-Cookie") if c.startswith("lr_device="))
    assert "HttpOnly" in header and "Path=/api/auth" in header and "SameSite=lax" in header.replace("Lax", "lax"), header
    assert "lr_device" not in cookie_mode.text
    api_client = requests.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD}, timeout=60)
    assert not any(c.startswith("lr_device=") for c in api_client.raw.headers.getlist("Set-Cookie"))


def test_a_successful_sign_in_clears_the_failed_attempts():
    user = create_verified_user("authtest")
    assert [_fail(user["email"], n) for n in range(1, 16)].count(401) == 15
    assert _post("/auth/login", {"email": user["email"], "password": PASSWORD}, ip="198.51.100.100").status_code == 200
    assert [_fail(user["email"], n) for n in range(110, 125)].count(401) == 15  # a fresh count, nothing refused


def test_addresses_without_an_account_are_throttled_exactly_like_real_ones():
    ghost = _fresh_email()
    answers = [_fail(ghost, n) for n in range(1, 31)]
    assert answers.count(401) <= 20 and 429 in answers, answers


# -- sessions and secrets ------------------------------------------------------------------------------------------------

def test_one_user_cannot_pile_up_sessions_without_limit():
    user = create_verified_user("authtest")
    tokens = [user["token"]]
    for n in range(1, 26):
        r = _post("/auth/login", {"email": user["email"], "password": PASSWORD}, ip=f"203.0.113.{n}")
        assert r.status_code == 200, r.text
        tokens.append(r.json()["token"])
    held = _sql("SELECT COUNT(*) FROM auth_sessions WHERE user_id=%s", (user["id"],))[0][0]
    assert held <= 20, f"{held} sessions are held for one user"
    me = lambda t: requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {t}"}, timeout=30).status_code  # noqa: E731
    assert me(tokens[-1]) == 200, "the newest session must always work"
    assert me(tokens[0]) == 401, "the oldest session is the one that makes room"


@pytest.mark.parametrize("secret,starts", [("x" * 31, False), ("<YOUR_JWT_SECRET>", False), ("x" * 32, True)])
def test_the_server_refuses_to_start_with_a_signing_secret_that_is_too_short_to_trust(secret, starts):
    env = {k: v for k, v in os.environ.items() if k != "JWT_SECRET"} | {"JWT_SECRET": secret}
    run = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, '.'); import security_utils"],
                         cwd=str(BACKEND), env=env, capture_output=True, text=True, timeout=60)
    assert (run.returncode == 0) is starts, run.stderr[-400:]
    if not starts:
        assert "32" in run.stderr


def test_many_people_signing_in_and_out_at_the_same_moment_never_meet_a_server_error():
    """Sessions are created and deleted by many people at once. Deleting by a range on an index (all of one user's rows, every
    expired row) takes gap locks that can make two such requests wait on each other until the database gives up on one; that
    would surface as a 5xx. Everything here is deleted by primary key instead."""
    users = [create_verified_user("authtest") for _ in range(6)]

    def work(i):
        user, codes = users[i % len(users)], []
        for n in range(4):
            r = _post("/auth/login", {"email": user["email"], "password": PASSWORD}, ip=f"203.0.113.{(i * 7 + n) % 250 + 1}")
            codes.append(r.status_code)
            if r.status_code == 200:
                codes.append(_post("/auth/logout", {}, token=r.json()["token"]).status_code)
        codes.append(_post("/auth/logout-all", {}, token=user["token"]).status_code)
        return codes

    with futures.ThreadPoolExecutor(12) as pool:
        codes = [c for batch in pool.map(work, range(12)) for c in batch]
    assert max(codes) < 500, sorted(set(codes))


# -- the browser that is signing up has its own tries ---------------------------------------------------------------------

def _sign_up_in_a_browser():
    """Register the way the app does (cookie mode) and keep the cookies: this is the person at the verification screen."""
    browser = requests.Session()
    email = _fresh_email()
    r = browser.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": PASSWORD, "name": "Browser Person"},
                     headers={"X-Auth-Mode": "cookie", "X-Forwarded-For": "192.0.2.77"}, timeout=60)
    assert r.status_code == 200, r.text
    return browser, email


def _verify_from(browser, email, code, ip):
    return browser.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code, "password": PASSWORD},
                        headers={"X-Auth-Mode": "cookie", "X-Forwarded-For": ip}, timeout=60)


def test_a_stranger_cannot_use_up_the_tries_of_the_browser_that_is_signing_up():
    browser, email = _sign_up_in_a_browser()
    code = support_db.verification_code_for(email)
    wrong = "000000" if code != "000000" else "000001"
    stranger = [_post("/auth/verify", {"email": email, "code": wrong, "password": PASSWORD}, ip=f"198.51.100.{n}").status_code for n in range(1, 8)]
    assert stranger == [400] * 7, stranger
    assert _post("/auth/verify", {"email": email, "code": code, "password": PASSWORD}, ip="198.51.100.99").status_code == 400, \
        "the stranger's own tries are used up"
    done = _verify_from(browser, email, code, "192.0.2.78")
    assert done.status_code == 200, f"the person at the screen was locked out by a stranger: {done.text}"


def test_the_browser_that_signed_up_has_a_limit_of_its_own():
    browser, email = _sign_up_in_a_browser()
    code = support_db.verification_code_for(email)
    wrong = "000000" if code != "000000" else "000001"
    assert [_verify_from(browser, email, wrong, f"192.0.2.{n}").status_code for n in range(100, 105)] == [400] * 5
    assert _verify_from(browser, email, code, "192.0.2.110").status_code == 400, "five tries per code, even with the cookie"
    _sql("UPDATE users SET last_verification_sent_at='2000-01-01T00:00:00+00:00' WHERE email=%s", (email,))
    assert _post("/auth/resend-verification", {"email": email}).status_code == 200  # a new code: new tries
    assert _verify_from(browser, email, support_db.verification_code_for(email), "192.0.2.111").status_code == 200


def test_the_cookie_belongs_to_one_address_and_gives_no_tries_on_another():
    browser, mine = _sign_up_in_a_browser()
    other = signup("authtest")
    wrong = "000000" if support_db.verification_code_for(other["email"]) != "000000" else "000001"
    for n in range(1, 8):  # strangers use up the other address's tries
        _post("/auth/verify", {"email": other["email"], "code": wrong, "password": PASSWORD}, ip=f"198.51.100.{n}")
    r = _verify_from(browser, other["email"], support_db.verification_code_for(other["email"]), "192.0.2.120")
    assert r.status_code == 400, "a cookie for one address must not unlock another's tries"
    assert _verify_from(browser, mine, support_db.verification_code_for(mine), "192.0.2.121").status_code == 200


def test_registering_does_not_tell_a_stranger_which_addresses_are_already_confirmed():
    """The browser is given its cookie for an address still waiting for a code; an address that is already confirmed must get a
    cookie of the same kind, or the presence of the cookie would answer the question the neutral message hides."""
    confirmed = create_verified_user("authtest")
    waiting = _fresh_email()
    headers = {"X-Auth-Mode": "cookie"}
    a = requests.post(f"{BASE_URL}/api/auth/register", json={"email": confirmed["email"], "password": "Another-9x", "name": "x"}, headers=headers, timeout=60)
    b = requests.post(f"{BASE_URL}/api/auth/register", json={"email": waiting, "password": "Another-9x", "name": "x"}, headers=headers, timeout=60)
    cookies = lambda r: sorted(c.split("=")[0] for c in r.raw.headers.getlist("Set-Cookie"))  # noqa: E731
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert cookies(a) == cookies(b) == ["lr_device"], (cookies(a), cookies(b))
    # ...and the cookie handed out for the confirmed address does not make a stranger "familiar" with it
    stolen = a.cookies.get("lr_device", path="/api/auth")
    assert stolen
    for n in range(1, 31):
        _fail(confirmed["email"], n)
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": confirmed["email"], "password": PASSWORD}, cookies={"lr_device": stolen},
                      headers={"X-Forwarded-For": "198.51.100.230"}, timeout=60)
    assert r.status_code == 429, r.text
