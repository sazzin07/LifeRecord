"""The standard testing account (John, seeded by seed_john.py) covers every module the app has, so tests and
browser specs that read "John's data" are not silently testing empty pages."""
import pymysql

import support_db
from support_auth import BASE_URL, OWNER_EMAIL, session


def _john():
    return session(OWNER_EMAIL)


def test_john_has_exactly_one_of_each_category():
    cats = _john().get(f"{BASE_URL}/api/categories", timeout=20).json()
    names = [c["name"] for c in cats]
    assert len(names) == len(set(names)) == 13, names  # the starter set and the seed must not double up


def test_john_has_progress_photos_that_can_be_opened():
    s = _john()
    photos = s.get(f"{BASE_URL}/api/photos", timeout=20).json()
    assert len(photos) >= 3 and all(p["note"].startswith("[SAMPLE]") for p in photos)
    for p in photos:
        r = s.get(f"{BASE_URL}{p['url']}", timeout=20)  # stored encrypted, served decrypted to the owner only
        assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_john_has_assistant_action_history_that_is_not_undoable():
    conn = support_db.connect(cursorclass=pymysql.cursors.DictCursor)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT a.label, a.undoable FROM ai_actions a JOIN users u ON u.id = a.user_id WHERE u.email = %s", (OWNER_EMAIL,))
            rows = cur.fetchall()
    finally:
        conn.close()
    sample = [r for r in rows if r["label"].startswith("[SAMPLE]")]  # other tests also act as John; only the sample rows are the seed's
    assert len(sample) >= 3
    assert not any(r["undoable"] for r in sample)  # sample history must never be able to delete real records
