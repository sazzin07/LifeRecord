"""D-07: the Money page must stay quick when an account has two years of history.

With 3,650 expenses, the summary used to take 1.2 s for one month (2.4 s for all time) on John's nine accounts, because every
account balance loaded every transaction as an object, three times, in Python loops. Balances are now SQL sums. The budgets
below keep generous headroom for a slow machine; they exist to catch a return of that behaviour, not to benchmark."""
import os
import time

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from urllib.parse import quote_plus

import isolated_env as ie
from support_history import seed
from support_users import api, create_verified_user

pytestmark = pytest.mark.skipif(os.environ.get("LR_ISOLATED") != "1", reason="seeds thousands of rows: scratch schema only")


@pytest.fixture(scope="module")
def heavy_user():
    user = create_verified_user("perf")
    account = user["session"].post(api(user, "/accounts"), json={"name": "Bank", "type": "bank", "opening_balance": 1000}).json()
    name = os.environ["DATABASE_NAME"]
    ie.assert_scratch_name(name)
    login, password = ie.admin_credentials()
    engine = create_engine(f"mysql+pymysql://{quote_plus(login)}:{quote_plus(password)}@127.0.0.1/{name}")
    with Session(engine) as db:
        seed(db, user["id"], account["id"], transactions=3650)
        expected = db.execute(text("SELECT COALESCE(SUM(gross_amount),0) FROM transactions WHERE user_id=:u AND type='expense' AND paid_by='me' AND account=:a"),
                              {"u": user["id"], "a": account["id"]}).scalar()
    engine.dispose()
    return {**user, "account": account["id"], "spent": float(expected)}


def _median_ms(user, path, runs=3):
    times = []
    for _ in range(runs):
        t = time.perf_counter()
        r = user["session"].get(api(user, path), timeout=60)
        times.append((time.perf_counter() - t) * 1000)
        assert r.status_code == 200, r.text[:200]
    return sorted(times)[len(times) // 2]


def test_the_balance_still_adds_up_after_two_years_of_history(heavy_user):
    accounts = {a["id"]: a for a in heavy_user["session"].get(api(heavy_user, "/accounts"), timeout=60).json()}
    assert accounts[heavy_user["account"]]["balance"] == round(1000 - heavy_user["spent"], 2)


@pytest.mark.parametrize("path,budget_ms", [
    ("/analytics/summary?month=2026-11", 400),     # before the fix: 399 ms with one account, 1,229 ms with John's nine; after: 85 ms
    ("/analytics/summary", 1200),                   # before: 787 ms / 2,449 ms; after: 442 ms (it still reads every transaction for its charts)
    ("/accounts", 150),                             # before: 336 ms; after: 27 ms
    ("/transactions?month=2026-11", 400),           # 13 ms
])
def test_the_money_endpoints_stay_inside_their_time_budget(heavy_user, path, budget_ms):
    took = _median_ms(heavy_user, path)
    print(f"PERF {path}: {took:.0f} ms (budget {budget_ms})")
    assert took < budget_ms
