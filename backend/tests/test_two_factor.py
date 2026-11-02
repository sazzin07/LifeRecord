"""The optional second step at sign-in: authenticator-app codes with one-time recovery codes.

Switched on per account, from Settings. Once on, a correct password only earns a short-lived challenge; the session starts
when a current code (or a recovery code) is also given. These tests drive the whole life of it with several accounts: turning
it on, signing in, codes that are used once, the limits on guessing, a password reset that must not skip the second step,
turning it off, and the command-line way out for someone who lost both the phone and the recovery codes.
"""
import time
import uuid

import pytest
import requests

import owner_admin
import support_db
import totp
from support_auth import BASE_URL
from support_users import PASSWORD, create_verified_user

from security_utils import create_totp_challenge_token


def _post(path, body=None, token=None, ip=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if ip:
        headers["X-Forwarded-For"] = ip
    return requests.post(f"{BASE_URL}/api{path}", json=body or {}, headers=headers, timeout=60)


def _get(path, token):
    return requests.get(f"{BASE_URL}/api{path}", headers={"Authorization": f"Bearer {token}"}, timeout=30)


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


def _step(offset=0):
    return int(time.time() // 30) + offset


def _turn_on(user):
    """Set up and confirm the second step the way the app does. Returns (secret, recovery codes)."""
    setup = _post("/auth/2fa/setup", {"password": PASSWORD}, token=user["token"])
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"].replace(" ", "")
    enabled = _post("/auth/2fa/enable", {"code": totp.code_at(secret, _step())}, token=user["token"])
    assert enabled.status_code == 200, enabled.text
    return secret, enabled.json()["recovery_codes"]


def _forget_used_steps(user):
    """Codes are used once; to sign in more than once inside the same half minute a test rewinds the remembered step."""
    _sql("UPDATE totp_credentials SET last_step=0 WHERE user_id=%s", (user["id"],))


def _challenge(user):
    r = _post("/auth/login", {"email": user["email"], "password": PASSWORD})
    assert r.status_code == 200 and r.json().get("requires_totp") is True, r.text
    return r.json()["challenge"]


def _finish(challenge, code, ip=None):
    return _post("/auth/login/totp", {"challenge": challenge, "code": code}, ip=ip)


# -- turning it on ---------------------------------------------------------------------------------------------------------

def test_it_is_off_until_the_person_turns_it_on():
    user = create_verified_user("authtest")
    assert _get("/auth/2fa", user["token"]).json() == {"enabled": False, "recovery_codes_left": 0}
    assert _post("/auth/login", {"email": user["email"], "password": PASSWORD}).json().get("requires_totp") is None


def test_setting_up_needs_the_password_and_hands_over_a_secret_and_a_link():
    user = create_verified_user("authtest")
    assert _post("/auth/2fa/setup", {"password": "Not-my-password-1"}, token=user["token"]).status_code == 400
    ok = _post("/auth/2fa/setup", {"password": PASSWORD}, token=user["token"])
    assert ok.status_code == 200
    secret = ok.json()["secret"].replace(" ", "")
    assert len(secret) == 32 and ok.json()["uri"].startswith("otpauth://totp/") and secret in ok.json()["uri"]
    assert _get("/auth/2fa", user["token"]).json()["enabled"] is False, "not on until a code from the app has been typed in"
    assert _post("/auth/2fa/setup", {"password": PASSWORD}).status_code == 401


def test_it_comes_on_only_with_a_correct_current_code_and_the_recovery_codes_are_shown_then():
    user = create_verified_user("authtest")
    secret = _post("/auth/2fa/setup", {"password": PASSWORD}, token=user["token"]).json()["secret"].replace(" ", "")
    assert _post("/auth/2fa/enable", {"code": "000000" if totp.code_at(secret, _step()) != "000000" else "000001"}, token=user["token"]).status_code == 400
    assert _get("/auth/2fa", user["token"]).json()["enabled"] is False
    done = _post("/auth/2fa/enable", {"code": totp.code_at(secret, _step())}, token=user["token"])
    assert done.status_code == 200
    codes = done.json()["recovery_codes"]
    assert len(codes) == 8 and len(set(codes)) == 8 and all(len(c) == 11 for c in codes)
    assert _get("/auth/2fa", user["token"]).json() == {"enabled": True, "recovery_codes_left": 8}
    assert _post("/auth/2fa/setup", {"password": PASSWORD}, token=user["token"]).status_code == 400, "already on"
    assert _post("/auth/2fa/enable", {"code": totp.code_at(secret, _step())}, token=user["token"]).status_code == 400


def test_the_secret_and_the_recovery_codes_are_never_kept_in_the_clear():
    user = create_verified_user("authtest")
    secret, codes = _turn_on(user)
    stored = _sql("SELECT secret_enc FROM totp_credentials WHERE user_id=%s", (user["id"],))[0][0]
    assert secret not in stored and stored != secret
    hashes = [r[0] for r in _sql("SELECT code_hash FROM totp_recovery_codes WHERE user_id=%s", (user["id"],))]
    assert len(hashes) == 8 and not any(c.replace("-", "") in h for c in codes for h in hashes) and all(len(h) == 64 for h in hashes)


# -- signing in ------------------------------------------------------------------------------------------------------------

def test_a_correct_password_alone_earns_only_a_challenge_and_no_session():
    user = create_verified_user("authtest")
    _turn_on(user)
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD}, headers={"X-Auth-Mode": "cookie"}, timeout=60)
    body = r.json()
    assert r.status_code == 200 and body["requires_totp"] is True and body["challenge"]
    assert "token" not in body and "refresh_token" not in body
    assert not any(c.startswith("lr_refresh=") for c in r.raw.headers.getlist("Set-Cookie"))
    assert _get("/auth/me", body["challenge"]).status_code == 401, "the challenge opens nothing"


def test_the_password_and_then_a_current_code_start_the_session():
    user = create_verified_user("authtest")
    secret, _ = _turn_on(user)
    done = _finish(_challenge(user), totp.code_at(secret, _step(1)))  # the step after the one used to turn it on
    assert done.status_code == 200, done.text
    assert _get("/auth/me", done.json()["token"]).status_code == 200 and done.json()["user"]["email"] == user["email"]


def test_a_code_works_once():
    user = create_verified_user("authtest")
    secret, _ = _turn_on(user)
    code = totp.code_at(secret, _step(1))
    assert _finish(_challenge(user), code).status_code == 200
    assert _finish(_challenge(user), code).status_code == 401, "the same six digits a second time are refused"


def test_a_wrong_code_is_refused_in_the_same_words_whatever_is_wrong():
    user, other = create_verified_user("authtest"), create_verified_user("authtest")
    secret, _ = _turn_on(user)
    other_secret, _ = _turn_on(other)
    answers = {
        "wrong": _finish(_challenge(user), "000000" if totp.code_at(secret, _step(1)) != "000000" else "000001"),
        "malformed": _finish(_challenge(user), "12ab56"),
        "another account's code": _finish(_challenge(user), totp.code_at(other_secret, _step(1))),
        "junk challenge": _finish("not-a-token", totp.code_at(secret, _step(1))),
    }
    assert {(r.status_code, r.json()["detail"]) for r in answers.values()} == {(401, "That code is not right. Check the app and try again.")}, \
        {k: (r.status_code, r.text) for k, r in answers.items()}


def test_a_challenge_belongs_to_one_account_and_one_purpose():
    a, b = create_verified_user("authtest"), create_verified_user("authtest")
    a_secret, _ = _turn_on(a)
    _turn_on(b)
    challenge_for_b = _challenge(b)
    assert _finish(challenge_for_b, totp.code_at(a_secret, _step(1))).status_code == 401, "A's code does not open B's challenge"
    expired = create_totp_challenge_token(a["id"], minutes=-1)
    assert _finish(expired, totp.code_at(a_secret, _step(1))).status_code == 401
    assert _finish(a["token"], totp.code_at(a_secret, _step(1))).status_code == 401, "an access token is not a challenge"


def test_guessing_the_code_is_limited_per_account_whatever_the_address():
    user = create_verified_user("authtest")
    secret, _ = _turn_on(user)
    challenge = _challenge(user)
    answers = [_finish(challenge, f"{n:06d}", ip=f"198.51.100.{n % 250 + 1}").status_code for n in range(1, 21)]
    assert answers.count(401) <= 10 and 429 in answers, answers
    real = _finish(challenge, totp.code_at(secret, _step(1)), ip="198.51.100.254")
    assert real.status_code == 429, "while the account is under attack even the right code waits"


# -- recovery codes ------------------------------------------------------------------------------------------------------

def test_a_recovery_code_signs_in_once_and_is_then_gone():
    user = create_verified_user("authtest")
    _, codes = _turn_on(user)
    assert _finish(_challenge(user), codes[0].upper()).status_code == 200, "case does not matter"
    assert _get("/auth/2fa", user["token"]).json()["recovery_codes_left"] == 7, "using one leaves seven"
    again = _finish(_challenge(user), codes[0])
    assert again.status_code == 401
    ok = _finish(_challenge(user), codes[1].replace("-", " "))
    assert ok.status_code == 200
    assert _get("/auth/2fa", ok.json()["token"]).json()["recovery_codes_left"] == 6, "and the second leaves six"


def test_new_recovery_codes_replace_the_old_ones_and_need_the_password_and_a_code():
    user = create_verified_user("authtest")
    secret, old = _turn_on(user)
    assert _post("/auth/2fa/recovery-codes", {"password": "Not-my-password-1", "code": totp.code_at(secret, _step(1))}, token=user["token"]).status_code == 400
    fresh = _post("/auth/2fa/recovery-codes", {"password": PASSWORD, "code": totp.code_at(secret, _step(1))}, token=user["token"])
    assert fresh.status_code == 200 and len(fresh.json()["recovery_codes"]) == 8
    assert _finish(_challenge(user), old[0]).status_code == 401
    assert _finish(_challenge(user), fresh.json()["recovery_codes"][0]).status_code == 200


# -- password reset, turning it off, the way out -----------------------------------------------------------------------------

def test_a_reset_link_does_not_skip_the_second_step():
    user = create_verified_user("authtest")
    secret, _ = _turn_on(user)
    link = support_db.issue_reset_token(user["email"])
    r = _post("/auth/reset-password", {"token": link, "password": "Brand-new-pass-4"})
    assert r.status_code == 200, r.text
    assert r.json()["requires_totp"] is True and "token" not in r.json(), "the emailed link proves the mailbox, not the phone"
    _forget_used_steps(user)
    done = _finish(r.json()["challenge"], totp.code_at(secret, _step()))
    assert done.status_code == 200 and _get("/auth/me", done.json()["token"]).status_code == 200
    assert _post("/auth/login", {"email": user["email"], "password": "Brand-new-pass-4"}).json()["requires_totp"] is True


def test_turning_it_off_needs_the_password_and_a_code_and_then_sign_in_is_plain_again():
    user = create_verified_user("authtest")
    secret, _ = _turn_on(user)
    code = totp.code_at(secret, _step(1))
    assert _post("/auth/2fa/disable", {"password": "Not-my-password-1", "code": code}, token=user["token"]).status_code == 400
    assert _post("/auth/2fa/disable", {"password": PASSWORD, "code": "000000"}, token=user["token"]).status_code == 400
    assert _get("/auth/2fa", user["token"]).json()["enabled"] is True
    challenge = _challenge(user)  # a challenge issued before it was turned off
    assert _post("/auth/2fa/disable", {"password": PASSWORD, "code": code}, token=user["token"]).status_code == 200
    assert _get("/auth/2fa", user["token"]).json() == {"enabled": False, "recovery_codes_left": 0}
    assert "token" in _post("/auth/login", {"email": user["email"], "password": PASSWORD}).json()
    assert _finish(challenge, totp.code_at(secret, _step(1))).status_code == 401, "an old challenge opens nothing once it is off"


def test_a_recovery_code_can_turn_it_off_when_the_phone_is_lost():
    user = create_verified_user("authtest")
    _, codes = _turn_on(user)
    assert _post("/auth/2fa/disable", {"password": PASSWORD, "code": codes[2]}, token=user["token"]).status_code == 200
    assert _sql("SELECT COUNT(*) FROM totp_recovery_codes WHERE user_id=%s", (user["id"],))[0][0] == 0


def test_the_server_owner_can_switch_it_off_for_someone_who_lost_both():
    user = create_verified_user("authtest")
    _turn_on(user)
    assert owner_admin.main(["disable-2fa", user["email"]]) == 0
    assert "token" in _post("/auth/login", {"email": user["email"], "password": PASSWORD}).json()
    assert owner_admin.main(["disable-2fa", user["email"]]) == 0, "already off is not an error"
    assert owner_admin.main(["disable-2fa", f"nobody_{uuid.uuid4().hex[:8]}@example.com"]) == 1


def test_every_endpoint_needs_a_signed_in_user_and_keeps_to_its_own_account():
    a, b = create_verified_user("authtest"), create_verified_user("authtest")
    _turn_on(a)
    assert _get("/auth/2fa", b["token"]).json() == {"enabled": False, "recovery_codes_left": 0}, "A's setting is not B's"
    for path, body in (("/auth/2fa/setup", {"password": PASSWORD}), ("/auth/2fa/enable", {"code": "123456"}),
                       ("/auth/2fa/disable", {"password": PASSWORD, "code": "123456"}), ("/auth/2fa/recovery-codes", {"password": PASSWORD, "code": "123456"})):
        assert _post(path, body).status_code == 401, path
    assert requests.get(f"{BASE_URL}/api/auth/2fa", timeout=30).status_code == 401


def test_deleting_the_account_takes_the_second_step_with_it():
    user = create_verified_user("authtest")
    _turn_on(user)
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id=%s", (user["id"],))
        conn.commit()
    finally:
        conn.close()
    assert _sql("SELECT COUNT(*) FROM totp_credentials WHERE user_id=%s", (user["id"],))[0][0] == 0
    assert _sql("SELECT COUNT(*) FROM totp_recovery_codes WHERE user_id=%s", (user["id"],))[0][0] == 0


def test_the_same_code_sent_at_the_same_moment_opens_only_one_session():
    """Reading 'not used yet' and writing 'used' are separate steps unless the database does them as one."""
    import concurrent.futures as futures
    user = create_verified_user("authtest")
    secret, _ = _turn_on(user)
    challenge = _challenge(user)
    code = totp.code_at(secret, _step(1))
    with futures.ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda _: _finish(challenge, code).status_code, range(6)))
    assert answers.count(200) == 1, answers


def test_the_same_recovery_code_sent_at_the_same_moment_opens_only_one_session():
    import concurrent.futures as futures
    user = create_verified_user("authtest")
    _, codes = _turn_on(user)
    challenge = _challenge(user)
    with futures.ThreadPoolExecutor(6) as pool:
        answers = list(pool.map(lambda _: _finish(challenge, codes[0]).status_code, range(6)))
    assert answers.count(200) == 1, answers
