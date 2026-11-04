"""Currency per account (F-09): the list, account rules, transfers between currencies, per-currency totals. Nothing is ever converted."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import currencies  # noqa: E402
from support_populate import _post, _put, _tag  # noqa: E402
from support_users import api, create_verified_user  # noqa: E402


def test_the_list_is_iso_shaped_and_normalises_codes():
    assert currencies.normalize(" usd ") == "USD" and currencies.currency_digits("JPY") == 0 and currencies.currency_digits("KWD") == 3
    assert currencies.is_currency("eur") and not currencies.is_currency("XXXX") and not currencies.is_currency("")
    with pytest.raises(ValueError):
        currencies.normalize("ZZZ")
    assert len(currencies.CURRENCIES) > 140 and all(len(c) == 3 and c.isupper() for c in currencies.CURRENCIES)


@pytest.fixture()
def me():
    return create_verified_user("curr")


def get(user, path):
    r = user["session"].get(api(user, path), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def main_account(user, type_, currency="EUR", balance=100):
    return _post(user, "/accounts", {"name": f"{type_} {_tag()}", "type": type_, "currency": currency, "opening_balance": balance})["id"]


def acc(user, aid):
    return next(a for a in get(user, "/accounts") if a["id"] == aid)


def place_of(user, main_id):
    return next(a for a in get(user, "/accounts") if a.get("parent_id") == main_id)


def test_currency_is_stored_normalised_validated_and_inherited_by_places(me):
    usd = main_account(me, "cash", "usd")
    assert acc(me, usd)["currency"] == "USD"
    bad = me["session"].post(api(me, "/accounts"), json={"name": "x", "type": "cash", "currency": "XXXX", "opening_balance": 0}, timeout=30)
    assert bad.status_code == 422
    sub = _post(me, "/accounts", {"name": "Envelope", "type": "cash_place", "parent_id": usd, "currency": "JPY", "opening_balance": 0})
    assert sub["currency"] == "USD"                         # a place always uses its main account's currency
    assert place_of(me, usd)["currency"] == "USD"


def test_changing_a_main_accounts_currency_changes_its_places_and_is_refused_after_a_crossing_transfer(me):
    cash = main_account(me, "cash", "EUR")
    _post(me, "/accounts", {"name": "Wallet", "type": "cash_place", "parent_id": cash, "opening_balance": 0})
    _put(me, f"/accounts/{cash}", {"currency": "gbp"})
    assert acc(me, cash)["currency"] == "GBP" and all(a["currency"] == "GBP" for a in get(me, "/accounts") if a.get("parent_id") == cash)
    other = main_account(me, "revolut", "USD", 0)
    _post(me, "/accounts/transfer", {"from_account_id": cash, "to_account_id": other, "amount": 10, "to_amount": 13})
    r = me["session"].put(api(me, f"/accounts/{cash}"), json={"currency": "EUR"}, timeout=30)
    assert r.status_code == 409 and "currency" in r.text.lower()


def test_a_transfer_between_currencies_moves_both_amounts_and_deleting_it_restores_them(me):
    eur = main_account(me, "bank", "EUR", 500)
    usd = main_account(me, "revolut", "USD", 0)
    before_eur, before_usd = acc(me, eur)["balance"], acc(me, usd)["balance"]
    done = _post(me, "/accounts/transfer", {"from_account_id": eur, "to_account_id": usd, "amount": 100, "to_amount": 108})
    assert done["transaction"]["to_amount"] == 108
    assert acc(me, eur)["balance"] == before_eur - 100 and acc(me, usd)["balance"] == before_usd + 108
    listed = next(t for t in get(me, "/transactions") if t["id"] == done["transaction"]["id"])
    assert listed["currency"] == "EUR" and listed["to_currency"] == "USD"
    assert me["session"].delete(api(me, f"/transactions/{done['transaction']['id']}"), timeout=30).status_code == 200
    assert acc(me, eur)["balance"] == before_eur and acc(me, usd)["balance"] == before_usd


@pytest.mark.parametrize("patch", [{}, {"to_amount": 0}, {"to_amount": -5}])
def test_a_crossing_transfer_without_the_arriving_amount_is_refused(me, patch):
    eur, usd = main_account(me, "bank", "EUR", 100), main_account(me, "revolut", "USD", 0)
    r = me["session"].post(api(me, "/accounts/transfer"), json={"from_account_id": eur, "to_account_id": usd, "amount": 10, **patch}, timeout=30)
    assert r.status_code == 422, r.text
    assert acc(me, eur)["balance"] == 100


def test_a_same_currency_transfer_ignores_to_amount(me):
    a, b = main_account(me, "bank", "EUR", 100), main_account(me, "revolut", "EUR", 0)
    done = _post(me, "/accounts/transfer", {"from_account_id": a, "to_account_id": b, "amount": 10, "to_amount": 99})
    assert done["transaction"]["to_amount"] is None and acc(me, b)["balance"] == 10


def test_the_summary_has_one_total_per_currency_only_when_there_are_several(me):
    bank = main_account(me, "bank", "EUR", 300)
    s = get(me, "/analytics/summary")
    assert s["main_currency"] == "EUR" and "by_currency" not in s       # one currency: the same shape as always
    main_account(me, "revolut", "USD", 50)
    s = get(me, "/analytics/summary")
    rows = {r["currency"]: r for r in s["by_currency"]}
    assert set(rows) == {"EUR", "USD"} and rows["USD"]["total_available"] == 50 and rows["EUR"]["total_available"] == 300
    assert s["total_available"] == 300                                  # the legacy figure is the main currency's, never a mixed sum
    assert acc(me, bank)["currency"] == "EUR"


def test_spending_in_another_currency_stays_out_of_the_main_totals(me):
    eur, usd = main_account(me, "bank", "EUR", 100), main_account(me, "revolut", "USD", 100)
    _post(me, "/transactions/expense", {"amount": 10, "account": eur, "category": "Other", "description": "a"})
    _post(me, "/transactions/expense", {"amount": 25, "account": usd, "category": "Other", "description": "b"})
    s = get(me, "/analytics/summary")
    assert s["gross"] == 10 and s["spent_other_currencies"] == {"USD": 25.0}


def test_the_summary_still_lists_every_account_whatever_its_currency(me):
    main_account(me, "bank", "EUR", 10)
    usd = main_account(me, "revolut", "USD", 5)
    s = get(me, "/analytics/summary")
    assert usd in {a["id"] for a in s["accounts"]}
