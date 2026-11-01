"""Two years of plausible history for one account, for timing the heavy pages (roadmap D-07)."""
import random
import uuid
from datetime import date, datetime, timedelta, timezone


def seed(db, user_id: str, account_id: str, transactions: int = 3650) -> dict:
    """History through the ORM models, so every column gets the default the application itself would give it."""
    from models import Grocery, PriceRecord, Split, Transaction
    rng = random.Random(7)
    cats = ["Groceries", "Eating Out", "Transport", "Shopping", "Entertainment", "Health", "Bills", "Subscriptions", "Travel", "Other"]
    shops = ["Lidl", "Continente", "Mercadona", "Pingo Doce", "Uber", "Netflix", "Farmacia", "Padaria", "Cinema", "Ginasio"]
    today = date.today()
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for _ in range(transactions):
        d = today - timedelta(days=rng.randrange(730))
        amount = round(rng.uniform(2, 120), 2)
        tid = str(uuid.uuid4())
        rows.append(Transaction(id=tid, user_id=user_id, type="expense", gross_amount=amount, personal_amount=amount, reimbursable_amount=0,
                                description="history", category=rng.choice(cats), account=account_id, merchant=rng.choice(shops),
                                date=d.isoformat(), month=d.strftime("%Y-%m"), paid_by="me", items=[], created_at=now))
        rows.append(Split(id=str(uuid.uuid4()), transaction_id=tid, person_id="me", person_name="Me", amount=amount, is_me=True, created_at=now))
    for i in range(600):
        rows.append(Grocery(id=str(uuid.uuid4()), user_id=user_id, name=f"History item {i}", name_lower=f"history item {i}", quantity=rng.randrange(1, 9),
                            unit="unit", category=rng.choice(["Pantry", "Dairy", "Meat", "Fruit"]), created_at=now, updated_at=now))
    for i in range(4000):
        rows.append(PriceRecord(id=str(uuid.uuid4()), user_id=user_id, name=f"History item {i % 600}", name_lower=f"history item {i % 600}",
                                store=rng.choice(shops), price=round(rng.uniform(.5, 12), 2), unit="unit",
                                date=(today - timedelta(days=rng.randrange(730))).isoformat(), created_at=now))
    # parents first within each batch: a transaction is inserted before its split
    db.add_all(rows)
    db.commit()
    return {"transactions": transactions, "groceries": 600, "price_records": 4000}
