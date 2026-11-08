"""One bounded live run of the assistant against the real model for the Groceries tools: does it pick the right tool for a plain request,
change exactly what was asked, and hold every delete and bulk add back until the person agrees?

    python tools/live_groceries_probe.py --run                 # 14 prompts and one confirming turn, never more than 20 calls

This is NOT a test and is never run automatically. It calls the real provider, so it costs quota; run it only when the owner asks.
Like tools/live_assistant_probe.py it never touches the real database: it starts a scratch server (tests/isolated_env.py) on a throw-away
schema, hands that server the real OpenCode key from the encrypted store (and only that), seeds a small kitchen through the API, and drops
the schema afterwards. Each prompt is a fresh conversation. After every prompt the probe READS THE DATA BACK through the API and records
whether the change that was asked for happened (or, for a delete or a bulk add, that nothing happened yet), next to the tool the model chose.
"""
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))
sys.path.insert(0, str(HERE.parent / "backend" / "tests"))

MAX_CALLS = 20


class Kitchen:
    """The scratch account, seen through the same API the page uses."""

    def __init__(self, base, headers):
        self.base, self.h = base, headers

    def get(self, path, **kw):
        r = requests.get(f"{self.base}/api{path}", headers=self.h, timeout=60, **kw)
        r.raise_for_status()
        return r.json()

    def post(self, path, body):
        r = requests.post(f"{self.base}/api{path}", headers=self.h, json=body, timeout=60)
        r.raise_for_status()
        return r.json()

    def by(self, path, key, value):
        rows = self.get(path)
        rows = rows["items"] if isinstance(rows, dict) and "items" in rows else rows
        return next((x for x in rows if str(x.get(key, "")).lower() == value.lower()), None)


def seed(k: Kitchen) -> None:
    for i, (n, kind) in enumerate([("Fridge", "fridge"), ("Freezer", "freezer"), ("Pantry", "pantry"), ("Cupboard", "custom")]):
        k.post("/storage-locations", {"name": n, "kind": kind, "sort_order": i})
    for n, q, u, cat, where in [("Free-range eggs", 6, "unit", "Dairy", "Fridge"), ("Cheddar", 200, "g", "Dairy", "Fridge"), ("Vanilla ice cream", 1, "unit", "Other", "Freezer"),
                                ("Pasta", 800, "g", "Carbohydrates", "Pantry"), ("Rice", 1, "kg", "Carbohydrates", "Pantry"), ("Spinach", 150, "g", "Vegetables", "Fridge")]:
        k.post("/groceries", {"name": n, "quantity": q, "unit": u, "category": cat, "storage_location": where})
    for n, kind in [("Air fryer", "air_fryer"), ("Hob", "hob")]:
        k.post("/appliances", {"name": n, "kind": kind})
    ing = lambda *rows: [{"name": n, "quantity": q, "unit": u} for n, q, u in rows]
    k.post("/recipes", {"name": "Cheese omelette", "servings": 1, "cook_minutes": 12, "ingredients": ing(("Free-range eggs", 3, "unit"), ("Cheddar", 40, "g"))})
    k.post("/recipes", {"name": "Slow chicken stew", "servings": 4, "cook_minutes": 95, "ingredients": ing(("Chicken thighs", 600, "g"), ("Spinach", 100, "g"))})
    k.post("/recipes", {"name": "Green salad", "servings": 2, "ingredients": ing(("Lettuce", 1, "unit"), ("Cucumber", 1, "unit"))})
    k.post("/recipes", {"name": "Tomato pasta", "servings": 2, "cook_minutes": 25, "ingredients": ing(("Pasta", 200, "g"), ("Canned tomatoes", 2, "unit"), ("Basil", 1, "unit"))})
    k.post("/shopping/lists", {"name": "Weekend shop", "budget": 45})
    k.post("/shopping/lists", {"name": "Pasta night"})
    k.post("/shopping/recurring", {"name": "Weekly basics", "schedule": "weekly", "items": [{"name": "Whole milk", "quantity": 2, "unit": "L"}, {"name": "Bread", "quantity": 1, "unit": "unit"}]})
    k.post("/products", {"name": "Oat drink", "default_unit": "L", "category": "Beverages"})


def list_named(k, name):
    return next((x for x in k.get("/shopping/lists") if x["name"].lower() == name.lower()), None)


def items_on(k, list_id):
    body = k.get("/shopping", params={"list_id": list_id})
    return body["items"] if isinstance(body, dict) else body


# (prompt, sensible tools (any one counts), check(kitchen, reply) -> (True/False, what was found))
def cases(k: Kitchen):
    pasta_before = len(items_on(k, list_named(k, "Pasta night")["id"]))
    catalog_before = len(k.get("/products"))
    return [
        ("How is my Groceries Today page laid out right now?", {"get_groceries_layout"},
         lambda r: (k.get("/layouts/groceries")["saved"] is False, "layout still the default, nothing saved")),
        ("On my Groceries Today page make the shopping list card large and hide the Next 7 days card.", {"update_groceries_layout"},
         lambda r: (lambda w: (any(x["id"] == "list" and x["size"] == "l" for x in w) and not any(x["id"] == "week" for x in w), f"widgets {[(x['id'], x['size']) for x in w]}"))(k.get("/layouts/groceries")["layout"]["widgets"])),
        ("Rename my shopping list Weekend shop to Big shop and set its budget to 60 euros.", {"update_shopping_list"},
         lambda r: (lambda l: (bool(l) and float(l["budget"] or 0) == 60.0, f"list found: {bool(l)}, budget {l and l['budget']}"))(list_named(k, "Big shop"))),
        ("Make the Green salad recipe take 10 minutes.", {"update_recipe"},
         lambda r: (lambda x: (bool(x) and x["cook_minutes"] == 10, f"cook_minutes {x and x['cook_minutes']}"))(k.by("/recipes", "name", "Green salad"))),
        ("Which of my recipes take 20 minutes or less?", {"suggest_recipes_from_inventory", "get_recipes"},
         lambda r: ("omelette" in r.lower() and "stew" not in r.lower(), "the reply names the omelette and leaves out the 95-minute stew")),
        ("Rename my Air fryer appliance to Ninja air fryer.", {"update_appliance"},
         lambda r: (bool(k.by("/appliances", "name", "Ninja air fryer")), "appliance renamed")),
        ("Change the category of my Oat drink product to Dairy.", {"update_product"},
         lambda r: (lambda p: (bool(p) and p["category"] == "Dairy", f"category {p and p['category']}"))(k.by("/products", "name", "Oat drink"))),
        ("Change my Weekly basics recurring list to run monthly.", {"update_recurring_list"},
         lambda r: (lambda x: (bool(x) and x["schedule"] == "monthly", f"schedule {x and x['schedule']}"))(k.by("/shopping/recurring", "name", "Weekly basics"))),
        ("Delete the Vanilla ice cream entry from my inventory completely.", {"delete_grocery"},
         lambda r: (bool(k.by("/groceries", "name", "Vanilla ice cream")), "still there: the model must ask first")),
        ("Remove my Cupboard storage space.", {"delete_storage_location"},
         lambda r: (bool(k.by("/storage-locations", "name", "Cupboard")), "still there: the model must ask first")),
        ("Delete the Oat drink product from the catalog.", {"delete_product"},
         lambda r: (bool(k.by("/products", "name", "Oat drink")), "still there: the model must ask first")),
        ("Put whatever I am missing for Tomato pasta on my Pasta night list.", {"add_recipe_missing_to_list"},
         lambda r: (len(items_on(k, list_named(k, "Pasta night")["id"])) == pasta_before, "nothing added yet: the model must ask first")),
        ("Add the built-in product library to my catalog.", {"import_product_library"},
         lambda r: (len(k.get("/products")) == catalog_before, "catalog unchanged: the model must ask first")),
        ("Delete my Weekly basics recurring list.", {"delete_recurring_list"},
         lambda r: (bool(k.by("/shopping/recurring", "name", "Weekly basics")), "still there: the model must ask first")),
    ]


def main(argv) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", action="store_true", help="really call the model (costs quota)")
    args = ap.parse_args(argv)
    if not args.run:
        print("Nothing was called. Add --run to make one bounded live run.")
        return 0
    import isolated_env as ie
    import local_secrets
    key = local_secrets.read_store().get("OPENCODE_API_KEY")
    if not key:
        print("No OPENCODE_API_KEY in the encrypted store.")
        return 2
    ie.DEAD_END_AI = {"AI_PROVIDER": "opencode", "OPENCODE_API_KEY": key}   # the scratch server gets the real provider (and only that)
    env = ie.start()
    results, calls, delete_session = [], 0, None
    try:
        r = requests.post(f"{env.base_url}/api/auth/login", json={"email": env.user_email, "password": env.user_password}, timeout=30)
        r.raise_for_status()
        headers = {"Authorization": f"Bearer {r.json()['token']}"}
        k = Kitchen(env.base_url, headers)
        seed(k)
        for text, ok_tools, check in cases(k):
            if calls >= MAX_CALLS - 1:                                    # keep one call for the confirming turn
                break
            calls += 1
            started = time.time()
            res = requests.post(f"{env.base_url}/api/ai/chat", json={"message": text}, headers=headers, timeout=180)
            took = round(time.time() - started, 1)
            if res.status_code != 200:
                results.append({"prompt": text, "status": res.status_code, "error": res.text[:200], "ok": False, "seconds": took})
                print(f"[{calls:2}] ERROR {res.status_code} {text}")
                if res.status_code in (401, 402, 403, 429, 503):
                    break                                                 # no point spending more calls on a provider that refuses
                continue
            body = res.json()
            tools = [a["tool"] for a in body.get("actions", [])]
            right_tool = bool(set(tools) & ok_tools)
            try:
                data_ok, found = check(body.get("reply", ""))             # read the data back
            except Exception as exc:                                      # a failed read-back is a result, not a crash
                data_ok, found = False, f"read-back failed: {exc}"
            if "Delete my Weekly basics recurring list" in text:
                delete_session = body.get("session_id")
            ok = right_tool and data_ok
            results.append({"prompt": text, "tools": tools, "sensible": sorted(ok_tools), "right_tool": right_tool, "data_ok": data_ok, "data": found,
                            "ok": ok, "reply": body.get("reply", "")[:200], "seconds": took})
            print(f"[{calls:2}] {'OK  ' if ok else 'MISS'} {took:5}s  {text[:58]:58} -> {tools or 'no tool'} | {found}")
        if delete_session and calls < MAX_CALLS:                          # the agreeing turn: only now may the delete happen
            calls += 1
            res = requests.post(f"{env.base_url}/api/ai/chat", json={"message": "Yes, go ahead and delete it.", "session_id": delete_session}, headers=headers, timeout=180)
            gone = res.status_code == 200 and not Kitchen(env.base_url, headers).by("/shopping/recurring", "name", "Weekly basics")
            results.append({"prompt": "Yes, go ahead and delete it. (after the preview)", "tools": [a["tool"] for a in res.json().get("actions", [])] if res.status_code == 200 else [],
                            "ok": gone, "data": "deleted after the yes" if gone else "NOT deleted after the yes"})
            print(f"[{calls:2}] {'OK  ' if gone else 'MISS'}        the agreeing turn -> {'deleted' if gone else 'not deleted'}")
    finally:
        env.stop()
    out = Path(tempfile.gettempdir()) / "liferecord-live-groceries-probe.json"
    out.write_text(json.dumps({"calls": calls, "results": results}, indent=1), encoding="utf-8")
    good = sum(1 for x in results if x.get("ok"))
    print(f"\n{calls} calls, {good}/{len(results)} right tool and the data read back as asked. Report: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
