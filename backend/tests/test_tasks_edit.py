"""Editing tasks and recurring tasks (TASK-001). Test tasks are prefixed TEST_ and removed afterwards."""
import os
import uuid
from pathlib import Path
import requests
from support_auth import login, OWNER_EMAIL, OWNER_PASSWORD
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")



@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {login(OWNER_EMAIL, OWNER_PASSWORD)['token']}"})
    return s


@pytest.fixture
def title(client):
    t = f"TEST_task_{uuid.uuid4().hex[:6]}"
    yield t
    for task in client.get(f"{BASE_URL}/api/tasks").json():
        if task["title"] == t:
            client.delete(f"{BASE_URL}/api/tasks/{task['id']}")


def tasks_named(client, title):
    return [t for t in client.get(f"{BASE_URL}/api/tasks").json() if t["title"] == title]


def test_edit_all_fields(client, title):
    t = client.post(f"{BASE_URL}/api/tasks", json={"title": title}).json()
    r = client.put(f"{BASE_URL}/api/tasks/{t['id']}", json={
        "title": title, "priority": "high", "due": "2026-02-10", "recurring": "weekly", "done": False})
    assert r.status_code == 200, r.text
    saved = tasks_named(client, title)[0]
    assert (saved["priority"], saved["due"], saved["recurring"]) == ("high", "2026-02-10", "weekly")


def test_rejects_bad_priority_and_due(client, title):
    t = client.post(f"{BASE_URL}/api/tasks", json={"title": title}).json()
    assert client.put(f"{BASE_URL}/api/tasks/{t['id']}", json={"title": title, "priority": "urgent"}).status_code == 422
    assert client.put(f"{BASE_URL}/api/tasks/{t['id']}", json={"title": title, "due": "10/02/2026"}).status_code == 422
    assert client.put(f"{BASE_URL}/api/tasks/{t['id']}", json={"title": title, "recurring": "hourly"}).status_code == 422


@pytest.mark.parametrize("recurring,due,next_due", [
    ("daily", "2026-02-10", "2026-02-11"),
    ("weekly", "2026-02-10", "2026-02-17"),
    ("monthly", "2026-01-31", "2026-02-28"),
])
def test_completing_recurring_task_creates_next(client, title, recurring, due, next_due):
    t = client.post(f"{BASE_URL}/api/tasks", json={"title": title, "priority": "high", "due": due, "recurring": recurring}).json()
    r = client.put(f"{BASE_URL}/api/tasks/{t['id']}", json={**{k: t[k] for k in ("title", "priority", "due", "recurring")}, "done": True})
    assert r.status_code == 200, r.text
    rows = tasks_named(client, title)
    assert len(rows) == 2
    nxt = next(x for x in rows if x["id"] != t["id"])
    assert (nxt["done"], nxt["due"], nxt["recurring"], nxt["priority"]) == (False, next_due, recurring, "high")
    # Saving the completed task again (e.g. an edit) must not create another copy.
    client.put(f"{BASE_URL}/api/tasks/{t['id']}", json={**{k: t[k] for k in ("title", "priority", "due", "recurring")}, "done": True})
    assert len(tasks_named(client, title)) == 2


def test_completing_non_recurring_task_creates_nothing(client, title):
    t = client.post(f"{BASE_URL}/api/tasks", json={"title": title, "due": "2026-02-10"}).json()
    client.put(f"{BASE_URL}/api/tasks/{t['id']}", json={"title": title, "due": "2026-02-10", "done": True})
    assert len(tasks_named(client, title)) == 1
