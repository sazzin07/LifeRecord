"""What people owe the user and what the user owes them: two independent balances per person, kept in cents.

A balance is the sum of three sources, per direction:
  they_owe (what the person owes me) = expense splits of expenses I paid, their share
                                       - payments they made to me (settlements "in")
                                       + ledger lines of that direction
  i_owe    (what I owe them)         = my share of expenses they paid
                                       - payments I made to them (settlements "out")
                                       + ledger lines of that direction
Expense splits and settlements already exist (the expense and payment features); the ledger (`debt_entries`) holds what is entered
by hand or by the assistant. The two directions are NEVER netted against each other.

The ledger is append-only. A correction, a clearing and an undo are new lines that cancel earlier ones, so the history always
explains the balance. Every function here changes the session only (flush, no commit) and raises DebtError for a refusal; the caller
holds the money lock, checks the idempotency key and commits, so an operation is all-or-nothing.
"""
import json
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional

from sqlalchemy import delete, func, select

from models import Account, DebtEntry, IdempotencyKey, Person, Settlement, Split, Transaction

THEY_OWE, I_OWE = "they_owe", "i_owe"
DIRECTIONS = (THEY_OWE, I_OWE)
CURRENCY = "EUR"
MAX_CENTS = 10_000_000_00  # €10,000,000: a typo's worth of protection
KEY_DAYS = 7


class DebtError(Exception):
    def __init__(self, message: str, status: int = 400, extra: Optional[dict] = None):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, extra or {}


def to_cents(value) -> int:
    return int((Decimal(str(value)) * 100).to_integral_value(rounding=ROUND_HALF_UP))


def money(cents: int, currency: str = CURRENCY) -> str:
    return f"€{cents / 100:,.2f}" if currency == "EUR" else f"{currency} {cents / 100:,.2f}"


async def main_currency(db, user_id: str) -> str:
    """The currency of the bank account (the first top-level one), else of the first top-level account, else EUR: where a debt is kept when
    no currency is named. Mirrors `server.main_currency_of`."""
    rows = (await db.execute(select(Account.type, Account.currency).where(Account.user_id == user_id, Account.parent_id.is_(None), Account.is_active == True)  # noqa: E712
                             .order_by(Account.sort_order, Account.created_at))).all()
    bank = next((r for r in rows if r[0] == "bank"), None) or (rows[0] if rows else None)
    return (bank[1] if bank else None) or CURRENCY


async def currencies_in_use(db, user_id: str) -> List[str]:
    """Every currency an account or a ledger line of this person-of-money uses, the main one first."""
    main = await main_currency(db, user_id)
    seen = {c for (c,) in (await db.execute(select(Account.currency).where(Account.user_id == user_id).distinct())).all() if c}
    seen |= {c for (c,) in (await db.execute(select(DebtEntry.currency).where(DebtEntry.user_id == user_id).distinct())).all() if c}
    return [main] + sorted(seen - {main})


_last_ms = 0


def now_ms() -> int:
    """Milliseconds since 1970, never the same twice in this process: ledger lines are ordered by it ("cleared before this one")."""
    global _last_ms
    _last_ms = max(int(time.time() * 1000), _last_ms + 1)
    return _last_ms


def _iso_ms(text: Optional[str]) -> int:
    try:
        dt = datetime.fromisoformat((text or "").replace("Z", "+00:00"))
        return int((dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp() * 1000)
    except ValueError:
        return 0


def _cents_of_sum(value) -> int:
    return to_cents(value or 0)


def _check_amount(cents: int, what: str = "amount") -> None:
    if cents <= 0:
        raise DebtError(f"The {what} must be more than zero.")
    if cents > MAX_CENTS:
        raise DebtError(f"That {what} is larger than anything this can hold ({money(MAX_CENTS)}). Check for a typo.")


def _direction(value: str) -> str:
    if value not in DIRECTIONS:
        raise DebtError("Say which way the debt goes: they owe me, or I owe them.")
    return value


def _opposite(direction: str) -> str:
    return I_OWE if direction == THEY_OWE else THEY_OWE


# -- balances ------------------------------------------------------------------------------------------------------------------

async def raw_balances(db, user_id: str, person_ids: Optional[List[str]] = None, currency: Optional[str] = None) -> Dict[str, Dict[str, int]]:
    """{person_id: {they_owe, i_owe}} in cents, straight from the three sources, for ONE currency (the main one unless named): a split or a
    payment counts in the currency of the account it went through (no account: the main currency), a ledger line in its own. A direction can
    be negative only when a payment was recorded for more than was owed (older data); `outstanding` is what is actually owed."""
    main = await main_currency(db, user_id)
    cur = (currency or main).upper()
    # a transaction or a payment with no account (or one that is gone) belongs to the main currency
    txn_cur = func.coalesce(Account.currency, main)
    out: Dict[str, Dict[str, int]] = defaultdict(lambda: {THEY_OWE: 0, I_OWE: 0})
    scope = (lambda col: col.in_(person_ids)) if person_ids else (lambda col: col.is_not(None))
    for pid, total in (await db.execute(
            select(Split.person_id, func.sum(Split.amount)).join(Transaction, Transaction.id == Split.transaction_id)
            .outerjoin(Account, Account.id == Transaction.account)
            .where(Transaction.user_id == user_id, Transaction.paid_by == "me", Split.is_me == False, scope(Split.person_id), txn_cur == cur)  # noqa: E712
            .group_by(Split.person_id))).all():
        out[pid][THEY_OWE] += _cents_of_sum(total)
    for pid, total in (await db.execute(
            select(Transaction.paid_by, func.sum(Split.amount)).join(Transaction, Transaction.id == Split.transaction_id)
            .outerjoin(Account, Account.id == Transaction.account)
            .where(Transaction.user_id == user_id, Split.is_me == True, Transaction.paid_by != "me", scope(Transaction.paid_by), txn_cur == cur)  # noqa: E712
            .group_by(Transaction.paid_by))).all():
        out[pid][I_OWE] += _cents_of_sum(total)
    for pid, direction, total in (await db.execute(
            select(Settlement.person_id, Settlement.direction, func.sum(Settlement.amount))
            .outerjoin(Account, Account.id == Settlement.account)
            .where(Settlement.user_id == user_id, scope(Settlement.person_id), func.coalesce(Settlement.currency, Account.currency, main) == cur).group_by(Settlement.person_id, Settlement.direction))).all():
        out[pid][THEY_OWE if direction == "in" else I_OWE] -= _cents_of_sum(total)
    for pid, direction, total in (await db.execute(
            select(DebtEntry.person_id, DebtEntry.direction, func.sum(DebtEntry.amount_cents))
            .where(DebtEntry.user_id == user_id, scope(DebtEntry.person_id), DebtEntry.currency == cur).group_by(DebtEntry.person_id, DebtEntry.direction))).all():
        out[pid][direction] += int(total or 0)
    return out


async def balance_of(db, user_id: str, person_id: str, currency: Optional[str] = None) -> Dict[str, int]:
    return dict((await raw_balances(db, user_id, [person_id], currency))[person_id])


async def all_balances_of(db, user_id: str, person_id: str) -> Dict[str, Dict[str, int]]:
    """{currency: {they_owe, i_owe}} for one person, every currency in use (the main one first)."""
    return {c: await balance_of(db, user_id, person_id, c) for c in await currencies_in_use(db, user_id)}


def outstanding(raw: Dict[str, int]) -> Dict[str, int]:
    return {d: max(raw[d], 0) for d in DIRECTIONS}


def view(raw: Dict[str, int], currency: str = CURRENCY) -> dict:
    """The balances as the API shows them: euros (floats, for display) next to the exact cents."""
    out = outstanding(raw)
    return {"they_owe": out[THEY_OWE] / 100, "i_owe": out[I_OWE] / 100, "they_owe_cents": out[THEY_OWE], "i_owe_cents": out[I_OWE],
            "currency": currency, "overpaid": {d: max(-raw[d], 0) / 100 for d in DIRECTIONS if raw[d] < 0}}


# -- people -------------------------------------------------------------------------------------------------------------------

async def get_person(db, user_id: str, person_id: str, include_archived: bool = True) -> Person:
    person = (await db.execute(select(Person).where(Person.id == person_id, Person.user_id == user_id))).scalar_one_or_none()
    if person is None or (person.archived and not include_archived):
        raise DebtError("Person not found", 404)
    return person


# -- writing lines ----------------------------------------------------------------------------------------------------------------

def _line(user_id: str, person: Person, direction: str, kind: str, cents: int, description: Optional[str], origin: str,
          target_type: Optional[str] = None, target_id: Optional[str] = None, settlement_id: Optional[str] = None, currency: str = CURRENCY) -> DebtEntry:
    at = now_ms()
    return DebtEntry(id=str(uuid.uuid4()), user_id=user_id, person_id=person.id, person_name=person.name, direction=direction, kind=kind,
                     amount_cents=cents, currency=currency, description=(description or "").strip()[:500] or None, origin=origin,
                     target_type=target_type, target_id=target_id, settlement_id=settlement_id, created_ms=at,
                     created_at=datetime.fromtimestamp(at / 1000, timezone.utc).isoformat())


async def adjust(db, user_id: str, person: Person, direction: str, op: str, *, amount=None, new_amount=None, description=None,
                 origin: str = "manual", line_type: Optional[str] = None, line_id: Optional[str] = None, currency: Optional[str] = None) -> dict:
    """add | reduce | correct | clear | clear_line. Returns {entries: [...], balances, message}. Nothing is written when it raises.
    `currency` is the ledger the change belongs to (the main currency when not named); a cleared line keeps its own."""
    who = person.name
    cur = (currency or await main_currency(db, user_id)).upper()
    if not (op == "clear" and direction == "both") and op != "clear_line":
        direction = _direction(direction)
    if op == "clear" and direction == "both":
        raw = await balance_of(db, user_id, person.id, cur)
        todo = {d: v for d, v in outstanding(raw).items() if v > 0}
        if not todo:
            raise DebtError(f"Nothing is owed between you and {who}: there is nothing to clear.")
        entries = [_line(user_id, person, d, "clear", -v, description, origin, "all", currency=cur) for d, v in todo.items()]
        db.add_all(entries)
        await db.flush()
        return _done(db, user_id, person, entries, f"Cleared {', '.join(_phrase(d, v, who, currency=cur) for d, v in todo.items())} (no payment recorded).")

    raw = await balance_of(db, user_id, person.id, cur)
    have = max(raw[direction], 0) if direction in DIRECTIONS else 0
    if op == "add":
        cents = to_cents(amount or 0)
        _check_amount(cents)
        entry = _line(user_id, person, direction, "add", cents, description, origin, currency=cur)
        msg = f"Added {money(cents, cur)}: {_phrase(direction, have + cents, who, currency=cur)}."
    elif op == "reduce":
        cents = to_cents(amount or 0)
        _check_amount(cents)
        if cents > have:
            raise DebtError(f"{_phrase(direction, have, who, short=True, currency=cur)}, so it cannot be reduced by {money(cents, cur)}. "
                            f"Reduce by up to {money(have, cur)}, or record it as a payment if money changed hands.",
                            extra={"outstanding_cents": have})
        entry = _line(user_id, person, direction, "reduce", -cents, description, origin, currency=cur)
        msg = f"Reduced by {money(cents, cur)}: {_phrase(direction, have - cents, who, currency=cur)}."
    elif op == "correct":
        target = to_cents(new_amount if new_amount is not None else -1)
        if target < 0 or target > MAX_CENTS:
            raise DebtError("Give the correct total as zero or more.")
        if target == have and raw[direction] == have:
            raise DebtError(f"That already is the balance: {_phrase(direction, have, who, currency=cur)}.")
        entry = _line(user_id, person, direction, "correct", target - raw[direction], description, origin, currency=cur)
        msg = f"Corrected to {money(target, cur)}: {_phrase(direction, target, who, currency=cur)}."
    elif op == "clear":
        if have <= 0:
            raise DebtError(f"{_phrase(direction, 0, who, short=True, currency=cur)}: there is nothing to clear.")
        entry = _line(user_id, person, direction, "clear", -have, description, origin, "all", currency=cur)
        msg = f"Cleared {_phrase(direction, have, who, short=True, currency=cur)} (no payment recorded)."
    elif op == "clear_line":
        cents, line_dir, cur = await _line_amount(db, user_id, person, line_type, line_id)
        raw = await balance_of(db, user_id, person.id, cur)      # a line is cleared in its own currency, whichever ledger was open
        direction = line_dir
        have = max(raw[direction], 0)
        cents = min(cents, have)
        if cents <= 0:
            raise DebtError("There is nothing left of that line to clear.")
        entry = _line(user_id, person, direction, "clear", -cents, description, origin, line_type, line_id, currency=cur)
        msg = f"Cleared {money(cents, cur)} from that line (no payment recorded)."
    else:
        raise DebtError("Unknown operation.")
    db.add(entry)
    await db.flush()
    return _done(db, user_id, person, [entry], msg)


def _phrase(direction: str, cents: int, who: str, short: bool = False, currency: str = CURRENCY) -> str:
    if direction == THEY_OWE:
        return f"{who} owes you {money(cents, currency)}"
    return f"you owe {who} {money(cents, currency)}"


def _done(db, user_id, person, entries, message):
    return {"entries": entries, "message": message}


async def _line_amount(db, user_id: str, person: Person, line_type: Optional[str], line_id: Optional[str]):
    """(cents, direction, currency) of a debt line that can be cleared on its own, after checking it is this person's and still counts."""
    currency = await main_currency(db, user_id)
    if line_type == "split":
        row = (await db.execute(select(Split, Transaction).join(Transaction, Transaction.id == Split.transaction_id)
                                .where(Split.id == line_id, Transaction.user_id == user_id))).first()
        if row is None:
            raise DebtError("That line was not found", 404)
        sp, txn = row
        if txn.paid_by == "me" and sp.person_id == person.id and not sp.is_me:
            direction = THEY_OWE
        elif sp.is_me and txn.paid_by == person.id:
            direction = I_OWE
        else:
            raise DebtError("That line was not found", 404)
        cents = to_cents(sp.amount)
        if txn.account:
            currency = (await db.execute(select(Account.currency).where(Account.id == txn.account, Account.user_id == user_id))).scalar_one_or_none() or currency
    elif line_type == "entry":
        entry = (await db.execute(select(DebtEntry).where(DebtEntry.id == line_id, DebtEntry.user_id == user_id, DebtEntry.person_id == person.id))).scalar_one_or_none()
        if entry is None or entry.kind not in ("add", "correct", "excess") or entry.amount_cents <= 0:
            raise DebtError("That line cannot be cleared on its own.")
        direction, cents, currency = entry.direction, entry.amount_cents, entry.currency or currency
    else:
        raise DebtError("Say which line to clear.")
    covered = {(e.target_type, e.target_id) for e in (await db.execute(select(DebtEntry).where(
        DebtEntry.user_id == user_id, DebtEntry.person_id == person.id, DebtEntry.kind.in_(("clear", "reversal"))))).scalars()}
    if (line_type, line_id) in covered:
        raise DebtError("That line was already cleared.")
    return cents, direction, currency


async def reverse(db, user_id: str, person: Person, entry_id: str, origin: str = "manual") -> dict:
    """Undo one ledger line by writing the opposite line. A line can be reversed once; a reversal cannot be reversed (undo = restore)."""
    entry = (await db.execute(select(DebtEntry).where(DebtEntry.id == entry_id, DebtEntry.user_id == user_id, DebtEntry.person_id == person.id))).scalar_one_or_none()
    if entry is None:
        raise DebtError("That entry was not found", 404)
    if entry.kind == "reversal":
        raise DebtError("An undo cannot be undone. Enter the debt again instead.")
    done = (await db.execute(select(DebtEntry.id).where(DebtEntry.user_id == user_id, DebtEntry.kind == "reversal", DebtEntry.target_id == entry.id))).first()
    if done:
        raise DebtError("That entry was already reversed.")
    raw = await balance_of(db, user_id, person.id, entry.currency)
    if raw[entry.direction] - entry.amount_cents < 0:
        raise DebtError(f"That cannot be undone now: later changes (such as a payment) need it. The balance would go below zero.")
    line = _line(user_id, person, entry.direction, "reversal", -entry.amount_cents, f"Reversed: {entry.description or entry.kind}", origin, "entry", entry.id, currency=entry.currency)
    db.add(line)
    await db.flush()
    return _done(db, user_id, person, [line], "Reversed.")


# -- payments ---------------------------------------------------------------------------------------------------------------------

async def payment_plan(db, user_id: str, person: Person, direction: str, amount_cents: int, currency: Optional[str] = None) -> dict:
    """How a payment of this size sits against what is owed: {outstanding, excess}. A payment above what is owed needs the person to
    say what the extra is (the opposite debt, or a tip/gift) before anything is recorded."""
    _check_amount(amount_cents)
    paid = THEY_OWE if direction == "in" else I_OWE
    cur = (currency or await main_currency(db, user_id)).upper()
    have = max((await balance_of(db, user_id, person.id, cur))[paid], 0)
    return {"paid_direction": paid, "outstanding_cents": have, "excess_cents": max(amount_cents - have, 0), "currency": cur}


def excess_lines(user_id: str, person: Person, plan: dict, choice: str, settlement_id: str, origin: str) -> List[DebtEntry]:
    """The ledger lines that settle the extra of an overpayment. "tip": the extra is a gift and creates no debt (the payment alone
    would have pushed the balance below zero, so a line brings it back to zero). "opposite": the same, plus a debt the other way."""
    extra, paid = plan["excess_cents"], plan["paid_direction"]
    cur = plan.get("currency", CURRENCY)
    lines = [_line(user_id, person, paid, "excess", extra, "Extra kept as a gift" if choice == "tip" else "Extra became a debt the other way", origin,
                   settlement_id=settlement_id, currency=cur)]
    if choice == "opposite":
        lines.append(_line(user_id, person, _opposite(paid), "excess", extra, "Extra paid, so the other side now owes it back", origin, settlement_id=settlement_id, currency=cur))
    return lines


async def undo_payment_lines(db, user_id: str, person: Person, settlement_id: str) -> None:
    """Deleting a payment also reverses the excess lines it made, by cancelling lines (nothing is erased)."""
    lines = (await db.execute(select(DebtEntry).where(DebtEntry.user_id == user_id, DebtEntry.settlement_id == settlement_id, DebtEntry.kind == "excess"))).scalars().all()
    for line in lines:
        if not (await db.execute(select(DebtEntry.id).where(DebtEntry.kind == "reversal", DebtEntry.target_id == line.id))).first():
            db.add(_line(user_id, person, line.direction, "reversal", -line.amount_cents, "Payment removed", "payment", "entry", line.id, currency=line.currency))
    await db.flush()


# -- history ---------------------------------------------------------------------------------------------------------------------

async def history(db, user_id: str, person: Person, account_names: Optional[dict] = None, currency: Optional[str] = None) -> dict:
    """Everything that makes up the balances, newest first: {items (what counts now), audit (cleared and reversed things)}.
    Each item has `effect_cents` (+ raises the balance of its direction, - lowers it) so the items add up to the balance."""
    names = account_names or {}
    main = await main_currency(db, user_id)
    cur = (currency or main).upper()
    acc_currency = {a_id: c for a_id, c in (await db.execute(select(Account.id, Account.currency).where(Account.user_id == user_id))).all()}
    in_cur = lambda account_id: (acc_currency.get(account_id) or main) == cur   # noqa: E731 - no account, or one that is gone: the main currency
    entries = (await db.execute(select(DebtEntry).where(DebtEntry.user_id == user_id, DebtEntry.person_id == person.id, DebtEntry.currency == cur))).scalars().all()
    reversed_ids = {e.target_id for e in entries if e.kind == "reversal"}
    active_clears = [e for e in entries if e.kind == "clear" and e.id not in reversed_ids]
    cut = {d: max([e.created_ms for e in active_clears if e.direction == d and e.target_type == "all"] or [0]) for d in DIRECTIONS}
    cleared_single = {(e.target_type, e.target_id): e.id for e in active_clears if e.target_type in ("entry", "split")}

    items: List[dict] = []

    def add(item):
        item["cleared"] = item["direction"] is not None and (item["at_ms"] <= cut.get(item["direction"], 0) or (item["ref_type"], item["ref_id"]) in cleared_single)
        item["clear_entry_id"] = cleared_single.get((item["ref_type"], item["ref_id"]))
        items.append(item)

    for sp, txn in (await db.execute(select(Split, Transaction).join(Transaction, Transaction.id == Split.transaction_id).where(
            Transaction.user_id == user_id, ((Split.person_id == person.id) & (Transaction.paid_by == "me") & (Split.is_me == False))  # noqa: E712
            | ((Split.is_me == True) & (Transaction.paid_by == person.id))))).all():  # noqa: E712
        if not in_cur(txn.account):
            continue
        direction = THEY_OWE if txn.paid_by == "me" else I_OWE
        cents = to_cents(sp.amount)
        add({"id": f"split:{sp.id}", "ref_type": "split", "ref_id": sp.id, "kind": "expense", "direction": direction, "effect_cents": cents,
             "label": txn.merchant or txn.description or txn.category or "Expense", "description": f"Share of an expense paid by {'you' if direction == THEY_OWE else person.name}",
             "origin": "expense", "date": txn.date, "at_ms": _iso_ms(sp.created_at) or _iso_ms(txn.created_at), "transaction_id": txn.id,
             "can_reverse": False, "can_clear": cents > 0})
    for s in (await db.execute(select(Settlement).where(Settlement.user_id == user_id, Settlement.person_id == person.id))).scalars():
        if (s.currency or acc_currency.get(s.account) or main) != cur:
            continue
        direction = THEY_OWE if s.direction == "in" else I_OWE
        where = names.get(s.account) or ("not recorded in your accounts" if not s.account else s.account)
        add({"id": f"payment:{s.id}", "ref_type": "settlement", "ref_id": s.id, "kind": "payment_in" if s.direction == "in" else "payment_out", "direction": direction,
             "effect_cents": -to_cents(s.amount), "label": "Payment received" if s.direction == "in" else "Payment made",
             "description": f"{s.method} · {where}", "origin": "payment", "date": s.date, "at_ms": _iso_ms(s.created_at), "settlement_id": s.id,
             "can_reverse": False, "can_clear": False})
    audit: List[dict] = []
    for e in entries:
        if e.kind == "clear" or e.kind == "reversal":
            audit.append({"id": e.id, "kind": e.kind, "direction": e.direction, "effect_cents": e.amount_cents, "label": "Cleared" if e.kind == "clear" else "Reversed",
                          "description": e.description, "origin": e.origin, "at_ms": e.created_ms, "state": "reversed" if e.id in reversed_ids else "active",
                          "can_restore": e.kind == "clear" and e.id not in reversed_ids})
            continue
        label = {"add": "Debt added", "reduce": "Debt reduced", "correct": "Balance corrected", "excess": "Extra from a payment"}[e.kind]
        item = {"id": f"entry:{e.id}", "ref_type": "entry", "ref_id": e.id, "kind": e.kind, "direction": e.direction, "effect_cents": e.amount_cents, "label": label,
                "description": e.description, "origin": e.origin, "date": e.created_at[:10], "at_ms": e.created_ms, "reversed": e.id in reversed_ids,
                "can_reverse": e.id not in reversed_ids, "can_clear": e.kind in ("add", "correct", "excess") and e.amount_cents > 0}
        add(item)
    visible = [i for i in items if not i["cleared"] and not i.get("reversed")]
    hidden = [i for i in items if i["cleared"] or i.get("reversed")]
    for i in hidden:
        audit.append({**i, "state": "reversed" if i.get("reversed") else "cleared"})
    visible.sort(key=lambda i: i["at_ms"], reverse=True)
    audit.sort(key=lambda i: i["at_ms"], reverse=True)
    return {"items": visible, "audit": audit}


# -- archive (delete a person) ---------------------------------------------------------------------------------------------------------

async def has_history(db, user_id: str, person_id: str) -> bool:
    for q in (select(Split.id).join(Transaction, Transaction.id == Split.transaction_id).where(Transaction.user_id == user_id, Split.person_id == person_id),
              select(Settlement.id).where(Settlement.user_id == user_id, Settlement.person_id == person_id),
              select(DebtEntry.id).where(DebtEntry.user_id == user_id, DebtEntry.person_id == person_id)):
        if (await db.execute(q.limit(1))).first():
            return True
    return False


async def archive(db, user_id: str, person: Person, clear_balances: bool = False, origin: str = "manual") -> dict:
    """Deleting a person keeps every record: they are archived (hidden, restorable). A person with a balance needs
    clear_balances=True (the screen shows the amounts first); their balances are then cleared (no payment) and kept in the audit list.
    A person with no history at all is removed outright."""
    main = await main_currency(db, user_id)
    by_cur = {c: {d: v for d, v in outstanding(raw).items() if v > 0} for c, raw in (await all_balances_of(db, user_id, person.id)).items()}
    by_cur = {c: o for c, o in by_cur.items() if o}
    owed = by_cur.get(main, {})
    if by_cur and not clear_balances:
        raise DebtError("They still have a balance: " + " and ".join(_phrase(d, v, person.name, currency=c) for c, o in by_cur.items() for d, v in o.items()) + ".", 409,
                        {"outstanding": {d: v / 100 for d, v in owed.items()}, "outstanding_cents": owed,
                         "other_currencies": {c: {d: v / 100 for d, v in o.items()} for c, o in by_cur.items() if c != main}})
    lines = [_line(user_id, person, d, "clear", -v, "Cleared when the person was deleted", origin, "all", currency=c) for c, o in by_cur.items() for d, v in o.items()]
    db.add_all(lines)
    if await has_history(db, user_id, person.id) or lines:
        person.archived = True
        await db.flush()
        return {"archived": True, "cleared": {d: v / 100 for d, v in owed.items()},
                "cleared_other_currencies": {c: {d: v / 100 for d, v in o.items()} for c, o in by_cur.items() if c != main}}
    await db.execute(delete(Person).where(Person.id == person.id, Person.user_id == user_id))
    await db.flush()
    return {"archived": False, "removed": True, "cleared": {}}


# -- idempotency -------------------------------------------------------------------------------------------------------------------------

async def remembered(db, user_id: str, key: Optional[str]) -> Optional[dict]:
    if not key:
        return None
    row = (await db.execute(select(IdempotencyKey).where(IdempotencyKey.user_id == user_id, IdempotencyKey.key == key[:120]))).scalar_one_or_none()
    return json.loads(row.response) if row else None


async def remember(db, user_id: str, key: Optional[str], response: dict) -> None:
    if not key:
        return
    db.add(IdempotencyKey(user_id=user_id, key=key[:120], response=json.dumps(response, default=str), created_ms=now_ms()))
    await db.execute(delete(IdempotencyKey).where(IdempotencyKey.user_id == user_id, IdempotencyKey.created_ms < now_ms() - KEY_DAYS * 86400 * 1000))
