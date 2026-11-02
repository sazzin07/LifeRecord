"""Authentication is enforced by the backend on EVERY route, not by the pages.

Walks every route the server registers (so a route added later is checked without anyone remembering to) and calls it
three ways: with no credentials, with a garbage token, and with a genuine token whose session has been signed out. All
three must be refused with 401 before anything else is looked at. The only routes that answer without a session are the
ones listed in PUBLIC, each with the reason.
"""
import re

import pytest
import requests

from support_auth import BASE_URL
from support_users import create_verified_user

import server  # noqa: E402  (loads backend/.env)

PUBLIC = {
    ("GET", "/api/health"): "liveness probe: returns a constant, touches no data",
    ("GET", "/api/"): "returns the app name, touches no data",
    ("POST", "/api/auth/register"): "creating an account; answers identically whether or not the address exists",
    ("POST", "/api/auth/resend-verification"): "proves nothing about the address; cooldown and rate limit apply",
    ("POST", "/api/auth/verify"): "needs the emailed code; attempts are limited and counted",
    ("POST", "/api/auth/login"): "needs the password; rate limited",
    ("POST", "/api/auth/forgot-password"): "answers identically for every address; rate limited",
    ("POST", "/api/auth/reset-password"): "needs the single-use emailed token",
    ("POST", "/api/auth/refresh"): "needs a refresh token whose session still exists (see test_session_lifecycle.py)",
    ("POST", "/api/auth/logout"): "ends only the session its own token names; harmless with no token",
}


def _routes():
    out = []
    for route in server.api_router.routes:  # (app.routes only holds the included router as one opaque entry)
        methods = getattr(route, "methods", None)
        if not methods or not getattr(route, "path", "").startswith("/api"):
            continue
        for method in sorted(methods - {"HEAD", "OPTIONS"}):
            out.append((method, route.path))
    return sorted(set(out))


def _url(path):
    return BASE_URL + re.sub(r"\{[^}/]+(:path)?\}", "00000000-0000-0000-0000-000000000000", path)


def _call(method, path, headers=None):
    return requests.request(method, _url(path), headers=headers or {}, json={} if method in ("POST", "PUT", "PATCH", "DELETE") else None,
                            timeout=30, allow_redirects=False)


def test_there_are_many_routes_and_every_public_one_is_justified():
    routes = _routes()
    assert len(routes) > 150
    assert set(PUBLIC) <= set(routes), f"PUBLIC lists routes that do not exist: {sorted(set(PUBLIC) - set(routes))}"


@pytest.fixture(scope="module")
def ended_session_token():
    """A genuine, correctly signed access token whose session has been signed out."""
    user = create_verified_user("session")
    requests.post(f"{BASE_URL}/api/auth/logout", headers={"Authorization": f"Bearer {user['token']}"}, timeout=30)
    return user["token"]


@pytest.mark.parametrize("credentials", ["none", "garbage", "signed-out"])
def test_every_protected_route_refuses_a_caller_without_a_live_session(credentials, ended_session_token):
    header = {"none": None, "garbage": "Bearer not.a.real.token", "signed-out": f"Bearer {ended_session_token}"}[credentials]
    headers = {"Authorization": header} if header else {}
    open_routes, checked = [], 0
    for method, path in _routes():
        if (method, path) in PUBLIC:
            continue
        checked += 1
        r = _call(method, path, headers)
        if r.status_code != 401:
            open_routes.append(f"{method} {path} -> {r.status_code}")
    assert checked > 150, "the walk found almost no routes; a test that checks nothing proves nothing"
    assert open_routes == [], f"routes that answered a caller with {credentials} credentials:\n" + "\n".join(open_routes)


def test_a_valid_session_does_get_through_so_the_refusals_above_are_not_just_a_broken_server():
    user = create_verified_user("session")
    r = requests.get(f"{BASE_URL}/api/tasks", headers={"Authorization": f"Bearer {user['token']}"}, timeout=30)
    assert r.status_code == 200 and r.json() == []
