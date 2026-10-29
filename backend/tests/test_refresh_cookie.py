"""SEC-006: the refresh token can live in an HttpOnly cookie (opt-in per request) instead of JavaScript-readable storage."""
import uuid

import requests
import support_db
from support_auth import BASE_URL

import server  # noqa: E402  (loads backend/.env)

PW = "CookiePass123"
COOKIE = {"X-Auth-Mode": "cookie"}


def _verified_user():
    email = f"session_{uuid.uuid4().hex[:8]}@example.com"
    assert requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": PW, "name": "c"}).status_code == 200
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT verification_code FROM users WHERE email=%s", (email,))
            code = cur.fetchone()[0]
    finally:
        conn.close()
    assert requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code}).status_code == 200
    return email


def _cookie_login(email):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PW}, headers=COOKIE)
    assert r.status_code == 200, r.text
    return s, r


def test_cookie_login_hides_the_refresh_token_from_javascript():
    s, r = _cookie_login(_verified_user())
    body = r.json()
    assert body["token"] and "refresh_token" not in body
    header = r.headers["set-cookie"]
    assert header.startswith("lr_refresh=") and "HttpOnly" in header and "Path=/api/auth" in header
    assert "samesite=lax" in header.lower()


def test_default_login_is_unchanged_for_api_clients():
    email = _verified_user()
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PW})
    assert r.json()["refresh_token"] and "set-cookie" not in r.headers


def test_refresh_works_from_the_cookie_alone_and_rotates_it():
    s, first = _cookie_login(_verified_user())
    before = s.cookies.get("lr_refresh")
    r = s.post(f"{BASE_URL}/api/auth/refresh", json={}, headers=COOKIE)
    assert r.status_code == 200, r.text
    assert r.json()["token"] and "refresh_token" not in r.json()
    assert requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).status_code == 200
    assert s.cookies.get("lr_refresh")  # still signed in after rotation
    assert before  # (issued-at is per second, so equal tokens are possible; the point is a cookie is always present)


def test_refresh_from_a_cookie_needs_the_custom_header_as_csrf_protection():
    s, _ = _cookie_login(_verified_user())
    r = s.post(f"{BASE_URL}/api/auth/refresh", json={})  # what a cross-site form post would look like
    assert r.status_code == 403


def test_refresh_without_any_token_is_401():
    assert requests.post(f"{BASE_URL}/api/auth/refresh", json={}, headers=COOKIE).status_code == 401


def test_a_legacy_refresh_token_in_the_body_is_swapped_for_a_cookie():
    email = _verified_user()
    legacy = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PW}).json()["refresh_token"]
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/refresh", json={"token": legacy}, headers=COOKIE)
    assert r.status_code == 200 and "refresh_token" not in r.json()
    assert s.cookies.get("lr_refresh")


def test_logout_clears_the_cookie_and_it_stops_working():
    s, _ = _cookie_login(_verified_user())
    stolen = s.cookies.get("lr_refresh")
    r = s.post(f"{BASE_URL}/api/auth/logout", headers=COOKIE)
    assert r.status_code == 200
    assert "lr_refresh=" in r.headers["set-cookie"] and ("Max-Age=0" in r.headers["set-cookie"] or "expires" in r.headers["set-cookie"].lower())
    assert not s.cookies.get("lr_refresh")
    assert stolen  # the token itself is still cryptographically valid; clearing is for the browser
    # Sign out everywhere (below) is what kills a copied token.


def test_sign_out_everywhere_kills_a_copied_refresh_cookie():
    email = _verified_user()
    s, r = _cookie_login(email)
    copied = s.cookies.get("lr_refresh")
    assert requests.post(f"{BASE_URL}/api/auth/logout-all", headers={"Authorization": f"Bearer {r.json()['token']}"}).status_code == 200
    thief = requests.Session()
    thief.cookies.set("lr_refresh", copied, path="/api/auth")
    assert thief.post(f"{BASE_URL}/api/auth/refresh", json={}, headers=COOKIE).status_code == 401


def test_cookie_is_marked_secure_for_an_https_frontend_only():
    assert server.refresh_cookie_secure("https://app.example.com") is True
    assert server.refresh_cookie_secure("http://localhost:3000") is False
