"""Setting an account's balance, Revolut spaces, and legacy account aliases.
Everything is created on a throwaway Revolut space and removed afterwards."""
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
    s.headers.update({"Authorization": f"Bearer {login(OWNER_EMAIL, OWNER_PASSWORD)['token']}", "Content-Type": "application/json"})
    return s


@pytest.fixture
def space(client):
    accounts = client.get(f"{BASE_URL}/api/accounts").json()
    revolut = next(a for a in accounts if a["type"] == "revolut")
    r = client.post(f"{BASE_URL}/api/accounts", json={
        "name": f"TEST_space_{uuid.uuid4().hex[:6]}", "type": "revolut_space",
        "parent_id": revolut["id"], "opening_balance": 0})
    assert r.status_code == 200, r.text
    acc = r.json()
    yield acc
    for t in client.get(f"{BASE_URL}/api/transactions").json():
        if t.get("account") == acc["id"]:
            client.delete(f"{BASE_URL}/api/transactions/{t['id']}")
    client.delete(f"{BASE_URL}/api/accounts/{acc['id']}")


def balance_of(client, account_id):
    return next(a["balance"] for a in client.get(f"{BASE_URL}/api/accounts").json() if a["id"] == account_id)


def test_set_balance_without_transactions(client, space):
    r = client.put(f"{BASE_URL}/api/accounts/{space['id']}", json={"balance": 16.39})
    assert r.status_code == 200, r.text
    assert balance_of(client, space["id"]) == 16.39


def test_set_balance_accounts_for_existing_transactions(client, space):
    client.put(f"{BASE_URL}/api/accounts/{space['id']}", json={"balance": 30.0})
    r = client.post(f"{BASE_URL}/api/transactions/expense", json={
        "amount": 10.0, "merchant": "TEST_balance", "account": space["id"], "participants": ["Me"]})
    assert r.status_code == 200, r.text
    assert balance_of(client, space["id"]) == 20.0
    # "my balance is 16.39" must mean the balance shown is 16.39, whatever happened before.
    client.put(f"{BASE_URL}/api/accounts/{space['id']}", json={"balance": 16.39})
    assert balance_of(client, space["id"]) == 16.39


def test_revolut_space_counts_towards_revolut(client, space):
    before = client.get(f"{BASE_URL}/api/analytics/summary").json()["revolut"]
    client.put(f"{BASE_URL}/api/accounts/{space['id']}", json={"balance": 12.5})
    after = client.get(f"{BASE_URL}/api/analytics/summary").json()["revolut"]
    assert round(after - before, 2) == 12.5


def test_locked_space_is_kept_out_of_available(client, space):
    client.put(f"{BASE_URL}/api/accounts/{space['id']}", json={"balance": 7.0, "is_locked": True})
    s = client.get(f"{BASE_URL}/api/analytics/summary").json()
    assert s["revolut_locked"] >= 7.0
    assert s["revolut_total"] == round(s["revolut"] + s["revolut_locked"], 2)


def test_legacy_alias_is_stored_as_account_id(client):
    revolut_id = next(a["id"] for a in client.get(f"{BASE_URL}/api/accounts").json() if a["type"] == "revolut")
    r = client.post(f"{BASE_URL}/api/transactions/expense", json={
        "amount": 1.0, "merchant": "TEST_alias", "account": "revolut", "participants": ["Me"]})
    assert r.status_code == 200, r.text
    txn = r.json()["transaction"]
    try:
        assert txn["account"] == revolut_id
    finally:
        client.delete(f"{BASE_URL}/api/transactions/{txn['id']}")
