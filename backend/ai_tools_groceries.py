"""The assistant's tools for the rest of what the Groceries page can change: every edit and delete the page offers that the older kitchen
and shopping tools did not reach (inventory rows, the product catalog, storage spaces, appliances, shopping lists, recurring lists,
putting a recipe's missing ingredients on a list) and the Today page layout.

They call the functions the page's own routes call, so the rules are the same. Anything that deletes, or adds many things at once, only
previews on the first call and acts after the user agrees (`confirm`). Changing the page layout is a low-risk preference and acts at once.
`srv` is the imported `server` module, passed in to avoid a circular import.
"""
from typing import Optional

from sqlalchemy import func, select

import layouts_api
from ai_tools_extra import _CONFIRM, _confirm, _fn
from models import Appliance, Grocery, Product, Recipe, RecurringList, ShoppingList, StorageLocation

_S = {"type": "string"}
_N = {"type": "number"}
_B = {"type": "boolean"}

GROCERIES_TOOLS = [
    _fn("get_groceries_layout",
        "Read how the person arranged the Groceries 'Today' page: which widgets show, their order and size (s, m, l) and which storage "
        "space the page is focused on. Widgets: needs, kitchen, list, low, risk, cook, week.", {}),
    _fn("update_groceries_layout",
        "Change the Groceries 'Today' page layout. Give 'widgets' as the full ordered list of {id, size} to show (anything left out is hidden), "
        "and/or 'focus' ('all' or a storage space id). reset=true puts the default layout back.",
        {"widgets": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string", "enum": list(layouts_api.WIDGET_IDS)},
                                                                                   "size": {"type": "string", "enum": list(layouts_api.WIDGET_SIZES)}},
                                                  "required": ["id"]}},
         "focus": _S, "reset": _B}),
    _fn("delete_grocery", "Remove an inventory item completely (not the same as discarding food that went off). Preview first, then confirm.",
        {"item": {"type": "string", "description": "Inventory item id or name"}, "confirm": _CONFIRM}, ["item"]),
    _fn("update_product", "Edit a product in the catalog: name, category, default unit, typical quantity, icon, favourite, tags.",
        {"product": {"type": "string", "description": "Product id or name"}, "name": _S, "category": _S, "default_unit": _S, "typical_quantity": _N,
         "icon": _S, "is_favorite": _B, "tags": {"type": "array", "items": _S}}, ["product"]),
    _fn("delete_product", "Delete a product from the catalog (preview first, then confirm).", {"product": _S, "confirm": _CONFIRM}, ["product"]),
    _fn("import_product_library", "Add the built-in product library to the catalog. It adds many products, so preview first, then confirm.",
        {"confirm": _CONFIRM}),
    _fn("delete_storage_location", "Delete a storage space such as a fridge or pantry (preview first, then confirm). Say what is in it first.",
        {"name": _S, "confirm": _CONFIRM}, ["name"]),
    _fn("update_appliance", "Edit an appliance: name, kind, notes.", {"appliance": _S, "name": _S, "kind": _S, "notes": _S}, ["appliance"]),
    _fn("delete_appliance", "Delete an appliance (preview first, then confirm).", {"appliance": _S, "confirm": _CONFIRM}, ["appliance"]),
    _fn("update_shopping_list", "Rename a shopping list, change its budget, or archive / restore it.",
        {"list": {"type": "string", "description": "List id or name"}, "name": _S, "budget": _N, "archived": _B}, ["list"]),
    _fn("delete_shopping_list", "Delete a shopping list and the items on it (preview first, then confirm).", {"list": _S, "confirm": _CONFIRM}, ["list"]),
    _fn("update_recurring_list", "Rename a recurring list or change its schedule.",
        {"recurring": {"type": "string", "description": "Recurring list id or name"}, "name": _S, "schedule": _S}, ["recurring"]),
    _fn("delete_recurring_list", "Delete a recurring list (preview first, then confirm).", {"recurring": _S, "confirm": _CONFIRM}, ["recurring"]),
    _fn("add_recipe_missing_to_list",
        "Put the ingredients a recipe is missing on a shopping list. It adds several items at once, so preview first, then confirm.",
        {"recipe": {"type": "string", "description": "Recipe id or name"}, "list": {"type": "string", "description": "List id or name; default list if empty"},
         "confirm": _CONFIRM}, ["recipe"]),
]
GROCERIES_NAMES = {t["function"]["name"] for t in GROCERIES_TOOLS}


async def _one(db, model, uid, key, name_col="name", shared=False) -> Optional[object]:
    """One row of this person's by id, else by exact name, else by a name that contains the text."""
    key = (key or "").strip()
    if not key:
        return None
    mine = (model.user_id == uid) | (model.user_id.is_(None)) if shared else (model.user_id == uid)
    row = (await db.execute(select(model).where(mine, model.id == key))).scalar_one_or_none()
    if row:
        return row
    col = getattr(model, name_col)
    row = (await db.execute(select(model).where(mine, func.lower(col) == key.lower()))).scalars().first()
    return row or (await db.execute(select(model).where(mine, col.ilike(f"%{key}%")))).scalars().first()


async def dispatch_groceries(srv, db, name, args, created, user, session_id=None, previewed=None) -> dict:
    uid = user["_id"]

    if name == "get_groceries_layout":
        layout, saved = await layouts_api.read_layout(db, uid, layouts_api.GROCERIES)
        return {"layout": layout, "saved": saved, "widgets_available": list(layouts_api.WIDGET_IDS)}
    if name == "update_groceries_layout":
        if args.get("reset"):
            await layouts_api.reset_layout(db, uid, layouts_api.GROCERIES)
            return {"layout": layouts_api.DEFAULT_GROCERIES, "saved": False}
        current, _ = await layouts_api.read_layout(db, uid, layouts_api.GROCERIES)
        changes = {k: args[k] for k in ("widgets", "focus") if args.get(k) is not None}
        try:
            layout = layouts_api.clean_groceries({**current, **changes})
        except ValueError as exc:
            return {"error": str(exc)}
        await layouts_api.save_layout(db, uid, layouts_api.GROCERIES, layout, srv.now_iso())
        return {"layout": layout, "saved": True}

    if name == "delete_grocery":
        g = await _one(db, Grocery, uid, args.get("item"))
        if not g:
            return {"error": f"No inventory item matching '{args.get('item')}'"}
        gate = await _confirm(srv, db, user, session_id, previewed, name, g.id, args, f"This will remove '{g.name}' from the inventory. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "groceries", g)
        await srv.delete_grocery(g.id, user, db)
        return {"deleted": g.name}

    if name == "update_product":
        p = await _one(db, Product, uid, args.get("product"), shared=True)
        if not p:
            return {"error": f"No product matching '{args.get('product')}'"}
        fields = {k: args[k] for k in ("name", "category", "default_unit", "typical_quantity", "icon", "is_favorite", "tags") if args.get(k) is not None}
        if not fields:
            return {"error": "Nothing to change. Give at least one field."}
        return await srv.update_product(p.id, srv.ProductUpdate(**fields), user, db)
    if name == "delete_product":
        p = await _one(db, Product, uid, args.get("product"), shared=True)
        if not p:
            return {"error": f"No product matching '{args.get('product')}'"}
        gate = await _confirm(srv, db, user, session_id, previewed, name, p.id, args, f"This will delete the product '{p.name}' from the catalog. Ask the user to confirm.")
        if gate:
            return gate
        await srv.delete_product(p.id, user, db)
        return {"deleted": p.name}
    if name == "import_product_library":
        gate = await _confirm(srv, db, user, session_id, previewed, name, "library", args, "This will add the built-in product library (many products) to the catalog. Ask the user to confirm.")
        if gate:
            return gate
        return await srv.import_product_library(user, db)

    if name == "delete_storage_location":
        loc = await _one(db, StorageLocation, uid, args.get("name"))
        if not loc:
            return {"error": f"No storage location named '{args.get('name')}'"}
        count = (await db.execute(select(func.count()).select_from(Grocery).where(Grocery.user_id == uid, Grocery.storage_location == loc.id))).scalar_one()
        by_name = (await db.execute(select(func.count()).select_from(Grocery).where(Grocery.user_id == uid, Grocery.storage_location == loc.name))).scalar_one()
        gate = await _confirm(srv, db, user, session_id, previewed, name, loc.id, args,
                              f"This will delete the storage space '{loc.name}'. It holds {count + by_name} inventory item(s); they are kept but lose their place. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "storage_locations", loc)
        await srv.delete_storage_location(loc.id, user, db)
        return {"deleted": loc.name, "items_that_lost_their_place": count + by_name}

    if name == "update_appliance":
        a = await _one(db, Appliance, uid, args.get("appliance"))
        if not a:
            return {"error": f"No appliance matching '{args.get('appliance')}'"}
        fields = {k: args[k] for k in ("name", "kind", "notes") if args.get(k) is not None}
        if not fields:
            return {"error": "Nothing to change. Give a name, kind or notes."}
        return await srv.update_appliance(a.id, srv.ApplianceUpdate(**fields), user, db)
    if name == "delete_appliance":
        a = await _one(db, Appliance, uid, args.get("appliance"))
        if not a:
            return {"error": f"No appliance matching '{args.get('appliance')}'"}
        gate = await _confirm(srv, db, user, session_id, previewed, name, a.id, args, f"This will delete the appliance '{a.name}'. Ask the user to confirm.")
        if gate:
            return gate
        await srv.delete_appliance(a.id, user, db)
        return {"deleted": a.name}

    if name == "update_shopping_list":
        lst = await _one(db, ShoppingList, uid, args.get("list"))
        if not lst:
            return {"error": f"No shopping list matching '{args.get('list')}'"}
        fields = {k: args[k] for k in ("name", "budget", "archived") if args.get(k) is not None}
        if not fields:
            return {"error": "Nothing to change. Give a name, budget or archived."}
        srv.remember_before(created, "shopping_lists", lst)
        return await srv.update_shopping_list(lst.id, srv.ShoppingListUpdate(**fields), user, db)
    if name == "delete_shopping_list":
        lst = await _one(db, ShoppingList, uid, args.get("list"))
        if not lst:
            return {"error": f"No shopping list matching '{args.get('list')}'"}
        gate = await _confirm(srv, db, user, session_id, previewed, name, lst.id, args, f"This will delete the shopping list '{lst.name}' and every item on it. Ask the user to confirm.")
        if gate:
            return gate
        srv.remember_before(created, "shopping_lists", lst)
        await srv.delete_shopping_list(lst.id, user, db)
        return {"deleted": lst.name}

    if name == "update_recurring_list":
        r = await _one(db, RecurringList, uid, args.get("recurring"))
        if not r:
            return {"error": f"No recurring list matching '{args.get('recurring')}'"}
        fields = {k: args[k] for k in ("name", "schedule") if args.get(k) is not None}
        if not fields:
            return {"error": "Nothing to change. Give a name or schedule."}
        return await srv.update_recurring_list(r.id, srv.RecurringListUpdate(**fields), user, db)
    if name == "delete_recurring_list":
        r = await _one(db, RecurringList, uid, args.get("recurring"))
        if not r:
            return {"error": f"No recurring list matching '{args.get('recurring')}'"}
        gate = await _confirm(srv, db, user, session_id, previewed, name, r.id, args, f"This will delete the recurring list '{r.name}'. Ask the user to confirm.")
        if gate:
            return gate
        await srv.delete_recurring_list(r.id, user, db)
        return {"deleted": r.name}

    if name == "add_recipe_missing_to_list":
        rec = await _one(db, Recipe, uid, args.get("recipe"))
        if not rec:
            return {"error": f"No recipe matching '{args.get('recipe')}'"}
        lst_id = None
        if (args.get("list") or "").strip():
            lst = await _one(db, ShoppingList, uid, args.get("list"))
            if not lst:
                return {"error": f"No shopping list matching '{args.get('list')}'"}
            lst_id = lst.id
        gate = await _confirm(srv, db, user, session_id, previewed, name, rec.id, args, f"This will put the missing ingredients of '{rec.name}' on the shopping list. Ask the user to confirm.")
        if gate:
            return gate
        result = await srv.add_missing_to_list(rec.id, srv.AddMissingBody(list_id=lst_id), user, db)
        for item in (result.get("added") if isinstance(result, dict) else None) or []:
            if isinstance(item, dict) and item.get("id"):
                created.append({"collection": "shopping_items", "id": item["id"]})
        return result

    return {"error": f"Unknown groceries tool '{name}'"}
