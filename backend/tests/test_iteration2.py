"""Backend tests for iteration 2: refund tracking, edit expense, groceries CRUD,
shopping list, recipes cook, AI update/delete/mark_refunded."""
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
TAG = f"TEST2_{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


# --- Serialize txn: payment_method, refund status ---
class TestSerializeTxn:
    def test_payment_method_cash_card(self, client):
        r1 = client.post(f"{BASE_URL}/api/transactions/expense", json={
            "amount": 5.0, "merchant": f"{TAG}_cashx", "category": "Other",
            "account": "cash", "participants": ["Me"]})
        assert r1.status_code == 200
        t1 = r1.json()["transaction"]
        r2 = client.post(f"{BASE_URL}/api/transactions/expense", json={
            "amount": 7.0, "merchant": f"{TAG}_cardx", "category": "Other",
            "account": "revolut", "participants": ["Me"]})
        t2 = r2.json()["transaction"]
        # GET should have payment_method
        txns = client.get(f"{BASE_URL}/api/transactions").json()
        m1 = next(t for t in txns if t["id"] == t1["id"])
        m2 = next(t for t in txns if t["id"] == t2["id"])
        assert m1["payment_method"] == "cash"
        assert m2["payment_method"] == "card"
        assert m1["refund_status"] == "personal"
        # cleanup
        client.delete(f"{BASE_URL}/api/transactions/{t1['id']}")
        client.delete(f"{BASE_URL}/api/transactions/{t2['id']}")

    def test_payment_method_filter(self, client):
        r = client.get(f"{BASE_URL}/api/transactions", params={"payment_method": "card"})
        assert r.status_code == 200
        for t in r.json():
            if t.get("type") == "expense":
                assert t["payment_method"] == "card"


# --- PUT /transactions/{tid}: edit + split scaling ---
class TestEditExpense:
    def test_update_amount_scales_splits(self, client):
        p = client.post(f"{BASE_URL}/api/people", json={"name": f"{TAG}_ed"}).json()
        r = client.post(f"{BASE_URL}/api/transactions/expense", json={
            "amount": 40.0, "merchant": f"{TAG}_edx", "category": "Other",
            "account": "cash", "participants": ["Me", f"{TAG}_ed"], "split_mode": "equal"})
        t = r.json()["transaction"]
        # Me=20, other=20
        assert t["personal_amount"] == 20.0
        assert t["reimbursable_amount"] == 20.0
        # Update amount to 60
        r2 = client.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"amount": 60.0})
        assert r2.status_code == 200, r2.text
        t2 = r2.json()
        # Scale factor 1.5 -> Me=30, other=30
        assert t2["gross_amount"] == 60.0
        assert t2["personal_amount"] == 30.0
        assert t2["reimbursable_amount"] == 30.0
        # Update payment_method
        r3 = client.put(f"{BASE_URL}/api/transactions/{t['id']}", json={"payment_method": "card"})
        assert r3.json()["account"] == "revolut"
        assert r3.json()["payment_method"] == "card"
        # cleanup
        client.delete(f"{BASE_URL}/api/transactions/{t['id']}")
        client.delete(f"{BASE_URL}/api/people/{p['id']}")

    def test_update_personal_amount(self, client):
        p = client.post(f"{BASE_URL}/api/people", json={"name": f"{TAG}_pa"}).json()
        r = client.post(f"{BASE_URL}/api/transactions/expense", json={
            "amount": 50.0, "merchant": f"{TAG}_pax", "category": "Other",
            "account": "cash", "participants": ["Me", f"{TAG}_pa"], "split_mode": "equal"})
        t = r.json()["transaction"]
        r2 = client.put(f"{BASE_URL}/api/transactions/{t['id']}",
                        json={"amount": 50.0, "personal_amount": 15.0})
        assert r2.status_code == 200
        t2 = r2.json()
        assert t2["personal_amount"] == 15.0
        assert t2["reimbursable_amount"] == 35.0
        client.delete(f"{BASE_URL}/api/transactions/{t['id']}")
        client.delete(f"{BASE_URL}/api/people/{p['id']}")


# --- Refund tracking via settlements with transaction_id ---
class TestRefundLinking:
    def test_refund_reduces_remaining(self, client):
        person_name = f"{TAG}_ref"
        p = client.post(f"{BASE_URL}/api/people", json={"name": person_name}).json()
        r = client.post(f"{BASE_URL}/api/transactions/expense", json={
            "amount": 20.0, "merchant": f"{TAG}_ref_exp", "category": "Other",
            "account": "cash", "participants": ["Me", person_name], "split_mode": "equal"})
        t = r.json()["transaction"]
        assert t["reimbursable_amount"] == 10.0
        # Partial refund
        s = client.post(f"{BASE_URL}/api/settlements", json={
            "person": person_name, "amount": 4.0, "method": "Revolut",
            "account": "revolut", "direction": "in", "transaction_id": t["id"]})
        assert s.status_code == 200
        # Fetch
        txns = client.get(f"{BASE_URL}/api/transactions").json()
        got = next(x for x in txns if x["id"] == t["id"])
        assert got["amount_refunded"] == 4.0
        assert got["remaining_refund"] == 6.0
        assert got["refund_status"] == "partial"
        # Full refund
        client.post(f"{BASE_URL}/api/settlements", json={
            "person": person_name, "amount": 6.0, "method": "Revolut",
            "account": "revolut", "direction": "in", "transaction_id": t["id"]})
        txns2 = client.get(f"{BASE_URL}/api/transactions").json()
        got2 = next(x for x in txns2 if x["id"] == t["id"])
        assert got2["remaining_refund"] == 0.0
        assert got2["refund_status"] == "settled"
        # cleanup
        client.delete(f"{BASE_URL}/api/transactions/{t['id']}")
        client.delete(f"{BASE_URL}/api/people/{p['id']}")


# --- Groceries CRUD ---
class TestGroceriesCRUD:
    def test_grocery_lifecycle(self, client):
        name = f"{TAG}_rice"
        r = client.post(f"{BASE_URL}/api/groceries", json={"name": name, "quantity": 2})
        gid = r.json()["id"]
        assert r.json().get("price") is None  # unknown price
        # Update quantity
        r2 = client.put(f"{BASE_URL}/api/groceries/{gid}", json={"quantity": 5, "price": 1.99, "store": "Lidl"})
        assert r2.json()["quantity"] == 5
        assert r2.json()["price"] == 1.99
        # cleanup
        client.delete(f"{BASE_URL}/api/groceries/{gid}")


# --- Transaction grocery rollback ---
class TestTransactionGroceryRollback:
    def test_multi_item_expense_rollback(self, client):
        # Create expense with add_to_inventory and multiple items
        r = client.post(f"{BASE_URL}/api/transactions/expense", json={
            "amount": 10.0, "merchant": f"{TAG}_store", "category": "Groceries",
            "account": "cash", "participants": ["Me"], "add_to_inventory": True,
            "items": [
                {"name": f"{TAG}_milk", "price": 2.0, "assigned": ["Me"]},
                {"name": f"{TAG}_eggs", "price": 3.0, "assigned": ["Me"]},
                {"name": f"{TAG}_milk", "price": 2.0, "assigned": ["Me"]}
            ]
        })
        assert r.status_code == 200
        t = r.json()["transaction"]

        # Verify merged grocery quantities
        gs = client.get(f"{BASE_URL}/api/groceries").json()
        milk = next((x for x in gs if x["name"] == f"{TAG}_milk"), None)
        eggs = next((x for x in gs if x["name"] == f"{TAG}_eggs"), None)
        assert milk is not None
        assert milk["quantity"] == 2
        assert eggs is not None
        assert eggs["quantity"] == 1

        # Delete the transaction
        d = client.delete(f"{BASE_URL}/api/transactions/{t['id']}")
        assert d.status_code == 200

        # Verify groceries removed
        gs2 = client.get(f"{BASE_URL}/api/groceries").json()
        assert not any(x["name"] == f"{TAG}_milk" for x in gs2)
        assert not any(x["name"] == f"{TAG}_eggs" for x in gs2)


# --- Shopping list ---
class TestShopping:
    def test_shopping_flow(self, client):
        # Add a grocery with price to seed price intelligence
        gname = f"{TAG}_bread"
        g = client.post(f"{BASE_URL}/api/groceries",
                        json={"name": gname, "quantity": 1, "price": 2.5, "store": "Continente"}).json()
        # Add shopping item
        s = client.post(f"{BASE_URL}/api/shopping", json={"name": gname}).json()
        payload = client.get(f"{BASE_URL}/api/shopping").json()
        assert "recommendation" in payload
        assert "items" in payload
        # Buy it
        b = client.post(f"{BASE_URL}/api/shopping/{s['id']}/buy",
                        json={"price": 2.5, "store": "Continente"})
        assert b.status_code == 200
        client.delete(f"{BASE_URL}/api/groceries/{g['id']}")

    def test_cart_partial_purchase(self, client):
        # Create a new list
        lst = client.post(f"{BASE_URL}/api/shopping/lists", json={"name": f"{TAG}_cart"}).json()
        # Seed inventory so generate won't touch it
        client.post(f"{BASE_URL}/api/groceries", json={"name": f"{TAG}_apples", "quantity": 5, "price": 1.0})

        # Add three items to the list
        a = client.post(f"{BASE_URL}/api/shopping", json={"name": f"{TAG}_milk", "quantity": 2, "list_id": lst["id"]}).json()
        b = client.post(f"{BASE_URL}/api/shopping", json={"name": f"{TAG}_eggs", "quantity": 12, "list_id": lst["id"]}).json()
        c = client.post(f"{BASE_URL}/api/shopping", json={"name": f"{TAG}_butter", "quantity": 1, "list_id": lst["id"]}).json()

        # Select only milk and eggs
        client.post(f"{BASE_URL}/api/shopping/{a['id']}/toggle")
        client.post(f"{BASE_URL}/api/shopping/{b['id']}/toggle")

        # Submit purchase
        r = client.post(f"{BASE_URL}/api/shopping/lists/{lst['id']}/submit", json={
            "items": [
                {"item_id": a["id"], "quantity": 2, "actual_price": 1.2},
                {"item_id": b["id"], "quantity": 12, "actual_price": 3.5},
            ]
        })
        assert r.status_code == 200
        data = r.json()
        assert len(data["purchased"]) == 2
        assert data["total_cost"] == 2 * 1.2 + 12 * 3.5

        # Inventory updated for selected items only
        inv = client.get(f"{BASE_URL}/api/groceries").json()
        assert any(x["name"] == f"{TAG}_milk" and float(x["quantity"]) == 2 for x in inv)
        assert any(x["name"] == f"{TAG}_eggs" and float(x["quantity"]) == 12 for x in inv)
        assert not any(x["name"] == f"{TAG}_butter" for x in inv)

        # Unselected item remains on list
        payload = client.get(f"{BASE_URL}/api/shopping", params={"list_id": lst["id"]}).json()
        remaining = [x["name"] for x in payload["items"]]
        assert f"{TAG}_butter" in remaining
        assert f"{TAG}_milk" not in remaining
        assert f"{TAG}_eggs" not in remaining

        # Cleanup
        client.delete(f"{BASE_URL}/api/shopping/lists/{lst['id']}")
        for x in inv:
            if x["name"].startswith(f"{TAG}_"):
                client.delete(f"{BASE_URL}/api/groceries/{x['id']}")

    def test_generate_list_does_not_affect_inventory(self, client):
        lst = client.post(f"{BASE_URL}/api/shopping/lists", json={"name": f"{TAG}_gen"}).json()
        # Seed low-stock item
        g = client.post(f"{BASE_URL}/api/groceries", json={"name": f"{TAG}_low", "quantity": 0, "low_threshold": 1}).json()
        before = client.get(f"{BASE_URL}/api/groceries").json()
        before_qty = next(x for x in before if x["id"] == g["id"])["quantity"]

        # Generate list
        r = client.post(f"{BASE_URL}/api/shopping/generate", params={"list_id": lst["id"]})
        assert r.status_code == 200

        # Inventory unchanged
        after = client.get(f"{BASE_URL}/api/groceries").json()
        after_qty = next(x for x in after if x["id"] == g["id"])["quantity"]
        assert after_qty == before_qty

        # But list has the item
        payload = client.get(f"{BASE_URL}/api/shopping", params={"list_id": lst["id"]}).json()
        assert any(x["name"] == f"{TAG}_low" for x in payload["items"])

        client.delete(f"{BASE_URL}/api/shopping/lists/{lst['id']}")
        client.delete(f"{BASE_URL}/api/groceries/{g['id']}")

    def test_list_budget_and_low_stock(self, client):
        lst = client.post(f"{BASE_URL}/api/shopping/lists", json={"name": f"{TAG}_budget", "budget": 50}).json()
        assert lst["budget"] == 50.0

        # Add item with estimated price
        it = client.post(f"{BASE_URL}/api/shopping", json={"name": f"{TAG}_cheese", "quantity": 2, "estimated_price": 10, "list_id": lst["id"]}).json()
        payload = client.get(f"{BASE_URL}/api/shopping", params={"list_id": lst["id"]}).json()
        assert payload["budget_summary"]["budget"] == 50.0
        assert payload["budget_summary"]["estimated_total"] == 20.0
        assert payload["budget_summary"]["remaining"] == 30.0

        # Update budget
        client.put(f"{BASE_URL}/api/shopping/lists/{lst['id']}", json={"budget": 15})
        payload = client.get(f"{BASE_URL}/api/shopping", params={"list_id": lst["id"]}).json()
        assert payload["budget_summary"]["budget"] == 15.0
        assert payload["budget_summary"]["remaining"] == -5.0

        # Low-stock endpoint
        client.post(f"{BASE_URL}/api/groceries", json={"name": f"{TAG}_stock", "quantity": 0, "low_threshold": 1})
        low = client.get(f"{BASE_URL}/api/groceries/low-stock").json()
        assert any(x["name"] == f"{TAG}_stock" and x["status"] == "out" for x in low)

        # Analytics includes grocery summary
        summary = client.get(f"{BASE_URL}/api/analytics/summary").json()
        assert "grocery" in summary
        assert summary["grocery"]["pending_total"] >= 1
        assert any(l["id"] == lst["id"] for l in summary["grocery"]["active_lists"])

        client.delete(f"{BASE_URL}/api/shopping/{it['id']}")
        client.delete(f"{BASE_URL}/api/shopping/lists/{lst['id']}")


# --- Recipes cook ---
class TestRecipes:
    def test_cook_decrements_inventory(self, client):
        ingname = f"{TAG}_flour"
        g = client.post(f"{BASE_URL}/api/groceries",
                        json={"name": ingname, "quantity": 10}).json()
        r = client.post(f"{BASE_URL}/api/recipes", json={
            "name": f"{TAG}_cake", "servings": 2,
            "ingredients": [{"name": ingname, "quantity": 3, "unit": "cup"}],
            "calories": 400})
        rid = r.json()["id"]
        c = client.post(f"{BASE_URL}/api/recipes/{rid}/cook")
        assert c.status_code == 200
        assert c.json()["meal_logged"] is True
        # Grocery decremented
        gs = client.get(f"{BASE_URL}/api/groceries").json()
        upd = next(x for x in gs if x["id"] == g["id"])
        assert upd["quantity"] == 7
        client.delete(f"{BASE_URL}/api/recipes/{rid}")
        client.delete(f"{BASE_URL}/api/groceries/{g['id']}")


# --- Analytics summary new fields ---
class TestAnalytics:
    def test_new_fields(self, client):
        r = client.get(f"{BASE_URL}/api/analytics/summary").json()
        for k in ["cash_spent", "card_spent", "refunded", "pending", "grocery"]:
            assert k in r
        assert "out_of_stock" in r["grocery"]
        assert "low_stock" in r["grocery"]


# --- AI tools (skips gracefully if key unavailable) ---
class TestAITools:
    def test_ai_delete_confirmation(self, client):
        # Create an expense to target
        r = client.post(f"{BASE_URL}/api/transactions/expense", json={
            "amount": 3.14, "merchant": f"{TAG}_aidel", "category": "Other",
            "account": "cash", "participants": ["Me"]})
        t = r.json()["transaction"]
        resp = client.post(f"{BASE_URL}/api/ai/chat",
                           json={"message": f"Delete the {TAG}_aidel expense"}, timeout=90)
        if resp.status_code != 200:
            pytest.skip(f"AI unavailable: {resp.status_code}")
        data = resp.json()
        # Should not have deleted yet (asks for confirmation)
        txns = client.get(f"{BASE_URL}/api/transactions").json()
        still = any(x["id"] == t["id"] for x in txns)
        # Either it asks (still exists) or it already deleted — record it
        # According to spec: must ask first
        assert still, "AI deleted without confirmation!"
        client.delete(f"{BASE_URL}/api/transactions/{t['id']}")
