"""Calendar events (CAL-001, CAL-002): tasks, expiring food, recurring shopping, workouts, weigh-ins and meals
in one date range. Every record is created by the test (TEST_ prefix) and removed afterwards."""
import uuid
from datetime import date, timedelta

import pytest
import requests

from support_auth import BASE_URL, session

TODAY = date.today()
D = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731


@pytest.fixture(scope="module")
def client():
    return session()


@pytest.fixture
def records(client):
    tag = f"TEST_cal_{uuid.uuid4().hex[:6]}"
    made = []

    def post(path, body):
        r = client.post(f"{BASE_URL}/api{path}", json=body)
        assert r.status_code == 200, r.text
        made.append((path, r.json()["id"]))
        return r.json()

    post("/tasks", {"title": f"{tag} task", "due": D(2), "priority": "high", "recurring": "weekly"})
    post("/tasks", {"title": f"{tag} far task", "due": D(90)})
    post("/groceries", {"name": f"{tag} milk", "quantity": 1, "expiration": D(1), "storage_location": "fridge"})
    post("/groceries", {"name": f"{tag} empty", "quantity": 0, "expiration": D(1)})
    post("/workouts", {"type": "Legs", "date": D(-1), "exercises": []})
    post("/weight", {"weight": 80, "date": D(-1), "note": tag})
    post("/meals", {"description": f"{tag} lunch", "calories": 600, "date": D(0)})
    post("/meals", {"description": f"{tag} dinner", "calories": 700.5, "date": D(0)})
    post("/shopping/recurring", {"name": f"{tag} weekly shop", "schedule": "weekly", "items": []})
    yield tag
    paths = {"/tasks": "/tasks", "/groceries": "/groceries", "/workouts": "/workouts", "/weight": "/weight",
             "/meals": "/meals", "/shopping/recurring": "/shopping/recurring"}
    for path, rid in made:
        client.delete(f"{BASE_URL}/api{paths[path]}/{rid}")


def events(client, start, end):
    r = client.get(f"{BASE_URL}/api/calendar", params={"start": start, "end": end})
    assert r.status_code == 200, r.text
    return r.json()["events"]


def test_events_of_every_kind_in_range(client, records):
    ev = [e for e in events(client, D(-3), D(30)) if records in e["title"] or (e["kind"] == "meals")]
    by_kind = {}
    for e in ev:
        by_kind.setdefault(e["kind"], []).append(e)

    task = next(e for e in by_kind["task"] if e["title"] == f"{records} task")
    assert task["date"] == D(2) and task["meta"]["priority"] == "high" and task["meta"]["recurring"] == "weekly"
    assert not any("far task" in e["title"] for e in by_kind["task"])

    expiry = [e for e in by_kind["expiry"] if records in e["title"]]
    assert [e["date"] for e in expiry] == [D(1)]  # out-of-stock items are not reminders
    assert expiry[0]["meta"]["storage_location"].lower() == "fridge"  # canonicalised to the location's name

    shop = next(e for e in by_kind["shopping"] if records in e["title"])
    assert shop["date"] == D(0)  # never spawned -> due now

    meals_today = next(e for e in by_kind["meals"] if e["date"] == D(0))
    assert meals_today["meta"]["count"] >= 2 and meals_today["meta"]["calories"] >= 1300.5

    assert any(e["kind"] == "workout" and e["date"] == D(-1) for e in events(client, D(-1), D(-1)))
    assert any(e["kind"] == "weight" and e["date"] == D(-1) for e in events(client, D(-1), D(-1)))


def test_events_are_sorted_by_date(client, records):
    dates = [e["date"] for e in events(client, D(-3), D(30))]
    assert dates == sorted(dates)


@pytest.mark.parametrize("params", [
    {"start": "2026-01-10", "end": "2026-01-01"},       # end before start
    {"start": "2026-01-01", "end": "2026-12-31"},       # too long
    {"start": "01/01/2026", "end": "2026-01-31"},       # not ISO
])
def test_rejects_bad_ranges(client, params):
    assert client.get(f"{BASE_URL}/api/calendar", params=params).status_code == 422


def test_requires_login():
    assert requests.get(f"{BASE_URL}/api/calendar", params={"start": D(0), "end": D(1)}).status_code == 401
