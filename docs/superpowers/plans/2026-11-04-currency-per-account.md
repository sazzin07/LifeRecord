# Currency per account (F-09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Each money place has its own ISO currency; amounts show in the right currency everywhere, totals are one per currency (nothing converted), and a transfer between two currencies records both amounts.

**Architecture:** `accounts.currency` already exists (default `EUR`, `String(10)`); a transaction's currency is its account's currency (`from_account` for transfers, with a new `to_amount` for the receiving side). The frontend replaces `eur(n)` with `money(n, currency)` and a `useCurrency()` main-currency default (the bank account's currency). Debts keep `debt_entries.currency` (exists). No conversion, no exchange rates, no live lookups.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (MySQL), React, Intl.NumberFormat, pytest (`LR_ISOLATED=1`), Playwright.

**Spec:** the owner's answers in this session: any ISO 4217 currency; one total per currency; both amounts on a cross-currency transfer; budgets and debts follow their account, budgets in the main currency (the bank account's currency); the main currency is the bank account's currency; existing data is all EUR.

## Global Constraints

- No currency conversion and no exchange-rate source anywhere. Totals are per currency.
- Currency codes are 3 uppercase letters validated against `Intl.supportedValuesOf("currency")` on the client and a server-side ISO list (`backend/currencies.py`).
- Stored amounts never change when a place's currency is changed; only the code does (display only). Changing a place's currency is refused when it has transactions in another currency's transfers (a cross-currency transfer would become inconsistent) — return 409 with a plain message.
- Money in the API stays decimal numbers; the existing integer-cents debt ledger is untouched.
- Every route change regenerates the API snapshot: `LR_ISOLATED=1 python tests/test_server_surface.py --write`.
- New table or column: model + alembic migration + `account_data` export/delete handling + `support_populate.py` + `test_isolation_matrix.py` entry.

## Review Focus

- A user with only EUR places sees exactly the same screens and figures as before (no per-currency headings, no extra columns).
- Currency with 0 decimals (JPY) and 3 decimals (KWD) formats and rounds correctly (`Intl` decides; inputs use the currency's step).
- A transfer between two currencies with an amount of 0 or a missing second amount is refused.
- Deleting a place returns its money to the main account only when currencies match; otherwise refuse with a message (never silently mix).
- The assistant tools that quote money include the currency code so it never says "€" for dollars.

---

### Task 1: Currency list, `money()` formatter and main-currency context

**Files:**
- Create: `backend/currencies.py`, `frontend/src/lib/money.js`, `frontend/src/lib/money.test.js`
- Modify: `frontend/src/lib/api.js:186` (keep `eur` as `money(n, "EUR")` shim)

**Interfaces:**
- Produces (backend): `CURRENCIES: dict[str, dict]` (`code -> {"name", "digits"}`), `def is_currency(code: str) -> bool`, `def currency_digits(code: str) -> int`.
- Produces (frontend): `money(n, currency = mainCurrency()) -> string`, `setMainCurrency(code)`, `mainCurrency() -> string`, `currencyDigits(code) -> number`, `currencyOptions() -> [{code, name}]`.

- [ ] **Step 1:** Write `money.test.js` (Jest): `money(1234.5,"EUR")` contains `1,234.50`; `money(1234,"JPY")` has no decimals; `money(1,"KWD")` has 3 decimals; `money(5)` uses the main currency set by `setMainCurrency("USD")`; unknown code falls back to the main currency instead of throwing.
- [ ] **Step 2:** Run `cd frontend && yarn test --watchAll=false money` — expect FAIL.
- [ ] **Step 3:** Implement `money.js` with `Intl.NumberFormat("en-IE", {style:"currency", currency})`, wrapped in try/catch for bad codes. Implement `currencies.py` from a static ISO 4217 table (code, name, minor-unit digits). `api.js`: `export const eur = (n) => money(n, "EUR")`.
- [ ] **Step 4:** Run the same test — expect PASS.
- [ ] **Step 5:** Commit `feat(currency): money formatter, ISO list`.

### Task 2: Accounts expose and accept a currency

**Files:**
- Modify: `backend/server.py` (account create/update bodies and account JSON, `AccountBody`/`AccountUpdate`), `backend/ai_tools_*.py` money-space tools
- Test: `backend/tests/test_currency.py`

**Interfaces:**
- Consumes: `currencies.is_currency`.
- Produces: account JSON gains `currency` (string, 3 letters); `POST /api/accounts` and `PUT /api/accounts/{id}` accept `currency`; a new place inherits its parent's currency when omitted; `GET /api/accounts` includes `main_currency` (the bank account's currency).

- [ ] **Step 1:** Tests in `test_currency.py`: creating a place with `currency="usd"` stores `USD`; `"XXXX"` → 422; omitted → parent's currency; changing a place that has a cross-currency transfer → 409; `main_currency` equals the bank account's currency.
- [ ] **Step 2:** Run `cd backend && LR_ISOLATED=1 pytest tests/test_currency.py -q` — expect FAIL.
- [ ] **Step 3:** Implement in `server.py` (normalise with `.upper()`, validate, inherit). Account JSON helper returns `currency`.
- [ ] **Step 4:** Run — expect PASS. Regenerate the API snapshot.
- [ ] **Step 5:** Commit.

### Task 3: Cross-currency transfers

**Files:**
- Create: `backend/alembic/versions/<new>_transfer_to_amount.py`
- Modify: `backend/models.py` (`Transaction.to_amount DECIMAL(12,2) nullable`), `backend/server.py` transfer route and balance maths, `backend/account_data.py`, `backend/tests/support_populate.py`
- Test: `backend/tests/test_currency.py`

**Interfaces:**
- Produces: `POST /api/transfers` body gains `to_amount` (required and > 0 when the two places' currencies differ, ignored otherwise); a transfer's receiving side uses `to_amount` when set, `gross_amount` otherwise; transaction JSON includes `to_amount` and `to_currency`.

- [ ] **Step 1:** Tests: same-currency transfer unchanged; EUR→USD 100 out / 108 in changes the EUR place by −100 and the USD place by +108; missing/zero `to_amount` → 422; deleting that transfer restores both balances.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Migration + model + every place that adds a transfer's amount to `to_account` balance uses `to_amount if not None else gross_amount` (find with `grep -n "to_account" backend/server.py`). **Step 4:** PASS, snapshot, `test_isolation_matrix`, export/delete. **Step 5:** Commit.

### Task 4: Totals per currency

**Files:** Modify `backend/server.py` (`/analytics/summary`, `/accounts` totals), Test `backend/tests/test_currency.py`

**Interfaces:** `summary` keeps every existing field (computed for the main currency only, so single-currency users see no change) and adds `by_currency: [{"currency", "total_available", "cash_available", "bank", "revolut"}]` only when more than one currency is in use; spending and budget maths count main-currency transactions only; a `other_currencies_spent` list shows the rest.

- [ ] Tests: EUR+USD places give two `by_currency` rows and the legacy `total_available` equals the EUR total; EUR-only user has no `by_currency`; budgets ignore USD spending. Implement; PASS; commit.

### Task 5: Frontend — place currency picker, amounts, totals

**Files:** Modify `frontend/src/components/AccountDialog.jsx` (currency select, shown always; labels "(€)" become the currency symbol), `frontend/src/pages/Money.jsx` (`TransferForm` second amount and implied rate when currencies differ; per-currency totals row when `summary.by_currency`), `Home.jsx`, `lib/allocation.js`, `ExpenseDialog.jsx`, `EditExpenseDialog.jsx`, `MoneySettings.jsx` (each `eur(x)` for an account-bound amount becomes `money(x, account.currency)`), `SettingsContext` call to `setMainCurrency(main_currency)`.
**Test:** `frontend/e2e/currency.spec.js`.

- [ ] Spec: create a USD place → its balance shows `$`; the EUR total is unchanged; a transfer EUR→USD asks for both amounts, shows the implied rate, and the balances move by the two amounts; a EUR-only account shows no per-currency row. Run, implement, PASS, axe on the new dialog states (`a11y-dialogs`), commit.

### Task 6: Assistant tools and docs

**Files:** Modify money tools in `backend/ai_tools_*.py` and `server.py` tool schemas (include `currency` in results, accept it on create), `README.md`, roadmap F-09.
- [ ] Test (in-process scripted turns, no live model): a tool result for a USD place carries `currency: "USD"`. Implement; PASS; update README/roadmap; commit.
