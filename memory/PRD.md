# Life Manager — PRD

## Original problem statement
Private, single-user personal life "operating system" for its owner (Sá) unifying: personal finance & shared-expense/reimbursement tracking (Cash + Revolut), groceries/inventory, nutrition, calisthenics fitness, body/weight, tasks, calendar, and a global AI assistant that turns natural language / voice / receipt photos into structured, connected data. Premium, calm, minimalist design with selective Liquid Glass; emerald accent.

## Stack & architecture
- Backend: FastAPI + MongoDB (motor). JWT email+password auth (Bearer token in localStorage). All routes under `/api`.
- Frontend: React 19 + Tailwind + shadcn/ui + framer-motion + recharts + lucide-react. Alias `@` = src.
- AI: Gemini 3 Flash via `emergentintegrations` tool-calling; OpenAI Whisper for voice; EMERGENT_LLM_KEY. Server-side only.
- Finance engine: gross/personal/reimbursable per transaction; account balances derived from activity; person balances via splits − settlements (no double counting).

## User persona
Sá — single owner. Wants an easy but complete day-to-day tool: log spending (incl. shared/item-level splits), see who owes what, track weight, tasks, meals, groceries, mostly via the AI.

## Core requirements (static)
Money (accounts, expenses, splits, reimbursements, settlements, analytics), People/balances, AI assistant (text+voice+image, tools, action log), Home command center, Groceries, Nutrition, Fitness, Body, Tasks, Calendar, Settings.

## Implemented (2026-06)
- Auth: seeded owner (sa@lifemanager.app), login, protected shell.
- Finance: accounts Cash+Revolut w/ live balances, expense CRUD, equal + item-level splitting, reimbursements, settlements, month analytics, charts. Verified via 23/23 backend tests + finance math checks.
- People: list w/ net balances, detail w/ transactions + payments, record payment.
- AI assistant: floating glass panel, text/mic(Whisper)/receipt-image, Gemini tool-calling (create_expense, record_payment, log_meal, add_grocery, record_weight, create_task, summaries), action logging + undo, session history. Verified live (parsed a shared split correctly).
- Home dashboard: hero snapshot, data-driven insights, nutrition rings, people, groceries, tasks.
- Tasks (CRUD+toggle), Body/weight (CRUD+trend), Groceries (inventory+price/confidence badges+low stock), Nutrition (meals+macro totals), Fitness (Push/Pull/Legs templates), Calendar (due tasks + weekly check-in), Settings (theme, animations, categories, accounts).
- Quick Add menu, Command bar (Cmd/Ctrl+K), light/dark themes, entry animation, skeleton loaders, confidence badges, sample data.

## Backlog / remaining
- P1: Deeper grocery price-history & shopping-list optimization; recipes; inventory auto-decrement on meals.
- P1: Full workout logging + history/PRs; progress photos (object storage).
- P2: Dashboard widget reorder/hide; receipt verification screen; AI undo surfaced in UI; per-transaction reimbursed allocation.
- P2: Travel module (future).

## Next tasks
Recipes + inventory consumption; workout logging with history; progress photos via object storage.

## Iteration 2 (2026-09) — Expense/Refund + Grocery + AI deep control
- Expense management fully dynamic: per-expense total, personal cost, to-be-refunded, already-refunded (linked settlements), remaining, responsible people, payment method (Cash/Card=Revolut), refund status. Full CRUD incl. EDIT (PUT /api/transactions/{id}, proportional split-scaling) and delete (removes linked refunds).
- Money page: period filters Day / Week / All Time + September/October/November 2026, future months auto-disabled from real current date (2026-09-28 → Oct/Nov disabled). Payment-method filter All/Card/Cash. Card-vs-cash spending, pending-vs-refunded totals.
- Refund engine: settlements can link to a specific expense (transaction_id) → per-expense remaining + person balances stay consistent (single source of truth, no double counting).
- Groceries: full CRUD, stock +/- steppers, price shown or "Unknown", notes/expiration, low/out-of-stock intelligence, per-store price history.
- Smart shopping list + price intelligence: generate from low stock + usual buys; per-item cheapest store; single vs split store basket comparison + recommendation.
- Recipes: create + Cook (subtracts ingredients from inventory, logs a meal).
- AI tools: update_expense, delete_expense (confirms first), mark_refunded, update_grocery, generate_shopping_list, create_recipe, cook_recipe — all real DB ops, verified live.
- Dashboard insights from real summary; offline/fallback banner; no fabricated financial data.
- Tests: backend 23/23 + 10/10 new pass; frontend verified end-to-end.

## Iteration 3 (2026-09) — Workouts, AI Activity Feed, Receipt Scan, Progress Photos
- Workout logging: Push/Pull/Legs templates → logged sessions (sets/reps/weight, isometric durations), session history, and personal-best records (/api/workouts, /workouts/prs). AI tool log_workout.
- AI Activity Feed: every AI tool run is logged (/api/ai/actions) with an undoable flag; in-panel Activity tab lists changes with one-tap Undo (/api/ai/actions/{id}/undo).
- Receipt Scan Review: /api/ai/receipt extracts merchant/date/items/prices from a photo WITHOUT saving; a review dialog lets the user edit and confirm before the expense is created; parser instructed to never invent data and returns empty when no receipt detected.
- Progress Photos: Body tab, stored in Emergent object storage (/api/photos, served via /api/photos/file/{path}?auth=token), gallery by date + tap-two side-by-side comparison, soft-delete.
- Verified: frontend all 4 flows pass; backend spot-checked via curl (workouts/PRs, photo upload+serve auth 200/no-auth 401, AI log_workout, receipt parse).


