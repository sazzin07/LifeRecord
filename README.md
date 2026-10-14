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

```
Email:    tiagosa743@gmail.com
Password: LifeRecord
```

This owner account is created automatically on first startup from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend/.env`. The password is stored as a salted bcrypt hash only.

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
| `GEMINI_API_KEY` | Google Gemini API key (optional; AI features return 503/504 without it) |
| `GEMINI_TIMEOUT_SECONDS` | AI request timeout (default `25`) |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins (default `http://localhost:3000`) |
| `ALLOWED_HOSTS` | Comma-separated allowed `Host` headers (optional; set in production) |
| `STORAGE_DIR` | Local directory for progress photos |
| `MAX_UPLOAD_SIZE_MB` | Maximum upload size for photos/audio (default `10`) |
| `ALLOWED_PHOTO_EXTENSIONS` | Comma-separated photo extensions (default `jpg,jpeg,png,webp`) |

### 3. phpMyAdmin (optional)

A local phpMyAdmin 5.2.3 is bundled in `tools/phpmyadmin` and pre-configured for `localhost:3306` as `root` with no password. Start it with PHP's built-in server:

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

In development, if `SMTP_HOST` is not set, the backend logs the email content to the console instead of sending it. For production, set the SMTP variables listed above. Gmail example:

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
- Tokens are signed with `JWT_SECRET` using HS256.
- The frontend stores both tokens in `localStorage`. The access token is sent as `Authorization: Bearer <token>`.
- On 401, the frontend automatically calls `/api/auth/refresh` to obtain a new access token and retries the original request.
- CORS is restricted to `CORS_ORIGINS`; credentials are never sent to `*`.
- `TrustedHostMiddleware` validates the `Host` header when `ALLOWED_HOSTS` is set.
- Response security headers are added by middleware: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), microphone=(), camera=()`.
- Auth endpoints are rate-limited per IP + identifier.
- Progress photos enforce extension, content-type, and size limits; files are saved inside `STORAGE_DIR` with path-traversal checks.

## Admin account initialization

On startup the backend ensures an `owner` role account exists with the credentials from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The password is hashed with bcrypt. Changing `ADMIN_PASSWORD` in `.env` and restarting updates the stored hash. Never commit `.env`; it is ignored by Git.

## Database migrations

This project uses raw SQL migrations in addition to SQLAlchemy models. The migration that introduced multi-user columns is:

```
migrate_multiuser.py
```

Run it manually after backing up data:

```powershell
.\backend\.venv\Scripts\python.exe migrate_multiuser.py
```

A backup of `tools/mysql-data` was made at `tools/mysql-data-backup` before the original migration.

## Testing

### Backend

With the backend running on `http://localhost:8000`:

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests -v
```

### Frontend build

```bash
cd frontend
yarn build
```

## AI features

The AI assistant is accessed through the floating sparkle button in the app. It supports:

- Natural-language questions and commands
- Voice transcription (sent to Gemini)
- Receipt photo scanning
- Tool/function calling for create/read/update/delete operations on Life Record data
- Action history with undo

All AI requests are made server-side. The Gemini API key must be set in `backend/.env` as `GEMINI_API_KEY`. The key is never sent to the browser. AI requests time out after `GEMINI_TIMEOUT_SECONDS` to prevent the UI from hanging when Gemini is overloaded.

The default model is `gemini-3.5-flash-lite` because it has the highest free-tier quota. If the primary model returns a quota, rate-limit, or capacity error, the backend automatically tries the models listed in `GEMINI_MODEL_FALLBACKS` in order.

## Production deployment checklist

- Change `JWT_SECRET` to a cryptographically random value.
- Set strong `ADMIN_PASSWORD`.
- Configure real SMTP credentials.
- Use HTTPS and set `FRONTEND_URL` to the HTTPS URL.
- Run MySQL/MariaDB with TLS and a non-root application user.
- Restrict `CORS_ORIGINS` to the production frontend domain.
- Set `ALLOWED_HOSTS` to the production domain(s).
- Serve the frontend `build/` folder with a production web server or reverse proxy.
- Do not expose phpMyAdmin to the public internet.
- Rotate the Gemini API key before going live; the existing key should be treated as compromised.
- Review and patch frontend build-tool dependencies regularly (`yarn audit`).

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
