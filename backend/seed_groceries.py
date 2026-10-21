"""Seed groceries redesign data for the owner account.

Logs in as tiagosa743@gmail.com / LifeRecord, creates default storage locations,
appliances, product catalog, sample inventory and a shopping list. Safe to re-run:
it skips existing entries by name.
"""
import os
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
EMAIL = "tiagosa743@gmail.com"
PASSWORD = "LifeRecord"


def new_id():
    return str(uuid.uuid4())


def login():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


def api(token, method, path, **kwargs):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    r = requests.request(method, f"{BASE_URL}{path}", headers=headers, timeout=15, **kwargs)
    r.raise_for_status()
    return r.json()


def seed_storage_locations(token):
    existing = {s["name"]: s for s in api(token, "GET", "/api/storage-locations")}
    defaults = [
        {"name": "Fridge", "kind": "fridge", "icon": "snowflake", "sort_order": 0},
        {"name": "Pantry", "kind": "pantry", "icon": "archive", "sort_order": 1},
        {"name": "Freezer", "kind": "freezer", "icon": "icicles", "sort_order": 2},
    ]
    created = []
    for d in defaults:
        if d["name"] in existing:
            continue
        created.append(api(token, "POST", "/api/storage-locations", json=d))
    return created


def seed_appliances(token):
    existing = {a["name"]: a for a in api(token, "GET", "/api/appliances")}
    defaults = [
        {"name": "Oven", "kind": "oven", "icon": "fire", "notes": "Main kitchen oven"},
        {"name": "Microwave", "kind": "microwave", "icon": "wave-square", "notes": "Quick reheating"},
        {"name": "Air Fryer", "kind": "air_fryer", "icon": "wind", "notes": "Crispy with less oil"},
        {"name": "Blender", "kind": "blender", "icon": "blender", "notes": "Smoothies and sauces"},
    ]
    created = []
    for d in defaults:
        if d["name"] in existing:
            continue
        created.append(api(token, "POST", "/api/appliances", json=d))
    return created


PRODUCTS = [
    # Produce
    ("Apples", "Produce", "kg", 1.0, ["apple", "red apple", "green apple"],
     {"calories_per_100g": 52, "protein": 0.3, "carbs": 14, "fat": 0.2}),
    ("Bananas", "Produce", "kg", 1.0, ["banana", "plantain"],
     {"calories_per_100g": 89, "protein": 1.1, "carbs": 23, "fat": 0.3}),
    ("Oranges", "Produce", "kg", 1.0, ["orange", "navel orange"],
     {"calories_per_100g": 47, "protein": 0.9, "carbs": 12, "fat": 0.1}),
    ("Lemons", "Produce", "kg", 0.5, ["lemon"],
     {"calories_per_100g": 29, "protein": 1.1, "carbs": 9, "fat": 0.3}),
    ("Limes", "Produce", "kg", 0.25, ["lime"],
     {"calories_per_100g": 30, "protein": 0.7, "carbs": 10, "fat": 0.2}),
    ("Grapes", "Produce", "kg", 0.5, ["grape", "green grapes", "red grapes"],
     {"calories_per_100g": 69, "protein": 0.7, "carbs": 18, "fat": 0.2}),
    ("Strawberries", "Produce", "kg", 0.5, ["strawberry", "berries"],
     {"calories_per_100g": 32, "protein": 0.7, "carbs": 7.7, "fat": 0.3}),
    ("Blueberries", "Produce", "kg", 0.25, ["blueberry"],
     {"calories_per_100g": 57, "protein": 0.7, "carbs": 14, "fat": 0.3}),
    ("Raspberries", "Produce", "kg", 0.25, ["raspberry"],
     {"calories_per_100g": 53, "protein": 1.2, "carbs": 12, "fat": 0.7}),
    ("Avocado", "Produce", "unit", 1.0, ["avocado", "aguacate"],
     {"calories_per_100g": 160, "protein": 2, "carbs": 9, "fat": 15}),
    ("Tomatoes", "Produce", "kg", 1.0, ["tomato", "roma tomato", "cherry tomato"],
     {"calories_per_100g": 18, "protein": 0.9, "carbs": 3.9, "fat": 0.2}),
    ("Cherry Tomatoes", "Produce", "kg", 0.5, ["cherry tomato"],
     {"calories_per_100g": 18, "protein": 0.9, "carbs": 3.9, "fat": 0.2}),
    ("Cucumber", "Produce", "unit", 1.0, ["cucumber"],
     {"calories_per_100g": 15, "protein": 0.7, "carbs": 3.6, "fat": 0.1}),
    ("Lettuce", "Produce", "unit", 1.0, ["lettuce", "romaine", "iceberg"],
     {"calories_per_100g": 15, "protein": 1.4, "carbs": 2.9, "fat": 0.2}),
    ("Spinach", "Produce", "kg", 0.25, ["spinach"],
     {"calories_per_100g": 23, "protein": 2.9, "carbs": 3.6, "fat": 0.4}),
    ("Bell Peppers", "Produce", "kg", 0.5, ["pepper", "capsicum", "bell pepper"],
     {"calories_per_100g": 31, "protein": 1, "carbs": 6, "fat": 0.3}),
    ("Carrots", "Produce", "kg", 1.0, ["carrot"],
     {"calories_per_100g": 41, "protein": 0.9, "carbs": 10, "fat": 0.2}),
    ("Onions", "Produce", "kg", 1.0, ["onion", "yellow onion", "red onion"],
     {"calories_per_100g": 40, "protein": 1.1, "carbs": 9, "fat": 0.1}),
    ("Garlic", "Produce", "unit", 1.0, ["garlic"],
     {"calories_per_100g": 149, "protein": 6.4, "carbs": 33, "fat": 0.5}),
    ("Potatoes", "Produce", "kg", 1.0, ["potato"],
     {"calories_per_100g": 77, "protein": 2, "carbs": 17, "fat": 0.1}),
    ("Sweet Potatoes", "Produce", "kg", 1.0, ["sweet potato"],
     {"calories_per_100g": 86, "protein": 1.6, "carbs": 20, "fat": 0.1}),
    ("Broccoli", "Produce", "unit", 1.0, ["broccoli"],
     {"calories_per_100g": 34, "protein": 2.8, "carbs": 7, "fat": 0.4}),
    ("Cauliflower", "Produce", "unit", 1.0, ["cauliflower"],
     {"calories_per_100g": 25, "protein": 1.9, "carbs": 5, "fat": 0.3}),
    ("Zucchini", "Produce", "kg", 0.5, ["zucchini", "courgette"],
     {"calories_per_100g": 17, "protein": 1.2, "carbs": 3.1, "fat": 0.3}),
    ("Mushrooms", "Produce", "kg", 0.25, ["mushroom"],
     {"calories_per_100g": 22, "protein": 3.1, "carbs": 3.3, "fat": 0.3}),
    ("Ginger", "Produce", "unit", 1.0, ["ginger"],
     {"calories_per_100g": 80, "protein": 1.8, "carbs": 18, "fat": 0.8}),
    # Meat / Fish
    ("Chicken Breast", "Meat", "kg", 0.5, ["chicken", "chicken fillet"],
     {"calories_per_100g": 165, "protein": 31, "carbs": 0, "fat": 3.6}),
    ("Chicken Thighs", "Meat", "kg", 0.5, ["chicken thigh"],
     {"calories_per_100g": 177, "protein": 24, "carbs": 0, "fat": 8}),
    ("Ground Beef", "Meat", "kg", 0.5, ["minced beef", "beef mince"],
     {"calories_per_100g": 250, "protein": 26, "carbs": 0, "fat": 15}),
    ("Beef Steak", "Meat", "kg", 0.5, ["steak", "beef steak"],
     {"calories_per_100g": 271, "protein": 26, "carbs": 0, "fat": 19}),
    ("Pork Chops", "Meat", "kg", 0.5, ["pork chop"],
     {"calories_per_100g": 231, "protein": 24, "carbs": 0, "fat": 14}),
    ("Bacon", "Meat", "kg", 0.25, ["bacon"],
     {"calories_per_100g": 541, "protein": 37, "carbs": 1.4, "fat": 42}),
    ("Salmon Fillet", "Fish", "kg", 0.5, ["salmon"],
     {"calories_per_100g": 208, "protein": 20, "carbs": 0, "fat": 13}),
    ("Tuna Steak", "Fish", "kg", 0.25, ["tuna"],
     {"calories_per_100g": 132, "protein": 28, "carbs": 0, "fat": 1}),
    ("Cod Fillet", "Fish", "kg", 0.5, ["cod"],
     {"calories_per_100g": 82, "protein": 18, "carbs": 0, "fat": 0.7}),
    ("Shrimp", "Fish", "kg", 0.5, ["prawns", "shrimp"],
     {"calories_per_100g": 99, "protein": 24, "carbs": 0, "fat": 0.3}),
    ("Eggs", "Eggs", "unit", 6.0, ["egg"],
     {"calories_per_100g": 155, "protein": 13, "carbs": 1.1, "fat": 11}),
    ("Ham Slices", "Meat", "pack", 1.0, ["ham"],
     {"calories_per_100g": 145, "protein": 21, "carbs": 1.5, "fat": 6}),
    # Dairy
    ("Milk", "Dairy", "L", 1.0, ["whole milk", "semi-skimmed milk"],
     {"calories_per_100g": 65, "protein": 3.4, "carbs": 4.8, "fat": 3.6}),
    ("Greek Yogurt", "Dairy", "kg", 0.5, ["yogurt"],
     {"calories_per_100g": 97, "protein": 9, "carbs": 3.6, "fat": 5}),
    ("Butter", "Dairy", "g", 250.0, ["butter"],
     {"calories_per_100g": 717, "protein": 0.9, "carbs": 0.1, "fat": 81}),
    ("Cheddar Cheese", "Dairy", "g", 200.0, ["cheddar", "cheese"],
     {"calories_per_100g": 402, "protein": 25, "carbs": 1.3, "fat": 33}),
    ("Mozzarella", "Dairy", "g", 250.0, ["mozzarella"],
     {"calories_per_100g": 280, "protein": 28, "carbs": 2.2, "fat": 17}),
    ("Parmesan", "Dairy", "g", 100.0, ["parmesan"],
     {"calories_per_100g": 431, "protein": 38, "carbs": 4.1, "fat": 29}),
    ("Feta Cheese", "Dairy", "g", 200.0, ["feta"],
     {"calories_per_100g": 264, "protein": 14, "carbs": 4.1, "fat": 21}),
    ("Cream Cheese", "Dairy", "g", 200.0, ["cream cheese", "philadelphia"],
     {"calories_per_100g": 342, "protein": 5.9, "carbs": 4.1, "fat": 34}),
    ("Sour Cream", "Dairy", "g", 200.0, ["sour cream"],
     {"calories_per_100g": 193, "protein": 2.1, "carbs": 4.6, "fat": 19}),
    # Grains / Bakery
    ("White Rice", "Grains", "kg", 1.0, ["rice"],
     {"calories_per_100g": 130, "protein": 2.7, "carbs": 28, "fat": 0.3}),
    ("Brown Rice", "Grains", "kg", 1.0, ["brown rice"],
     {"calories_per_100g": 112, "protein": 2.6, "carbs": 24, "fat": 0.9}),
    ("Pasta", "Grains", "kg", 0.5, ["spaghetti", "macaroni", "penne"],
     {"calories_per_100g": 131, "protein": 5, "carbs": 25, "fat": 1.1}),
    ("Bread", "Bakery", "unit", 1.0, ["loaf", "bread loaf"],
     {"calories_per_100g": 265, "protein": 9, "carbs": 49, "fat": 3.2}),
    ("Baguette", "Bakery", "unit", 1.0, ["baguette"],
     {"calories_per_100g": 270, "protein": 8.5, "carbs": 52, "fat": 1.5}),
    ("Tortillas", "Bakery", "pack", 1.0, ["wrap", "tortilla"],
     {"calories_per_100g": 218, "protein": 6.5, "carbs": 36, "fat": 5.5}),
    ("Oats", "Grains", "kg", 0.5, ["oatmeal", "rolled oats"],
     {"calories_per_100g": 389, "protein": 16.9, "carbs": 66, "fat": 6.9}),
    ("Flour", "Baking", "kg", 1.0, ["all-purpose flour", "plain flour"],
     {"calories_per_100g": 364, "protein": 10, "carbs": 76, "fat": 1}),
    ("Quinoa", "Grains", "kg", 0.5, ["quinoa"],
     {"calories_per_100g": 120, "protein": 4.4, "carbs": 21, "fat": 1.9}),
    ("Couscous", "Grains", "kg", 0.5, ["couscous"],
     {"calories_per_100g": 112, "protein": 3.8, "carbs": 23, "fat": 0.2}),
    # Canned / Dry goods
    ("Chickpeas", "Canned", "can", 1.0, ["garbanzo beans"],
     {"calories_per_100g": 164, "protein": 8.9, "carbs": 27, "fat": 2.6}),
    ("Black Beans", "Canned", "can", 1.0, ["black beans"],
     {"calories_per_100g": 132, "protein": 8.9, "carbs": 24, "fat": 0.5}),
    ("Tomato Sauce", "Canned", "can", 1.0, ["tomato passata", "crushed tomatoes"],
     {"calories_per_100g": 32, "protein": 1.4, "carbs": 5.3, "fat": 0.3}),
    ("Coconut Milk", "Canned", "can", 1.0, ["coconut milk"],
     {"calories_per_100g": 230, "protein": 2.3, "carbs": 5.5, "fat": 24}),
    ("Tuna Can", "Canned", "can", 1.0, ["canned tuna"],
     {"calories_per_100g": 116, "protein": 26, "carbs": 0, "fat": 1}),
    ("Olive Oil", "Oils", "L", 1.0, ["olive oil", "extra virgin olive oil"],
     {"calories_per_100g": 884, "protein": 0, "carbs": 0, "fat": 100}),
    ("Vegetable Oil", "Oils", "L", 1.0, ["vegetable oil", "sunflower oil"],
     {"calories_per_100g": 884, "protein": 0, "carbs": 0, "fat": 100}),
    ("Honey", "Condiments", "g", 500.0, ["honey"],
     {"calories_per_100g": 304, "protein": 0.3, "carbs": 82, "fat": 0}),
    ("Peanut Butter", "Condiments", "g", 400.0, ["peanut butter"],
     {"calories_per_100g": 588, "protein": 25, "carbs": 20, "fat": 50}),
    ("Soy Sauce", "Condiments", "mL", 250.0, ["soy sauce"],
     {"calories_per_100g": 53, "protein": 8.1, "carbs": 5, "fat": 0}),
    ("Mustard", "Condiments", "g", 200.0, ["mustard", "dijon mustard"],
     {"calories_per_100g": 66, "protein": 4.3, "carbs": 6.4, "fat": 3.6}),
    ("Ketchup", "Condiments", "g", 500.0, ["ketchup"],
     {"calories_per_100g": 112, "protein": 1.3, "carbs": 26, "fat": 0.2}),
    ("Mayonnaise", "Condiments", "g", 250.0, ["mayo", "mayonnaise"],
     {"calories_per_100g": 680, "protein": 1, "carbs": 0.6, "fat": 75}),
    ("Vinegar", "Condiments", "mL", 500.0, ["white vinegar", "balsamic vinegar"],
     {"calories_per_100g": 18, "protein": 0, "carbs": 0.4, "fat": 0}),
    ("Salt", "Spices", "g", 500.0, ["salt", "sea salt"],
     {"calories_per_100g": 0, "protein": 0, "carbs": 0, "fat": 0}),
    ("Black Pepper", "Spices", "g", 50.0, ["pepper"],
     {"calories_per_100g": 255, "protein": 10, "carbs": 64, "fat": 3.3}),
    ("Paprika", "Spices", "g", 50.0, ["paprika"],
     {"calories_per_100g": 282, "protein": 14, "carbs": 54, "fat": 13}),
    ("Cinnamon", "Spices", "g", 30.0, ["cinnamon"],
     {"calories_per_100g": 247, "protein": 4, "carbs": 81, "fat": 1.2}),
    ("Oregano", "Spices", "g", 20.0, ["oregano"],
     {"calories_per_100g": 265, "protein": 9, "carbs": 69, "fat": 4.3}),
    ("Basil", "Spices", "g", 20.0, ["basil", "dried basil"],
     {"calories_per_100g": 251, "protein": 14, "carbs": 61, "fat": 4}),
    ("Cumin", "Spices", "g", 30.0, ["cumin"],
     {"calories_per_100g": 375, "protein": 18, "carbs": 44, "fat": 22}),
    # Snacks / Beverages
    ("Coffee Beans", "Beverages", "g", 500.0, ["coffee"],
     {"calories_per_100g": 0, "protein": 0, "carbs": 0, "fat": 0}),
    ("Green Tea", "Beverages", "box", 1.0, ["tea"],
     {"calories_per_100g": 1, "protein": 0, "carbs": 0.2, "fat": 0}),
    ("Orange Juice", "Beverages", "L", 1.0, ["orange juice", "juice"],
     {"calories_per_100g": 45, "protein": 0.7, "carbs": 10, "fat": 0.2}),
    ("Sparkling Water", "Beverages", "L", 1.5, ["soda water", "sparkling water"],
     {"calories_per_100g": 0, "protein": 0, "carbs": 0, "fat": 0}),
    ("Dark Chocolate", "Snacks", "g", 100.0, ["chocolate"],
     {"calories_per_100g": 546, "protein": 4.9, "carbs": 61, "fat": 31}),
    ("Almonds", "Snacks", "g", 200.0, ["almond"],
     {"calories_per_100g": 579, "protein": 21, "carbs": 22, "fat": 50}),
    ("Walnuts", "Snacks", "g", 200.0, ["walnut"],
     {"calories_per_100g": 654, "protein": 15, "carbs": 14, "fat": 65}),
    ("Chia Seeds", "Snacks", "g", 250.0, ["chia"],
     {"calories_per_100g": 486, "protein": 17, "carbs": 42, "fat": 31}),
    ("Granola", "Breakfast", "g", 500.0, ["granola", "muesli"],
     {"calories_per_100g": 471, "protein": 10, "carbs": 64, "fat": 20}),
    # Frozen
    ("Frozen Peas", "Frozen", "g", 400.0, ["peas"],
     {"calories_per_100g": 77, "protein": 5.4, "carbs": 14, "fat": 0.4}),
    ("Frozen Pizza", "Frozen", "unit", 1.0, ["pizza"],
     {"calories_per_100g": 266, "protein": 11, "carbs": 33, "fat": 10}),
    ("Frozen Berries", "Frozen", "g", 500.0, ["mixed berries"],
     {"calories_per_100g": 50, "protein": 0.7, "carbs": 12, "fat": 0.3}),
    ("Ice Cream", "Frozen", "L", 1.0, ["ice cream"],
     {"calories_per_100g": 207, "protein": 3.5, "carbs": 24, "fat": 11}),
    # Bakery / Breakfast extras
    ("Croissants", "Bakery", "unit", 4.0, ["croissant"],
     {"calories_per_100g": 406, "protein": 8.2, "carbs": 45, "fat": 21}),
    ("Breadcrumbs", "Baking", "g", 200.0, ["breadcrumbs"],
     {"calories_per_100g": 395, "protein": 13, "carbs": 72, "fat": 5.3}),
    ("Baking Powder", "Baking", "g", 100.0, ["baking powder"],
     {"calories_per_100g": 53, "protein": 0, "carbs": 27, "fat": 0}),
    ("Sugar", "Baking", "g", 500.0, ["white sugar", "caster sugar"],
     {"calories_per_100g": 387, "protein": 0, "carbs": 100, "fat": 0}),
    ("Brown Sugar", "Baking", "g", 500.0, ["brown sugar"],
     {"calories_per_100g": 380, "protein": 0, "carbs": 98, "fat": 0}),
    ("Vanilla Extract", "Baking", "mL", 50.0, ["vanilla"],
     {"calories_per_100g": 288, "protein": 0.1, "carbs": 12.7, "fat": 0.1}),
    ("Yeast", "Baking", "g", 10.0, ["dry yeast"],
     {"calories_per_100g": 325, "protein": 40, "carbs": 41, "fat": 7.6}),
    # Household
    ("Dish Soap", "Household", "unit", 1.0, [],
     {"calories_per_100g": 0, "protein": 0, "carbs": 0, "fat": 0}),
    ("Toilet Paper", "Household", "pack", 1.0, [],
     {"calories_per_100g": 0, "protein": 0, "carbs": 0, "fat": 0}),
    ("Laundry Detergent", "Household", "unit", 1.0, [],
     {"calories_per_100g": 0, "protein": 0, "carbs": 0, "fat": 0}),
]


INVENTORY = [
    # Fridge
    ("Milk", 1.5, "L", "Dairy", "Fridge", "2025-11-28", 1.5, 0.5),
    ("Eggs", 10, "unit", "Eggs", "Fridge", "2025-12-05", 12, 6),
    ("Butter", 250, "g", "Dairy", "Fridge", "2025-12-10", 500, 50),
    ("Greek Yogurt", 0.5, "kg", "Dairy", "Fridge", "2025-11-25", 1.5, 0.2),
    ("Cheddar Cheese", 200, "g", "Dairy", "Fridge", "2025-12-15", 400, 50),
    ("Chicken Breast", 0.6, "kg", "Meat", "Fridge", "2025-11-22", 1.0, 0.0),
    ("Bacon", 150, "g", "Meat", "Fridge", "2025-11-20", 250, 0.0),
    ("Carrots", 0.5, "kg", "Produce", "Fridge", "2025-12-01", 1.0, 0.2),
    ("Spinach", 0.2, "kg", "Produce", "Fridge", "2025-11-18", 0.5, 0.0),
    ("Tomatoes", 0.6, "kg", "Produce", "Fridge", "2025-11-24", 1.0, 0.2),
    ("Lettuce", 1, "unit", "Produce", "Fridge", "2025-11-19", 2, 1),
    ("Orange Juice", 1, "L", "Beverages", "Fridge", "2025-11-30", 2, 0.5),
    # Freezer
    ("Frozen Peas", 400, "g", "Frozen", "Freezer", "2026-05-01", 800, 0.0),
    ("Frozen Berries", 500, "g", "Frozen", "Freezer", "2026-06-01", 1000, 0.0),
    ("Salmon Fillet", 0.5, "kg", "Fish", "Freezer", "2026-02-15", 1.0, 0.0),
    ("Ground Beef", 0.4, "kg", "Meat", "Freezer", "2026-01-20", 1.0, 0.0),
    ("Frozen Pizza", 2, "unit", "Frozen", "Freezer", "2026-04-10", 3, 1),
    ("Ice Cream", 1, "L", "Frozen", "Freezer", "2026-03-15", 1, 0.0),
    # Pantry
    ("White Rice", 1, "kg", "Grains", "Pantry", "2026-12-01", 2, 0.5),
    ("Pasta", 0.5, "kg", "Grains", "Pantry", "2026-10-01", 1.5, 0.25),
    ("Bread", 1, "unit", "Bakery", "Pantry", "2025-11-16", 2, 1),
    ("Oats", 0.5, "kg", "Grains", "Pantry", "2026-08-01", 1.0, 0.2),
    ("Flour", 1, "kg", "Baking", "Pantry", "2026-09-01", 2, 0.5),
    ("Sugar", 0.5, "kg", "Baking", "Pantry", "2027-01-01", 1, 0.25),
    ("Olive Oil", 0.75, "L", "Oils", "Pantry", "2027-06-01", 1, 0.25),
    ("Tomato Sauce", 2, "can", "Canned", "Pantry", "2026-12-01", 4, 1),
    ("Chickpeas", 2, "can", "Canned", "Pantry", "2026-11-01", 4, 1),
    ("Tuna Can", 3, "can", "Canned", "Pantry", "2027-01-01", 5, 1),
    ("Honey", 250, "g", "Condiments", "Pantry", "2027-05-01", 500, 100),
    ("Peanut Butter", 200, "g", "Condiments", "Pantry", "2026-04-01", 400, 50),
    ("Coffee Beans", 250, "g", "Beverages", "Pantry", "2026-02-01", 500, 100),
    ("Almonds", 150, "g", "Snacks", "Pantry", "2026-03-01", 300, 50),
    ("Salt", 200, "g", "Spices", "Pantry", "2028-01-01", 500, 100),
    ("Black Pepper", 30, "g", "Spices", "Pantry", "2027-01-01", 50, 10),
    ("Garlic", 1, "unit", "Produce", "Pantry", "2026-01-01", 2, 0.5),
    ("Onions", 1, "kg", "Produce", "Pantry", "2026-01-15", 2, 0.5),
    ("Potatoes", 1.5, "kg", "Produce", "Pantry", "2025-12-15", 3, 1),
]


SHOPPING_LIST = [
    ("Bananas", 1.0, "kg", "Produce", 1.49),
    ("Avocado", 3, "unit", "Produce", 2.49),
    ("Broccoli", 1, "unit", "Produce", 1.69),
    ("Salmon Fillet", 0.5, "kg", "Fish", 7.99),
    ("Greek Yogurt", 0.5, "kg", "Dairy", 2.29),
    ("Mozzarella", 250, "g", "Dairy", 2.99),
    ("Pasta", 0.5, "kg", "Grains", 1.19),
    ("Olive Oil", 1, "L", "Oils", 6.49),
    ("Soy Sauce", 250, "mL", "Condiments", 2.79),
    ("Dark Chocolate", 100, "g", "Snacks", 1.99),
]


def seed_products(token):
    rows = api(token, "GET", "/api/products")
    existing = {p["name"].lower(): p for p in rows}
    # Clean up accidental duplicates if any (keep the first occurrence).
    seen = set()
    for p in rows:
        nl = p["name"].lower()
        if nl in seen:
            try:
                api(token, "DELETE", f"/api/products/{p['id']}")
            except requests.HTTPError:
                pass
        else:
            seen.add(nl)
    created = 0
    for name, category, unit, qty, synonyms, nutrition in PRODUCTS:
        if name.lower() in existing:
            continue
        api(token, "POST", "/api/products", json={
            "name": name,
            "category": category,
            "default_unit": unit,
            "typical_quantity": qty,
            "synonyms": synonyms,
            "nutrition": nutrition,
            "is_favorite": False,
        })
        created += 1
    return created


def seed_inventory(token):
    existing = {g["name"].lower(): g for g in api(token, "GET", "/api/groceries")}
    created = 0
    for name, qty, unit, category, location, expiration, price_per_unit, threshold in INVENTORY:
        price = round(price_per_unit * (qty / (1 if unit in ("unit", "can", "pack", "box") else 1)), 2)
        # Simple heuristic: price for weight/volume scaled to a typical pack.
        if unit in ("kg", "L"):
            price = round(price_per_unit * qty, 2)
        elif unit in ("g", "mL"):
            price = round(price_per_unit * (qty / 1000), 2)
        else:
            price = round(price_per_unit * qty, 2)

        if name.lower() in existing:
            g = existing[name.lower()]
            try:
                api(token, "PUT", f"/api/groceries/{g['id']}", json={
                    "quantity": qty,
                    "unit": unit,
                    "category": category,
                    "storage_location": location,
                    "expiration": expiration,
                    "price": price,
                    "low_threshold": threshold,
                })
                continue
            except requests.HTTPError as e:
                if e.response.status_code == 404:
                    pass  # fall through to create
                else:
                    raise
        api(token, "POST", "/api/groceries", json={
            "name": name,
            "quantity": qty,
            "unit": unit,
            "category": category,
            "storage_location": location,
            "expiration": expiration,
            "price": price,
            "low_threshold": threshold,
        })
        created += 1
    return created


def seed_shopping_list(token):
    lists = api(token, "GET", "/api/shopping/lists")
    existing = next((lst for lst in lists if lst["name"] == "Weekly shopping"), None)
    if existing:
        list_id = existing["id"]
    else:
        list_id = api(token, "POST", "/api/shopping/lists", json={"name": "Weekly shopping"})["id"]

    existing_items = {it["name"].lower(): it for it in api(token, "GET", "/api/shopping", params={"list_id": list_id}).get("items", [])}
    created = 0
    for name, qty, unit, category, price in SHOPPING_LIST:
        if name.lower() in existing_items:
            continue
        api(token, "POST", "/api/shopping", json={
            "name": name,
            "quantity": qty,
            "unit": unit,
            "category": category,
            "estimated_price": price,
            "list_id": list_id,
        })
        created += 1
    return list_id, created


def main():
    print(f"Seeding groceries data on {BASE_URL}...")
    token = login()
    print("Logged in as owner.")

    locs = seed_storage_locations(token)
    print(f"Created {len(locs)} storage locations.")

    apps = seed_appliances(token)
    print(f"Created {len(apps)} appliances.")

    products = seed_products(token)
    print(f"Created {products} products.")

    inventory = seed_inventory(token)
    print(f"Created/updated {inventory} inventory items.")

    list_id, items = seed_shopping_list(token)
    print(f"Created {items} shopping list items in list {list_id}.")

    print("Done.")


if __name__ == "__main__":
    main()
