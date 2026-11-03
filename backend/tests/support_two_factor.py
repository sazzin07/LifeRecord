"""Helpers shared by the tests of the second step at sign-in (authenticator app, passkeys, text messages)."""
import os
import time

import requests

import support_db
import totp
from support_auth import BASE_URL
from support_users import PASSWORD
from support_webauthn import SoftwareAuthenticator

ORIGIN = (os.environ.get("FRONTEND_URL") or BASE_URL).rstrip("/")
RP_ID = ORIGIN.split("://", 1)[1].split(":")[0].split("/")[0]


def post(path, body=None, token=None, ip=None, origin=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if ip:
        headers["X-Forwarded-For"] = ip
    if origin:
        headers["Origin"] = origin
    return requests.post(f"{BASE_URL}/api{path}", json=body if body is not None else {}, headers=headers, timeout=60)


def get(path, token):
    return requests.get(f"{BASE_URL}/api{path}", headers={"Authorization": f"Bearer {token}"}, timeout=30)


def sql(query, args=()):
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(query, args)
            rows = cur.fetchall()
        conn.commit()
        return rows
    finally:
        conn.close()


def step(offset=0):
    return int(time.time() // 30) + offset


def flags(token):
    body = get("/auth/2fa", token).json()
    return {"enabled": body["enabled"], "recovery_codes_left": body["recovery_codes_left"]}


def new_key(**kw) -> SoftwareAuthenticator:
    return SoftwareAuthenticator(RP_ID, ORIGIN, **kw)


def add_passkey(user, key=None, name="Test key"):
    """Register a passkey the way the app does (the first method: no proof needed). Returns (key, recovery_codes)."""
    key = key or new_key()
    opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD}, token=user["token"], origin=ORIGIN)
    assert opts.status_code == 200, opts.text
    body = opts.json()
    done = post("/auth/2fa/passkeys", {"challenge_id": body["challenge_id"], "credential": key.create(body["options"]), "name": name},
                token=user["token"], origin=ORIGIN)
    assert done.status_code == 200, done.text
    return key, done.json()["recovery_codes"]


def add_totp(user):
    """Set up the authenticator app as the first method. Returns (secret, recovery_codes)."""
    setup = post("/auth/2fa/setup", {"password": PASSWORD}, token=user["token"])
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"].replace(" ", "")
    done = post("/auth/2fa/enable", {"code": totp.code_at(secret, step())}, token=user["token"])
    assert done.status_code == 200, done.text
    return secret, done.json()["recovery_codes"]


def forget_used_steps(user):
    """Codes are used once; inside the same half minute a test rewinds the remembered step."""
    sql("UPDATE totp_credentials SET last_step=0 WHERE user_id=%s", (user["id"],))


def login_challenge(user):
    r = post("/auth/login", {"email": user["email"], "password": PASSWORD})
    assert r.status_code == 200 and r.json().get("requires_totp") is True, r.text
    return r.json()


def passkey_proof(user, key, ip=None):
    """A fresh passkey proof for a change (what the app sends along with the password)."""
    opts = post("/auth/2fa/proof/passkey-options", {}, token=user["token"], origin=ORIGIN, ip=ip)
    assert opts.status_code == 200, opts.text
    return {"passkey": {"challenge_id": opts.json()["challenge_id"], "credential": key.get(opts.json()["options"])}}


def passkey_login_answer(challenge, key, **kw):
    opts = post("/auth/login/passkey/options", {"challenge": challenge}, origin=ORIGIN)
    assert opts.status_code == 200, opts.text
    body = opts.json()
    return {"challenge": challenge, "challenge_id": body["challenge_id"], "credential": key.get(body["options"], **kw)}


def sign_in_with_passkey(user, key, **kw):
    challenge = login_challenge(user)["challenge"]
    return post("/auth/login/passkey", passkey_login_answer(challenge, key, **kw), origin=ORIGIN)


# -- text messages: the scratch server posts to tests/fake_twilio.py, which remembers what a phone would have received ----------

def new_phone() -> str:
    """A number nobody else in the run uses (so reading its messages cannot pick up another test's)."""
    import secrets
    return "+3519" + "".join(secrets.choice("123456789") for _ in range(8))


def texts_to(phone):
    return requests.get(f"{os.environ['TWILIO_API_BASE']}/_messages", params={"to": phone}, timeout=10).json()


def last_code(phone) -> str:
    """The code in the newest text message the fake provider received for this number."""
    import re
    messages = texts_to(phone)
    assert messages, f"no text message was sent to {phone}"
    return re.search(r"(?<!\d)(\d{6})(?!\d)", messages[-1]["body"]).group(1)


def let_resend_through(user):
    """The 60-second wait before another code is sent, skipped."""
    sql("UPDATE sms_codes SET sent_ms = sent_ms - 61000 WHERE user_id=%s", (user["id"],))


def add_sms(user, phone=None, proof=None):
    """Set up text messages: start, read the code the phone got, confirm. Returns (phone, recovery_codes)."""
    phone = phone or new_phone()
    started = post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone, **(proof or {})}, token=user["token"])
    assert started.status_code == 200, started.text
    done = post("/auth/2fa/sms/confirm", {"code": last_code(phone)}, token=user["token"])
    assert done.status_code == 200, done.text
    return phone, done.json()["recovery_codes"]
