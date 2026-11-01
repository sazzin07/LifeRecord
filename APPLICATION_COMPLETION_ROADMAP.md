# LifeRecord — Application Completion Roadmap

**Final revision: 2026-10-30** · Branch `feature/roadmap-completion` · code baseline commit `ca27e44`
**This is the authoritative plan.** The full previous roadmap (audit, work logs, Nutrition deliveries 1–3, per-delivery test evidence) is kept unchanged in [`docs/history/ROADMAP_ARCHIVE_2026-10-19_to_30.md`](docs/history/ROADMAP_ARCHIVE_2026-10-19_to_30.md). Cite it for history; do not edit it.

| Companion document | Use it for |
|---|---|
| [README.md](README.md) | How to run, configure, test and use the app (features in user terms) |
| [SENDGRID_EMAIL_AUDIT.md](SENDGRID_EMAIL_AUDIT.md) | Email findings, fixes and what is still open (items `P0-1`…`P3-4`) |
| [docs/history/](docs/history/) | Archived roadmap and the three 2026-10 reports (migration, multi-user, security audit) |
| `graphify-out/GRAPH_REPORT.md`, Obsidian vault `LifeRecord/` | Code knowledge graph and project notes (both git-ignored, regenerated; see §0.4) |

---

## 0. How to read and maintain this document

### 0.1 Status vocabulary
| Status | Meaning |
|---|---|
| **Completed** | Implemented **and verified**; the row names the evidence (file, test or measured run). |
| **In Progress** | Part of it is done; the remainder is written out in the row. |
| **Blocked** | Waiting for something only the owner or a third party can supply (a credential, a decision, a licence, a device). The unblock step is named. A decision that needs the owner is written "Blocked (owner decision)". |
| **Not Started** | Not begun. Where the work is only to *prove* that something believed to work really does, the row says "unverified"; it is never counted as completed. |

(Until 2026-11-01 the file used Done / In progress / Open / Blocked / Unverified / Decision. Mapping: Done → Completed, Open → Not Started, Unverified → Not Started, Decision → Blocked (owner decision).)

### 0.2 Rules
- A task moves to **Completed** only with evidence in its row. "Last recorded" figures come from a run on the stated date; they were **not re-run** when this document was reorganised (a documentation-only change; the test suites need the owner's `TEST_PASSWORD` and a running backend).
- Task IDs: `F-nn` (Part 1), `D-nn` (Part 2), `S-nn` (Part 3). Old IDs (`GROC-…`, `SEC-…`, `NUTR-NEW-…`, `D3-…`) are mapped in [Appendix A](#appendix-a--old-id-map-completed-work).
- Add history to the archive or a dated line in [Appendix D](#appendix-d--revision-log), not to the active tables.
- The owner's standing rules apply: no live-AI-model calls in tests, secrets stay outside the project (DPAPI store), and nothing is sent to real recipients without approval.

### 0.3 State at a glance (verified against the code on 2026-10-30)

| | Done / Unverified / Blocked / Open (incl. In progress, Decision) |
|---|---|
| Part 1 — Implementation & Features | 12 module groups **Completed** (§1.2); open items F-01…F-11 |
| Part 2 — Design & User Experience | Nutrition audited; everything else open: D-01…D-10 |
| Part 3 — Security & Finalization | Core controls **Completed**; S-01…S-16 open (4 blocked on the owner: S-01, S-02, S-06, S-08) |

Facts measured from the repository (not copied from older text):

| Fact | Value | How checked |
|---|---|---|
| Backend entry file `backend/server.py` | 5,399 lines (the old roadmap said ~2,900) | `wc -l` |
| Backend modules besides `server.py` | 30 (`nutrition_*`, `ai_*`, `scheduling*`, `calendar_api`, `conversations_api`, `email_service`, `local_secrets`, …) | `ls backend` |
| Database tables | 35 models; every table has `user_id` except `users`, `splits` (child of a transaction), `rate_limit_events` and `email_events` (hashed keys, by design) | parsed `backend/models.py` |
| Alembic | 22 revisions, single head `b5d7f9a1c3e4` | parsed `backend/alembic/versions` |
| Assistant tools | **101** (`server.AI_TOOLS` after `ai_tools_extra` 17 and `ai_tools_nutrition` 34 are appended); the README said "about 70" and the old roadmap 97 | imported `server` |
| Frontend pages | Home, Money, People, PersonDetail, Groceries, Nutrition, Fitness, Body, Tasks, Calendar, Settings + Login, Signup, ForgotPassword, ResetPassword | `frontend/src/pages` |
| Test files | 44 backend test modules, 23 Playwright specs, 3 frontend unit-test files (`aiFormat`, `csp`, `format`) | `ls` |
| Last recorded results (2026-10-30, as the standard test account, no live-AI calls) | backend **570 passed**; frontend unit **20 passed**; production build **compiled** with `CI=true`; Playwright (all but live-model specs) **114 passed, 0 failed** | archive §17b |

### 0.4 Graphify and Obsidian
- **Graphify:** `graphify-out/` (git-ignored) is rebuilt with `graphify update .` (no LLM cost). The graph in place before this revision was built from commit `05ab594f`, two commits behind `ca27e44`; it was refreshed as part of this revision (the result is in the final report, not here, because it changes with every rebuild).
- **Obsidian vault:** `C:\Projects\LifeRecord\LifeRecord\` (git-ignored). `LifeRecord/graphify/` holds ~3,900 auto-generated one-heading notes that came from the old documents and test logs; they are navigation noise, not documentation. Curated notes live at the vault root (`Project Hub`, `Roadmap Status`, `Architecture Map`, `Open Work and Owner Actions`, `Nutrition-module`). They point back to this file; they do not copy it.

---

# PART 1 — Implementation & Features

## 1.1 Platform and architecture

| Layer | Implementation | Status |
|---|---|---|
| Backend | FastAPI (async) + SQLAlchemy 2 async + aiomysql; entry `backend/server.py`; domain modules registered as routers (`nutrition_api`, `nutrition_plan_api`, `nutrition_plan_gen_api`, `nutrition_suggest_api`, `nutrition_insights_api`, `calendar_api`, `scheduling_api`, `conversations_api`) | **Completed** (but see F-02: most older routes still live in `server.py`) |
| Frontend | React 19, Create React App 5 + Craco, react-router 7, Tailwind + shadcn/Radix, recharts, framer-motion, custom `useFetch` cache (`lib/useFetch.js`, `lib/swrCache.js`); React Query/SWR/next-themes removed | **Completed** |
| Database | MariaDB/MySQL 8.4, Alembic migrations (head `b5d7f9a1c3e4`), least-privilege app user `liferecord` | **Completed** |
| Shared data | Built-in product catalog (552 items) and USDA foods (8,170) are ownerless shared rows; user additions are private | **Completed** (`test_shared_catalog.py`, `import_usda.py`) |
| Runtime | `start-all.ps1` / `stop-all.ps1`, local only | **Completed** (no deployment exists, see S-09) |

## 1.2 Modules (all **Completed** unless noted; evidence is the named tests and files)

| Module | What exists | Evidence |
|---|---|---|
| Auth and accounts | Signup with 6-digit email code, login, refresh, forgot/reset password, change password, sign out everywhere | `test_auth_multiuser.py`, `test_session_security.py`, `test_change_password.py`, `test_email_flows.py`, `e2e/reset-link.spec.js` |
| Home | Summary, nutrition rings that read the same day/targets as Nutrition, people balances, grocery widgets, tasks, quick actions | `pages/Home.jsx`, `e2e/smoke.spec.js` |
| Money | Dynamic account hierarchy, transactions with splits/itemised/exact, refunds, transfers, budgets, charts, CSV, account management in Settings | `test_account_balances.py`, `test_iteration2.py`, `e2e/edit-flows.spec.js`, `e2e/settings.spec.js` |
| People | Ledger, settlements, archive, delete (income already received stays, by decision), detail route edit/delete | `e2e/people.spec.js`, `test_people_delete_keeps_payments.py` |
| Groceries and Kitchen | Overview/Storage/Shopping/Catalog/Kitchen tabs, multiple lists with budgets, recurring lists, suggestions, price history, expiry, move/consume/discard | `test_product_catalog_api.py`, `test_kitchen_logic.py`, `test_shopping_item_delete.py`, `e2e/groceries.spec.js` (13) |
| Nutrition | Diary, 8,170 foods, barcode (typed or ZXing camera), recipes calculated from foods, plan, week generator, suggestions, insights, EFSA references ages 1–17 and adults, upper levels, in-app reminders, printable summary | 12 nutrition test modules incl. `test_nutrition_reference_efsa.py`; 9 nutrition Playwright specs incl. axe (`nutrition-a11y.spec.js`). Detail: archive §17, §17b |
| Fitness / Body | Workout and weight/photo logging with edit/delete; photos encrypted and served only with the auth header | `test_body_fitness_edit.py`, `e2e/edit-flows.spec.js` |
| Tasks / Calendar | Task edit/priority/due/repeat; month and week grid with tasks, expiry and meal events | `test_tasks_edit.py`, `test_calendar.py`, `e2e/calendar.spec.js` |
| Settings | Accounts CRUD, password, sign out everywhere, theme | `e2e/settings.spec.js` |
| Assistant | Streaming chat, 101 tools, saved chats (search, archive, rename, delete), chat images, voice transcription, receipt scan, undo, two-step confirmation for destructive/profile changes | `test_ai_*` (6 modules), `test_conversations.py`, `test_chat_images.py`, `e2e/ai-assistant.spec.js`, `e2e/ai-attach.spec.js` |
| Scheduled reports | Database-backed scheduler, read-only tool subset, email to confirmed recipients, retry | `test_scheduling_*` (3 modules), `e2e/scheduled-tasks.spec.js` (10) |
| Email | SendGrid via SMTP relay, background send with retries, `email_events` log, security notices | `test_email_smtp.py`, `test_email_flows.py`. **Delivery to inboxes is not confirmed beyond one owner-confirmed test mail, see S-06** |

## 1.3 Integrations

| Integration | State |
|---|---|
| Chat model | OpenCode Go `gpt-6-luna` (default, `AI_PROVIDER=opencode`) or Gemini (`AI_PROVIDER=gemini`); no automatic switching. **Completed**, never exercised by automated tests by the owner's rule (see F-05) |
| Voice and receipt scan | Gemini (`/ai/transcribe`, `/ai/receipt`); Gemini model fallbacks on quota errors |
| Food data | USDA Foundation Foods (2025-12-18) + SR Legacy (April 2018) imported; Open Food Facts for barcodes (values marked estimated). OFF mapping unit-tested, **live call never run in automated tests** (F-08) |
| Email | SendGrid SMTP relay, sender `tiagosa743@gmail.com` (cannot be domain-authenticated, S-06) |
| phpMyAdmin | Bundled, login required, local only |
| Portuguese INSA/PortFIR food table | **Not imported** (licence); F-06 |

## 1.4 Cross-module synchronisation (what is actually wired)
- Every mutation triggers a refresh event; Nutrition uses a scoped refresh (`refreshAll(["/nutrition", …])`, measured 9 relevant requests instead of ~32) while other pages keep the global refresh. **Completed**, `lib/refreshScope.js` + unit tests.
- Cooking a recipe writes the diary through the same service as manual logging and updates kitchen stock. A meal plan becomes a shopping list (minus stock, nothing marked bought). The calendar shows task due dates, expiry dates and meals. Home reads Nutrition's day, targets and time zone. **Completed** (nutrition plan/API tests, `e2e/nutrition-plan.spec.js`, `e2e/calendar.spec.js`).
- Assistant tools call the same service functions as the REST routes, so validation, ownership and balance logic are shared; every change is recorded for undo. **Completed** (`test_ai_undo.py`, `test_ai_confirmations.py`).
- **Gap:** a brand-new account has no categories or accounts (found while seeding John; nothing in the code creates them) → F-01.

## 1.5 Open implementation work

| ID | Task | Status | Description | Done when |
|---|---|---|---|---|
| F-01 | New-account onboarding | **Completed** (Medium) | A freshly verified account sees empty Money (no categories, no accounts), so the first expense cannot be entered. No onboarding code exists (searched `backend` and `frontend/src`). | A new account gets starter categories and is guided to create its first account (or gets defaults); backend test for a new user; Playwright test from signup to first expense; existing accounts untouched.<br>**Evidence (2026-11-01):** new accounts get the 12 starter categories at first verification (`backend/starter_data.py`, called from `verify_code`) and Money shows a guided "Set up your money" card (`components/FirstAccounts.jsx`; the UI could not create a top-level account at all before). The expense dialog says so when there is no account. Found and fixed on the way: the API booked expenses, income and transfers to accounts that do not exist (`require_account_id`), so a new user's first expense was silently lost. Tests: `test_onboarding.py` (10, including the assistant tools), `e2e/onboarding.spec.js` (2: signup to first expense, form validation), unit tests 22, `CI=true yarn build` clean; screenshots at 1280 and 390 px in both themes reviewed. Existing accounts are untouched (John's seed now reuses same-named starter categories). |
| F-02 | Split `server.py` | **Blocked** (Medium; owner decision) | 5,399 lines; domain routers exist only for newer code. A bulk move was deliberately not done (regression risk without behaviour change). | One domain moved at a time (auth, money, people, groceries, assistant); after each move the `/openapi.json` path list is identical and the full suite is green.<br>**Evidence (2026-11-01):** analysis done, nothing moved on purpose. Safety nets now exist (`test_server_surface.py`: snapshot of all 199 routes, every name tests import from `server`, route-shadowing check with a negative control). Finding: of 118 route functions in the planned domains only 51 are not also called by other code, and no domain is wholly movable: the assistant's tools and `dispatch_tool` call the same route functions (`ai_tools_extra.py` calls `srv.get_categories(...)` and so on, by design: one set of rules for REST and assistant). Moving only the 51 would leave every domain split across two files, which is worse than today. The real fix is to extract a shared core first (database session, authentication, `to_dict`, id and time helpers, the request models) so the shared functions can move with their routes. That is a multi-day change touching every module. Options for the owner: (1) do that extraction, (2) leave `server.py` as it is and accept it, (3) move the 51 free routes anyway. Recommendation: (2) now, (1) when the next large feature needs it. |
| F-03 | Tests independent of the live backend and of real accounts | **Completed** (Medium) | Most backend tests call a running backend as a real account and clean up after themselves; some run in-process against the same MySQL database. There is no test database. | `pytest tests` passes with no running server against a throw-away schema; no test touches John's or the owner's data; documented in README. Prerequisite of S-10.<br>**Evidence (2026-11-01):** `LR_ISOLATED=1 pytest tests` builds a throw-away schema and server (`backend/tests/isolated_env.py`): 651 passed, 2 skipped in about 100 s with no running backend, no real account and no secret. Row counts of all 36 real tables were identical before and after the runs. AI provider and mail are dead ends, so nothing can call a model or send mail (`test_isolated_env.py`, 5). Also: `python tests/isolated_env.py serve` and `run -- CMD` give browser specs the same isolated stack (107 non-live Playwright tests: 106 passed first time, the one timing race was fixed). Documented in README (Backend tests). Found on the way: `seed_john.py` and `cleanup_account.py` hard-coded the real schema (fixed, with a guard test). |
| F-04 | Meal-plan/diary data for John's seed gaps | **Completed** (Low) | John's seed has no photos, no AI action history, no recurring transactions (the app has none). | Seed covers photos and action history, or the gaps are written into README as known.<br>**Evidence (2026-11-01):** `seed_john.py` now adds 3 progress photos (through the real upload route) and 3 assistant action rows (history only, never undoable); no meals are logged for today so each day starts empty (the suggestion specs depend on it). "No recurring transactions" is written into README (F-11). `test_seed_data.py` (3). |
| F-05 | Live-assistant behaviour with 101 tools | **Blocked** (owner decision; also unverified) | Tool schemas are accepted and every tool is tested in-process with scripted turns; how well the live model chooses among ~100 tools (about 51 KB of schema per request) was never measured. The owner forbids live-model tests. | Owner approves one bounded run (listed prompts, quota cap) and the result is recorded here; or the owner accepts the risk in writing here. |
| F-06 | Portuguese INSA/PortFIR food table | **Blocked** | The download is a click-through under copyright terms; no licence for embedding in this app's database was found. | INSA (Departamento de Alimentação e Nutrição) or the owner confirms in writing that embedding with credit is allowed; then an importer following `import_usda.py` (new `source`, `data_version`). |
| F-07 | Nutrition reference gaps | **Blocked** (owner decision) (deferred by the owner's rule: only verified published tables) | No reference values for babies under 1, pregnant or breastfeeding under 18, medical conditions; supplements are not logged, so upper levels compare only where EFSA covers total intake; age comes from birth year only; EFSA 2017 sodium/potassium used although EFSA revised them in 2019 (WHO limit shown for sodium). | Owner decides which, if any, to schedule; any value added is checked cell by cell against a published table, as `test_nutrition_reference_efsa.py` does. |
| F-08 | Open Food Facts live check | **Not Started** (Low; unverified) | Lookup mapping is unit-tested; no run against the live service. | One manual lookup of a known EAN recorded here (no automated live test). |
| F-09 | Currency and locale | **Blocked** (owner decision; Low) | `eur()` formats with `en-IE`/EUR everywhere (`frontend/src/lib/api.js:93`). | Owner confirms single-currency EUR (then document it) or a currency/locale setting is added with tests. Recommendation: document. |
| F-10 | Offline behaviour | **Blocked** (owner decision; Low) | An offline banner exists; mutations are not queued. | Owner decides. Recommendation: declare a non-goal. If wanted: queue with replay and conflict rules, tested offline. |
| F-11 | Recurring transactions | **Blocked** (owner decision; Low) | The app has none (rent, subscriptions). Not requested so far. | Owner decides; if wanted, scope as a new design (reuse the recurring-list scheduler). |

### Part 1 batches
| Batch | Items | Why this order |
|---|---|---|
| 1A | F-01 | Visible product gap, small, independent |
| 1B | F-03 → F-02 | Tests first make the refactor safe |
| 1C | F-04, F-08 | Cheap verification and seed coverage |
| 1D (owner-gated) | F-05, F-06, F-07, F-09, F-10, F-11 | Each needs an owner answer or permission first |

---

# PART 2 — Design & User Experience

## 2.1 What is known
- **Visual identity:** light and dark themes, Tailwind tokens, emerald/slate palette, mono face for amounts. The Nutrition and Groceries pages were redesigned deliberately; other pages follow the shared shell. The 2026-10-30 contrast fixes changed shared pieces (app shell header and mobile nav, `common.jsx`, `index.css`, `--muted-foreground`), so every page changed slightly; only Nutrition was re-audited afterwards.
- **Accessibility audit that exists:** axe-core (WCAG 2.0/2.1/2.2 A and AA) on every Nutrition tab and four dialogs at 1280/820/390 px in both themes: **12 tests, 0 violations**, plus a sideways-overflow assertion; first run had 1,186 offending elements, all fixed. Nothing equivalent exists for other pages.
- **Responsive verification that exists:** Nutrition at three widths; `pages-smooth.spec.js` and Groceries specs for rendering behaviour. No overflow assertion elsewhere.
- **Navigation:** `AppShell.jsx` defines 10 destinations. The phone bottom bar holds **Home, Money, +, People, Tasks** only; Groceries, Nutrition, Fitness, Body, Calendar and Settings are reached through the search/command bar (`⌘K`).
- **Motion:** reduced-motion is honoured in page transitions (`index.css`), the kitchen zoom and the assistant panel; other framer-motion uses were not checked.
- **Performance measured:** Nutrition trends over 366 days 300 ms / 95 KB; other nutrition endpoints under 130 ms on 2 years / 3,650 entries; logging a drink refreshes 9 requests. Main bundle size, and large histories in Money/Groceries, were never measured.

## 2.2 Open design work

| ID | Task | Status | Description | Done when |
|---|---|---|---|---|
| D-01 | Accessibility audit for every other page | **Not Started** (High) | Extend the axe spec pattern to Home, Money, People and PersonDetail, Groceries (5 tabs), Fitness, Body, Tasks, Calendar, Settings, Login/Signup/Forgot/Reset, the assistant panel and each page's main dialogs. | One spec per page group at 1280/820/390 px, light and dark, **0 violations** and the overflow assertion passing; findings fixed or recorded with reason. |
| D-02 | Mobile reachability of all pages | **Completed** (High) | Six of ten destinations are not in the phone bottom bar. | At 390 px every page is reachable in two taps without the keyboard (for example a "More" sheet); Playwright test visits each; current-page state is announced.<br>**Evidence (2026-11-01):** `e2e/mobile-nav.spec.js` (12 tests at 390 px): Home, Money, People and Tasks are one tap; Groceries, Nutrition, Fitness, Body, Calendar and Settings are two (a new "More" tab opens a sheet, built from the same `NAV` list so a page added later cannot be unreachable); the current page is announced with `aria-current` (the More tab carries it when the page is inside the sheet); the sheet opens and closes from the keyboard and returns focus to its tab; Sign out lives in it; the assistant button sits above the bar. |
| D-03 | Responsive sweep (desktop, tablet, phone) | **Not Started** (Medium) | Only Nutrition has measured layouts. | Screenshots of every page at 1280/820/390 reviewed in both themes; no horizontal overflow (asserted in D-01's specs); fixes listed. |
| D-04 | Visual regression review after the shared contrast changes | **Not Started** (Medium; unverified) | The palette shift touched shared components, never reviewed outside Nutrition. | Reviewed screenshots (D-03) show consistent colours/hierarchy; any contrast failure found in D-01 fixed once in the shared token. |
| D-05 | Screen reader and keyboard-only pass | **Not Started** (Medium; unverified) | Only an automated "every control has a name" check exists. | Written checklist run with NVDA for five core flows (sign in, add expense, log food, add shopping item, ask the assistant) plus a keyboard-only run; defects fixed or logged. |
| D-06 | Reduced-motion coverage | **Not Started** (Low; unverified) | Handled in three places; other framer-motion uses unchecked. | Every animated component respects `prefers-reduced-motion` (a global `MotionConfig reducedMotion="user"` or per-component), asserted by one e2e with the media query on. |
| D-07 | Performance budget | **In Progress** (Medium; final bundle numbers and the budget are set at the end of the frontend work) | No recorded bundle sizes or large-history timings outside Nutrition. | Build chunk sizes recorded here (main bundle, lazy chunks incl. the 436 KB ZXing chunk); Money and Groceries timed with 2 years of seeded data; budget set, regressions fail review.<br>**Evidence (2026-11-01):** API timings with two years of history (3,650 expenses, `tests/perf_probe.py`, `test_money_performance.py`, 5 tests): the Money summary took 1,229 ms for one month and 2,449 ms for all time on John's nine accounts, because every account balance loaded every transaction as an object, three times, in Python loops. Balances are now SQL sums (`compute_account_balance`): `/accounts` 336 to 27 ms, month summary 399 to 85 ms in the same conditions, all existing balance tests green, and the test now fails if it returns. Found, not changed: "All time" on Money returns every transaction in one 8.6 MB response (2.6 s); the default period (a week) is fast. `frontend/scripts/bundle-report.js` records gzip sizes per file (main bundle 312 kB gzip, the barcode-scanner chunk about 113 kB gzip) and `--check` fails when a budget is exceeded (proved by lowering one). |
| D-08 | Form validation feedback | **Not Started** (Low; unverified) | The original audit found most forms rely on server toasts rather than inline messages; not re-checked. | Audit result recorded; forms that only toast get inline messages with accessible error text (axe in D-01 covers the markup). |
| D-09 | Browser and device matrix | **Not Started** (Medium; unverified) | Only Chromium (desktop, emulated phone widths, fake camera). Safari, Firefox, a real phone camera and the printed summary on paper were never tried. | A short matrix (Safari, Firefox, one phone, camera barcode scan, print preview) run and recorded here with pass/fail. |
| D-10 | Design guidelines document | **Completed** (Low) | `design_guidelines.json` still describes "Life Record for Sá — single private user" and lists a palette that no longer matches the shipped tokens. | File rewritten from the real tokens (`tailwind.config.js`, `index.css`), multi-user wording, and referenced from README.<br>**Evidence (2026-11-01):** `design_guidelines.json` rewritten from the real tokens (`index.css`, `tailwind.config.js`, `AppShell.jsx`): many people instead of one, the contrast floor, the navigation, the accessibility rules the audits enforce, motion and feedback rules. `frontend/src/lib/designGuidelines.test.js` (4 tests) fails if it mentions "Single Private User" or a name, names a colour that is not in the code, drifts from the CSS tokens, or lists different pages than the shell. Linked from README. |

### Part 2 batches
| Batch | Items | Notes |
|---|---|---|
| 2A | D-02, D-01, D-03 | Navigation first (largest usability gap), then audits and the sweep share one set of specs |
| 2B | D-04, D-08, D-06 | Fixes found by 2A, plus validation and motion |
| 2C | D-07 | Measure, then budget |
| 2D (manual, owner's devices) | D-05, D-09 | Needs a screen reader and real devices |
| 2E | D-10 | After the tokens settle |

---

# PART 3 — Security & Finalization

## 3.1 Controls in place (all **Completed**, with evidence)

| Area | Control | Evidence |
|---|---|---|
| Authentication | bcrypt; access token 30 min and refresh token with per-user `token_version` (password change / sign out everywhere revokes all); refresh token only in an HttpOnly, SameSite cookie with a CSRF header check; hashed reset tokens, single use; equal timing for unknown emails; unverified accounts limited to verify/resend | `test_session_security.py`, `test_refresh_cookie.py`, `test_auth_multiuser.py`, `e2e/session-cookie.spec.js` |
| Authorization and isolation | Every user-owned query filters by the token's user; 31 of 35 tables carry `user_id` (the other four are justified in §0.3); isolation tests for auth, assistant tools, conversations, nutrition, plan, scheduling | `test_auth_multiuser.py`, `test_ai_*`, `test_conversations.py`, `test_nutrition_api.py`, `test_nutrition_plan_api.py`, `test_scheduling_api.py` |
| Data protection | Uploads (photos, chat images) encrypted at rest (Fernet) and served only to the owner with the auth header; secrets in a DPAPI store outside the project; app DB user cannot DROP or read `mysql.user`; MySQL on 127.0.0.1 with the X protocol off; `.env`, logs, `LifeRecord/`, `graphify-out/` and `backend/storage/` git-ignored | `test_file_crypto.py`, `test_local_secrets.py`, archive Batches 6a–6c |
| API and transport | CORS limited to `CORS_ORIGINS`; `TrustedHostMiddleware` when `ALLOWED_HOSTS` set; security headers; CSP injected into the production build and emitted as a header file | `frontend/scripts/csp.js`, `src/lib/csp.test.js`, archive Batch 6c (0 violations in a browser) |
| Abuse prevention | Auth endpoints rate-limited per IP+identifier, stored in `rate_limit_events` (survives restarts, shared by processes); scheduled tasks capped (20 per user, 10 manual runs/hour, 30 scheduled runs/day) | `test_session_security.py`, `test_scheduling_api.py` |
| Input validation | Pydantic limits on request bodies; calendar-valid dates in every nutrition model; image content sniffing; diary `client_ref` and `if_updated_at` for retries and stale edits | `test_nutrition_api.py`, `test_chat_images.py` |
| Privacy by design | Health data has no share links; email log stores a hash and the domain only; bodies not logged; assistant treats tool text as data | `email_service.py`, archive §17 |
| Test-account safety | Tests refuse a non-local backend; reserved email domains are never mailed; no password default in code | `tests/support_auth.py`, `test_email_reserved_domains.py` |

## 3.2 Open security and finalization work

| ID | Task | Status | Description | Done when |
|---|---|---|---|---|
| S-01 | Owner password | **Blocked** (owner action) | As last recorded the owner account still has the weak development password (SEC-002). Not re-checked in this revision (checking would mean attempting a login with it). | Owner changes it in Settings → Password; a note here records the date (never the value). |
| S-02 | Rotate pasted keys | **Blocked** (owner action) | The Gemini, OpenCode and SendGrid keys were pasted into chats earlier (SEC-003). | New keys created in each dashboard and stored with `local_secrets.py set NAME`; old keys revoked; assistant, voice, receipt scan and a test email still work. |
| S-03 | Access token out of `localStorage` | **In Progress** (Medium) | The refresh token is already an HttpOnly cookie; the 30-minute access token is still kept under `lm_token` in `localStorage` (`AuthContext.jsx`). | Access token held in memory with a refresh at boot; no token key in `localStorage` (asserted by an e2e test); e2e fixtures seed sessions with the cookie. |
| S-04 | Per-user limits on cost-bearing endpoints | **Completed** (High) | `check_rate_limit` is called only on auth endpoints (`server.py` lines ~1243–1449). Chat, streaming chat, transcription, receipt scan, photo and chat-image uploads have no per-user rate or daily cap, so a script or a bug can burn model quota or fill storage. | Limits (per minute and per day) on `/ai/chat`, `/ai/chat/stream`, `/ai/transcribe`, `/ai/receipt` and uploads, returning 429 with a clear message; tests for each; limits documented in README.<br>**Evidence (2026-11-01):** `backend/usage_limits.py`: per-user limits per minute and per day on `/ai/chat`, `/ai/chat/stream`, `/ai/transcribe`, `/ai/receipt` and `POST /photos`, answered with a plain-language 429 and `Retry-After`; defaults accepted by the owner, changeable by environment, listed in README. Found and fixed: the sign-in limiter's cleanup deleted every event older than two minutes, which would have erased day counts. `test_usage_limits.py` (11, including that cleanup case) and `frontend/src/lib/aiStream.test.js` (2). |
| S-05 | Dependency audit refresh | **Completed** (High) | Last audits: 2026-10-13 backend `pip-audit` clean; frontend `yarn audit` 0 critical / 46 high / 28 moderate, all build tooling. Packages added since (ZXing, axe-core, aiosmtplib, cryptography) were not audited. | Fresh dated results for both, each high triaged (upgrade, accept with reason, or dev-only); recorded here.<br>**Evidence (2026-11-01):** dated results and triage in `docs/security/dependency-audit-2026-11-01.md`. Backend: installed environment 42 advisories before, none after (5 unused leftover packages removed, 5 upgraded). Frontend: everything that ships to the browser is fixed (`axios` 1.21.0, `react-router-dom` 7.18.5, `follow-redirects` 1.16.2, unused `zod` and `@hookform/resolvers` removed); the remaining 71 advisories (28 high) are all inside the CRA build toolchain and are accepted with reasons. |
| S-06 | Email deliverability | **Blocked** (owner action) | Sender is `@gmail.com` (cannot be domain-authenticated, DMARC `p=none`); SendGrid account state unreadable with the least-privilege key. Open audit items: `P0-1` domain, `P0-2` dashboard check, `P2-1` bounce/suppression webhook (needs a public HTTPS URL), global hourly cap on recipient mails, `P3-3` hash verification codes. | Owner supplies a domain and DNS records; domain authenticated; Email Activity checked; then the webhook, the cap and code hashing implemented with tests (see the audit's §10–14). |
| S-07 | Backups and restore | **In Progress** (High; owner chooses folder, schedule and encryption) | One manual dump (2026-10-29, outside the project) exists. No schedule, no restore ever tested, uploads and the upload key are not part of any routine. | Scripted backup of the database and `backend/storage/`; restore rehearsed into a scratch database with a recorded row-count comparison; retention stated.<br>**Evidence (2026-11-01):** `tools/backup.py` (consistent dump, encrypted uploads as stored, manifest of row counts, retention 14 daily + 8 weekly) and `tools/restore_check.py` (restores into a scratch schema, compares every table) are written and tested (`test_backup_restore.py`, 5, including a damaged-backup case). A rehearsal on the real database restored 36 tables and 9,624 rows with no mismatch (temporary copy deleted afterwards). Left: the owner picks the backup folder, a schedule and whether to encrypt (Q9); no backup is scheduled yet. README (Backups). |
| S-08 | Back up `UPLOAD_ENCRYPTION_KEY` | **Blocked** (owner action) | Without the key encrypted photos and chat images cannot be read; README says to store it in a password manager. | Owner confirms it is stored (`local_secrets.py reveal …`); recorded here without the value. |
| S-09 | Production deployment | **Not Started** (High) | No deployment, Docker or hosting plan exists. The CSP header file must be applied by the server in front of `build/`; the DPAPI store is Windows-only (Linux needs environment variables or a secret manager); HTTPS, `ALLOWED_HOSTS`, `COOKIE_SECURE` and TLS to the database are untested. | Target chosen by the owner; deployment rehearsed; `curl -I` shows the headers; login, refresh cookie and uploads work over HTTPS; `.env.production.example` and README checklist match what was done. |
| S-10 | Continuous integration | **In Progress** (Medium; written and checked locally; not yet run on GitHub) | No CI. | A pipeline runs backend tests (needs F-03), unit tests, production build with warnings as errors and the a11y specs on every push.<br>**Evidence (2026-11-01):** `.github/workflows/ci.yml` (three jobs: backend suite on a MySQL 8.4 service container with a scratch schema, frontend unit tests plus the strict build, and the browser specs including the accessibility audits on a throw-away stack; YAML validated) and `tools/ci_local.ps1` (the same steps on this machine; parses). Every command in them was run here with the results recorded in this file. Left: pushing the branch so the workflow runs once on GitHub (an outward step I did not take) and a deliberate red commit to show it can fail. |
| S-11 | User data export and account deletion | **Completed** | Settings can delete a *money account* but not the user's own LifeRecord account or data; there is no export. Health data is stored (birth year, sex, pregnancy, weight). | Owner decides what is required; at minimum a documented procedure (`cleanup_account.py` removes one account's data, dry run by default); preferably an in-app export and delete with confirmation, tested for completeness against all 31 user tables.<br>**Evidence (2026-11-01):** backend done: `GET /account/export` (zip with `data.json` and the original pictures, no secrets) and `DELETE /account` (password plus exact phrase, owner role refused, removes rows and files, security notice by email); table list derived from the models (`backend/account_data.py`). `test_account_export_delete.py` (9): export holds all 32 tables for an account that used everything; deletion leaves 0 rows in all 32 tables and no files, other users untouched. Found and fixed: `cleanup_account.py` missed the five nutrition tables. Left: the "Your data" card in Settings.<br>**Evidence (2026-11-01):** Settings now has a "Your data" card (`components/YourData.jsx`): Download my data, and Delete my account behind the password and the exact words, errors shown inline. Browser checks `e2e/account-data.spec.js` (3: zip download, wrong password then success then the login no longer works, cancel changes nothing) on top of the backend evidence above (`test_account_export_delete.py`, 9). |
| S-12 | Isolation coverage for newer tables | **Completed** (Medium) | Isolation tests exist for the modules listed in §3.1, but no check proves every user-owned table (e.g. `meal_plan_entries`, `food_favorites`, `nutrition_profiles`, `hydration_entries`, `scheduled_*`) is covered. | A test enumerates the models with `user_id` and, per table, proves a second account cannot read, change or delete a row through any route; failures fixed.<br>**Evidence (2026-11-01):** `test_isolation_matrix.py` (32): for each of the 31 user tables and all 87 routes that take an id, user B is refused (403 or 404) on A's objects, A's data is unchanged and B's lists never show it; two completeness tests fail when a table or an id-route has no case or written reason; a negative control proves the matrix can fail. No isolation gap was found; two routes answer 400 or 200 as harmless no-ops and are documented in the test. |
| S-13 | Error-handling and failure sweep | **Completed** (Medium) | The 2026-10-29 verification lists "error-handling sweep by hand" as not done. | Checklist run: backend down, database down, model quota exhausted, SMTP failure, expired session, 409 stale edit, upload too large; each shows a human message and no stack trace; results recorded.<br>**Evidence (2026-11-01):** sweep table with evidence in `docs/testing/failure-sweep.md`. Fixed: unexpected errors were `500 text/plain`; now a plain JSON sentence (503 when the database is unreachable) that still carries CORS headers, with the detail only in the log (`test_failure_handling.py`, 5). Left: a Playwright check that a stopped backend shows the offline banner.<br>**Evidence (2026-11-01):** `e2e/failure-sweep.spec.js` (2): a stopped backend shows the offline banner and recovers on reload; a `500` with its CORS headers is shown in words and is not mistaken for being offline. With `test_failure_handling.py` (5) and the table in `docs/testing/failure-sweep.md` all nine failure kinds have evidence. |
| S-14 | Data hygiene | **In Progress** (Low; waiting for the owner's yes to two deletions) | An account `testuser1@example.com` of unknown origin is in the database; stale logs (`backend_8001_*.log` from 2026-10-23, `backend-run.log` 761 KB) accumulate in the project root without rotation (git-ignored by `*.log`). | Owner approves removal of the account (through `cleanup_account.py`, dry run first); logs moved under one folder with rotation.<br>**Evidence (2026-11-01):** done: `tools/rotate_logs.py` (4 tests) and `start-all.ps1` now write the backend and frontend logs into `logs/` (git-ignored) and rotate them above 5 MB; the five stray logs in the project folder were moved into `logs/` as `old-*` (nothing deleted). Dry run for `testuser1@example.com`: the account has **0 rows of data**, only its login row. Left, needs the owner: (1) delete that empty login, (2) delete the moved `old-*` logs (about 1.1 MB). |
| S-15 | Node 24 `fs.F_OK` deprecation notice | **Completed** (Low) | Printed by the CRA toolchain on every build. | Toolchain updated or the notice documented as harmless in README.<br>**Evidence (2026-11-01):** documented as harmless in README (Frontend build): Node 24.21 prints `[DEP0176] fs.F_OK is deprecated` from a package inside Create React App 5's own toolchain; the build still succeeds and the code is not involved. The cure is leaving Create React App, which is out of scope here. |
| S-16 | Release regression gate | **Not Started** (High, last step) | The 2026-10-30 results are from before this documentation change and from a machine state that no longer exists. | On the final commit, as the standard test account and without live-model specs: backend suite in parallel, frontend unit tests, `CI=true` production build, full Playwright run, backend log with no 500 or traceback; the figures replace §0.3. |

### Part 3 batches
| Batch | Items | Notes |
|---|---|---|
| 3A (owner actions, in parallel) | S-01, S-02, S-08, S-06 first steps | No code; unblocks everything else in Part 3 |
| 3B | S-04, S-05, S-12 | Highest-risk code and evidence gaps |
| 3C | S-03, S-13, S-14 | Hardening and hygiene |
| 3D | S-07, S-11 | Data safety; S-11 needs a decision |
| 3E | S-09, S-10, S-15 | Deployment readiness after F-03 |
| 3F (last) | S-16 | Final regression gate and replacement of §0.3 figures |

## 3.3 Risk register (what can go wrong if the above is left open)

| Risk | Likelihood | Impact | Covered by |
|---|---|---|---|
| Weak owner password and leaked chat-pasted keys | Medium | High | S-01, S-02 |
| Unbounded model/upload use (cost, storage) | Medium | High | S-04 |
| Account mail lands in spam; users cannot verify | High (gmail sender) | High | S-06 |
| Data loss with no tested restore; lost upload key | Low | Very high | S-07, S-08 |
| Unreviewed pages fail accessibility or break on phones | High | Medium | D-01–D-03 |
| Refactor of `server.py` breaks behaviour | Medium | High | F-03 before F-02 |
| Live assistant mis-selects among ~100 tools | Unknown | Medium | F-05 |
| Legal/privacy expectations for health data (export, erase) | Medium | Medium | S-11 |

---

## Appendix A — Old ID map (completed work)

Everything below was **Completed** with the evidence given in the archive section shown. IDs are kept so older notes remain traceable.

| Old IDs | Now | Archive section |
|---|---|---|
| P1-001…P1-004, BUG-001…BUG-011, DEBT-002, DEBT-003, DEBT-004, DEBT-006 | Done | §12, §15 Batches 1–4 |
| GROC-001…GROC-018, GROC-BE-001…006, GROC-UI-001 | Done (Groceries, §1.2) | §12, §14 updates |
| AI-001…AI-007 | Done (Assistant, §1.2) | §12, §15 Batch 4 |
| DASH-001…003, CAL-001/002, NUTR-001…004, TASK-001, FIT-001/002, BODY-001/002, QUICK-001, ACCT-001/002, MONEY-001, AUTH-001 | Done | §12, §15 Batches 1–3 |
| TEST-001…TEST-005, DOC-001/002 | Done. **TEST-005** was listed both "Completed" and "In Progress" in the old file; it is Done: the owner login comes from one module, the password only from the environment or the encrypted store, no default in code (`tests/support_auth.py`) | §12, §16 |
| SEC-001, SEC-004, SEC-005, SEC-007 | Done (§3.1) | §15 Batches 6a–6c |
| SEC-002 → **S-01**, SEC-003 → **S-02**, SEC-006 → **S-03** | Open as above | §15, §16 |
| DEBT-001 → **F-02**, DEBT-005 → **F-03** | Open as above | §12, §16 |
| NUTR-NEW-01…13, D3-1…D3-7 | Done, with the limits stated in §1.2/F-07 | §17, §17b |
| D3-6c (INSA) → **F-06** | Blocked | §17b |
| Email audit `P0-1`…`P3-4` | Fixed items in the audit §14; open ones → **S-06** | `SENDGRID_EMAIL_AUDIT.md` |

## Appendix B — Owner decisions that bind the work
- Secrets live in the DPAPI store outside the project; keys that were pasted in chats must be rotated (S-02).
- No live-AI-model calls in automated tests; no real email to real recipients without approval.
- Food data: USDA public domain + Open Food Facts; standard EFSA 2017 with WHO limits; INSA only with clean licence.
- Reminders are in-app only; assistant changes to the profile or a daily target are previewed and need an identical later confirmation; the meal plan has its own table; no public share links for health data; nothing is guessed for children — unverifiable values stay unsupported.
- Deleting a person keeps money already received (income stays).
- Test account is John (`a39791@aesancho.pt`), password supplied per command, never stored.

## Appendix C — Known limitations (accepted, not defects)
Food data is US-centred; search ranks by name length and source, not popularity; allergy/diet flags use food names and categories only; one-tap logging repeats the last amount; plain foods on a shopping list are by weight as eaten; each assistant request carries ~51 KB of tool schema; Open Food Facts values are estimates; the printed summary was verified with emulated print media only.

## Appendix D — Revision log
| Date | Change |
|---|---|
| 2026-10-30 | Final restructuring into three parts. Previous roadmap archived unchanged (with a pointer banner) to `docs/history/`; three old 2026-10 reports moved beside it. Facts re-measured from code (server size, tool count 101, 35 tables, migration head). Contradictions fixed: TEST-005 status, assistant tool counts (70/97 → 101), `server.py` size (2,900 → 5,399), README stack and seed instructions. New items found while inspecting: S-04 (no per-user limits on cost-bearing endpoints), S-11 (no export/delete of own account), D-02 (six pages missing from the phone bottom bar), S-12 (isolation coverage unproven for newer tables). |
