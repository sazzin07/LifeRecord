"""Editing workouts, weight entries and progress photos (FIT-002, BODY-002, BODY-001).
Every record is created by the test and removed afterwards."""
import base64
import os
from pathlib import Path
import requests
from support_auth import login
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

OWNER_EMAIL = os.environ.get("TEST_EMAIL", "tiagosa743@gmail.com")
OWNER_PASSWORD = os.environ.get("TEST_PASSWORD", "LifeRecord")

# 1x1 transparent PNG
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {login(OWNER_EMAIL, OWNER_PASSWORD)['token']}"})
    return s


@pytest.fixture
def workout(client):
    r = client.post(f"{BASE_URL}/api/workouts", json={
        "type": "Push", "date": "2026-01-02", "notes": "TEST_workout",
        "exercises": [{"name": "TEST_Bench", "sets": [{"reps": 5, "weight": 60}]}]})
    assert r.status_code == 200, r.text
    w = r.json()
    yield w
    client.delete(f"{BASE_URL}/api/workouts/{w['id']}")


@pytest.fixture
def weight(client):
    r = client.post(f"{BASE_URL}/api/weight", json={"weight": 80.5, "date": "2026-01-02", "note": "TEST_weight"})
    assert r.status_code == 200, r.text
    w = r.json()
    yield w
    client.delete(f"{BASE_URL}/api/weight/{w['id']}")


@pytest.fixture
def photo(client):
    r = client.post(f"{BASE_URL}/api/photos", params={"note": "TEST_photo"},
                    files={"file": ("t.png", PNG, "image/png")})
    assert r.status_code == 200, r.text
    p = r.json()
    yield p
    client.delete(f"{BASE_URL}/api/photos/{p['id']}")


def test_update_workout_replaces_fields(client, workout):
    r = client.put(f"{BASE_URL}/api/workouts/{workout['id']}", json={
        "type": "Legs", "date": "2026-01-03", "notes": "TEST_edited",
        "exercises": [{"name": "TEST_Squat", "sets": [{"reps": 3, "weight": 100}, {"reps": 3, "weight": 105}]}]})
    assert r.status_code == 200, r.text
    saved = next(w for w in client.get(f"{BASE_URL}/api/workouts").json() if w["id"] == workout["id"])
    assert saved["type"] == "Legs"
    assert saved["date"] == "2026-01-03"
    assert saved["notes"] == "TEST_edited"
    assert [e["name"] for e in saved["exercises"]] == ["TEST_Squat"]
    assert len(saved["exercises"][0]["sets"]) == 2
    prs = {p["name"]: p for p in client.get(f"{BASE_URL}/api/workouts/prs").json()}
    assert prs["TEST_Squat"]["best_weight"] == 105
    assert "TEST_Bench" not in prs


def test_update_workout_unknown_is_404(client):
    r = client.put(f"{BASE_URL}/api/workouts/does-not-exist", json={"type": "Push", "exercises": []})
    assert r.status_code == 404


def test_update_workout_rejects_bad_date(client, workout):
    r = client.put(f"{BASE_URL}/api/workouts/{workout['id']}", json={"type": "Push", "date": "03/01/2026"})
    assert r.status_code == 422


def test_update_weight(client, weight):
    r = client.put(f"{BASE_URL}/api/weight/{weight['id']}", json={"weight": 79.2, "date": "2026-01-04", "note": "TEST_edited"})
    assert r.status_code == 200, r.text
    saved = next(w for w in client.get(f"{BASE_URL}/api/weight").json() if w["id"] == weight["id"])
    assert float(saved["weight"]) == 79.2
    assert saved["date"] == "2026-01-04"
    assert saved["note"] == "TEST_edited"


def test_update_weight_unknown_is_404(client):
    r = client.put(f"{BASE_URL}/api/weight/does-not-exist", json={"weight": 70})
    assert r.status_code == 404


def test_update_photo_note_and_date(client, photo):
    r = client.put(f"{BASE_URL}/api/photos/{photo['id']}", json={"note": "TEST_edited", "date": "2026-01-05"})
    assert r.status_code == 200, r.text
    saved = next(p for p in client.get(f"{BASE_URL}/api/photos").json() if p["id"] == photo["id"])
    assert saved["note"] == "TEST_edited"
    assert saved["date"] == "2026-01-05"
    assert saved["url"] == photo["url"]


def test_update_photo_unknown_is_404(client):
    r = client.put(f"{BASE_URL}/api/photos/does-not-exist", json={"note": "x"})
    assert r.status_code == 404


def test_deleting_a_photo_removes_the_file(client):
    r = client.post(f"{BASE_URL}/api/photos", params={"note": "TEST_photo"}, files={"file": ("t.png", PNG, "image/png")})
    p = r.json()
    storage = Path(os.environ.get("STORAGE_DIR", Path(__file__).resolve().parents[1] / "storage"))
    stored = storage / p["storage_path"]
    assert stored.exists()
    assert client.delete(f"{BASE_URL}/api/photos/{p['id']}").status_code == 200
    assert not stored.exists()
    assert client.get(f"{BASE_URL}{p['url']}").status_code == 404
    assert client.delete(f"{BASE_URL}/api/photos/{p['id']}").status_code == 404
