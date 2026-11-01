> **ARCHIVE (read-only history).** The active plan is [`APPLICATION_COMPLETION_ROADMAP.md`](../../APPLICATION_COMPLETION_ROADMAP.md). This file is the roadmap exactly as it stood on 2026-10-30 before the final restructuring; where it disagrees with the active roadmap, the active roadmap is right. Its section numbers (§16, §17, §17b) are cited by older notes.

# LifeRecord Application Completion Roadmap

**Project:** `C:\Projects\LifeRecord`  
**Audit date:** 2026-10-19  
**Scope:** Full-stack audit of the LifeRecord application covering frontend, backend, database, AI integration, tests, configuration, and documentation.
**Current status (2026-10-29): see [§16](#16-final-status-2026-10-29). The sections below are the original audit and a chronological log; where they disagree with §16, §16 is right.**

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
13. [Previous Work Log](#13-work-log--stopping-point)
14. [Current Work Log](#14-work-log--stopping-point)
15. [Work Log: roadmap completion (2026-10-28 / 29)](#15-work-log--roadmap-completion-2026-10-28)
16. [Final status and SendGrid audit](#16-final-status-2026-10-29)

---

## 1. Executive Summary

LifeRecord is a multi-user personal-life management application built with a FastAPI backend and a React frontend. It currently provides working modules for finances, people/debts, tasks, fitness, body/weight, nutrition, groceries, progress photos, and an AI assistant powered by Google Gemini. Authentication includes email verification, password reset, refresh tokens, and per-user data isolation.

**Overall maturity:** The backend is broadly functional and data isolation is enforced. Money, People, and Groceries backend workflows are polished and dynamic. Groceries received a major backend redesign (food catalog, storage locations, appliances, inventory workflows, AI tools). The biggest remaining functional gap is the **Groceries frontend visual redesign** (storage-area UI, catalog browser, kitchen appliances panel). Other remaining gaps: Calendar grid, Nutrition manual forms, Tasks edit/due/priority UI, and Settings account management.

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
- Groceries (backend): inventory CRUD with storage locations, low-stock/expiring alerts, product catalog, shopping lists with budgets/progress, recurring lists, price intelligence, partial-purchase submit, inventory move/consume/discard, AI tools for catalog/storage/recipes.
- Nutrition: redesigned 2026-10-29 (food database, diary with portions, nutrients, hydration, trends, goals); see §17.
- AI assistant: chat, receipt scan, voice transcription, action history/undo, tool calling for many domains.
- Dashboard: summary stats, widgets for nutrition, people, groceries, tasks.

### 3.2 Partially Implemented / Placeholder

- **Groceries:** backend redesign complete (catalog, storage locations, appliances, inventory workflows, AI tools). Frontend visual redesign (storage-area cards, catalog browser, kitchen appliances panel) still pending.
- **Groceries data:** realistic inventory and one shopping list seeded; old random test records removed.
- **Calendar:** task list only, no calendar grid.
- **Tasks:** no edit, due date, priority, or recurring UI.
- **Nutrition:** manual forms existed from 2026-10-22; the whole page was rebuilt on 2026-10-29 (§17).
- **PersonDetail route:** edit/delete callbacks just navigate away.
- **QuickAdd workout:** placeholder toast only.
- **Accounts:** CRUD + transfers implemented in Money tab; Settings account management still missing.

### 3.3 Runtime Status at Audit Time

- MySQL, backend and frontend are running locally via `start-all.ps1`.
- Latest run: 61 backend tests pass; frontend `yarn build` succeeds with no ESLint warnings.
- Groceries realistic seed data created: 3 storage locations, 4 appliances, ~148 products, ~37 inventory items, 1 shopping list.
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
| Current state | Backend redesign complete; frontend uses existing multi-list cart UI | `frontend/src/pages/Groceries.jsx`, backend `Grocery`, `Product`, `StorageLocation`, `Appliance`, `ShoppingList`, `ShoppingItem`, `PriceRecord`, `Recipe` |
| Existing functionality | Inventory CRUD with storage locations, low-stock/expiring badges; product catalog CRUD/search; storage-location and appliance CRUD; inventory move/consume/discard; multiple shopping lists with budgets/progress; recurring lists; partial-purchase submit; price intelligence; generate from low stock/usual buys; AI tools for catalog, storage, inventory, recipes, and lists. | |
| Remaining work | Frontend visual redesign: storage-area cards, catalog browser, kitchen appliances panel, responsive shopping-mode UI. | GROC-UI-001 |
| Acceptance criteria | Distinctive, responsive Groceries UI with Overview, Storage, Shopping, Catalog, and Kitchen tabs; seamless AI integration; all CRUD operations tested. | |

### 4.5 Nutrition

| Aspect | State | Notes |
|--------|-------|-------|
| Current state | **Redesigned 2026-10-29** (see §17): five tabs, USDA food database, EFSA/WHO references | `frontend/src/pages/Nutrition.jsx`, `frontend/src/pages/nutrition/*`, `backend/nutrition_api.py` |
| Existing functionality | Today (day ledger, diary by meal, hydration, insights), Nutrients (41 nutrients with completeness), Trends (7/30/90 days, CSV), Foods (database search, own foods, favourites, barcode, recipes), Goals (profile, targets with overrides, sources). | Old fixed targets (2700 kcal / 160 / 300 / 90 g) are gone. |
| Remaining work | Nothing from the original plan. Second delivery (2026-10-30, §17) added the assistant tools, meal plan, shopping list from a plan, recipes calculated from foods, swaps, camera scanning, in-app reminders and the printable summary. Open limits are listed in §17 (adults-only references, no live-model or real-phone verification). | |
| Acceptance criteria | Original: add/edit/delete meals and recipes without AI (met). New criteria are listed per row in §17. | |

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
| GET/POST/PUT/DELETE `/meals` | Working | Older endpoints, kept for Home, Calendar and the AI; they now write the diary fields too. The Nutrition page uses `/api/nutrition/*` (§17). |

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
| GROC-BE-001 | Add Product/StorageLocation/Appliance models & migrations | `backend/models.py`, Alembic | Create models/migration for catalog, storage, appliances; add `storage_location` to groceries/items. | P1-004 | Schema valid; migration applies. | High |
| GROC-BE-002 | Product catalog CRUD/search endpoints | `backend/server.py` | GET/POST/PUT/DELETE `/products`; `/products/search?q=`. | GROC-BE-001 | Tests pass. | High |
| GROC-BE-003 | Storage location & appliance CRUD endpoints | `backend/server.py` | GET/POST/PUT/DELETE `/storage-locations` and `/appliances`. | GROC-BE-001 | Tests pass. | High |
| GROC-BE-004 | Inventory move/consume/discard/expiring endpoints | `backend/server.py` | POST `/groceries/{id}/move`, `/consume`, `/discard`; GET `/groceries/expiring`. | GROC-BE-001 | Tests pass. | High |
| GROC-BE-005 | Realistic grocery seed data | `backend/seed_groceries.py` | Seed storage locations, appliances, ~100 products, ~30 inventory items, 1 shopping list. | GROC-BE-001–004 | Realistic data present; no random test records. | High |
| GROC-BE-006 | AI tools for catalog/storage/recipes | `backend/server.py` AI_TOOLS | `get_products`, `add_product`, `update_grocery_storage`, `consume_grocery`, `get_expiring_items`, `get_storage_locations`, `add_storage_location`, `get_appliances`, `suggest_recipes_from_inventory`, `add_missing_ingredients`. | GROC-BE-002–004 | AI can query/manage catalog, storage, inventory, recipes. | High |
| GROC-UI-001 | Distinctive Groceries frontend redesign | `frontend/src/pages/Groceries.jsx` | Overview, Storage, Shopping, Catalog, Kitchen tabs; visual storage cards; product browser; appliance panel. | GROC-BE-001–006 | Responsive, no build warnings, CRUD operations tested. | Critical |

### Phase 3 — AI Integration for Groceries (High)

| ID | Task | Files / Components | Steps | Dependencies | Verification | Priority |
|----|------|-------------------|-------|--------------|--------------|----------|
| AI-001 | Add AI tools for shopping list management | `backend/server.py` AI_TOOLS | `create_shopping_list`, `update_shopping_list`, `archive_shopping_list`, `duplicate_shopping_list`. | GROC-004 | AI can create/edit lists. | High |
| AI-002 | Add AI tools for shopping items | `backend/server.py` AI_TOOLS | `add_shopping_item`, `update_shopping_item`, `remove_shopping_item`, `mark_item_bought`. | GROC-005 | AI can manage items. | High |
| AI-003 | Add AI tools for grocery budget/summary | `backend/server.py` AI_TOOLS | `get_grocery_summary`, `set_shopping_list_budget`. | GROC-006, GROC-010 | AI reports budgets accurately. | High |
| AI-004 | Add AI tool for price query | `backend/server.py` AI_TOOLS | `get_price_history` using `/prices/{name}`. | None | AI returns real prices. | Medium |
| AI-005 | Add confirmation for destructive AI grocery actions | `backend/server.py` | Use `_pending_confirmations` or persistent state for bulk delete/clear list. | AI-001, AI-002 | User must confirm before destructive action. | High |
| AI-006 | Improve AI action undo | `backend/server.py` | Support restoring updated records where feasible. | AI-001–AI-004 | Undo reverses grocery changes. | Medium |
| AI-007 | Load chat history in UI | `frontend/src/components/AIAssistant.jsx` | Call `/api/ai/history` on open. | None | Previous messages appear. | Medium (Done 2026-10-23, see update) |

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
| TEST-005 | Externalize test credentials | Low | Completed (2026-10-29, Batches 5 + 6a: one source for the owner login in the backend (`tests/support_auth.py`) and e2e (`e2e/fixtures.js`), `TEST_PASSWORD` comes from the encrypted store or the environment and there is no default in code; the missing-password case fails with an explicit message) |
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
| GROC-007 | Add recurring lists backend | Medium | Completed |
| GROC-008 | Add frequently bought suggestions backend | Medium | Completed |
| GROC-009 | Add low-stock reminders backend | High | Completed |
| GROC-010 | Update analytics summary for groceries | High | Completed |
| GROC-011 | Build multiple lists UI | Critical | Completed |
| GROC-012 | Build shopping mode UI | Critical | Completed |
| GROC-013 | Add item-level edit/complete/restore/remove UI | Critical | Completed |
| GROC-014 | Add budget tracking UI | High | Completed |
| GROC-015 | Add recurring lists UI | Medium | Completed |
| GROC-016 | Add suggestions UI | Medium | Completed |
| GROC-017 | Add low-stock reminders UI | High | Completed |
| GROC-018 | Add price history chart UI | Low | Completed |
| GROC-BE-001 | Add Product/StorageLocation/Appliance models & migrations | High | Completed |
| GROC-BE-002 | Product catalog CRUD/search endpoints | High | Completed |
| GROC-BE-003 | Storage location & appliance CRUD endpoints | High | Completed |
| GROC-BE-004 | Inventory move/consume/discard/expiring endpoints | High | Completed |
| GROC-BE-005 | Realistic grocery seed data | High | Completed |
| GROC-BE-006 | AI tools for catalog/storage/recipes | High | Completed |
| GROC-UI-001 | Distinctive Groceries frontend redesign (Overview/Storage/Shopping/Catalog/Kitchen) | Critical | Completed (all five tabs; see 2026-10-22 updates) |

### AI Integration

| ID | Task | Priority | Status |
|----|------|----------|--------|
| AI-001 | AI tools for shopping list management | High | Completed |
| AI-002 | AI tools for shopping items | High | Completed |
| AI-003 | AI tools for grocery budget/summary | High | Completed |
| AI-004 | AI tool for price query | Medium | Completed |
| AI-005 | Confirmation for destructive AI grocery actions | High | Completed (2026-10-28, Batch 4: every destructive AI tool uses the two-step gate) |
| AI-006 | Improve AI action undo | Medium | Completed (2026-10-28, Batch 4: edits and deletes restored; see limits in §15) |
| AI-007 | Load chat history in UI | Medium | Completed (verified 2026-10-28: done in the 2026-10-23 assistant overhaul; checklist was stale) |

### Dashboard & Cross-Module

| ID | Task | Priority | Status |
|----|------|----------|--------|
| DASH-001 | Expand grocery dashboard widgets | High | Completed |
| DASH-002 | Add dashboard quick actions | Medium | Completed |
| DASH-003 | Sync dashboard with mutations | High | Completed |
| CAL-001 | Implement calendar grid | Medium | Completed (2026-10-28, Batch 2) |
| CAL-002 | Show grocery/meal events on calendar | Low | Completed (2026-10-28, Batch 2) |
| NUTR-001 | Add manual meal form | High | Completed |
| NUTR-002 | Add manual recipe form | High | Completed |
| NUTR-003 | Add recipe edit/delete backend | Medium | Completed |
| NUTR-004 | Add meal edit backend | Medium | Completed |
| TASK-001 | Add task edit/priority/due UI | High | Completed (2026-10-28, Batch 1) |
| FIT-001 | Add workout edit/delete UI | Medium | Completed (2026-10-28, Batch 1) |
| FIT-002 | Add workout edit backend | Medium | Completed (2026-10-28, Batch 1) |
| BODY-001 | Add weight/photo edit UI | Low | Completed (2026-10-28, Batch 1) |
| BODY-002 | Add weight edit backend | Low | Completed (2026-10-28, Batch 1; also `PUT /photos/{id}`) |
| QUICK-001 | Replace QuickAdd workout placeholder | Medium | Completed (2026-10-28, Batch 1) |
| ACCT-001 | Add account management UI | Medium | Completed (2026-10-28, Batch 3: Settings add/edit/delete via the dialog shared with Money) |
| ACCT-002 | Add account CRUD backend | Medium | Completed |
| MONEY-001 | Use fetched accounts in expense dialogs | Medium | Completed |
| AUTH-001 | Add change password UI | Medium | Completed (2026-10-28, Batch 3) |

### Quality, Tests & Documentation

| ID | Task | Priority | Status |
|----|------|----------|--------|
| TEST-001 | Backend tests for Groceries lists/budget | High | Completed (list/item CRUD, partial purchase, generate list, budget fields covered) |
| TEST-002 | Playwright tests for Groceries | High | Completed (verified 2026-10-28: `e2e/groceries.spec.js` exists, 9 tests per the 2026-10-22 log; checklist was stale) |
| TEST-003 | Playwright tests for Nutrition manual forms | Medium | Completed (2026-10-29, Batch 5), then rewritten for the redesigned page: `e2e/nutrition.spec.js`, 9 tests (§17) |
| TEST-004 | Backend unit tests for helpers | Medium | Completed (2026-10-29, Batch 5: `tests/test_helpers.py`, 18 tests) |
| TEST-005 | Externalize test credentials | Low | In Progress (2026-10-29, Batch 5: every backend module and e2e spec now takes the owner login from one place — `tests/support_auth.py` / `e2e/fixtures.js` — which reads `TEST_EMAIL`/`TEST_PASSWORD`. Not complete: both still fall back to the old dev password in code; that fallback is removed with SEC-002 once the owner password is rotated) |
| DOC-001 | Update README.md with Groceries features | High | Completed |
| DOC-002 | Update README.md with testing instructions | Medium | Completed |

### Production Hardening

| ID | Task | Priority | Status |
|----|------|----------|--------|
| SEC-001 | Rotate JWT secret | High | Completed (2026-10-29, Batch 6a: new random 512-bit secret, kept only in the encrypted store; `local_secrets.py rotate-jwt` repeats it. All earlier sessions were signed out.) |
| SEC-002 | Secure admin password | High | In Progress (2026-10-29, Batch 6a: the startup seed no longer overwrites the owner's password, the README no longer prints it, `owner_admin.py reset-password` added, the test password moved out of code. **Owner action still required:** the real owner password is still the weak dev value `LifeRecord`; change it in Settings → Password, then run `local_secrets.py set TEST_PASSWORD`.) |
| SEC-003 | Rotate Gemini API key | Medium | Blocked (needs the owner: create new Gemini, OpenCode and SendGrid keys in their dashboards — they were pasted into chats earlier — then `local_secrets.py set GEMINI_API_KEY` etc.; the keys now live only in the encrypted store) |
| SEC-004 | Use dedicated DB user | High | Completed (2026-10-29, Batch 6a: `liferecord_app` has SELECT/INSERT/UPDATE/DELETE/CREATE/INDEX/REFERENCES on `liferecord` only — verified that DROP and `mysql.user` reads are denied; root now has a password; MySQL bound to 127.0.0.1 with the X protocol off; phpMyAdmin asks for a login instead of auto-logging in as root) |
| SEC-005 | Distributed rate limiting | Medium | Completed (2026-10-29, Batch 6b: counters moved from process memory to the `rate_limit_events` table — hashed keys, shared by all processes, survive restarts; no Redis needed for this deployment) |
| SEC-006 | httpOnly cookie option | Low | In Progress (2026-10-29, Batch 6c: the long-lived refresh token is now an HttpOnly cookie in the browser app, with CSRF header check and `/auth/logout`. **Remaining:** the 30-minute access token is still in `localStorage`; moving it into memory needs a boot-time refresh and a change to how the e2e fixtures seed sessions (cookie instead of storage), so the "tokens not in localStorage" criterion is only half met) |
| SEC-007 | Content Security Policy | Low | Completed (2026-10-29, Batch 6c: `frontend/scripts/csp.js` adds the policy to the production build and emits the header form; verified with a production build in a real browser: login, 10 pages and a dialog, 0 CSP violations, 0 console errors. The header itself must be set by whatever serves `build/` in production; that deployment does not exist yet) |

### Bugs & Debt

| ID | Task | Priority | Status |
|----|------|----------|--------|
| BUG-001 | Fix transaction grocery rollback bug | Critical | Completed |
| BUG-002 | Fix PersonDetail route edit/delete | Critical | Completed |
| BUG-003 | Use fetched accounts in ExpenseDialog | Medium | Completed |
| BUG-004 | Remove dead fetch logic in PersonDetailModal | Low | Completed (2026-10-28, Batch 4) |
| BUG-005 | Fix or remove sonner next-themes wrapper | Low | Completed (verified 2026-10-28: `sonner.jsx` uses `useSettings`, no `next-themes` import) |
| BUG-006 | Deleting a single shopping item failed (no `DELETE /shopping/{id}` route; UI showed "Method Not Allowed") | High | Completed (2026-10-28, Batch 2) |
| BUG-007 | Deleting a person leaves the "Payment from …" income their settlements added (orphaned; account balance keeps it), while deleting a settlement or "Clear all debts" removes it | Medium | Completed (2026-10-28: owner decided money already received stays; behaviour pinned by a test, delete dialogs now say so) |
| BUG-008 | Tests left data in the owner account on every run (payments on Revolut, cooked meals, shopping items, registered users, photo files) | High | Completed (2026-10-28, Batch 2) |
| BUG-009 | Test registrations sent real verification emails through SendGrid to `@example.com` addresses (bounces hurt sender reputation) | High | Completed (2026-10-28, Batch 2) |
| BUG-010 | A wrong current password on change-password returned 401, which the app treats as an expired session: one typo signed the user out | High | Completed (2026-10-28, Batch 3) |
| BUG-011 | AI tool `delete_shopping_item` called an undefined function (`del_shopping`): asking the assistant to remove a list item always failed | High | Completed (2026-10-28, Batch 4) |
| DEBT-001 | Consider splitting monolithic server.py | Medium | In Progress (new calendar endpoint lives in `calendar_api.py`; existing routes not moved) |
| DEBT-002 | Remove unused dependencies | Low | Completed (2026-10-28, Batch 4) |
| DEBT-003 | Adopt Alembic | Medium | Completed |
| DEBT-004 | Persist AI pending confirmations | High | Completed (2026-10-28, Batch 4) |
| DEBT-005 | Reduce test dependency on running backend | Medium | In Progress (Batch 1: one cached login per account per run, fixing the rate-limit 429 errors; tests still need the live backend) |
| DEBT-006 | Improve error logging in catch blocks | Low | Completed (2026-10-28, Batch 4) |

---

## Audit Summary

- **Total tasks identified:** 85
- **By priority:** Critical 10, High 30, Medium 31, Low 14
- **Main blockers:** None technical; services run via `start-all.ps1`. The largest remaining block is the Groceries frontend visual redesign (GROC-UI-001). Other remaining blocks: Calendar grid, Tasks edit UI, and Settings account management.
- **Pre-existing uncommitted changes:** None. Latest commit is `be41f11` (groceries redesign backend).
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

- **Groceries remaining polish (done in this session):**
  - Added `RecurringList` model, migration, and backend endpoints (`GET/POST/PUT/DELETE /shopping/recurring`, `POST /shopping/recurring/{id}/spawn`).
  - Added `/groceries/suggestions` endpoint for frequently bought / favorite items.
  - Added price-history chart UI using `/prices/{name}` and recharts.
  - Added recurring-list management UI and one-click suggestion chips to `Groceries.jsx`.
  - Added AI tools: `get_grocery_suggestions`, `get_recurring_lists`, `create_recurring_list`, `spawn_recurring_list`.
  - Fixed `ShoppingItem`/`ShoppingList` relationship so toggle/update endpoints no longer crash.
  - Added backend test for recurring lists and suggestions.

- **Nutrition manual forms (done in this session):**
  - Added `PUT /meals/{id}` and `PUT /recipes/{id}` backend endpoints.
  - Rewrote `Nutrition.jsx` with manual "Add meal" and "Add recipe" dialogs, plus edit/delete for both.
  - Added macro progress rings and improved empty states.

- **People / Money integration (done in this session):
  - Cleared all existing debt records for the current user (settlements and splits deleted; underlying transactions preserved).
  - Payments recorded from the People page now create matching income/expense transactions and update the selected account balance automatically.
  - Added per-person "Clear balance" and "Remove record" actions plus global "Clear all debts" button.

- **AI transaction persistence (done in this session):**
  - Added `record_income` AI tool so the assistant can record income/money received.
  - AI-recorded expenses, income, transfers, and person payments now use the same validated backend workflows as manual entry.
  - `record_payment` AI tool now uses `/settlements`, creating the account-balance transaction automatically.
  - Added `balance_transaction_id` to `Settlement` model + migration so settlement deletions reverse account effects correctly.
  - Added backend test verifying AI records income that appears in transactions and survives refresh.

- **Home dashboard (done in this session):**
  - Added **Today's Transactions** section listing income, expenses, and transfers dated today with type badges and totals.
  - Section refreshes automatically via `useFetch` when `refreshAll()` is dispatched (e.g. after AI actions).

### Test results
- Backend: **56 passed**
- Frontend `yarn build`: success, no ESLint warnings
- Verified AI income recording end-to-end (transaction persisted, listed for today, and cleaned up).

### Stopping point
Groceries, Nutrition manual forms, People/Money integration, and AI transaction persistence are complete. **Remaining tasks for the next session:**
1. **TASK-001** — Task edit/priority/due/recurring UI (backend already supports these fields).
2. **CAL-001** — Calendar grid view (currently task list only).
3. **AI-007** — Load chat history in AI assistant UI.
4. **TEST-002 / TEST-003** — Playwright e2e tests for Groceries and Nutrition.
5. **DOC-001 / DOC-002** — Update README with Groceries features and testing instructions.

---

## 14. Work Log / Stopping Point

**Last session:** 2026-10-21

### Completed in this session
- **Groceries redesign — backend & data:**
  - Added `Product`, `StorageLocation`, and `Appliance` models with Alembic migration.
  - Added `storage_location` to `Grocery` and `ShoppingItem`; `product_id` to `ShoppingItem`.
  - New endpoints: `/products` CRUD + search, `/storage-locations` CRUD, `/appliances` CRUD.
  - New inventory workflows: `/groceries/{id}/move`, `/consume`, `/discard`; `/groceries/expiring`.
  - Extended shopping-list endpoints with duplicate, archive, and storage-location support.
  - New AI tools: `get_products`, `add_product`, `update_grocery_storage`, `consume_grocery`, `get_expiring_items`, `get_storage_locations`, `add_storage_location`, `get_appliances`, `add_appliance`, `suggest_recipes_from_inventory`, `add_missing_ingredients`.
  - Created `backend/seed_groceries.py` and seeded realistic data: 3 storage locations, 4 appliances, ~148 products, ~37 inventory items, 1 shopping list with 10 items.
  - Removed all old random test grocery/shopping records; account balances reverted to opening balances because prior transactions were test-only.
  - Added backend tests for product CRUD, storage locations, inventory move/consume/discard, and expiring items.

- **Documentation:**
  - Updated `README.md` with a Features section (Money, People, Groceries, Nutrition, Home) and a Testing section (backend tests + frontend build).
  - Updated `APPLICATION_COMPLETION_ROADMAP.md`: revised executive summary, current state, page audits, implementation roadmap, master checklist, and added this work log.

### Test results
- Backend: **61 passed**
- Frontend `yarn build`: success, no ESLint warnings
- Realistic grocery data verified via API: 3 storage locations, 4 appliances, ~148 products, ~37 inventory items, 1 shopping list.

### Stopping point
The Groceries backend redesign, data seeding, AI tools, and tests are complete. **The remaining critical item is:**
1. **GROC-UI-001** — Distinctive Groceries frontend redesign with Overview, Storage, Shopping, Catalog, and Kitchen tabs. The current frontend still uses the previous multi-list cart UI; all new backend endpoints and realistic data are ready for the redesigned page.

### Update — GROC-UI-001 Slice 1 (2026-10-22)
- Groceries now has Overview (default), Storage and Shopping tabs; the old Inventory tab is replaced by Storage.
- Storage: interactive kitchen scene (`frontend/src/pages/groceries/`) — fridge, freezer, pantry and custom units with swinging doors, lit interiors and item chips; per-space panel with search, category filter, quick −/+ (consume/add), move, edit, discard (confirmed), multi-select bulk move/discard, add/rename storage spaces. Respects reduced motion; units are keyboard-focusable buttons with `aria-expanded`.
- Verified: `yarn build` clean; Playwright `groceries.spec.js` (2 tests) + existing e2e = 9 passed; backend 61 passed; desktop/mobile screenshots reviewed.
- Pending: Overview insights (Slice 2), Catalog (Slice 3), Kitchen appliances + recipe suggestions endpoint (Slice 4), AI "kitchen awareness".

### Update — GROC-UI-001 Slice 1b (2026-10-22): zoom-in kitchen, realistic data, AI parity
- **Zoom-in kitchen:** selecting a space zooms into it (door opens, items on shelves as tappable chips, most urgent first); the other spaces shrink into a speed-dial rail to switch with one tap; "All spaces" / Esc zooms back out; "More details" opens the full management panel under the unit. Reduced-motion respected.
- **Realistic data:** `backend/seed_groceries.py` rewritten (run `python seed_groceries.py --reset`): Fridge/Freezer/Pantry/Spice rack, ~62 everyday items with expiry dates relative to today (one forgotten past its date, a few expiring within days, some staples low), realistic prices/stores, 5 recipes whose ingredients match inventory names, a "Weekly shop" list with budget, 8 appliances, ~100-item catalog using the app's categories.
- **AI parity:** new tools `discard_grocery` (two-step confirmation), `update_storage_location`, `get_kitchen_overview`; `add_grocery`/`update_grocery` accept `storage_location` and `expiration`; move/consume/discard work by item name; storage references are validated and canonicalised (name or kind, any case); renaming a space keeps its items attached (backend); rejected tool calls are returned to the model as errors instead of failing the chat or being reported as success.
- **Fixed:** a backend test leaked `TEST2_*_stock` rows into the owner's inventory on every run.
- **Verified:** `yarn build` clean; backend 69 passed (incl. 6 in-process AI-tool tests + 2 storage-reference tests); Playwright groceries spec (3 tests) passing; live Gemini run: kitchen overview answer, add → move → consume → rejected unknown space → discard preview → confirmed discard, each checked against the database; desktop/mobile/dark screenshots reviewed.
- **Known:** running the whole Playwright suite back-to-back can trip the auth rate limit (10 logins/min) and fail one login; rerunning the failed spec alone passes.

### Update — Groceries polish pass (2026-10-22): themed controls, scroll fix, actionable Overview
- **Scroll reset fixed:** switching spaces remounted the unit (div ↔ button swap) and the details panel (`key`), collapsing the page height so the browser jumped to the top. Units are now one stable element with an overlay button, the panel stays mounted and resets its filters in an effect, focus moves to the opened unit with `preventScroll`. Covered by a Playwright test that scrolls, switches space and asserts `scrollY` holds.
- **Browser-default controls replaced app-wide:** themed `DatePicker` (with quick picks) for all 6 native date inputs; Radix `Checkbox` for all 6 native checkboxes; number spinners removed globally; native `title` tooltips replaced with themed `Hint` tooltips; Sonner toasts now follow the in-app theme; dialogs/alert dialogs/popovers/selects/menus share rounded, blurred-backdrop styling. Audit found no `window.confirm/alert/prompt` and no native `<select>` in the app (already Radix).
- **Groceries redesign:** Overview now lists "Use these soon" (tap → zooms into that space) and "Running low" (one-tap add to the selected list); Storage selection lives in the page so it survives tab switches; inventory dialog has labelled fields, a staple checkbox and the date picker.
- **Verified:** `yarn build` clean; Playwright groceries spec 6/6 (full suite 12/13: one People test flaked and passed alone); desktop, mobile and dark screenshots reviewed.
- **Known:** the Shopping tab keeps its previous layout (only controls re-themed); remaining pages (Money, Nutrition, ...) got the shared controls but not a layout redesign.

### Update — Groceries slices 2–4 complete, budget fixes (2026-10-22)
- **Budget field:** empty = no budget (placeholder "No budget"), `0` stays `0` and shows "Recommended budget" (one-tap apply), any value shows progress/remaining. Saves on blur/Enter only, one deduplicated toast, text input (a trackpad scroll can no longer change it or spam toasts). Backend: an explicit `null` now clears a list budget. Global guard: a scroll over a focused number input blurs it first.
- **Slice 2 (Overview):** stock value and "expires within 3 days" value (only shown when ≥50% of stocked items have a price, with coverage stated), "Cook with what you have" top 3, use-soon rows jump into the zoomed space, low-stock rows add straight to the list. "Food waste avoided" intentionally not shown: nothing records it reliably yet.
- **Slice 3 (Catalog):** search (name + alternative names), category chips with counts, favourites, add/edit/remove product with nutrition, add to inventory (prefilled dialog) or to the selected list.
- **Slice 4 (Kitchen):** `kitchen_logic.py` (unit-aware g/kg and ml/L matching, plural/qualified names, expiry-aware ranking); `GET /recipes/suggestions`, `POST /recipes/{id}/add-missing` (shopping-list entries only, editable quantities, never inventory); cook is now unit-aware and refuses to guess across incompatible units. Kitchen tab: recipe cards with per-ingredient status, ready/missing, uses-expiring note, Add missing to a list, confirmed Cook; appliance CRUD. AI `suggest_recipes_from_inventory` / `add_missing_ingredients` use the same logic.
- **Bug fixed:** `PUT /recipes/{id}` returned 500 (double `model_dump`), so editing a recipe on the Nutrition page failed. Seed recipes now store whole-recipe nutrition totals.
- **Verified:** backend 81 passed (9 pure-logic tests, recipe suggestion/add-missing/cook/edit, budget clear/zero); `yarn build` clean; Playwright groceries spec 9/9 (full suite 15/16, one People login flake that passes alone); live AI: ranked recipes around expiring food, added nothing duplicate, inventory unchanged; desktop/mobile/dark screenshots reviewed.
- **GROC-UI-001:** all five tabs (Overview, Storage, Shopping, Catalog, Kitchen) implemented and verified.

### Update — Groceries data rendering without flashes (2026-10-22)
- **Cause:** the page mounted with empty state, so every "nothing here" message and placeholder rendered until nine requests returned; the first visit also fetched twice (list id unknown until the first response).
- **Fix:** `lib/swrCache.js` (stale-while-revalidate, per-user keys, memory + localStorage, 7-day max age, cleared on logout and failed token refresh); `lib/groceriesData.js` (one fetch for the page + `prefetchGroceries`). Groceries starts from the last-seen data and refreshes silently; a cold start shows a skeleton instead of empty states; the budget field shows a skeleton until its summary exists; the selected list id is cached so there is no second fetch. Data is prefetched when idle after sign-in and on nav hover/focus/touch.
- **Verified:** Playwright with every API response delayed 1.5 s: skeleton on a cold start, last-seen data visible within 800 ms on return, and a DOM observer saw no empty-state text at any point; cache is removed on sign-out. `yarn build` clean.
- **Not applied elsewhere yet:** Home, Money, Nutrition, etc. still use `useFetch` without a cache; the same library can be adopted there (candidate: add an optional cache key to `useFetch`).

### Update — Smooth rendering and navigation on every page (2026-10-22)
- **Shared query layer** (`lib/query.js`, `lib/useFetch.js`): every `useFetch` page now paints its last-seen data instantly and refreshes in the background; `loading` is true only when there is nothing to show. Requests are de-duplicated; a forced reload (after a change) never joins an older in-flight request, and only the newest response may update the cache. Money, Fitness and the expense/quick-add/receipt dialogs use the same cache (dialog dropdowns are populated instantly).
- **Cross-page freshness:** after any change (`refreshAll`), cached data for pages you are not on is refreshed in the background (debounced), so numbers are current when you arrive.
- **Navigation:** every page is its own lazy chunk (main bundle 450 kB → 283 kB gzipped); chunks are fetched when idle after sign-in and on nav hover/focus/touch, together with each page's data (`lib/routes.js`). Short 180 ms fade between pages (disabled by reduced motion / animations off), scroll resets to top, a page-shaped skeleton covers any chunk still downloading.
- **No empty-state flashes:** gated Home (all widgets), Calendar, Fitness, Nutrition recipes, Body photos and Settings categories on "data loaded".
- **Privacy note:** cached API responses are stored in the browser's localStorage under the signed-in user's id and removed on sign-out / failed token refresh.
- **Tests:** new `pages-smooth.spec.js` (all 10 pages revisited with every API response delayed 1.5 s must show content within 300 ms; cold starts across 8 pages must show skeletons and no empty-state text; a change on Tasks must reach Home). e2e fixture now logs in once through the API (UI logins are rate limited to 10/min, which made the suite flaky). Full e2e 21/21; `yarn build` clean. The cold-start test caught and led to fixing two real flashes (Nutrition recipes, Body photos).

### Update — Assistant overhaul on Gemini (2026-10-23)
- **Provider:** stays Gemini. OpenCode was checked (key valid, `gpt-6-luna` listed on the Responses API at `https://opencode.ai/inference/openai/v1/responses`) but every model call returned 402 "Insufficient account funds", so no live test was possible and nothing was switched. No OpenCode key is stored in the repo or `.env`.
- **Backend:** streaming endpoint `/ai/chat/stream` (SSE) with model fallback before the first token; new `ai_tools_extra.py` with 22 tools (overview, transactions search, categories, tasks/calendar, people, meals, recipes, workouts, weight) that reuse the REST functions; deletes use the existing two-step confirmation gate; page and recent-change context injected into the prompt; formatting rules in the system prompt; empty replies after tool use are retried once; tool results are made JSON-safe (Decimals, list results) — this fixed a real failure where `get_accounts` / `get_overview` crashed the chat; reads no longer count as "changes" or create Activity entries.
- **Frontend:** panel rebuilt (`components/ai/*`, `lib/aiStream.js`, `lib/aiFormat.js`): streaming text with caret, typing indicator and live tool labels, Stop, retry without duplicating the question, copy, change chips, history loaded on open (AI-007), new chat, draft kept across close/reload, auto-growing input, Enter/Shift+Enter/Esc/ArrowUp, focus trap and return, `aria-live` log, reduced-motion support, bottom-sheet on phones. Amounts render in the mono face; `**2.00€**`-style output is normalised to `€2.00`; tables right-align numbers.
- **Verified:** backend 113 passed (19 new in `test_ai_extra_tools.py`: tools, confirmations, user isolation, scripted streaming, context, error and empty-reply handling); frontend unit tests 6/6; Playwright 30/30 (8 new in `ai-assistant.spec.js`, including a live Gemini round trip that answers from real data and creates a task visible on the Tasks page); `craco build` clean; live streaming checked with real Gemini (overview, tasks, transactions, kitchen).
- **Known limits:** voice and receipt scanning still depend on Gemini; first token after tool calls takes about 5 s on `gemini-3.5-flash-lite`; the table header for a numeric column stays left-aligned while its cells are right-aligned.

### Update — Chat moved to OpenCode Go with gpt-6-luna (2026-10-23)
- **Root cause of the earlier 402 "Insufficient account funds":** the keys belong to an OpenCode Go subscription, but the first probes called the pay-as-you-go Console endpoint (`/inference/openai/v1/...`), which bills prepaid credits and had none. The Go endpoint is `/inference/go/openai/v1/...` and additionally requires an `x-opencode-session` header. Confirmed with sanitized requests (Console 402; Go without the header 400 `MissingSessionID`; Go with it 200 from `gpt-6-luna`).
- **Change:** new `backend/ai_opencode.py` (Responses API, SSE streaming, function tools, retry once on 429/5xx, user-safe error messages that never include the key); chat loop in `server.py` is now provider-neutral (`AI_PROVIDER=opencode|gemini`, default opencode, no automatic switching); voice transcription and receipt scanning stay on Gemini. `.env.example` files updated with placeholders; `httpx` added to requirements.
- **Fixes found on the way:** a delete preview was reported as a change; delete tools now explain when `confirm` may be set and the prompt tells the model to confirm straight away; user and assistant messages could get identical timestamps on Windows and load in the wrong order (reply now strictly later).
- **Verified:** live requests through the app's streaming endpoint on `gpt-6-luna` (multi-tool lookups, table, create task, "make it high priority", "delete that task" with preview then confirmed delete; leftover test tasks removed); Gemini receipt and voice endpoints still return 200; backend 127 passed (14 new adapter tests with a fake provider); Playwright assistant spec 8/8 including the live model round trip; `craco build` compiled successfully.
- **Open points:** Go's docs describe it as designed for coding agents with abuse monitoring and single-member workspaces, so using it for a general app is the account owner's call; replies take about 5 s per tool step (a three-lookup question took about 20 s); Go's 5-hour/weekly/monthly limits will surface as a "usage limit" message; rotate the two API keys that were pasted into chat.

### Update — Saved chats and scheduled AI tasks (2026-10-23)
- **Saved chats:** `ai_conversations` table (+ `meta` on `ai_messages` so tool chips survive a reopen); server-side search over titles and message text, sort, archive/restore, rename, delete; auto-title after the first exchange (user titles never overwritten); another user's session id is never reused. UI: assistant menu with grouped chat list, save state (Saved / Saving / Not saved + retry), offline notice with last-seen list, draft kept across chat switches, wide panel with docked menu and a phone drawer. Started fresh (old unlisted history was not imported).
- **Scheduled tasks:** `scheduled_tasks`, `scheduled_task_runs`, `report_recipients`; schedule maths with daily/weekly/monthly/interval/once in the task's timezone (DST gap and overlap handled); DB-backed scheduler with compare-and-set claiming and a unique run key; missed-run catch-up/record, restart recovery, 120 s timeout, one retry on transient provider errors; read-only report engine limited to the chosen data areas; plain-language drafting, live schedule preview, report preview without email, explicit confirmation to activate, re-confirmation when what it reads or who receives it changes; per-recipient delivery status with retry that skips recipients already reached; recipient verification by emailed code; limits (20 tasks, 10 manual runs/h, 30 scheduled runs/day).
- **Email:** SendGrid over HTTPS (`email_service.deliver`, honest `sent / failed / not_configured`, key redacted from errors; account emails use it when configured). **Not verified live:** no verified sender address is configured (`SENDGRID_FROM_EMAIL`), so no real email has been sent; the SendGrid key was checked read-only (valid, `mail.send` scope) and the request/response handling is tested against a fake SendGrid.
- **Bugs found by the new tests and fixed:** browsers blocked rename/archive because CORS did not allow `PATCH`; a transient-error retry touched an expired ORM object; provider errors could echo the API key; the task list did not refresh after background changes.
- **Verified:** backend 222 passed (95 new: schedule logic and DST, claiming/duplicates/restart recovery/read-only/injection/delivery with fakes, SendGrid adapter, conversations, scheduling API incl. isolation and verification); frontend unit tests 6/6; Playwright 48/48 (saved chats 9, scheduled tasks 9 incl. a real model draft, a real preview/run-now, and a real unattended scheduled run that fired once and completed); production build compiled.
- **Not covered / limits:** real email delivery; the 10-manual-runs/hour limit has no automated test; multi-process scheduling was tested with concurrent claimers in one process only; Go usage limits apply to scheduled runs; chat image files are not removed if a whole user account is deleted (no account-deletion feature exists yet).

### Update — SendGrid sender set; images kept with saved chats (2026-10-23)
- **Email verified live:** `SENDGRID_FROM_EMAIL=tiagosa743@gmail.com` configured in the git-ignored `backend/.env`; one test email sent through the app's own delivery code to that address was accepted by SendGrid (HTTP 202). Acceptance is not inbox delivery: check the inbox and spam folder. A repo-wide scan found no key in any tracked or untracked file. The SendGrid key was pasted into a chat, so rotating it in SendGrid is still recommended.
- **Chat images:** pictures attached to a chat message are validated by file content, stored under `STORAGE_DIR/chat_images/<user>/<chat>/`, shown again when the chat is reopened (fetched with the user's login), served only to the owner, kept on archive and deleted with the chat; a storage failure never loses the chat. Backend tests (14: types, spoofed MIME, size limits, isolation, deletion, path safety) and browser tests with the real assistant (it described the picture's colour correctly, the picture reappeared after a reload, and it was removed on delete).

---

## 15. Work Log — Roadmap completion (2026-10-28)

**Branch:** `feature/roadmap-completion`. Pre-existing uncommitted work from earlier sessions was committed first as `c03b379`; generated `graphify-out/` and the Obsidian export `LifeRecord/` are now git-ignored.

**Context sources:** Graphify graph (`graphify-out/graph.json`, built at `d12bfa3`) was queried by reading the JSON (the `graphify` CLI is not installed); the Obsidian vault `LifeRecord/` is the graphify export only. Every finding was re-checked against the code because 41 files had changed since the graph was built.

**Decisions taken with the owner (2026-10-28):** secrets move to a DPAPI-encrypted file outside the project (`%LOCALAPPDATA%\LifeRecord\`); security scope = "every session private, every account and its credentials only available to the user"; heavy hardening tasks at the implementer's judgement; tests may run everything except specs that call the live AI model; commit per batch on the branch.

**Baseline before changes:** backend 234 passed + 2 errors (both `TestMultiUserIsolation` setup hitting the auth rate limit, 429), pre-existing.

### Batch 1 — Edit flows (TASK-001, FIT-001, FIT-002, BODY-001, BODY-002, QUICK-001) — Completed
- **Backend (`server.py`):** `PUT /workouts/{id}`, `PUT /weight/{id}`, `PUT /photos/{id}` (note + date; deleted photos are not editable), all scoped to the signed-in user and 404 for anything else. Dates on weight/workout/photo/task bodies must be `YYYY-MM-DD` (they are stored as text and sorted as text). `TaskBody` now only accepts priority `low|normal|high` and recurring `daily|weekly|monthly` (blank = none); existing rows were checked first and all conform. Completing a repeating task that has a due date creates the next one (daily +1 day, weekly +7, monthly same day clamped to month end) — only on the not-done → done transition, so re-saving a completed task does not duplicate it. The AI `update_task` tool can now set `recurring` and goes through the same code path.
- **Frontend:** new shared `components/WorkoutDialog.jsx` (log + edit, date and notes fields; uneven sets such as 8, 6 are shown and kept unless the numbers are changed). Fitness history rows have Edit/Delete; Tasks has an edit dialog (title, priority, due with quick picks, repeat — disabled until a due date exists), repeat icon and overdue colouring; Body has an edit dialog for check-ins (weight, date, note) and photos (date, note), and shows check-in notes. QuickAdd "Workout" opens the workout form instead of the "coming soon" toast. Row actions that were hover-only are now always visible on small screens and on keyboard focus, with accessible labels.
- **Tests:** new `backend/tests/test_body_fitness_edit.py` (7) and `test_tasks_edit.py` (6, incl. month-end and no-duplicate cases) written first and seen failing (405) before the endpoints existed. New `tests/support_auth.py` + `tests/conftest.py`: one login per account per run, cached in a temp file shared by the xdist workers, re-validated with `/auth/me`, deleted at the end of the run; 8 modules switched to it. Fixed an invalid-escape `DeprecationWarning` in `test_conversations.py`. New `frontend/e2e/edit-flows.spec.js` (4 tests).
- **Verified:** backend **249 passed, 0 errors, 0 warnings** (`pytest tests -q`); new e2e 4/4; regression e2e smoke + pages-smooth + people 10/10; `craco build` "Compiled successfully" with no ESLint warnings; scripted browser pass over Tasks/Fitness/Body/QuickAdd with every new dialog opened: no console warnings or errors.
- **Remaining / notes:** the `fs.F_OK` deprecation printed by the build comes from build tooling on Node 24 (pre-existing). Checklist rows that were stale (AI-007, TEST-002, BUG-005) were corrected after checking the code.

### Batch 2 — Calendar (CAL-001, CAL-002) + data-integrity fixes found while verifying — Completed
- **Backend:** new `backend/calendar_api.py` (registered like `conversations_api`, keeps `server.py` from growing): `GET /api/calendar?start&end` (ISO dates, forwards, max 100 days) returns sorted events of kind `task` (due), `expiry` (food in stock with an expiry date; flagged `expired`), `shopping` (recurring list next due = last spawn + interval, or today if overdue / never spawned), `workout`, `weight` and `meals` (one per-day summary with count and kcal). User-scoped; 401 without login.
- **Frontend:** `pages/Calendar.jsx` rewritten as a month grid (Mon–Sun, outside days dimmed, today highlighted, up to 3 labelled chips + "+N more"; coloured dots on phones) and a week view; prev/next/Today; filter chips per kind (remembered per browser); day panel listing the day's items with links to their page and a checkbox to complete tasks (repeating tasks schedule the next). Built with `date-fns` rather than react-day-picker (v8 is a date picker; multi-event cells fight its cell API). `lib/calendarRange.js` shares the range/path with the route prefetch in `lib/routes.js`, so revisits paint from cache. The static "Weekly body check-in" card was replaced by real weigh-ins on the grid.
- **BUG-006 (found while verifying):** the Groceries page removes a single shopping item with `DELETE /shopping/{id}`, but that route never existed (the API inventory in §5.7 listed it as working). Added the route (user-scoped, 404 otherwise); icon-only Edit/Delete buttons on shopping rows got accessible names.
- **BUG-008 (found while verifying):** the calendar showed test data in the owner account. Causes and fixes: people-payment tests deleted the person but not the settlement, leaving "Payment from TEST…/E2E…" income on Revolut (+€82.00 over 26 transactions; tests now delete their settlements/transactions); cooking tests left `TEST2_*` meals (72; module teardown added); shopping-item cleanup silently hit the missing route above (11 items); auth tests never removed registered users (710 `…@example.com` accounts; module teardown added, deleting only the exact patterns the tests generate); photo delete was a soft delete that kept the file. All leftovers were removed through the API where side effects matter — Revolut balance went from €101.43 to €19.43, exactly the fake income. `testuser1@example.com` was kept (no current test creates it; origin unknown).
- **Photo delete is now real:** `DELETE /photos/{id}` removes the row and then the file (progress photos are private; "cannot be undone" in the UI is now true).
- **Tests:** `test_calendar.py` (6), `test_shopping_item_delete.py` (2), photo hard-delete test; `e2e/calendar.spec.js` (2, incl. no horizontal scroll at 375 px) and a BUG-006 test in `groceries.spec.js`. After a full run, a scan of tasks/groceries/people/transactions/meals/shopping/users/photos/storage finds no test leftovers.
- **Verified:** backend **257 passed** (before the photo test was added) then module re-runs green; e2e calendar + edit-flows + people + groceries + pages-smooth + smoke **28/28**, BUG-006 test 1/1; `craco build` "Compiled successfully"; console clean on Calendar (month, week, filters); desktop, phone and dark screenshots reviewed.
- **BUG-009 (found while verifying):** with SendGrid configured, every auth-test registration sent a real verification email to an `@example.com` address (25 accepted sends during today's runs; ~700 test registrations before). `email_service.deliver()` now never sends to RFC 2606/6761 reserved domains (`example.com/.net/.org`, `*.test`, `*.example`, `*.invalid`, `localhost`) once a provider is configured — it logs and reports "Not sent" instead. `tests/test_email_reserved_domains.py` (14) proves the provider is not called; the SendGrid adapter tests (fake transport) opt out of the guard. A full run now makes **0** SendGrid requests (checked in the server log).
- **Test-user cleanup moved to the end of the run** (`tests/conftest.py`, controller only): a per-module teardown raced with the module's other class on the second xdist worker and deleted users still in use (seen once as `test_refresh_token_flow` / `test_unverified_user_cannot_access_protected` failures).
- **Final Batch 2 verification:** backend **272 passed** twice in a row (0 failures); 2 users remain (owner + `testuser1@example.com`); storage empty; no test leftovers.
- **Owner decisions applied:** BUG-007 — deleting a person keeps money they already paid you (the "Payment from …" transaction holds only text, no link to the person, so it stays as an accurate income record; no rename needed). `tests/test_people_delete_keeps_payments.py` pins it; the three delete dialogs (People single/bulk, person detail) no longer claim payments are removed from the ledger. The 46 accidental weigh-ins (1/5/11 kg on 2026-10-18, no note) were deleted at the owner's request; the 8 real check-ins remain.

### Batch 3 — Settings: accounts and password (ACCT-001, AUTH-001) — Completed
- **Shared account dialog:** the create/edit form and its save logic moved from `pages/Money.jsx` into `components/AccountDialog.jsx` (with `buildAccountTree`), used by Money and Settings, so both behave the same. A new place's type now follows the chosen parent (previously it was fixed when the dialog opened, so switching parent Cash ↔ Revolut kept a stale type). Icon-only buttons on Money sub-places got accessible names.
- **Settings → Accounts:** tree of top-level places and sub-places with balances and lock marker; Add place (parent selectable), Edit for every place, Delete for sub-places with a confirmation; the server's own guards (no delete with sub-places or transactions) surface as a toast. Owed/person accounts are not listed (as on Money).
- **Settings → Password:** current / new / repeat with live checks (strength rule matches the server, must differ, must match), show/hide, specific messages for wrong password and rate limit.
- **Backend `POST /auth/change-password`:** wrong current password now returns **400** (BUG-010 — the 401 made the app sign the user out); new password must differ; attempts are rate limited per user (same limiter as login), so a stolen session cannot be used to guess the current password.
- **Also:** the AI card in Settings no longer says "Powered by Gemini" (chat runs on OpenCode Go; voice/receipts on Gemini) — it now states what the assistant does and that keys stay server-side.
- **Test speed:** Python resolves `localhost` to IPv6 first on Windows and waited ~2 s per request before reaching uvicorn on IPv4; `tests/conftest.py` now points the API tests at `127.0.0.1` when no URL is configured. Full backend run: ~140 s → **~33 s**.
- **Tests:** `backend/tests/test_change_password.py` (5: wrong current = 400 and session kept, weak, unchanged, success then login with new only, rate limit incl. refusing the correct password while limited); `frontend/e2e/settings.spec.js` (2: place add/edit/delete via the UI; password validation and wrong-password stays signed in — the success path is not run in the browser because it would change the owner's real password).
- **Verified:** backend **278 passed**; e2e settings + smoke + pages-smooth **7/7**; `craco build` "Compiled successfully"; console clean on Money (Add sub-place, Edit) and Settings (Add place, Edit); Settings and Money dialog screenshots reviewed.

### Batch 4 — AI safety, undo and cleanup (AI-005, AI-006, DEBT-004, BUG-004, DEBT-002, DEBT-006) — Completed
- **DEBT-004:** pending confirmations moved from process memory to the new `ai_pending_confirmations` table (model `AIPendingConfirmation`, Alembic `b5e2c8d17a43`, applied with `alembic upgrade head`). Keyed by user **and** chat (before: chat id only, and every chat-less request shared the key `""`); 5-minute expiry; confirming is an atomic compare-and-delete so two concurrent "yes" replies cannot both act; expired rows of the user are pruned on each call. Survives restarts and works across processes.
- **AI-005:** every destructive AI tool now uses the same gate (preview, then `confirm=true` on a *later* turn): `delete_expense` (its inline copy removed), `delete_shopping_item` and `submit_purchase` (previously accepted `confirm=true` on the very first call, so the model could act without the user seeing a preview), `delete_money_space` (had no confirmation), plus the existing discard/delete tools. Tool schemas share one `confirm` description.
- **BUG-011:** the AI `delete_shopping_item` tool called a function that does not exist and always failed; it now uses the `DELETE /shopping/{id}` route added in Batch 2.
- **AI-006:** undo now restores what an action changed or deleted, not only removes what it created. Tool handlers record a row snapshot (`remember_before`) before changing it; undo (newest first, always scoped to the user) puts the values back or re-creates a deleted row with its original id; rows created in the same turn are removed. Covered: grocery edit/move/consume/discard, shopping item edit/delete, list budget, account balance and money places (edit/delete), task edit/delete (including the next occurrence created when a repeating task is completed), person edit, meal edit/delete, recipe/workout/weigh-in delete, category edit/delete. **Not undoable by design:** `update_expense` (rewrites splits and inventory), `delete_person` (cascades splits and settlements), `update_storage_location` (renames the location on every item). Undo also overwrites any later manual edit of the same record.
- **BUG-004:** `PersonDetailModal` had two copies of the load logic; now one cancellable `load` used on open and after changes, and a failed load shows a message instead of an unhandled promise rejection.
- **DEBT-002:** removed `@tanstack/react-query` (only an unused provider), `swr`, `next-themes`, `@radix-ui/react-toast` and the unused toast stack (`hooks/use-toast.js`, `ui/toast.jsx`, `ui/toaster.jsx`); `yarn.lock` updated.
- **DEBT-006:** new `errorMessage(err, fallback)` in `lib/api.js`; 19 save/delete error toasts in 11 files now show the server's reason when it is a readable sentence (e.g. "Cannot delete account with transactions") instead of a generic "Could not save". Remaining silent catches were reviewed: all are intentional and commented (blocked storage/clipboard, background prefetch). Backend: invalid `\%`/`\_` escapes in `conversations_api.py` fixed.
- **Tests:** `test_ai_confirmations.py` (5: shopping-item preview/confirm incl. same-turn refusal, submit cannot self-confirm, stored + survives restart, per user and per chat, expiry) and `test_ai_undo.py` (6: edited grocery, consumed + moved stock, discarded item back with same id, edited and deleted task, create-then-edit removed, no double undo); existing AI tests updated for the database store.
- **Verified:** backend **289 passed**; Playwright, every spec except those calling the live AI model (owner's instruction): **44 passed, 0 failed**; `craco build` "Compiled successfully" (no ESLint warnings); `alembic current` = `b5e2c8d17a43 (head)`; leak scan after the run: only the owner and `testuser1@example.com` accounts, no test rows, no pending confirmations from tests.

### Batch 5 — Tests (TEST-003, TEST-004, TEST-005 partly) — 2026-10-29
- **Context:** this session resumed on `feature/roadmap-completion` at `4c3c6a6`. The `graphify` CLI is broken on this machine (`uv trampoline failed to canonicalize script path`), so the graph (`graphify-out/graph.json`, built at `d12bfa3`) was not queried; the Obsidian vault `LifeRecord/` is only the graphify export. All findings below come from reading the repository. Baseline before changes: backend **289 passed** (services had to be started with `start-all.ps1`).
- **TEST-004:** `backend/tests/test_helpers.py` (18 tests, no server needed) pins `normalize_name`, `compute_shares` (equal / by items / exact, alias "eu" not duplicating "Me", cent rounding, zero shares dropped except "Me"), `cheapest_store` and `serialize_txn` (personal / pending / partial / settled, refunds capped, who owes, payment method by account type). They describe current behaviour; no production code changed.
- **TEST-003:** `frontend/e2e/nutrition.spec.js` (3 tests): log → edit → delete a meal by hand, a meal without a description is blocked, create → edit → delete a recipe with an ingredient. Each checks the API state, not only the screen, and removes its records (scan afterwards: 0 `E2E-` meals/recipes). To make this testable, `pages/Nutrition.jsx` got accessible names and test ids on its icon buttons and dialogs, and the meal action buttons are no longer hover-only on small screens or when focused by keyboard. The first run failed on my own selector (`Name` also matched `Recipe name`), fixed in the test; no app bug was involved.
- **TEST-005 (partly):** 16 backend test modules no longer define their own owner constants; they import `OWNER_EMAIL` / `OWNER_PASSWORD` from `tests/support_auth.py`. `e2e/fixtures.js` exports `credentials`, reused by `saved-chats.spec.js`.
- **Verified:** backend **307 passed** (289 + 18) in one run; the new e2e spec 3/3; `playwright test --list` parses all 62 tests in 12 files; `CI=true craco build` (warnings fail the build) compiled successfully. Not run in this batch: the other e2e specs (only `nutrition.spec.js` touches a changed page; the `saved-chats` change is one import and calls the live AI, which the owner excluded).

### Batch 6a — Secrets and database access (SEC-001, SEC-002 partly, SEC-004, SEC-003 blocked) — 2026-10-29
- **Findings that shaped it:** MySQL listened on `0.0.0.0:3306` and `0.0.0.0:33060` with `root` and an empty password (only `root@localhost` existed, so LAN logins were refused by host rules, but any local process could use it); the README printed the owner password; `seed()` reset the owner's password to `ADMIN_PASSWORD` at **every start** (a password changed in Settings would have been undone by the next restart); the JWT secret, database password and four API keys sat in plaintext in `backend/.env`; test code held the owner password in 16 files.
- **`backend/local_secrets.py`:** Windows DPAPI store in `%LOCALAPPDATA%\LifeRecord\secrets.dpapi` (encrypted for this Windows user, extra entropy, atomic write, read-back check before `.env` is touched, a damaged store is an error and never "empty"). Loaded at startup by `server.py`, `alembic/env.py`, `tools/ensure_db.py` and the tests; precedence real env > store > `.env`. CLI: `migrate`, `set`, `names` (never values), `rotate-jwt`, `run -- CMD`. Migrated JWT_SECRET, ADMIN_PASSWORD, GEMINI_API_KEY, OPENCODE_API_KEY, SENDGRID_API_KEY out of `.env`; nothing was printed.
- **Database:** `tools/provision_db.py` (idempotent) created `liferecord_app` and set a generated root password, written to the store first so a failure cannot lock anyone out. Alembic uses the admin login (`ADMIN_DATABASE_*`), the app the restricted one. `DATABASE_HOST` is now `127.0.0.1` (with `localhost`, every connection waited for an IPv6 timeout once MySQL stopped listening on `::1`; a first test run took >400 s because of it).
- **Seed:** `sync_existing_owner()` keeps email/name in step but never touches the password; `owner_admin.py reset-password` is the recovery path.
- **Tests:** `tests/test_local_secrets.py` (10: round trip, file holds no plaintext, corrupted file is an error, env precedence, migration keeps non-secrets and merges, JWT rotation, names hide values, `run` passes secrets to the child only) and one seed test in `test_helpers.py`. `tests/support_db.py` gives tests the admin login; `support_auth.py` and `e2e/fixtures.js` no longer contain a default password and fail with an explicit message if `TEST_PASSWORD` is missing. This completes the hardcoded-secret part of TEST-005.
- **Verified:** backend **318 passed** (48 s); `alembic current` = `b5e2c8d17a43 (head)` through the admin login; `liferecord_app` can SELECT `users` but `DROP TABLE users` and `SELECT … FROM mysql.user` are denied; empty-password logins for root and the app user are refused; `netstat` shows only `127.0.0.1:3306` (no 33060); e2e nutrition + settings + smoke **7/7** started through `local_secrets.py run`. A scan afterwards found no test rows; one test user left by the aborted first run (`img_…@example.test`) was removed.
- **Not done / owner decisions:** key rotation and the owner password (above). The backend still binds `0.0.0.0:8000` (`start-all.ps1`) so other devices on the network can reach the API; say if that should be `127.0.0.1`. `/api` `docs` exposure and the admin e-mail in `.env` were not changed.

### Batch 6b — Sessions and tokens (SEC-005, per-user revocation, hashed reset tokens) — 2026-10-29
- **Findings:** refresh tokens were stateless JWTs that nothing could revoke (a stolen one worked for 7 days, also after a password change or reset); `/auth/refresh` did not check `email_verified`; password-reset tokens sat in the database in plaintext; login answered faster for unknown emails than for wrong passwords; the rate limiter lived in process memory.
- **Revocation:** `users.token_version` (Alembic `c9d4e6f2a815`, applied with the admin login; `alembic current` = head). Access and refresh tokens carry `tv`; `get_current_user`, `/auth/me` and `/auth/refresh` reject a mismatch with 401. The version is raised by password change, password reset and the new `POST /auth/logout-all`. `change-password` now returns fresh tokens so the device in use stays signed in; Settings stores them and says other devices were signed out; Settings also has "Sign out on all devices" with a confirmation.
- **Reset tokens:** only `SHA-256(token)` is stored (`password_reset_token`), compared in constant time; still single use and 30 min. Tests that used to read the token from the database now issue one through `tests/support_db.issue_reset_token`.
- **Also:** unknown-email logins verify against a dummy hash (equal work); `/auth/refresh` returns 403 for unverified accounts; rate limiter is async and database-backed with hashed buckets and occasional cleanup.
- **Tests:** `tests/test_session_security.py` (10: password change ends other sessions but keeps this one, sign-out-everywhere kills all tokens and login still works, needs a session, refresh works, reset ends sessions and is single use, the stored hash is not accepted as a token, unverified cannot refresh, limiter blocks at the maximum and isolates identifiers, rows hold hashes not emails); `e2e/settings.spec.js` +1 (sign-out-everywhere dialog; the endpoint is answered by the test because calling it for real would end the owner's session for the whole suite).
- **Verified:** backend **327 passed** (54 s); e2e settings 3/3 and smoke + people + pages-smooth + edit-flows + calendar **16/16**. Tokens without a `tv` claim count as version 0, the starting version of every account, so tokens issued before this batch stay valid until that account's version changes (the JWT rotation in 6a had already signed everyone out).
- **Left for 6c / not done:** httpOnly refresh cookie (SEC-006), CSP (SEC-007), encrypted uploads; refresh-token reuse detection (a stolen refresh token stays usable until the user signs out everywhere or changes the password); the 6-digit verification code is still stored in plain text (15 min, 5 attempts) because the auth tests read it from the database.

### Batch 6c — Refresh cookie, CSP, encrypted uploads (SEC-006 partly, SEC-007) — 2026-10-29
- **SEC-006 (partly):** `X-Auth-Mode: cookie` makes login / verify / reset / refresh / change-password put the refresh token in an `lr_refresh` HttpOnly cookie (`SameSite=Lax`, `Path=/api/auth`, `Secure` for https) and leave it out of the JSON; `/auth/refresh` accepts it from the cookie but only with that header (a cross-site form post cannot add it, 403 otherwise); a refresh token still in `localStorage` from earlier versions is sent once and swapped for a cookie; `POST /auth/logout` clears it and `logout-all` also revokes copies. API clients without the header are unchanged. Frontend: `lib/api.js` (`refreshSession`, credentials + header on every call), `AuthContext` (logout asks the server first, 3 s timeout). **Not done:** access token still in `localStorage` (see checklist row).
- **SEC-007:** see checklist row. The policy forbids inline scripts, so `.env.production` sets `INLINE_RUNTIME_CHUNK=false` and the CSP step fails the build if an inline script appears. Unit tests `src/lib/csp.test.js` (3).
- **Encrypted uploads:** new `backend/file_crypto.py` (Fernet, `LRENC1` header, tamper/wrong-key/missing-key are errors, files from before stay readable, no key = stored as before with a warning). `save_object` / `read_object` in `server.py` use it, which covers progress photos and chat pictures. `UPLOAD_ENCRYPTION_KEY` was created in the secrets store; storage was empty, so nothing needed converting (`file_crypto.py encrypt-existing` exists for later). **Data-loss warning:** losing the key (or the Windows profile that holds the DPAPI store) makes encrypted files unreadable; `local_secrets.py reveal UPLOAD_ENCRYPTION_KEY` prints it for a backup. `cryptography` added to `requirements.txt`.
- **Tests:** `test_refresh_cookie.py` (9), `test_file_crypto.py` (9: round trip, no plaintext on disk, tamper, wrong key, missing key, legacy plaintext, tree migration idempotent, a real photo upload is encrypted on disk and served intact), `e2e/session-cookie.spec.js` (real login: cookie is HttpOnly and absent from `document.cookie`/storage; a broken access token is silently renewed from the cookie; sign-out removes the cookie).
- **Verified:** backend **345 passed** (57 s); e2e session-cookie + smoke + settings **6/6**; `csp.test.js` 3/3; production build under CSP checked in a browser against a second backend on :8001 (since removed): 0 violations.
- **Residual risks (honest list):** stolen refresh tokens are not detected on reuse; the access token is readable by page scripts; the verification code is stored in plain text; `0.0.0.0:8000` exposure; uploads' key shares a single point of failure with the DPAPI store; the CSP header is not enforced anywhere until the build is served by something that sets it (the `<meta>` copy covers scripts and connections but not `frame-ancestors`).

### Status at the end of the 2026-10-28 session (historical; superseded by §16)
- **Completed this session:** TASK-001, FIT-001, FIT-002, BODY-001, BODY-002, QUICK-001, CAL-001, CAL-002, ACCT-001, AUTH-001, AI-005, AI-006, DEBT-004, BUG-004, BUG-007 (decision), DEBT-002, DEBT-006, and newly found BUG-006, BUG-008, BUG-009, BUG-010, BUG-011. Stale rows corrected: AI-007, TEST-002, BUG-005.
- **In Progress:** DEBT-005 (shared login, IPv4, cleanup; tests still need the live backend), DEBT-001 (new code in separate modules only).
- **Not Started (then):** SEC-001 … SEC-007, TEST-003, TEST-004: all handled on 2026-10-29, see Batches 5 and 6 and §16.
- **Agreed scope for the security batch (implemented on 2026-10-29):** secrets (JWT secret, DB password, Gemini/OpenCode/SendGrid keys) out of `backend/.env` into a DPAPI-encrypted file under `%LOCALAPPDATA%\LifeRecord\` (owner's choice); per-user token revocation (password change / "sign out everywhere"); httpOnly cookie tokens instead of localStorage; hashed refresh/reset tokens; encrypted uploads; DB-backed rate limiter; CSP header; dedicated least-privilege DB user. Key rotation (Gemini, OpenCode, SendGrid — keys were pasted into chats earlier) needs the owner.
- **Known, not fixed:** the build prints a Node 24 `fs.F_OK` deprecation from build tooling; `testuser1@example.com` (origin unknown) left in the database; (the MySQL `root` without a password was fixed on 2026-10-29, Batch 6a).

---

## 16. Final status (2026-10-29)

**Branch:** `feature/roadmap-completion` (Batches 5, 6a, 6b, 6c committed; this document and `SENDGRID_EMAIL_AUDIT.md` committed with the final batch).

### Task status
| Group | Tasks | Status |
|-------|-------|--------|
| Completed this session | TEST-003, TEST-004, TEST-005, SEC-001, SEC-004, SEC-005, SEC-007 | Completed with the evidence in Batches 5-6c |
| Partly done | SEC-002 (code done; **owner must change the real owner password**), SEC-006 (refresh token in an HttpOnly cookie; **access token still in `localStorage`**) | In Progress |
| Blocked on the owner | SEC-003 (create new Gemini / OpenCode / SendGrid keys and store them with `local_secrets.py set …`) | Blocked |
| Open by decision | DEBT-001 (split `server.py`: only new code lives in separate modules; a wholesale move of ~5,400 lines was not attempted because it adds regression risk without changing behaviour), DEBT-005 (tests still need the running backend) | In Progress |
| Extra problems found and fixed | owner password reset on every startup, MySQL reachable on all interfaces with empty root password, README printed the owner password, unrevocable refresh tokens, plaintext reset tokens, unauthenticated-timing login, in-memory rate limiter | Fixed (Batches 6a-6b) |
| Found, **not** fixed (email, awaiting your go-ahead) | verification lock-out after 5 wrong codes, invisible account-mail failures, unescaped name in recipient email, gmail.com sender | See `SENDGRID_EMAIL_AUDIT.md` |

**The application is not fully complete:** SEC-002, SEC-003, SEC-006, DEBT-001 and DEBT-005 are open, and email verification/delivery is **Not Completed** (see below).

### Final verification (run on 2026-10-29, after the last code change)
| Check | Result |
|-------|--------|
| Backend `pytest tests` (live backend + in-process) | **345 passed, three consecutive parallel runs (about 60 s each)** |
| Frontend unit tests (`craco test`) | 9 passed (2 suites) |
| Production build `CI=true npm run build` (ESLint warnings fail it) + CSP step | Compiled successfully; policy injected |
| Playwright e2e, every spec except those that call the live AI model (owner's instruction) | **49 passed (clean full run, 4.7 min); after the last frontend change (AuthContext hardening) groceries + pages-smooth + settings + session-cookie + smoke re-run: 22 passed** |
| `alembic current` | `c9d4e6f2a815 (head)` |
| Console/CSP check of a production build in a browser | 0 errors, 0 violations (Batch 6c) |
| Not run | e2e specs that call the live AI provider (`saved-chats`, `chat-images`, "real model"/"real assistant" cases); real email delivery; a deployed environment |
| Pre-existing / environmental | Node 24 `fs.F_OK` deprecation printed by the build tooling; `testuser1@example.com` (origin unknown) still in the database |
| Flakes met and handled | (1) `test_people_delete_keeps_payments` failed twice when new test modules changed which modules ran side by side: four modules change the owner's Revolut balance and it asserts an exact value; serial run 345/345 proved the cause. Fixed with a cross-worker lock (`shared_money_lock` in `tests/support_auth.py`, held by those four modules), then 3 consecutive parallel runs passed. (2) One e2e failure of "signing out clears the cached page data" while other scripts were hitting the backend; it passed alone and in two later runs. The cause was not proven; as a precaution `AuthContext` now clears cached data whenever the app starts without a token. |

### SendGrid email verification and delivery audit
Full findings: **[SENDGRID_EMAIL_AUDIT.md](SENDGRID_EMAIL_AUDIT.md)**. Nothing was sent or changed. Headlines:
- **Email authentication and delivery are NOT completed.** The sender is a `@gmail.com` address (DMARC `p=none`, no alignment possible); the SendGrid account state could not be read with the app's least-privilege key and must be checked in the dashboard.
- **Bug (confirmed by probe):** five wrong verification codes lock an account out for good; "send a new code" does not reset the counter.
- Account-mail failures are ignored by the callers; no retries, no bounce/block webhook, no password-changed notification, unescaped user name in the recipient-confirmation email.
- Your actions: a domain you control + DNS records from SendGrid, domain authentication, tracking settings check, new restricted API key, approval for one test send. The code items are listed with priorities and tests in §10-12 of the audit.

### Update 2026-10-29 (later): email fixes authorized and implemented
Owner request: sender `tiagosa743@gmail.com` for now, SendGrid via **SMTP**, make it work without errors. Implemented the audit's code items P1-1, P1-2, P2-2 (escaping), P2-3, P2-4 and part of P3-1 (details in `SENDGRID_EMAIL_AUDIT.md` §14): resend resets attempts; background sending with retries; `email_events` table (Alembic `d1f2a3b4c5e6`); `EMAIL_PROVIDER=smtp` with SendGrid's relay; tracking off; security-notice emails; no message bodies in logs. Verified: backend **366 passed** (new: `test_email_smtp.py` 17, `test_email_flows.py` 5); one real test mail accepted by SendGrid's relay (first attempt). **Inbox delivery is NOT confirmed**: the message was not found in the inbox/archive/trash and Spam could not be searched; the owner must check Spam and SendGrid Email Activity. Email authentication/delivery therefore stays **Not Completed** (no authenticated domain).

### Update 2026-10-29 (later still): email flows checked end to end
Verification code, resend, login-before-verify, forgot password, reset-link page, password-reset notice: all exercised through the real UI with the real backend and real rendered emails (captured by a temporary local mail catcher; the owner had confirmed real delivery of the test mail). One bug found and fixed: a reset link opened in a browser with a signed-in user was redirected to the home page (the route sat inside the signed-out-only group); it is now reachable in both states and the token is removed from the address bar. New `e2e/reset-link.spec.js` (3). Re-verified: backend 366 passed, production build compiled, auth e2e specs 9 passed. See `SENDGRID_EMAIL_AUDIT.md` §14.1.

### Update 2026-10-29 (end): old-account cleanup, shared catalog, John as the test account — PARTLY DONE
- **Backup:** full dump of the database to `%LOCALAPPDATA%\LifeRecord\backups\` (outside the project, 31 tables) before any deletion.
- **Cleanup (owner-approved: everything, account kept):** `backend/cleanup_account.py` (dry run by default, explicit user-id filters, one transaction, verifies other users and the shared catalog are unchanged). Removed **1,908 rows** of `tiagosa743@gmail.com`: splits 12, settlements 2, transactions 12, ai_messages 554, ai_actions 300, ai_pending_confirmations 1, ai_conversations 160, shopping_items 14, shopping_lists 1, price_records 177, groceries 62, products 552, storage_locations 4, appliances 7, recipes 6, meals 3, workouts 2, weight_entries 9, tasks 4, people 6, categories 12, accounts 8 (others 0); a second dry run shows 0. Account, other users and storage files untouched (there were none).
- **Shared catalog (new):** `products.user_id` is nullable (Alembic `e2a4b6c8d0f1`); the 552 built-in items are ownerless rows created at startup (`ensure_shared_catalog`), visible to every account; additions stay private; editing a shared item makes a private copy; deleting a shared item is refused; `import-library` is a no-op. 7 new tests (`test_shared_catalog.py`).
- **John's dataset:** `backend/seed_john.py` (idempotent via a marker task, `--reset`, local-only, through the REST API; saved AI chats inserted directly because they otherwise need a paid model call): 7 money accounts (2 locked), 13 categories incl. zero/no budgets, 7 people (1 archived, 1 empty), 39 transactions (income, expenses, split/itemised/exact, settlements, transfers), 9 tasks (overdue, repeating, done, undated), 12 weigh-ins, 6 workouts, 7 meals, 4 recipes, 21 stock items in 4 spaces (expired, expiring, low, out of stock, no expiry), 5 appliances, 4 shopping lists (one bought through the purchase flow, zero budget, empty, archived) + a recurring list, a draft scheduled task (no recipients, not activated), 2 saved AI chats, 2 private products. Not covered: photos, recurring transactions (the app has none), AI action history. Found while seeding: a brand-new account has no categories or accounts at all (onboarding gap, not fixed).
- **Default test account:** John via `TEST_EMAIL` default in `tests/support_auth.py` and `e2e/fixtures.js`; password only from the environment (the old stored `TEST_PASSWORD` was removed from the secrets store); tests refuse a non-local backend. Obsolete `seed_groceries.py` (hardcoded old password) removed.
- **Verified as John:** backend **373 passed**. Browser suite **48 passed, 4 failed**: all in `e2e/groceries.spec.js` (Overview jump, delete single item, no-empty-state flash, sign-out clears cache); the specs expect items from the old account's kitchen (e.g. "Hummus") and the other two followed a 30 s timeout. They need adapting to John's data (**not done, not Completed**). Not verified: permission isolation beyond the existing isolation tests, error-handling sweep by hand.
- **Graphify / Obsidian: NOT refreshed.** The `graphify` command is broken on this machine and no Obsidian app is installed; no notes were written. Next steps: fix the graphify install, rebuild the graph, add vault notes (no secrets).
- **Next:** adapt `groceries.spec.js` to John's seed, re-run the browser suite, refresh Graphify/Obsidian, then mark this item Completed.

---

## 17. Nutrition (redesign 2026-10-29, second delivery and UX pass 2026-10-30)

**Scope agreed with the owner:** food data = USDA bulk import + Open Food Facts (no API key); standard = EFSA (European); optional minimal profile; deliver stages 1-4 first (data, calculations, diary, redesigned page); AI tools, meal planning and shopping-list integration as a second delivery.

**Second delivery, decisions by the owner (2026-10-30):** reminders in-app only (no email); camera barcode scanning with one lazy-loaded dependency (ZXing); assistant changes to the nutrition profile or a daily target are previewed and applied only after a later, identical confirmation. My calls, not objected to: the meal plan lives in its own table, no public share links for health data, reference values stay adults-only, Plan is a sixth tab.

### Status by requirement
| ID | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| NUTR-NEW-01 | Food database with provenance (source, version, quality), no invented values | **Completed** | 8,170 shared foods (USDA Foundation Foods 2025-12-18: 377; SR Legacy April 2018: 7,793); a nutrient the source did not report is absent and shown as "not reported". Idempotent importer `backend/import_usda.py`. Spot-checked against known USDA values. Coverage is stated honestly: iodine is reported for 1% of foods, biotin for none. |
| NUTR-NEW-02 | Diary: meals (breakfast/lunch/dinner/snacks/other), time, search, units and portions, add/edit/duplicate/move/delete, recents and favourites, retries and concurrent edits handled | **Completed** | `/api/nutrition/diary*`; nutrient snapshot per entry; `client_ref` prevents duplicates; `if_updated_at` returns 409 on a stale edit. |
| NUTR-NEW-03 | Macronutrients and energy: grams, % of energy, per meal, totals, energy cross-check | **Completed** | Energy bar by meal, macro range gauges; list/calculated energy differences are reported (not hidden). Fibre, sugars, saturated, mono/poly, trans, cholesterol, alcohol, omega-3/6 tracked where the source has them. |
| NUTR-NEW-04 | Micronutrients: 14 vitamins and 10 minerals, role text, food sources, progress, trends | **Completed**, with limits | Nutrients tab (41 values), per-nutrient explanation, biggest sources today, foods rich in it (Foundation Foods only), data completeness dots. Biotin unavailable in the source; iodine mostly missing; vitamin A is RAE vs EFSA RE and niacin excludes tryptophan (both stated in the UI). |
| NUTR-NEW-05 | Personalised references with documented standards; user targets never silently overridden; unsafe targets flagged | **Completed** (adults in the second delivery; ages 1-17 and upper levels in the third, below) | `backend/nutrition_data.py`: EFSA 2017 (doi 10.2903/sp.efsa.2017.e15121) for energy (age, sex, PAL), macronutrient ranges, fibre, water, protein per kg, 19 vitamins/minerals incl. pregnancy and lactation; WHO (26 Jan 2026) limits for free sugars, saturated and trans fat, sodium; EU 1169/2011 general adult values only when no profile. PRI / AI / RI / limit kinds are labelled. Under-18s and EFSA upper levels were added in the third delivery (below). No medical conditions. Energy below 1,200 kcal is saved but flagged (an app safety rule, not an EFSA value). |
| NUTR-NEW-06 | Hydration | **Completed** | Drinks recorded separately; EFSA total-water reference counts drinks plus water in food. |
| NUTR-NEW-07 | Trends and reports | **Completed** | 7/30/90-day series, averages over logged days only (a day with no data is not zero), per-nutrient averages vs reference, contributors, CSV download, and a printable summary (`WeeklySummary.jsx`: prints or saves as PDF from the browser; the app becomes hidden and the dialog the whole page, tested with print media). No public share links by design: health data stays with the person. |
| NUTR-NEW-08 | Packaged foods and barcodes | **Completed** | Barcode typed in or scanned with the camera (`BarcodeScanner.jsx`, ZXing, downloaded only when Scan is tapped: its own 436 KB chunk, not in the main bundle). Verified end to end with Chromium's fake camera playing a generated EAN-13 video: camera -> decode in the page -> lookup request with the exact code -> portion step; and the "no camera" and "blocked" messages. Open Food Facts values stay marked estimated (macros, sugars, fibre, saturated fat, sodium only). Not verified: a real phone camera, Safari/Firefox, a live Open Food Facts call (stubbed in the camera test; the mapping is unit-tested). |
| NUTR-NEW-09 | Recipes with ingredient-level nutrient aggregation | **Completed** | Ingredients link to foods (`food_id`, quantity and a unit the food understands: g, kg, oz, lb, its own portions, ml/l for liquids). Per-serving nutrients are calculated on the server (`nutrition_api.recipe_nutrition`), shown live while editing (`/nutrition/recipe-preview`) and stored with a completeness note; an ingredient that is not linked, whose food was removed, or whose unit cannot be converted is listed as left out, never counted as zero, and diary entries from an incomplete recipe are marked estimated. Editing or deleting a food recalculates the recipes that use it. Cooking now logs through the same diary code (see defects below). Recipes without links keep hand-typed whole-recipe numbers. |
| NUTR-NEW-10 | Meal planning, shopping-list integration, substitutions, reminders, shareable summaries | **Completed** (reminders in-app only, by decision) | Plan tab (`PlanTab.jsx`, `nutrition_plan_api.py`, table `meal_plan_entries`): a week of planned foods, recipes and typed meals; planned food never counts until "I ate this" copies its saved nutrients into the diary (once only, even if repeated or raced); edit, move between days, copy a day or week; per-day totals and reference chips. Shopping list from a plan: ingredients and plain foods (by weight as eaten), merged by unit family, minus kitchen stock, no duplicates, nothing marked bought, inventory untouched. Swaps: similar foods of the same category and similar energy with less or more of one nutrient; foods that do not report it are skipped, diet/allergy words respected. Reminders: per-meal times and a water check (profile time zone), on Today and Home, "Not now" per day on this device. Summary: printable (see NUTR-NEW-07). |
| NUTR-NEW-11 | AI assistant: full secure access to Nutrition | **Completed** (tested in-process, not with the live model) | `ai_tools_nutrition.py`: 30 tools (97 in total, schemas accepted by the Gemini client): search/get food, barcode lookup, day, report with nutrient sources, insights, targets and profile, swaps, plan, recipes; log food with portions, quick estimates (saved as estimates), edit/move/copy/delete entries, drinks, custom foods from label values (salt converted to sodium, never estimated), favourites, profile and target changes (preview, then an identical confirmation: the confirmation is bound to the exact values, so they cannot change between preview and apply), reminders, plan, plan-to-shopping-list, recipes. They call the same service functions as the REST routes, are scoped to the signed-in user, return errors as messages, and every change is recorded for undo (new undo collections: hydration, foods, favourites, profiles, plan). Scheduled reports get the read-only subset only. The system prompt says tool text (including crowd-sourced product names) is data, never instructions, and that nutrient values come from tools. Verified by 27 in-process tests (dispatcher, scripted model turns, undo, privacy between two accounts, bad input, confirmation rules) and by a scripted chat that searches, logs and undoes. **Not verified:** how well the live model chooses among 97 tools (about 51 KB of schema per request), because the live model is not used in tests. |
| NUTR-NEW-12 | Redesign: distinctive, responsive, accessible | **Completed** | See NUTR-NEW-13 for the second pass. Accessibility is now audited automatically (third delivery); still not done: a screen-reader pass and pixel snapshots. The assistant button's overlap was measured and fixed in the third delivery. |
| NUTR-NEW-13 | UX refinement and speed (second pass) | **Completed** | Tab and day live in the address (`?tab=plan&date=...`): refresh, Back and shared links land in the same place; "Add food" is in the header on every tab; quick add on Today (type, tap Add, Undo) and one-tap shortcuts that repeat the last amount; "Copy yesterday" per empty meal; drinks can be edited; Nutrients tab has a search box and filters with counts (below reference, limits, no data); insights show three first with "Show more"; Home reads the same day, targets and time zone as Nutrition (it still used fixed 2700/160/300/90 rings and the UTC date); phone header no longer squeezes the title. Speed: every save used to refresh about 32 requests (money, tasks, people, groceries...); a scoped refresh (`refreshAll(["/nutrition", ...])`, honoured by `useFetch`, the background refresher and the grocery warm-up) brings logging a drink to 9 relevant requests, measured in the browser. Unscoped `refreshAll()` behaves exactly as before for every other page. Automated check that no control on any tab or in the add dialog lacks an accessible name. |

### Data model and migrations (applied with `alembic upgrade head`)
`f3b5c7d9e1a2` adds `foods`, `food_favorites`, `nutrition_profiles`, `hydration_entries`, diary columns on `meals` (meal type, label, time, food/recipe link, quantity, unit, grams, nutrient snapshot, quality, source) and `nutrients`/`quality` on `recipes`; `a4c6e8f0b2d3` adds `meals.client_ref`. Existing meals are untouched: they read as quick entries with only the four numbers they had. Run the food import once: `python backend/import_usda.py` (downloads about 10 MB to `%LOCALAPPDATA%\LifeRecord\datasets\usda`, outside the project).

### Files
Backend: `nutrition_data.py` (registry, EFSA/WHO/EU values), `nutrition_calc.py` (portions, totals, progress, recipes), `nutrition_api.py` (routes under `/api/nutrition`), `import_usda.py`, `models.py`, two migrations, `server.py` (module registered; `/meals` endpoints kept in step). Frontend: `pages/Nutrition.jsx`, `pages/nutrition/{shared,TodayTab,NutrientsTab,TrendsTab,FoodsTab,GoalsTab,FoodDialog}.jsx`, `lib/routes.js` prefetch. Tests: `tests/test_nutrition_calc.py` (23), `tests/test_nutrition_api.py` (19), `e2e/nutrition.spec.js` (9); `e2e/groceries.spec.js` adapted to John's kitchen.

### Bugs found by the tests and fixed in this work
Navigating to a day whose data was still loading crashed the page; a mobile layout overflow (grid columns could not shrink); food dialog wider than its frame on phones; USDA carbohydrate-by-difference stored negative for some meats (now 0); `ml` accepted for any watery food such as spinach (now only real liquids); recipe servings logged the whole recipe instead of one serving; suggestions drawing on by-products (now Foundation Foods only); energy labelled "Reached" (now neutral wording); trend averages treated a day with no data as zero.

### Verification (run 2026-10-29, as the standard test account)
Backend **414 passed** (also in parallel); frontend unit tests 9 passed; production build compiled with ESLint warnings treated as errors; browser suite (everything except the live-AI specs) **58 passed, 0 failed** (4.9 min) after the Groceries specs were adapted to John's kitchen data, which also closes the four Groceries failures left open earlier on 2026-10-29. Visual review: desktop and 390 px screenshots of all five tabs and the food dialog; browser console empty. **Not verified:** real Open Food Facts lookups in automated tests (the mapping is unit-tested; the live call was not run), screen-reader use, Safari/Firefox, a profile with pregnancy/breastfeeding in the browser (covered in API tests), large histories (the trends query reads up to 366 days of entries in one request).

### Second delivery: files
Backend: `ai_tools_nutrition.py` (new), `nutrition_plan_api.py` (new), `nutrition_api.py` (service namespace, recipes from foods, reminders, copy, drink edit, calendar-valid dates), `nutrition_calc.py` (recipe, shopping, swap and meal-type helpers), `models.py` + migration `b5d7f9a1c3e4` (`meal_plan_entries`, `profile.reminders`, `recipes.nutrition_meta`), `server.py` (wiring, undo collections, prompt, recipe save, cooking, meal dates), `ai_tools_extra.py` and `scheduling.py` (nutrition tools moved / read-only subset). Frontend: `PlanTab`, `QuickAdd`, `Reminders`, `RecipeDialog`, `BarcodeScanner`, `WeeklySummary`, `format.js` (new); `Nutrition`, `TodayTab`, `NutrientsTab`, `FoodsTab`, `FoodDialog`, `GoalsTab`, `TrendsTab`, `shared`, `Home`, `AppShell` (theme-toggle label), `lib/refreshScope.js` (new), `lib/useFetch.js`, `lib/query.js`, `lib/groceriesData.js`, `lib/aiFormat.js`, `lib/routes.js`, `index.css` (print), `craco.config.js`; dependencies `@zxing/browser` 0.1.5 and `@zxing/library` 0.21.3. Tests: `test_nutrition_plan_api.py` (18), `test_ai_nutrition_tools.py` (27), calc tests (+5): 50 new backend tests, `nutrition-plan.spec.js` (14), `nutrition-camera.spec.js` (2), `format.test.js` and `aiFormat.test.js` (+11). Run `alembic upgrade head` (no data import needed).

### Defects found and fixed in the second delivery
- A date such as `2026-13-45` matched the date pattern and was stored by the diary, water and legacy meals endpoints (a first-delivery defect). Dates are now checked against the calendar in every request model.
- Cooking a recipe wrote a four-number legacy meal with the UTC date and meal type "other" (no nutrient snapshot). It now goes through the diary service: the profile's "today", the full nutrient snapshot, a sensible meal.
- Home used fixed ring targets and the UTC date. It now reads `/nutrition/day`.
- One tab click added two history entries (Radix fires two handlers), so Back appeared to do nothing. Fixed by comparing with the live address.
- The global theme toggle had no accessible name; two buttons' names did not contain their visible text.
- The chat counted every non-`get_` tool as a change, so the new lookups would have been reported as changes (server and chat summary both fixed).
- My scoped refresh threw on a data hook with no path (the add-food dialog's lists while closed), which aborted the refresh after every save: caught by the full browser run, fixed, unit-tested, and guarded by a page-error check in the browser test.
- A recipe card forced the phone layout 14 px too wide (grid item without `min-width: 0`).
- The scanner package's source maps produced 15 build warnings; its maps are now skipped by name (the build says "Compiled successfully").
- Old browser tests depended on John having entries today, on placeholders that were replaced by labels, and on search results appearing before a click; made robust.

### Verification (run 2026-10-30, as the standard test account; password supplied per command, never stored)
- Backend: **464 passed** (was 414), also in parallel; pyflakes clean on every new or changed file (the old unused imports in `scheduling.py` are untouched).
- Frontend: 20 unit tests passed (was 9); production build **Compiled successfully** with `CI=true` (only a Node deprecation notice from the CRA toolchain); ESLint with the React-hooks and accessibility rules reports nothing on the files written or changed (two unused names in `Home.jsx` and two in `AppShell.jsx` are older and untouched).
- Browser: the full suite without the live-model tests passed **86**, with **1 failure that belongs to a live-model test** (below); the Nutrition, Home, Groceries, Calendar, smoke and page-switching specs were then re-run on the final code: **45 passed** (25 of them Nutrition: 9 existing, 14 new, 2 camera).
- Visual review: desktop and 390 px screenshots of every tab, the recipe dialog, the add dialog and the summary; console, network (no 4xx/5xx) and horizontal overflow checked on every tab.
- **Mistake to note:** my first exclusion filter for live-model tests was too narrow, so two full browser runs also executed the specs titled "real assistant" (2 in `chat-images.spec.js`, 2 in `scheduled-tasks.spec.js`; one of them runs a due task and takes about 3 minutes), which use model quota. One of them (`chat-images`: "a file that is not an image is refused") failed because the live model answered before the app showed its refusal. No image-handling code changed in this work and the in-process image tests pass, but the failure was not investigated further to avoid more live calls. The filter now excludes "real assistant", "real model", "live data" and "real report".

### Not verified
Live-model behaviour with 97 tools; a real phone camera, Safari and Firefox; real Open Food Facts calls in automated tests; screen readers (only an automated "every control has a name" check); the printed result on paper (print media is emulated); large histories.

### Known limitations
Reference values: adults and, since the third delivery, ages 1-17 (see below for what is still left out); reminders are in-app only (no email or push, by decision); one-tap logging uses the last amount or the food's first listed portion, which is not always the portion a person eats; plain foods on a shopping list are by weight as eaten (cooked weights are usually higher than raw); each assistant request carries about 51 KB of tool schema; EFSA has revised some values since 2017 (sodium and potassium in 2019), so sodium uses the WHO limit and potassium the 2017 AI. Food data is US-centred (USDA); European brands and dishes are better served by barcode lookup or your own foods. Search ranks by name length and source, not popularity. Allergy and diet flags work from food names and categories only, never from ingredient lists.


## 17b. Nutrition, third delivery (2026-10-30)

**Scope.** "Delivery 3" was never written down, so I derived it from the original brief's items that Deliveries 1-2 had not delivered, and the owner confirmed it with these answers: reference data = adult EFSA upper levels + under-18 values, only where verified against the published tables (anything unverifiable stays unsupported, never guessed); Portuguese INSA food table = investigate, import only if it can be obtained and licensed cleanly; accessibility = add `@axe-core/playwright` as a test-only dependency; scope = everything.

| # | Item | Status | Evidence |
|---|------|--------|----------|
| D3-1 | Fixes found while inspecting | **Completed** | Attach-then-Enter dropped the chat image (async `FileReader` race; this was also the real cause of the failing `chat-images` "not an image" test): the composer now waits and shows "Reading the image…" (`ai-attach.spec.js`). The old `POST /meals` and `get_overview` used the UTC date and meal type "other": they use the profile's day and the time-of-day meal. `GET /meals` was unbounded (4.2 MB / 1.3 s on 2 years of data): now bounded. The floating assistant button was measured at desktop/tablet/phone: only the phone Plan tab's last row was covered, fixed with bottom padding. |
| D3-2 | "What could I eat?" | **Completed** | `nutrition_suggest.py` (pure scoring), `nutrition_suggest_api.py` (`/nutrition/suggestions`), Today card `Suggestions.jsx`, assistant tool `suggest_meals`. Candidates are the person's own recipes, favourite and recent foods, usual meals, then reference foods to discover. Ranked by how much of what is still needed one portion covers (capped at 100%), fit with the meal's energy, kitchen stock and expiry, and what was eaten lately. Only values a food reports are credited; diet and allergy words exclude (and are counted); every idea has a "why", and "Why so few" says what was excluded. |
| D3-3 | Week plan generator | **Completed** | `nutrition_planner.py`, `nutrition_plan_gen_api.py` (`/nutrition/plan/generate`, `/nutrition/plan/bulk`), `PlanGenerator.jsx` ("Suggest a week"), assistant tool `create_meal_plan` (preview, then the same arguments with `confirm=true`; undone in one step). Own recipes and foods only; the proposal is a preview and only the kept items are saved, all or none. |
| D3-4 | Insights and long trends | **Completed** | `nutrition_insights.py`, `nutrition_insights_api.py` (`/nutrition/patterns`), `PatternsView.jsx`, Trends views Overview / Patterns / Nutrient density, ranges 7 days to a year with weekly or monthly buckets (averages over logged days only), CSV with bucket columns, assistant tool `get_nutrition_patterns`. Measured on 2 years / 3,650 entries: trends 366 days 300 ms and 95 KB, other endpoints under 130 ms. |
| D3-5 | Recipe ingredient alternatives | **Completed** | `/nutrition/recipe-alternatives`, an Alternatives panel in the recipe dialog (effect on the whole recipe per serving before "Use"), assistant tool `suggest_recipe_alternatives`. |
| D3-6a | EFSA upper levels | **Completed** | `UPPER_LEVELS` in `nutrition_data.py` from EFSA's *Overview on Tolerable Upper Intake Levels*, version 11 (August 2025), tables 1-3: 14 nutrients, six age bands plus adults. Each level says what it covers: only levels that cover total intake are compared with logged food (calcium, copper, iodine, selenium, zinc, vitamin D, vitamin B6, vitamin E); folate and magnesium (added/supplemental only), vitamin A (preformed only) and niacin (nicotinamide only) are shown with the reason and never called exceeded; iron and manganese are EFSA "safe levels", not limits; vitamin C, K, B1, B2, B12, biotin, pantothenic acid, phosphorus, potassium, sodium, fat, saturated fat, protein, sugars and EPA+DHA have none and say so. Day payloads carry `upper_exceeded`; Today and Nutrients show a banner that frames one day above a level as a prompt to look, not a finding; the assistant gets the same wording. |
| D3-6b | Under-18 reference values | **Completed**, with limits | `_reference_child` in `nutrition_data.py`: EFSA 2017 summary report tables 1, 2, 3, 5, 7, 9, 11 for ages 1-17 in single years (energy AR at the nearest published PAL, protein per kg, fibre, fat range, water, 22 vitamins and minerals, thiamin and niacin per MJ). Nothing is scaled from adults: babies under 1, pregnant or breastfeeding under 18, and a child with no sex set get no values and a message pointing to a doctor. No weight-loss framing; a child's energy target under 85% of EFSA's requirement for the age is saved but warned about (`CHILD_LOW_ENERGY_SHARE`, an app rule not an EFSA value). Verification: I re-read both PDFs' text cell by cell against the code on 2026-10-30; `tests/test_nutrition_reference_efsa.py` (36 tests) checks every child value and upper level against `tests/efsa_tables.json`, which was transcribed from the PDFs (not generated by a script in this repo). The age comes from the birth year alone, so it can be a year out (stated in the notes). |
| D3-6c | Portuguese INSA table | **Not imported, by decision** | PortFIR (INSA's Excel download, TCA v6.0-2023) is free to download, but the download is a click-through ("by downloading you agree to the terms of use, under the law governing copyright"), a visible source credit is required, INSA's site footer says all rights reserved, and I found no licence text covering redistribution inside another application's database. Accepting that agreement is not mine to do on the owner's behalf and the terms do not clearly allow what an import would do, so I stopped as agreed. To proceed: the owner (or INSA's Departamento de Alimentação e Nutrição) confirms in writing that embedding the table in this app's database, with the credit line, is allowed; the importer would then follow `import_usda.py` (new `source`, `data_version`). The PortFIR site itself timed out when I fetched it, so the terms were read from INSA's news page and the EuroFIR notice, not the download dialog. |
| D3-7 | Quality gate | **Completed**, with limits | `@axe-core/playwright` 4.14.0 (published 2026-10-15), exact version, devDependency only. `e2e/nutrition-a11y.spec.js`: axe (WCAG 2.0/2.1/2.2 A and AA) on every tab (Today, Plan, Nutrients, Trends, Foods, Goals) and four dialogs (add food, recipe, target, week suggestion) at 1280, 820 and 390 px in light and dark, plus a sideways-overflow check: **12 tests, 0 violations**. `e2e/nutrition-reference.spec.js` (2) covers the teen, baby and adult views and the banner. No pixel snapshots (data-dependent and brittle): overflow assertions instead. The large-history measurement above was manual, not an automated test. |

### Accessibility findings fixed (first audit found 1,186 offending elements)
- Colour contrast (the large majority): white on emerald-600 buttons (3.76:1) now emerald-700; secondary text slate-500 on dark surfaces (3.4:1) now slate-400; slate-400 on white (2.6:1) and amber-600 / emerald-600 text on white now slate-500, amber-700, emerald-700; the light theme's muted text `--muted-foreground` (4.28:1 on tabs) darkened from 215 16% 47% to 215 16% 43%. This touched shared pieces (app shell header and mobile nav, `common.jsx`, `index.css`), so other pages gain too.
- The header search button and the mobile "+" button had no accessible name.
- `DatePicker`'s accessible name ignored its visible date (now "Day: Tue 4 Mar 2019"), a WCAG 2.5.3 failure on every page that uses it.
- The add-food dialog's tab triggers pointed `aria-controls` at panels that do not exist.

### Defects found and fixed in the third delivery
- Found by the browser run's 500s in the backend log: `/nutrition/suggestions` (and the week generator) answered 500 when a derived nutrient (EPA + DHA, available carbohydrate) became a focus, because the name lookup used only stored nutrients. Fixed with `nutrition_data.meta()`; regression test `test_a_derived_nutrient_that_is_a_gap_is_named_not_a_crash` (it failed with 500 against the old code).
- `get_nutrition_targets` raised `KeyError: 'over'` for the new upper-level output (4 assistant tests failed): fixed, and covered by a teenager test.
- My palette change removed a constant the Goals target dialog still used, so opening it crashed; caught by the new dialog audit, fixed, and `SRC_LABEL` is now shared.
- Earlier in this delivery (committed with stages 1-5): planner gave a single slot the whole day's budget; "nothing planned" explained itself wrongly when recipes lack fibre data; insights suppressed "Other provides 100%" and showed neutral chips when most entries were unclassified; the shared test account had used up its energy (suggest test uses a fresh account).
- Test fragility, not product bugs: the suggestion specs assumed the clock's default meal (after 17:00 it is "Snacks", where a 400 kcal recipe does not fit), so they now pick Dinner; four leftover `E2E-` recipes and foods from timed-out runs were deleted from John's account (only names starting `E2E`).

### Verification (2026-10-30, standard test account; password supplied per command, never stored)
- Backend **570 passed** (was 464), in parallel; pyflakes clean on all changed files (old unused imports elsewhere untouched).
- Frontend: 20 unit tests passed; production build **Compiled successfully** with `CI=true`; ESLint (throwaway config with react-hooks and jsx-a11y, removed afterwards) reports no errors on the changed files except three `autoFocus` props (add-food search, recipe dialog, Today inline edit), which were there before and are intentional.
- Browser: the full suite without the live-model tests, run after the last code change: **114 passed**, 0 failed; the backend log of that run has no 500 and no traceback. The first full run of the day had 4 failures: three were the suggestion specs (the clock and the leftover recipes above), one was `saved-chats` "rename keeps the new name after a reload", which passed 9 of 9 when run alone and looks like a timing flake under load (not investigated further).
- Not touched: no live-model calls were made.

### Not verified
Live-model behaviour with about 100 tools; a screen reader; a real phone camera, Safari and Firefox; real Open Food Facts calls; reference values against a doctor's or dietitian's judgement (they are EFSA tables, not advice); the printed result on paper; the INSA table (not imported).

### Known limitations after the third delivery
No reference values for babies under 1 year, pregnant or breastfeeding under 18, or medical conditions; supplements are not logged, so upper levels can only be compared where EFSA's footnote says they cover total intake; age is derived from the birth year; EFSA 2017 values are used for sodium and potassium although EFSA revised them in 2019 (WHO limits are shown for sodium); food data remains USDA-centred, with no Portuguese-specific table until the INSA question above is settled.
