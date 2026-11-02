"""Where am I signed in: the list of sessions, ending one from it, and the notice when a new browser signs in.

A person can only protect an account they can see. The list names each session by browser and system (never by the raw
User-Agent, and never by address), marks the one being used, and lets any of the others be ended from here.
"""
import hashlib
import time

import pytest
import requests

import support_db
from support_auth import BASE_URL
from support_users import PASSWORD, create_verified_user

from device_labels import device_label

CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
SAFARI_IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
                 "Version/17.4 Mobile/15E148 Safari/604.1")


@pytest.mark.parametrize("agent,label", [
    (CHROME_WINDOWS, "Chrome on Windows"),
    (CHROME_WINDOWS + " Edg/124.0.0.0", "Edge on Windows"),
    ("Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0", "Firefox on Linux"),
    (SAFARI_IPHONE, "Safari on iPhone"),
    ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36", "Chrome on Android"),
    ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", "Safari on macOS"),
    ("python-requests/2.31.0", "Another app"),
    ("", "Unknown device"),
    ("x" * 5000, "Another app"),
])
def test_a_device_is_named_by_browser_and_system_and_nothing_else_is_kept(agent, label):
    assert device_label(agent) == label and len(device_label(agent)) <= 80


def _sign_in(user, agent=None, cookie_mode=False, session=None):
    headers = {"User-Agent": agent} if agent else {}
    if cookie_mode:
        headers["X-Auth-Mode"] = "cookie"
    r = (session or requests).post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": PASSWORD}, headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _list(token):
    r = requests.get(f"{BASE_URL}/api/auth/sessions", headers=_bearer(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _me(token):
    return requests.get(f"{BASE_URL}/api/auth/me", headers=_bearer(token), timeout=30).status_code


def test_the_list_shows_each_sign_in_with_a_device_name_and_marks_the_one_in_use():
    user = create_verified_user("authtest")
    laptop = _sign_in(user, CHROME_WINDOWS)
    phone = _sign_in(user, SAFARI_IPHONE)
    rows = _list(phone["token"])
    assert len(rows) == 3  # the sign-up itself, the laptop, the phone
    by_device = {r["device"]: r for r in rows}
    assert {"Chrome on Windows", "Safari on iPhone"} <= set(by_device)
    assert [r["device"] for r in rows if r["current"]] == ["Safari on iPhone"], "exactly the session asking is marked"
    assert all(set(r) == {"id", "device", "created_at", "last_seen_at", "current"} for r in rows), "no address, no raw user agent, nothing else"
    assert _me(laptop["token"]) == 200


def test_a_session_ended_from_the_list_stops_working_and_the_others_do_not():
    user = create_verified_user("authtest")
    laptop = _sign_in(user, CHROME_WINDOWS)
    phone = _sign_in(user, SAFARI_IPHONE)
    target = next(r["id"] for r in _list(phone["token"]) if r["device"] == "Chrome on Windows")
    gone = requests.delete(f"{BASE_URL}/api/auth/sessions/{target}", headers=_bearer(phone["token"]), timeout=30)
    assert gone.status_code == 200
    assert _me(laptop["token"]) == 401
    assert requests.post(f"{BASE_URL}/api/auth/refresh", json={"token": laptop["refresh_token"]}, timeout=30).status_code == 401
    assert _me(phone["token"]) == 200 and _me(user["token"]) == 200


def test_ending_the_session_you_are_using_signs_you_out():
    user = create_verified_user("authtest")
    mine = next(r["id"] for r in _list(user["token"]) if r["current"])
    assert requests.delete(f"{BASE_URL}/api/auth/sessions/{mine}", headers=_bearer(user["token"]), timeout=30).status_code == 200
    assert _me(user["token"]) == 401


def test_nobody_can_list_or_end_another_persons_sessions():
    a, b = create_verified_user("authtest"), create_verified_user("authtest")
    a_session = next(r["id"] for r in _list(a["token"]))
    assert a_session not in {r["id"] for r in _list(b["token"])}
    r = requests.delete(f"{BASE_URL}/api/auth/sessions/{a_session}", headers=_bearer(b["token"]), timeout=30)
    assert r.status_code == 404
    assert requests.delete(f"{BASE_URL}/api/auth/sessions/does-not-exist", headers=_bearer(b["token"]), timeout=30).status_code == 404
    assert _me(a["token"]) == 200, "B's attempt changed nothing for A"


def _security_notices(email):
    h = hashlib.sha256(email.encode()).hexdigest()
    rows = support_db.connect()
    try:
        with rows.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM email_events WHERE recipient_hash=%s AND purpose='security_notice'", (h,))
            return cur.fetchone()[0]
    finally:
        rows.close()


def _wait_for_notices(email, expected, seconds=8.0):
    end = time.time() + seconds
    while time.time() < end:
        if _security_notices(email) >= expected:
            break
        time.sleep(0.3)
    return _security_notices(email)


def test_a_browser_the_account_has_not_seen_before_triggers_a_notice_and_a_familiar_one_does_not():
    user = create_verified_user("authtest")
    before = _security_notices(user["email"])
    browser = requests.Session()
    _sign_in(user, CHROME_WINDOWS, cookie_mode=True, session=browser)             # first time from this browser
    assert _wait_for_notices(user["email"], before + 1) == before + 1
    _sign_in(user, CHROME_WINDOWS, cookie_mode=True, session=browser)             # same browser again: it holds the device cookie
    time.sleep(2.0)
    assert _security_notices(user["email"]) == before + 1, "a familiar browser must not cause another notice"
    _sign_in(user)                                                                # a script or app (no cookies at all): no notice either
    time.sleep(2.0)
    assert _security_notices(user["email"]) == before + 1
