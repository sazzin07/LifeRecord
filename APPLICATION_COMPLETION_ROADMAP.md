# LifeRecord Application Completion Roadmap

**Project:** `C:\Projects\LifeRecord`  
**Audit date:** 2026-10-19  
**Scope:** Full-stack audit of the LifeRecord application covering frontend, backend, database, AI integration, tests, configuration, and documentation.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Application Architecture](#2-application-architecture)
3. [Current State Overview](#3-current-state-overview)
4. [Page-by-Page Audit](#4-page-by-page-audit)
5. [Backend API Inventory](#5-backend-api-inventory)
6. [Database Schema](#6-database-schema)
7. [AI Integration & Tools](#7-ai-integration--tools)
8. [Security & Configuration Audit](#8-security--configuration-audit)
9. [Testing & Quality](#9-testing--quality)
10. [Bugs, Technical Debt & Risks](#10-bugs-technical-debt--risks)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Master Checklist](#12-master-checklist)

---

## 1. Executive Summary

LifeRecord is a multi-user personal-life management application built with a FastAPI backend and a React frontend. It currently provides working modules for finances, people/debts, tasks, fitness, body/weight, nutrition, groceries, progress photos, and an AI assistant powered by Google Gemini. Authentication includes email verification, password reset, refresh tokens, and per-user data isolation.

**Overall maturity:** The backend is broadly functional and data isolation is enforced. Money and Groceries core workflows are now polished and dynamic. The biggest remaining functional gaps are in Groceries polish (budget tracking, recurring lists, suggestions, dashboard widgets), Calendar (no grid view), Nutrition (no manual meal/recipe forms), Tasks (no edit/due/priority UI), and Settings account management.

**Critical priorities:**
1. Finish Groceries polish: budget tracking, recurring lists, frequently bought suggestions, dashboard widgets.
2. Fix broken/placeholder UI flows (PersonDetail edit/delete, QuickAdd workout, Calendar grid).
3. Expand frontend forms to use existing backend endpoints (Tasks edit, Nutrition add meal/recipe, account transfers/income).
4. Harden production configuration (JWT secret, admin password, SMTP, distributed rate limiting).
5. Improve test coverage beyond the current backend smoke/CRUD tests and two Playwright e2e specs.

---

## 2. Application Architecture

### 2.1 Backend

| Layer | Technology | Key Files |
|-------|------------|-----------|
| Framework | FastAPI (async) + Uvicorn | `backend/server.py` |
| ORM / Driver | SQLAlchemy 2.0 async + aiomysql | `backend/database.py`, `backend/models.py` |
| Database | MariaDB / MySQL 8.4 | `tools/mysql-data/`, `tools/mysql-data-backup/` |
| Auth | bcrypt + PyJWT HS256 | `backend/security_utils.py`, `backend/server.py` |
| Email | aiosmtplib / console fallback | `backend/email_service.py` |
| AI | Google Gemini (`google-genai`) | `backend/server.py` (lines ~2076–2696) |
| Tests | pytest + pytest-xdist | `backend/tests/*.py` |

**Architectural note:** The backend is intentionally monolithic. All routes, schemas, business logic, AI tool dispatch, and seeding live in `backend/server.py` (~2,900 lines). There is no `routers/` or `schemas/` folder.

### 2.2 Frontend

| Layer | Technology | Key Files |
|-------|------------|-----------|
| Framework | React 19.0.0 | `frontend/src/index.js`, `frontend/src/App.js` |
| Build tool | Create React App 5 + Craco | `frontend/craco.config.js` |
| Router | react-router-dom 7.15.0 | `frontend/src/App.js` |
| State | Local `useState`, AuthContext, SettingsContext, custom `useFetch` | `frontend/src/context/*`, `frontend/src/lib/useFetch.js` |
| UI | shadcn/ui (Radix + Tailwind) | `frontend/src/components/ui/*` |
| Styling | Tailwind CSS 3.4 + custom `index.css` | `frontend/tailwind.config.js`, `frontend/src/index.css` |
| Notifications | sonner toasts | `frontend/src/components/ui/sonner.jsx` |
| Charts | recharts | `frontend/src/pages/Money.jsx`, `frontend/src/pages/Body.jsx` |
| Tests | Playwright e2e | `frontend/e2e/*.js` |

**State management note:** React Query is configured in `frontend/src/index.js` but unused. SWR is installed but unused.

### 2.3 Data Flow

1. Frontend calls `REACT_APP_BACKEND_URL/api/*` via Axios (`frontend/src/lib/api.js`).
2. JWT access token is attached automatically; refresh logic queues concurrent 401 retries.
3. Backend dependency `get_current_user()` extracts the user from the JWT and filters every query by `user_id`.
4. Mutations call `refreshAll()` to dispatch a global `lm:refresh` event, causing `useFetch` hooks to refetch.
5. AI chat posts to `/api/ai/chat`; tool calls are dispatched server-side and persisted records are tracked in `ai_actions` for undo.

---

## 3. Current State Overview

### 3.1 Verified Working

- Multi-user registration, email verification, login, logout, refresh tokens, password reset.
- Protected routes and per-user data isolation.
- People CRUD, balances, ledger, payments/refunds, bulk delete.
- Money: transactions, splits, refunds, category budgets, charts, CSV export; dynamic account hierarchy with bank/cash/Revolut, transfers, actual-spending calculation, locked funds.
- Body: weight tracking, progress photos (secure upload/serve), photo comparison.
- Fitness: workout logging, PRs, session history.
- Groceries (basic): inventory CRUD, low-stock alerts, shopping list, AI-generated list, price intelligence, mark-as-bought.
- Nutrition (basic): macro rings, meal list, recipe list, cook recipe.
- AI assistant: chat, receipt scan, voice transcription, action history/undo, tool calling for many domains.
- Dashboard: summary stats, widgets for nutrition, people, groceries, tasks.

### 3.2 Partially Implemented / Placeholder

- **Groceries:** core multi-list + cart workflow complete; budget tracking, recurring lists, frequently bought suggestions, and dashboard widgets still missing.
- **Calendar:** task list only, no calendar grid.
- **Tasks:** no edit, due date, priority, or recurring UI.
- **Nutrition:** no manual add-meal or add-recipe forms.
- **PersonDetail route:** edit/delete callbacks just navigate away.
- **QuickAdd workout:** placeholder toast only.
- **Accounts:** CRUD + transfers implemented in Money tab; Settings account management still missing.

### 3.3 Runtime Status at Audit Time

- MySQL, backend and frontend are running locally via `start-all.ps1`.
- Latest run: 51 backend tests pass; 7 Playwright e2e tests pass (smoke logout test is flaky on cold frontend dev-server startup but passes on retry).
- No Docker or CI/CD configuration exists; deployment is manual via PowerShell scripts.

---

## 4. Page-by-Page Audit

### 4.1 Home (Dashboard)

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Functional but summary-only | `frontend/src/pages/Home.jsx` |
| Existing functionality | Hero banner, insight cards, 4-stat grid, nutrition rings, people balances, grocery count/low-stock, tasks preview. | Uses `/analytics/summary`, `/tasks`, `/people`, `/weight`, `/meals?date={today}`, `/groceries`. |
| Remaining work | Add richer grocery summaries (active lists, budget progress, pending items), quick actions, deeper navigation into Groceries. | GROC-001, DASH-001 |
| Acceptance criteria | Dashboard displays active shopping lists, pending item count, budget progress, and at least one direct quick action to Groceries. | |

### 4.2 Money

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Complete (polished) | `frontend/src/pages/Money.jsx` |
| Existing functionality | Dynamic account hierarchy (bank, cash sub-places, Revolut), balance cards, transfers, actual-spending calculation, locked-funds support, period filters, charts, transaction list, add/edit expense with dynamic accounts, CSV export, category budgets. | Uses `/analytics/summary`, `/transactions`, `/categories`, `/accounts`, `/accounts/transfer`. |
| Remaining work | Income UI is available via backend; no dedicated frontend income button. | MONEY-INC-001 |
| Acceptance criteria | Account selector uses `/accounts`; users can add accounts and record transfers. | ✓ |

### 4.3 People

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Functional | `frontend/src/pages/People.jsx`, `frontend/src/components/PersonDetailModal.jsx` |
| Existing functionality | Grid, add/edit/delete, bulk delete, search/sort, detail modal with ledger and payment. | Recent custom-dialog changes tested and passing. |
| Remaining work | Fix `/people/:id` route so edit/delete callbacks actually work instead of navigating away. | PEOPLE-001 |
| Acceptance criteria | Standalone person detail route supports edit and delete actions. | |

### 4.4 Groceries

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Functional multi-list inventory + shopping cart | `frontend/src/pages/Groceries.jsx`, backend `Grocery`, `ShoppingList`, `ShoppingItem`, `PriceRecord`, `Recipe` |
| Existing functionality | Inventory CRUD with low-stock badges; multiple shopping lists; shopping cart with item selection; partial-purchase submit; price intelligence; generate from low stock/usual buys; AI tools for list/item management. | |
| Remaining work | Budget tracking, recurring lists, frequently bought suggestions, dedicated low-stock reminders endpoint, dashboard grocery widgets, price history chart, chat history in AI assistant. | GROC-006–GROC-010, GROC-014–GROC-018, AI-003–AI-007, DASH-001–DASH-003 |
| Acceptance criteria | See Section 11 (Groceries tasks). | |

### 4.5 Nutrition

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Read-only macros + lists | `frontend/src/pages/Nutrition.jsx` |
| Existing functionality | Macro rings vs fixed targets, meal list, recipe list, cook recipe. | |
| Remaining work | Manual "Add meal" form; manual "Add recipe" form; edit/delete recipes. | NUTR-001, NUTR-002 |
| Acceptance criteria | User can add/edit/delete meals and recipes without using AI. | |

### 4.6 Fitness

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Functional | `frontend/src/pages/Fitness.jsx` |
| Existing functionality | Templates, log workout dialog, PRs, history. | |
| Remaining work | Edit/delete workouts; QuickAdd workout form. | FIT-001, QUICK-001 |
| Acceptance criteria | Workouts can be edited/deleted; QuickAdd opens a workout form. | |

### 4.7 Body

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Functional | `frontend/src/pages/Body.jsx` |
| Existing functionality | Weight input, trend chart, photos, comparison. | Recent delete confirmations added. |
| Remaining work | Edit weight entries/photos. | BODY-001 |
| Acceptance criteria | Weight entries and photos can be edited. | |

### 4.8 Tasks

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Basic todo list | `frontend/src/pages/Tasks.jsx` |
| Existing functionality | Add, toggle done, delete. | Backend supports priority, due, recurring. |
| Remaining work | Edit task, set priority/due/recurring, Calendar integration. | TASK-001, CAL-002 |
| Acceptance criteria | Tasks can be edited with priority, due date, and recurring flag. | |

### 4.9 Calendar

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Placeholder list view | `frontend/src/pages/Calendar.jsx` |
| Existing functionality | Lists tasks with `due` dates grouped by date. | |
| Remaining work | Real calendar grid (month/week/day), display tasks and optional events. | CAL-001 |
| Acceptance criteria | Calendar shows a month grid with tasks and due dates. | |

### 4.10 Settings

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Functional for theme/categories | `frontend/src/pages/Settings.jsx` |
| Existing functionality | Profile, logout, theme, animations, accounts read-only, category CRUD. | |
| Remaining work | Account management (add/edit/delete), change password UI. | ACCT-001, AUTH-001 |
| Acceptance criteria | Users can manage accounts and change password. | |

### 4.11 Authentication Pages

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | Functional | `frontend/src/pages/Login.jsx`, `Signup.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx` |
| Existing functionality | Login, signup verification, forgot/reset password. | |
| Remaining work | Change password from Settings; resend verification cooldown edge cases. | AUTH-001 |
| Acceptance criteria | Authenticated users can change password. | |

---

## 5. Backend API Inventory

### 5.1 Auth (`/api/auth`)

| Endpoint | Status | Notes |
|----------|--------|-------|
| POST `/auth/register` | Working | Sends 6-digit code. |
| POST `/auth/resend-verification` | Working | 90s cooldown. |
| POST `/auth/verify` | Working | Issues tokens. |
| POST `/auth/login` | Working | Issues limited token for unverified users. |
| POST `/auth/forgot-password` | Working | Single-use reset token. |
| POST `/auth/reset-password` | Working | Invalidates token after use. |
| POST `/auth/refresh` | Working | Rotates refresh token. |
| POST `/auth/change-password` | Working | Authenticated. |
| GET `/auth/me` | Working | Allows unverified for auth flows. |

### 5.2 People (`/api/people`)

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET, POST, GET `{id}`, PUT `{id}`, DELETE `{id}` | Working | |
| POST `/people/bulk-delete` | Working | |

### 5.3 Categories & Accounts

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET/POST `/categories`, PUT/DELETE `/categories/{id}` | Working | |
| GET `/accounts` | Working | Computed balances with hierarchical accounts. |
| POST/PUT/DELETE `/accounts` | Working | Supports bank, cash, Revolut, owed, sub-places. |
| POST `/accounts/transfer` | Working | Moves money between accounts. |

### 5.4 Transactions & Settlements

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET `/transactions` | Working | Filters supported. |
| POST `/transactions/expense` | Working | Splits + inventory add. |
| PUT `/transactions/{id}` | Working | |
| DELETE `/transactions/{id}` | Working | Rolls back inventory by 1 (bug for multi-item). | BUG-001 |
| POST `/transactions/transfer` | Working | No UI. |
| POST `/transactions/income` | Working | No UI. |
| POST `/settlements` | Working | Immutable after creation. |
| PUT/DELETE `/settlements/{id}` | **Missing** | | SETT-001 |

### 5.5 Analytics

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET `/analytics/summary` | Working | Dashboard + Money data. |
| CSV/export endpoints | **Missing** | Already has frontend CSV export for transactions only. |

### 5.6 Tasks, Body, Fitness, Photos

| Endpoint | Status | Notes |
|----------|--------|-------|
| Tasks CRUD | Working | |
| Weight GET/POST/DELETE | Working | No PUT. | BODY-002 |
| Workouts GET/POST/DELETE + PRs | Working | No PUT. | FIT-002 |
| Photos GET/POST/DELETE/file | Working | Soft delete only. |

### 5.7 Groceries, Shopping, Recipes

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET/POST/PUT/DELETE `/groceries` | Working | Merges by name. |
| GET `/groceries/low-stock` | Working | Returns items at or below threshold. |
| GET `/shopping` | Working | Enriched with prices; supports `list_id` filter; includes `budget_summary`. |
| POST `/shopping` | Working | Add item to a list. |
| PUT `/shopping/{id}` | Working | Edit item name/quantity/price/category/store. |
| DELETE `/shopping/{id}` | Working | Remove item from list. |
| POST `/shopping/{id}/toggle` | Working | Toggle cart selection. |
| POST `/shopping/{id}/buy` | Working | Legacy single-item buy. |
| POST `/shopping/bulk-delete` | Working | Delete selected items. |
| POST `/shopping/bulk-update` | Working | Bulk select/move/category/store. |
| POST `/shopping/generate` | Working | Generates from low stock + usual buys into a list. |
| POST `/shopping/lists` | Working | Create a list. |
| PUT `/shopping/lists/{id}` | Working | Rename/archive list. |
| DELETE `/shopping/lists/{id}` | Working | Delete list + items. |
| POST `/shopping/lists/{id}/submit` | Working | Submit selected items as a purchase; updates inventory only for selected items. |
| GET `/prices/{name}` | Working | Price history. |
| GET/POST/DELETE `/recipes` | Working | No PUT. | NUTR-003 |
| POST `/recipes/{id}/cook` | Working | |

### 5.8 Meals / Nutrition

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET/POST/DELETE `/meals` | Working | No PUT. | NUTR-004 |

### 5.9 AI (`/api/ai`)

| Endpoint | Status | Notes |
|----------|--------|-------|
| POST `/ai/chat` | Working | Tool calling. |
| GET `/ai/history` | Working | Not loaded by frontend. | AI-UI-001 |
| GET `/ai/actions` + undo | Working | Undo only deletes created records. | AI-002 |
| POST `/ai/transcribe` | Working | |
| POST `/ai/receipt` | Working | |

---

## 6. Database Schema

18 tables confirmed in `tools/mysql-data/liferecord/`:

| Table | Model | Key Purpose |
|-------|-------|-------------|
| `users` | `User` | Accounts, verification, tokens. |
| `accounts` | `Account` | Cash/Revolut/etc. balances. |
| `categories` | `Category` | Budget categories. |
| `people` | `Person` | Contacts + balances. |
| `transactions` | `Transaction` | Expenses, income, transfers. |
| `splits` | `Split` | Per-person transaction splits. |
| `settlements` | `Settlement` | Payments/reimbursements. |
| `tasks` | `Task` | Todos. |
| `weight_entries` | `WeightEntry` | Weight log. |
| `workouts` | `Workout` | Fitness sessions. |
| `photos` | `Photo` | Progress photos. |
| `groceries` | `Grocery` | Inventory. |
| `price_records` | `PriceRecord` | Historical prices. |
| `shopping_items` | `ShoppingItem` | Single implicit shopping list. |
| `meals` | `Meal` | Logged meals. |
| `recipes` | `Recipe` | Recipes. |
| `ai_actions` | `AIAction` | AI action log for undo. |
| `ai_messages` | `AIMessage` | Chat history. |

### Schema gaps for Groceries upgrade

- ✅ `shopping_lists` table created; `shopping_items` have `list_id` FK.
- ✅ `ShoppingItem` extended with `category`, `estimated_price`, `actual_price`, `store`, `completed_at`, `sort_order`, `selected`.
- ✅ `Grocery` extended with `is_favorite`, `default_quantity`, `default_store`, `purchase_count`.
- ✅ `Account` extended with `initial_balance` and `is_locked`.
- ❌ No `grocery_budgets` or `shopping_list_budgets` table.
- ❌ No `recurring_lists` table.

---

## 7. AI Integration & Tools

### 7.1 Provider & Endpoints

- **Provider:** Google Gemini (`google-genai`), model `gemini-3.5-flash-lite` with fallbacks.
- **Endpoints:** `/api/ai/chat`, `/api/ai/history`, `/api/ai/actions`, `/api/ai/actions/{id}/undo`, `/api/ai/transcribe`, `/api/ai/receipt`.

### 7.2 Existing AI Tools

- `create_expense`, `record_payment`, `create_person`, `add_grocery`, `log_meal`, `record_weight`, `create_task`, `get_financial_summary`, `get_people_balances`, `update_expense`, `delete_expense` (confirmation), `mark_refunded`, `update_grocery`, `generate_shopping_list`, `create_recipe`, `cook_recipe`, `log_workout`.
- Money: `get_accounts`, `transfer_money`, `update_account_balance`.
- Groceries: `get_groceries`, `get_shopping_lists`, `create_shopping_list`, `add_shopping_item`, `update_shopping_item`, `delete_shopping_item`, `submit_purchase`.

### 7.3 AI Gaps

- ✅ AI can create shopping lists and manage items; `submit_purchase` updates inventory.
- ❌ No AI tool to query price history (`/prices/{name}` not exposed to AI).
- `_pending_confirmations` is in-memory and lost on restart.
- Undo cannot restore updated records, only delete created ones.
- Frontend does not load chat history on open.

---

## 8. Security & Configuration Audit

### 8.1 Verified Controls

- bcrypt password hashing.
- JWT access + refresh tokens with type claims and expiry.
- Per-user data isolation via `user_id` filtering.
- CORS restricted to `CORS_ORIGINS`.
- Security headers middleware.
- File upload extension/size/path-traversal checks.
- Rate limiting on auth endpoints (in-memory).

### 8.2 Risks / Required Configuration

| Item | Risk | Recommended Action |
|------|------|--------------------|
| `JWT_SECRET` | Dev placeholder in `.env` | Rotate before production. | SEC-001 |
| `ADMIN_PASSWORD` | Plaintext `LifeRecord` in `.env` | Change and document. | SEC-002 |
| `GEMINI_API_KEY` | Present in `.env` | Rotate if exposed. | SEC-003 |
| DB root/no password | Local dev only | Use dedicated app user in production. | SEC-004 |
| In-memory rate limiting | Resets on restart | Use Redis/shared store. | SEC-005 |
| Tokens in localStorage | XSS exposure | Consider httpOnly cookie strategy. | SEC-006 |
| No CSP header | Add at reverse proxy | Document or implement. | SEC-007 |
| No Alembic | Schema drift risk | Adopt migration framework. | DB-001 |

---

## 9. Testing & Quality

### 9.1 Backend Tests

| File | Coverage | Status |
|------|----------|--------|
| `backend/tests/backend_test.py` | Smoke, auth, CRUD, finance, AI wiring | Passing (51 total) |
| `backend/tests/test_auth_multiuser.py` | Auth lifecycle, isolation, security | Passing |
| `backend/tests/test_iteration2.py` | Refunds, groceries, recipes, AI delete, shopping cart partial purchase | Passing |

**Gaps:** No unit tests for helper functions, no receipt/transcription tests, no AI undo tests, no migration tests, no dedicated budget tests.

### 9.2 Frontend Tests

| File | Coverage | Status |
|------|----------|--------|
| `frontend/e2e/smoke.spec.js` | Tab loads + logout | Passing |
| `frontend/e2e/people.spec.js` | People CRUD, detail, payment | Passing |

**Gaps:** No tests for Money, Groceries, Nutrition, Fitness, Body, Tasks, Calendar, Settings, AI assistant, auth flows, receipt scan.

### 9.3 Lint / Type Check

- No explicit TypeScript; JS with JSDoc optional.
- ESLint configured but not run as part of this audit.
- `yarn build` succeeds.

---

## 10. Bugs, Technical Debt & Risks

### 10.1 Confirmed Bugs

| ID | Bug | Location | Impact |
|----|-----|----------|--------|
| BUG-001 | Deleting a transaction rolls back grocery quantity by 1 regardless of original item count. | `backend/server.py` `delete_transaction` | Inventory inaccurate for multi-item expenses. |
| BUG-002 | PersonDetail route edit/delete callbacks only navigate away. | `frontend/src/pages/PersonDetail.jsx` | Standalone detail route is read-only. |
| BUG-003 | `ExpenseDialog` fetches `/accounts` but hardcodes Cash/Revolut selector. | `frontend/src/components/ExpenseDialog.jsx` | New accounts invisible in UI. |
| BUG-004 | Duplicate fetch logic in `PersonDetailModal`; `load` callback unused. | `frontend/src/components/PersonDetailModal.jsx` | Dead code / confusion. |
| BUG-005 | `sonner.jsx` imports `useTheme` from `next-themes` but app has no `ThemeProvider` from that library. | `frontend/src/components/ui/sonner.jsx` | Wrapper component is dead code. |

### 10.2 Technical Debt

| ID | Debt | Location | Priority |
|----|------|----------|----------|
| DEBT-001 | Monolithic `server.py` (~2,900 lines) | `backend/server.py` | Medium |
| DEBT-002 | Unused dependencies: `@tanstack/react-query`, `swr`, `next-themes`, `use-toast.js` | `frontend/package.json`, `frontend/src/hooks/use-toast.js` | Low |
| DEBT-003 | No Alembic / formal migrations | `backend/` | Medium |
| DEBT-004 | In-memory `_pending_confirmations` for AI destructive actions | `backend/server.py` | High |
| DEBT-005 | Tests require running backend + hardcoded credentials | `backend/tests/`, `frontend/e2e/fixtures.js` | Medium |
| DEBT-006 | Bare catch blocks swallow errors | Multiple frontend components | Low |

### 10.3 Inferred / Unverified Concerns

- **Offline behavior:** UI shows offline banner but does not queue mutations.
- **Input validation:** Most forms rely on backend toasts rather than inline validation.
- **Currency locale:** `eur()` hardcoded to `en-IE`.
- **Mobile navigation:** Bottom nav only shows 4 tabs; other pages unreachable without command bar.

---

## 11. Implementation Roadmap

### Phase 1 — Foundation & Fixes (Critical)

| ID | Task | Files / Components | Steps | Dependencies | Verification | Priority |
|----|------|-------------------|-------|--------------|--------------|----------|
| P1-001 | Fix PersonDetail route edit/delete | `frontend/src/pages/PersonDetail.jsx` | Wire `onEdit` to open edit form; wire `onDelete` to delete person; add tests. | None | E2E test passes for edit/delete from `/people/:id`. | Critical |
| P1-002 | Fix transaction grocery rollback bug | `backend/server.py` `delete_transaction` | Track quantity added per grocery in transaction items; rollback exact amount. | None | Backend test for multi-item grocery expense deletion. | Critical |
| P1-003 | Rotate dev secrets & document production config | `backend/.env`, `README.md` | Update `JWT_SECRET`, admin password; add `.env.production` guidance. | None | No plaintext weak secrets in committed examples. | Critical |
| P1-004 | Add database migration framework | `backend/alembic/`, `README.md` | Initialize Alembic; create initial migration from current models; document workflow. | None | `alembic upgrade head` creates schema; tests pass. | High |

### Phase 2 — Groceries Upgrade (Critical)

| ID | Task | Files / Components | Steps | Dependencies | Verification | Priority |
|----|------|-------------------|-------|--------------|--------------|----------|
| GROC-001 | Add `shopping_lists` table and migrate items | `backend/models.py`, migration | Create `ShoppingList` model; add `list_id` FK to `ShoppingItem`; default list per user. | P1-004 | Existing shopping items preserved; schema valid. | Critical |
| GROC-002 | Extend `ShoppingItem` model | `backend/models.py` | Add fields: `category`, `estimated_price`, `actual_price`, `store`, `completed_at`, `sort_order`. | GROC-001 | Models reflect fields; API still works. | Critical |
| GROC-003 | Extend `Grocery` model for favorites/defaults | `backend/models.py` | Add `is_favorite`, `default_quantity`, `default_store`, `purchase_count`. | None | Migration created; existing data preserved. | High |
| GROC-004 | Implement shopping list CRUD backend | `backend/server.py` | Endpoints: GET/POST/PUT/DELETE/duplicate/archive `/shopping/lists`, GET by ID. | GROC-001 | Tests for list CRUD pass. | Critical |
| GROC-005 | Implement shopping item CRUD backend | `backend/server.py` | Endpoints: POST item to list, PUT item, DELETE item, mark complete/incomplete, move between lists. | GROC-002 | Tests for item CRUD pass. | Critical |
| GROC-006 | Add budget tracking backend | `backend/models.py`, `backend/server.py` | Add `GroceryBudget` or list-level budget; endpoints to get/set budget; compute spent/remaining. | GROC-004 | Budget GET/PUT endpoints return correct totals. | High |
| GROC-007 | Add recurring lists backend | `backend/models.py`, `backend/server.py` | `RecurringList` model with schedule/cron expression; endpoint to spawn next occurrence. | GROC-004 | Spawning creates list with expected items. | Medium |
| GROC-008 | Add frequently bought suggestions backend | `backend/server.py` | Query purchase history to suggest items; endpoint `/groceries/suggestions`. | GROC-003 | Returns plausible suggestions. | Medium |
| GROC-009 | Add low-stock reminders backend | `backend/server.py` | Endpoint `/groceries/low-stock` returning items at or below threshold. | None | Matches inventory logic. | High |
| GROC-010 | Update analytics summary for groceries | `backend/server.py` `/analytics/summary` | Include active lists, pending items, budget progress, low-stock count. | GROC-004, GROC-006 | Dashboard receives new fields. | High |
| GROC-011 | Build multiple lists UI | `frontend/src/pages/Groceries.jsx` | List selector, add/edit/duplicate/archive/delete lists. | GROC-004 | User can manage multiple lists. | Critical |
| GROC-012 | Build shopping mode UI | `frontend/src/pages/Groceries.jsx` | Large touch targets, categorized items, quick complete/incomplete, live totals. | GROC-005, GROC-011 | Works on mobile; totals update. | Critical |
| GROC-013 | Add item-level edit/complete/restore/remove UI | `frontend/src/pages/Groceries.jsx` | Inline checkboxes, quantity steppers, swipe/restore, delete confirmation. | GROC-005 | CRUD operations persist. | Critical |
| GROC-014 | Add budget tracking UI | `frontend/src/pages/Groceries.jsx`, Dashboard | Budget progress bar, spent/remaining, alerts. | GROC-006 | Progress reflects actual prices. | High |
| GROC-015 | Add recurring lists UI | `frontend/src/pages/Groceries.jsx` | Schedule editor, spawn now, list of recurring templates. | GROC-007 | Recurring lists spawn correctly. | Medium |
| GROC-016 | Add suggestions UI | `frontend/src/pages/Groceries.jsx` | "Frequently bought" section with one-click add. | GROC-008 | Suggestions add items to current list. | Medium |
| GROC-017 | Add low-stock reminders UI | `frontend/src/pages/Groceries.jsx`, Dashboard | Badge/alert for low/out-of-stock items. | GROC-009 | Alerts match inventory. | High |
| GROC-018 | Add price history chart UI | `frontend/src/pages/Groceries.jsx` | Use existing `/prices/{name}` endpoint. | None | Chart renders per item. | Low |

### Phase 3 — AI Integration for Groceries (High)

| ID | Task | Files / Components | Steps | Dependencies | Verification | Priority |
|----|------|-------------------|-------|--------------|--------------|----------|
| AI-001 | Add AI tools for shopping list management | `backend/server.py` AI_TOOLS | `create_shopping_list`, `update_shopping_list`, `archive_shopping_list`, `duplicate_shopping_list`. | GROC-004 | AI can create/edit lists. | High |
| AI-002 | Add AI tools for shopping items | `backend/server.py` AI_TOOLS | `add_shopping_item`, `update_shopping_item`, `remove_shopping_item`, `mark_item_bought`. | GROC-005 | AI can manage items. | High |
| AI-003 | Add AI tools for grocery budget/summary | `backend/server.py` AI_TOOLS | `get_grocery_summary`, `set_shopping_list_budget`. | GROC-006, GROC-010 | AI reports budgets accurately. | High |
| AI-004 | Add AI tool for price query | `backend/server.py` AI_TOOLS | `get_price_history` using `/prices/{name}`. | None | AI returns real prices. | Medium |
| AI-005 | Add confirmation for destructive AI grocery actions | `backend/server.py` | Use `_pending_confirmations` or persistent state for bulk delete/clear list. | AI-001, AI-002 | User must confirm before destructive action. | High |
| AI-006 | Improve AI action undo | `backend/server.py` | Support restoring updated records where feasible. | AI-001–AI-004 | Undo reverses grocery changes. | Medium |
| AI-007 | Load chat history in UI | `frontend/src/components/AIAssistant.jsx` | Call `/api/ai/history` on open. | None | Previous messages appear. | Medium |

### Phase 4 — Dashboard & Cross-Module Integration (High)

| ID | Task | Files / Components | Steps | Dependencies | Verification | Priority |
|----|------|-------------------|-------|--------------|--------------|----------|
| DASH-001 | Expand grocery dashboard widgets | `frontend/src/pages/Home.jsx`, `backend/server.py` `/analytics/summary` | Show active lists, pending items, budget progress, low-stock reminders. | GROC-010, GROC-011, GROC-014, GROC-017 | Widgets render and update. | High |
| DASH-002 | Add quick actions to Dashboard | `frontend/src/pages/Home.jsx` | Buttons: create shopping list, add grocery, generate list. | GROC-011 | Actions navigate and open correct dialogs. | Medium |
| DASH-003 | Sync dashboard with mutations | `frontend/src/lib/useFetch.js`, `frontend/src/pages/Home.jsx` | Ensure `refreshAll()` invalidates dashboard data. | None | Dashboard updates after grocery changes. | High |
| CAL-001 | Implement calendar grid | `frontend/src/pages/Calendar.jsx` | Month/week grid using `react-day-picker`; display tasks with due dates. | None | Grid renders; tasks appear on dates. | Medium |
| CAL-002 | Show grocery/meal events on calendar | `frontend/src/pages/Calendar.jsx`, backend | Optional: include expiration dates, recurring list spawn dates. | GROC-007, CAL-001 | Events appear. | Low |
| NUTR-001 | Add manual meal form | `frontend/src/pages/Nutrition.jsx` | Dialog with description, macros, date; call `POST /meals`. | None | Meal created without AI. | High |
| NUTR-002 | Add manual recipe form | `frontend/src/pages/Nutrition.jsx` | Dialog with name, servings, ingredients, nutrition; call `POST /recipes`. | None | Recipe created without AI. | High |
| NUTR-003 | Add recipe edit/delete backend | `backend/server.py` | `PUT /recipes/{id}`, ensure frontend delete works. | None | Tests pass. | Medium |
| NUTR-004 | Add meal edit backend | `backend/server.py` | `PUT /meals/{id}`. | None | Tests pass. | Medium |
| TASK-001 | Add task edit/priority/due UI | `frontend/src/pages/Tasks.jsx` | Edit dialog with title, priority, due, recurring; call `PUT /tasks/{id}`. | None | Task fields editable. | High |
| FIT-001 | Add workout edit/delete UI | `frontend/src/pages/Fitness.jsx` | Edit/delete buttons; call backend. | FIT-002 | Workouts editable/deletable. | Medium |
| FIT-002 | Add workout edit backend | `backend/server.py` | `PUT /workouts/{id}`. | None | Tests pass. | Medium |
| BODY-001 | Add weight/photo edit UI | `frontend/src/pages/Body.jsx` | Edit weight entry note/weight; edit photo note/date. | BODY-002 | Edits persist. | Low |
| BODY-002 | Add weight edit backend | `backend/server.py` | `PUT /weight/{id}`. | None | Tests pass. | Low |
| QUICK-001 | Replace QuickAdd workout placeholder | `frontend/src/components/QuickAdd.jsx` | Open workout log dialog or navigate to Fitness. | None | QuickAdd no longer shows placeholder. | Medium |
| ACCT-001 | Add account management UI | `frontend/src/pages/Settings.jsx`, dialogs | Add/edit/delete accounts. | ACCT-002 | Accounts CRUD works. | Medium |
| ACCT-002 | Add account CRUD backend | `backend/server.py` | POST/PUT/DELETE `/accounts`. | None | Tests pass; balances update. | Medium |
| MONEY-001 | Use fetched accounts in expense dialogs | `frontend/src/components/ExpenseDialog.jsx`, `EditExpenseDialog.jsx` | Replace hardcoded Cash/Revolut with dynamic `/accounts` list. | ACCT-002 | All accounts selectable. | Medium |
| AUTH-001 | Add change password UI | `frontend/src/pages/Settings.jsx` | Form calling `/auth/change-password`. | None | Password changes successfully. | Medium |

### Phase 5 — Quality, Tests & Documentation (High)

| ID | Task | Files / Components | Steps | Dependencies | Verification | Priority |
|----|------|-------------------|-------|--------------|--------------|----------|
| TEST-001 | Add backend tests for Groceries lists/budget | `backend/tests/test_groceries.py` or extend existing | Cover list CRUD, item CRUD, budget calculations, recurring spawn, suggestions. | GROC-001–GROC-010 | Tests pass. | High |
| TEST-002 | Add Playwright tests for Groceries | `frontend/e2e/groceries.spec.js` | Create list, add item, complete item, delete list, budget visible. | GROC-011–GROC-014 | Tests pass. | High |
| TEST-003 | Add Playwright tests for Nutrition manual forms | `frontend/e2e/nutrition.spec.js` | Add meal/recipe. | NUTR-001, NUTR-002 | Tests pass. | Medium |
| TEST-004 | Add backend unit tests for helpers | `backend/tests/test_helpers.py` | Test `compute_shares`, `serialize_txn`, `cheapest_store`, etc. | None | Tests pass. | Medium |
| TEST-005 | Externalize test credentials | `frontend/e2e/fixtures.js`, `backend/tests/*.py` | Read from env with fallback; document for CI. | None | Tests run without hardcoded secrets in CI. | Low |
| DOC-001 | Update README.md with Groceries features | `README.md` | Document multiple lists, shopping mode, budget, AI tools, config. | GROC phases | README accurate and complete. | High |
| DOC-002 | Update README.md with testing instructions | `README.md` | Document backend tests, e2e tests, lint commands. | TEST phases | README accurate. | Medium |

### Phase 6 — Production Hardening (Medium)

| ID | Task | Files / Components | Steps | Dependencies | Verification | Priority |
|----|------|-------------------|-------|--------------|--------------|----------|
| SEC-001 | Rotate JWT secret | `backend/.env` production | Strong random secret; not committed. | P1-003 | Deployment uses strong secret. | High |
| SEC-002 | Secure admin password | `backend/.env` production | Strong unique password. | P1-003 | Admin login works with new password. | High |
| SEC-003 | Rotate Gemini API key | `.env` production | If current key was exposed. | None | AI works with new key. | Medium |
| SEC-004 | Use dedicated DB user | Production deployment | Grant least privilege to `liferecord` DB. | None | App connects and operates. | High |
| SEC-005 | Distributed rate limiting | `backend/server.py` | Replace in-memory store with Redis-backed limiter. | None | Rate limits survive restart. | Medium |
| SEC-006 | httpOnly cookie option | `backend/server.py`, frontend | Optionally support cookie-based tokens. | None | Tokens not in localStorage. | Low |
| SEC-007 | Content Security Policy | Reverse proxy or middleware | Add CSP header. | None | Header present. | Low |

---

## 12. Master Checklist

Use the IDs below to track progress. Update the status column as work is completed.

### Foundation & Fixes

| ID | Task | Priority | Status |
|----|------|----------|--------|
| P1-001 | Fix PersonDetail route edit/delete | Critical | Completed |
| P1-002 | Fix transaction grocery rollback bug | Critical | Completed |
| P1-003 | Rotate dev secrets & document production config | Critical | Completed |
| P1-004 | Add database migration framework (Alembic) | High | Completed |

### Groceries Upgrade

| ID | Task | Priority | Status |
|----|------|----------|--------|
| GROC-001 | Add `shopping_lists` table and migrate items | Critical | Completed |
| GROC-002 | Extend `ShoppingItem` model | Critical | Completed |
| GROC-003 | Extend `Grocery` model for favorites/defaults | High | Completed |
| GROC-004 | Implement shopping list CRUD backend | Critical | Completed |
| GROC-005 | Implement shopping item CRUD backend | Critical | Completed |
| GROC-006 | Add budget tracking backend | High | Completed |
| GROC-007 | Add recurring lists backend | Medium | Not started |
| GROC-008 | Add frequently bought suggestions backend | Medium | Not started |
| GROC-009 | Add low-stock reminders backend | High | Completed |
| GROC-010 | Update analytics summary for groceries | High | Completed |
| GROC-011 | Build multiple lists UI | Critical | Completed |
| GROC-012 | Build shopping mode UI | Critical | Completed |
| GROC-013 | Add item-level edit/complete/restore/remove UI | Critical | Completed |
| GROC-014 | Add budget tracking UI | High | Completed |
| GROC-015 | Add recurring lists UI | Medium | Not started |
| GROC-016 | Add suggestions UI | Medium | Not started |
| GROC-017 | Add low-stock reminders UI | High | Completed |
| GROC-018 | Add price history chart UI | Low | Not started |

### AI Integration

| ID | Task | Priority | Status |
|----|------|----------|--------|
| AI-001 | AI tools for shopping list management | High | Completed |
| AI-002 | AI tools for shopping items | High | Completed |
| AI-003 | AI tools for grocery budget/summary | High | Completed |
| AI-004 | AI tool for price query | Medium | Completed |
| AI-005 | Confirmation for destructive AI grocery actions | High | Partial (submit_purchase & delete_shopping_item confirm) |
| AI-006 | Improve AI action undo | Medium | Not started |
| AI-007 | Load chat history in UI | Medium | Not started |

### Dashboard & Cross-Module

| ID | Task | Priority | Status |
|----|------|----------|--------|
| DASH-001 | Expand grocery dashboard widgets | High | Completed |
| DASH-002 | Add dashboard quick actions | Medium | Completed |
| DASH-003 | Sync dashboard with mutations | High | Completed |
| CAL-001 | Implement calendar grid | Medium | Not started |
| CAL-002 | Show grocery/meal events on calendar | Low | Not started |
| NUTR-001 | Add manual meal form | High | Not started |
| NUTR-002 | Add manual recipe form | High | Not started |
| NUTR-003 | Add recipe edit/delete backend | Medium | Not started |
| NUTR-004 | Add meal edit backend | Medium | Not started |
| TASK-001 | Add task edit/priority/due UI | High | Not started |
| FIT-001 | Add workout edit/delete UI | Medium | Not started |
| FIT-002 | Add workout edit backend | Medium | Not started |
| BODY-001 | Add weight/photo edit UI | Low | Not started |
| BODY-002 | Add weight edit backend | Low | Not started |
| QUICK-001 | Replace QuickAdd workout placeholder | Medium | Not started |
| ACCT-001 | Add account management UI | Medium | Partial (Money tab supports add/edit/delete/transfer; Settings still missing) |
| ACCT-002 | Add account CRUD backend | Medium | Completed |
| MONEY-001 | Use fetched accounts in expense dialogs | Medium | Completed |
| AUTH-001 | Add change password UI | Medium | Not started |

### Quality, Tests & Documentation

| ID | Task | Priority | Status |
|----|------|----------|--------|
| TEST-001 | Backend tests for Groceries lists/budget | High | Completed (list/item CRUD, partial purchase, generate list, budget fields covered) |
| TEST-002 | Playwright tests for Groceries | High | Not started |
| TEST-003 | Playwright tests for Nutrition manual forms | Medium | Not started |
| TEST-004 | Backend unit tests for helpers | Medium | Not started |
| TEST-005 | Externalize test credentials | Low | Not started |
| DOC-001 | Update README.md with Groceries features | High | Not started |
| DOC-002 | Update README.md with testing instructions | Medium | Not started |

### Production Hardening

| ID | Task | Priority | Status |
|----|------|----------|--------|
| SEC-001 | Rotate JWT secret | High | Not started |
| SEC-002 | Secure admin password | High | Not started |
| SEC-003 | Rotate Gemini API key | Medium | Not started |
| SEC-004 | Use dedicated DB user | High | Not started |
| SEC-005 | Distributed rate limiting | Medium | Not started |
| SEC-006 | httpOnly cookie option | Low | Not started |
| SEC-007 | Content Security Policy | Low | Not started |

### Bugs & Debt

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BUG-001 | Fix transaction grocery rollback bug | Critical | Completed |
| BUG-002 | Fix PersonDetail route edit/delete | Critical | Completed |
| BUG-003 | Use fetched accounts in ExpenseDialog | Medium | Completed |
| BUG-004 | Remove dead fetch logic in PersonDetailModal | Low | Not started |
| BUG-005 | Fix or remove sonner next-themes wrapper | Low | Not started |
| DEBT-001 | Consider splitting monolithic server.py | Medium | Not started |
| DEBT-002 | Remove unused dependencies | Low | Not started |
| DEBT-003 | Adopt Alembic | Medium | Completed |
| DEBT-004 | Persist AI pending confirmations | High | Not started |
| DEBT-005 | Reduce test dependency on running backend | Medium | Not started |
| DEBT-006 | Improve error logging in catch blocks | Low | Not started |

---

## Audit Summary

- **Total tasks identified:** 78
- **By priority:** Critical 9, High 26, Medium 31, Low 12
- **Main blockers:** None technical; services run via `start-all.ps1`. The largest remaining blocks are Calendar grid, Nutrition manual forms, Tasks edit UI, and Settings account management. Groceries only has recurring lists, suggestions, and price-history chart remaining.
- **Pre-existing uncommitted changes:** Custom confirmation dialogs were recently added in `frontend/src/pages/*.jsx` and `frontend/src/components/ConfirmDialog.jsx`; these are preserved and noted.
- **File location:** `C:\Projects\LifeRecord\APPLICATION_COMPLETION_ROADMAP.md`

---

## 13. Work Log / Stopping Point

**Last session:** 2026-10-20

### Completed in this session
- **Money system overhaul:**
  - Added `initial_balance` to `Account` to calculate "money that left the bank".
  - Added `is_locked` to `Account`; hotel safety deposit excluded from available money.
  - New `Money.jsx` with bank / cash / Revolut cards, sub-places, transfers, locked-funds indicator, and actual-spending card.
  - AI tools: `get_accounts`, `transfer_money`, `update_account_balance`; account resolution in expense/refund tools.

- **Groceries full workflow + polish:**
  - Added `shopping_lists` table with `budget`, extended `ShoppingItem` (category, estimated/actual price, store, completed_at, sort_order, selected).
  - Backend endpoints: list CRUD, item CRUD, toggle selection, bulk delete/update, partial-purchase submit, generate into list, `/groceries/low-stock`.
  - Budget tracking backend + UI (list budget input, progress bar, remaining/over-budget indicator).
  - Low-stock reminders backend + UI (amber alert card on Groceries page).
  - Analytics summary now returns `grocery.active_lists`, `pending_total`, and richer data.
  - Rewrote `Groceries.jsx`: inventory tab with filters/low-stock; shopping tab with multiple lists, cart selection, bulk actions, submit review, price intelligence.
  - Rewrote `Home.jsx` grocery widget with active lists, pending counts, low-stock, and quick-action chips.
  - AI tools: `get_groceries`, `get_shopping_lists`, `create_shopping_list`, `add_shopping_item`, `update_shopping_item`, `delete_shopping_item`, `submit_purchase`, `get_grocery_summary`, `set_shopping_list_budget`, `get_price_history`.
  - Added backend tests for partial cart purchase, generate-list-not-touching-inventory, list budget, low-stock, and analytics integration.

### Test results
- Backend: **54 passed**
- Frontend e2e: **7 passed**
- `yarn build`: success, no ESLint warnings

### Stopping point
Groceries is now functionally complete except for recurring lists, frequently bought suggestions, and price-history chart. **Next recommended tasks:**
1. **GROC-007 / GROC-015** — Recurring lists
2. **GROC-008 / GROC-016** — Frequently bought suggestions
3. **GROC-018** — Price history chart UI
4. **NUTR-001 / NUTR-002** — Manual add meal/recipe forms
5. **TASK-001** — Task edit/priority/due UI
6. **CAL-001** — Calendar grid
