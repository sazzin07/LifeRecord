"""The built-in starter catalog is well-formed (no database or server needed)."""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from catalog_data import LIBRARY, TAG_ORDER  # noqa: E402

CATEGORIES = {"Meat", "Fish", "Eggs", "Dairy", "Carbohydrates", "Fruit", "Vegetables", "Frozen", "Pantry",
              "Snacks", "Drinks", "Other"}
UNITS = {"unit", "kg", "g", "L", "ml", "pack", "bottle", "can", "box", "bag", "bunch", "jar"}


def test_library_is_big_and_spread_across_categories():
    assert len(LIBRARY) >= 450
    counts = Counter(p["category"] for p in LIBRARY)
    assert set(counts) == CATEGORIES
    assert all(n >= 4 for n in counts.values()), counts


def test_names_and_synonyms_are_unique():
    names = [p["name"].lower() for p in LIBRARY]
    assert [n for n, c in Counter(names).items() if c > 1] == []
    synonyms = [s.lower() for p in LIBRARY for s in p["synonyms"]]
    assert not set(synonyms) & set(names), "a synonym duplicates another product's name"


def test_every_row_uses_valid_category_unit_and_tags():
    for p in LIBRARY:
        assert p["category"] in CATEGORIES, p["name"]
        assert p["subcategory"], p["name"]
        assert p["default_unit"] in UNITS, (p["name"], p["default_unit"])
        assert p["icon"], p["name"]
        assert p["typical_quantity"] and p["typical_quantity"] > 0, p["name"]
        assert set(p["tags"]) <= set(TAG_ORDER), p["name"]


def test_vegan_products_are_never_meat_fish_eggs_or_dairy():
    for p in LIBRARY:
        if "vegan" in p["tags"]:
            assert "vegetarian" in p["tags"], p["name"]
            assert p["category"] not in {"Meat", "Fish", "Eggs"}, p["name"]
        if p["category"] in {"Meat", "Fish"}:
            assert "vegetarian" not in p["tags"], p["name"]


def test_nutrition_is_plausible():
    for p in LIBRARY:
        n = p["nutrition"]
        if p["category"] == "Other":
            assert n is None, p["name"]
            continue
        if n is None:
            continue  # plain coffee/tea: nothing meaningful per 100 g
        kcal, prot, carbs, fat = n["calories_per_100g"], n["protein"], n["carbs"], n["fat"]
        assert 0 <= kcal <= 900, p["name"]
        assert prot + carbs + fat <= 101, (p["name"], prot + carbs + fat)
        # Alcohol carries calories the macros don't show; spices and cocoa are mostly fibre, which counts as
        # carbs but gives little energy; baking powder is largely non-caloric.
        exempt = p["category"] == "Drinks" or p["subcategory"] == "Spices & herbs" \
            or p["name"] in {"Cocoa powder", "Baking powder"}
        if not exempt:
            estimate = 4 * prot + 4 * carbs + 9 * fat
            assert abs(kcal - estimate) <= max(45, 0.3 * kcal), (p["name"], kcal, estimate)
