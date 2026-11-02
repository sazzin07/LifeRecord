"""A copied refresh cookie is not enough: sessions started by the app are bound to a key that never leaves the browser.

Rotation catches a stolen refresh token only when the thief and the owner both use it, and a thief who refreshes within the grace
period after every refresh of the owner is never caught. So the app also binds each session to a key pair made in the browser
(WebCrypto, non-extractable). The public half is sent when the session starts; every refresh then has to carry a short signature
made with the private half. Anyone holding only the cookie, from a log, a backup or a wire, cannot refresh at all.

These tests play the browser with Python's `cryptography`: a P-256 key, the public key as a JWK in `X-Session-Key`, and proofs
in `X-Session-Proof` (a base64url JSON payload, a dot, and the raw r||s signature that WebCrypto produces).
"""
import base64
import json
import time
import uuid

import pytest
import requests
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

import support_db
from support_auth import BASE_URL
from support_users import PASSWORD, create_verified_user


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class Browser:
    """What the app does in the browser: one key pair, the public half announced at sign-in, a signature on every refresh."""

    def __init__(self):
        self.private = ec.generate_private_key(ec.SECP256R1())
        n = self.private.public_key().public_numbers()
        self.jwk = {"kty": "EC", "crv": "P-256", "x": b64u(n.x.to_bytes(32, "big")), "y": b64u(n.y.to_bytes(32, "big"))}

    def key_header(self):
        return b64u(json.dumps(self.jwk, separators=(",", ":")).encode())

    def proof(self, at_ms=None, jti=None, private=None):
        payload = b64u(json.dumps({"iat": at_ms if at_ms is not None else int(time.time() * 1000), "jti": jti or uuid.uuid4().hex}).encode())
        r, s = decode_dss_signature((private or self.private).sign(payload.encode(), ec.ECDSA(hashes.SHA256())))
        return f"{payload}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


def _sign_in(user, browser=None):
    headers = {"X-Session-Key": browser.key_header()} if browser else {}
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD}, headers=headers, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


def _refresh(token, proof=None, key=None, extra=None):
    headers = dict(extra or {})
    if proof is not None:
        headers["X-Session-Proof"] = proof
    if key is not None:
        headers["X-Refresh-Key"] = key
    return requests.post(f"{BASE_URL}/api/auth/refresh", json={"token": token}, headers=headers, timeout=30)


def _me(access):
    return requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {access}"}, timeout=30).status_code


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


def test_a_session_started_with_a_key_will_not_refresh_on_the_cookie_alone_and_is_not_ended_by_trying():
    user, browser = create_verified_user("authtest"), Browser()
    signed_in = _sign_in(user, browser)
    thief = _refresh(signed_in["refresh_token"])  # the cookie, from somewhere it should not have been
    assert thief.status_code == 401
    assert _me(signed_in["token"]) == 200, "refusing the thief must not sign the owner out"
    owner = _refresh(signed_in["refresh_token"], browser.proof())
    assert owner.status_code == 200 and _me(owner.json()["token"]) == 200


def test_a_thief_who_refreshes_in_step_with_the_owner_is_stopped_because_every_refresh_needs_the_key():
    """The case rotation alone cannot catch: the owner refreshes, and within the grace period the thief presents the token just replaced."""
    user, browser = create_verified_user("authtest"), Browser()
    first = _sign_in(user, browser)["refresh_token"]
    assert _refresh(first, browser.proof()).status_code == 200            # the owner moves on; `first` is now the previous token
    assert _refresh(first).status_code == 401                              # the thief, inside the grace period, with no signature
    assert _refresh(first, Browser().proof()).status_code == 401           # ...or with a key of his own


def test_a_signature_from_another_key_a_stale_one_and_a_repeated_one_are_all_refused():
    user, browser = create_verified_user("authtest"), Browser()
    token = _sign_in(user, browser)["refresh_token"]
    now = int(time.time() * 1000)
    assert _refresh(token, browser.proof(private=Browser().private)).status_code == 401, "signed by a key the session was not bound to"
    assert _refresh(token, browser.proof(at_ms=now - 10 * 60_000)).status_code == 401, "ten minutes old"
    assert _refresh(token, browser.proof(at_ms=now + 10 * 60_000)).status_code == 401, "ten minutes from now"
    assert _refresh(token, "not.aproof").status_code == 401 and _refresh(token, "x" * 3000).status_code == 401
    once = browser.proof()
    assert _refresh(token, once).status_code == 200
    assert _refresh(token, once).status_code == 401, "the same signature, replayed, is refused"


def test_a_repeat_of_a_refresh_whose_answer_was_lost_carries_a_new_signature_and_still_gets_the_same_token():
    user, browser = create_verified_user("authtest"), Browser()
    old = _sign_in(user, browser)["refresh_token"]
    key = "k" * 32
    lost = _refresh(old, browser.proof(), key=key).json()["refresh_token"]
    _sql("UPDATE auth_session_info SET rotated_ms = rotated_ms - %s WHERE user_id=%s", (6 * 3_600_000, user["id"]))
    again = _refresh(old, browser.proof(), key=key)
    assert again.status_code == 200, again.text
    import jwt
    assert jwt.decode(again.json()["refresh_token"], options={"verify_signature": False})["jti"] == jwt.decode(lost, options={"verify_signature": False})["jti"]


def test_a_session_started_without_a_key_refreshes_exactly_as_before():
    """Scripts and apps that cannot keep a key: nothing changes for them."""
    user = create_verified_user("authtest")
    token = _sign_in(user)["refresh_token"]
    assert _refresh(token).status_code == 200


@pytest.mark.parametrize("header", ["!!not base64!!", b64u(b"not json"), b64u(json.dumps({"kty": "RSA", "n": "AQAB", "e": "AQAB"}).encode()),
                                     b64u(json.dumps({"kty": "EC", "crv": "P-256", "x": b64u(b"\x01" * 32), "y": b64u(b"\x02" * 32)}).encode()),
                                     "A" * 4000])
def test_a_key_that_is_not_a_real_point_on_the_curve_is_ignored_and_starts_an_ordinary_session(header):
    user = create_verified_user("authtest")
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD}, headers={"X-Session-Key": header}, timeout=60)
    assert r.status_code == 200, r.text
    assert _refresh(r.json()["refresh_token"]).status_code == 200, "no usable key, so no binding"


def test_every_way_a_session_can_begin_can_be_bound_to_the_browser_that_began_it():
    browser = Browser()
    # sign-up: confirming the address
    account = requests.post(f"{BASE_URL}/api/auth/register", json={"email": f"authtest_{uuid.uuid4().hex[:8]}@example.com", "password": PASSWORD, "name": "Bound"}, timeout=60)
    assert account.status_code == 200
    email = _sql("SELECT email FROM users WHERE email LIKE 'authtest_%%' ORDER BY created_at DESC LIMIT 1")[0][0]
    code = support_db.verification_code_for(email)
    verified = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code, "password": PASSWORD}, headers={"X-Session-Key": browser.key_header()}, timeout=60)
    assert verified.status_code == 200
    uid = verified.json()["user"]["id"]
    bound = lambda: _sql("SELECT COUNT(*) FROM auth_session_info WHERE user_id=%s AND public_key IS NOT NULL", (uid,))[0][0]  # noqa: E731
    assert bound() == 1
    # password reset, and password change (each starts a fresh session on this device)
    link = support_db.issue_reset_token(email)
    reset = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": link, "password": "Reset-and-bound-3"}, headers={"X-Session-Key": browser.key_header()}, timeout=60)
    assert reset.status_code == 200 and bound() == 1, "the reset ended the old session and started a bound one"
    changed = requests.post(f"{BASE_URL}/api/auth/change-password", json={"current_password": "Reset-and-bound-3", "new_password": "Changed-and-bound-4"},
                            headers={"Authorization": f"Bearer {reset.json()['token']}", "X-Session-Key": browser.key_header()}, timeout=60)
    assert changed.status_code == 200 and bound() == 1


def test_the_key_is_never_shown_back_and_is_not_exported():
    user, browser = create_verified_user("authtest"), Browser()
    signed_in = _sign_in(user, browser)
    rows = requests.get(f"{BASE_URL}/api/auth/sessions", headers={"Authorization": f"Bearer {signed_in['token']}"}, timeout=30).json()
    assert "x" not in json.dumps(rows) or browser.jwk["x"] not in json.dumps(rows)
    assert all(set(r) == {"id", "device", "created_at", "last_seen_at", "current"} for r in rows)


def test_the_browser_may_read_the_servers_clock_across_origins():
    """The page corrects for a computer whose clock is wrong by reading the Date header, which a browser hides from cross-origin
    script unless the server exposes it."""
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Origin": "http://localhost:3000"}, timeout=30)
    assert "date" in r.headers.get("access-control-expose-headers", "").lower(), dict(r.headers)
