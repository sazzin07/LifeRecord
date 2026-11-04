# Recurring transactions (F-11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A per-account list of recurring expenses and income (rent, subscriptions, salary) that the scheduler turns into real transactions on the due day, automatically, once each.

**Architecture:** A `recurring_transactions` table holds the rule (kind, amount, account, category, repeat, next due date, optional end date). The existing `scheduling.Scheduler` loop (already started in `server.py`) gains a tick that creates due transactions through the same code path as `POST /api/expenses` / income, marks them `recurring_id`, advances `next_due`, and catches up missed days once per missed due date (max 31 per run). An in-app notice lists what was created.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, `scheduling.Scheduler`, React, Playwright.

**Spec:** the owner's answers in this session: automatic creation on the due date (undoable, notice in app), repeat = weekly / monthly / yearly with an optional end date, day 29–31 uses the last day of shorter months, missed days while the app was off are caught up once each.

## Global Constraints

- Every row belongs to one user; the scheduler works per user and never crosses accounts (`test_isolation_matrix.py`).
- A created transaction is an ordinary transaction plus `recurring_id`; deleting it never touches the rule.
- Idempotent: running the tick twice for the same due date creates one transaction (unique `(recurring_id, due_date)`).
- Amounts use the account's currency (Task dependency: F-09 may land first; until then EUR).
- New table: model + alembic migration + `account_data` export/delete + `support_populate.py` row + `test_isolation_matrix.py` entry.
- API snapshot regenerated: `LR_ISOLATED=1 python tests/test_server_surface.py --write`.

## Review Focus

- A rule due on Jan 31 monthly produces Feb 28 (29 in a leap year), then Mar 31 (not Mar 28).
- The server was off for 3 months: three monthly transactions are created once each, dated on their own due dates, not all today.
- A rule whose account was deleted is paused with a clear status instead of failing every tick.
- An end date in the past never creates anything and shows as "ended".
- Two ticks racing create one transaction.

---

### Task 1: Date arithmetic

**Files:** Create `backend/recurring.py`, Test `backend/tests/test_recurring.py`
**Interfaces:** Produces `def next_due(current: date, repeat: str, anchor_day: int) -> date` (`repeat` in `weekly|monthly|yearly`; `anchor_day` is the original day-of-month), `def due_dates(next_due_: date, repeat: str, anchor_day: int, today: date, end: date | None, limit: int = 31) -> list[date]`.
- [ ] Tests: Jan 31 monthly → Feb 28 → Mar 31 (anchor 31); leap-year Feb 29 yearly → Feb 28 in a common year then back to Feb 29; weekly adds 7 days; `due_dates` stops at `end` and at `limit`; catches up 3 months.
- [ ] Run (FAIL), implement, run (PASS), commit.

### Task 2: Model, migration, CRUD API

**Files:** Modify `backend/models.py` (`RecurringTransaction`: `id, user_id, kind (expense|income), amount DECIMAL(12,2), account, category, merchant, description, repeat, anchor_day, next_due (str date), end_date nullable, status (active|paused|ended), created_at`; `Transaction.recurring_id` nullable + unique `(recurring_id, date)` via a separate index table or constraint), `backend/alembic/versions/<new>_recurring.py`, `backend/recurring_api.py` (router), `backend/server.py` (include router), `backend/account_data.py`, `backend/tests/support_populate.py`, `backend/tests/test_isolation_matrix.py`
**Interfaces:** `GET/POST /api/recurring`, `PUT/DELETE /api/recurring/{id}`, `POST /api/recurring/{id}/pause|resume`; body `{kind, amount, account, category, merchant?, description?, repeat, start_date, end_date?}`; item JSON adds `next_due`, `status`, `last_created`.
- [ ] Tests: create/list/update/pause/delete; another user cannot read or edit it (404); invalid repeat or amount ≤ 0 → 422; start in the past sets `next_due` to the start (catch-up on next tick).
- [ ] Implement, PASS, snapshot, commit.

### Task 3: The tick

**Files:** Modify `backend/scheduling.py` (call `recurring.run_due(db_factory, now)` each loop), `backend/recurring.py` (`async def run_due(session_factory, today: date) -> list[dict]`)
**Interfaces:** Consumes Task 1 and 2. Produces transactions via the existing expense/income creation helpers; returns the created list; `GET /api/recurring/notices` returns created-since-last-seen and `POST /api/recurring/notices/seen` clears them.
- [ ] Tests: due rule creates one transaction dated on the due date with `recurring_id`; running twice creates one; 3 months behind creates 3 with their own dates; a missing account pauses the rule; an ended rule creates nothing; balances change like a normal expense.
- [ ] Implement, PASS, commit.

### Task 4: Frontend — list, dialog, notice

**Files:** Create `frontend/src/pages/money/Recurring.jsx` (card on Money in the Money theme: list with next date, amount, repeat; add/edit dialog with `mny-dialog`; pause/resume/delete; skeleton via real markup), Modify `Money.jsx` (mount the card), `frontend/src/components/RecurringNotice.jsx` (toast on Home/Money: "Rent (€650) was added for 1 Nov", Undo = delete that transaction), `e2e/recurring.spec.js`, `e2e/skeleton-fidelity.spec.js`
- [ ] Spec: create "Rent" monthly starting yesterday → after reload a transaction exists dated yesterday and the card shows next due next month; pause stops it; deleting the rule keeps the transaction; axe at 3 widths in both themes. Implement, PASS, commit.

### Task 5: Assistant tools and docs

**Files:** `backend/ai_tools_extra.py` (`list_recurring`, `create_recurring`, `pause_recurring`, undoable), `README.md`, roadmap F-11
- [ ] In-process scripted-turn tests for the three tools; update docs; commit.
