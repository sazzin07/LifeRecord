"""Shared login for the API tests.

Logins are rate limited (RATE_LIMIT_AUTH_MAX_ATTEMPTS per minute, per IP and email), and most test modules
need the owner account, so a full run used to trip the limit. `login()` signs in once per account per run:
the response is cached in a temp file shared by the xdist workers and re-checked with /auth/me before reuse.

The standard testing account is John (a39791@aesancho.pt, seeded by `seed_john.py`). Override with TEST_EMAIL.
TEST_PASSWORD comes from the environment or the encrypted secrets store (`python local_secrets.py set TEST_PASSWORD`);
there is no default in code. Tests only run against a local backend.
"""
import contextlib
import hashlib
import json
import os
import sys
import tempfile
from urllib.parse import urlparse
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_secrets  # noqa: E402

local_secrets.load_into_environ()

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

if BASE_URL and (urlparse(BASE_URL).hostname not in ("127.0.0.1", "localhost")) and os.environ.get("ALLOW_REMOTE_TESTS") != "1":
    raise RuntimeError(f"Refusing to run the tests against {BASE_URL}: they create and delete data. Only a local backend is "
                       "accepted (set ALLOW_REMOTE_TESTS=1 to override, never for production).")

# "OWNER" is kept as the name for the primary test account used throughout the suite.
OWNER_EMAIL = os.environ.get("TEST_EMAIL", "a39791@aesancho.pt")
OWNER_PASSWORD = os.environ.get("TEST_PASSWORD", "")
if not OWNER_PASSWORD:
    raise RuntimeError("TEST_PASSWORD is not set. Store it with `python local_secrets.py set TEST_PASSWORD` "
                       "(it is the owner account's password) or export it for this run.")

_MAX_AGE = 600  # seconds; well inside the access-token lifetime


def _cache_file(email: str, password: str) -> Path:
    key = hashlib.sha256(f"{BASE_URL}|{email.lower()}|{password}".encode()).hexdigest()[:24]
    return Path(tempfile.gettempdir()) / f"liferecord-test-login-{key}.json"


def _still_valid(data: dict) -> bool:
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {data['token']}"}, timeout=15)
    return r.status_code == 200


def login(email: str = OWNER_EMAIL, password: str = OWNER_PASSWORD) -> dict:
    """Login response JSON ({token, refresh_token, user, ...}); fails the test if the login is refused."""
    path = _cache_file(email, password)
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if time.time() - cached["at"] < _MAX_AGE and _still_valid(cached["data"]):
            return cached["data"]
    except (OSError, ValueError, KeyError):
        pass
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps({"at": time.time(), "data": data}), encoding="utf-8")
    os.replace(tmp, path)
    return data


def session(email: str = OWNER_EMAIL, password: str = OWNER_PASSWORD) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {login(email, password)['token']}"})
    return s


@contextlib.contextmanager
def shared_money_lock(timeout: float = 180.0):
    """Exclusive access to the owner's money balances across xdist workers.

    Several modules post transactions to the same account and some assert exact balances; run side by side they
    see each other's changes. Modules that touch balances hold this lock for their whole run (use it from a
    module-scoped autouse fixture)."""
    path = Path(tempfile.gettempdir()) / "liferecord-test-money.lock"
    deadline = time.time() + timeout
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            break
        except FileExistsError:
            try:  # a lock left behind by a crashed run
                if time.time() - path.stat().st_mtime > 600:
                    path.unlink(missing_ok=True)
                    continue
            except OSError:
                pass
            if time.time() > deadline:
                raise TimeoutError("another test module is holding the shared money lock")
            time.sleep(0.2)
    try:
        yield
    finally:
        path.unlink(missing_ok=True)
