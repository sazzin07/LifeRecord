"""Unit tests for recipe/inventory matching (pure functions, no server needed)."""
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import kitchen_logic as k  # noqa: E402

TODAY = date(2026, 10, 22)


def item(name, qty, unit="unit", days=None, loc="Fridge", id=None):
    return {"id": id or name, "name": name, "quantity": qty, "unit": unit, "storage_location": loc,
            "expiration": (TODAY + timedelta(days=days)).isoformat() if days is not None else None}


def recipe(name, *ings):
    return {"id": name, "name": name, "ingredients": [{"name": n, "quantity": q, "unit": u} for n, q, u in ings]}


def test_convert_between_compatible_units_only():
    assert k.convert(400, "g", "kg") == 0.4
    assert k.convert(0.5, "L", "ml") == 500
    assert k.convert(2, "can", "can") == 2
    assert k.convert(1, "kg", "L") is None
    assert k.convert(1, "pack", "unit") is None


def test_enough_in_stock_across_units_is_ok():
    ev = k.evaluate_recipe(recipe("Pasta", ("Spaghetti", 400, "g")), [item("Spaghetti", 1, "kg")], TODAY)
    assert ev["can_cook_now"] and ev["coverage"] == 100 and ev["missing"] == []


def test_shortfall_is_the_difference_in_the_recipes_unit():
    ev = k.evaluate_recipe(recipe("Pasta", ("Spaghetti", 0.5, "kg")), [item("Spaghetti", 300, "g")], TODAY)
    row = ev["ingredients"][0]
    assert row["status"] == "short"
    assert row["shortfall"] == 0.2
    assert ev["missing"] == [{"name": "Spaghetti", "quantity": 0.2, "unit": "kg"}]
    assert not ev["can_cook_now"]


def test_missing_ingredient_needs_the_full_amount():
    ev = k.evaluate_recipe(recipe("Stir-fry", ("Soy sauce", 1, "bottle")), [], TODAY)
    assert ev["ingredients"][0]["status"] == "missing"
    assert ev["missing"] == [{"name": "Soy sauce", "quantity": 1.0, "unit": "bottle"}]


def test_zero_stock_counts_as_missing_even_if_the_row_exists():
    ev = k.evaluate_recipe(recipe("Omelette", ("Eggs", 3, "unit")), [item("Eggs", 0)], TODAY)
    assert ev["ingredients"][0]["status"] == "missing"


def test_incomparable_units_are_flagged_not_guessed():
    ev = k.evaluate_recipe(recipe("Salad", ("Tomatoes", 0.3, "kg")), [item("Tomatoes", 4, "unit")], TODAY)
    assert ev["ingredients"][0]["status"] == "check_units"
    assert ev["can_cook_now"]  # assumed enough, but surfaced to the user


def test_plural_and_qualified_names_match_but_unrelated_ones_do_not():
    inv = [item("Cherry tomatoes", 1, "kg"), item("Eggs", 6)]
    assert k.find_item("Egg", inv)["name"] == "Eggs"
    assert k.find_item("Tomatoes", inv)["name"] == "Cherry tomatoes"
    assert k.find_item("Tomato paste", inv) is None
    assert k.find_item("Rice", [item("Rice cakes", 1)]) is None


def test_expiring_ingredients_are_reported_and_rank_higher():
    inv = [item("Spinach", 1, "bag", days=2), item("Eggs", 6, days=20), item("Rice", 1, "kg", days=300, loc="Pantry")]
    uses_spinach = recipe("Spinach omelette", ("Eggs", 3, "unit"), ("Spinach", 1, "bag"))
    long_life = recipe("Egg rice", ("Eggs", 3, "unit"), ("Rice", 0.2, "kg"))
    ranked = k.suggest([long_life, uses_spinach], inv, TODAY)
    assert ranked[0]["recipe"]["name"] == "Spinach omelette"
    assert ranked[0]["uses_expiring"] == [{"name": "Spinach", "expires_in": 2}]
    assert ranked[1]["uses_expiring"] == []


def test_cookable_beats_almost_cookable_and_empty_recipes_are_skipped():
    inv = [item("Eggs", 6), item("Milk", 1, "L")]
    ready = recipe("Ready", ("Eggs", 2, "unit"))
    nearly = recipe("Nearly", ("Eggs", 2, "unit"), ("Flour", 0.2, "kg"))
    ranked = k.suggest([nearly, ready, {"id": "x", "name": "No ingredients", "ingredients": []}], inv, TODAY)
    assert [e["recipe"]["name"] for e in ranked] == ["Ready", "Nearly"]
