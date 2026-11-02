"""Fill an account with at least one row in every user-owned table, through the real routes where they exist.

Shared by the isolation matrix (S-12) and the account export/delete tests (S-11): both need "an account that has used
everything". The creators return the ids a test needs; `populate()` runs all of them for one user.
"""
import datetime as dt
import struct
import uuid
import zlib

import pymysql

import support_db
from support_users import api

TODAY = dt.date.today().isoformat()


# -- helpers -------------------------------------------------------------------------------------------------------

def _tag():
    return uuid.uuid4().hex[:8]


def _post(user, path, body=None, **kw):
    r = user["session"].post(api(user, path), json=body, timeout=30, **kw)
    assert r.status_code == 200, f"POST {path}: {r.status_code} {r.text[:200]}"
    return r.json()


def _put(user, path, body):
    r = user["session"].put(api(user, path), json=body, timeout=30)
    assert r.status_code == 200, f"PUT {path}: {r.status_code} {r.text[:200]}"
    return r.json()


def _db(sql, params=(), fetch=False):
    conn = support_db.connect(cursorclass=pymysql.cursors.DictCursor)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if fetch else None
        conn.commit()
        return rows
    finally:
        conn.close()


def _png() -> bytes:
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b""))


def _account(a, name="Money in hand", type_="cash", balance=100):
    return _post(a, "/accounts", {"name": f"{name} {_tag()}", "type": type_, "opening_balance": balance})["id"]


def _food(a):
    return _post(a, "/nutrition/foods", {"name": f"Iso food {_tag()}", "nutrients": {"energy_kcal": 100, "protein_g": 5}})["id"]


# -- creators: user A makes one object; returns the ids the routes need -------------------------------------------------

def c_account(a):
    return {"id": _account(a)}


def c_category(a):
    return {"id": _post(a, "/categories", {"name": f"Cat {_tag()}", "icon": "circle", "color": "#123456"})["id"]}


def c_person(a):
    return {"id": _post(a, "/people", {"name": f"Person {_tag()}"})["id"]}


def c_task(a):
    return {"id": _post(a, "/tasks", {"title": f"Task {_tag()}"})["id"]}


def c_weight(a):
    return {"id": _post(a, "/weight", {"weight": 70.5, "date": "2026-01-02", "note": "iso"})["id"]}


def c_workout(a):
    return {"id": _post(a, "/workouts", {"type": "Push", "date": "2026-01-02", "notes": "iso",
                                         "exercises": [{"name": "Bench", "sets": [{"reps": 5, "weight": 60}]}]})["id"]}


def c_photo(a):
    r = a["session"].post(api(a, "/photos"), params={"note": "iso"}, files={"file": ("p.png", _png(), "image/png")}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"id": d["id"], "file": d["url"].split("/api/photos/file/", 1)[1]}


def c_grocery(a):
    return {"id": _post(a, "/groceries", {"name": f"Grocery {_tag()}", "quantity": 3, "unit": "unit"})["id"]}


def c_product(a):
    return {"id": _post(a, "/products", {"name": f"Product {_tag()}", "category": "Other", "default_unit": "unit"})["id"]}


def c_shopping_item(a):
    return {"id": _post(a, "/shopping", {"name": f"Item {_tag()}", "quantity": 1})["id"]}


def c_shopping_list(a):
    return {"id": _post(a, "/shopping/lists", {"name": f"List {_tag()}"})["id"]}


def c_recurring(a):
    return {"id": _post(a, "/shopping/recurring", {"name": f"Weekly {_tag()}", "schedule": "weekly",
                                                   "items": [{"name": "Milk", "quantity": 2, "unit": "unit"}]})["id"]}


def c_storage(a):
    return {"id": _post(a, "/storage-locations", {"name": f"Shelf {_tag()}", "kind": "custom"})["id"]}


def c_appliance(a):
    return {"id": _post(a, "/appliances", {"name": f"Oven {_tag()}", "kind": "oven"})["id"]}


def c_meal(a):
    return {"id": _post(a, "/meals", {"description": f"Meal {_tag()}", "calories": 300, "date": TODAY})["id"]}


def c_recipe(a):
    return {"id": _post(a, "/recipes", {"name": f"Recipe {_tag()}", "servings": 2})["id"]}


def c_transaction(a):
    acct = _account(a)
    t = _post(a, "/transactions/expense", {"amount": 9.5, "merchant": "Iso shop", "description": "iso", "category": "Groceries",
                                           "account": acct, "date": TODAY})["transaction"]
    splits = _db("SELECT id FROM splits WHERE transaction_id=%s", (t["id"],), fetch=True)
    return {"id": t["id"], "split_id": splits[0]["id"]}


def c_settlement(a):
    acct = _account(a)
    return {"id": _post(a, "/settlements", {"person": f"Payer {_tag()}", "amount": 5, "method": "Cash", "account": acct,
                                            "account_id": acct, "direction": "in"})["id"]}


def c_food(a):
    fid = _food(a)
    _post(a, f"/nutrition/foods/{fid}/favorite", {})  # so we can prove the other user's "unfavourite" does not touch it
    return {"id": fid}


def v_food_is_still_a_favourite(a, made):
    r = a["session"].get(api(a, "/nutrition/foods/favorites"), timeout=30)
    assert r.status_code == 200 and made["id"] in _ids(r.json()), "the owner's favourite was removed by another user"


def c_diary(a):
    return {"id": _post(a, "/nutrition/diary", {"food_id": _food(a), "quantity": 50, "unit": "g"})["id"]}


def c_plan(a):
    return {"id": _post(a, "/nutrition/plan", {"date": TODAY, "meal_type": "dinner", "description": "Iso dinner", "calories": 500})["id"]}


def c_water(a):
    return {"id": _post(a, "/nutrition/water", {"amount_ml": 250})["id"]}


SCHEDULED_BODY = {"title": "Report", "instruction": "Summarise the week.", "schedule": {"kind": "weekly", "time": "09:00", "weekdays": [0]},
                  "timezone": "Europe/Lisbon", "data_sources": ["money"], "recipients": []}


def c_scheduled_task(a):
    return {"id": _post(a, "/scheduled/tasks", {**SCHEDULED_BODY, "title": f"Report {_tag()}"})["id"]}


def c_recipient(a):
    rid = str(uuid.uuid4())
    _db("INSERT INTO report_recipients (id,user_id,email,verified,attempts,created_at) VALUES (%s,%s,%s,0,0,%s)",
        (rid, a["id"], f"iso_{_tag()}@example.com", dt.datetime.now(dt.timezone.utc).isoformat()))
    return {"id": rid}


def c_run(a):
    task = c_scheduled_task(a)["id"]
    rid = str(uuid.uuid4())
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    _db("INSERT INTO scheduled_task_runs (id,task_id,user_id,run_key,`trigger`,scheduled_for,status,delivery_status,created_at) "
        "VALUES (%s,%s,%s,%s,'manual',%s,'failed','none',%s)", (rid, task, a["id"], f"iso-{_tag()}", now, now))
    return {"id": rid}


def c_conversation(a):
    cid, mid = str(uuid.uuid4()), str(uuid.uuid4())
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    _db("INSERT INTO ai_conversations (id,user_id,title,title_source,archived,preview,message_count,created_at,updated_at) "
        "VALUES (%s,%s,'iso chat','user',0,'hi',1,%s,%s)", (cid, a["id"], now, now))
    _db("INSERT INTO ai_messages (id,user_id,session_id,role,text,meta,created_at) VALUES (%s,%s,%s,'user','hi',NULL,%s)",
        (mid, a["id"], cid, now))
    return {"id": cid, "message_id": mid}


def c_action(a):
    aid = str(uuid.uuid4())
    _db("INSERT INTO ai_actions (id,user_id,label,tools,created,undoable,undone,created_at) VALUES (%s,%s,'iso action','[]','[]',1,0,%s)",
        (aid, a["id"], dt.datetime.now(dt.timezone.utc).isoformat()))
    return {"id": aid}


def _ids(listing):
    if isinstance(listing, dict):
        listing = next((v for v in listing.values() if isinstance(v, list)), [])
    return {row.get("id") for row in listing if isinstance(row, dict)}


# Every creator, by the table(s) it fills. Tables that have no route of their own are filled directly (see _extras).
CREATORS = {
    "account": c_account,
    "category": c_category,
    "person": c_person,
    "task": c_task,
    "weight": c_weight,
    "workout": c_workout,
    "photo": c_photo,
    "grocery": c_grocery,
    "product": c_product,
    "shopping_item": c_shopping_item,
    "shopping_list": c_shopping_list,
    "recurring": c_recurring,
    "storage": c_storage,
    "appliance": c_appliance,
    "meal": c_meal,
    "recipe": c_recipe,
    "transaction": c_transaction,
    "settlement": c_settlement,
    "food": c_food,
    "diary": c_diary,
    "plan": c_plan,
    "water": c_water,
    "scheduled_task": c_scheduled_task,
    "recipient": c_recipient,
    "run": c_run,
    "conversation": c_conversation,
    "action": c_action,
}


def _extras(a):
    """Rows that no route creates: a nutrition profile, a price record."""
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    _db("DELETE FROM nutrition_profiles WHERE user_id=%s", (a["id"],))
    _db("INSERT INTO nutrition_profiles (id,user_id,birth_year,sex,height_cm,weight_kg,updated_at) VALUES (%s,%s,1980,'F',170,65,%s)",
        (str(uuid.uuid4()), a["id"], now))
    name = f"price{_tag()}"
    _db("INSERT INTO price_records (id,user_id,name,name_lower,store,price,unit,date,created_at) VALUES (%s,%s,%s,%s,'Store',1.5,'unit',%s,%s)",
        (str(uuid.uuid4()), a["id"], name, name, TODAY, now))
    _db("INSERT INTO ai_pending_confirmations (user_id,session_id,tool,target_id,expires_at,created_at) VALUES (%s,'populate','delete_task','x',%s,%s)",
        (a["id"], (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)).isoformat(), now))
    # Written straight to the table, so the sessions the test already holds keep working; it only stops NEW sign-ins.
    _db("INSERT INTO account_deactivations (user_id,deactivated_ms,deactivated_by) VALUES (%s,%s,'self')", (a["id"], int(dt.datetime.now().timestamp() * 1000)))


def populate(a):
    """One object in every creator, plus the extras. Returns {creator name: created ids}."""
    made = {name: fn(a) for name, fn in CREATORS.items()}
    _extras(a)
    return made
