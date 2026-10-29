"""Backend tests for iteration 2: refund tracking, edit expense, groceries CRUD,
shopping list, recipes cook, AI update/delete/mark_refunded."""
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
import requests
from support_auth import login, OWNER_EMAIL, OWNER_PASSWORD, shared_money_lock
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    env_path = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

TAG = f"TEST2_{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module", autouse=True)
def _exclusive_money():
    with shared_money_lock():
        yield


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    tok = login(OWNER_EMAIL, OWNER_PASSWORD)["token"]
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
        revolut_id = next(a["id"] for a in client.get(f"{BASE_URL}/api/accounts").json() if a["type"] == "revolut")
        assert r3.json()["account"] == revolut_id
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
        s2 = client.post(f"{BASE_URL}/api/settlements", json={
            "person": person_name, "amount": 6.0, "method": "Revolut",
            "account": "revolut", "direction": "in", "transaction_id": t["id"]})
        txns2 = client.get(f"{BASE_URL}/api/transactions").json()
        got2 = next(x for x in txns2 if x["id"] == t["id"])
        assert got2["remaining_refund"] == 0.0
        assert got2["refund_status"] == "settled"
        # cleanup (deleting the settlements also removes the income they added to the account)
        for settlement in (s, s2):
            client.delete(f"{BASE_URL}/api/settlements/{settlement.json()['id']}")
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
        stock = client.post(f"{BASE_URL}/api/groceries", json={"name": f"{TAG}_stock", "quantity": 0, "low_threshold": 1}).json()
        low = client.get(f"{BASE_URL}/api/groceries/low-stock").json()
        assert any(x["name"] == f"{TAG}_stock" and x["status"] == "out" for x in low)
        client.delete(f"{BASE_URL}/api/groceries/{stock['id']}")  # keep the owner's inventory clean

        # Analytics includes grocery summary
        summary = client.get(f"{BASE_URL}/api/analytics/summary").json()
        assert "grocery" in summary
        assert summary["grocery"]["pending_total"] >= 1
        assert any(l["id"] == lst["id"] for l in summary["grocery"]["active_lists"])

        client.delete(f"{BASE_URL}/api/shopping/{it['id']}")
        client.delete(f"{BASE_URL}/api/shopping/lists/{lst['id']}")

    def test_recurring_list_and_suggestions(self, client):
        # Create favorite grocery
        g = client.post(f"{BASE_URL}/api/groceries", json={"name": f"{TAG}_fav", "quantity": 1, "is_favorite": True}).json()

        # Suggestions should include it
        sugg = client.get(f"{BASE_URL}/api/groceries/suggestions").json()
        assert any(x["name"] == f"{TAG}_fav" for x in sugg)

        # Create recurring list
        rl = client.post(f"{BASE_URL}/api/shopping/recurring", json={
            "name": f"{TAG}_weekly",
            "schedule": "weekly",
            "items": [{"name": f"{TAG}_fav", "quantity": 2, "unit": "unit"}]
        }).json()
        assert rl["schedule"] == "weekly"
        assert len(rl["items"]) == 1

        # Spawn it
        spawned = client.post(f"{BASE_URL}/api/shopping/recurring/{rl['id']}/spawn").json()
        assert spawned["spawned"] == 1

        # Spawned list has the item
        payload = client.get(f"{BASE_URL}/api/shopping", params={"list_id": spawned["list"]["id"]}).json()
        assert any(x["name"] == f"{TAG}_fav" for x in payload["items"])

        client.delete(f"{BASE_URL}/api/shopping/recurring/{rl['id']}")
        client.delete(f"{BASE_URL}/api/shopping/lists/{spawned['list']['id']}")
        client.delete(f"{BASE_URL}/api/groceries/{g['id']}")


# --- Recipes cook ---
@pytest.fixture(scope="module", autouse=True)
def _remove_cooked_meals(client):
    # Cooking logs a meal ("<recipe> (1 serving)"); remove the ones these tests create so runs leave no trace.
    yield
    for m in client.get(f"{BASE_URL}/api/meals").json():
        if m["description"].startswith(TAG):
            client.delete(f"{BASE_URL}/api/meals/{m['id']}")


class TestRecipes:
    def test_cook_decrements_inventory(self, client):
        ingname = f"{TAG}_flour"
        g = client.post(f"{BASE_URL}/api/groceries",
                        json={"name": ingname, "quantity": 10, "unit": "cup"}).json()
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
        # Incompatible units are never guessed: stock counted in "unit" is left alone and flagged
        other = client.post(f"{BASE_URL}/api/groceries", json={"name": f"{TAG}_butter", "quantity": 4, "unit": "unit"}).json()
        r2 = client.post(f"{BASE_URL}/api/recipes", json={"name": f"{TAG}_cake2", "servings": 1,
                         "ingredients": [{"name": f"{TAG}_butter", "quantity": 100, "unit": "g"}]}).json()
        c2 = client.post(f"{BASE_URL}/api/recipes/{r2['id']}/cook").json()
        assert any("units differ" in ch for ch in c2["inventory_changes"])
        assert next(x for x in client.get(f"{BASE_URL}/api/groceries").json() if x["id"] == other["id"])["quantity"] == 4
        client.delete(f"{BASE_URL}/api/recipes/{r2['id']}")
        client.delete(f"{BASE_URL}/api/groceries/{other['id']}")
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
    def test_ai_records_income(self, client):
        # Ask the AI to record income for today
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        resp = client.post(f"{BASE_URL}/api/ai/chat",
                           json={"message": f"Record income of 50.25 euros into Revolut today with description {TAG}_ai_income"}, timeout=90)
        if resp.status_code != 200:
            pytest.skip(f"AI unavailable: {resp.status_code}")
        data = resp.json()
        # Verify a matching income transaction exists and appears in today's list
        txns = client.get(f"{BASE_URL}/api/transactions?start={today}&end={today}").json()
        match = [t for t in txns if t["type"] == "income" and t.get("description", "").startswith(f"{TAG}_ai_income")]
        assert len(match) >= 1, f"AI income not found in transactions: {data}"
        assert float(match[0]["gross_amount"]) == 50.25
        # Cleanup
        for t in match:
            client.delete(f"{BASE_URL}/api/transactions/{t['id']}")

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


# --- Product catalog CRUD ---
class TestProductsCRUD:
    def test_product_lifecycle(self, client):
        name = f"{TAG}_product_tomato"
        r = client.post(f"{BASE_URL}/api/products", json={
            "name": name, "category": "Produce", "default_unit": "kg",
            "typical_quantity": 1.0, "synonyms": ["tomatoe"],
            "nutrition": {"calories_per_100g": 18}, "is_favorite": True,
        })
        assert r.status_code == 200
        p = r.json()
        assert p["name"] == name
        assert p["category"] == "Produce"
        assert p["is_favorite"] is True

        # Search finds it
        search = client.get(f"{BASE_URL}/api/products/search", params={"q": name.split('_')[-1]}).json()
        assert any(x["id"] == p["id"] for x in search)

        # Update
        r2 = client.put(f"{BASE_URL}/api/products/{p['id']}", json={"category": "Vegetables", "is_favorite": False})
        assert r2.status_code == 200
        assert r2.json()["category"] == "Vegetables"
        assert r2.json()["is_favorite"] is False

        # Delete
        assert client.delete(f"{BASE_URL}/api/products/{p['id']}").status_code == 200


# --- Storage locations CRUD ---
class TestStorageLocationsCRUD:
    def test_storage_location_lifecycle(self, client):
        name = f"{TAG}_cellar"
        r = client.post(f"{BASE_URL}/api/storage-locations", json={
            "name": name, "kind": "custom", "icon": "box", "sort_order": 5})
        assert r.status_code == 200
        s = r.json()
        assert s["name"] == name
        assert s["kind"] == "custom"

        # List includes it
        lst = client.get(f"{BASE_URL}/api/storage-locations").json()
        assert any(x["id"] == s["id"] for x in lst)

        # Update
        r2 = client.put(f"{BASE_URL}/api/storage-locations/{s['id']}", json={"sort_order": 10})
        assert r2.status_code == 200
        assert r2.json()["sort_order"] == 10

        # Delete
        assert client.delete(f"{BASE_URL}/api/storage-locations/{s['id']}").status_code == 200


# --- Grocery inventory movement and expiry ---
class TestGroceryInventoryOps:
    def test_move_inventory_between_storage(self, client):
        # Ensure locations exist
        locs = {l["name"]: l for l in client.get(f"{BASE_URL}/api/storage-locations").json()}
        for name, kind in [("Fridge", "fridge"), ("Pantry", "pantry")]:
            if name not in locs:
                client.post(f"{BASE_URL}/api/storage-locations", json={"name": name, "kind": kind})

        g = client.post(f"{BASE_URL}/api/groceries", json={
            "name": f"{TAG}_moveitem", "quantity": 2, "storage_location": "Pantry"}).json()
        assert g["storage_location"] == "Pantry"

        r = client.post(f"{BASE_URL}/api/groceries/{g['id']}/move", json={"storage_location": "Fridge"})
        assert r.status_code == 200
        assert r.json()["storage_location"] == "Fridge"

        client.delete(f"{BASE_URL}/api/groceries/{g['id']}")

    def test_consume_and_discard(self, client):
        g = client.post(f"{BASE_URL}/api/groceries", json={
            "name": f"{TAG}_consumeitem", "quantity": 5}).json()

        # Consume 2
        r1 = client.post(f"{BASE_URL}/api/groceries/{g['id']}/consume", json={"quantity": 2})
        assert r1.status_code == 200
        assert r1.json()["quantity"] == 3

        # Discard remaining
        r2 = client.post(f"{BASE_URL}/api/groceries/{g['id']}/discard", json={})
        assert r2.status_code == 200
        assert r2.json()["deleted"] is True

    def test_expiring_endpoint(self, client):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        future = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d")
        g = client.post(f"{BASE_URL}/api/groceries", json={
            "name": f"{TAG}_expiringitem", "quantity": 1, "expiration": future}).json()

        exp = client.get(f"{BASE_URL}/api/groceries/expiring", params={"days": 7}).json()
        assert any(x["id"] == g["id"] for x in exp)

        # Not in 1-day window
        exp_short = client.get(f"{BASE_URL}/api/groceries/expiring", params={"days": 1}).json()
        assert not any(x["id"] == g["id"] for x in exp_short)

        client.delete(f"{BASE_URL}/api/groceries/{g['id']}")


# --- Storage references stay consistent across UI / REST / AI writes ---
class TestStorageReferences:
    def test_storage_kind_is_canonicalised_to_space_name(self, client):
        locs = client.get(f"{BASE_URL}/api/storage-locations").json()
        fridge = next((l for l in locs if l["kind"] == "fridge"), None)
        if not fridge:
            fridge = client.post(f"{BASE_URL}/api/storage-locations", json={"name": f"{TAG}_fr", "kind": "fridge"}).json()
        g = client.post(f"{BASE_URL}/api/groceries", json={
            "name": f"{TAG}_canon", "quantity": 1, "storage_location": "FRIDGE"}).json()
        assert g["storage_location"] == fridge["name"]
        client.delete(f"{BASE_URL}/api/groceries/{g['id']}")

    def test_rename_storage_location_moves_its_items_with_it(self, client):
        loc = client.post(f"{BASE_URL}/api/storage-locations", json={"name": f"{TAG}_old", "kind": "custom"}).json()
        g = client.post(f"{BASE_URL}/api/groceries", json={
            "name": f"{TAG}_renamed_item", "quantity": 1, "storage_location": f"{TAG}_old"}).json()
        r = client.put(f"{BASE_URL}/api/storage-locations/{loc['id']}", json={"name": f"{TAG}_new"})
        assert r.status_code == 200
        items = {i["id"]: i for i in client.get(f"{BASE_URL}/api/groceries").json()}
        assert items[g["id"]]["storage_location"] == f"{TAG}_new"
        client.delete(f"{BASE_URL}/api/groceries/{g['id']}")
        client.delete(f"{BASE_URL}/api/storage-locations/{loc['id']}")


class TestListBudget:
    def test_budget_can_be_zero_and_cleared(self, client):
        lst = client.post(f"{BASE_URL}/api/shopping/lists", json={"name": f"{TAG}_budget"}).json()
        url = f"{BASE_URL}/api/shopping/lists/{lst['id']}"
        summary = lambda: client.get(f"{BASE_URL}/api/shopping", params={"list_id": lst["id"]}).json()["budget_summary"]

        assert client.put(url, json={"budget": 25.5}).json()["budget"] == 25.5
        assert summary()["budget"] == 25.5

        # Zero is a real value, not "unset"
        assert client.put(url, json={"budget": 0}).json()["budget"] == 0
        assert summary()["budget"] == 0.0

        # An explicit null clears it back to "no budget"
        assert client.put(url, json={"budget": None}).json()["budget"] is None
        s = summary()
        assert s["budget"] is None and s["remaining"] is None

        # Omitting budget leaves it untouched
        client.put(url, json={"budget": 12})
        client.put(url, json={"name": f"{TAG}_budget2"})
        assert summary()["budget"] == 12.0
        client.delete(url)


class TestRecipeSuggestions:
    def test_suggestions_missing_list_and_unit_aware_cook(self, client):
        flour = client.post(f"{BASE_URL}/api/groceries", json={"name": f"{TAG}_flour", "quantity": 1, "unit": "kg"}).json()
        rec = client.post(f"{BASE_URL}/api/recipes", json={
            "name": f"{TAG}_bread", "servings": 2,
            "ingredients": [{"name": f"{TAG}_flour", "quantity": 400, "unit": "g"},
                            {"name": f"{TAG}_yeast", "quantity": 2, "unit": "pack"}]}).json()

        ranked = client.get(f"{BASE_URL}/api/recipes/suggestions").json()
        mine = next(e for e in ranked if e["recipe"]["id"] == rec["id"])
        assert mine["can_cook_now"] is False
        assert mine["missing"] == [{"name": f"{TAG}_yeast", "quantity": 2.0, "unit": "pack"}]
        flour_row = next(i for i in mine["ingredients"] if i["name"] == f"{TAG}_flour")
        assert flour_row["status"] == "ok"  # 400 g is covered by 1 kg

        # Missing ingredients go on a list with edited quantities; inventory is untouched
        r = client.post(f"{BASE_URL}/api/recipes/{rec['id']}/add-missing",
                        json={"items": [{"name": f"{TAG}_yeast", "quantity": 3, "unit": "pack"}]})
        assert r.status_code == 200 and r.json()["count"] == 1
        names = {g["name"] for g in client.get(f"{BASE_URL}/api/groceries").json()}
        assert f"{TAG}_yeast" not in names
        listed = [i for i in client.get(f"{BASE_URL}/api/shopping").json()["items"] if i["name"] == f"{TAG}_yeast"]
        assert listed and float(listed[0]["quantity"]) == 3
        assert client.post(f"{BASE_URL}/api/recipes/{rec['id']}/add-missing", json={"list_id": "nope"}).status_code == 404

        # Cooking subtracts 400 g from a stock held in kg
        cook = client.post(f"{BASE_URL}/api/recipes/{rec['id']}/cook").json()
        now = next(g for g in client.get(f"{BASE_URL}/api/groceries").json() if g["id"] == flour["id"])
        assert abs(float(now["quantity"]) - 0.6) < 0.001, cook

        for i in listed:
            client.delete(f"{BASE_URL}/api/shopping/{i['id']}")
        client.delete(f"{BASE_URL}/api/recipes/{rec['id']}")
        client.delete(f"{BASE_URL}/api/groceries/{flour['id']}")


class TestRecipeEdit:
    def test_update_recipe_replaces_ingredients_and_totals(self, client):
        r = client.post(f"{BASE_URL}/api/recipes", json={"name": f"{TAG}_edit", "servings": 1,
                        "ingredients": [{"name": f"{TAG}_a", "quantity": 1, "unit": "kg"}]}).json()
        up = client.put(f"{BASE_URL}/api/recipes/{r['id']}", json={
            "name": f"{TAG}_edit2", "servings": 4, "calories": 800,
            "ingredients": [{"name": f"{TAG}_b", "quantity": 2, "unit": "can"}, {"name": f"{TAG}_c", "quantity": 3, "unit": "unit"}]})
        assert up.status_code == 200, up.text
        body = up.json()
        assert body["name"] == f"{TAG}_edit2" and body["servings"] == 4 and body["calories"] == 800
        assert [i["name"] for i in body["ingredients"]] == [f"{TAG}_b", f"{TAG}_c"]
        client.delete(f"{BASE_URL}/api/recipes/{r['id']}")
