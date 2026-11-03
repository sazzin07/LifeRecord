"""Realistic, clearly fictional sample data for the standard testing account (default: John, a39791@aesancho.pt).

    SEED_PASSWORD=... python seed_john.py            # seed (does nothing if the sample marker already exists)
    SEED_PASSWORD=... python seed_john.py --reset    # wipe that account's data (cleanup_account.py), then seed again

- Everything goes through the running backend's own REST API, as that user, so balances, splits, inventory and
  budgets are computed by the application itself. The few things the API cannot create without a paid AI call
  (saved AI chats) are inserted directly and marked.
- The password is read from SEED_PASSWORD or TEST_PASSWORD in the environment (or the encrypted secrets store). It is
  never written anywhere. Only a local backend (127.0.0.1 / localhost) is accepted.
- No email is sent and no AI model is called. Sample records are marked "[SAMPLE]" where a text field allows.
- Dates are relative to today, so the data always looks current. Names, places and amounts are invented; nothing here
  is a real transaction.
- Idempotent: the task "[SAMPLE DATA] ..." is the marker; seeding is skipped when it exists.
"""
import os
import struct
import subprocess
import sys
import uuid
import zlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import local_secrets  # noqa: E402

local_secrets.load_into_environ()

EMAIL = os.environ.get("SEED_EMAIL") or os.environ.get("TEST_EMAIL") or "a39791@aesancho.pt"
BASE = os.environ.get("SEED_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
MARKER = "[SAMPLE DATA] Demo dataset loaded. Safe to delete this task."
S = "[SAMPLE]"
TODAY = date.today()


def d(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).isoformat()


def ahead(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


class Api:
    def __init__(self, token: str):
        self.h = {"Authorization": f"Bearer {token}"}

    def call(self, method: str, path: str, ok=(200, 201), **kw):
        r = requests.request(method, f"{BASE}/api{path}", headers=self.h, timeout=60, **kw)
        if r.status_code not in ok:
            raise SystemExit(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
        return r.json() if r.content else None

    get = lambda self, p, **k: self.call("GET", p, **k)
    post = lambda self, p, body=None, **k: self.call("POST", p, json=body, **k)
    put = lambda self, p, body=None, **k: self.call("PUT", p, json=body, **k)


def login() -> Api:
    host = urlparse(BASE).hostname
    if host not in ("127.0.0.1", "localhost"):
        raise SystemExit(f"Refusing to seed {BASE}: only a local backend is accepted.")
    password = os.environ.get("SEED_PASSWORD") or os.environ.get("TEST_PASSWORD")
    if not password:
        raise SystemExit("Set SEED_PASSWORD (or TEST_PASSWORD) in the environment. It is not stored anywhere.")
    r = requests.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": password}, timeout=30)
    if r.status_code != 200 or not r.json().get("token"):
        raise SystemExit(f"Login as {EMAIL} failed ({r.status_code}). Nothing was changed.")
    return Api(r.json()["token"])


# ---------------------------------------------------------------------------
def seed_money(api: Api) -> dict:
    cats = [  # name, icon, colour, monthly budget (None = no budget; 0 = a deliberate zero budget)
        ("Groceries", "shopping-cart", "#10B981", 360), ("Eating Out", "utensils", "#F59E0B", 120),
        ("Transport", "bus", "#6366F1", 80), ("Shopping", "shopping-bag", "#EC4899", 150),
        ("Entertainment", "clapperboard", "#8B5CF6", 60), ("Health", "heart-pulse", "#EF4444", 50),
        ("Bills", "receipt", "#64748B", 420), ("Subscriptions", "repeat", "#F97316", 45),
        ("Travel", "plane", "#14B8A6", 0), ("Gifts", "gift", "#F43F5E", None), ("Income", "banknote", "#059669", None),
        ("People", "users", "#0EA5E9", None), ("Other", "circle", "#94A3B8", None),
    ]
    # A verified account already starts with the starter categories: reuse same-named ones and drop the rest, so the
    # sample data is the same whether or not the account was created before the starter set existed.
    existing = {c["name"]: c["id"] for c in api.get("/categories")}
    wanted = {name for name, *_ in cats}
    for name, cid in existing.items():
        if name not in wanted:
            api.call("DELETE", f"/categories/{cid}")
    for name, icon, color, budget in cats:
        body = {"name": name, "icon": icon, "color": color, "monthly_budget": budget}
        if name in existing:
            api.put(f"/categories/{existing[name]}", body)
        else:
            api.post("/categories", body)

    def acct(**kw):
        return api.post("/accounts", kw)["id"]

    # The places hold money of their own that is not in the main account: new money, so the totals are the sum.
    cash = acct(name="Money in hand", type="cash", opening_balance=0)
    acct(name="Wallet", type="cash_place", parent_id=cash, opening_balance=85, add_as_new_money=True)
    jar = acct(name="Kitchen jar", type="cash_place", parent_id=cash, opening_balance=140, add_as_new_money=True)
    api.post(f"/accounts/{jar}/favorite")   # his day-to-day cash: expenses "from cash" go here, not to the empty Default place
    acct(name="Travel envelope", type="cash_place", parent_id=cash, opening_balance=250, is_locked=True, add_as_new_money=True)
    rev = acct(name="Revolut", type="revolut", opening_balance=320)
    acct(name="Holiday pot", type="revolut_space", parent_id=rev, opening_balance=400, is_locked=True, add_as_new_money=True)
    bank = acct(name="Main bank", type="bank", opening_balance=2450)

    people = [("Marta Silva", "Revolut"), ("Liam O'Connor", "Bank transfer"), ("Aiko Tanaka", "Cash"),
              ("Carlos Mendes", "Revolut"), ("Sofia Rossi", ""), ("Noah Fischer", "")]
    for name, pref in people:
        api.post("/people", {"name": name, "notes": f"{S} flatmate/friend used in sample data", "payment_preference": pref})
    api.post("/people", {"name": "Hannah Weber", "notes": f"{S} archived contact (edge case)", "archived": True})

    # income
    api.post("/transactions/income", {"account": "Main bank", "amount": 1850, "description": f"Salary {S}", "date": d(58)})
    api.post("/transactions/income", {"account": "Main bank", "amount": 1850, "description": f"Salary {S}", "date": d(28)})
    api.post("/transactions/income", {"account": "Main bank", "amount": 240, "description": f"Freelance design job {S}", "date": d(19)})
    api.post("/transactions/income", {"account": "Revolut", "amount": 35.90, "description": f"Online order refund {S}", "date": d(9)})

    def exp(amount, desc, cat, account, days, merchant="", **kw):
        return api.post("/transactions/expense", {"amount": amount, "description": desc, "category": cat, "account": account,
                                                  "date": d(days), "merchant": merchant or desc, "notes": S, **kw})

    # moving money between places first: an account cannot be spent below zero, whatever the date of the spending
    accounts = {a["name"]: a["id"] for a in api.get("/accounts")}
    api.post("/accounts/transfer", {"from_account_id": accounts["Main bank"], "to_account_id": accounts["Revolut"], "amount": 200, "date": d(30), "note": f"{S} top up"})
    api.post("/accounts/transfer", {"from_account_id": accounts["Revolut"], "to_account_id": accounts["Wallet"], "amount": 50, "date": d(8), "note": f"{S} cash withdrawal"})

    # everyday spending across accounts and categories
    exp(62.40, "Weekly groceries", "Groceries", "Main bank", 52, "Lidl")
    exp(48.15, "Weekly groceries", "Groceries", "Main bank", 45, "Continente")
    exp(71.80, "Weekly groceries", "Groceries", "Revolut", 38, "Mercadona")
    exp(55.60, "Weekly groceries", "Groceries", "Main bank", 31, "Lidl")
    exp(66.25, "Weekly groceries", "Groceries", "Main bank", 24, "Continente")
    exp(38.90, "Weekly groceries", "Groceries", "Wallet", 17, "Local market")
    exp(59.70, "Weekly groceries", "Groceries", "Main bank", 10, "Lidl")
    exp(12.80, "Lunch", "Eating Out", "Wallet", 50, "Café Ünal")
    exp(24.50, "Dinner with friends", "Eating Out", "Revolut", 43, "Trattoria Roma")
    exp(9.60, "Coffee and pastry", "Eating Out", "Wallet", 36, "Pastelaria Central")
    exp(31.20, "Sushi", "Eating Out", "Revolut", 22, "Sakura House")
    exp(0.99, "App store item", "Entertainment", "Revolut", 33, "App Store")  # tiny amount
    exp(14.00, "Cinema", "Entertainment", "Revolut", 26, "Cinema City")
    exp(18.40, "Metro monthly top-up", "Transport", "Main bank", 55, "Metro")
    exp(18.40, "Metro monthly top-up", "Transport", "Main bank", 25, "Metro")
    exp(27.30, "Train ticket", "Transport", "Revolut", 14, "CP Comboios")
    exp(89.99, "Running shoes", "Shopping", "Revolut", 29, "SportZone")  # large single purchase
    exp(12.50, "Pharmacy", "Health", "Wallet", 21, "Farmácia Lisboa")
    exp(96.40, "Electricity bill", "Bills", "Main bank", 40, "EDP")
    exp(96.40, "Electricity bill", "Bills", "Main bank", 10, "EDP")
    exp(34.90, "Internet", "Bills", "Main bank", 35, "Vodafone")
    exp(11.99, "Music streaming", "Subscriptions", "Revolut", 41, "Spotify")
    exp(11.99, "Music streaming", "Subscriptions", "Revolut", 11, "Spotify")
    exp(8.99, "Cloud storage", "Subscriptions", "Revolut", 12, "iCloud")
    exp(45.00, "Birthday gift for Marta", "Gifts", "Wallet", 16, "Bookshop Livraria")
    exp(180.00, "Weekend train and hostel deposit", "Travel", "Holiday pot", 20, "Hostel Lisbon")  # from a locked pot

    # shared expenses (the other participants owe John their share)
    exp(60.00, "Dinner at Casa Lima", "Eating Out", "Revolut", 18, "Casa Lima", participants=["Me", "Marta Silva", "Liam O'Connor"])
    exp(45.00, "Cinema + snacks", "Entertainment", "Revolut", 13, "Cinema City", participants=["Me", "Aiko Tanaka"])
    exp(None, "Supermarket run (itemised)", "Groceries", "Main bank", 7, "Continente", split_mode="items", participants=["Me", "Carlos Mendes"],
        items=[{"name": "Shared pasta night", "price": 14.50, "assigned": ["Me", "Carlos Mendes"]},
               {"name": "Carlos's snacks", "price": 6.20, "assigned": ["Carlos Mendes"]},
               {"name": "My yoghurt", "price": 3.40, "assigned": ["Me"]}])
    exp(80.00, "Concert tickets", "Entertainment", "Revolut", 5, "Ticket Hub", split_mode="exact", participants=["Me", "Sofia Rossi"],
        exact_shares={"Me": 35.00, "Sofia Rossi": 45.00})
    # people paying back, in and out
    api.post("/settlements", {"person": "Marta Silva", "amount": 20.00, "method": "Revolut", "account": "Revolut", "direction": "in", "date": d(15)})
    api.post("/settlements", {"person": "Liam O'Connor", "amount": 8.00, "method": "Cash", "account": "Wallet", "direction": "out", "date": d(12)})
    return accounts


def seed_life(api: Api):
    # tasks: normal, urgent, overdue, undated, repeating, done
    for t in [
        {"title": "Renew gym membership", "priority": "high", "due": ahead(3)},
        {"title": "Pay electricity bill", "priority": "high", "due": ahead(5), "recurring": "monthly"},
        {"title": "Water the plants", "priority": "low", "due": ahead(1), "recurring": "weekly"},
        {"title": "Return library books", "priority": "normal", "due": d(4)},  # overdue
        {"title": "Book dentist appointment", "priority": "normal"},  # no due date
        {"title": "Plan the autumn city trip", "priority": "low", "due": ahead(21)},
        {"title": "Submit tax declaration", "priority": "high", "due": d(12), "done": True},
        {"title": "Morning stretch", "priority": "low", "due": ahead(0), "recurring": "daily"},
    ]:
        api.post("/tasks", t)
    # body: weekly weigh-ins trending down, with a note or two
    weights = [82.4, 82.1, 82.3, 81.7, 81.5, 81.2, 81.4, 80.9, 80.6, 80.4, 80.3, 80.1]
    for i, w in enumerate(weights):
        api.post("/weight", {"weight": w, "date": d(77 - i * 7), "note": f"{S} fasted, morning" if i % 4 == 0 else ""})
    # fitness
    def ex(name, sets, **kw):
        return {"name": name, "sets": [{"reps": r, "weight": wt} for r, wt in sets], **kw}
    sessions = [
        ("Push", 40, [ex("Bench press", [(8, 60), (8, 60), (6, 62.5)]), ex("Overhead press", [(10, 35), (8, 37.5)])]),
        ("Pull", 37, [ex("Pull-ups", [(8, 0), (6, 0), (5, 0)]), ex("Barbell row", [(10, 50), (10, 50)])]),
        ("Legs", 34, [ex("Squat", [(5, 80), (5, 80), (5, 82.5)]), ex("Romanian deadlift", [(8, 70), (8, 70)])]),
        ("Push", 27, [ex("Bench press", [(8, 62.5), (8, 62.5), (6, 65)]), ex("Plank", [], is_isometric=True, duration=90)]),
        ("Pull", 20, [ex("Pull-ups", [(9, 0), (7, 0), (6, 0)]), ex("Face pulls", [(15, 20), (15, 20)])]),
        ("Legs", 13, [ex("Squat", [(5, 85), (5, 85), (4, 85)]), ex("Calf raises", [(15, 40), (15, 40)])]),
    ]
    for kind, ago, exercises in sessions:
        api.post("/workouts", {"type": kind, "date": d(ago), "exercises": exercises, "notes": S})
    # nutrition. Nothing is logged for today: today starts empty, like a real morning (and the suggestion specs rely on it:
    # a seed that already reaches today's protein target leaves them nothing to suggest on the day it was seeded).
    meals = [
        (1, "Oatmeal with banana and honey", 420, 14, 72, 8), (1, "Chicken, rice and broccoli", 640, 48, 70, 16),
        (1, "Greek yoghurt with almonds", 210, 18, 9, 11), (2, "Scrambled eggs on toast", 480, 26, 38, 24),
        (2, "Pasta with tomato sauce", 720, 24, 118, 14), (2, "Apple and peanut butter", 250, 7, 28, 14),
        (3, "Tuna salad bowl", 520, 38, 30, 26),
    ]
    for ago, desc, kcal, p, c, f in meals:
        api.post("/meals", {"description": f"{desc} {S}", "calories": kcal, "protein": p, "carbs": c, "fat": f, "date": d(ago)})
    recipes = [
        ("Tomato spaghetti", 2, [("Spaghetti", 200, "g"), ("Tomato passata", 400, "g"), ("Garlic", 2, "unit"), ("Olive oil", 20, "ml")], 610, 20, 104, 12),
        ("Chicken and rice bowl", 2, [("Chicken breast", 300, "g"), ("Basmati rice", 150, "g"), ("Broccoli", 1, "unit"), ("Olive oil", 15, "ml")], 640, 48, 70, 16),
        ("Overnight oats", 1, [("Oats", 60, "g"), ("Milk", 200, "ml"), ("Bananas", 1, "unit")], 420, 14, 72, 8),
        ("Veggie omelette", 1, [("Eggs", 3, "unit"), ("Spinach", 50, "g"), ("Butter", 10, "g")], 380, 24, 4, 29),
    ]
    for name, serv, ings, kcal, p, c, f in recipes:
        api.post("/recipes", {"name": name, "servings": serv, "calories": kcal, "protein": p, "carbs": c, "fat": f, "notes": S,
                              "ingredients": [{"name": n, "quantity": q, "unit": u} for n, q, u in ings]})


def seed_kitchen(api: Api, accounts: dict):
    for i, (name, kind) in enumerate([("Fridge", "fridge"), ("Freezer", "freezer"), ("Pantry", "pantry"), ("Spice rack", "custom")]):
        api.post("/storage-locations", {"name": name, "kind": kind, "sort_order": i})
    for name, kind in [("Oven", "oven"), ("Air fryer", "air_fryer"), ("Blender", "blender"), ("Rice cooker", "other"), ("Coffee machine", "other")]:
        api.post("/appliances", {"name": name, "kind": kind, "notes": S})
    # Prices are per unit of the stated unit (kg, L, jar...), so weighed items use kg/L.
    inv = [  # name, qty, unit, category, place, price, store, low, expiry offset (days) or None, favourite
        ("Whole milk", 1, "L", "Dairy", "Fridge", 1.15, "Lidl", 1, -1, True),          # expired yesterday
        ("Greek yoghurt", 4, "unit", "Dairy", "Fridge", 0.89, "Lidl", 2, 2, True),     # expiring soon
        ("Eggs", 2, "unit", "Eggs", "Fridge", 0.32, "Continente", 6, 9, False),        # low stock
        ("Butter", 0, "kg", "Dairy", "Fridge", 9.96, "Continente", 0.1, 40, False),    # out of stock
        ("Spinach", 0.15, "kg", "Vegetables", "Fridge", 7.99, "Mercadona", 0.1, 0, False),  # expires today
        ("Chicken breast", 0.6, "kg", "Meat", "Freezer", 8.90, "Continente", 0.3, 60, False),
        ("Frozen peas", 1, "kg", "Frozen", "Freezer", 2.10, "Lidl", 1, 200, False),
        ("Spaghetti", 0.75, "kg", "Carbohydrates", "Pantry", 1.73, "Lidl", 0.5, 300, False),
        ("Basmati rice", 1.5, "kg", "Carbohydrates", "Pantry", 2.13, "Mercadona", 1, 400, False),
        ("Tomato passata", 0.7, "kg", "Pantry", "Pantry", 1.50, "Lidl", 0.4, 220, False),
        ("Olive oil", 0.75, "L", "Pantry", "Pantry", 10.50, "Continente", 0.25, 500, True),
        ("Oats", 0.9, "kg", "Carbohydrates", "Pantry", 2.05, "Lidl", 0.3, 180, False),
        ("Plain flour", 5, "kg", "Pantry", "Pantry", 0.90, "Makro", 1, None, False),   # large quantity, no expiry
        ("Bananas", 5, "unit", "Fruit", "Pantry", 0.25, "Local market", 3, 4, False),
        ("Garlic", 6, "unit", "Vegetables", "Pantry", 0.20, "Local market", 2, 25, False),
        ("Broccoli", 1, "unit", "Vegetables", "Fridge", 1.40, "Mercadona", 1, 5, False),
        ("Jalapeño peppers (jar)", 1, "jar", "Pantry", "Pantry", 2.20, "Mercadona", 0, 150, False),  # non-ASCII name
        ("Smoked paprika", 1, "jar", "Pantry", "Spice rack", 2.60, "Local market", 0, 365, False),
        ("Ground cinnamon", 1, "jar", "Pantry", "Spice rack", 1.90, "Local market", 0, 400, False),
        ("Sparkling water", 6, "bottle", "Drinks", "Pantry", 0.45, "Lidl", 4, None, False),
        ("Dark chocolate 85%", 1, "unit", "Snacks", "Pantry", 1.99, "Lidl", 1, 120, True),
    ]
    for name, qty, unit, cat, place, price, store, low, exp, fav in inv:
        api.post("/groceries", {"name": name, "quantity": qty, "unit": unit, "category": cat, "storage_location": place, "price": price,
                                "store": store, "low_threshold": low, "expiration": ahead(exp) if exp is not None else None,
                                "is_favorite": fav, "notes": S})
    api.post("/products", {"name": "Grandma's chili oil (sample)", "category": "Pantry", "subcategory": "Sauces", "default_unit": "jar", "tags": ["vegan"], "icon": "🌶️"})
    api.post("/products", {"name": "Oat barista drink (sample)", "category": "Drinks", "subcategory": "Plant milk", "default_unit": "L", "tags": ["vegan", "lactose-free"], "icon": "🥛"})

    # shopping: a normal list that gets bought (updates inventory, price history and an expense), a zero-budget list,
    # a list with no budget, an archived list, and a recurring template
    weekly = api.post("/shopping/lists", {"name": "Weekly shop", "budget": 65})["id"]
    items = {}
    for name, qty, unit, cat, price, store in [("Whole milk", 2, "L", "Dairy", 1.15, "Lidl"), ("Eggs", 12, "unit", "Eggs", 0.32, "Lidl"),
                                               ("Butter", 0.25, "kg", "Dairy", 9.96, "Lidl"), ("Spinach", 0.3, "kg", "Vegetables", 7.99, "Lidl"),
                                               ("Coffee beans", 0.5, "kg", "Drinks", 17.80, "Continente"), ("Bananas", 6, "unit", "Fruit", 0.25, "Lidl")]:
        items[name] = api.post("/shopping", {"name": name, "quantity": qty, "unit": unit, "category": cat, "estimated_price": price, "store": store,
                                             "list_id": weekly, "note": S})["id"]
    for name in ("Whole milk", "Eggs", "Butter", "Spinach"):
        api.post(f"/shopping/{items[name]}/toggle")
    api.post(f"/shopping/lists/{weekly}/submit", {
        "items": [{"item_id": items[n], "actual_price": p, "store": "Lidl"} for n, p in
                  (("Whole milk", 1.19), ("Eggs", 0.34), ("Butter", 10.36), ("Spinach", 8.30))],
        "store": "Lidl", "record_expense": True, "payment_account": accounts["Revolut"]})
    party = api.post("/shopping/lists", {"name": "Housewarming party", "budget": 0})["id"]  # zero budget (edge case)
    for name, qty, unit, price in [("Sparkling water", 12, "bottle", 0.45), ("Tortilla chips", 4, "pack", 1.60), ("Guacamole", 3, "pack", 2.30)]:
        api.post("/shopping", {"name": name, "quantity": qty, "unit": unit, "estimated_price": price, "list_id": party, "note": S})
    api.post("/shopping/lists", {"name": "Someday ideas"})  # no budget, no items (empty state)
    old = api.post("/shopping/lists", {"name": "Last month's shop"})["id"]
    api.put(f"/shopping/lists/{old}", {"archived": True})
    api.post("/shopping/recurring", {"name": "Weekly basics", "schedule": "weekly", "items": [
        {"name": "Whole milk", "quantity": 2, "unit": "L", "category": "Dairy", "estimated_price": 1.15},
        {"name": "Eggs", "quantity": 12, "unit": "unit", "category": "Eggs", "estimated_price": 0.32},
        {"name": "Bananas", "quantity": 6, "unit": "unit", "category": "Fruit", "estimated_price": 0.25}]})


def _png(rgb) -> bytes:
    """A small valid PNG (a flat 64x64 colour) so progress photos exist without shipping any image file."""
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    row = b"\x00" + bytes(rgb) * 64
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(row * 64)) + chunk(b"IEND", b""))


def seed_photos(api: Api):
    """Three progress photos through the normal upload endpoint (stored encrypted, like a real one)."""
    for note, rgb in ((f"{S} Front view", (176, 124, 96)), (f"{S} Side view", (96, 140, 176)), (f"{S} Back view", (120, 168, 120))):
        r = requests.post(f"{BASE}/api/photos", params={"note": note}, headers=api.h, timeout=60,
                          files={"file": ("progress.png", _png(rgb), "image/png")})
        if r.status_code != 200:
            raise SystemExit(f"POST /photos -> {r.status_code}: {r.text[:300]}")


def seed_scheduled_and_marker(api: Api):
    opts = api.get("/scheduled/options")
    sources = [s["id"] if isinstance(s, dict) else s for s in opts.get("data_sources", [])][:2]
    api.post("/scheduled/tasks", {
        "title": f"{S} Monday spending summary", "instruction": "Summarise last week's spending by category and mention any category that is over budget.",
        "schedule": {"kind": "weekly", "time": "08:30", "weekdays": [0]}, "timezone": "Europe/Lisbon", "data_sources": sources, "recipients": []})
    api.post("/tasks", {"title": MARKER, "priority": "low"})


def seed_ai_history(user_id: str):
    """Saved chats and action history cannot be created without calling the AI model, so these are inserted directly (and marked)."""
    import cleanup_account  # reuse its administrative connection helper
    conn = cleanup_account.connect()
    now = datetime.now(timezone.utc)
    chats = [
        (f"{S} How much did I spend on groceries?", 3, [
            ("user", "How much did I spend on groceries this month?"),
            ("assistant", "You spent **€294.71** on groceries across 5 shops. That is 82% of your €360 budget, with 10 days left in the month."),
            ("user", "Which shop was cheapest?"),
            ("assistant", "Lidl: your average basket there is €59.20, against €66.25 at Continente.")]),
        (f"{S} Plan a high-protein dinner", 8, [
            ("user", "What can I cook with what I have that is high in protein?"),
            ("assistant", "You have chicken breast, rice and broccoli: the **Chicken and rice bowl** gives about 48 g of protein per serving. Spinach expires today, so add it.")]),
    ]
    try:
        with conn.cursor() as cur:
            for title, ago, msgs in chats:
                cid, t0 = str(uuid.uuid4()), now - timedelta(days=ago)
                cur.execute("INSERT INTO ai_conversations (id,user_id,title,title_source,archived,preview,message_count,created_at,updated_at) VALUES (%s,%s,%s,'user',0,%s,%s,%s,%s)",
                            (cid, user_id, title, msgs[-1][1][:300], len(msgs), t0.isoformat(), (t0 + timedelta(minutes=len(msgs))).isoformat()))
                for i, (role, text) in enumerate(msgs):
                    cur.execute("INSERT INTO ai_messages (id,user_id,session_id,role,text,meta,created_at) VALUES (%s,%s,%s,%s,%s,NULL,%s)",
                                (str(uuid.uuid4()), user_id, cid, role, text, (t0 + timedelta(minutes=i)).isoformat()))
            # What the assistant changed: history only. undoable stays 0 and `created` empty, so "undo" can never delete
            # a real record by way of a sample row.
            for label, ago in ((f"{S} Added expense: EUR 14.20 at Lidl", 2), (f"{S} Logged lunch: chicken and rice bowl", 5),
                               (f"{S} Created task: renew gym membership", 9)):
                cur.execute("INSERT INTO ai_actions (id,user_id,label,tools,created,undoable,undone,created_at) VALUES (%s,%s,%s,'[]','[]',0,0,%s)",
                            (str(uuid.uuid4()), user_id, label, (now - timedelta(days=ago)).isoformat()))
        conn.commit()
    finally:
        conn.close()


def main(argv) -> int:
    reset = "--reset" in argv
    api = login()
    me = api.get("/auth/me")
    print(f"Signed in as {me['email']} ({me['name']}).")
    if reset:
        print("--reset: removing this account's existing data first")
        r = subprocess.run([sys.executable, str(Path(__file__).parent / "cleanup_account.py"), me["email"], "--apply"])
        if r.returncode != 0:
            raise SystemExit("Cleanup failed; nothing was seeded.")
    elif any(t["title"] == MARKER for t in api.get("/tasks")):
        print("Sample data is already present (marker task found). Nothing to do. Use --reset to rebuild.")
        return 0
    elif api.get("/accounts") or api.get("/people") or api.get("/groceries"):
        raise SystemExit("This account already has data but no sample marker. Not touching it. Use --reset to wipe and rebuild.")
    accounts = seed_money(api)
    seed_life(api)
    seed_kitchen(api, accounts)
    seed_photos(api)
    seed_scheduled_and_marker(api)
    seed_ai_history(me["id"])
    summary = {"accounts": len(api.get("/accounts")), "categories": len(api.get("/categories")), "people": len(api.get("/people")),
               "transactions": len(api.get("/transactions")), "tasks": len(api.get("/tasks")), "weigh-ins": len(api.get("/weight")),
               "workouts": len(api.get("/workouts")), "meals": len(api.get("/meals")), "recipes": len(api.get("/recipes")),
               "inventory": len(api.get("/groceries")), "storage spaces": len(api.get("/storage-locations")),
               "appliances": len(api.get("/appliances")), "shopping lists": len(api.get("/shopping")["lists"]),
               "scheduled tasks": len(api.get("/scheduled/tasks")), "AI chats": len(api.get("/ai/conversations"))}
    print("Seeded:", ", ".join(f"{v} {k}" for k, v in summary.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
