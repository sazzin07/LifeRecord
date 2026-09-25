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
