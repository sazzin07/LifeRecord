"""Time the heavy pages against two years of history (roadmap D-07). Not a test: a measuring tool.

    python tests/isolated_env.py serve                       # in one terminal: a throw-away stack
    python tests/isolated_env.py run -- python tests/perf_probe.py        # in another: seed it, then time it

It only ever writes to a scratch schema (isolated_env's name guard), never to the real database. The history it adds to
the test account: about 3,650 expenses over 730 days (each with its split), 600 grocery items and 4,000 price records.
"""
import json
import os
import random
import statistics
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import requests

import isolated_env as ie
from support_history import seed


def timed(session, base, path, runs=5):
    ms, size = [], 0
    for _ in range(runs):
        t = time.perf_counter()
        r = session.get(base + path, timeout=120)
        ms.append((time.perf_counter() - t) * 1000)
        assert r.status_code == 200, (path, r.status_code, r.text[:120])
        size = len(r.content)
    return {"path": path, "median_ms": round(statistics.median(ms)), "max_ms": round(max(ms)), "kb": round(size / 1024, 1)}


def main() -> int:
    name = os.environ["DATABASE_NAME"]
    ie.assert_scratch_name(name)  # refuses the real schema, whatever else is set
    base = os.environ["API_URL"].rstrip("/") + "/api"
    s = requests.Session()
    login = requests.post(base + "/auth/login", json={"email": os.environ["TEST_EMAIL"], "password": os.environ["TEST_PASSWORD"]}, timeout=30).json()
    s.headers["Authorization"] = "Bearer " + login["token"]
    from urllib.parse import quote_plus
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session
    user, password = ie.admin_credentials()
    engine = create_engine(f"mysql+pymysql://{quote_plus(user)}:{quote_plus(password)}@127.0.0.1/{name}")
    with Session(engine) as db:
        user_id = db.execute(text("SELECT id FROM users WHERE email=:e"), {"e": os.environ["TEST_EMAIL"]}).scalar()
        account_id = db.execute(text("SELECT id FROM accounts WHERE user_id=:u AND type='bank' LIMIT 1"), {"u": user_id}).scalar()
        print("seeded:", seed(db, user_id, account_id))
    engine.dispose()
    month = date.today().strftime("%Y-%m")
    results = [timed(s, base, p) for p in (
        "/analytics/summary", f"/analytics/summary?month={month}", "/transactions", f"/transactions?month={month}", "/categories",
        "/groceries", "/shopping", "/calendar?start=" + (date.today() - timedelta(days=30)).isoformat() + "&end=" + date.today().isoformat())]
    print(json.dumps(results, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
