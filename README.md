# Life Record

A private, multi-user personal life-management application. It unifies personal/shared finance, groceries, nutrition, fitness, body/weight tracking, tasks, calendar, and an AI assistant that turns natural language, voice, or receipt photos into structured, connected data.

## Stack

- **Backend:** FastAPI + async SQLAlchemy + aiomysql + MariaDB/MySQL
- **Frontend:** React 19 + Tailwind CSS + shadcn/ui + framer-motion + recharts
- **AI:** Google Gemini (`google-genai` SDK), server-side only
- **Auth:** JWT (HS256, access tokens), bcrypt password hashes
- **Storage:** Local filesystem for progress photos
- **Email:** Async SMTP via `aiosmtplib` with a console fallback for development

## Multi-user architecture

Life Record now supports multiple independent accounts. Each user owns their data exclusively:

- Every data table (`accounts`, `categories`, `people`, `transactions`, `tasks`, `weight_entries`, `workouts`, `photos`, `groceries`, `price_records`, `shopping_items`, `meals`, `recipes`, `ai_actions`, `ai_messages`) has a `user_id` foreign key.
- Every protected API endpoint filters queries by the authenticated user's ID.
- Updates and deletes verify ownership by requiring `(id == ..., user_id == ...)`.
- The JWT `sub` claim is the single source of identity; the backend never trusts a client-supplied user ID.
- AI tool calls run under the real user's context, so the assistant cannot touch another user's data.

## Prerequisites

- Python 3.11+
- Node.js 18+ and Yarn
- MariaDB or MySQL 8.0+ running on `localhost:3306`
- (Optional) PHP 8+ if you want to run the bundled phpMyAdmin
- A Google Gemini API key for AI features
- SMTP credentials for email verification and password-reset emails (optional in dev; see Email configuration)

## Run the app

### One-liner

From the project root:

```powershell
.\start-all.ps1
```

This initializes/starts MySQL in `tools/mysql-data`, creates the `liferecord` database, starts the backend (port 8000), frontend dev server (port 3000), and phpMyAdmin (port 8080).

### Manual start

Run each command in its own terminal:

```powershell
# 1. MySQL
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --defaults-file=C:\Projects\LifeRecord\tools\mysql-data\my.cnf --console

# 2. Backend
cd C:\Projects\LifeRecord\backend
.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8000

# 3. Frontend
cd C:\Projects\LifeRecord\frontend
yarn start

# 4. phpMyAdmin
cd C:\Projects\LifeRecord\tools\phpmyadmin
php -S localhost:8080
```

### Stop everything

```powershell
.\stop-all.ps1
```

### URLs

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| phpMyAdmin | http://localhost:8080 |

### Login

Sign in with the owner email (`ADMIN_EMAIL` in `backend/.env`) and your password. The owner account is created once, on the first startup with an empty database, from `ADMIN_EMAIL` / `ADMIN_PASSWORD`; after that the password is whatever you chose (change it in **Settings → Password**). It is stored as a salted bcrypt hash only. If you lose it: `cd backend; .venv\Scripts\python.exe owner_admin.py reset-password`.

### Where the secrets live

On Windows the secrets (JWT secret, database passwords, SendGrid/Gemini/OpenCode keys, the owner's seed and test password) are **not** in `backend/.env`. They are in `%LOCALAPPDATA%\LifeRecord\secrets.dpapi`, encrypted with Windows DPAPI for your Windows user, outside the project folder. The backend, Alembic, `ensure_db.py` and the tests read them automatically. Order of precedence: real environment variable, then the store, then `backend/.env`.

```powershell
cd backend
.venv\Scripts\python.exe local_secrets.py names                 # which names are stored (never the values)
.venv\Scripts\python.exe local_secrets.py set SENDGRID_API_KEY  # store or replace a value (prompted, hidden)
.venv\Scripts\python.exe local_secrets.py rotate-jwt            # new JWT secret; signs everyone out
.venv\Scripts\python.exe local_secrets.py migrate               # move secrets still in .env into the store
.venv\Scripts\python.exe local_secrets.py run -- npx playwright test   # run a command with the secrets as env vars
```

If you change the owner password, also run `local_secrets.py set TEST_PASSWORD` so the tests can log in. On Linux/production there is no store: provide the same names as environment variables or from your secret manager.

The app connects to MySQL as `liferecord_app`, which can read and write the `liferecord` database only (no DROP/ALTER, no other databases, no account management). `root` has a password and is used only for migrations, setup and test cleanup. `tools/provision_db.py` sets this up (safe to re-run). MySQL listens on `127.0.0.1` only (`tools/mysql-data/my.cnf` contains `bind-address=127.0.0.1` and `mysqlx=OFF`; that file is git-ignored, so repeat those two lines on a new machine). Use `DATABASE_HOST=127.0.0.1`, not `localhost`: on Windows `localhost` tries IPv6 first and every connection waits for a timeout.

## Quick start

### 1. Database

MySQL 8.4 data is kept in `tools/mysql-data`. If it does not exist, initialize it once:

```powershell
New-Item -ItemType Directory -Force -Path tools\mysql-data
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --initialize-insecure --datadir=C:\Projects\LifeRecord\tools\mysql-data
```

Then start MySQL:

```powershell
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --defaults-file=C:\Projects\LifeRecord\tools\mysql-data\my.cnf --console
```

The included `tools/mysql-data/my.cnf` points to that data directory and runs on port 3306.

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\python.exe -m pip install -r requirements.txt
# Copy and edit environment variables:
cp .env.example .env
# Start the server:
.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8000
```

Required backend environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_HOST` | MariaDB host (default `localhost`) |
| `DATABASE_PORT` | MariaDB port (default `3306`) |
| `DATABASE_NAME` | Database name (default `liferecord`) |
| `DATABASE_USER` | Database user |
| `DATABASE_PASSWORD` | Database password |
| `JWT_SECRET` | Secret for signing JWTs |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | Access-token lifetime (default `30`) |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | Refresh-token lifetime (default `7`) |
| `AI_PROVIDER` | Chat provider: `opencode` (default) or `gemini` |
| `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` / `SENDGRID_EU` | Email for scheduled reports and recipient codes (sender must be verified in SendGrid; `SENDGRID_EU=true` for EU residency) |
| `SCHEDULER_ENABLED` / `SCHEDULER_TICK_SECONDS` / `SCHEDULED_RUN_TIMEOUT_SECONDS` | Scheduler on/off (default on), poll interval (30) and per-run timeout (120) |
| `OPENCODE_API_KEY` | OpenCode API key for chat (server-side only) |
| `OPENCODE_MODEL` | Chat model (default `gpt-6-luna`); `OPENCODE_BASE_URL` defaults to the Go endpoint, `OPENCODE_TIMEOUT_SECONDS` to 60 |
| `GEMINI_MODEL` | Primary Gemini model (default `gemini-3.5-flash-lite`) |
| `GEMINI_MODEL_FALLBACKS` | Comma-separated fallback models on quota errors |
| `GEMINI_FALLBACK_DELAY_SECONDS` | Delay between fallback attempts (default `0.5`) |
| `ADMIN_EMAIL` | Seed owner account email |
| `ADMIN_PASSWORD` | Seed owner account password |
| `SMTP_HOST` | SMTP server host |
| `SMTP_PORT` | SMTP server port (default `587`) |
| `SMTP_USERNAME` | SMTP username |
| `SMTP_PASSWORD` | SMTP password |
| `SMTP_USE_TLS` | Use STARTTLS (`true`/`false`, default `true`) |
| `SMTP_FROM_NAME` | Display name for outgoing emails |
| `SMTP_FROM_EMAIL` | From address for outgoing emails |
| `FRONTEND_URL` | Frontend URL used in password-reset links |
| `RATE_LIMIT_AUTH_WINDOW_SECONDS` | Auth rate-limit window (default `60`) |
| `RATE_LIMIT_AUTH_MAX_ATTEMPTS` | Auth rate-limit max attempts per window (default `10`) |
| `GEMINI_API_KEY` | Google Gemini API key (voice transcription and receipt scanning; chat only if `AI_PROVIDER=gemini`) |
| `GEMINI_TIMEOUT_SECONDS` | AI request timeout (default `25`) |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins (default `http://localhost:3000`) |
| `ALLOWED_HOSTS` | Comma-separated allowed `Host` headers (optional; set in production) |
| `STORAGE_DIR` | Local directory for progress photos |
| `MAX_UPLOAD_SIZE_MB` | Maximum upload size for photos/audio (default `10`) |
| `ALLOWED_PHOTO_EXTENSIONS` | Comma-separated photo extensions (default `jpg,jpeg,png,webp`) |

### 3. phpMyAdmin (optional)

A local phpMyAdmin 5.2.3 is bundled in `tools/phpmyadmin` and configured for `127.0.0.1:3306` and asks for a login (use `root` or `liferecord_app` with the password from the secrets store: `python -c "import local_secrets as l; print(l.read_store()['ADMIN_DATABASE_PASSWORD'])"` from `backend/`; nothing is saved in the config). Start it with PHP's built-in server:

```bash
cd tools/phpmyadmin
php -S localhost:8080
```

Then open http://localhost:8080.

### 4. Frontend

```bash
cd frontend
yarn install
# Copy and edit environment variables:
cp .env.example .env
# Development:
yarn start
# Production build:
yarn build
```

Required frontend environment variable:

| Variable | Purpose |
|---|---|
| `REACT_APP_BACKEND_URL` | Backend base URL, e.g. `http://localhost:8000` |

The production build is placed in `frontend/build`.

## Authentication flows

### Sign up and email verification

1. Go to **Sign up**, enter name, email and password.
2. The backend sends a 6-digit verification code to the email address.
3. Enter the code in the modal. Codes expire after 15 minutes.
4. After verification you are signed in automatically.

Security details:
- Passwords must be at least 8 characters and contain a letter and a number.
- The registration endpoint never reveals whether an email is already registered.
- Resending a code is blocked for 90 seconds and is also rate-limited.
- Verification codes can be attempted up to 5 times before a new code is required.
- Unverified accounts receive a limited token that only works for `/auth/resend-verification` and `/auth/verify`; all other endpoints return 403.

### Password reset

1. From the login screen choose **Forgot password?**.
2. Enter your email. The backend always returns the same message, never confirming whether the address exists.
3. If the address is registered, a single-use reset link is emailed. It expires in 30 minutes.
4. Open the link in the same browser (or any Life Record tab) to show the reset modal, then set a new password.
5. Used or expired tokens are rejected.

### Email configuration

Account emails (verification code, password reset, "password changed" notices) and scheduled reports are sent through **SendGrid's SMTP relay**:

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USERNAME=apikey                 # literally the word apikey
SMTP_FROM_NAME=Life Record
SMTP_FROM_EMAIL=you@yourdomain.com   # must be verified in SendGrid (Settings > Sender Authentication)
# SMTP_PASSWORD = a SendGrid API key with Mail Send permission, kept in the encrypted store:
#   python local_secrets.py set SMTP_PASSWORD
```

Emails are sent after the HTTP response, with up to 3 tries when the failure looks temporary. Each outcome (sent / failed / skipped / not configured, attempts, a safe reason) is recorded in the `email_events` table with a hash and the domain of the recipient, never the address. Click and open tracking are switched off for these messages. Without a provider nothing is sent and the message is **not** logged (set `EMAIL_LOG_BODIES=true` in development to see codes in the log). `EMAIL_PROVIDER=sendgrid` selects the HTTP API instead (`SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`). A `@gmail.com` sender is accepted by SendGrid but cannot be domain-authenticated, so mail may land in spam; use your own domain for real use (see `SENDGRID_EMAIL_AUDIT.md`). Generic SMTP example (Gmail):

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=you@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_USE_TLS=true
SMTP_FROM_NAME=Life Record
SMTP_FROM_EMAIL=you@gmail.com
FRONTEND_URL=https://liferecord.example.com
```

### Session and transport security

- Access tokens expire after `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`.
- Refresh tokens expire after `JWT_REFRESH_TOKEN_EXPIRE_DAYS`.
- Tokens are signed with `JWT_SECRET` using HS256 and carry the user's `token_version`. Changing or resetting the password, or **Settings → Sign out on all devices** (`POST /api/auth/logout-all`), raises that version, so every earlier access and refresh token stops working at once; the device that changed the password receives fresh tokens and stays signed in.
- Refresh refuses unverified accounts. Password-reset tokens are stored only as a SHA-256 hash and are single use.
- Login takes the same time for unknown emails as for wrong passwords (no account enumeration by timing).
- The browser app asks for **cookie mode** (`X-Auth-Mode: cookie`): the refresh token travels only in the `lr_refresh` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` automatically when `FRONTEND_URL` is https; override with `COOKIE_SECURE` / `COOKIE_SAMESITE`), so page scripts cannot read it. A cookie refresh also needs that header, which a cross-site form post cannot send (CSRF protection). `POST /api/auth/logout` clears the cookie. API clients that do not send the header still get `refresh_token` in the JSON.
- The short-lived (30 min) access token is still kept in `localStorage` and sent as `Authorization: Bearer <token>`; moving it into memory is tracked as the remainder of SEC-006.
- On 401, the frontend automatically calls `/api/auth/refresh` to obtain a new access token and retries the original request.
- CORS is restricted to `CORS_ORIGINS`; credentials are never sent to `*`.
- `TrustedHostMiddleware` validates the `Host` header when `ALLOWED_HOSTS` is set.
- Response security headers are added by middleware: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), microphone=(), camera=()`.
- Auth endpoints are rate-limited per IP + identifier. The counters are rows in `rate_limit_events` (hashed key, no emails), so limits survive restarts and are shared by every backend process.
- Progress photos and chat pictures enforce extension, content-type, and size limits; files are saved inside `STORAGE_DIR` with path-traversal checks and are **encrypted at rest** (Fernet, key `UPLOAD_ENCRYPTION_KEY` in the secrets store; files from before encryption stay readable, `python file_crypto.py encrypt-existing` converts them). Create the key once with `python local_secrets.py init-upload-key` and **back it up** (`python local_secrets.py reveal UPLOAD_ENCRYPTION_KEY` into a password manager): without it the encrypted files cannot be read.
- **Content-Security-Policy:** `yarn build` runs `scripts/csp.js`, which puts a strict policy in `build/index.html` (own scripts only, no inline scripts, API origin from `REACT_APP_BACKEND_URL` as the only extra `connect-src`, Google Fonts for styles/fonts) and writes the same policy as a header, plus `frame-ancestors 'none'`, to `build/security-headers.txt` for the web server in front. Dev mode (`yarn start`) is not restricted because hot reload needs inline scripts. `e2e/csp-check.mjs` is a manual browser check of a production build under the policy.

## Admin account initialization

On startup the backend ensures an `owner` role account exists. It is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` only when no owner exists; afterwards only the email and name are kept in step with `ADMIN_EMAIL` / `OWNER_NAME`, and **the password is never overwritten** (earlier versions reset it at every start). Use **Settings → Password** or `owner_admin.py reset-password` to change it. Never commit `.env`; it is ignored by Git.

## Database migrations

This project uses **Alembic** for schema migrations. Migrations live in `backend/alembic/versions/` and are driven by the SQLAlchemy models in `backend/models.py`.

### Common commands

```powershell
cd backend

# Create a new migration after changing models
.venv\Scripts\alembic.exe revision --autogenerate -m "description"

# Apply pending migrations
.venv\Scripts\alembic.exe upgrade head

# Downgrade one revision
.venv\Scripts\alembic.exe downgrade -1

# Mark an existing database as up-to-date without running migrations
.venv\Scripts\alembic.exe stamp head
```

Alembic reads the same `DATABASE_*` environment variables as the application (from `backend/.env`).

### Legacy raw-SQL migration

The one-time migration that introduced multi-user columns is preserved for reference:

```
migrate_multiuser.py
```

Run it manually after backing up data:

```powershell
.\backend\.venv\Scripts\python.exe migrate_multiuser.py
```

A backup of `tools/mysql-data` was made at `tools/mysql-data-backup` before the original migration.

## Testing

See [Testing](#testing-1) below.

## Features

### Money
- Dynamic account hierarchy: bank, cash places, Revolut, locked funds, owed accounts.
- Transfers between accounts, actual-spending calculation, and locked-funds support.
- Expenses, income, and transfers all update account balances automatically.

### People / shared expenses
- People ledger, split expenses, repayments.
- Recording a person payment now updates the selected account balance.
- Clear all debts or per-person balances.

### Groceries
- Multiple shopping lists with budgets, progress, and bulk actions.
- Food catalog (products) with categories, synonyms, and optional nutrition.
- Inventory organized by storage locations: Fridge, Pantry, Freezer, and custom locations.
- Move, consume, discard, and expiry tracking for inventory items.
- Recurring shopping list templates and frequently bought suggestions.
- Interactive kitchen: storage spaces are doors on a kitchen wall; tap one to zoom in, see what is inside, use/add/move items, and switch spaces from a speed-dial rail. "More details" opens the full list with search, filters and bulk actions.
- AI can manage lists, inventory, storage locations (add, rename, move items, consume, discard with confirmation) and expiry dates, give a whole-kitchen overview, and suggest recipes from available ingredients.
- Realistic demo data: `cd backend && .venv\Scripts\python.exe seed_groceries.py --reset` (expiry dates are relative to today).

### Nutrition
- Meal logging with macro tracking.
- Recipe catalog with ingredients; cook a recipe to update grocery inventory.

### Home dashboard
- Summary stats, tasks, people balances, nutrition rings, and today's transactions.

## AI features

The AI assistant is accessed through the floating sparkle button in the app. It supports:

- Natural-language questions and commands
- Voice transcription (sent to Gemini)
- Receipt photo scanning
- Tool/function calling for create/read/update/delete operations on Life Record data
- Action history with undo

AI-recorded financial transactions (expenses, income, transfers, person payments) use the same validated backend endpoints as manual entry, are saved to the database, and appear immediately in the Transactions table and Home dashboard.

All AI requests are made server-side. The Gemini API key must be set in `backend/.env` as `GEMINI_API_KEY`. The key is never sent to the browser. AI requests time out after `GEMINI_TIMEOUT_SECONDS` to prevent the UI from hanging when Gemini is overloaded.

### Assistant

- **Streaming:** `POST /api/ai/chat/stream` (server-sent events: `session`, `delta`, `tool`, `done`, `error`). `POST /api/ai/chat` still returns the whole reply and is used as a fallback by the UI. `GET /api/ai/history?session_id=` restores a conversation when the panel opens.
- **Coverage:** about 70 tools across Home (`get_overview`), Money (transactions, accounts, spaces, income, transfers, categories and budgets), People, Tasks and Calendar (a task's due date is its calendar entry), Groceries and Kitchen, Nutrition (meals, recipes), Fitness and Body. Tools call the same functions as the REST endpoints, so validation, ownership and balance logic are shared. Deleting anything needs a preview and a confirmation on a later message.
- **Context:** each turn includes the current page and short notes on what the assistant changed earlier in the conversation, so "that expense" or "the rest" can be resolved.
- **Formatting:** the prompt asks for amounts as `€14.00`; the UI also tidies `**2.00€**`-style output and sets amounts in the mono face.
- **Voice and receipt scanning** still use Gemini (`/ai/transcribe`, `/ai/receipt`).
- **Provider:** chat runs on OpenCode Go with `gpt-6-luna` (`AI_PROVIDER=opencode`, the default); set `AI_PROVIDER=gemini` to chat with Gemini instead. Nothing switches automatically: if the chosen provider is not configured the assistant says so. OpenCode Go is a subscription with its own endpoint (`https://opencode.ai/inference/go/openai/v1/responses`); the pay-as-you-go Console endpoint uses prepaid credits and answers 402 "Insufficient account funds" when that balance is empty, even with an active Go plan. Go requires a stable `x-opencode-session` header (the conversation id) and a client user agent; both are sent. Go's docs say it is designed for coding agents and that traffic is monitored, so check your plan's terms for use in a general app.

### Saved chats

Every assistant conversation is saved on the server as soon as a reply finishes (`ai_conversations` + `ai_messages`, with the change chips kept so a reopened chat looks the same). The assistant menu lists chats grouped by recency with search (titles and message text), sort, archive/restore, rename and delete (with confirmation). New chats are named after their first exchange by the model, falling back to the first words; a name you choose is never overwritten. API: `GET/PATCH/DELETE /api/ai/conversations[/{id}]`, `POST /api/ai/conversations/{id}/title`. Everything is scoped to the signed-in user, and a session id belonging to another user is never reused. Images attached to a message are validated by their content (JPEG, PNG, WebP or GIF, up to about 6 MB), stored under `STORAGE_DIR/chat_images/<user>/<chat>/`, shown again when the chat is reopened, served only to their owner (`GET /api/ai/conversations/{id}/images/{message_id}`), kept when a chat is archived and deleted together with the chat.

### Scheduled tasks

Describe a report in plain language (“every Monday at 9:00, review last week's spending and email me the key changes”), review the schedule, preview the real report, and confirm. Tasks live in the assistant menu under **Scheduled tasks**.

- **Scheduler:** a database-backed loop in the API process (`SCHEDULER_TICK_SECONDS`, default 30). Schedules (once, daily, weekly, monthly, every N hours/days; at most hourly) are evaluated in the task's own timezone, so 09:00 stays 09:00 across daylight-saving changes. A due task is claimed with a compare-and-set plus a unique `(task, occurrence)` key, so restarts and parallel schedulers cannot run it twice. A run missed by under 24 h is caught up once; older ones are recorded as missed; runs interrupted by a restart are marked failed and can be retried. Run on one API process; extra processes are safe but add nothing.
- **Runs are read-only:** a report may only call the lookup tools for the data areas you pick, as you, and has no tool to change data or send mail. Data returned by tools is treated as untrusted text. If every lookup fails the run fails instead of inventing a report; partial failures are stated in the report.
- **Email (SendGrid):** `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` (a sender verified in SendGrid) are required; without them tasks still run and results stay in the run history, and the UI says email is not set up. A run is only marked *Emailed* when SendGrid accepted the message; failures show the reason and can be retried (only the recipients that did not receive it are retried). Recipients must be your verified account address or another address that confirmed a 6-digit code emailed to it.
- **Safety:** drafts never run; activation needs an explicit confirmation that lists the recipients, and changing the instruction, data areas or recipients of a live task makes it a draft again. Limits: 20 tasks per user, 10 manual runs/previews per hour, 30 scheduled runs per day, 120 s per run.
- **API:** `/api/scheduled/{options,schedule-preview,draft,recipients,tasks,runs}`.


The default model is `gemini-3.5-flash-lite` because it has the highest free-tier quota. If the primary model returns a quota, rate-limit, or capacity error, the backend automatically tries the models listed in `GEMINI_MODEL_FALLBACKS` in order.

## Testing

### Backend tests

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests -q
```

Most tests call the running backend (start it first with `start-all.ps1`) and work in the owner account; every record they create is tagged (`TEST_…`, `E2E-…`) and removed again. Some tests (AI tools, confirmations, undo, scheduling) run in-process against the same MySQL database. There is no separate test database.

- **Standard testing account: John (`a39791@aesancho.pt`)**, filled with fictional sample data by `python backend/seed_john.py` (password from `SEED_PASSWORD`/`TEST_PASSWORD` in the environment only; `--reset` wipes that account's data and reseeds; local backend only). `python backend/cleanup_account.py <email> [--apply]` removes one account's data (dry run by default, one transaction, verifies nobody else changed). Run tests with `TEST_PASSWORD=... pytest tests`.
- The built-in food catalog is shared by all accounts; products a person adds or edits are private to them.
- Credentials: `TEST_EMAIL` (default: John's address) and `TEST_PASSWORD` (from the secrets store or the environment; there is no default in code). Direct database access in tests uses the admin login from the same store. `REACT_APP_BACKEND_URL` overrides the API address (default from `frontend/.env`, with `localhost` replaced by `127.0.0.1` — on Windows `localhost` costs ~2 s per request).
- Modules that change the owner's money balances hold `shared_money_lock` (`tests/support_auth.py`) for their whole run, so the two parallel workers never see each other's transactions.
- `tests/support_auth.py` logs in once per account per run (the login rate limit is 10/minute); `tests/conftest.py` removes the login cache and the accounts the auth tests register when the run ends.
- Email is never sent to reserved test domains (`example.com`, `*.test`, …), so the auth tests do not use the SendGrid quota.
- New tables come from `alembic upgrade head` (the server also creates missing tables at startup; in-process tests need the migration).

### Frontend build

```powershell
cd frontend
yarn build
```

The build runs ESLint and should complete with no warnings. Playwright e2e specs are in `frontend/e2e/` and can be run with `python ..ackend\local_secrets.py run -- npx playwright test` (the store supplies `TEST_PASSWORD`) after starting the backend and frontend. Specs whose describe block says "real model" / "real assistant" (and `saved-chats.spec.js`) call the live AI provider; to skip them:

```powershell
python ..ackend\local_secrets.py run -- npx playwright test --grep-invert "real model|real assistant" e2e/ai-assistant.spec.js e2e/calendar.spec.js e2e/edit-flows.spec.js e2e/groceries.spec.js e2e/nutrition.spec.js e2e/pages-smooth.spec.js e2e/people.spec.js e2e/scheduled-tasks.spec.js e2e/settings.spec.js e2e/smoke.spec.js
```

## Production deployment checklist

1. Copy `backend/.env.production.example` to `backend/.env.production` and fill in real values.
2. Change `JWT_SECRET` to a cryptographically random value (e.g. `python -c "import secrets; print(secrets.token_urlsafe(64))"`).
3. Set a strong `ADMIN_PASSWORD`.
4. Configure real SMTP credentials.
5. Use HTTPS and set `FRONTEND_URL` to the HTTPS URL.
6. Run MySQL/MariaDB with TLS and a non-root application user (see `tools/provision_db.py` for the privileges the app needs).
7. Restrict `CORS_ORIGINS` to the production frontend domain.
8. Set `ALLOWED_HOSTS` to the production domain(s).
9. Serve the frontend `build/` folder with a production web server or reverse proxy.
10. Do not expose phpMyAdmin to the public internet.
11. Rotate the Gemini API key before going live; the existing key should be treated as compromised.
12. Review and patch frontend build-tool dependencies regularly (`yarn audit`).

## Security notes

- Never commit `.env` files. They are ignored by Git.
- Progress photos are served via `Authorization: Bearer <token>` header, not query-string tokens.
- Demo credentials have been removed from the login screen.
- Telemetry scripts (PostHog/third-party) have been removed from `index.html`.
- `@emergentbase/overlay` and `@emergentbase/visual-edits` packages and their Craco wiring have been removed; `yarn.lock` no longer references emergent.sh.
- The malformed-JWT bug has been fixed: missing `sub` claim now returns 401 instead of 500.
- All business endpoints enforce user-level data isolation.
- CORS no longer defaults to `*`; with `allow_credentials=True`, the default origin is `http://localhost:3000`.
- Pydantic request models now enforce maximum lengths and sensible ranges to reduce DoS surface.
- Email templates HTML-escape user-controlled values and URL-encode reset tokens.
- The AI chat history query is scoped to the authenticated user.
- AI requests automatically fall back to alternate Gemini models on quota/rate-limit errors.
- FastAPI/Starlette have been upgraded to patched versions (no known vulnerabilities reported by `pip-audit`).
- Critical frontend build dependencies (`shell-quote`) have been bumped via `resolutions`; run `yarn audit` periodically for remaining build-tool advisories.

## License

Private project for personal use.
