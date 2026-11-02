"""Deactivating an account: sign-in stops, the data stays, and only the right people can switch it back on.

The reversible alternative to deleting. Policy under test:
- a person can deactivate their own account (password required); every session ends at once, on every device;
- a deactivated account cannot start a session, and the sign-in answer says why (only to someone who knows the password);
- nothing is deleted; background jobs run for the account (scheduled reports) stop;
- a person reactivates their own account with the emailed reset link, which proves they control the mailbox;
- an account the server's owner deactivated stays off however many reset links are used, until the owner switches it on;
- the owner account itself cannot be deactivated from the app or the command line.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import select

import account_status
import owner_admin
import scheduling as sch
import server
import support_db
from database import AsyncSessionLocal
from models import ScheduledTask, ScheduledTaskRun
from support_auth import BASE_URL
from support_users import PASSWORD, create_verified_user


def _post(path, body=None, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return requests.post(f"{BASE_URL}/api{path}", json=body or {}, headers=headers, timeout=60)


def _me(token):
    return requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=30).status_code


def _login(user, password=PASSWORD):
    return _post("/auth/login", {"email": user["email"], "password": password})


def _count(sql, args=()):
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchone()[0]
    finally:
        conn.close()


def _deactivate(user, password=PASSWORD):
    return _post("/account/deactivate", {"password": password}, token=user["token"])


# -- a person deactivates their own account ------------------------------------------------------------------------------

def test_deactivating_signs_the_account_out_on_every_device_and_keeps_every_record():
    user = create_verified_user("authtest")
    other_device = _login(user).json()
    assert user["session"].post(f"{BASE_URL}/api/tasks", json={"title": "keep me"}, timeout=30).status_code == 200

    r = _deactivate(user)
    assert r.status_code == 200 and r.json()["ok"] is True, r.text

    assert _me(user["token"]) == 401 and _me(other_device["token"]) == 401
    assert _post("/auth/refresh", {"token": other_device["refresh_token"]}).status_code == 401
    assert _count("SELECT COUNT(*) FROM auth_sessions WHERE user_id=%s", (user["id"],)) == 0
    assert _count("SELECT COUNT(*) FROM tasks WHERE user_id=%s AND title='keep me'", (user["id"],)) == 1, "nothing is deleted"
    assert _count("SELECT COUNT(*) FROM users WHERE id=%s", (user["id"],)) == 1


def test_the_wrong_password_deactivates_nothing():
    user = create_verified_user("authtest")
    r = _deactivate(user, "Not-my-password-1")
    assert r.status_code == 400 and "incorrect" in r.json()["detail"].lower()
    assert _me(user["token"]) == 200
    assert _count("SELECT COUNT(*) FROM account_deactivations WHERE user_id=%s", (user["id"],)) == 0


def test_a_deactivated_account_cannot_sign_in_and_the_person_is_told_what_to_do():
    user = create_verified_user("authtest")
    _deactivate(user)
    right = _login(user)
    assert right.status_code == 403, right.text
    detail = right.json()["detail"]
    assert "deactivated" in detail and "Forgot password" in detail
    assert "token" not in right.json() and "lr_refresh" not in right.headers.get("set-cookie", "")
    wrong = _login(user, "Not-my-password-1")  # someone without the password learns nothing about the account's state
    assert wrong.status_code == 401 and wrong.json()["detail"] == "Invalid email or password"


def test_deactivating_does_not_touch_anyone_else():
    a, b = create_verified_user("authtest"), create_verified_user("authtest")
    _deactivate(a)
    assert _me(b["token"]) == 200 and _login(b).status_code == 200
    assert _count("SELECT COUNT(*) FROM account_deactivations WHERE user_id=%s", (b["id"],)) == 0


def _as_owner(user):
    """Make a throw-away user the owner for the length of a test (never a shared account), and put it back after."""
    class Owner:
        def __enter__(self):
            _set_role(user["id"], "owner")
            return user

        def __exit__(self, *exc):
            _set_role(user["id"], "user")  # never leave a second owner behind
    return Owner()


def _set_role(user_id, role):
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET role=%s WHERE id=%s", (role, user_id))
        conn.commit()
    finally:
        conn.close()


def test_the_owner_account_cannot_be_deactivated_from_the_app():
    user = create_verified_user("authtest")
    with _as_owner(user):
        r = _deactivate(user)
        assert r.status_code == 403 and "owner" in r.json()["detail"].lower()
        assert _me(user["token"]) == 200 and _count("SELECT COUNT(*) FROM account_deactivations WHERE user_id=%s", (user["id"],)) == 0


def test_a_signed_out_request_cannot_deactivate_anything():
    assert _post("/account/deactivate", {"password": PASSWORD}).status_code == 401


# -- switching it back on ------------------------------------------------------------------------------------------------

def test_the_emailed_reset_link_reactivates_an_account_the_person_deactivated():
    user = create_verified_user("authtest")
    _post("/tasks", {"title": "still here"}, token=user["token"])
    _deactivate(user)
    link = support_db.issue_reset_token(user["email"])  # what "Forgot password" mails to the address
    r = _post("/auth/reset-password", {"token": link, "password": "Welcome-back-5"})
    assert r.status_code == 200, r.text
    assert _me(r.json()["token"]) == 200
    assert _login(user, "Welcome-back-5").status_code == 200
    assert _count("SELECT COUNT(*) FROM account_deactivations WHERE user_id=%s", (user["id"],)) == 0
    assert _count("SELECT COUNT(*) FROM tasks WHERE user_id=%s AND title='still here'", (user["id"],)) == 1


def test_forgot_password_still_sends_the_link_for_a_deactivated_account():
    user = create_verified_user("authtest")
    _deactivate(user)
    ghost = f"authtest_{uuid.uuid4().hex[:8]}@example.com"
    a = _post("/auth/forgot-password", {"email": user["email"]})
    b = _post("/auth/forgot-password", {"email": ghost})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert _count("SELECT COUNT(*) FROM users WHERE id=%s AND password_reset_token IS NOT NULL", (user["id"],)) == 1


def test_an_account_the_owner_deactivated_stays_off_until_the_owner_switches_it_on():
    user = create_verified_user("authtest")
    assert owner_admin.main(["deactivate", user["email"]]) == 0
    assert _me(user["token"]) == 401, "deactivating ends the sessions"

    refused = _login(user)
    assert refused.status_code == 403 and "person who runs this server" in refused.json()["detail"]

    link = support_db.issue_reset_token(user["email"])  # a reset link cannot undo the owner's decision
    again = _post("/auth/reset-password", {"token": link, "password": "Trying-again-6"})
    assert again.status_code == 403
    assert _login(user, "Trying-again-6").status_code == 403

    assert owner_admin.main(["reactivate", user["email"]]) == 0
    assert _login(user, "Trying-again-6").status_code == 200, "the password chosen with the link is the one that works"


def test_the_command_line_refuses_the_owner_and_unknown_addresses():
    user = create_verified_user("authtest")
    with _as_owner(user):
        assert owner_admin.main(["deactivate", user["email"]]) == 1
        assert _me(user["token"]) == 200 and _login(user).status_code == 200
    assert owner_admin.main(["deactivate", f"nobody_{uuid.uuid4().hex[:8]}@example.com"]) == 1
    assert owner_admin.main(["reactivate", f"nobody_{uuid.uuid4().hex[:8]}@example.com"]) == 1


def test_deleting_the_user_takes_the_deactivation_record_with_it():
    user = create_verified_user("authtest")
    _deactivate(user)
    assert _count("SELECT COUNT(*) FROM account_deactivations WHERE user_id=%s", (user["id"],)) == 1
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id=%s", (user["id"],))
        conn.commit()
    finally:
        conn.close()
    assert _count("SELECT COUNT(*) FROM account_deactivations WHERE user_id=%s", (user["id"],)) == 0


# -- background work -----------------------------------------------------------------------------------------------------

def test_scheduled_reports_of_a_deactivated_account_do_not_run():
    user = create_verified_user("authtest")
    now = sch.iso(datetime.now(timezone.utc))
    task_id = str(uuid.uuid4())

    async def go():
        async with AsyncSessionLocal() as db:
            db.add(ScheduledTask(id=task_id, user_id=user["id"], title="deactivated report", instruction="Summarise my open tasks.",
                                 schedule={"kind": "daily", "time": "09:00"}, timezone="Europe/Lisbon", data_sources=["tasks"],
                                 recipients=[], status="active", next_run_at=sch.iso(datetime.now(timezone.utc) - timedelta(minutes=1)),
                                 created_at=now, updated_at=now))
            await db.commit()
        _deactivate(user)
        async with AsyncSessionLocal() as db:
            task = (await db.execute(select(ScheduledTask).where(ScheduledTask.id == task_id))).scalar_one()
            run = await sch.create_run(db, task, "schedule", datetime.now(timezone.utc), f"manual:{uuid.uuid4()}")
            await db.commit()
        await sch.process_run(server, AsyncSessionLocal, run.id)
        async with AsyncSessionLocal() as db:
            return (await db.execute(select(ScheduledTaskRun).where(ScheduledTaskRun.id == run.id))).scalar_one()

    finished = asyncio.run(go())
    assert finished.status == "failed" and "deactivated" in (finished.error or "").lower(), (finished.status, finished.error)


def test_resetting_a_password_from_the_command_line_ends_every_session_like_any_other_password_change():
    user = create_verified_user("authtest")
    other_device = _login(user).json()
    assert asyncio.run(owner_admin.set_password(user["id"], "Set-by-owner-7")) is True
    assert _me(user["token"]) == 401 and _me(other_device["token"]) == 401
    assert _login(user).status_code == 401, "the old password is gone"
    assert _login(user, "Set-by-owner-7").status_code == 200
    assert asyncio.run(owner_admin.set_password(str(uuid.uuid4()), "Set-by-owner-7")) is False


def test_the_status_helpers_agree_with_each_other():
    user = create_verified_user("authtest")

    async def go():
        async with AsyncSessionLocal() as db:
            assert await account_status.deactivation_for(db, user["id"]) is None
            await account_status.deactivate(db, user["id"], "self")
            row = await account_status.deactivation_for(db, user["id"])
            assert row is not None and row.deactivated_by == "self"
            await account_status.deactivate(db, user["id"], "owner")  # taking over a self-deactivation is allowed, and idempotent
            assert (await account_status.deactivation_for(db, user["id"])).deactivated_by == "owner"
            assert await account_status.reactivate(db, user["id"]) is True
            assert await account_status.reactivate(db, user["id"]) is False
            assert await account_status.deactivation_for(db, user["id"]) is None

    asyncio.run(go())
