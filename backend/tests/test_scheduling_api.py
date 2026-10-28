"""Scheduled tasks over HTTP: validation, the draft -> confirm -> active lifecycle, recipient verification and isolation.

Nothing here calls the AI or sends email: previews and manual runs are covered with a scripted model in the engine
tests, and this server has no mail provider configured (which is itself checked: it must say so, not pretend).
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from sqlalchemy import delete, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402,F401  (loads backend/.env)
import scheduling as sch  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from models import ReportRecipient, ScheduledTask, User  # noqa: E402
from security_utils import hash_password  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in (Path(__file__).resolve().parents[2] / "frontend" / ".env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

API = f"{BASE_URL}/api/scheduled"
TAG = f"SAPI_{uuid.uuid4().hex[:6]}"
OWNER_EMAIL, OWNER_PASSWORD = "tiagosa743@gmail.com", "LifeRecord"
STRANGER_EMAIL, STRANGER_PASSWORD = f"{TAG.lower()}@example.test", "Str4nger-pass!"
TZ = "Europe/Lisbon"


def run(coro):
    return asyncio.run(coro)


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s


@pytest.fixture(scope="module")
def owner():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def stranger():
    async def make():
        async with AsyncSessionLocal() as db:
            db.add(User(id=str(uuid.uuid4()), email=STRANGER_EMAIL, password_hash=hash_password(STRANGER_PASSWORD), name="Stranger",
                        role="user", email_verified=True, created_at=datetime.now(timezone.utc).isoformat()))
            await db.commit()
    run(make())
    yield _login(STRANGER_EMAIL, STRANGER_PASSWORD)

    async def drop():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(User).where(User.email == STRANGER_EMAIL))
            await db.commit()
    run(drop())


@pytest.fixture(autouse=True, scope="module")
def tidy():
    yield

    async def drop():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ScheduledTask).where(ScheduledTask.title.like("SAPI\\_%", escape="\\")))
            await db.execute(delete(ReportRecipient).where(ReportRecipient.email.like("%sapi\\_%", escape="\\")))
            await db.commit()
    run(drop())


def body(name="weekly", **kw):
    data = {"title": f"{TAG} {name}", "instruction": "Summarise last week's spending and the biggest changes.",
            "schedule": {"kind": "weekly", "time": "09:00", "weekdays": [0]}, "timezone": TZ, "data_sources": ["money"], "recipients": []}
    data.update(kw)
    return data


def make(owner, **kw):
    r = owner.post(f"{API}/tasks", json=body(**kw))
    assert r.status_code == 200, r.text
    return r.json()


def test_options_report_email_state_honestly(owner):
    o = owner.get(f"{API}/options").json()
    assert {s["id"] for s in o["sources"]} == set(sch.SOURCE_TOOLS) and o["limits"]["tasks"] == 20
    if o["email"]["configured"]:                       # depends on this server's settings; either way it must be truthful
        assert o["email"]["provider"] in ("sendgrid", "smtp") and o["email"]["problem"] is None
    else:
        assert o["email"]["provider"] is None and "SENDGRID" in o["email"]["problem"]
    assert o["account_email"] == OWNER_EMAIL


def test_schedule_preview_lists_the_next_runs_and_rejects_bad_input(owner):
    ok = owner.post(f"{API}/schedule-preview", json={"schedule": {"kind": "weekly", "time": "09:00", "weekdays": [0]}, "timezone": TZ}).json()
    assert ok["text"] == "Every Monday at 09:00 (Europe/Lisbon)" and len(ok["next"]) == 5
    assert owner.post(f"{API}/schedule-preview", json={"schedule": {"kind": "daily", "time": "99:99"}, "timezone": TZ}).status_code == 422
    assert owner.post(f"{API}/schedule-preview", json={"schedule": {"kind": "daily", "time": "09:00"}, "timezone": "Nowhere/Land"}).status_code == 422


@pytest.mark.parametrize("patch,needle", [
    ({"schedule": {"kind": "interval", "every": 10, "unit": "minutes"}}, "hours or days"),
    ({"schedule": {"kind": "once", "time": "09:00", "date": "2020-01-01"}}, "already passed"),
    ({"timezone": "Mars/Base"}, "Unknown timezone"),
    ({"data_sources": ["passwords"]}, "valid data source"),
    ({"recipients": ["stranger@example.com"]}, "not verified"),
    ({"recipients": ["not-an-email"]}, "valid email"),
])
def test_invalid_tasks_are_rejected(owner, patch, needle):
    r = owner.post(f"{API}/tasks", json=body("bad", **patch))
    assert r.status_code == 422 and needle in r.json()["detail"]


def test_a_new_task_is_a_draft_that_never_runs_until_confirmed(owner):
    t = make(owner)
    assert t["status"] == "draft" and t["next_run_at"] is None and t["confirmed_at"] is None
    assert t["schedule_text"] == "Every Monday at 09:00 (Europe/Lisbon)"
    assert owner.post(f"{API}/tasks/{t['id']}/run").status_code == 409       # run now needs a confirmed task
    assert owner.post(f"{API}/tasks/{t['id']}/pause").status_code == 409


def test_activation_needs_an_explicit_confirmation_then_pause_resume_work(owner):
    t = make(owner)
    assert owner.post(f"{API}/tasks/{t['id']}/activate", json={}).status_code == 400
    a = owner.post(f"{API}/tasks/{t['id']}/activate", json={"confirm": True}).json()
    assert a["status"] == "active" and a["confirmed_at"] and datetime.fromisoformat(a["next_run_at"]) > datetime.now(timezone.utc)
    p = owner.post(f"{API}/tasks/{t['id']}/pause").json()
    assert p["status"] == "paused"
    r = owner.post(f"{API}/tasks/{t['id']}/resume").json()
    assert r["status"] == "active" and r["next_run_at"]
    assert owner.post(f"{API}/tasks/{t['id']}/resume").status_code == 409


def test_emailing_needs_the_recipient_list_to_be_confirmed_and_email_to_be_set_up(owner):
    t = make(owner, name="mail", recipients=[OWNER_EMAIL])
    assert t["recipients"] == [OWNER_EMAIL]
    stale = owner.post(f"{API}/tasks/{t['id']}/activate", json={"confirm": True, "confirm_recipients": []})
    assert stale.status_code == 409 and "recipients changed" in stale.json()["detail"]
    go = owner.post(f"{API}/tasks/{t['id']}/activate", json={"confirm": True, "confirm_recipients": [OWNER_EMAIL]})
    if owner.get(f"{API}/options").json()["email"]["configured"]:
        assert go.status_code == 200 and go.json()["status"] == "active"           # activating sends nothing; the run does
    else:
        assert go.status_code == 409 and "SENDGRID" in go.json()["detail"]         # honest: this server cannot send email yet
        assert owner.get(f"{API}/tasks/{t['id']}").json()["status"] == "draft"


def test_editing_what_a_task_reads_requires_confirming_again_but_a_new_time_does_not(owner):
    t = make(owner, name="edit")
    owner.post(f"{API}/tasks/{t['id']}/activate", json={"confirm": True})
    moved = owner.put(f"{API}/tasks/{t['id']}", json=body("edit", schedule={"kind": "daily", "time": "07:30"})).json()
    assert moved["status"] == "active" and moved["schedule_text"].startswith("Every day at 07:30")
    wider = owner.put(f"{API}/tasks/{t['id']}", json=body("edit", schedule={"kind": "daily", "time": "07:30"}, data_sources=["money", "people"])).json()
    assert wider["status"] == "draft" and wider["next_run_at"] is None and wider["confirmed_at"] is None
    reworded = owner.put(f"{API}/tasks/{t['id']}", json=body("edit", instruction="Something different entirely, please.")).json()
    assert reworded["status"] == "draft"


def test_duplicate_creates_an_unconfirmed_copy_and_delete_removes_it(owner):
    t = make(owner, name="dup")
    owner.post(f"{API}/tasks/{t['id']}/activate", json={"confirm": True})
    c = owner.post(f"{API}/tasks/{t['id']}/duplicate").json()
    assert c["id"] != t["id"] and c["title"] == f"Copy of {TAG} dup" and c["status"] == "draft" and c["next_run_at"] is None
    assert owner.delete(f"{API}/tasks/{c['id']}").json() == {"deleted": c["id"]}
    assert owner.get(f"{API}/tasks/{c['id']}").status_code == 404
    assert any(x["id"] == t["id"] for x in owner.get(f"{API}/tasks").json())


def test_the_task_limit_is_enforced(owner):
    mine = [x for x in owner.get(f"{API}/tasks").json()]
    made = []
    try:
        while len(mine) + len(made) < 20:
            made.append(make(owner, name=f"fill{len(made)}")["id"])
        r = owner.post(f"{API}/tasks", json=body("one too many"))
        assert r.status_code == 409 and "at most 20" in r.json()["detail"]
    finally:
        for i in made:
            owner.delete(f"{API}/tasks/{i}")


# ------------------------------------------------------------------ recipients
def test_adding_an_address_validates_and_is_honest_when_email_is_not_set_up(owner):
    if not owner.get(f"{API}/options").json()["email"]["configured"]:
        r = owner.post(f"{API}/recipients", json={"email": f"{TAG.lower()}-a@example.test"})
        assert r.status_code == 503 and "SENDGRID" in r.json()["detail"]
    # (with email configured, adding a valid address would send a real code, so only the validation paths run here)
    assert owner.post(f"{API}/recipients", json={"email": "bad"}).status_code == 422
    assert owner.post(f"{API}/recipients", json={"email": OWNER_EMAIL}).status_code == 422  # already yours
    listing = owner.get(f"{API}/recipients").json()
    assert listing[0] == {"id": "self", "email": OWNER_EMAIL, "verified": True, "own": True}


def _seed_recipient(email, code="123456", expires_in=15, attempts=0):
    async def go():
        async with AsyncSessionLocal() as db:
            me = (await db.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
            rid = str(uuid.uuid4())
            db.add(ReportRecipient(id=rid, user_id=me.id, email=email, verified=False, code_hash=sch.code_hash(code, rid), attempts=attempts,
                                   code_expires_at=sch.iso(datetime.now(timezone.utc) + timedelta(minutes=expires_in)), created_at=sch.iso(datetime.now(timezone.utc))))
            await db.commit()
            return rid
    return run(go())


def test_verification_flow_wrong_code_expiry_attempts_and_success(owner, stranger):
    email = f"{TAG.lower()}-v@example.test"
    rid = _seed_recipient(email)
    assert owner.post(f"{API}/recipients/{rid}/verify", json={"code": "000000"}).status_code == 400
    assert stranger.post(f"{API}/recipients/{rid}/verify", json={"code": "123456"}).status_code == 404   # not their address row
    # unverified addresses cannot be used on a task
    r = owner.post(f"{API}/tasks", json=body("unver", recipients=[email]))
    assert r.status_code == 422 and "not verified" in r.json()["detail"]
    ok = owner.post(f"{API}/recipients/{rid}/verify", json={"code": "123456"}).json()
    assert ok["verified"] is True
    t = owner.post(f"{API}/tasks", json=body("ver", recipients=[email]))
    assert t.status_code == 200 and t.json()["recipients"] == [email]

    # removing the address takes it off the tasks that used it
    assert owner.delete(f"{API}/recipients/{rid}").json() == {"deleted": rid}
    assert owner.get(f"{API}/tasks/{t.json()['id']}").json()["recipients"] == []


def test_expired_codes_and_too_many_wrong_guesses_are_refused(owner):
    expired = _seed_recipient(f"{TAG.lower()}-e@example.test", expires_in=-1)
    assert owner.post(f"{API}/recipients/{expired}/verify", json={"code": "123456"}).status_code == 400
    locked = _seed_recipient(f"{TAG.lower()}-l@example.test", attempts=5)
    assert owner.post(f"{API}/recipients/{locked}/verify", json={"code": "123456"}).status_code == 429


def test_a_stranger_cannot_use_the_owners_verified_address(owner, stranger):
    email = f"{TAG.lower()}-s@example.test"
    rid = _seed_recipient(email)
    owner.post(f"{API}/recipients/{rid}/verify", json={"code": "123456"})
    r = stranger.post(f"{API}/tasks", json=body("steal", recipients=[email]))
    assert r.status_code == 422 and "not verified" in r.json()["detail"]
    assert all(x["email"] != email for x in stranger.get(f"{API}/recipients").json())


# ------------------------------------------------------------------- isolation
def test_another_user_cannot_see_or_touch_a_task(owner, stranger):
    t = make(owner, name="private")
    tid = t["id"]
    assert all(x["id"] != tid for x in stranger.get(f"{API}/tasks").json())
    for method, path, kw in [("get", f"/tasks/{tid}", {}), ("put", f"/tasks/{tid}", {"json": body("x")}), ("delete", f"/tasks/{tid}", {}),
                             ("post", f"/tasks/{tid}/activate", {"json": {"confirm": True}}), ("post", f"/tasks/{tid}/pause", {}),
                             ("post", f"/tasks/{tid}/resume", {}), ("post", f"/tasks/{tid}/duplicate", {}), ("post", f"/tasks/{tid}/run", {}),
                             ("post", f"/tasks/{tid}/preview", {}), ("get", f"/tasks/{tid}/runs", {})]:
        r = getattr(stranger, method)(f"{API}{path}", **kw)
        assert r.status_code == 404, (method, path, r.status_code)
    again = owner.get(f"{API}/tasks/{tid}").json()
    assert again["status"] == "draft" and again["title"] == f"{TAG} private"
    assert stranger.get(f"{API}/runs/{uuid.uuid4()}").status_code == 404


def test_requests_without_a_token_are_rejected():
    for method, path in (("get", "/options"), ("get", "/tasks"), ("post", "/tasks"), ("get", "/recipients"), ("post", "/draft"), ("post", "/tasks/x/activate")):
        r = getattr(requests, method)(f"{API}{path}", timeout=10)
        assert r.status_code in (401, 403), (method, path, r.status_code)
