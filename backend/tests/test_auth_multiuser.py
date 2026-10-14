"""Tests for multi-user auth, email verification, password reset, and data isolation."""
import os
import uuid
from pathlib import Path
import requests
import pymysql
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

ADMIN_EMAIL = "tiagosa743@gmail.com"
ADMIN_PASSWORD = "LifeRecord"


def _db_query(sql, params=()):
    conn = pymysql.connect(host="localhost", port=3306, user="root", password="", database="liferecord",
                           cursorclass=pymysql.cursors.DictCursor)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        conn.close()


def _db_execute(sql, params=()):
    conn = pymysql.connect(host="localhost", port=3306, user="root", password="", database="liferecord")
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            conn.commit()
    finally:
        conn.close()


def _session(email, password):
    s = requests.Session()
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin():
    return _session(ADMIN_EMAIL, ADMIN_PASSWORD)


class TestAuthLifecycle:
    def test_register_verify_login(self):
        tag = uuid.uuid4().hex[:8]
        email = f"authtest_{tag}@example.com"
        password = "TestPass123"
        name = f"Auth Tester {tag}"

        r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": name})
        assert r.status_code == 200

        rows = _db_query("SELECT verification_code FROM users WHERE email=%s", (email,))
        assert len(rows) == 1
        code = rows[0]["verification_code"]
        assert code and len(code) == 6

        r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code})
        assert r.status_code == 200
        assert "token" in r.json()

        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200
        assert r.json()["user"]["email_verified"] is True

    def test_invalid_verification_code(self):
        tag = uuid.uuid4().hex[:8]
        email = f"invalid_{tag}@example.com"
        requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "TestPass123", "name": "x"})
        r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": "000000"})
        assert r.status_code == 400

    def test_expired_verification_code(self):
        tag = uuid.uuid4().hex[:8]
        email = f"expired_{tag}@example.com"
        requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "TestPass123", "name": "x"})
        _db_execute("UPDATE users SET verification_code_expires_at=%s WHERE email=%s",
                    ("2020-01-01T00:00:00+00:00", email))
        rows = _db_query("SELECT verification_code FROM users WHERE email=%s", (email,))
        r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": rows[0]["verification_code"]})
        assert r.status_code == 400
        assert "expired" in r.json()["detail"].lower()

    def test_forgot_and_reset_password(self):
        tag = uuid.uuid4().hex[:8]
        email = f"reset_{tag}@example.com"
        password = "TestPass123"
        requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": "x"})
        rows = _db_query("SELECT verification_code FROM users WHERE email=%s", (email,))
        requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": rows[0]["verification_code"]})

        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email})
        assert r.status_code == 200

        rows = _db_query("SELECT password_reset_token FROM users WHERE email=%s", (email,))
        token = rows[0]["password_reset_token"]
        assert token

        r = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": token, "password": "NewPass123"})
        assert r.status_code == 200

        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "NewPass123"})
        assert r.status_code == 200

    def test_reused_reset_token_fails(self):
        tag = uuid.uuid4().hex[:8]
        email = f"reused_{tag}@example.com"
        requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "TestPass123", "name": "x"})
        rows = _db_query("SELECT verification_code FROM users WHERE email=%s", (email,))
        requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": rows[0]["verification_code"]})

        requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email})
        token = _db_query("SELECT password_reset_token FROM users WHERE email=%s", (email,))[0]["password_reset_token"]
        requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": token, "password": "NewPass123"})

        r = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": token, "password": "AnotherPass123"})
        assert r.status_code == 400

    def test_unverified_user_cannot_access_protected(self):
        tag = uuid.uuid4().hex[:8]
        email = f"unverified_{tag}@example.com"
        requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "TestPass123", "name": "x"})
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "TestPass123"})
        assert r.status_code == 200
        assert r.json()["requires_verification"] is True
        token = r.json()["token"]
        r2 = requests.get(f"{BASE_URL}/api/transactions", headers={"Authorization": f"Bearer {token}"})
        assert r2.status_code == 403

    def test_refresh_token_flow(self):
        tag = uuid.uuid4().hex[:8]
        email = f"refresh_{tag}@example.com"
        password = "TestPass123"
        requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": "x"})
        rows = _db_query("SELECT verification_code FROM users WHERE email=%s", (email,))
        r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": rows[0]["verification_code"]})
        assert r.status_code == 200
        assert "refresh_token" in r.json()
        refresh = r.json()["refresh_token"]

        r2 = requests.post(f"{BASE_URL}/api/auth/refresh", json={"token": refresh})
        assert r2.status_code == 200
        assert "token" in r2.json()
        assert r2.json()["token"]

        r3 = requests.post(f"{BASE_URL}/api/auth/refresh", json={"token": refresh + "tampered"})
        assert r3.status_code == 401


class TestMultiUserIsolation:
    def test_users_cannot_see_each_others_data(self, admin):
        tag = uuid.uuid4().hex[:8]
        email = f"isolation_{tag}@example.com"
        password = "TestPass123"
        requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": "x"})
        rows = _db_query("SELECT verification_code FROM users WHERE email=%s", (email,))
        requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": rows[0]["verification_code"]})
        user = _session(email, password)

        # User creates a person
        r = user.post(f"{BASE_URL}/api/people", json={"name": f"Private {tag}"})
        assert r.status_code == 200
        person_id = r.json()["id"]

        # Admin cannot see it
        r = admin.get(f"{BASE_URL}/api/people")
        assert r.status_code == 200
        assert not any(p["id"] == person_id for p in r.json())

        # Admin cannot delete it
        r = admin.delete(f"{BASE_URL}/api/people/{person_id}")
        assert r.status_code == 404

        # User creates a transaction
        r = user.post(f"{BASE_URL}/api/transactions/expense", json={
            "amount": 10.0, "merchant": f"PrivateTx {tag}", "category": "Other",
            "account": "cash", "participants": ["Me"]})
        assert r.status_code == 200
        tx_id = r.json()["transaction"]["id"]

        r = admin.get(f"{BASE_URL}/api/transactions")
        assert not any(t["id"] == tx_id for t in r.json())

        r = admin.delete(f"{BASE_URL}/api/transactions/{tx_id}")
        assert r.status_code == 404

    def test_user_categories_are_private(self, admin):
        tag = uuid.uuid4().hex[:8]
        email = f"catiso_{tag}@example.com"
        password = "TestPass123"
        requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": "x"})
        rows = _db_query("SELECT verification_code FROM users WHERE email=%s", (email,))
        requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": rows[0]["verification_code"]})
        user = _session(email, password)

        r = user.post(f"{BASE_URL}/api/categories", json={"name": f"PrivateCat {tag}", "icon": "circle", "color": "#000000"})
        assert r.status_code == 200
        cat_id = r.json()["id"]

        r = admin.get(f"{BASE_URL}/api/categories")
        assert not any(c["id"] == cat_id for c in r.json())

        r = admin.delete(f"{BASE_URL}/api/categories/{cat_id}")
        assert r.status_code == 404


class TestAdminInitialization:
    def test_admin_exists_and_verified(self):
        rows = _db_query("SELECT email, email_verified, role FROM users WHERE email=%s", (ADMIN_EMAIL,))
        assert len(rows) == 1
        assert rows[0]["email_verified"] == 1
        assert rows[0]["role"] == "owner"

    def test_admin_password_is_hashed(self):
        rows = _db_query("SELECT password_hash FROM users WHERE email=%s", (ADMIN_EMAIL,))
        assert len(rows) == 1
        ph = rows[0]["password_hash"]
        assert not ph.startswith("LifeRecord")
        assert ph.startswith("$2")

    def test_admin_can_login(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200


class TestSecurityControls:
    def test_security_headers_present(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.headers.get("X-Content-Type-Options") == "nosniff"
        assert r.headers.get("X-Frame-Options") == "DENY"
        assert r.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"

    def test_cors_rejects_unauthorized_origin(self):
        r = requests.get(f"{BASE_URL}/api/", headers={"Origin": "https://evil.example.com"})
        assert "Access-Control-Allow-Origin" not in r.headers

    def test_photo_upload_rejects_non_image(self, admin):
        # Remove JSON content-type so requests can set multipart for file upload
        s = requests.Session()
        s.headers.update({"Authorization": admin.headers["Authorization"]})
        r = s.post(
            f"{BASE_URL}/api/photos",
            files={"file": ("malware.exe", b"not an image", "application/octet-stream")},
            params={"note": "test"},
        )
        assert r.status_code == 400

    def test_photo_upload_rejects_oversized(self, admin):
        s = requests.Session()
        s.headers.update({"Authorization": admin.headers["Authorization"]})
        r = s.post(
            f"{BASE_URL}/api/photos",
            files={"file": ("big.jpg", b"x" * (11 * 1024 * 1024), "image/jpeg")},
            params={"note": "test"},
        )
        assert r.status_code == 413

    def test_ai_history_isolated_between_users(self, admin):
        tag = uuid.uuid4().hex[:8]
        email = f"aiiso_{tag}@example.com"
        password = "TestPass123"
        requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": "x"})
        rows = _db_query("SELECT verification_code FROM users WHERE email=%s", (email,))
        requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": rows[0]["verification_code"]})
        user = _session(email, password)

        # Seed messages directly so the test does not depend on the Gemini service.
        uid = _db_query("SELECT id FROM users WHERE email=%s", (email,))[0]["id"]
        _db_execute(
            "INSERT INTO ai_messages (id, user_id, session_id, role, text, created_at) VALUES (%s, %s, %s, %s, %s, NOW())",
            (str(uuid.uuid4()), uid, tag, "user", "private message"),
        )

        # Same session id requested by admin must not return user's messages
        r = admin.get(f"{BASE_URL}/api/ai/history?session_id={tag}")
        assert r.status_code == 200
        assert len(r.json()) == 0
