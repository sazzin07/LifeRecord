"""S-11: a person can take their data with them and can remove their account, completely.

Both are checked against an account that has used EVERYTHING (support_populate fills a row in every user-owned table),
so a table added later that the export or the removal forgot will fail here, not in front of a real person."""
import hashlib
import io
import json
import os
import time
import zipfile
from pathlib import Path

import requests

from support_auth import BASE_URL
from support_populate import _db, populate
from support_users import api, create_verified_user

BACKEND = Path(__file__).resolve().parents[1]
STORAGE = Path(os.environ.get("STORAGE_DIR") or BACKEND / "storage")
PHRASE = "DELETE MY ACCOUNT"


def _export(user):
    r = user["session"].get(api(user, "/account/export"), timeout=60)
    assert r.status_code == 200, r.text[:300]
    return r, zipfile.ZipFile(io.BytesIO(r.content))


def _user_tables():
    from account_data import user_tables
    return user_tables()


def _count(table, user_id):
    from account_data import OWNED_THROUGH_PARENT
    if table in OWNED_THROUGH_PARENT:
        col, parent = OWNED_THROUGH_PARENT[table]
        sql, params = f"SELECT COUNT(*) AS n FROM `{table}` WHERE `{col}` IN (SELECT id FROM `{parent}` WHERE user_id=%s)", (user_id,)
    else:
        sql, params = f"SELECT COUNT(*) AS n FROM `{table}` WHERE user_id=%s", (user_id,)
    return _db(sql, params, fetch=True)[0]["n"]


def _delete(user, password=None, confirm=PHRASE):
    return user["session"].delete(api(user, "/account"), json={"password": password or user["password"], "confirm": confirm}, timeout=60)


# -- which tables count as "a person's data" ------------------------------------------------------------------------------

def test_the_table_list_comes_from_the_models_and_the_cleanup_tool_covers_all_of_it():
    from models import Base
    import cleanup_account
    expected = {t for t, table in Base.metadata.tables.items() if "user_id" in table.c} | {"splits"}
    assert set(_user_tables()) == expected
    assert set(cleanup_account.ORDER) == expected, f"cleanup_account.py misses: {sorted(expected - set(cleanup_account.ORDER))}"
    # children before parents, so rows can be removed one table at a time
    order = _user_tables()
    assert order.index("splits") < order.index("transactions") and order.index("ai_messages") < order.index("ai_conversations")


# -- export ---------------------------------------------------------------------------------------------------------------

def test_the_export_holds_every_table_with_data_and_no_secret():
    user = create_verified_user("export")
    populate(user)
    r, zf = _export(user)
    assert r.headers["content-type"] == "application/zip" and "attachment" in r.headers["content-disposition"]
    data = json.loads(zf.read("data.json"))
    expected = set(_user_tables()) - {"ai_pending_confirmations", "auth_sessions", "auth_session_info", "account_deactivations", "totp_credentials", "totp_recovery_codes",
                                           "webauthn_credentials", "webauthn_challenges", "sms_factors", "sms_codes"}  # internal: short-lived state, sign-in sessions, the on/off switch
    assert expected <= set(data["tables"]), sorted(expected - set(data["tables"]))
    empty = sorted(t for t in expected if not data["tables"][t])
    assert empty == [], f"populate() filled these but the export has no rows: {empty}"
    assert data["account"]["email"] == user["email"] and data["account"]["name"] == user["name"]
    text = zf.read("data.json").decode("utf-8")
    for secret in ("password_hash", "$2b$", "code_hash", "verification_code", user["token"], user["password"]):
        assert secret not in text, f"the export contains {secret!r}"
    assert set(data["account"]) == {"id", "email", "name", "role", "email_verified", "created_at"}


def test_the_export_includes_the_pictures_decrypted():
    user = create_verified_user("export")
    made = populate(user)
    _, zf = _export(user)
    names = zf.namelist()
    photo = [n for n in names if n.startswith("files/") and made["photo"]["file"] in n]
    assert photo, names
    assert zf.read(photo[0])[:8] == b"\x89PNG\r\n\x1a\n"  # stored encrypted, exported as the picture itself


def test_the_export_holds_only_the_callers_data():
    a, b = create_verified_user("export"), create_verified_user("export")
    populate(a)
    made_b = populate(b)
    _, zf = _export(a)
    text = zf.read("data.json").decode("utf-8")
    assert b["id"] not in text and b["email"] not in text
    assert all(str(v) not in text for ids in made_b.values() for v in ids.values() if isinstance(v, str) and len(v) == 36)


def test_exports_are_limited():
    user = create_verified_user("export")
    codes = [user["session"].get(api(user, "/account/export"), timeout=60).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


# -- deletion -------------------------------------------------------------------------------------------------------------

def test_a_wrong_password_or_missing_phrase_deletes_nothing():
    user = create_verified_user("export")
    populate(user)
    before = {t: _count(t, user["id"]) for t in _user_tables()}
    assert _delete(user, password="not-the-password").status_code == 400
    assert _delete(user, confirm="delete my account").status_code == 400  # the phrase is exact
    assert _delete(user, confirm="").status_code in (400, 422)
    assert {t: _count(t, user["id"]) for t in _user_tables()} == before
    assert user["session"].get(api(user, "/auth/me"), timeout=20).status_code == 200


def test_the_owner_account_cannot_be_deleted_from_the_app():
    user = create_verified_user("export")
    _db("UPDATE users SET role='owner' WHERE id=%s", (user["id"],))
    try:
        r = _delete(user)
        assert r.status_code == 403 and "owner" in r.json()["detail"].lower()
        assert _db("SELECT COUNT(*) AS n FROM users WHERE id=%s", (user["id"],), fetch=True)[0]["n"] == 1
    finally:
        _db("UPDATE users SET role='user' WHERE id=%s", (user["id"],))  # never leave a second owner behind


def test_deleting_removes_every_row_and_every_file_and_touches_nobody_else():
    user, other = create_verified_user("export"), create_verified_user("export")
    made = populate(user)
    populate(other)
    folder = STORAGE / "chat_images" / user["id"]
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "leftover.bin").write_bytes(b"x")
    photo_rel = _db("SELECT storage_path FROM photos WHERE user_id=%s", (user["id"],), fetch=True)[0]["storage_path"]
    assert (STORAGE / photo_rel).is_file()
    tables = _user_tables()
    assert all(_count(t, user["id"]) > 0 for t in tables), [t for t in tables if not _count(t, user["id"])]
    others_before = {t: _count(t, other["id"]) for t in tables}
    shared_foods = _db("SELECT COUNT(*) AS n FROM foods WHERE user_id IS NULL", fetch=True)[0]["n"]

    r = _delete(user)
    assert r.status_code == 200, r.text
    removed = r.json()["removed"]
    assert removed["transactions"] >= 1 and removed["photos"] >= 1 and removed["foods"] >= 1

    assert {t: _count(t, user["id"]) for t in tables} == {t: 0 for t in tables}
    assert _db("SELECT COUNT(*) AS n FROM users WHERE id=%s", (user["id"],), fetch=True)[0]["n"] == 0
    assert not (STORAGE / photo_rel).exists() and not folder.exists()
    assert {t: _count(t, other["id"]) for t in tables} == others_before
    assert _db("SELECT COUNT(*) AS n FROM foods WHERE user_id IS NULL", fetch=True)[0]["n"] == shared_foods
    assert "lr_refresh" in r.headers.get("set-cookie", "")  # the browser forgets its session too

    # the account is gone: the old session and the password no longer work
    assert user["session"].get(api(user, "/auth/me"), timeout=20).status_code == 401
    assert requests.post(f"{BASE_URL}/api/auth/login", json={"email": user["email"], "password": user["password"]}, timeout=20).status_code in (400, 401)
    assert made  # populate really ran for this user

    # a notice was handled in the background (the address is on a reserved domain, so it is recorded as skipped, not sent)
    digest = hashlib.sha256(user["email"].encode()).hexdigest()
    for _ in range(20):
        if _db("SELECT status FROM email_events WHERE purpose='security_notice' AND recipient_hash=%s", (digest,), fetch=True):
            break
        time.sleep(0.5)
    else:
        raise AssertionError("no security notice was recorded for the deleted account")


# -- the operator's tool: remove an account's data but keep the account ----------------------------------------------------

def test_the_cleanup_tool_empties_every_table_but_keeps_the_login():
    """cleanup_account.py used to miss the five nutrition tables, so `seed_john.py --reset` left old nutrition data behind."""
    import subprocess
    import sys
    user, other = create_verified_user("export"), create_verified_user("export")
    populate(user)
    populate(other)
    tables = _user_tables()
    others_before = {t: _count(t, other["id"]) for t in tables}
    dry = subprocess.run([sys.executable, str(BACKEND / "cleanup_account.py"), user["email"]], capture_output=True, text=True, cwd=BACKEND, timeout=120)
    assert dry.returncode == 0 and "dry run" in dry.stdout.lower()
    assert all(_count(t, user["id"]) > 0 for t in tables)  # a dry run changes nothing
    done = subprocess.run([sys.executable, str(BACKEND / "cleanup_account.py"), user["email"], "--apply"], capture_output=True, text=True, cwd=BACKEND, timeout=120)
    assert done.returncode == 0, done.stdout[-800:] + done.stderr[-800:]
    assert {t: _count(t, user["id"]) for t in tables} == {t: 0 for t in tables}
    assert _db("SELECT COUNT(*) AS n FROM users WHERE id=%s", (user["id"],), fetch=True)[0]["n"] == 1  # the login stays
    assert {t: _count(t, other["id"]) for t in tables} == others_before
