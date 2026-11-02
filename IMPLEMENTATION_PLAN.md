# LifeRecord — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every open item in `APPLICATION_COMPLETION_ROADMAP.md` (F-, D-, S- series) in an order that makes each change safe, with measurable evidence per task.

**Architecture:** Work is organised in seven phases. Phase 2 (a throw-away test database) is the pivot: it makes the later refactor (F-02), the isolation proof (S-12) and CI (S-10) safe. Owner-only actions run in parallel on a separate track and never block code phases.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + aiomysql + Alembic (MySQL 8.4) · React 19 + CRA/Craco + Tailwind/shadcn · pytest (xdist) · Playwright + axe-core · Graphify.

**Spec:** [`APPLICATION_COMPLETION_ROADMAP.md`](APPLICATION_COMPLETION_ROADMAP.md) (authoritative). History: [`docs/history/ROADMAP_ARCHIVE_2026-10-19_to_30.md`](docs/history/ROADMAP_ARCHIVE_2026-10-19_to_30.md) (never edit).

**Plan date:** 2026-11-01 · Branch `feature/roadmap-completion` · code baseline `ca27e44` (= graph build commit).

**Status of this document:** the plan was approved on 2026-11-01 (owner answers: Q0 "whatever you recommend", Q1 `liferecord`, Q3 limits accepted, Q5 harness schemas "whatever you think is best") and is being executed. The section below records what actually happened; the sections after it are the original plan, kept so the deviations can be seen. Where the two disagree, this section wins.

## Progress log (updated as work is done)

Execution style (Q0): **native**, one task at a time, each verified before the next (the harness allows subagents only when asked for, and the tasks share too many files to split safely).

| Task | Roadmap | Status (2026-11-01) | Evidence |
|---|---|---|---|
| T0.1 reconcile docs and DB login | - | **Done** | Live login is `liferecord` (grants checked read-only; `liferecord_app` does not exist). README, roadmap, `provision_db.py`, `backend/.env.production.example` fixed. Commit `54e8f42`. |
| T0.2 baseline | - | **Done, differently** | Run on a scratch stack instead of the live one (no `TEST_PASSWORD` exists in the store). First run on an empty schema: 510 passed / 54 failed / 8 errors (missing foods, John's data, mail config). With foods and John seeded: 561 / 12 / 1. Final: **651 passed, 2 skipped**. |
| T1.1 onboarding | F-01 | **Done** | 10 backend + 2 browser tests; see roadmap row. |
| T1.2 usage limits | S-04 | **Done** | 11 backend + 2 frontend unit tests. |
| T1.3 dependency audit | S-05 | **Done** | `docs/security/dependency-audit-2026-11-01.md`. |
| T1.4 seed gaps | F-04 | **Done** | `test_seed_data.py`. F-08 (one live Open Food Facts lookup) **not done**: it is an outbound call the owner has not approved (Q12). |
| T2.1 throw-away stack | F-03 | **Done** | `backend/tests/isolated_env.py`. |
| T2.2 independence from real accounts | F-03 | **Done** | The suite no longer needs a running backend or a real account when `LR_ISOLATED=1`. The plain mode still exists and still works against the live stack. |
| T2.3 drift test | - | **Done** | Found one real drift (index `ix_meals_client_ref` in a migration but not in the model); fixed in the model only, so no database change. |
| T2.4 / T2.5 isolation matrix | S-12 | **Done** | 32 tests, 31 tables, 87 id-routes. |
| T3.x frontend (D-01..D-10, S-03) | - | **Partly done** | D-01..D-10 as in the roadmap rows. S-03 (access token in memory) and the new S-17 (server-side sessions, authentication on every route) were completed on 2026-11-02; evidence in the roadmap. |
| T4.1 split server.py | F-02 | **Not started** | Safety net exists (`test_server_surface.py`, golden snapshot of 199 routes); moves not begun. |
| T4.2 failure sweep | S-13 | **Done** | Backend fix, sweep table and the browser check of the offline banner (`e2e/failure-sweep.spec.js`); roadmap row S-13. |
| T4.3 data hygiene | S-14 | **Waiting for approval** | Deleting an account and log files needs the owner's yes (dry run first). |
| T4.4 backups | S-07 | **In progress** | Tools and tests done, rehearsal on the real database matched 36 tables / 9,624 rows. Owner still chooses folder, schedule and encryption. |
| T4.5 export and delete | S-11 | **Done** | Backend and the Settings "Your data" card; roadmap row S-11. |
| T5.x CI, deployment | S-10, S-09, S-15 | **Partly done** | S-15 done (documented). S-10: workflow and local script written, not yet run on GitHub. S-09 not started (needs the owner's target). |
| Money: main account and places | F-12 | **Done** | Added outside the original plan (2026-11-02): a main account and its places are one amount of money. Roadmap row F-12. |
| Authentication audit and hardening | S-18 | **Done** | Added 2026-11-02 after the owner asked for a complete audit: verification codes, enumeration, pre-hijacking, brute force and its denial-of-service side effect, bcrypt limit, reset and password-change policy, session cap, secret length, deactivation, cross-tab sign-out. Evidence and the limits that remain are in the roadmap row. |
| T6.x owner tasks | S-01, S-02, S-06, S-08, F-05..F-07, F-09..F-11, D-05, D-09 | **Blocked** | Need the owner; see roadmap rows. |

### Deviations from the plan, and findings the plan did not foresee

1. **F-01 was bigger than planned.** The Money screen could not create a top-level account at all (the dialog only makes sub-places under Cash or Revolut), and the API happily booked expenses to accounts that did not exist, so a new user's first expense was silently lost. Both fixed (`FirstAccounts.jsx`, `require_account_id`). Plan section 4.2, A5, understated this.
2. **The scratch stack needs a dead-end AI provider, not a blank one.** With no key the assistant answers "not configured" before it validates attachments, so specs that test those validations failed. The scratch server is now "configured" with an address that has no usable scheme, so no model is ever reachable. Mail got the same treatment (loopback port 1).
3. **`seed_john.py` and `cleanup_account.py` hard-coded the real schema.** Running the seed against a scratch stack would have written to the real database; it failed on a foreign key before writing anything (verified: real row counts unchanged). Fixed, and a test now fails if any script hard-codes the schema again.
4. **`cleanup_account.py` missed the five nutrition tables** (so `seed_john.py --reset` left old nutrition data behind). Its list now comes from the models.
5. **Time-dependent specs.** The seed logged meals for "today", which left the suggestion specs nothing to suggest on the day of seeding; and one spec raced the card's list. Seed and spec fixed.
6. **Two routes accept harmless no-ops** in the isolation matrix (`DELETE .../favorite` and submit of another user's list); documented in the test with the reason.
7. **A secret appeared in test output once.** A failing assertion printed a pytest fixture value that contained the database administrator password, so it is now in this session's transcript. The fixture was changed to yield only a name, and no other test passes credentials around. **Recommendation: rotate `ADMIN_DATABASE_PASSWORD`** (an owner action, added to the S-02 checklist).
8. **Open question on "password LifeRecord" (Q1).** The owner's answer asked for a password to be "LifeRecord" without saying whose. Nothing was changed: the app rejects it as a password (no digit), and setting it on the database login or the owner account would weaken what the security batch built. Waiting for a one-line clarification.
9. **Frontend files stay unchanged while a browser run is in progress.** The browser suite runs against a dev server that reloads on every edit, so UI work waits for the run to finish; backend work does not.

## Global Constraints

Copied from the roadmap (Appendix B, §0.2) and `CLAUDE.md`; every task inherits them.

- Secrets stay in the DPAPI store outside the project; never printed, never committed. The test password is supplied per command (`python backend/local_secrets.py run -- …`) and never stored.
- **No live AI-model calls in any automated test** (provider keys blank in every test process). No real email to real recipients; reserved domains (`example.com`, `example.test`) are never mailed.
- Tests only run against a local backend (`127.0.0.1`/`localhost` guard in `tests/support_auth.py` and `e2e/fixtures.js` stays).
- Do **not** edit `backend/pytest.ini` `addopts` (`-n 2 --dist loadscope`; the file says so). Do not edit the archived roadmap.
- Use `127.0.0.1`, not `localhost`, for DB and test URLs (Windows tries IPv6 first and stalls ~2 s).
- A roadmap item moves to **Done** only with named evidence (file, test or measured run) written into its roadmap row.
- Commits follow the history's style (`feat(scope):`, `fix:`, `test:`, `docs:`), one task per commit unless stated, on `feature/roadmap-completion`.
- New backend test accounts must use an email prefix registered in `backend/tests/conftest.py::TEST_USER_EMAIL`, or they leak into the database.
- Destructive or outward-facing steps (deleting accounts/logs, sending mail, live lookups, pushing, DB schema changes) need the owner's approval at the moment they are reached; approval of this plan approves the *design*, not those steps.

## Review Focus

Input classes the roadmap implies but no existing test exercises. Each is pinned by a test in the owning task.

1. **A brand-new account (zero categories, zero accounts) entering Money through every door** — Money page, QuickAdd, Home widgets, assistant "add expense". Expected: a clear prompt to create the first account, never a blank form or a 500. → T1.1
2. **A rate-limited request mid-stream** — a 429 from `/ai/chat/stream` must read as a human message in the assistant panel, not "network error"; and the daily cap must survive the table cleanup. → T1.2
3. **Reload, second tab and expired access token after the token moves out of `localStorage`.** Expected: still signed in (cookie refresh), no flash of the login page, sign-out-everywhere still revokes. → T3.8
4. **Empty-state DOM in accessibility audits.** John's seed is rich; a new account renders different markup (empty states, onboarding card). Audit both. → T3.2
5. **Deleting an account that is the owner, has files on disk, or has scheduled tasks mid-run.** Expected: owner refused with a reason; uploads removed; no orphan rows in any of the 31 user tables. → T4.5

---

## 1. How this plan was produced (tools and limits)

| Tool | Used? | What / limitation |
|---|---|---|
| Roadmap | Read completely (261 lines) | — |
| **Graphify** | **Yes**, on the existing graph | `graphify-out/` was built from `ca27e440`, identical to `HEAD` (`git rev-parse HEAD`), so no rebuild was needed or done. Used `graphify query`, `explain`, `path` and read `GRAPH_REPORT.md`. **Limits:** (1) the graph is 3,771 nodes / 11,342 edges / 158 communities, 94 % extracted, but it also indexes Markdown and the legacy `test_result.md`, which pollute hubs and god nodes (§3); (2) it shows `contains/calls/imports` but not route→table relations, so route counts and table facts came from reading `server.py` and loading `models.py`; (3) BFS output is token-capped. |
| **Superpowers** | **Yes** — `superpowers:writing-plans` (structure, TDD-sized steps, self-review). Execution will use `test-driven-development`, `verification-before-completion`, and either `subagent-driven-development` or `executing-plans` (your choice, §5 Q0). | — |
| Code inspection | Backend: `server.py` (auth, rate limit, seed, AI routes, uploads, lifespan), `database.py`, `models.py` (imported to count tables/FKs), Alembic chain, tests infra (`conftest.py`, `support_*.py`, `pytest.ini`), `cleanup_account.py`, `seed_john.py`. Frontend: `App.js`, `AppShell`, `AuthContext`, `api.js`, `routes.js`, `SettingsContext`, e2e fixtures/config, existing `build/`. | Not read line-by-line: the 5,399-line `server.py` outside the parts above, the nutrition modules, the other pages. |
| **Not run** | Backend/frontend/Playwright suites; any DB query; `pip-audit`/`yarn audit`; live services | They need `TEST_PASSWORD`, a running stack, or touch the database. No services were listening on 3000/8000/3306 when checked. All "last recorded" figures in the roadmap remain **unverified by me**. |

## 2. Architecture and important relationships

```
Browser (React 19, CRA/Craco, :3000)
  App.js ─ SettingsProvider ─ AuthProvider ─ Router
     Protected ─ AppShell ─ NAV(10 pages) · MOBILE_NAV(Home, Money, +, People, Tasks) · CommandBar · QuickAdd · AIAssistant
     pages/*  (lazy chunks via lib/routes.js pageLoaders; warmAllRoutes() prefetches every page's code+data when idle)
     data:  lib/useFetch + swrCache + query.js + refreshScope.js  ─►  lib/api.js (axios, Authorization header from localStorage "lm_token")
                                                                       lib/aiStream.js (fetch SSE, also reads "lm_token")
        │  HTTPS-ready, CORS + CSRF header ("X-Auth-Mode: cookie"), refresh token in HttpOnly cookie `lr_refresh` (path /api/auth)
        ▼
FastAPI (:8000)  server.py  (5,399 lines, 120 routes on `api_router` prefix /api)
  ├─ in server.py: auth(11) · shopping(19) · groceries(10) · people(8) · recipes(7) · ai(7) · transactions(6) · products(6)
  │                 workouts(5) · photos(5) · accounts(5) · weight(4) · tasks(4) · storage-locations(4) · meals(4) · categories(4) · appliances(4) · …
  ├─ domain modules, each `register(api_router, server_module)`: conversations_api, chat_images, scheduling_api, calendar_api,
  │                 nutrition_api → nutrition_plan_api / nutrition_suggest_api → nutrition_plan_gen_api, nutrition_insights_api
  ├─ assistant: run_ai_chat → ai_chat_events (≤ 7 model rounds per message, server.py:4439) → dispatch_tool (server.py:4747, 113 edges)
  │                 AI_TOOLS = server tools + ai_tools_extra (17) + ai_tools_nutrition (34) = 101; providers ai_opencode / Gemini
  ├─ cross-cutting: security_utils (JWT/bcrypt), file_crypto (Fernet), local_secrets (DPAPI), email_service (SMTP relay, email_events),
  │                 scheduling.Scheduler (started in `lifespan`), rate limiting = `check_rate_limit` + table rate_limit_events
  └─ lifespan (server.py:5327): Base.metadata.create_all → seed() → ensure_shared_catalog() → migrate_legacy_account_refs() → scheduler
        ▼
MySQL 8.4 (127.0.0.1:3306), 35 tables: 31 carry user_id (all FK → users ON DELETE CASCADE, verified by loading models.py);
  users, splits, rate_limit_events, email_events do not (by design). Alembic: 22 revisions, single head b5d7f9a1c3e4.
Files: backend/storage/ (encrypted photos + chat images, NOT covered by FK cascade).
```

Properties that drive the plan:

- Domain modules receive the *server module* (`sys.modules[__name__]`) and call its helpers (`get_current_user`, `to_dict`, `new_id`, …). **This is the pattern F-02 must keep.**
- 14 backend test modules `import server` in-process; ~36 call a running backend over HTTP as a real account. Both read `DATABASE_*` from the environment (`database.py`, `alembic/env.py` honour `DATABASE_NAME`).
- The schema is created *twice*: Alembic and `create_all` in `lifespan`. Nothing today proves they agree.
- Access tokens travel only in the `Authorization` header; the refresh endpoint does not rotate tokens.

## 3. Graphify context findings

| Finding | Evidence (graph / code) | Consequence |
|---|---|---|
| `server.py` is the hub: 361 connections, imported by ≥10 test modules and `owner_admin.py` | `graphify explain "server.py"` | F-02 must keep names re-exported from `server` or those tests break. |
| `check_rate_limit` has 16 edges: 7 callers, **all auth routes** (`server.py` 1243, 1275, 1305, 1342, 1366, 1381, 1449) + 2 test callers | `graphify explain "check_rate_limit"`; `grep` | **S-04 confirmed.** |
| God nodes: `cn()` 305, `test_result.md` 207 (legacy test log, noise), `Button` 126, `dispatch_tool()` 113, `react`, `lucide-react`, `Input` 78, `to_dict()` 75, `register()` 69, `useFetch()` 64 | `GRAPH_REPORT.md` | Shared UI primitives (`cn`, `Button`, `Input`) mean a token change touches every page (D-04) — fix contrast once, at the token. `dispatch_tool` and `to_dict` are the assistant/REST seam F-02 must not break. |
| "Import Cycles: None detected" | report | Baseline to re-check after each F-02 move. |
| Graph quality: Markdown headings and `test_result.md` appear as community hubs | report "Community Hubs" | Recommend (Q14) excluding `test_result.md`, `docs/history/` and `LifeRecord/` from the graph; not done. |
| `get_current_user` → `dispatch_tool` path is 2 hops via `server.py` | `graphify path` | Assistant tools share auth/service code with REST — isolation tests (S-12) cover both. |

## 4. Roadmap analysis

### 4.1 Claims re-verified against the code (2026-11-01)

| Roadmap claim | Result |
|---|---|
| `server.py` 5,399 lines | ✔ |
| 35 tables; 31 with `user_id`; the four exceptions | ✔ (loaded `models.py`); additionally all 31 FKs are `ON DELETE CASCADE` |
| Alembic 22 revisions, head `b5d7f9a1c3e4` | ✔ (parsed) |
| Auth endpoints only are rate limited (S-04) | ✔ |
| 6 of 10 destinations missing from phone bar (D-02) | ✔ (`MOBILE_NAV = [Home, Money, +, People, Tasks]`) |
| No onboarding (F-01) | ✔ and sharper — see A5 |
| `lm_token` in `localStorage` (S-03) | ✔ — read/written in `api.js`, `AuthContext.jsx`, `aiStream.js`, `e2e/fixtures.js` |
| `design_guidelines.json` is single-user "Sá" (D-10) | ✔ (lines 2, 5, 6, 76, 159) |
| `eur()` hard-codes `en-IE`/EUR at `api.js:93` (F-09) | ✔ |
| 23 Playwright specs, 3 unit-test files, no CI | ✔ (no `.github/`) |
| 44 backend test modules | 43 `test_*.py` + `backend_test.py` (legacy) = 44 ✔ |
| Last-run results (570 / 20 / 114) | **Not re-run** (needs the owner's password and a live stack). Static count: 496 `def test_` in backend modules (parametrisation explains the gap). |
| 101 assistant tools | Not re-verified (importing `server` needs the secrets store). |

### 4.2 Adjustments to the roadmap, with evidence

| # | Finding | Evidence | Recommended change |
|---|---|---|---|
| **A1** | **Database login name is inconsistent.** Roadmap §1.1 and README 99/175 say `liferecord_app`; `backend/.env` has `DATABASE_USER=liferecord`; the *uncommitted* diff of `tools/provision_db.py` renames `APP_USER` to `liferecord`. | `git diff tools/provision_db.py`; `.env` | New **T0.1**: owner confirms the live name; make README, roadmap §1.1, `provision_db.py` agree. Blocks nothing else, but S-07/S-09 docs would inherit the error. |
| **A2** | **S-04 pitfall:** `check_rate_limit` deletes *every* event older than 2 × the auth window (120 s) with an unscoped `DELETE` (`server.py:114-115`). Reusing `rate_limit_events` for daily caps would silently erase them. | code | S-04 needs a limiter with per-scope retention (≥ 24 h), no new table. Test pins it (T1.2). |
| **A3** | S-04 has a natural bound: one chat message makes ≤ 7 model calls (`range(7)`, `server.py:4439`); message ≤ 4,000 chars; image ≤ 10 MB; upload size is already capped (`MAX_UPLOAD_SIZE`). Only *counts* are missing. | code | Limits are per request, not per token; propose defaults in Q3. |
| **A4** | **S-03 is frontend-only and low-risk:** the server reads the access token from the `Authorization` header; the refresh cookie is `HttpOnly`, path `/api/auth`, and `/auth/refresh` does **not rotate**, so concurrent tabs cannot race each other. | `server.py:244-300`, `1412-1435` | Keep the roadmap scope. Also remove the legacy `lm_refresh_token` migration path. |
| **A5** | **F-01 root cause:** the 12 starter categories exist only in `seed()` (`server.py:5155`), attached to the *owner*, guarded by a *global* `count(Category) == 0`. `register`/`verify_code` create nothing; Money and ExpenseDialog have no empty state. | code; grep | Extract the list into a helper called at first email verification; add a guided "create your first account" prompt. No lazy-create on `GET /categories` (it would resurrect categories a user deleted on purpose). |
| **A6** | **F-03 is cheaper than the roadmap implies:** `lifespan` already builds the schema (`create_all`) and seeds the shared catalog; `database.py` and `alembic/env.py` read `DATABASE_NAME`. What is missing: `support_db.connect()` hard-codes `database="liferecord"`, tests assume the seeded account/foods, and nothing starts a server on a scratch schema. | code | Harness described in T2.1; no change to application code needed. |
| **A7** | **Two schema mechanisms (Alembic + `create_all`) with no drift check.** | `lifespan` | New **T2.3** (drift test). If it finds drift, a migration is needed → owner approval at that moment. |
| **A8** | **D-06 root cause:** the Settings "animations" switch only toggles a CSS class (`SettingsContext.jsx:29-32`, `.no-anim`), which framer-motion ignores; framer-motion is used in 7 files (`AppShell` intro, `Home`, `Login`, `Signup`, `ForgotPassword`, `ResetPassword`, `AIAssistant`) and only `AIAssistant` calls `useReducedMotion`. | grep | One `MotionConfig` at the root fixes all, and can honour both the OS preference and the in-app switch. |
| **A9** | **D-07 baseline already on disk** (`frontend/build/`, date unknown): `main.*.js` 1,042,823 B raw; ZXing chunk 443,275 B; chunk `640` 331,939 B; chunk `739` 155,687 B. `warmAllRoutes()` downloads every page's code and data after sign-in. | `ls build/static/js` | Treat as indicative; T3.7 re-measures gzip sizes and decides whether prefetching-everything is acceptable. |
| **A10** | **S-11 hazards the roadmap does not mention:** (a) FK cascade does not remove files in `backend/storage`; (b) `cleanup_account.py` keeps its own hard-coded table list (line ~30) that can drift from `models.py`; (c) `seed()` recreates an owner account on every start if none exists, so deleting the owner is self-healing in the wrong way. | code | Derive the table list from `Base.metadata`; refuse owner self-deletion (Q7). |
| **A11** | **S-12 can be made self-maintaining:** a test that enumerates `Base.metadata` tables with `user_id` fails when a new table lacks an isolation case. | models | Table-driven matrix (T2.5). |
| **A12** | **S-16 interplay:** `pytest.ini` pins `-n 2 --dist loadscope`; the isolated harness must set its environment in the xdist *controller* before workers start. | `pytest.ini` | Verified in T2.1 step 4. |
| **A13** | **P3-3 (hash verification codes) would break tests** that read codes from the database (`support_db`, `test_auth_multiuser`). | email audit P3-3; `conftest.py` | Keep P3-3 in S-06's owner-gated bundle; do the test change in the same commit. |

### 4.3 Order and batches: kept vs changed

The roadmap's batches stay as *groupings*. Execution order changes because dependencies are tighter than the batch letters suggest:

- **F-03 before F-02, S-12, S-10** (roadmap agrees for F-02/S-10; S-12 is added: its tests need a safe database).
- **S-04 before F-02** so the AI routes are not edited while being moved.
- **D-02 before D-01** (navigation DOM changes) and **D-01 before D-04/D-03 fixes** (shared-token fixes land once).
- **S-03 is independent of Part 2** but touches `fixtures.js`, which every e2e spec uses — do it right after the a11y specs are green so any breakage is attributable.
- **D-10 last in Part 2**, after tokens settle (roadmap agrees).

---

## 5. Decisions and approvals needed from you

Reply "approve recommended" to accept every recommendation, or answer individually.

| Q | Decision | Recommendation |
|---|---|---|
| Q0 | Execution style: **subagent-driven** (fresh agent + reviewer per task) or **native** (I implement, one review at the end)? | Subagent-driven for Phases 2 and 4 (many interface dependencies, a shipped mistake in a refactor or isolation proof is costly); native is acceptable for Phase 3 UX tasks. |
| Q1 | Which database login is real: `liferecord` or `liferecord_app`? OK to commit the pending docs reorganisation and `provision_db.py` change once names agree? | Check with your admin login; I will not query the DB without your go-ahead. |
| Q2 | Approve the order in §7 and the Phase 0–1 start? | Yes. |
| Q3 | S-04 default limits (env-configurable): chat 20/min + 300/day; transcribe 10/min + 100/day; receipt 10/min + 50/day; photo upload 20/min + 100/day. Add a per-user total-storage quota? | Accept numbers; **no** storage quota now (count caps + 10 MB file cap suffice until S-09 chooses hosting). |
| Q4 | F-01: starter **categories** automatically at first verification + guided first-account prompt (no default accounts, because balance/currency are the user's). | Yes. Existing accounts untouched, as the roadmap requires. |
| Q5 | F-03: may the test harness create and drop schemas named `liferecord_test_<pid>` with the admin login (never the `liferecord` schema; hard guard in code)? | Yes. |
| Q6 | F-02 stop criteria: move categories/accounts, people, fitness/body/tasks, groceries/kitchen, money, auth. **Leave the assistant core** (`run_ai_chat`, `dispatch_tool`, 101-tool wiring) in `server.py`? | Yes — highest coupling, lowest payoff; revisit after F-05. |
| Q7 | S-11 scope: in-app **export + delete own account** (re-enter password, typed confirmation), owner role refused. | Yes (roadmap's "preferably"); fall back to a documented procedure if you prefer. |
| Q8 | S-10: GitHub Actions (origin is `github.com/sazzin07/LifeRecord`) plus an equivalent local script `tools/ci_local.ps1`? | Both; CI needs no secrets (provider keys blank, MySQL service container). |
| Q9 | S-07: backup folder (outside the project, ideally another drive), retention (14 daily + 8 weekly), backup encrypted or not? | Folder: you choose. Retention as stated. Encrypt (dump holds health data). |
| Q10 | S-09: stay local-only (declare non-goal, document) or choose a target (single VM + reverse proxy; Docker)? Vercel suits poorly: stateful local file storage, MySQL, in-process scheduler. | Decide when you want to publish; plan keeps S-09 conditional. |
| Q11 | F-09 EUR-only (document), F-10 offline = non-goal, F-11 no recurring transactions now. | Yes to all three (roadmap's own recommendations). |
| Q12 | F-04: extend John's seed with photos + AI action history, document "no recurring transactions". F-08: allow one read-only lookup of a known barcode against the public Open Food Facts API? | Yes to both. |
| Q13 | D-07: budget = measured gzip size + 10 %, enforced in the build check? | Yes. |
| Q14 | Exclude `test_result.md`, `docs/history/`, `LifeRecord/` from the Graphify corpus (cleaner hubs)? | Yes; one small ignore file. |
| Q15 | F-05 (one bounded live-assistant run), F-06 (INSA licence), F-07 (more reference tables) — keep blocked until you act? | Keep blocked. Listed in Phase 6. |

**Missing resources I need from you:** `TEST_PASSWORD` for the baseline run and e2e (per command, never stored) · confirmation the test MySQL and John's seed are available · NVDA and Safari/Firefox/a phone for D-05/D-09 · a domain + DNS access for S-06 · a public HTTPS URL for the SendGrid webhook · INSA's written permission for F-06.

---

## 6. Phases and numbered tasks

Conventions: **Files** list what changes; **Produces** names interfaces later tasks use; each task ends with its acceptance criteria (measurable) and a commit. TDD order inside every code task: failing test → see it fail → minimal implementation → see it pass → commit. Sizes: S ≤ ½ day, M ≈ 1 day, L ≥ 2 days.

### Phase 0 — Alignment and baseline

#### T0.1 Reconcile docs and database-login name (A1) — S
**Files:** modify `README.md` (lines ~99, 175), `APPLICATION_COMPLETION_ROADMAP.md` §1.1, `tools/provision_db.py` (already modified, uncommitted); commit the staged `docs/history/` moves.
- [ ] Owner confirms the real login (Q1). Make all four places say the same thing.
- [ ] `git status` shows only intended files; commit `docs: reconcile database login name; archive previous roadmap`.
**Acceptance:** `grep -rn "liferecord_app" README.md APPLICATION_COMPLETION_ROADMAP.md tools/ backend/*.py` returns nothing or only the confirmed name; working tree clean apart from `.claude/` and graph output.

#### T0.2 Baseline run (no code change) — S
**Needs:** `TEST_PASSWORD`, stack up (`start-all.ps1`), John seeded.
- [ ] Backend: `cd backend; python local_secrets.py run -- .venv\Scripts\python -m pytest tests -q` (record passed/failed/time).
- [ ] Frontend: `CI=true yarn test --watchAll=false`; `CI=true yarn build`; record main/lazy chunk sizes.
- [ ] Playwright without live-model specs (`ai-assistant`, `ai-attach` excluded or stubbed as the archive §17b did).
- [ ] Record figures in a new dated row of roadmap Appendix D. Do **not** overwrite §0.3 yet (S-16 does).
**Acceptance:** one table of today's pass/fail counts and durations; any failure is listed with its cause before any other task starts. If the baseline is red, fix or quarantine first.

### Phase 1 — Highest-value, low-risk code (roadmap Batch 1A + S-04/S-05)

#### T1.1 F-01 New-account onboarding — M
**Files:** create `backend/starter_data.py`; modify `backend/server.py` (`seed()` ~5140-5170, `verify_code` ~1298-1336); create `backend/tests/test_onboarding.py`; modify `frontend/src/pages/Money.jsx`, `frontend/src/components/ExpenseDialog.jsx`, `frontend/src/components/QuickAdd.jsx` (empty state → open existing `AccountDialog`); create `frontend/e2e/onboarding.spec.js`, `frontend/e2e/support/verification-code.js`; modify `backend/tests/conftest.py` (new email prefix `onboard`).
**Produces:** `STARTER_CATEGORIES: list[tuple[str, str, str]]` (name, icon, colour — the 12 now in `seed()`); `async def ensure_starter_categories(db: AsyncSession, user_id: str) -> int` (idempotent: inserts only when the user has zero categories; returns rows added).
- [ ] Tests (backend, new file): `test_verifying_a_new_account_creates_the_starter_categories` (register → read code via `support_db` → `/auth/verify` → `GET /categories` names == `STARTER_CATEGORIES`); `test_ensure_starter_categories_is_idempotent` (second call returns 0); `test_a_user_with_existing_categories_is_untouched` (one custom category stays the only one); `test_a_second_new_user_gets_their_own_copy` (ids differ, isolation holds); `test_owner_categories_from_seed_unchanged` (owner keeps 12, none added).
- [ ] Run → fail (`ModuleNotFoundError: starter_data`).
- [ ] Implement helper; call it inside `verify_code` before `_issue_session`, in the same commit as `email_verified = True`. Make `seed()` use it for the owner (behaviour identical on an existing install).
- [ ] Frontend: when `GET /accounts` returns `[]`, Money/QuickAdd/ExpenseDialog show an `aria`-labelled card "Create your first account" that opens `AccountDialog`; data-testid `onboarding-first-account`.
- [ ] e2e: sign up (`example.com` address, never mailed) → read code through the helper (it shells out to `support_db`) → verify → Money shows the card → create "Cash" → add a "Groceries" expense → appears in the list. Cleanup via conftest regex.
- [ ] Cover Review Focus 1: assert the card also appears from QuickAdd and that the assistant tool `add_expense` on an account-less user returns a readable error (extend `test_ai_extra_tools.py` pattern; no model call).
**Acceptance:** all new tests pass; John's category/account counts unchanged before/after (record numbers); signup→first expense passes in ≤ 1 Playwright run; no change to existing users' rows.
**Commit:** `feat(onboarding): starter categories at first verification and guided first account (F-01)`

#### T1.2 S-04 Per-user limits on cost-bearing endpoints — M
**Files:** create `backend/usage_limits.py`; modify `backend/server.py` (`/ai/chat` 4533, `/ai/chat/stream` 4538, `/ai/transcribe` 4569, `/ai/receipt` 4606, `POST /photos` 2579, and the unscoped cleanup in `check_rate_limit` ~112-115); create `backend/tests/test_usage_limits.py`; modify `frontend/src/lib/aiStream.js` and `components/AIAssistant.jsx` (429 message); README limits table; conftest prefix `limits`.
**Produces:** `async def check_user_limit(user_id: str, scope: str, *, per_minute: int, per_day: int) -> None` — raises `HTTPException(429, detail=<human text>, headers={"Retry-After": "<seconds>"})`; bucket = `sha256("user:{user_id}:{scope}")` in the existing `rate_limit_events` table; env overrides `LIMIT_<SCOPE>_PER_MINUTE/_PER_DAY`. The auth cleanup becomes scoped: it deletes only auth buckets older than 2 × window; user-limit rows are pruned at > 25 h.
- [ ] Tests: `test_nth_plus_one_chat_in_a_minute_returns_429_with_retry_after`; `test_limit_is_per_user` (user B unaffected); `test_daily_cap_survives_the_auth_cleanup` (insert events 3 h old, force cleanup branch, assert still counted — pins A2); `test_429_happens_before_any_model_call` (provider stub counter stays 0); `test_streaming_429_is_a_normal_http_response` (status 429 before the SSE body starts); `test_photo_upload_limit`; frontend `aiStream` unit test: 429 → message text surfaced (Review Focus 2).
- [ ] Run → fail; implement; run → pass; document defaults from Q3 in README.
**Acceptance:** each of the five endpoints returns 429 past its limit in a test; counts survive the cleanup; auth rate-limit tests (`test_session_security.py`) still pass; README lists the numbers and env names.
**Commit:** `feat(security): per-user limits on assistant, voice, receipt and upload endpoints (S-04)`

#### T1.3 S-05 Dependency audit refresh — S
**Files:** roadmap S-05 row; new `docs/security/dependency-audit-2026-11-xx.md` (tool output, triage table).
- [ ] Backend: run `pip-audit -r backend/requirements.txt` **outside the project venv** (`pipx run pip-audit` or a scratch venv) so the project environment is untouched.
- [ ] Frontend: `yarn audit --groups dependencies` and `yarn audit` (all) → separate runtime from build-tooling.
- [ ] Triage every high: upgrade / accept (reason) / dev-only. Apply only runtime fixes whose upgrade is patch/minor; full suite after each (T0.2 numbers are the reference).
**Acceptance:** dated results for both ecosystems in the roadmap row; zero un-triaged high; ZXing, axe-core, aiosmtplib, cryptography explicitly listed.
**Commit:** `docs(security): dependency audit 2026-11 (S-05)`

#### T1.4 F-04 and F-08 (cheap verification) — S
- [ ] F-04: extend `backend/seed_john.py` through the REST API: two progress photos (reuse `frontend/e2e/red.b64` image), AI action history rows inserted directly like its saved chats; document "no recurring transactions" in README. Test: `seed_john.py --reset` against the T2.1 scratch stack then assert counts.
- [ ] F-08 (after Q12 approval): one read-only lookup of a known EAN against Open Food Facts; record the EAN, date and the mapped nutrients in the roadmap row. No automated live test.
**Acceptance:** seed reproducible; both roadmap rows carry evidence.

### Phase 2 — Test foundation (F-03, drift check, S-12)

#### T2.1 Throw-away database harness — L
**Files:** create `backend/tests/isolated_env.py`; modify `backend/tests/conftest.py` (activate when `LR_ISOLATED=1`), `backend/tests/support_db.py` (`database=os.environ.get("DATABASE_NAME", "liferecord")`), `backend/tests/support_auth.py` (accept env-provided owner), README "Running tests".
**Produces:** `isolated_env.start() -> IsolatedEnv` with fields `db_name: str`, `base_url: str`, `owner_email: str`, `owner_password: str`, and `stop() -> None`.
- [ ] Step 1 (discovery, no code): run the suite once against an empty schema created by hand and classify each failure: needs foods / needs John's seed / needs shared catalog / other. This decides the fixtures below; record in the PR description.
- [ ] Failing test first: `test_harness_refuses_the_real_schema` (setting `DATABASE_NAME=liferecord` raises) and `test_harness_creates_and_drops_a_scratch_schema` (name matches `^liferecord_test_\d+$`; after `stop()` it is gone).
- [ ] Implement: admin login creates `liferecord_test_<pid>`; starts `uvicorn server:app` on a free `127.0.0.1` port with env `DATABASE_NAME`, admin credentials as `DATABASE_USER/PASSWORD` (disposable schema, avoids touching `provision_db.py`), random `ADMIN_EMAIL/ADMIN_PASSWORD`, `SCHEDULER_ENABLED=false`, **blank AI provider keys and no mail provider**, `STORAGE_DIR` in a temp dir; waits on `/api/health`; exports `REACT_APP_BACKEND_URL`, `TEST_EMAIL`, `TEST_PASSWORD` in the *controller* `pytest_configure` so xdist workers inherit them (A12).
- [ ] Data fixtures chosen by step 1: small `foods` subset loaded by SQL (public-domain USDA rows exported once, ≤ 100 foods) instead of the 8,170-row import; John via `seed_john.py` against the scratch server only if tests need it.
- [ ] Drop: only schemas matching the pattern, admin login, in `pytest_sessionfinish` and `atexit`; stale schemas from crashed runs are removed at next start.
**Acceptance:** with ports 8000/3000 **not** listening and `LR_ISOLATED=1`, `pytest tests` is green; row counts of `users`, `transactions`, `groceries` in schema `liferecord` identical before and after (recorded); no live-model or mail traffic (provider keys blank); README documents both modes. Default (non-isolated) mode behaves exactly as today.
**Commit:** `test: run the backend suite against a throw-away schema (F-03)`

#### T2.2 Retire real-account dependencies — M
- [ ] List tests still reading the owner/John account in isolated mode (T2.1 step 1) and give each its own created user (`TEST_USER_EMAIL` prefixes).
- [ ] Mark `backend/tests/backend_test.py` (legacy) and `test_iteration2.py` for review; delete only with approval.
**Acceptance:** `grep -rn "a39791" backend/tests` returns nothing outside seed helpers; F-03 roadmap row cites the passing isolated run and its duration.

#### T2.3 Alembic ↔ models drift test (A7) — S
**Files:** create `backend/tests/test_schema_drift.py`.
- [ ] Test `test_alembic_head_matches_models`: scratch schema → `alembic upgrade head` → `alembic.autogenerate.compare_metadata(context, Base.metadata)` → `== []`.
- [ ] If it fails, list the diff in the PR; any fix is a new migration → **stop and ask the owner**.
**Acceptance:** empty diff, or an approved migration that makes it empty.

#### T2.4 Count and isolation inventory for S-12 — S
- [ ] Generate (not hand-write) the list of 31 `user_id` tables and the routes that touch each, from `Base.metadata` and `app.openapi()`; commit as the seed of the case table in T2.5.

#### T2.5 S-12 Isolation matrix — L
**Files:** create `backend/tests/test_isolation_matrix.py` (+ helper `isolation_cases.py`).
**Produces:** `ISOLATION_CASES: dict[str, Case]` keyed by table name; `Case` holds `create(session_a) -> id`, `read: (method, path)`, `update: (method, path, body)`, `delete: (method, path)`, optional `exempt_reason` (e.g. child table reached only through its parent).
- [ ] `test_every_user_table_has_an_isolation_case` — set of tables with `user_id` ⊆ cases ∪ documented exemptions (fails when someone adds a table: A11).
- [ ] `test_every_id_route_is_covered_or_exempt` — each OpenAPI path with `{…}` is mapped.
- [ ] Parametrised `test_other_user_cannot_read_change_or_delete[<table>]`: user B gets 404/403 (never 200/204) on read/update/delete of A's row, A's row is unchanged afterwards, and B's list endpoint excludes it. Include assistant tool path for tables reachable by tools (pattern: `test_ai_extra_tools.py`).
- [ ] Fix every failure found (each fix gets its own test line in the same commit).
**Acceptance:** 31/31 tables covered or exempt-with-reason; every failure fixed or recorded; runs in isolated mode in < 3 min.
**Commit:** `test(security): isolation matrix for every user-owned table (S-12)`

### Phase 3 — Frontend: navigation, accessibility, motion, performance, token (roadmap Part 2 + S-03)

#### T3.1 D-02 Reach every page on a phone — S
**Files:** modify `frontend/src/components/AppShell.jsx`; create `frontend/e2e/mobile-nav.spec.js`.
- [ ] Test (390×844): for each of the 10 destinations assert it is reachable in ≤ 2 taps without keyboard, and that the active destination has `aria-current="page"` (React Router sets it on `NavLink`).
- [ ] Implement: keep Home, Money, +, People, Tasks; add a fifth tab **More** opening the existing `components/ui/sheet.jsx` with the other six destinations (derived from `NAV`, not duplicated) and Sign out; More shows the active state when the current route is inside it (`data-testid="mnav-more"`).
**Acceptance:** spec green; no overlap between bottom bar and the AI button (visual check in T3.3).

#### T3.2 D-01 Accessibility audit for every other page — L
**Files:** create `frontend/e2e/support/a11y.js` (extract the viewport × theme loop, `AxeBuilder` tags WCAG 2.0/2.1/2.2 A+AA and the overflow assertion from `nutrition-a11y.spec.js`), `frontend/e2e/a11y-public.spec.js`, `a11y-home-money.spec.js`, `a11y-people.spec.js`, `a11y-groceries.spec.js`, `a11y-fitness-body-tasks.spec.js`, `a11y-calendar-settings.spec.js`, `a11y-assistant-dialogs.spec.js`, `a11y-empty-states.spec.js`; fixes in `index.css`, `common.jsx`, tokens, pages.
- [ ] Specs first; run; record the offender counts per page (first Nutrition run had 1,186). Fix **shared tokens/components first** (`--muted-foreground`, `common.jsx`, `ui/*`), re-run, then page-specific.
- [ ] Each group: 1280/820/390 px × light/dark, 0 violations, `scrollWidth <= clientWidth`.
- [ ] `a11y-empty-states.spec.js` runs Money, Home, Groceries, Nutrition, Tasks on a **fresh account** (Review Focus 4; uses the T1.1 helper).
- [ ] Findings that cannot be fixed are listed in the roadmap row with reason.
**Acceptance:** all groups report 0 violations and no overflow; Nutrition's 12 tests still pass; roadmap rows D-01/D-03 cite the spec names.

#### T3.3 D-03 + D-04 Responsive sweep and visual review — M
**Files:** create `frontend/e2e/screens.spec.js` (tagged `@manual`, excluded from normal runs; writes PNGs to `test-results/screens/`).
- [ ] Capture every page × 3 widths × 2 themes; I review each image and list defects (contrast, hierarchy, spacing) in a table in the roadmap row; fix shared causes once, rerun T3.2 specs.
**Acceptance:** 10 pages × 6 = 60 screenshots reviewed; defect table closed or accepted with reason.

#### T3.4 D-08 Inline form validation — M
**Files:** `components/common.jsx` (new `FieldError`, `role="alert"`, wired with `aria-describedby`), forms in `ExpenseDialog`, `AccountDialog`, `Login`, `Signup`, `ResetPassword`, `Settings` (password), `Tasks`, `People`, `WorkoutDialog`.
- [ ] Audit: list which forms rely on a toast only (record result even if "none").
- [ ] e2e per fixed form: invalid submit → visible inline message, field focused, axe still 0.
**Acceptance:** audit recorded; every listed form shows inline errors; D-01 specs re-run clean.

#### T3.5 D-06 Reduced motion — S
**Files:** `frontend/src/App.js`, `AppShell.jsx` (`Intro`), `frontend/e2e/reduced-motion.spec.js`.
- [ ] Wrap the app in `<MotionConfig reducedMotion={animations ? "user" : "always"}>` inside `SettingsProvider`; the `Intro` splash ends immediately when motion is reduced.
- [ ] Spec with `page.emulateMedia({ reducedMotion: "reduce" })` on login, signup and home: no running transform animations (`document.getAnimations()` filtered to transform) and no 2.1 s intro wait.
**Acceptance:** spec green; the in-app switch in Settings now also stops framer-motion (second assertion with the switch off).

#### T3.6 D-07 Performance budget — M
**Files:** create `frontend/scripts/bundle-report.js` (gzip size per emitted JS/CSS file → `docs/performance/bundle-<date>.json`), `frontend/bundle-budget.json`, `backend/seed_history.py` (two years of transactions/groceries into a **scratch** schema only), `frontend/e2e/perf.spec.js` (`@manual`).
- [ ] Record bundle table (main + lazy chunks, ZXing chunk). Decide if `warmAllRoutes` stays (A9) with data.
- [ ] Time Money and Groceries with 2 years of data (API p95 + time-to-interactive); record in roadmap row.
- [ ] Budget = measured + 10 % (Q13); `node scripts/bundle-report.js --check` exits non-zero when exceeded; wired into T5.1.
**Acceptance:** numbers in the roadmap; the check fails when a budget is artificially lowered (proved once, then restored).

#### T3.7 S-03 Access token out of `localStorage` — M
**Files:** `frontend/src/lib/api.js` (module-level `getAccessToken()/setAccessToken()`; interceptors use it), `context/AuthContext.jsx` (boot: `refreshSession()` then `/auth/me`; drop `lm_refresh_token` legacy path), `lib/aiStream.js`, `e2e/fixtures.js` (log in with `X-Auth-Mode: cookie`, put `lr_refresh` into the browser context with `context.addCookies`, path `/api/auth`), `e2e/session-cookie.spec.js`, new `frontend/e2e/no-token-in-storage.spec.js`, unit test `lib/api.test.js`.
**Produces:** `getAccessToken(): string | null`, `setAccessToken(token: string | null): void` exported from `lib/api.js`.
- [ ] Specs first: after login `Object.keys(localStorage)` and `sessionStorage` contain no key matching `/token/i`; a reload keeps the session; two tabs both work; logout clears; sign-out-everywhere still invalidates the other tab's next call; an expired access token refreshes transparently (Review Focus 3).
- [ ] Implement; run **every** e2e spec (fixtures changed for all).
- [ ] Measure first-paint delay added by the boot refresh (one request) and record; the `Protected` guard already shows a blank shell until `ready`.
**Acceptance:** no token in web storage (asserted); full Playwright run green; `session-cookie.spec.js` updated; README session section updated.

#### T3.8 D-10 Design guidelines rewrite — S
**Files:** `design_guidelines.json`, README link.
- [ ] Regenerate palette/typography from `tailwind.config.js` and `index.css`; multi-user wording; remove "Sá"/"single private user" (lines 2, 5, 6, 76, 159).
**Acceptance:** `grep -n "Sá\|Single Private" design_guidelines.json` empty; every hex in the file exists in the shipped tokens (script check).

### Phase 4 — Backend structure and data safety

#### T4.1 F-02 Split `server.py`, one domain at a time — L (6 sub-steps)
**Files:** new `backend/<domain>_api.py` modules, each with `register(api_router, srv)` exactly like `calendar_api.py`; `server.py` keeps re-exports; create `backend/tests/test_openapi_golden.py` + `golden_openapi_paths.json`.
- [ ] Step 0: generate the golden (sorted `[method, path]` list from `app.openapi()`, 120 routes in `server.py` today + the module routes) and a test that fails on any difference; also `test_names_tests_import_from_server_still_exist` (the exact list the 14 modules import).
- [ ] Moves, each its own commit, in this order: (1) categories + accounts (9 routes) → (2) people + settlements (10) → (3) tasks, weight, photos, workouts (18) → (4) groceries, shopping, products, recipes, storage-locations, appliances, prices (51; recipes are shared with Nutrition — keep helper functions where they are) → (5) transactions, splits, analytics (8) → (6) auth (11; last, keep `get_current_user` importable from the same name).
- [ ] After every move: golden test, full isolated suite, `graphify update .`, "Import Cycles: None".
**Acceptance (each move):** golden unchanged; suite green; `server.py` line count recorded; no test edited except import paths. Done = Q6 scope complete.

#### T4.2 S-13 Failure sweep — M
**Files:** `docs/testing/failure-sweep.md` (checklist + results), tests where automation is cheap.
- [ ] Table of seven scenarios (backend down, database down, model quota exhausted, SMTP failure, expired session, 409 stale edit, upload too large) → each either a test (provider stub raising → readable 503; bad `DATABASE_PORT` on the scratch server → JSON error without traceback; route abort in Playwright → offline banner; existing 413/409 tests referenced) or a recorded manual result.
- [ ] Fix any response that shows a stack trace or raw exception text.
**Acceptance:** 7/7 rows have evidence; log of the scratch server has no unhandled traceback for the handled cases.

#### T4.3 S-14 Data hygiene — S (approval-gated)
- [ ] `python backend/cleanup_account.py testuser1@example.com` (dry run prints counts) → show owner → run with the confirm flag only after approval.
- [ ] Move `backend_*.log`, `backend-run.log` under `logs/` with size rotation in `start-all.ps1`; delete the 2026-10-23 logs only after approval.
**Acceptance:** account gone (row counts before/after recorded) or kept by the owner's decision; logs rotate (test: create a 6 MB file, run the rotation, size drops).

#### T4.4 S-07 Backups and restore rehearsal — M
**Files:** create `tools/backup.py`, `tools/restore_check.py`, optional `tools/install_backup_task.ps1`; README "Backups".
- [ ] `backup.py`: `mysqldump` (path from start-all.ps1: MySQL 8.4 `bin`) with the password passed via `MYSQL_PWD` in the child environment only (never on the command line), plus a zip of `backend/storage/`; output folder and retention from Q9; optional encryption.
- [ ] `restore_check.py`: restore into scratch schema `liferecord_restore_check` (same name-pattern guard as T2.1) and compare per-table row counts + file count; prints a table.
- [ ] Rehearse once on real data **read-only** (dump only); paste the comparison into the roadmap row.
**Acceptance:** backup produced; restore into scratch schema matches counts for 35/35 tables; retention proven by creating dummy older files; schedule installed (if approved).

#### T4.5 S-11 Export and delete own account — L (after Q7)
**Files:** create `backend/account_data.py` (shared by endpoints and `cleanup_account.py`), modify `cleanup_account.py` to import its table list; routes in a new `account_api.py`; `frontend/src/pages/Settings.jsx` ("Your data" card); `backend/tests/test_account_export_delete.py`; `frontend/e2e/account-data.spec.js`.
**Produces:** `USER_TABLES: list[str]` derived from `Base.metadata` (tables with `user_id`); `async def export_user(db, user_id) -> dict`; `async def delete_user(db, user_id) -> dict[str, int]` (rows removed per table; also removes the user's folder under `STORAGE_DIR`).
- [ ] Tests: `test_user_tables_match_the_models` (A10b); `test_export_contains_every_user_table_and_no_secrets` (no password hash, tokens, verification codes); `test_delete_leaves_zero_rows_in_all_31_tables_and_no_files`; `test_other_users_data_untouched`; `test_wrong_password_refuses`; `test_owner_role_is_refused_with_a_reason` (A10c); `test_delete_while_a_scheduled_task_exists`; both endpoints use the S-04 limiter.
- [ ] Implement `DELETE /account` (re-enter password + typed phrase; bumps `token_version`; sends a security notice using the existing pattern in `email_service.py`) and `GET /account/export`.
**Acceptance:** all tests pass in isolated mode; export of John's seed contains rows for each populated table; Review Focus 5 covered.

### Phase 5 — Deployment readiness

#### T5.1 S-10 Continuous integration — M (needs T2.1, T3.2, T3.6)
**Files:** `.github/workflows/ci.yml`, `tools/ci_local.ps1`.
- [ ] Jobs: backend (MySQL 8.4 service, `LR_ISOLATED=1 pytest`), frontend (`yarn install --frozen-lockfile`, unit tests, `CI=true yarn build` with warnings as errors, bundle budget), e2e-a11y (scratch backend + built frontend served + Playwright axe specs + mobile-nav + reduced-motion).
- [ ] Prove the pipeline can fail: one deliberate red commit on a throw-away branch, then green.
**Acceptance:** green run link recorded; a deliberate failure turns it red; the local script runs the same commands.

#### T5.2 S-15 Node `fs.F_OK` notice — S
- [ ] Document as harmless in README (CRA 5 is end-of-life; migrating the toolchain is out of scope and would rewrite the build); record the exact notice text and Node version.

#### T5.3 S-09 Production deployment — conditional on Q10
- [ ] If "local only": add a README "Not deployed" section and mark S-09 declared non-goal by the owner.
- [ ] If a target is chosen: `.env.production.example`; secrets via environment (DPAPI is Windows-only; confirm `local_secrets.load_into_environ` lets environment variables win); reverse proxy applying the CSP header file from `frontend/scripts/csp.js`; HTTPS; `ALLOWED_HOSTS`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE`; DB TLS; rehearsal with `curl -I` header capture, login + refresh cookie + upload over HTTPS.

### Phase 6 — Owner-gated and manual (start now, in parallel)

| Task | Item | Action | Evidence to record |
|---|---|---|---|
| T6.1 | S-01 | Owner changes the password in Settings → Password | Date only |
| T6.2 | S-02 | New Gemini/OpenCode/SendGrid keys → `local_secrets.py set NAME`; old keys revoked; assistant, voice, receipt, test mail still work | Date, checklist ticks |
| T6.3 | S-08 | Owner stores `UPLOAD_ENCRYPTION_KEY` in a password manager | Date only |
| T6.4 | S-06 | Domain + DNS + SendGrid authentication; Email Activity check; then webhook (`P2-1`), global hourly cap, code hashing (`P3-3`, with the test change from A13) | Dashboard check date; tests |
| T6.5 | F-05 | One bounded live-assistant run (prompt list + quota cap agreed first) or written acceptance of the risk | Run log or note |
| T6.6 | F-06 | INSA written permission → importer modelled on `import_usda.py` | Letter/email reference |
| T6.7 | F-07 | Owner picks which reference gaps to schedule; every value checked cell-by-cell as in `test_nutrition_reference_efsa.py` | Per-value table |
| T6.8 | F-09/F-10/F-11 | Record decisions (Q11): README note for EUR; offline non-goal; no recurring | Roadmap rows |
| T6.9 | D-05 | NVDA pass on five flows + keyboard-only run | Checklist in `docs/testing/` |
| T6.10 | D-09 | Safari, Firefox, one phone, camera scan, print preview | Pass/fail matrix |

### Phase 7 — Release gate

#### T7.1 S-16 Regression gate — M (last)
- [ ] On the final commit, as the standard test account and without live-model specs: backend suite (isolated and, once, against the normal stack), frontend unit tests, `CI=true` production build, bundle check, full Playwright, backend log with no 500/traceback.
- [ ] Replace the §0.3 figures in the roadmap with these measured numbers, dated.
**Acceptance:** all green or each failure explained; roadmap §0.3 updated; `IMPLEMENTATION_PLAN.md` marked complete.

---

## 7. Dependencies and execution order

```
Track O (owner, any time):  T6.1  T6.2  T6.3  T6.4(first steps)  → unblocks S-06 code later
Track C (code):
 T0.1 ─ T0.2 ─┬─ T1.1 (F-01) ─┐
              ├─ T1.2 (S-04) ─┤
              ├─ T1.3 (S-05)  │
              └─ T1.4         ├─► T2.1 ─► T2.2 ─► T2.3 ─► T2.4 ─► T2.5 (S-12)
                              │      │
                              │      ├─► T3.1 ─► T3.2 ─► T3.3 ─► T3.4 ─► T3.5 ─► T3.6 ─► T3.7 (S-03) ─► T3.8
                              │      │       (T3.2 needs T1.1 for the empty-state pass; T3.6 needs T2.1 for scratch data)
                              │      ├─► T4.1 (F-02)   needs T1.2 + T2.1 + T2.5
                              │      ├─► T4.2, T4.3, T4.4 (needs T2.1 for the scratch restore), T4.5 (needs T1.2, T2.5, T4.1 auth move done or not started)
                              └──────┴─► T5.1 (needs T2.1, T3.2, T3.6) ─► T5.2 ─► T5.3 (conditional)
 all of the above ─► T7.1
```

Rules: finish and commit a task before the next; Phase 3 and Phase 4 may interleave (they touch different trees) but T3.7 and T4.1's auth move must not overlap. Roadmap batch mapping: 1A→T1.1, 1B→T2.x+T4.1, 1C→T1.4, 1D→T6.5-6.8, 2A→T3.1-3.3, 2B→T3.3-3.5, 2C→T3.6, 2D→T6.9-6.10, 2E→T3.8, 3A→T6.1-6.4, 3B→T1.2/T1.3/T2.5, 3C→T3.7/T4.2/T4.3, 3D→T4.4/T4.5, 3E→T5.x, 3F→T7.1.

## 8. Testing strategy and acceptance gates

| Layer | Tool | Runs against | Gate |
|---|---|---|---|
| Backend unit/in-process | pytest (`-n 2 --dist loadscope`, unchanged) | scratch schema (`LR_ISOLATED=1`) | green on every commit |
| Backend API | pytest + `requests` | scratch server on a free port | green; no live-model call, no mail |
| Isolation | `test_isolation_matrix.py` | scratch schema | 31/31 tables; new table without case fails |
| Contract | `test_openapi_golden.py` | in-process | identical during F-02 |
| Schema | `test_schema_drift.py` | scratch schema | empty diff |
| Frontend unit | `craco test` | — | green, `CI=true` |
| Build | `CI=true yarn build` + `bundle-report --check` | — | no warnings; within budget |
| E2E | Playwright (John seed or scratch stack) | local stack | green except explicitly excluded live-model specs |
| Accessibility | axe-core WCAG 2.0/2.1/2.2 A+AA, 1280/820/390, light/dark, + overflow assertion | local stack | 0 violations (incl. empty-state pass) |
| Manual | NVDA, browsers, device, print | owner's devices | recorded matrix (T6.9/T6.10) |

Per-task protocol: (1) failing test, (2) see it fail, (3) minimal implementation, (4) see it pass, (5) run the neighbouring suites, (6) write evidence into the roadmap row, (7) commit. Before claiming a phase done, run `superpowers:verification-before-completion` (command output, not recollection). After Phase 2, 3 and 4: `graphify update .` and compare god nodes/cycles.

## 9. Risks and blockers

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Baseline (T0.2) is red or the stack is unavailable | Medium / blocks all | Fix or quarantine first; record in Appendix D |
| Harness points at the real schema | Low / very high | Name-pattern guard + test, admin login used only for create/drop of `liferecord_test_*`, row-count check before/after |
| S-04 daily caps silently erased by cleanup (A2) | High if naive / High | Scoped retention + dedicated test |
| F-02 breaks a `from server import …` name or an OpenAPI path | Medium / High | Golden test, re-exports, one domain per commit, auth last |
| a11y findings explode (Nutrition: 1,186 elements first run) | High / Medium (schedule) | Shared-token fixes first, time-box per page group, record accepted exceptions |
| S-03 changes every e2e fixture at once | Medium / Medium | Do after a11y specs are green; run all specs; cookie fixture tested first on `session-cookie.spec.js` |
| Boot refresh adds first-paint latency | Medium / Low | Measure (T3.7); keep `Protected` blank shell |
| `create_all` vs Alembic drift found (T2.3) | Medium / Medium | Needs a migration → owner approval before applying |
| Test data assumptions (John's seed, USDA foods) hidden in tests | High / Medium | Discovery step in T2.1; small foods fixture |
| Deleting the owner via S-11 | Low / High | Role check + test |
| Password/keys exposure while running suites | Low / High | Per-command env only; blank provider keys in test processes |
| Owner-gated items stall (S-06, S-09, F-06) | High / Medium | Separate track; release gate (T7.1) lists them as accepted open items rather than blocking code phases |
| CRA 5 end-of-life makes S-05/S-15 noise permanent | Certain / Low | Document; toolchain migration explicitly out of scope |

**Blockers (cannot proceed without you):** Q1 (login name) for T0.1; `TEST_PASSWORD` + running stack for T0.2; Q5 for T2.1; Q3 numbers for T1.2 defaults; Q7/Q9/Q10 for T4.5/T4.4/T5.3; items in Phase 6 need your hands or a third party.

## 10. Coverage check (self-review)

Every roadmap ID maps to a task: F-01 T1.1 · F-02 T4.1 · F-03 T2.1-2.2 · F-04 T1.4 · F-05 T6.5 · F-06 T6.6 · F-07 T6.7 · F-08 T1.4 · F-09/10/11 T6.8 · D-01 T3.2 · D-02 T3.1 · D-03 T3.3 · D-04 T3.3 · D-05 T6.9 · D-06 T3.5 · D-07 T3.6 · D-08 T3.4 · D-09 T6.10 · D-10 T3.8 · S-01 T6.1 · S-02 T6.2 · S-03 T3.7 · S-04 T1.2 · S-05 T1.3 · S-06 T6.4 · S-07 T4.4 · S-08 T6.3 · S-09 T5.3 · S-10 T5.1 · S-11 T4.5 · S-12 T2.5 · S-13 T4.2 · S-14 T4.3 · S-15 T5.2 · S-16 T7.1. New tasks not in the roadmap: T0.1, T0.2, T2.3, T2.4 (supporting evidence for A1, baseline, A7, A11).

Known gaps in this plan: test data dependencies are unknown until T2.1 step 1; D-01 effort cannot be estimated until the first audit run; step-level detail for Phase 5-6 is deliberately lighter because those tasks depend on your decisions (Q8-Q10).
