"""BUG-007 (decided 2026-10-28): deleting a person keeps money they already paid you. Their splits and payment
records go, but the "Payment from <name>" income stays in the account, so the balance does not change."""
import uuid

import pytest

from support_auth import BASE_URL, session, shared_money_lock


@pytest.fixture(scope="module", autouse=True)
def _exclusive_money():
    with shared_money_lock():
        yield


@pytest.fixture(scope="module")
def client():
    return session()


def revolut_balance(client):
    return next(a["balance"] for a in client.get(f"{BASE_URL}/api/accounts").json() if a["type"] == "revolut")


def test_deleting_a_person_keeps_received_payments(client):
    name = f"TEST_keep_{uuid.uuid4().hex[:6]}"
    person = client.post(f"{BASE_URL}/api/people", json={"name": name}).json()
    before = revolut_balance(client)
    s = client.post(f"{BASE_URL}/api/settlements", json={
        "person": name, "amount": 7.25, "method": "Revolut", "account": "revolut", "direction": "in"}).json()
    payment_txn = s["balance_transaction_id"]
    try:
        assert revolut_balance(client) == round(before + 7.25, 2)
        assert client.delete(f"{BASE_URL}/api/people/{person['id']}").status_code == 200
        txn = next((t for t in client.get(f"{BASE_URL}/api/transactions").json() if t["id"] == payment_txn), None)
        assert txn is not None and txn["description"] == f"Payment from {name}"
        assert revolut_balance(client) == round(before + 7.25, 2)
    finally:
        client.delete(f"{BASE_URL}/api/transactions/{payment_txn}")
        client.delete(f"{BASE_URL}/api/people/{person['id']}")
    assert revolut_balance(client) == before
