"""BUG-006: removing a single shopping-list item (the Groceries page calls DELETE /shopping/{id})."""
import uuid

import pytest
import requests

from support_auth import BASE_URL, session


@pytest.fixture(scope="module")
def client():
    return session()


def test_delete_single_item(client):
    name = f"TEST_del_{uuid.uuid4().hex[:6]}"
    item = client.post(f"{BASE_URL}/api/shopping", json={"name": name}).json()
    try:
        r = client.delete(f"{BASE_URL}/api/shopping/{item['id']}")
        assert r.status_code == 200, r.text
        assert all(i["id"] != item["id"] for i in client.get(f"{BASE_URL}/api/shopping").json()["items"])
        assert client.delete(f"{BASE_URL}/api/shopping/{item['id']}").status_code == 404
    finally:
        client.post(f"{BASE_URL}/api/shopping/bulk-delete", json={"ids": [item["id"]]})


def test_delete_requires_login():
    assert requests.delete(f"{BASE_URL}/api/shopping/anything").status_code == 401
