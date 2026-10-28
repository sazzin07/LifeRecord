"""Catalog API: subcategory, diet tags, icon, search by them, and the idempotent library import."""
import os
import uuid
from pathlib import Path
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

OWNER_EMAIL = "tiagosa743@gmail.com"
OWNER_PASSWORD = "LifeRecord"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"})
    return s


def test_new_product_fields_round_trip_and_are_searchable(client):
    word = f"zxq{uuid.uuid4().hex[:6]}"
    r = client.post(f"{BASE_URL}/api/products", json={
        "name": f"TEST_{word}", "category": "Dairy", "subcategory": f"Sub{word}", "icon": "🧀",
        "tags": ["vegetarian", "gluten-free"], "default_unit": "pack"})
    assert r.status_code == 200, r.text
    p = r.json()
    try:
        assert (p["subcategory"], p["icon"], p["tags"]) == (f"Sub{word}", "🧀", ["vegetarian", "gluten-free"])
        by_sub = client.get(f"{BASE_URL}/api/products/search", params={"q": f"Sub{word}"}).json()
        assert [x["id"] for x in by_sub] == [p["id"]]
        r2 = client.put(f"{BASE_URL}/api/products/{p['id']}", json={"tags": ["vegan", "vegetarian"], "subcategory": "Cheese"})
        assert r2.json()["tags"] == ["vegan", "vegetarian"] and r2.json()["subcategory"] == "Cheese"
    finally:
        client.delete(f"{BASE_URL}/api/products/{p['id']}")


def test_search_finds_products_by_diet_tag_and_synonym(client):
    vegan = client.get(f"{BASE_URL}/api/products/search", params={"q": "vegan"}).json()
    assert vegan and all("vegan" in (x.get("tags") or []) for x in vegan)
    assert "Courgette" in [x["name"] for x in client.get(f"{BASE_URL}/api/products/search", params={"q": "zucchini"}).json()]


def test_library_import_is_idempotent_and_keeps_user_edits(client):
    first = client.post(f"{BASE_URL}/api/products/import-library")
    assert first.status_code == 200, first.text
    again = client.post(f"{BASE_URL}/api/products/import-library").json()
    assert again["added"] == 0 and again["enriched"] == 0
    products = client.get(f"{BASE_URL}/api/products").json()
    assert len(products) >= again["library_size"]
    assert all(p.get("subcategory") for p in products if p["name"] and not p["name"].startswith("TEST"))
