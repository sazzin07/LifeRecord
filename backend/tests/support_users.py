"""Throw-away verified users for tests: sign up through the real endpoints and confirm with the code read from the
database, exactly as a person would. Use a prefix that conftest.TEST_USER_EMAIL cleans up afterwards."""
import uuid

import requests

import support_db
from support_auth import BASE_URL

PASSWORD = "TestPass123"  # test accounts only; never a real credential


def _code_for(email: str) -> str:
    return support_db.verification_code_for(email)


def signup(prefix: str) -> dict:
    """Register an unverified account. Returns {email, password, name}."""
    tag = uuid.uuid4().hex[:8]
    email, name = f"{prefix}_{tag}@example.com", f"{prefix.title()} Tester {tag}"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": PASSWORD, "name": name}, timeout=30)
    assert r.status_code == 200, r.text
    return {"email": email, "password": PASSWORD, "name": name}


def verify(account: dict) -> dict:
    """Confirm the emailed code. Returns the account plus {id, token, session} (a requests.Session with the token)."""
    r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": account["email"], "code": _code_for(account["email"]), "password": account["password"]}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {data['token']}"})
    return {**account, "id": data["user"]["id"], "token": data["token"], "session": s}


def create_verified_user(prefix: str) -> dict:
    return verify(signup(prefix))


def api(user: dict, path: str) -> str:
    return f"{BASE_URL}/api{path}"
