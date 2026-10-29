"""Account-email flows through the real API: the verification lock-out fix and the outcome log.
Test accounts are on example.com, which the app never mails, so the event status is 'skipped'."""
import hashlib
import time
import uuid

import requests
import support_db
from support_auth import BASE_URL

PW = "FlowsPass123"


def _register():
    email = f"session_{uuid.uuid4().hex[:8]}@example.com"
    assert requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": PW, "name": "f"}).status_code == 200
    return email


def _db_one(sql, params):
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()
    finally:
        conn.close()


def _events(email, purpose, wait=8.0):
    """Rows for this recipient and purpose; sending happens after the response, so give it a moment."""
    h = hashlib.sha256(email.encode()).hexdigest()
    end = time.time() + wait
    while True:
        conn = support_db.connect()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT status, recipient_domain, detail FROM email_events WHERE recipient_hash=%s AND purpose=%s", (h, purpose))
                rows = cur.fetchall()
        finally:
            conn.close()
        if rows or time.time() > end:
            return rows
        time.sleep(0.3)


def _verified(email):
    code = _db_one("SELECT verification_code FROM users WHERE email=%s", (email,))[0]
    r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code})
    assert r.status_code == 200, r.text
    return r.json()


def test_five_wrong_codes_no_longer_lock_the_account_out():
    email = _register()
    for _ in range(5):
        assert requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": "000000"}).status_code == 400
    assert "Too many" in requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": "000000"}).json()["detail"]
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:  # step over the 90 s resend cooldown
            cur.execute("UPDATE users SET last_verification_sent_at='2000-01-01T00:00:00+00:00' WHERE email=%s", (email,))
        conn.commit()
    finally:
        conn.close()
    assert requests.post(f"{BASE_URL}/api/auth/resend-verification", json={"email": email}).status_code == 200
    assert _db_one("SELECT verification_attempts FROM users WHERE email=%s", (email,))[0] == 0
    assert _verified(email)["token"]  # the new code works


def test_signup_sends_in_the_background_and_logs_the_outcome():
    email = _register()
    rows = _events(email, "verification")
    assert rows and rows[0][0] == "skipped" and rows[0][1] == "example.com"
    # only a hash and the domain are kept
    assert not _db_one("SELECT 1 FROM email_events WHERE detail LIKE %s", (f"%{email}%",))


def test_registering_an_existing_email_answers_the_same_and_sends_nothing_new():
    email = _register()
    before = len(_events(email, "verification"))
    again = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": PW, "name": "f"})
    first = requests.post(f"{BASE_URL}/api/auth/register", json={"email": f"session_{uuid.uuid4().hex[:8]}@example.com", "password": PW, "name": "f"})
    assert again.status_code == first.status_code == 200 and again.json() == first.json()
    time.sleep(1.5)
    assert len(_events(email, "verification", wait=0)) == before


def test_forgot_password_logs_a_reset_email_only_for_real_accounts():
    email = _register()
    ghost = f"session_{uuid.uuid4().hex[:8]}@example.com"
    a = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email})
    b = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ghost})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert _events(email, "password_reset")
    assert not _events(ghost, "password_reset", wait=1.5)


def test_password_change_and_sign_out_everywhere_send_a_security_notice():
    email = _register()
    s = _verified(email)
    h = {"Authorization": f"Bearer {s['token']}"}
    r = requests.post(f"{BASE_URL}/api/auth/change-password", headers=h, json={"current_password": PW, "new_password": "FlowsPass456"})
    assert r.status_code == 200
    assert _events(email, "security_notice")
    h2 = {"Authorization": f"Bearer {r.json()['token']}"}
    assert requests.post(f"{BASE_URL}/api/auth/logout-all", headers=h2).status_code == 200
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM email_events WHERE recipient_hash=%s AND purpose='security_notice'", (hashlib.sha256(email.encode()).hexdigest(),))
            deadline = time.time() + 8
            n = cur.fetchone()[0]
            while n < 2 and time.time() < deadline:
                time.sleep(0.4)
                conn.commit()
                cur.execute("SELECT COUNT(*) FROM email_events WHERE recipient_hash=%s AND purpose='security_notice'", (hashlib.sha256(email.encode()).hexdigest(),))
                n = cur.fetchone()[0]
    finally:
        conn.close()
    assert n == 2
