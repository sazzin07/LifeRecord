"""Recurring transactions (roadmap F-11): the routes for the rules, and `run_due`, which the scheduler calls to turn due rules into real
transactions.

A due rule creates an ordinary transaction (plus `recurring_id`) through the same balance checks as a typed-in one. It is idempotent: the
unique index on (recurring_id, date) means two ticks can never create the same day twice. A rule that cannot be carried out (its place was
deleted, or the place does not hold enough) is paused with a plain reason and left for the person to look at, never retried every 30 seconds.

Registered like the other domain modules (`register(api_router, server_module)`).
"""
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

import recurring
from models import Account, RecurringTransaction, Split, Transaction

logger = logging.getLogger("liferecord.recurring")
ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"
MAX_RULES = 200


class RecurringBody(BaseModel):
    kind: str = Field(..., pattern="^(expense|income)$")
    amount: float = Field(..., gt=0, le=10_000_000)
    account: str = Field(..., min_length=1, max_length=50)
    category: Optional[str] = Field(default=None, max_length=255)
    merchant: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = Field(default=None, max_length=500)
    repeat: str = Field(..., pattern="^(weekly|monthly|yearly)$")
    start_date: str = Field(..., pattern=ISO_DATE)
    end_date: Optional[str] = Field(default=None, pattern=ISO_DATE)


class RecurringUpdate(BaseModel):
    amount: Optional[float] = Field(default=None, gt=0, le=10_000_000)
    account: Optional[str] = Field(default=None, min_length=1, max_length=50)
    category: Optional[str] = Field(default=None, max_length=255)
    merchant: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = Field(default=None, max_length=500)
    repeat: Optional[str] = Field(default=None, pattern="^(weekly|monthly|yearly)$")
    next_due: Optional[str] = Field(default=None, pattern=ISO_DATE)
    end_date: Optional[str] = Field(default=None, pattern=ISO_DATE)
    clear_end: bool = False


def _day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, "That is not a real date.")


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def view(r: RecurringTransaction, account_name: Optional[str] = None) -> dict:
    ended = bool(r.end_date) and r.status != "paused" and r.next_due > r.end_date
    return {"id": r.id, "kind": r.kind, "amount": float(r.amount), "account": r.account, "account_name": account_name, "category": r.category,
            "merchant": r.merchant, "description": r.description, "repeat": r.repeat, "next_due": r.next_due, "end_date": r.end_date,
            "status": "ended" if ended else r.status, "note": r.note, "last_created": r.last_created}


async def _create_for_day(srv, db: AsyncSession, r: RecurringTransaction, day: date) -> bool:
    """The transaction for one due day, in the rule's place, through the usual balance checks. False when that day already has one."""
    iso = day.isoformat()
    if (await db.execute(select(Transaction.id).where(Transaction.recurring_id == r.id, Transaction.date == iso))).first():
        return False
    before = await srv.money_begin(db, r.user_id)
    amount = float(r.amount)
    account_id = await srv.require_account_id(db, r.account, r.user_id)
    text = r.description or r.merchant or "Recurring"
    txn = Transaction(id=srv.new_id(), user_id=r.user_id, type=r.kind, account=account_id, gross_amount=amount, recurring_id=r.id,
                      description=text, date=iso, month=srv.month_of(iso), created_at=srv.now_iso())
    if r.kind == "expense":
        txn.personal_amount, txn.reimbursable_amount = amount, 0.0
        txn.category, txn.merchant, txn.paid_by, txn.items = r.category or "Other", r.merchant or "", "me", []
    db.add(txn)
    await db.flush()
    if r.kind == "expense":
        db.add(Split(id=srv.new_id(), transaction_id=txn.id, person_id="me", person_name="Me", amount=amount, is_me=True, created_at=srv.now_iso()))
    await srv.money_check(db, r.user_id, before)
    r.last_created = iso
    return True


async def run_rule(srv, db: AsyncSession, rid: str, today: date) -> int:
    """Create every due day of one rule (oldest first, at most 31), advancing it as it goes. Returns how many transactions were made."""
    r = await db.get(RecurringTransaction, rid)
    if not r or r.status != "active":
        return 0
    end = date.fromisoformat(r.end_date) if r.end_date else None
    made = 0
    for day in recurring.due_dates(date.fromisoformat(r.next_due), r.repeat, r.anchor_day, today, end):
        try:
            if await _create_for_day(srv, db, r, day):
                made += 1
            r.next_due = recurring.next_due(day, r.repeat, r.anchor_day).isoformat()
            await db.commit()
        except IntegrityError:
            await db.rollback()                       # another tick made this day first
            r = await db.get(RecurringTransaction, rid)
            r.next_due = recurring.next_due(day, r.repeat, r.anchor_day).isoformat()
            await db.commit()
        except HTTPException as exc:                  # a missing place, or not enough money in it: stop and say why
            await db.rollback()
            r = await db.get(RecurringTransaction, rid)
            r.status, r.note = "paused", str(exc.detail)[:255]
            await db.commit()
            break
    return made


async def run_due(srv, session_factory, today: Optional[date] = None) -> int:
    """One pass for every account: the rules due today or earlier become transactions. Returns how many were made."""
    today = today or utc_today()
    async with session_factory() as db:
        ids = (await db.execute(select(RecurringTransaction.id).where(RecurringTransaction.status == "active", RecurringTransaction.next_due <= today.isoformat()))).scalars().all()
    made = 0
    for rid in ids:
        try:
            async with session_factory() as db:
                made += await run_rule(srv, db, rid, today)
        except Exception:  # noqa: BLE001 - one bad rule must not stop the others
            logger.exception("recurring rule %s failed", rid)
    return made


def register(api_router, srv):
    async def names(db, uid):
        return {a.id: a.name for a in (await db.execute(select(Account).where(Account.user_id == uid))).scalars().all()}

    async def mine(db, uid, rid) -> RecurringTransaction:
        r = (await db.execute(select(RecurringTransaction).where(RecurringTransaction.id == rid, RecurringTransaction.user_id == uid))).scalar_one_or_none()
        if not r:
            raise HTTPException(404, "Recurring transaction not found")
        return r

    @api_router.get("/recurring")
    async def list_recurring(user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        rows = (await db.execute(select(RecurringTransaction).where(RecurringTransaction.user_id == user["_id"]).order_by(RecurringTransaction.next_due))).scalars().all()
        n = await names(db, user["_id"])
        return [view(r, n.get(r.account)) for r in rows]

    @api_router.post("/recurring")
    async def create_recurring(body: RecurringBody, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        uid = user["_id"]
        start = _day(body.start_date)
        if body.end_date and _day(body.end_date) < start:
            raise HTTPException(422, "The end date is before the start date.")
        count = len((await db.execute(select(RecurringTransaction.id).where(RecurringTransaction.user_id == uid))).all())
        if count >= MAX_RULES:
            raise HTTPException(409, f"You can keep up to {MAX_RULES} recurring items.")
        account_id = await srv.require_account_id(db, body.account, uid)
        r = RecurringTransaction(id=srv.new_id(), user_id=uid, kind=body.kind, amount=Decimal(str(round(body.amount, 2))), account=account_id,
                                 category=body.category, merchant=body.merchant, description=body.description, repeat=body.repeat,
                                 anchor_day=start.day, next_due=start.isoformat(), end_date=body.end_date, status="active", created_at=srv.now_iso())
        db.add(r)
        await db.commit()
        return view(r, (await names(db, uid)).get(account_id))

    @api_router.put("/recurring/{rid}")
    async def update_recurring(rid: str, body: RecurringUpdate, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        uid = user["_id"]
        r = await mine(db, uid, rid)
        data = body.model_dump(exclude_unset=True)
        if "account" in data:
            r.account = await srv.require_account_id(db, data["account"], uid)
        if "amount" in data:
            r.amount = Decimal(str(round(data["amount"], 2)))
        for k in ("category", "merchant", "description", "repeat"):
            if k in data:
                setattr(r, k, data[k])
        if "next_due" in data:
            nd = _day(data["next_due"])
            r.next_due, r.anchor_day = nd.isoformat(), nd.day
        if data.get("clear_end"):
            r.end_date = None
        elif "end_date" in data:
            r.end_date = data["end_date"]
        await db.commit()
        return view(r, (await names(db, uid)).get(r.account))

    @api_router.post("/recurring/{rid}/pause")
    async def pause_recurring(rid: str, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        r = await mine(db, user["_id"], rid)
        r.status, r.note = "paused", None
        await db.commit()
        return view(r, (await names(db, user["_id"])).get(r.account))

    @api_router.post("/recurring/{rid}/resume")
    async def resume_recurring(rid: str, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Resuming starts from the next day that has not passed: what fell due while it was paused is not made up."""
        r = await mine(db, user["_id"], rid)
        today, d = utc_today(), date.fromisoformat(r.next_due)
        guard = 0
        while d < today and guard < 4000:
            d, guard = recurring.next_due(d, r.repeat, r.anchor_day), guard + 1
        r.next_due, r.status, r.note = d.isoformat(), "active", None
        await db.commit()
        return view(r, (await names(db, user["_id"])).get(r.account))

    @api_router.delete("/recurring/{rid}")
    async def delete_recurring(rid: str, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Removes the rule only. What it already created stays in the history (its `recurring_id` just points at nothing)."""
        r = await mine(db, user["_id"], rid)
        await db.delete(r)
        await db.commit()
        return {"ok": True}

    @api_router.get("/recurring/notices")
    async def notices(user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """What rules created since the person last looked, one entry per rule."""
        uid, out = user["_id"], []
        rules = (await db.execute(select(RecurringTransaction).where(RecurringTransaction.user_id == uid, RecurringTransaction.last_created.is_not(None)))).scalars().all()
        for r in rules:
            if r.seen_through and r.last_created <= r.seen_through:
                continue
            q = select(Transaction).where(Transaction.user_id == uid, Transaction.recurring_id == r.id)
            if r.seen_through:
                q = q.where(Transaction.date > r.seen_through)
            txns = (await db.execute(q.order_by(Transaction.date))).scalars().all()
            if txns:
                out.append({"rule_id": r.id, "title": r.description or r.merchant or "Recurring", "kind": r.kind, "count": len(txns),
                            "total": round(sum(float(t.gross_amount) for t in txns), 2), "last_date": txns[-1].date,
                            "transaction_ids": [t.id for t in txns]})
        return out

    @api_router.post("/recurring/notices/seen")
    async def notices_seen(user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        rules = (await db.execute(select(RecurringTransaction).where(RecurringTransaction.user_id == user["_id"], RecurringTransaction.last_created.is_not(None)))).scalars().all()
        for r in rules:
            r.seen_through = r.last_created
        await db.commit()
        return {"ok": True}
