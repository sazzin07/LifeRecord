"""The saved Groceries 'Today' layout (HTTP) and the assistant tools that reach everything else the Groceries page can change
(in-process, like test_profile_settings.py). Nothing here calls a model: the tools are dispatched directly."""
import asyncio
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from support_users import api, create_verified_user  # noqa: E402


def call(user, method, path, **kw):
    return requests.request(method, api(user, path), headers={"Authorization": f"Bearer {user['token']}"}, timeout=60, **kw)


class Chat:
    """One signed-in person talking to the assistant: each call is a new model turn in the same conversation."""

    def __init__(self, prefix="gro"):
        self.user = create_verified_user(prefix)
        self.who = {"_id": self.user["id"], "email": self.user["email"], "name": self.user["name"], "role": "user"}

    def one(self, name, args, previewed=None):
        async def go():
            async with AsyncSessionLocal() as db:
                return await server.dispatch_tool(db, name, args, [], self.who, "sess-gro", previewed if previewed is not None else set(),
                                                  {"request_id": "r-" + os.urandom(4).hex()})
        return asyncio.run(go())

    def sure(self, name, args):
        """Ask, hear the preview, then confirm on a later turn, the way the assistant has to."""
        first = self.one(name, args)
        assert first.get("needs_confirmation") is True, first
        return self.one(name, {**args, "confirm": True})


# -- the saved layout -------------------------------------------------------------------------------------------------------

def test_layout_starts_as_the_default_unsaved_and_saves_changes_one_field_at_a_time():
    u = create_verified_user("lay")
    first = call(u, "get", "/layouts/groceries").json()
    assert first["saved"] is False and first["layout"]["focus"] == "all" and len(first["layout"]["widgets"]) == 7
    r = call(u, "put", "/layouts/groceries", json={"widgets": [{"id": "list", "size": "l"}, {"id": "needs"}]})
    assert r.status_code == 200 and r.json()["saved"] is True
    assert r.json()["layout"]["widgets"] == [{"id": "list", "size": "l"}, {"id": "needs", "size": "m"}]
    r = call(u, "put", "/layouts/groceries", json={"focus": "fridge-id"})
    assert r.json()["layout"] == {"widgets": [{"id": "list", "size": "l"}, {"id": "needs", "size": "m"}], "focus": "fridge-id"}   # widgets kept
    assert call(u, "get", "/layouts/groceries").json()["layout"]["focus"] == "fridge-id"                                           # still there on the next visit
    reset = call(u, "delete", "/layouts/groceries").json()
    assert reset["saved"] is False and len(reset["layout"]["widgets"]) == 7


def test_a_layout_that_is_not_allowed_is_refused_and_nothing_changes():
    u = create_verified_user("layb")
    call(u, "put", "/layouts/groceries", json={"widgets": [{"id": "list", "size": "s"}]})
    for bad in ({"widgets": [{"id": "nope"}]}, {"widgets": [{"id": "list"}, {"id": "list"}]}, {"widgets": [{"id": "list", "size": "xl"}]},
                {"focus": "x" * 40}):
        r = call(u, "put", "/layouts/groceries", json=bad)
        assert r.status_code == 400 and r.json()["detail"], bad
    assert call(u, "get", "/layouts/groceries").json()["layout"]["widgets"] == [{"id": "list", "size": "s"}]
    assert call(u, "get", "/layouts/other").status_code == 404


def test_one_persons_layout_is_never_seen_by_another_and_needs_a_signed_in_user():
    a, b = create_verified_user("laya"), create_verified_user("layc")
    call(a, "put", "/layouts/groceries", json={"widgets": [{"id": "week", "size": "l"}], "focus": "pantry-id"})
    other = call(b, "get", "/layouts/groceries").json()
    assert other["saved"] is False and other["layout"]["focus"] == "all"
    assert requests.get(api(a, "/layouts/groceries"), timeout=60).status_code in (401, 403)


# -- the assistant -----------------------------------------------------------------------------------------------------------

def test_the_assistant_reads_and_arranges_the_today_page():
    c = Chat("gla")
    assert c.one("get_groceries_layout", {})["saved"] is False
    out = c.one("update_groceries_layout", {"widgets": [{"id": "cook", "size": "l"}, {"id": "list"}], "focus": "all"})
    assert out["saved"] is True and [w["id"] for w in out["layout"]["widgets"]] == ["cook", "list"]
    assert call(c.user, "get", "/layouts/groceries").json()["layout"]["widgets"][0] == {"id": "cook", "size": "l"}   # the page sees it
    assert "error" in c.one("update_groceries_layout", {"widgets": [{"id": "bogus"}]})
    assert c.one("update_groceries_layout", {"reset": True})["saved"] is False
    assert call(c.user, "get", "/layouts/groceries").json()["saved"] is False


def test_the_assistant_can_only_delete_with_a_preview_and_a_later_yes():
    c = Chat("gld")
    lst = call(c.user, "post", "/shopping/lists", json={"name": "Party"}).json()
    call(c.user, "post", "/shopping", json={"name": "Crisps", "quantity": 2, "list_id": lst["id"]})
    first = c.one("delete_shopping_list", {"list": "Party"})
    assert first["needs_confirmation"] is True
    assert any(x["id"] == lst["id"] for x in call(c.user, "get", "/shopping/lists").json())          # a preview deletes nothing
    same_turn = set()
    c.one("delete_shopping_list", {"list": "Party"}, previewed=same_turn)
    again = c.one("delete_shopping_list", {"list": "Party", "confirm": True}, previewed=same_turn)
    assert again.get("needs_confirmation") is True                                                    # asking and confirming in one turn is refused
    assert c.one("delete_shopping_list", {"list": "Party", "confirm": True}).get("deleted") == "Party"
    assert not any(x["id"] == lst["id"] for x in call(c.user, "get", "/shopping/lists").json())


def test_inventory_storage_appliance_and_recurring_deletes_all_ask_first():
    c = Chat("gle")
    loc = call(c.user, "post", "/storage-locations", json={"name": "Garage", "kind": "custom"}).json()
    call(c.user, "post", "/groceries", json={"name": "Spare rice", "quantity": 2, "storage_location": loc["id"]})
    app = call(c.user, "post", "/appliances", json={"name": "Old kettle", "kind": "kettle"}).json()
    rec = call(c.user, "post", "/shopping/recurring", json={"name": "Weekly basics", "schedule": "weekly", "items": [{"name": "Milk"}]}).json()
    inv = lambda: call(c.user, "get", "/groceries").json()
    assert c.one("delete_storage_location", {"name": "Garage"})["needs_confirmation"] is True
    done = c.sure("delete_storage_location", {"name": "Garage"})
    assert done["deleted"] == "Garage" and done["items_that_lost_their_place"] == 1
    assert not any(s["id"] == loc["id"] for s in call(c.user, "get", "/storage-locations").json())
    assert any(g["name"] == "Spare rice" for g in inv())                                              # the food itself is kept
    assert c.sure("delete_grocery", {"item": "Spare rice"})["deleted"] == "Spare rice"
    assert not any(g["name"] == "Spare rice" for g in inv())
    assert c.one("update_appliance", {"appliance": "Old kettle", "name": "New kettle"})["name"] == "New kettle"
    assert c.sure("delete_appliance", {"appliance": "New kettle"})["deleted"] == "New kettle"
    assert not any(a["id"] == app["id"] for a in call(c.user, "get", "/appliances").json())
    assert c.one("update_recurring_list", {"recurring": "Weekly basics", "name": "Basics", "schedule": "monthly"})["name"] == "Basics"
    assert c.sure("delete_recurring_list", {"recurring": "Basics"})["deleted"] == "Basics"
    assert not any(r["id"] == rec["id"] for r in call(c.user, "get", "/shopping/recurring").json())


def test_the_assistant_edits_lists_and_catalog_products_and_fills_a_list_from_a_recipe():
    c = Chat("glf")
    lst = call(c.user, "post", "/shopping/lists", json={"name": "Weekend"}).json()
    out = c.one("update_shopping_list", {"list": "Weekend", "name": "Weekend shop", "budget": 40})
    assert out["name"] == "Weekend shop" and float(out["budget"]) == 40.0
    assert "error" in c.one("update_shopping_list", {"list": "Weekend shop"})                           # nothing to change is said, not guessed
    prod = call(c.user, "post", "/products", json={"name": "Oat drink", "default_unit": "L"}).json()
    assert c.one("update_product", {"product": "Oat drink", "category": "Dairy", "is_favorite": True})["category"] == "Dairy"
    assert c.sure("delete_product", {"product": "Oat drink"})["deleted"] == "Oat drink"
    assert not any(p["id"] == prod["id"] for p in call(c.user, "get", "/products").json())
    call(c.user, "post", "/recipes", json={"name": "Toast", "servings": 1, "ingredients": [{"name": "Bread", "quantity": 2, "unit": "unit"}]})
    assert c.one("add_recipe_missing_to_list", {"recipe": "Toast", "list": "Weekend shop"})["needs_confirmation"] is True
    c.sure("add_recipe_missing_to_list", {"recipe": "Toast", "list": "Weekend shop"})
    body = call(c.user, "get", "/shopping", params={"list_id": lst["id"]}).json()
    items = body["items"] if isinstance(body, dict) else body
    assert any(i["name"].lower() == "bread" for i in items)
    assert "error" in c.one("delete_shopping_list", {"list": "No such list"})
    assert "error" in c.one("add_recipe_missing_to_list", {"recipe": "No such recipe"})


def test_another_persons_rows_are_out_of_reach_of_the_assistant():
    a, b = Chat("glg"), Chat("glh")
    lst = call(a.user, "post", "/shopping/lists", json={"name": "Private list"}).json()
    assert "error" in b.one("delete_shopping_list", {"list": lst["id"]})
    assert "error" in b.one("update_shopping_list", {"list": "Private list", "name": "Mine now"})
    assert any(x["id"] == lst["id"] and x["name"] == "Private list" for x in call(a.user, "get", "/shopping/lists").json())


# -- cooking time on recipes (the Mix your meal "Under 20 min" choice) ------------------------------------------------------

def test_a_recipe_has_an_optional_cooking_time_that_a_save_without_it_does_not_wipe():
    u = create_verified_user("cook")
    ings = [{"name": "Eggs", "quantity": 2, "unit": "unit"}]
    plain = call(u, "post", "/recipes", json={"name": "Boiled eggs", "servings": 1, "ingredients": ings}).json()
    assert plain["cook_minutes"] is None                                                       # recipes made before this keep working: no time
    quick = call(u, "post", "/recipes", json={"name": "Omelette", "servings": 1, "ingredients": ings, "cook_minutes": 12})
    assert quick.status_code == 200 and quick.json()["cook_minutes"] == 12
    rid = quick.json()["id"]
    # an older client (or the assistant) saves the recipe without mentioning the time: it must stay
    same = call(u, "put", f"/recipes/{rid}", json={"name": "Omelette", "servings": 2, "ingredients": ings})
    assert same.status_code == 200 and same.json()["cook_minutes"] == 12
    assert call(u, "put", f"/recipes/{rid}", json={"name": "Omelette", "servings": 2, "ingredients": ings, "cook_minutes": 25}).json()["cook_minutes"] == 25
    assert call(u, "put", f"/recipes/{rid}", json={"name": "Omelette", "servings": 2, "ingredients": ings, "cook_minutes": None}).json()["cook_minutes"] is None   # cleared on purpose
    assert next(r for r in call(u, "get", "/recipes").json() if r["id"] == rid)["cook_minutes"] is None


def test_a_cooking_time_that_makes_no_sense_is_refused_and_the_time_reaches_the_suggestions():
    u = create_verified_user("cok2")
    ings = [{"name": "Rice", "quantity": 100, "unit": "g"}]
    for bad in (0, -5, 1441, "soon", 12.5):
        r = call(u, "post", "/recipes", json={"name": f"Bad {bad}", "ingredients": ings, "cook_minutes": bad})
        assert r.status_code == 422, (bad, r.text)
    made = call(u, "post", "/recipes", json={"name": "Risotto", "ingredients": ings, "cook_minutes": 45}).json()
    sug = [e for e in call(u, "get", "/recipes/suggestions").json() if e["recipe"]["id"] == made["id"]]
    assert sug and sug[0]["recipe"]["cook_minutes"] == 45                                      # Mix reads the time from here


def test_the_assistant_reads_sets_keeps_and_clears_a_cooking_time():
    c = Chat("cok3")
    made = c.one("create_recipe", {"name": "Pasta bake", "servings": 2, "cook_minutes": 40, "ingredients": [{"name": "Pasta", "quantity": 200, "unit": "g"}]})["created"]
    assert made["cook_minutes"] == 40
    assert next(r for r in c.one("get_recipes", {})["recipes"] if r["id"] == made["id"])["cook_minutes"] == 40
    assert c.one("update_recipe", {"recipe": "Pasta bake", "servings": 3})["updated"]["cook_minutes"] == 40            # not mentioned: kept
    assert c.one("update_recipe", {"recipe": "Pasta bake", "cook_minutes": 15})["updated"]["cook_minutes"] == 15
    assert c.one("update_recipe", {"recipe": "Pasta bake", "cook_minutes": 0})["updated"]["cook_minutes"] is None     # 0 means: remove it
    c.one("update_recipe", {"recipe": "Pasta bake", "cook_minutes": 30})
    assert c.one("update_recipe", {"recipe": "Pasta bake", "cook_minutes": None})["updated"]["cook_minutes"] is None  # so does null
    assert "error" in c.one("update_recipe", {"recipe": "Pasta bake", "cook_minutes": "a while"})
    assert "error" in c.one("update_recipe", {"recipe": "Pasta bake", "cook_minutes": 5000})
    assert "error" in c.one("create_recipe", {"name": "Never", "cook_minutes": 0})
    assert call(c.user, "get", "/recipes").json()[0]["cook_minutes"] is None


def test_what_can_i_cook_shows_the_time_and_can_keep_only_the_quick_ones():
    c = Chat("cok4")
    ing = [{"name": "Rice", "quantity": 100, "unit": "g"}]
    for name, mins in (("Fried rice", 15), ("Slow rice", 90), ("Plain rice", None)):
        call(c.user, "post", "/recipes", json={"name": name, "ingredients": ing, "cook_minutes": mins})
    everything = {s["recipe"]: s["cook_minutes"] for s in c.one("suggest_recipes_from_inventory", {})["suggestions"]}
    assert everything == {"Fried rice": 15, "Slow rice": 90, "Plain rice": None}
    quick = c.one("suggest_recipes_from_inventory", {"max_minutes": 20})["suggestions"]
    assert [s["recipe"] for s in quick] == ["Fried rice"]                                    # no time given is not "quick"
    assert "error" in c.one("suggest_recipes_from_inventory", {"max_minutes": "soon"})
    assert "error" in c.one("suggest_recipes_from_inventory", {"max_minutes": 0})


def test_a_recurring_list_can_be_edited_with_its_items():
    """The page's Edit recurring list sends the items back with the name: that save used to fail with a server error."""
    c = Chat("rec")
    made = call(c.user, "post", "/shopping/recurring", json={"name": "Weekend basics", "schedule": "weekly",
                                                             "items": [{"name": "Bread", "quantity": 1, "unit": "unit", "category": "Carbohydrates"}]})
    assert made.status_code == 200, made.text
    rid = made.json()["id"]
    edited = call(c.user, "put", f"/shopping/recurring/{rid}", json={
        "name": "Weekend basics 2", "schedule": "biweekly",
        "items": [{"name": "Bread", "quantity": 2, "unit": "unit", "category": "Carbohydrates", "estimated_price": None},
                  {"name": "Butter", "quantity": 1, "unit": "pack", "estimated_price": 2.5}]})
    assert edited.status_code == 200, edited.text
    got = [r for r in call(c.user, "get", "/shopping/recurring").json() if r["id"] == rid][0]
    assert got["name"] == "Weekend basics 2" and got["schedule"] == "biweekly"
    assert [(i["name"], float(i["quantity"])) for i in got["items"]] == [("Bread", 2.0), ("Butter", 1.0)]
