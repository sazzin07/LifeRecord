"""AUTH-001: changing the password from Settings. Uses a throwaway verified account (removed at the end of the run
by conftest.py)."""
import uuid

import pymysql
import support_db
import pytest
import requests

from support_auth import BASE_URL

OLD, NEW = "OldPass123", "NewPass456"


def _verified_user():
    email = f"pwchange_{uuid.uuid4().hex[:8]}@example.com"
    assert requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": OLD, "name": "pw"}).status_code == 200
    conn = support_db.connect(cursorclass=pymysql.cursors.DictCursor)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT verification_code FROM users WHERE email=%s", (email,))
            code = cur.fetchone()["verification_code"]
    finally:
        conn.close()
    r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code})
    assert r.status_code == 200, r.text
    return email, {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def user():
    return _verified_user()


def change(headers, current, new):
    return requests.post(f"{BASE_URL}/api/auth/change-password", headers=headers,
                         json={"current_password": current, "new_password": new})


def test_wrong_current_password_is_400_and_keeps_the_session(user):
    # 401 would make the app treat the sign-in as expired and log the user out for a typo.
    email, h = user
    r = change(h, "not-it-1", NEW)
    assert r.status_code == 400 and "Current password" in r.json()["detail"]
    assert requests.get(f"{BASE_URL}/api/auth/me", headers=h).status_code == 200


def test_weak_new_password_is_rejected(user):
    email, h = user
    assert change(h, OLD, "short").status_code == 400
    assert change(h, OLD, "lettersonly").status_code == 400


def test_new_password_must_differ(user):
    email, h = user
    assert change(h, OLD, OLD).status_code == 400


def test_change_then_sign_in_with_the_new_password(user):
    email, h = user
    r = change(h, OLD, NEW)
    assert r.status_code == 200, r.text
    assert requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": OLD}).status_code == 401
    assert requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": NEW}).status_code == 200


def test_repeated_wrong_attempts_are_rate_limited(user):
    email, h = user
    codes = [change(h, f"wrong-{i}1", NEW).status_code for i in range(12)]
    assert codes[0] == 400 and 429 in codes
    # The correct password is refused too while limited, so guessing cannot continue.
    assert change(h, OLD, NEW).status_code == 429
