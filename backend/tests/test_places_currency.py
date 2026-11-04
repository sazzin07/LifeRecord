"""A place with a currency of its own (F-09 follow-up): 10 EUR and 15 CHF in the same cash account, each shown as it is, nothing converted."""
import pytest

from support_populate import _post, _put, _tag
from support_users import api, create_verified_user


@pytest.fixture()
def me():
    user = create_verified_user("pcur")
    bank = _post(user, "/accounts", {"name": "Bank", "type": "bank", "currency": "EUR", "opening_balance": 200})["id"]
    cash = _post(user, "/accounts", {"name": "Hand", "type": "cash", "currency": "EUR", "opening_balance": 100})["id"]
    return {"u": user, "s": user["session"], "bank": bank, "cash": cash}


def get(me, path):
    r = me["s"].get(api(me["u"], path), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def acc(me, aid):
    return next(a for a in get(me, "/accounts") if a["id"] == aid)


def place(me, name, currency=None, balance=0, **kw):
    body = {"name": name, "type": "cash_place", "parent_id": me["cash"], "opening_balance": balance, **({"currency": currency} if currency else {}), **kw}
    return _post(me["u"], "/accounts", body)


def test_a_place_in_another_currency_holds_its_own_money_and_the_main_account_lists_it_apart(me):
    before = acc(me, me["cash"])
    chf = place(me, "Swiss envelope", "chf", 15)
    assert chf["currency"] == "CHF" and acc(me, chf["id"])["balance"] == 15
    main = acc(me, me["cash"])
    assert main["balance"] == before["balance"]                              # the main (EUR) figure did not take the 15 CHF
    assert main["other_balances"] == [{"currency": "CHF", "balance": 15.0}]
    eur_place = place(me, "Wallet", None, 10)                                # same currency: set aside out of the Default place, as before
    assert acc(me, eur_place["id"])["balance"] == 10 and acc(me, me["cash"])["balance"] == before["balance"]


def test_the_summary_counts_the_foreign_place_in_its_own_currency_only(me):
    place(me, "Swiss envelope", "chf", 15)
    s = get(me, "/analytics/summary")
    rows = {r["currency"]: r for r in s["by_currency"]}
    assert rows["CHF"]["cash_available"] == 15 and rows["CHF"]["total_available"] == 15
    assert rows["EUR"]["cash_available"] == 100 and s["total_available"] == 300          # EUR: 200 bank + 100 cash, no CHF in it


def test_money_moves_between_the_two_currencies_with_both_amounts(me):
    chf = place(me, "Swiss envelope", "chf", 15)
    eur_place = place(me, "Wallet", None, 10)
    r = me["s"].post(api(me["u"], "/accounts/transfer"), json={"from_account_id": eur_place["id"], "to_account_id": chf["id"], "amount": 10}, timeout=30)
    assert r.status_code == 422                                                           # the arriving CHF amount is asked for
    done = _post(me["u"], "/accounts/transfer", {"from_account_id": eur_place["id"], "to_account_id": chf["id"], "amount": 10, "to_amount": 9.6})
    assert done["transaction"]["to_amount"] == 9.6
    assert acc(me, eur_place["id"])["balance"] == 0 and acc(me, chf["id"])["balance"] == 24.6


def test_a_foreign_place_cannot_be_the_favourite_or_change_currency_after_money_moved(me):
    chf = place(me, "Swiss envelope", "chf", 15)
    r = me["s"].post(api(me["u"], f"/accounts/{chf['id']}/favorite"), timeout=30)
    assert r.status_code == 400 and "EUR" in r.text
    eur_place = place(me, "Wallet", None, 10)
    _post(me["u"], "/accounts/transfer", {"from_account_id": eur_place["id"], "to_account_id": chf["id"], "amount": 5, "to_amount": 5})
    r = me["s"].put(api(me["u"], f"/accounts/{chf['id']}"), json={"currency": "USD"}, timeout=30)
    assert r.status_code == 409


def test_deleting_a_foreign_place_needs_it_empty_when_no_other_place_shares_its_currency(me):
    chf = place(me, "Swiss envelope", "chf", 15)
    r = me["s"].delete(api(me["u"], f"/accounts/{chf['id']}"), timeout=30)
    assert r.status_code == 400 and "CHF" in r.text
    _put(me["u"], f"/accounts/{chf['id']}", {"balance": 0})
    assert me["s"].delete(api(me["u"], f"/accounts/{chf['id']}"), timeout=30).status_code == 200


def test_the_main_accounts_own_total_never_touches_a_foreign_place(me):
    chf = place(me, "Swiss envelope", "chf", 15)
    _put(me["u"], f"/accounts/{me['cash']}", {"balance": 150})                           # a deposit to the main account (EUR)
    assert acc(me, me["cash"])["balance"] == 150 and acc(me, chf["id"])["balance"] == 15


def test_changing_the_main_currency_changes_only_the_places_that_shared_it(me):
    chf = place(me, "Swiss envelope", "chf", 15)
    wallet = place(me, "Wallet", None, 10)
    _put(me["u"], f"/accounts/{me['cash']}", {"currency": "GBP"})
    assert acc(me, me["cash"])["currency"] == "GBP" and acc(me, wallet["id"])["currency"] == "GBP" and acc(me, chf["id"])["currency"] == "CHF"


def test_more_than_one_main_account_of_a_kind_with_their_own_currencies(me):
    savings = _post(me["u"], "/accounts", {"name": "Savings", "type": "bank", "currency": "CHF", "opening_balance": 40})["id"]
    second_cash = _post(me["u"], "/accounts", {"name": "Trip cash", "type": "cash", "currency": "EUR", "opening_balance": 25})["id"]
    names = {a["name"] for a in get(me, "/accounts") if not a.get("parent_id")}
    assert {"Bank", "Hand", "Savings", "Trip cash"} <= names
    assert acc(me, savings)["currency"] == "CHF" and acc(me, second_cash)["balance"] == 25
    s = get(me, "/analytics/summary")
    assert s["main_currency"] == "EUR"                                                    # the first bank keeps defining it
    rows = {r["currency"]: r for r in s["by_currency"]}
    assert rows["CHF"]["bank"] == 40 and rows["EUR"]["cash_available"] == 125            # both cash accounts count in EUR
    assert me["s"].delete(api(me["u"], f"/accounts/{second_cash}"), timeout=30).status_code in (200, 400)
