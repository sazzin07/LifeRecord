"""The assistant's tools for the person's settings. They call the functions the Settings screen's routes call (`profile_api`).

Only the low-risk choices are here: theme, animations, calendar week start, the period Money opens on, and the display
name. The sign-in address, the password, two-step sign-in, sessions, and deleting or exporting data are NOT tools: they need the
person's password (and a second step), which a chat message cannot safely carry. The answer to a request for one of them says where
on the screen to do it. Every change records what it replaced, so "undo" puts the earlier choice back.
`srv` is the imported `server` module, passed in to avoid a circular import.
"""
from sqlalchemy import select

import profile_api
from models import User

SETTINGS_TOOLS = [
    {"type": "function", "function": {
        "name": "get_settings",
        "description": "Read the user's settings: theme, animations, calendar week start, the period Money opens on, and their display name. "
                       "Use it to answer 'what is my theme?' or before changing something.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "update_settings",
        "description": "Change one or more of the user's settings. Low-risk only: theme (system, light, dark), animations (on/off), week_start (monday or sunday), money_period (week, day or all: what the Money page opens on), "
                       "display_name. It can NOT change the email address, password, two-step sign-in, sessions or delete data: for those tell the user to open Profile.",
        "parameters": {"type": "object", "properties": {
            "theme": {"type": "string", "enum": ["system", "light", "dark"]},
            "animations": {"type": "boolean"},
            "week_start": {"type": "string", "enum": ["monday", "sunday"]},
            "money_period": {"type": "string", "enum": ["week", "day", "all"]},
            "display_name": {"type": "string", "description": "The name the app shows for the user."}}}}},
]
SETTINGS_NAMES = {t["function"]["name"] for t in SETTINGS_TOOLS}
CANNOT = "The email address, password, two-step sign-in, sessions and deleting or exporting data can only be changed by the user on the Profile page."


async def dispatch_settings(srv, db, user, name, args, created, ctx=None, session_id=None, previewed=None):
    uid = user["_id"]
    db_user = (await db.execute(select(User).where(User.id == uid))).scalar_one()
    prefs, saved = await profile_api.read_preferences(db, uid)
    if name == "get_settings":
        return {"settings": {**prefs, "display_name": db_user.name}, "options": profile_api.PREFERENCE_OPTIONS, "not_changeable_here": CANNOT}
    # update_settings
    wanted = {k: v for k, v in (args or {}).items() if k != "display_name" and v is not None}
    display = args.get("display_name")
    if not wanted and display is None:
        return {"error": "Say which setting to change.", "options": profile_api.PREFERENCE_OPTIONS}
    try:
        changes = profile_api.clean_changes(wanted)
    except ValueError as exc:
        return {"error": str(exc)}
    new_name = None
    if display is not None:
        new_name = " ".join(str(display).split())
        if not new_name or len(new_name) > profile_api.NAME_MAX:
            return {"error": f"The display name must be 1 to {profile_api.NAME_MAX} characters."}
    if changes:
        created.append({"collection": "user_preferences", "id": uid, "before": {**prefs, "user_id": uid, "saved": saved}})
        prefs = await profile_api.save_preferences(db, uid, changes, srv.now_iso())
    if new_name is not None and new_name != db_user.name:
        created.append({"collection": "user_name", "id": uid, "before": {"name": db_user.name, "user_id": uid}})
        db_user.name = new_name
        await db.commit()
    return {"ok": True, "settings": {**prefs, "display_name": db_user.name}, "changed": sorted(list(changes) + (["display_name"] if new_name is not None else []))}
