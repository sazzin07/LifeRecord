"""Seed a realistic household kitchen for the owner account.

Logs in as the owner (tiagosa743@gmail.com / LifeRecord) and creates storage spaces, appliances, a product
catalog, an everyday inventory, a few recipes and a weekly shopping list. Every date is relative to today,
so the kitchen always looks lived-in: a couple of items are about to expire, one was forgotten past its
date, and a few staples are running low.

    python seed_groceries.py            # add whatever is missing, refresh existing inventory
    python seed_groceries.py --reset    # first wipe inventory, catalog and shopping lists, then seed

Recipes, appliances and storage spaces are never deleted; they are only added when missing.
"""
import os
import sys
import uuid
from datetime import date, timedelta

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
EMAIL = "tiagosa743@gmail.com"
PASSWORD = "LifeRecord"

TODAY = date.today()


def days(offset):
    return (TODAY + timedelta(days=offset)).isoformat() if offset is not None else None


def login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def api(token, method, path, **kwargs):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    r = requests.request(method, f"{BASE_URL}{path}", headers=headers, timeout=30, **kwargs)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Storage spaces and appliances
# ---------------------------------------------------------------------------
STORAGE = [
    {"name": "Fridge", "kind": "fridge", "icon": "snowflake", "sort_order": 0},
    {"name": "Freezer", "kind": "freezer", "icon": "icicles", "sort_order": 1},
    {"name": "Pantry", "kind": "pantry", "icon": "archive", "sort_order": 2},
    {"name": "Spice rack", "kind": "custom", "icon": "archive", "sort_order": 3},
]

APPLIANCES = [
    ("Oven", "oven", "Built-in electric oven, 60 cm"),
    ("Induction hob", "hob", "4 zones"),
    ("Microwave", "microwave", "Reheating and defrosting"),
    ("Air Fryer", "air_fryer", "5 L basket"),
    ("Blender", "blender", "Smoothies, soups and sauces"),
    ("Kettle", "kettle", "1.7 L"),
    ("Coffee machine", "coffee_machine", "Ground coffee, filter"),
    ("Toaster", "toaster", "2 slots"),
]

# ---------------------------------------------------------------------------
# Inventory: (name, quantity, unit, category, location, expires in N days, price per unit €, low at, store)
# Categories follow the app's category list. Prices are per listed unit (per kg, per L, per can...).
# ---------------------------------------------------------------------------
INVENTORY = [
    # Fridge
    ("Milk", 1.5, "L", "Dairy", "Fridge", 6, 0.89, 1, "Lidl"),
    ("Eggs", 8, "unit", "Eggs", "Fridge", 18, 0.32, 4, "Lidl"),
    ("Butter", 1, "pack", "Dairy", "Fridge", 40, 2.15, 1, "Lidl"),
    ("Natural yogurt", 3, "unit", "Dairy", "Fridge", 9, 0.49, 2, "Lidl"),
    ("Mozzarella", 1, "pack", "Dairy", "Fridge", 5, 0.89, 0, "Lidl"),
    ("Parmesan", 1, "pack", "Dairy", "Fridge", 45, 3.49, 0, "Pingo Doce"),
    ("Sliced cheese", 1, "pack", "Dairy", "Fridge", 13, 2.19, 0, "Pingo Doce"),
    ("Chicken breast", 0.65, "kg", "Meat", "Fridge", 1, 6.99, 0, "Continente"),
    ("Minced beef", 0.5, "kg", "Meat", "Fridge", 2, 9.49, 0, "Continente"),
    ("Sliced ham", 1, "pack", "Meat", "Fridge", 4, 1.79, 0, "Lidl"),
    ("Carrots", 0.8, "kg", "Vegetables", "Fridge", 12, 1.19, 0.3, "Lidl"),
    ("Spinach", 1, "bag", "Vegetables", "Fridge", 2, 1.49, 0, "Lidl"),
    ("Tomatoes", 0.6, "kg", "Vegetables", "Fridge", 5, 2.49, 0.3, "Lidl"),
    ("Lettuce", 1, "unit", "Vegetables", "Fridge", 4, 0.99, 1, "Lidl"),
    ("Bell peppers", 3, "unit", "Vegetables", "Fridge", 8, 0.65, 0, "Lidl"),
    ("Lemons", 3, "unit", "Fruit", "Fridge", 14, 0.30, 0, "Lidl"),
    ("Apples", 6, "unit", "Fruit", "Fridge", 15, 0.32, 2, "Lidl"),
    ("Strawberries", 0.5, "kg", "Fruit", "Fridge", 2, 4.99, 0, "Continente"),
    ("Orange juice", 1, "L", "Drinks", "Fridge", 6, 1.65, 0, "Lidl"),
    ("Hummus", 1, "unit", "Pantry", "Fridge", -1, 1.79, 0, "Pingo Doce"),
    ("Mayonnaise", 1, "jar", "Pantry", "Fridge", 90, 2.29, 0, "Lidl"),
    ("Dijon mustard", 1, "jar", "Pantry", "Fridge", 200, 1.69, 0, "Lidl"),
    # Freezer
    ("Frozen peas", 1, "bag", "Frozen", "Freezer", 240, 1.39, 0, "Lidl"),
    ("Frozen mixed vegetables", 1, "bag", "Frozen", "Freezer", 300, 1.79, 0, "Lidl"),
    ("Frozen berries", 1, "bag", "Frozen", "Freezer", 200, 3.49, 0, "Lidl"),
    ("Hake fillets", 0.6, "kg", "Fish", "Freezer", 120, 11.90, 0, "Continente"),
    ("Salmon fillets", 0.5, "kg", "Fish", "Freezer", 90, 17.90, 0, "Continente"),
    ("Chicken thighs", 1, "kg", "Meat", "Freezer", 150, 4.99, 0, "Continente"),
    ("Frozen pizza", 2, "unit", "Frozen", "Freezer", 180, 2.99, 1, "Lidl"),
    ("Ice cream", 1, "unit", "Frozen", "Freezer", 220, 3.99, 0, "Lidl"),
    ("Bread rolls", 6, "unit", "Carbohydrates", "Freezer", 60, 0.22, 0, "Pingo Doce"),
    # Pantry
    ("Spaghetti", 1, "kg", "Carbohydrates", "Pantry", 420, 1.89, 0.5, "Lidl"),
    ("Penne", 0.5, "kg", "Carbohydrates", "Pantry", 400, 1.79, 0.5, "Lidl"),
    ("White rice", 1.5, "kg", "Carbohydrates", "Pantry", 500, 1.59, 0.5, "Lidl"),
    ("Oats", 0.5, "kg", "Carbohydrates", "Pantry", 250, 2.39, 0.2, "Lidl"),
    ("Bread", 1, "unit", "Carbohydrates", "Pantry", 3, 1.29, 0, "Pingo Doce"),
    ("Plain flour", 1, "kg", "Carbohydrates", "Pantry", 200, 0.95, 0.5, "Lidl"),
    ("Cereal", 1, "box", "Carbohydrates", "Pantry", 90, 2.89, 0, "Continente"),
    ("Sugar", 1, "kg", "Pantry", "Pantry", 600, 1.19, 0.3, "Lidl"),
    ("Olive oil", 0.75, "L", "Pantry", "Pantry", 400, 7.49, 0.25, "Continente"),
    ("Chopped tomatoes", 4, "can", "Pantry", "Pantry", 500, 0.69, 2, "Lidl"),
    ("Chickpeas", 2, "can", "Pantry", "Pantry", 600, 0.79, 1, "Lidl"),
    ("Canned tuna", 4, "can", "Fish", "Pantry", 700, 1.29, 2, "Lidl"),
    ("Honey", 1, "jar", "Pantry", "Pantry", 500, 3.99, 0, "Continente"),
    ("Peanut butter", 1, "jar", "Pantry", "Pantry", 240, 2.99, 0, "Lidl"),
    ("Ground coffee", 1, "pack", "Drinks", "Pantry", 150, 4.49, 1, "Continente"),
    ("Tea bags", 1, "box", "Drinks", "Pantry", 400, 1.99, 0, "Lidl"),
    ("Dark chocolate", 2, "unit", "Snacks", "Pantry", 150, 1.49, 0, "Lidl"),
    ("Almonds", 1, "bag", "Snacks", "Pantry", 120, 3.29, 0, "Lidl"),
    ("Potatoes", 2, "kg", "Vegetables", "Pantry", 20, 0.99, 0.5, "Lidl"),
    ("Sweet potatoes", 1, "kg", "Vegetables", "Pantry", 14, 1.79, 0, "Lidl"),
    ("Onions", 1.5, "kg", "Vegetables", "Pantry", 25, 1.09, 0.5, "Lidl"),
    ("Garlic", 2, "unit", "Vegetables", "Pantry", 30, 0.45, 1, "Lidl"),
    ("Bananas", 3, "unit", "Fruit", "Pantry", 2, 0.25, 2, "Lidl"),
    # Spice rack
    ("Salt", 1, "pack", "Pantry", "Spice rack", 900, 0.65, 0, "Lidl"),
    ("Black pepper", 1, "jar", "Pantry", "Spice rack", 500, 2.19, 0, "Lidl"),
    ("Paprika", 1, "jar", "Pantry", "Spice rack", 450, 1.89, 0, "Lidl"),
    ("Cumin", 1, "jar", "Pantry", "Spice rack", 450, 1.89, 0, "Lidl"),
    ("Dried oregano", 1, "jar", "Pantry", "Spice rack", 400, 1.59, 0, "Lidl"),
    ("Cinnamon", 1, "jar", "Pantry", "Spice rack", 500, 1.79, 0, "Lidl"),
    ("Chili flakes", 1, "jar", "Pantry", "Spice rack", 450, 1.79, 0, "Lidl"),
    ("Bay leaves", 1, "jar", "Pantry", "Spice rack", 500, 1.49, 0, "Lidl"),
]

# (name, quantity, unit, category, estimated price per unit, store)
SHOPPING_LIST = [
    ("Bananas", 6, "unit", "Fruit", 0.25, "Lidl"),
    ("Spinach", 2, "bag", "Vegetables", 1.49, "Lidl"),
    ("Cucumber", 2, "unit", "Vegetables", 0.69, "Lidl"),
    ("Mushrooms", 0.25, "kg", "Vegetables", 5.99, "Lidl"),
    ("Butter", 2, "pack", "Dairy", 2.15, "Lidl"),
    ("Cream cheese", 1, "pack", "Dairy", 1.39, "Lidl"),
    ("Ground coffee", 1, "pack", "Drinks", 4.49, "Continente"),
    ("Soy sauce", 1, "bottle", "Pantry", 2.29, "Lidl"),
    ("Lettuce", 2, "unit", "Vegetables", 0.99, "Lidl"),
]
SHOPPING_BUDGET = 45

# (name, servings, [(ingredient, quantity, unit)], kcal, protein, carbs, fat PER SERVING, notes).
# The app stores recipe nutrition as whole-recipe totals, so seed_recipes multiplies by servings.
RECIPES = [
    ("Spaghetti Bolognese", 4,
     [("Spaghetti", 0.4, "kg"), ("Minced beef", 0.5, "kg"), ("Chopped tomatoes", 2, "can"), ("Onions", 0.2, "kg"),
      ("Garlic", 2, "unit"), ("Olive oil", 0.03, "L")],
     640, 35, 78, 20, "Simmer the sauce for 30 minutes; finish with parmesan."),
    ("Chicken and vegetable stir-fry", 2,
     [("Chicken breast", 0.5, "kg"), ("Bell peppers", 2, "unit"), ("Carrots", 0.2, "kg"), ("White rice", 0.2, "kg"),
      ("Soy sauce", 1, "bottle")],
     560, 48, 58, 12, "High heat, small batches."),
    ("Tuna and chickpea salad", 2,
     [("Canned tuna", 2, "can"), ("Chickpeas", 1, "can"), ("Tomatoes", 0.3, "kg"), ("Lettuce", 1, "unit"),
      ("Lemons", 1, "unit"), ("Olive oil", 0.02, "L")],
     430, 38, 32, 16, "No cooking needed; keeps well for lunch the next day."),
    ("Spinach omelette", 1,
     [("Eggs", 3, "unit"), ("Spinach", 1, "bag"), ("Mozzarella", 1, "pack"), ("Butter", 0.1, "pack")],
     380, 28, 4, 28, "Quick dinner that uses up spinach before it turns."),
    ("Overnight oats", 1,
     [("Oats", 0.08, "kg"), ("Milk", 0.2, "L"), ("Natural yogurt", 1, "unit"), ("Honey", 0.1, "jar"),
      ("Strawberries", 0.1, "kg")],
     390, 16, 60, 9, "Prepare the night before."),
]

# Extra catalog entries that are not in stock right now but are everyday purchases.
EXTRA_PRODUCTS = [
    ("Cucumber", "Vegetables", "unit", 1), ("Mushrooms", "Vegetables", "kg", 0.25), ("Broccoli", "Vegetables", "unit", 1),
    ("Courgette", "Vegetables", "kg", 0.5), ("Cauliflower", "Vegetables", "unit", 1), ("Green beans", "Vegetables", "kg", 0.4),
    ("Oranges", "Fruit", "kg", 1), ("Pears", "Fruit", "kg", 1), ("Grapes", "Fruit", "kg", 0.5), ("Avocado", "Fruit", "unit", 2),
    ("Blueberries", "Fruit", "kg", 0.125), ("Cream cheese", "Dairy", "pack", 1), ("Cream", "Dairy", "unit", 1),
    ("Greek yogurt", "Dairy", "unit", 4), ("Cottage cheese", "Dairy", "unit", 1),
    ("Pork chops", "Meat", "kg", 0.5), ("Turkey slices", "Meat", "pack", 1), ("Chorizo", "Meat", "unit", 1),
    ("Cod fillets", "Fish", "kg", 0.5), ("Sardines (canned)", "Fish", "can", 2), ("Prawns", "Fish", "kg", 0.4),
    ("Wholemeal bread", "Carbohydrates", "unit", 1), ("Tortilla wraps", "Carbohydrates", "pack", 1),
    ("Couscous", "Carbohydrates", "kg", 0.5), ("Brown rice", "Carbohydrates", "kg", 1), ("Lentils", "Pantry", "kg", 0.5),
    ("Soy sauce", "Pantry", "bottle", 1), ("Vinegar", "Pantry", "bottle", 1), ("Ketchup", "Pantry", "bottle", 1),
    ("Tomato paste", "Pantry", "can", 1), ("Vegetable stock cubes", "Pantry", "box", 1), ("Baking powder", "Pantry", "pack", 1),
    ("Sparkling water", "Drinks", "bottle", 6), ("Still water", "Drinks", "bottle", 6), ("Red wine", "Drinks", "bottle", 1),
    ("Beer", "Drinks", "bottle", 6), ("Crisps", "Snacks", "bag", 1), ("Biscuits", "Snacks", "pack", 1),
    ("Frozen fish fingers", "Frozen", "pack", 1), ("Frozen spinach", "Frozen", "bag", 1),
]

# Nutrition per 100 g for the staples where the figure is well known.
NUTRITION = {
    "Eggs": {"calories_per_100g": 143, "protein": 12.6, "carbs": 0.7, "fat": 9.5},
    "Milk": {"calories_per_100g": 46, "protein": 3.4, "carbs": 4.8, "fat": 1.6},
    "Butter": {"calories_per_100g": 717, "protein": 0.9, "carbs": 0.1, "fat": 81},
    "Natural yogurt": {"calories_per_100g": 61, "protein": 3.5, "carbs": 4.7, "fat": 3.3},
    "Mozzarella": {"calories_per_100g": 254, "protein": 18, "carbs": 2.2, "fat": 19},
    "Chicken breast": {"calories_per_100g": 165, "protein": 31, "carbs": 0, "fat": 3.6},
    "Minced beef": {"calories_per_100g": 250, "protein": 26, "carbs": 0, "fat": 15},
    "Carrots": {"calories_per_100g": 41, "protein": 0.9, "carbs": 10, "fat": 0.2},
    "Spinach": {"calories_per_100g": 23, "protein": 2.9, "carbs": 3.6, "fat": 0.4},
    "Tomatoes": {"calories_per_100g": 18, "protein": 0.9, "carbs": 3.9, "fat": 0.2},
    "Potatoes": {"calories_per_100g": 77, "protein": 2, "carbs": 17, "fat": 0.1},
    "Onions": {"calories_per_100g": 40, "protein": 1.1, "carbs": 9, "fat": 0.1},
    "Bananas": {"calories_per_100g": 89, "protein": 1.1, "carbs": 23, "fat": 0.3},
    "Apples": {"calories_per_100g": 52, "protein": 0.3, "carbs": 14, "fat": 0.2},
    "Strawberries": {"calories_per_100g": 32, "protein": 0.7, "carbs": 7.7, "fat": 0.3},
    "Spaghetti": {"calories_per_100g": 158, "protein": 5.8, "carbs": 31, "fat": 0.9},
    "White rice": {"calories_per_100g": 130, "protein": 2.7, "carbs": 28, "fat": 0.3},
    "Oats": {"calories_per_100g": 389, "protein": 17, "carbs": 66, "fat": 7},
    "Canned tuna": {"calories_per_100g": 116, "protein": 26, "carbs": 0, "fat": 1},
    "Chickpeas": {"calories_per_100g": 139, "protein": 7, "carbs": 23, "fat": 2.1},
    "Olive oil": {"calories_per_100g": 884, "protein": 0, "carbs": 0, "fat": 100},
    "Salmon fillets": {"calories_per_100g": 208, "protein": 20, "carbs": 0, "fat": 13},
    "Hake fillets": {"calories_per_100g": 90, "protein": 18, "carbs": 0, "fat": 1.5},
    "Honey": {"calories_per_100g": 304, "protein": 0.3, "carbs": 82, "fat": 0},
    "Peanut butter": {"calories_per_100g": 588, "protein": 25, "carbs": 20, "fat": 50},
    "Almonds": {"calories_per_100g": 579, "protein": 21, "carbs": 22, "fat": 50},
}

# Fixed-shelf-life items worth marking as favourites / staples so suggestions work.
FAVORITES = {"Milk", "Eggs", "Butter", "Natural yogurt", "Bread", "Bananas", "Ground coffee", "Olive oil"}


def reset(token):
    for g in api(token, "GET", "/api/groceries"):
        api(token, "DELETE", f"/api/groceries/{g['id']}")
    for p in api(token, "GET", "/api/products"):
        api(token, "DELETE", f"/api/products/{p['id']}")
    for lst in api(token, "GET", "/api/shopping/lists"):
        api(token, "DELETE", f"/api/shopping/lists/{lst['id']}")
    for rec in api(token, "GET", "/api/shopping/recurring"):
        api(token, "DELETE", f"/api/shopping/recurring/{rec['id']}")
    print("Reset inventory, catalog, shopping lists and recurring templates.")


def seed_storage(token):
    existing = {s["name"].lower() for s in api(token, "GET", "/api/storage-locations")}
    made = [api(token, "POST", "/api/storage-locations", json=s) for s in STORAGE if s["name"].lower() not in existing]
    return len(made)


def seed_appliances(token):
    existing = {a["name"].lower() for a in api(token, "GET", "/api/appliances")}
    made = 0
    for name, kind, notes in APPLIANCES:
        if name.lower() in existing:
            continue
        api(token, "POST", "/api/appliances", json={"name": name, "kind": kind, "notes": notes})
        made += 1
    return made


def seed_products(token):
    existing = {p["name"].lower() for p in api(token, "GET", "/api/products")}
    rows = [(name, category, unit, 1) for name, _qty, unit, category, *_ in INVENTORY]
    rows += EXTRA_PRODUCTS
    created = 0
    for name, category, unit, qty in rows:
        if name.lower() in existing:
            continue
        existing.add(name.lower())
        api(token, "POST", "/api/products", json={
            "name": name, "category": category, "default_unit": unit, "typical_quantity": qty,
            "synonyms": [], "nutrition": NUTRITION.get(name), "is_favorite": name in FAVORITES,
        })
        created += 1
    # The full starter catalog (several hundred products with subcategories, diet tags and icons).
    imported = api(token, "POST", "/api/products/import-library")
    return created + imported["added"]


def seed_inventory(token):
    existing = {g["name"].lower(): g for g in api(token, "GET", "/api/groceries")}
    created = 0
    for name, qty, unit, category, location, exp, price, low, store in INVENTORY:
        payload = {
            "name": name, "quantity": qty, "unit": unit, "category": category, "storage_location": location,
            "expiration": days(exp), "price": price, "store": store, "low_threshold": low,
            "is_favorite": name in FAVORITES,
        }
        if name.lower() in existing:
            api(token, "PUT", f"/api/groceries/{existing[name.lower()]['id']}", json=payload)
        else:
            api(token, "POST", "/api/groceries", json=payload)
            created += 1
    return created


def seed_recipes(token):
    existing = {r["name"].lower(): r for r in api(token, "GET", "/api/recipes")}
    created = 0
    for name, servings, ings, kcal, protein, carbs, fat, notes in RECIPES:
        payload = {
            "name": name, "servings": servings, "notes": notes,
            "ingredients": [{"name": n, "quantity": q, "unit": u} for n, q, u in ings],
            "calories": kcal * servings, "protein": protein * servings, "carbs": carbs * servings, "fat": fat * servings,
        }
        if name.lower() in existing:
            api(token, "PUT", f"/api/recipes/{existing[name.lower()]['id']}", json=payload)
        else:
            api(token, "POST", "/api/recipes", json=payload)
            created += 1
    return created


def seed_shopping_list(token):
    lists = api(token, "GET", "/api/shopping/lists")
    lst = next((x for x in lists if x["name"] == "Weekly shop"), None)
    if not lst:
        lst = api(token, "POST", "/api/shopping/lists", json={"name": "Weekly shop"})
    api(token, "PUT", f"/api/shopping/lists/{lst['id']}", json={"budget": SHOPPING_BUDGET})
    have = {i["name"].lower() for i in api(token, "GET", "/api/shopping", params={"list_id": lst["id"]}).get("items", [])}
    created = 0
    for name, qty, unit, category, price, store in SHOPPING_LIST:
        if name.lower() in have:
            continue
        api(token, "POST", "/api/shopping", json={
            "name": name, "quantity": qty, "unit": unit, "category": category,
            "estimated_price": price, "store": store, "list_id": lst["id"],
        })
        created += 1
    return created


def main():
    print(f"Seeding a realistic kitchen on {BASE_URL} (dates relative to {TODAY})...")
    token = login()
    if "--reset" in sys.argv:
        reset(token)
    print(f"Storage spaces added: {seed_storage(token)}")
    print(f"Appliances added: {seed_appliances(token)}")
    print(f"Catalog products added: {seed_products(token)}")
    print(f"Inventory items added: {seed_inventory(token)} (existing ones refreshed)")
    print(f"Recipes added: {seed_recipes(token)}")
    print(f"Shopping list items added: {seed_shopping_list(token)}")
    print("Done.")


if __name__ == "__main__":
    main()
