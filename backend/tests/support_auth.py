"""Shared login for the API tests.

Logins are rate limited (RATE_LIMIT_AUTH_MAX_ATTEMPTS per minute, per IP and email), and most test modules
need the owner account, so a full run used to trip the limit. `login()` signs in once per account per run:
the response is cached in a temp file shared by the xdist workers and re-checked with /auth/me before reuse.

Credentials come from TEST_EMAIL / TEST_PASSWORD (falling back to the local dev owner account).
"""
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

OWNER_EMAIL = os.environ.get("TEST_EMAIL", "tiagosa743@gmail.com")
OWNER_PASSWORD = os.environ.get("TEST_PASSWORD", "LifeRecord")

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
