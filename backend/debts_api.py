"""The routes for the two debt balances of each person (see debts.py): overview, a person's balances and history, the adjustments
(add, reduce, correct, clear), payments, undo, archive and restore.

Every route that changes something takes the user's money lock, honours an `Idempotency-Key` header (a repeat returns the first
answer instead of changing anything twice) and commits once, so it either happens completely or not at all. The assistant calls
the same functions (`ai_tools_people.py`): there is one set of rules, not one for the screen and one for the chat.

Registered like the other domain modules (`register(api_router, server_module)`).
"""
from decimal import Decimal
from typing import Optional

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

import debts
from models import Account, DebtEntry, Person, Settlement, Transaction

DEBT_OPS = ("add", "reduce", "correct", "clear", "clear_line")


class DebtBody(BaseModel):
    direction: Optional[str] = Field(default=None, max_length=10)          # they_owe | i_owe (| both, for clear)
    amount: Optional[float] = Field(default=None, gt=0, le=10_000_000)
    new_amount: Optional[float] = Field(default=None, ge=0, le=10_000_000)  # correct: what the balance should be
    description: Optional[str] = Field(default=None, max_length=500)
    line_type: Optional[str] = Field(default=None, max_length=8)           # clear_line: split | entry
    line_id: Optional[str] = Field(default=None, max_length=36)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)   # the ledger to change; the main currency when not named


class PaymentBody(BaseModel):
    direction: str = Field(..., pattern="^(in|out)$")                      # in: they paid me, out: I paid them
    amount: float = Field(..., gt=0, le=10_000_000)
    method: Optional[str] = Field(default=None, max_length=50)
    account: Optional[str] = Field(default=None, max_length=255)           # none: not recorded in any of my accounts
    excess: Optional[str] = Field(default=None, pattern="^(tip|opposite)$")
    description: Optional[str] = Field(default=None, max_length=500)
    date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)   # without an account: the ledger it counts in (an account decides it otherwise)


class ArchiveBody(BaseModel):
    clear_balances: bool = False


def entry_view(e: DebtEntry) -> dict:
    return {"id": e.id, "direction": e.direction, "kind": e.kind, "amount": e.amount_cents / 100, "amount_cents": e.amount_cents,
            "description": e.description, "origin": e.origin, "created_at": e.created_at}


def item_view(i: dict) -> dict:
    return {**i, "effect": i["effect_cents"] / 100}


def _other_totals(people: list) -> list:
    """What is owed in each currency other than the main one, across everyone: [{currency, they_owe, i_owe}]."""
    totals: dict = {}
    for p in people:
        for o in p.get("other_currencies", []):
            t = totals.setdefault(o["currency"], {"currency": o["currency"], "they_owe": 0.0, "i_owe": 0.0})
            t["they_owe"] = round(t["they_owe"] + o["owes_me"], 2)
            t["i_owe"] = round(t["i_owe"] + o["i_owe"], 2)
    return sorted(totals.values(), key=lambda t: t["currency"])


def register(api_router, srv):
    def refuse(e: "debts.DebtError"):
        raise HTTPException(e.status, e.message)

    async def person_of(db, user, pid: str, archived_ok: bool = True) -> Person:
        try:
            return await debts.get_person(db, user["_id"], pid, include_archived=archived_ok)
        except debts.DebtError as e:
            refuse(e)

    async def write(request: Request, user: dict, db: AsyncSession, work):
        """The shape of every change: lock, repeat check, the work, one commit. `work(before)` returns the answer (a dict); an answer
        with `pending` set (a question for the person) is not remembered and changes nothing."""
        uid = user["_id"]
        before = await srv.money_begin(db, uid)
        key = request.headers.get("Idempotency-Key")
        prior = await debts.remembered(db, uid, key)
        if prior is not None:
            await db.rollback()
            return {**prior, "duplicate": True}
        try:
            result = await work(before)
        except debts.DebtError as e:
            await db.rollback()
            refuse(e)
        except HTTPException:
            await db.rollback()
            raise
        if not result.get("pending"):
            await debts.remember(db, uid, key, result)
            await db.commit()
        else:
            await db.rollback()
        return result

    async def answer(db, user, person: Person, message: str, entries=None, currency=None, **extra) -> dict:
        uid = user["_id"]
        cur = (currency or (entries[0].currency if entries else None) or await debts.main_currency(db, uid)).upper()
        raw = await debts.balance_of(db, uid, person.id, cur)
        res = {"ok": True, "message": message, "person": {"id": person.id, "name": person.name}, "balances": debts.view(raw, cur),
               "entries": [entry_view(e) for e in (entries or [])], **extra}
        others = [{**debts.view(r, c)} for c, r in (await debts.all_balances_of(db, uid, person.id)).items() if c != await debts.main_currency(db, uid) and any(v > 0 for v in debts.outstanding(r).values())]
        if others:
            res["other_currencies"] = others
        return res

    # -- reading --------------------------------------------------------------------------------------------------------------

    @api_router.get("/debts/overview")
    async def overview(user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Totals across everyone and the latest activity. The two totals are separate sums: money owed to the user and money the
        user owes, never one netted figure."""
        uid = user["_id"]
        people = await srv.people_balances(db, uid)
        names = {p["id"]: p["name"] for p in people}
        events = []
        for e in (await db.execute(select(DebtEntry).where(DebtEntry.user_id == uid, DebtEntry.kind.in_(("add", "reduce", "correct", "clear")))
                                   .order_by(desc(DebtEntry.created_ms)).limit(12))).scalars():
            events.append({"at_ms": e.created_ms, "person_id": e.person_id, "person": e.person_name, "direction": e.direction, "kind": e.kind,
                           "amount": abs(e.amount_cents) / 100, "description": e.description, "origin": e.origin})
        for s in (await db.execute(select(Settlement).where(Settlement.user_id == uid).order_by(desc(Settlement.created_at)).limit(12))).scalars():
            events.append({"at_ms": debts._iso_ms(s.created_at), "person_id": s.person_id, "person": s.person_name,
                           "direction": debts.THEY_OWE if s.direction == "in" else debts.I_OWE,
                           "kind": "payment_in" if s.direction == "in" else "payment_out", "amount": float(s.amount), "description": s.method, "origin": "payment"})
        events.sort(key=lambda x: x["at_ms"], reverse=True)
        return {"they_owe": round(sum(p["owes_me"] for p in people), 2), "i_owe": round(sum(p["i_owe"] for p in people), 2),
                "people": len(people), "people_with_debt": sum(1 for p in people if p["owes_me"] > 0 or p["i_owe"] > 0),
                "recent": [e for e in events if e["person_id"] in names][:8], "currency": await debts.main_currency(db, uid),
                "other_currencies": _other_totals(people)}

    @api_router.get("/debts/archived")
    async def archived(user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        return await srv.people_balances(db, user["_id"], archived=True)

    @api_router.get("/debts/people/{pid}")
    async def person_debts(pid: str, currency: Optional[str] = None, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """One person's balances and history in one currency (the main one unless `?currency=` names another); `currencies` lists the ledgers
        that exist, with what is owed in each, so the screen can offer them."""
        uid = user["_id"]
        person = await person_of(db, user, pid)
        main = await debts.main_currency(db, uid)
        cur = (currency or main).upper()
        names = {a.id: a.name for a in (await db.execute(select(Account).where(Account.user_id == uid))).scalars()}
        h = await debts.history(db, uid, person, names, cur)
        every = await debts.all_balances_of(db, uid, person.id)
        raw = every.get(cur) or await debts.balance_of(db, uid, person.id, cur)
        return {"person": {**srv.to_dict(person), "archived": bool(person.archived)}, "balances": debts.view(raw, cur), "currency": cur, "main_currency": main,
                "currencies": [debts.view(r, c) for c, r in every.items()],
                "items": [item_view(i) for i in h["items"]], "audit": [item_view({**i, "effect_cents": i.get("effect_cents", 0)}) for i in h["audit"]]}

    # -- changing -----------------------------------------------------------------------------------------------------------------

    @api_router.post("/debts/people/{pid}/payments")
    async def payment(pid: str, body: PaymentBody, request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """A real payment: it lowers the balance it settles and is recorded in the payment history. When it is more than is owed, nothing is
        recorded until the person says what the extra is (`excess`: "opposite" = a debt the other way, "tip" = a gift)."""
        uid = user["_id"]

        async def work(before):
            person = await person_of(db, user, pid, archived_ok=False)
            cents = debts.to_cents(body.amount)
            account_id, account_currency = None, None
            if body.account:
                acc = await srv.resolve_account(db, body.account, uid)
                if acc is None:
                    raise HTTPException(400, "That account does not exist. Choose one you have, or record the payment without an account.")
                account_id, account_currency = acc.id, acc.currency      # a payment counts in the currency of the account it went through
            plan = await debts.payment_plan(db, uid, person, body.direction, cents, account_currency or body.currency)
            cur = plan["currency"]
            if plan["excess_cents"] > 0 and body.excess is None:
                who = person.name
                return {"ok": False, "pending": True, "needs_excess_choice": True, "outstanding": plan["outstanding_cents"] / 100, "currency": cur,
                        "excess": plan["excess_cents"] / 100, "person": {"id": person.id, "name": who},
                        "message": (f"{debts._phrase(plan['paid_direction'], plan['outstanding_cents'], who, currency=cur)}, and this payment is {debts.money(cents, cur)}. "
                                    f"What is the extra {debts.money(plan['excess_cents'], cur)}?"),
                        "options": [{"value": "opposite", "label": (f"I owe {who} the extra {debts.money(plan['excess_cents'], cur)}" if body.direction == "in"
                                                                    else f"{who} owes me the extra {debts.money(plan['excess_cents'], cur)}")},
                                    {"value": "tip", "label": "A tip or gift, no debt"}]}
            date = body.date or srv.now_iso()[:10]
            amount = Decimal(cents) / 100
            settlement = Settlement(id=srv.new_id(), user_id=uid, person_id=person.id, person_name=person.name, amount=amount,
                                    method=(body.method or ("Other" if not account_id else "Revolut")), account=account_id or "", direction=body.direction,
                                    date=date, currency=cur, created_at=srv.now_iso())
            db.add(settlement)
            await db.flush()
            created_txn = None
            if account_id:
                created_txn = Transaction(
                    id=srv.new_id(), user_id=uid, type="income" if body.direction == "in" else "expense", gross_amount=amount, personal_amount=amount,
                    reimbursable_amount=0, description=f"{'Payment from' if body.direction == 'in' else 'Payment to'} {person.name}", category="People",
                    account=account_id, merchant=person.name, date=date, month=date[:7], notes=f"Settlement via {settlement.method}", created_at=srv.now_iso(),
                    paid_by="me" if body.direction == "out" else None)   # money I paid out must leave the account (balances count only expenses paid by me)
                db.add(created_txn)
                await db.flush()
                settlement.balance_transaction_id = created_txn.id
            lines = []
            if plan["excess_cents"] > 0:
                lines = debts.excess_lines(uid, person, plan, body.excess, settlement.id, "payment")
                db.add_all(lines)
            await db.flush()
            await srv.money_check(db, uid, before)
            who = "from" if body.direction == "in" else "to"
            note = f" The extra {debts.money(plan['excess_cents'], cur)} {'became a debt the other way' if body.excess == 'opposite' else 'was kept as a tip, no debt'}." if lines else ""
            res = await answer(db, user, person, f"Recorded a payment of {debts.money(cents, cur)} {who} {person.name}.{note}", lines, cur,
                               payment={"id": settlement.id, "amount": float(amount), "direction": body.direction, "recorded_in_account": bool(account_id)})
            res["undo"] = {"settlement_id": settlement.id}
            return res

        return await write(request, user, db, work)

    @api_router.post("/debts/people/{pid}/adjust/{op}")
    async def adjust(pid: str, op: str, body: DebtBody, request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        if op not in DEBT_OPS:
            raise HTTPException(404, "Unknown operation")
        uid = user["_id"]

        async def work(_before):
            person = await person_of(db, user, pid, archived_ok=False)
            result = await debts.adjust(db, uid, person, body.direction, op, amount=body.amount, new_amount=body.new_amount, description=body.description,
                                        origin="manual", line_type=body.line_type, line_id=body.line_id, currency=body.currency)
            res = await answer(db, user, person, result["message"], result["entries"])
            res["undo"] = {"entry_ids": [e.id for e in result["entries"]]}
            return res

        return await write(request, user, db, work)

    @api_router.post("/debts/entries/{eid}/reverse")
    async def reverse_entry(eid: str, request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Undo (or restore, for a cleared amount) by writing the opposite line: the original stays in the audit list."""
        uid = user["_id"]

        async def work(_before):
            entry = (await db.execute(select(DebtEntry).where(DebtEntry.id == eid, DebtEntry.user_id == uid))).scalar_one_or_none()
            if entry is None:
                raise HTTPException(404, "That entry was not found")
            person = await person_of(db, user, entry.person_id)
            result = await debts.reverse(db, uid, person, eid)
            return await answer(db, user, person, "Restored." if entry.kind == "clear" else "Reversed.", result["entries"])

        return await write(request, user, db, work)

    @api_router.post("/debts/people/{pid}/archive")
    async def archive_person(pid: str, body: ArchiveBody, request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        uid = user["_id"]

        async def work(_before):
            person = await person_of(db, user, pid)
            outcome = await debts.archive(db, uid, person, clear_balances=body.clear_balances)
            return {"ok": True, "person": {"id": person.id, "name": person.name}, **outcome,
                    "message": f"{person.name} was deleted." + (" Their balances were cleared (no payment recorded) and kept in their history." if outcome["cleared"] else "")}

        return await write(request, user, db, work)

    @api_router.post("/debts/people/{pid}/restore")
    async def restore_person(pid: str, request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        async def work(_before):
            person = await person_of(db, user, pid)
            person.archived = False
            await db.flush()
            return await answer(db, user, person, f"{person.name} is back.")

        return await write(request, user, db, work)
