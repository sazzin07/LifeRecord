"""Unit tests for pure helpers in server.py (no running backend needed)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402  (loads backend/.env)
from server import cheapest_store, compute_shares, normalize_name, serialize_txn  # noqa: E402


# ---- normalize_name ----

def test_normalize_name_maps_my_aliases_to_me():
    for alias in ("me", "ME", " Me ", "eu", "Sá", "sa"):
        assert normalize_name(alias) == "Me"


def test_normalize_name_trims_other_names_and_keeps_case():
    assert normalize_name("  Ana Costa ") == "Ana Costa"


# ---- compute_shares ----

def test_equal_split_includes_me_even_when_not_listed():
    assert compute_shares(30.0, ["Ana", "Bruno"], [], "equal", None) == {"Me": 10.0, "Ana": 10.0, "Bruno": 10.0}


def test_equal_split_does_not_duplicate_me_under_an_alias():
    assert compute_shares(10.0, ["eu", "Ana"], [], "equal", None) == {"Me": 5.0, "Ana": 5.0}


def test_equal_split_rounds_each_share_to_cents():
    shares = compute_shares(10.0, ["Ana", "Bruno"], [], "equal", None)
    assert shares == {"Me": 3.33, "Ana": 3.33, "Bruno": 3.33}


def test_by_items_default_assignee_is_me_and_shared_items_are_divided():
    items = [{"price": 6.0, "assigned": ["Ana", "Bruno"]}, {"price": 4.0}]
    shares = compute_shares(10.0, ["Ana", "Bruno"], items, "items", None)
    assert shares == {"Me": 4.0, "Ana": 3.0, "Bruno": 3.0}


def test_by_items_adds_people_only_named_on_items():
    shares = compute_shares(8.0, [], [{"price": 8.0, "assigned": ["Carla"]}], "items", None)
    assert shares == {"Me": 0.0, "Carla": 8.0}


def test_exact_split_uses_the_given_amounts():
    shares = compute_shares(20.0, ["Ana"], [], "exact", {"Me": 12.5, "Ana": 7.5})
    assert shares == {"Me": 12.5, "Ana": 7.5}


def test_exact_split_without_amounts_falls_back_to_equal():
    assert compute_shares(20.0, ["Ana"], [], "exact", {}) == {"Me": 10.0, "Ana": 10.0}


def test_zero_shares_are_dropped_except_for_me():
    shares = compute_shares(10.0, ["Ana"], [], "exact", {"Ana": 10.0, "Bruno": 0})
    assert shares == {"Me": 0.0, "Ana": 10.0}


# ---- cheapest_store ----

def test_cheapest_store_picks_the_lowest_price():
    per_store = {"Lidl": {"price": 1.2, "date": "2026-10-01"}, "Aldi": {"price": 0.99, "date": "2026-10-05"}}
    assert cheapest_store(per_store) == {"store": "Aldi", "price": 0.99, "date": "2026-10-05"}


def test_cheapest_store_with_no_prices_is_none():
    assert cheapest_store({}) is None
    assert cheapest_store(None) is None


# ---- serialize_txn ----

def expense(**kw):
    base = {"id": "t1", "type": "expense", "account": "cash", "reimbursable_amount": 0, "splits": []}
    return {**base, **kw}


def test_non_expense_only_gets_a_payment_method():
    out = serialize_txn({"id": "i1", "type": "income", "account": "revolut"}, {})
    assert out == {"id": "i1", "type": "income", "account": "revolut", "payment_method": "card"}


def test_expense_without_reimbursement_is_personal():
    out = serialize_txn(expense(), {})
    assert out["refund_status"] == "personal"
    assert out["remaining_refund"] == 0 and out["amount_refunded"] == 0
    assert out["payment_method"] == "cash"


def test_expense_awaiting_reimbursement_is_pending_and_lists_who_owes():
    splits = [{"person_name": "Me", "amount": 5.0, "is_me": True}, {"person_name": "Ana", "amount": 5.0, "is_me": False},
              {"person_name": "Zero", "amount": 0.0, "is_me": False}]
    out = serialize_txn(expense(reimbursable_amount=5.0, splits=splits), {})
    assert out["refund_status"] == "pending"
    assert out["remaining_refund"] == 5.0
    assert out["responsible"] == ["Ana"]


def test_partial_and_settled_refund_status():
    partial = serialize_txn(expense(reimbursable_amount=10.0), {"t1": 4.0})
    assert (partial["refund_status"], partial["amount_refunded"], partial["remaining_refund"]) == ("partial", 4.0, 6.0)
    settled = serialize_txn(expense(reimbursable_amount=10.0), {"t1": 10.0})
    assert (settled["refund_status"], settled["remaining_refund"]) == ("settled", 0.0)


def test_refunds_above_the_reimbursable_amount_are_capped():
    out = serialize_txn(expense(reimbursable_amount=10.0), {"t1": 25.0})
    assert out["amount_refunded"] == 10.0 and out["refund_status"] == "settled"


def test_payment_method_follows_the_account_type_when_known():
    types = {"wallet": "cash_place", "bank1": "bank"}
    assert serialize_txn(expense(account="wallet"), {}, types)["payment_method"] == "cash"
    assert serialize_txn(expense(account="bank1"), {}, types)["payment_method"] == "card"
    # unknown account id falls back to the legacy rule
    assert serialize_txn(expense(account="cash"), {}, types)["payment_method"] == "cash"
    assert serialize_txn(expense(account=None), {}, types)["payment_method"] == "card"
