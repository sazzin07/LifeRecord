# People and debt management — implementation plan

> Use superpowers:executing-plans. Owner's decisions (2026-11-03) are binding; defaults below were not questioned and can be changed.

**Goal:** Two independent balances per person (they owe me / I owe them) kept in an append-only ledger beside the existing expense splits and settlements; manual and AI actions share one set of operations; then a redesigned People tab.

**Owner decisions:** deleting a person archives them (history kept, restorable; with an outstanding balance the confirmation states the amounts and clears them); overpayment is accepted and the person chooses "extra becomes the opposite debt" or "extra is a tip/gift"; payment account optional ("don't record in my accounts"); clearing is never a payment and a cleared line or balance leaves the normal view but is kept in an audit list with Restore; no due dates or reminders for now; the AI confirms before clearing and every AI action is undoable; one limited live-model check at the end; design (Impeccable, glass-inspired) comes last and its open questions are asked then.

**Defaults (not questioned):** EUR only, with a currency column on every entry so a second currency is never silently added; expense splits remain the single source of expense-linked debt (no copy into the ledger, so nothing is counted twice); the Home and Money "owed / you owe" totals stop netting people against each other and become sums of the two balances; money is integer cents in the new code; writes take the existing per-user money lock; duplicate requests are stopped by an idempotency key; the legacy `/settlements`, `/people/{id}`, `/people/{id}/clear-balance` endpoints keep working; no ALTER on existing tables (new tables only, created at start-up, plus a skip-if-exists migration).

## Balance rule (the single source of truth, `debts.py`)
per direction, in cents = Σ expense splits (they_owe: paid by me, their share; i_owe: paid by them, my share) − Σ settlements (in reduces they_owe, out reduces i_owe) + Σ `debt_entries.amount_cents` of that direction. Reduce, clear and corrections can never push a balance below zero; a payment larger than the balance writes `excess` entries that neutralise the surplus (and, for "opposite", add the other direction).

## Tables (new)
`debt_entries(id, user_id, person_id, person_name, direction, kind add|reduce|correct|clear|excess|reversal, amount_cents (signed effect), currency, description, origin manual|ai|payment, target_type, target_id, settlement_id, created_ms, created_at)`; `idempotency_keys(user_id, key, response, created_ms)`.

## Tasks
1. **Ledger core** `backend/debts.py` + models + migration: balances in cents for one/all people, add/reduce/correct/clear (all / one line) / reverse / restore, excess handling, history builder (visible vs cleared), archive/restore, idempotency wrapper. Tests: arithmetic, floors, no double counting with expense splits, history sums to balance, cleared and reversed items.
2. **API** `backend/debts_api.py` (+ `people_balances` and Home/Money totals switched to the two balances, `DELETE /people` becomes archive, `GET /people/overview`, archived list/restore). Tests: every operation over HTTP, ownership (two users), concurrency (parallel adds sum exactly), idempotent retry, failed operation leaves no partial rows, payment creates account transaction only when an account is chosen, clear creates no payment/expense.
3. **AI tools** `backend/ai_tools_people.py`: find_person (ambiguity), get_people (fixed), get_person_debts, adjust_debt, record_payment (asks about excess), clear_debt (preview then confirm), correct_debt, create_person, delete_person (archive); system-prompt rules for the five operation types and follow-ups; idempotency key from `client_request_id` + call id; AI undo writes reversal entries. Tests: every tool in-process with simulated model calls, ambiguity, missing amount, unknown person, retries, undo.
4. **Functional UI** (existing components, replaced by the design pass later): overview, directory with search/sort/filter, profile with two balances, history, add/reduce/payment/clear/correct, delete confirmation, archived list; `client_request_id` from the chat. E2E specs.
5. **Verification**: backend suite, unit, strict build, browser suite; then one limited live-model check.
6. **Design phase** (Impeccable): ask the open visual questions first (the four references mix dark glass and light cards), then new-work, build, audit/polish/adapt, detector, screenshots at three widths and both themes, accessibility audit, reduced motion.
7. **Docs**: README, roadmap row, memory; only for what was verified.
