"""The assistant's tools for people and debts. They call exactly the functions the screen's routes call (`debts.py`, and the payment
rules of `debts_api.py`): there is one set of money rules, not one for the screen and one for the chat.

What each tool is, so the model never confuses them:
  adjust_debt    - add to or reduce what someone owes (or what the user owes them) with NO payment: "Ferreira owes me 10".
  record_payment - money really changed hands: "Ferreira paid me 5". Lowers the debt; an account only if one is named.
  clear_debt     - the debt is forgiven or dropped, no payment, nothing owed afterwards: asks the user to confirm first.
  correct_debt   - the balance was wrong; set it to the right figure.
A request that fails comes back as {"error": ...} and changed nothing; a request that is a question comes back with
`needs_confirmation`. Every change reports the balances as they are AFTER it was saved. A repeated identical call in the same request
(a provider retry, a model repeating itself) is recognised by its key and answered with the first result, never applied twice.
`srv` is the imported `server` module, passed in to avoid a circular import.
"""
import hashlib
import json
import unicodedata
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select

import debts
from models import Account, Person, Settlement, Transaction


def _fn(name, description, props=None, required=None):
    params = {"type": "object", "properties": props or {}}
    if required:
        params["required"] = required
    return {"type": "function", "function": {"name": name, "description": description, "parameters": params}}


_S = {"type": "string"}
_N = {"type": "number"}
_PERSON = {"type": "string", "description": "The person's name as the user said it (or their id). If it matches more than one person the tool says so: then ask the user which."}
_DIRECTION = {"type": "string", "enum": ["they_owe", "i_owe"],
              "description": "they_owe = the person owes the user ('Ferreira owes me', 'he borrowed', 'add to what John owes me'). i_owe = the user owes the person ('I owe Maria', 'I still have to pay her')."}
_CONFIRM = {"type": "boolean", "description": "Leave unset on the first call, which only previews. Set true only after the user has agreed in their latest message."}

PEOPLE_TOOLS = [
    _fn("find_person", "Find people by name, tolerant of case, accents and part of a name. Returns every match with their two balances. Use it when unsure who is meant.",
        {"query": _S}, ["query"]),
    _fn("get_people", "List people with BOTH balances each: they_owe (what the person owes the user) and i_owe (what the user owes them). The two are never netted. "
        "Use it for 'who owes me the most', 'how much do I owe other people', 'show everyone's debts'. Totals are included.",
        {"sort": {"type": "string", "enum": ["they_owe", "i_owe", "name"], "description": "Largest first for the two balances."},
         "only_with_balance": {"type": "boolean"}}),
    _fn("get_person_debts", "One person's balances and recent debt history (debts added, reduced, payments, corrections, clearings), newest first.",
        {"person": _PERSON, "limit": _N}, ["person"]),
    _fn("adjust_debt", "Add to or reduce a debt WITHOUT any payment or expense ('Ferreira owes me 10', 'add another 15 to what John owes me', 'I owe Maria 40', "
        "'reduce John's debt by 10'). Not for money that changed hands: that is record_payment. A person who does not exist is not created: say so and offer to add them (create_person).",
        {"person": _PERSON, "direction": _DIRECTION, "operation": {"type": "string", "enum": ["add", "reduce"]}, "amount": {"type": "number", "description": "More than zero."},
         "description": {"type": "string", "description": "Optional note, e.g. what it was for."}}, ["person", "direction", "operation", "amount"]),
    _fn("correct_debt", "Set a balance to the right figure when it was wrong ('Ferreira actually owes me 35'). The old lines stay in the history.",
        {"person": _PERSON, "direction": _DIRECTION, "new_amount": {"type": "number", "description": "What the balance should now be."}, "description": _S},
        ["person", "direction", "new_amount"]),
    _fn("record_payment", "Record that money REALLY changed hands: 'Ferreira paid me 5' (direction in), 'I paid Maria 20' (direction out). It lowers the debt it settles. "
        "Records in an account only if the user names one; otherwise say it was not recorded in any account. If the payment is more than is owed the tool asks what the extra is "
        "(a debt the other way, or a tip/gift): ask the user, then call again with `excess`. Not for forgiving a debt: that is clear_debt.",
        {"person": _PERSON, "direction": {"type": "string", "enum": ["in", "out"], "description": "in = the person paid the user; out = the user paid the person."},
         "amount": _N, "method": {"type": "string", "enum": ["MB WAY", "Revolut", "Cash", "Other"]}, "account": {"type": "string", "description": "Only if the user named an account or place."},
         "excess": {"type": "string", "enum": ["opposite", "tip"], "description": "Only after the user answered what the extra of an overpayment is."}, "description": _S},
        ["person", "direction", "amount"]),
    _fn("clear_debt", "Remove an outstanding debt WITHOUT any payment: 'clear everything Ferreira owes me', 'forget the rest, I don't want to collect it'. No payment, no account change; it is "
        "kept in an audit list and can be restored. Preview first, then confirm. If it is unclear whether the user means a payment or forgiving the debt, ask.",
        {"person": _PERSON, "direction": {"type": "string", "enum": ["they_owe", "i_owe", "both"]}, "description": _S, "confirm": _CONFIRM}, ["person", "direction"]),
    _fn("create_person", "Add a new person. Only when the user asked for it or agreed to your offer.", {"name": _S}, ["name"]),
]
PEOPLE_NAMES = {t["function"]["name"] for t in PEOPLE_TOOLS}


def _plain(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", (text or "").casefold()) if not unicodedata.combining(c)).strip()


def _card(p: dict) -> dict:
    return {"id": p["id"], "name": p["name"], "they_owe": p["owes_me"], "i_owe": p["i_owe"]}


async def _match(srv, db, user, text: str):
    """(person row | None, error dict | None). Exact name first, then names that start with or contain what was said."""
    uid = user["_id"]
    text = (text or "").strip()
    if not text:
        return None, {"error": "Which person? No name was given."}
    by_id = (await db.execute(select(Person).where(Person.id == text, Person.user_id == uid, Person.archived == False))).scalar_one_or_none()  # noqa: E712
    if by_id:
        return by_id, None
    people = (await db.execute(select(Person).where(Person.user_id == uid, Person.archived == False))).scalars().all()  # noqa: E712
    want = _plain(text)
    tiers = [[p for p in people if _plain(p.name) == want],
             [p for p in people if _plain(p.name).startswith(want) or want in _plain(p.name).split()],
             [p for p in people if want in _plain(p.name)]]
    for found in tiers:
        if len(found) == 1:
            return found[0], None
        if len(found) > 1:
            cards = {p["id"]: _card(p) for p in await srv.people_balances(db, uid)}
            return None, {"error": f"More than one person matches '{text}'. Ask the user which one they mean.", "needs_confirmation": True,
                          "candidates": [cards[p.id] for p in found if p.id in cards]}
    return None, {"error": f"No person named '{text}'. Offer to add them (create_person) before recording anything.", "needs_confirmation": True, "suggest_create": text}


def _answer(person, balances, message, **extra):
    return {"ok": True, "message": message, "person": {"id": person.id, "name": person.name}, "balances": balances,
            "note": "These balances are the saved ones, after this change.", **extra}


async def _run(srv, db, user, ctx, name, args, work):
    """Lock, repeat check, the work, one commit; a DebtError or HTTPException comes back as {"error": ...} with nothing written."""
    uid = user["_id"]
    before = await srv.money_begin(db, uid)
    digest = hashlib.sha256(json.dumps([name, args], sort_keys=True, default=str).encode()).hexdigest()[:32]
    key = f"ai:{(ctx or {}).get('request_id', '')}:{digest}"
    prior = await debts.remembered(db, uid, key) if (ctx or {}).get("request_id") else None
    if prior is not None:
        await db.rollback()
        return {**prior, "duplicate": True, "note": "This exact call was already applied once in this request; it was not applied again."}
    try:
        result = await work(before)
    except debts.DebtError as e:
        await db.rollback()
        return {"error": e.message, **({"needs_confirmation": True} if e.status == 409 else {})}
    except HTTPException as e:
        await db.rollback()
        return {"error": str(e.detail)}
    if result.get("pending") or result.get("error"):
        await db.rollback()
        return result
    if (ctx or {}).get("request_id"):
        await debts.remember(db, uid, key, result)
    await db.commit()
    return result


async def dispatch_people(srv, db, user, name, args, created, ctx=None, session_id=None, previewed=None):
    uid = user["_id"]
    if name == "create_person":
        nm = (args.get("name") or "").strip()
        if not nm:
            return {"error": "A name is needed."}
        existing = (await db.execute(select(Person).where(Person.user_id == uid, Person.name_lower == nm.lower()))).scalar_one_or_none()
        if existing and not existing.archived:
            return {"ok": True, "message": f"{existing.name} is already in your people.", "person": {"id": existing.id, "name": existing.name}}
        person = await srv.resolve_person(db, nm, uid)
        created.append({"collection": "people", "id": person["id"]})
        return {"ok": True, "message": f"Added {person['name']}.", "person": person}

    if name == "find_person":
        text = _plain(args.get("query"))
        people = [p for p in await srv.people_balances(db, uid) if text and text in _plain(p["name"])]
        return {"matches": [_card(p) for p in people], "count": len(people)}

    if name == "get_people":
        people = await srv.people_balances(db, uid)
        if args.get("only_with_balance"):
            people = [p for p in people if p["owes_me"] > 0 or p["i_owe"] > 0]
        sort = args.get("sort") or "name"
        people.sort(key=(lambda p: -p["owes_me"]) if sort == "they_owe" else (lambda p: -p["i_owe"]) if sort == "i_owe" else (lambda p: p["name"].lower()))
        return {"people": [{**_card(p), "notes": p.get("notes")} for p in people],
                "totals": {"they_owe_me": round(sum(p["owes_me"] for p in people), 2), "i_owe_them": round(sum(p["i_owe"] for p in people), 2)},
                "note": "The two balances are separate: they_owe is what the person owes the user, i_owe what the user owes them."}

    person, error = await _match(srv, db, user, args.get("person"))
    if error:
        return error

    if name == "get_person_debts":
        names = {a.id: a.name for a in (await db.execute(select(Account).where(Account.user_id == uid))).scalars()}
        h = await debts.history(db, uid, person, names)
        raw = await debts.balance_of(db, uid, person.id)
        limit = max(1, min(int(args.get("limit") or 15), 50))
        return {"person": {"id": person.id, "name": person.name}, "balances": debts.view(raw),
                "history": [{"direction": i["direction"], "kind": i["kind"], "amount": abs(i["effect_cents"]) / 100, "what": i["label"], "note": i.get("description"),
                             "origin": i["origin"], "date": i.get("date")} for i in h["items"][:limit]],
                "cleared_items": len(h["audit"])}

    if name in ("adjust_debt", "correct_debt"):
        async def work(_before):
            op = "correct" if name == "correct_debt" else args.get("operation")
            res = await debts.adjust(db, uid, person, args.get("direction"), op, amount=args.get("amount"), new_amount=args.get("new_amount"),
                                     description=args.get("description"), origin="ai")
            for e in res["entries"]:
                created.append({"collection": "debt_entries", "id": e.id})
            return _answer(person, debts.view(await debts.balance_of(db, uid, person.id)), res["message"])
        return await _run(srv, db, user, ctx, name, args, work)

    if name == "clear_debt":
        direction = args.get("direction")
        raw = debts.outstanding(await debts.balance_of(db, uid, person.id))
        shown = {d: v for d, v in raw.items() if v > 0 and (direction == "both" or d == direction)}
        if not shown:
            return {"error": f"Nothing is owed that way between the user and {person.name}: there is nothing to clear."}
        what = " and ".join(debts._phrase(d, v, person.name) for d, v in shown.items())
        gate = await srv._confirmation_gate(db, uid, session_id, previewed, "clear_debt", f"{person.id}:{direction}", args.get("confirm"),
                                            f"This will clear: {what}. No payment is recorded and no account changes; it can be restored later. Ask the user to confirm.")
        if gate:
            return gate

        async def work(_before):
            res = await debts.adjust(db, uid, person, direction, "clear", description=args.get("description"), origin="ai")
            for e in res["entries"]:
                created.append({"collection": "debt_entries", "id": e.id})
            return _answer(person, debts.view(await debts.balance_of(db, uid, person.id)), res["message"])
        return await _run(srv, db, user, ctx, name, args, work)

    if name == "record_payment":
        async def work(before):
            cents = debts.to_cents(args.get("amount") or 0)
            direction = args.get("direction", "in")
            plan = await debts.payment_plan(db, uid, person, direction, cents)
            if plan["excess_cents"] > 0 and args.get("excess") not in ("tip", "opposite"):
                return {"pending": True, "needs_confirmation": True, "recorded": False,
                        "message": (f"{debts._phrase(plan['paid_direction'], plan['outstanding_cents'], person.name)}, and this payment is {debts.money(cents)}. Nothing was recorded. "
                                    f"Ask the user what the extra {debts.money(plan['excess_cents'])} is: (1) excess 'opposite' = "
                                    + (f"the user now owes {person.name} the extra {debts.money(plan['excess_cents'])} back" if direction == "in" else f"{person.name} now owes the user the extra {debts.money(plan['excess_cents'])} back")
                                    + ", or (2) excess 'tip' = a tip/gift with no debt either way."),
                        "outstanding": plan["outstanding_cents"] / 100, "excess": plan["excess_cents"] / 100}
            account_id = None
            if args.get("account"):
                acc = await srv.resolve_account(db, args["account"], uid)
                if acc is None:
                    return {"error": f"No account or place called '{args['account']}'. Ask which one, or record the payment without an account."}
                account_id = acc.id
            date = srv.now_iso()[:10]
            amount = Decimal(cents) / 100
            method = args.get("method") or ("Other" if not account_id else "Revolut")
            s = Settlement(id=srv.new_id(), user_id=uid, person_id=person.id, person_name=person.name, amount=amount, method=method, account=account_id or "",
                           direction=direction, date=date, created_at=srv.now_iso())
            db.add(s)
            await db.flush()
            created.append({"collection": "settlements", "id": s.id})
            if account_id:
                t = Transaction(id=srv.new_id(), user_id=uid, type="income" if direction == "in" else "expense", gross_amount=amount, personal_amount=amount, reimbursable_amount=0,
                                description=f"{'Payment from' if direction == 'in' else 'Payment to'} {person.name}", category="People", account=account_id, merchant=person.name,
                                date=date, month=date[:7], notes=f"Settlement via {method}", created_at=srv.now_iso(), paid_by="me" if direction == "out" else None)
                db.add(t)
                await db.flush()
                s.balance_transaction_id = t.id
                created.append({"collection": "transactions", "id": t.id})
            lines = debts.excess_lines(uid, person, plan, args["excess"], s.id, "payment") if plan["excess_cents"] > 0 else []
            db.add_all(lines)
            for e in lines:
                created.append({"collection": "debt_entries", "id": e.id})
            await db.flush()
            await srv.money_check(db, uid, before)
            where = "recorded in your account" if account_id else "not recorded in any of your accounts"
            extra = f" The extra {debts.money(plan['excess_cents'])} {'became a debt the other way' if args.get('excess') == 'opposite' else 'was kept as a tip, no debt'}." if lines else ""
            return _answer(person, debts.view(await debts.balance_of(db, uid, person.id)),
                           f"Recorded a payment of {debts.money(cents)} {'from' if direction == 'in' else 'to'} {person.name} ({where}).{extra}")
        return await _run(srv, db, user, ctx, name, args, work)

    return {"error": "unknown tool"}
