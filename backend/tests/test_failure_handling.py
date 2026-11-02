"""S-13: when something breaks, the person gets a plain sentence, never a stack trace or a database message, and the
browser can still read it (an error response without CORS headers is hidden from the page, which then wrongly decides
the whole backend is "offline").

Evidence for the rest of the failure sweep is in docs/testing/failure-sweep.md; this module holds the checks that need
code of their own."""
import asyncio
import datetime as dt
import logging
import os

import httpx
import jwt
import pytest
from sqlalchemy.exc import OperationalError

import server
from support_auth import BASE_URL
from support_populate import _png
from support_users import api, create_verified_user

ORIGIN = "http://localhost:3000"
INTERNALS = ("Traceback", "OperationalError", "sqlalchemy", "secret_column", "File \"", "Can't connect", "pymysql", "aiomysql")


class _InProcessClient:
    """Calls the app in this process without a socket or a lifespan, and returns an error response instead of raising it.
    (Starlette's TestClient would do the same but warns that it wants a newer HTTP library.)"""

    def __init__(self, app):
        self._transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)

    def get(self, path, **kwargs):
        async def call():
            async with httpx.AsyncClient(transport=self._transport, base_url="http://testserver") as c:
                return await c.get(path, **kwargs)
        return asyncio.run(call())


@pytest.fixture
def client():
    yield _InProcessClient(server.app)
    server.app.dependency_overrides.clear()


def _break(dependency, exc):
    async def broken():
        raise exc
        yield  # pragma: no cover
    server.app.dependency_overrides[dependency] = broken


def test_an_unexpected_error_is_a_plain_json_sentence_with_cors_and_no_internals(client, caplog):
    _break(server.get_db, RuntimeError("boom: secret_column in /srv/app/server.py"))
    with caplog.at_level(logging.ERROR):
        r = client.get("/api/auth/me", headers={"Authorization": "Bearer x", "Origin": ORIGIN})
    assert r.status_code == 500 and r.headers["content-type"].startswith("application/json")
    detail = r.json()["detail"]
    assert "try again" in detail.lower() and len(detail) < 160
    assert not any(bad in r.text for bad in INTERNALS) and "boom" not in r.text
    assert r.headers["access-control-allow-origin"] == ORIGIN  # the page can read it
    assert any("boom" in rec.getMessage() or (rec.exc_info and "boom" in str(rec.exc_info[1])) for rec in caplog.records)  # the detail stays in the log


def test_a_database_that_cannot_be_reached_says_so_and_leaks_nothing(client):
    _break(server.get_db, OperationalError("SELECT secret_column FROM users", {}, Exception("(2003) Can't connect to MySQL server on '127.0.0.1'")))
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer x", "Origin": ORIGIN})
    assert r.status_code == 503 and r.headers["content-type"].startswith("application/json")
    assert "database" in r.json()["detail"].lower() and "try again" in r.json()["detail"].lower()
    assert not any(bad in r.text for bad in INTERNALS)
    assert r.headers["access-control-allow-origin"] == ORIGIN


@pytest.mark.parametrize("code,text", [(1213, "Deadlock found when trying to get lock; try restarting transaction"),
                                      (1205, "Lock wait timeout exceeded; try restarting transaction")])
def test_a_lock_conflict_is_called_what_it_is_and_the_log_names_the_mysql_error(client, caplog, code, text):
    """A deadlock or a lock wait is the database asking for the request to be repeated, not a database that is down: say so, and keep
    the MySQL error number in the log so the next occurrence can be explained instead of guessed at."""
    _break(server.get_db, OperationalError("UPDATE users SET secret_column=1", {}, Exception(code, text)))
    with caplog.at_level(logging.WARNING):
        r = client.get("/api/auth/me", headers={"Authorization": "Bearer x", "Origin": ORIGIN})
    assert r.status_code == 503 and r.headers["access-control-allow-origin"] == ORIGIN
    detail = r.json()["detail"]
    assert "busy" in detail.lower() and "try again" in detail.lower() and "not reachable" not in detail
    assert not any(bad in r.text for bad in INTERNALS) and str(code) not in r.text
    assert any(str(code) in rec.getMessage() for rec in caplog.records), [rec.getMessage() for rec in caplog.records]


def test_expected_refusals_keep_their_own_messages(client):
    r = client.get("/api/auth/me", headers={"Origin": ORIGIN})  # no token at all
    assert r.status_code == 401 and r.json()["detail"] == "Not authenticated"
    assert client.get("/api/nope/nothing").status_code == 404


def test_an_expired_session_says_so():
    expired = jwt.encode({"sub": "someone", "type": "access", "exp": dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)},
                         os.environ["JWT_SECRET"], algorithm="HS256")
    import requests
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {expired}"}, timeout=20)
    assert r.status_code == 401 and r.json()["detail"] == "Token expired"


def test_a_picture_that_is_too_big_is_refused_with_the_size_limit_and_nothing_is_stored():
    user = create_verified_user("limits")
    limit = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "10")) * 1024 * 1024
    big = _png() + b"\x00" * (limit + 1)
    r = user["session"].post(api(user, "/photos"), files={"file": ("big.png", big, "image/png")}, timeout=120)
    assert r.status_code == 413 and f"{limit // (1024 * 1024)} MB" in r.json()["detail"]
    assert user["session"].get(api(user, "/photos"), timeout=20).json() == []
