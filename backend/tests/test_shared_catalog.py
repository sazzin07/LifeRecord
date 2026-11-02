"""The built-in food catalog is shared by every account; what a person adds or edits stays private to them."""
import sys
import uuid
from pathlib import Path

import requests
import support_db
from support_auth import BASE_URL

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from catalog_data import LIBRARY  # noqa: E402

PW = "CatalogPass123"


def _new_user():
    email = f"catiso_{uuid.uuid4().hex[:8]}@example.com"
    assert requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": PW, "name": "c"}).status_code == 200
    code = support_db.verification_code_for(email)
    r = requests.post(f"{BASE_URL}/api/auth/verify", json={"email": email, "code": code, "password": PW})
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


def _names(s):
    return {p["name"]: p for p in s.get(f"{BASE_URL}/api/products").json()}


def test_shared_rows_have_no_owner_and_cover_the_whole_library():
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COUNT(DISTINCT name_lower) FROM products WHERE user_id IS NULL")
            total, distinct = cur.fetchone()
    finally:
        conn.close()
    assert total == distinct >= len(LIBRARY)


def test_a_brand_new_account_sees_the_catalog_without_importing_anything():
    a = _new_user()
    names = _names(a)
    assert len(names) >= len(LIBRARY)
    assert "Courgette" in names
    assert any(p["name"] == "Courgette" for p in a.get(f"{BASE_URL}/api/products/search", params={"q": "zucchini"}).json())


def test_private_products_stay_private():
    a, b = _new_user(), _new_user()
    mine = f"Zq{uuid.uuid4().hex[:8]}"
    r = a.post(f"{BASE_URL}/api/products", json={"name": mine, "category": "Other", "default_unit": "unit"})
    assert r.status_code == 200
    assert mine in _names(a) and mine not in _names(b)
    assert not b.get(f"{BASE_URL}/api/products/search", params={"q": mine}).json()
    assert b.delete(f"{BASE_URL}/api/products/{r.json()['id']}").status_code == 404  # not theirs


def test_editing_a_shared_item_makes_a_private_copy_and_leaves_everyone_else_alone():
    a, b = _new_user(), _new_user()
    shared = _names(a)["Courgette"]
    r = a.put(f"{BASE_URL}/api/products/{shared['id']}", json={"typical_quantity": 7.0, "is_favorite": True})
    assert r.status_code == 200, r.text
    mine = r.json()
    assert mine["id"] != shared["id"] and mine["name"] == "Courgette" and mine["is_favorite"] is True
    a_view = [p for p in a.get(f"{BASE_URL}/api/products").json() if p["name"] == "Courgette"]
    assert len(a_view) == 1 and a_view[0]["id"] == mine["id"]  # their copy replaces it for them, no duplicate
    b_view = [p for p in b.get(f"{BASE_URL}/api/products").json() if p["name"] == "Courgette"]
    assert len(b_view) == 1 and b_view[0]["id"] == shared["id"] and b_view[0]["is_favorite"] is False
    # editing again changes the same private copy
    again = a.put(f"{BASE_URL}/api/products/{shared['id']}", json={"typical_quantity": 9.0}).json()
    assert again["id"] == mine["id"]


def test_a_shared_item_cannot_be_deleted_by_a_user():
    a = _new_user()
    shared = _names(a)["Courgette"]
    r = a.delete(f"{BASE_URL}/api/products/{shared['id']}")
    assert r.status_code == 400 and "shared" in r.json()["detail"].lower()
    assert "Courgette" in _names(a)


def test_deleting_my_private_copy_brings_back_the_shared_item():
    a = _new_user()
    shared = _names(a)["Courgette"]
    mine = a.put(f"{BASE_URL}/api/products/{shared['id']}", json={"typical_quantity": 3.0}).json()
    assert a.delete(f"{BASE_URL}/api/products/{mine['id']}").status_code == 200
    back = [p for p in a.get(f"{BASE_URL}/api/products").json() if p["name"] == "Courgette"]
    assert len(back) == 1 and back[0]["id"] == shared["id"]


def test_the_library_import_endpoint_is_now_a_harmless_no_op():
    a = _new_user()
    r = a.post(f"{BASE_URL}/api/products/import-library").json()
    assert r["added"] == 0 and r["library_size"] == len(LIBRARY)
