# LifeRecord — Global Multi-User Authentication & Security Upgrade Report

## Completed work

### 1. Database schema — multi-user isolation
- Added `user_id VARCHAR(36) NOT NULL` foreign keys to every user-owned table:
  `accounts`, `categories`, `people`, `transactions`, `settlements`, `tasks`,
  `weight_entries`, `workouts`, `photos`, `groceries`, `price_records`,
  `shopping_items`, `meals`, `recipes`, `ai_actions`, `ai_messages`.
- Added email-verification and password-reset columns to `users`.
- Ran `migrate_multiuser.py` to alter the live schema, backfill existing data to the owner user, and add indexes/FKs.
- Backed up `tools/mysql-data` to `tools/mysql-data-backup` before migration.

### 2. Backend auth & security
- New endpoints:
  - `POST /api/auth/register`
  - `POST /api/auth/verify`
  - `POST /api/auth/resend-verification`
  - `POST /api/auth/forgot-password`
  - `POST /api/auth/reset-password`
  - `POST /api/auth/change-password`
- Email verification: 6-digit code, 15-minute expiry, 90-second resend cooldown, 5-attempt brute-force limit, per-identifier rate limiting.
- Password reset: single-use JWT token, 30-minute expiry, invalidated after use; never reveals whether an email is registered.
- `get_current_user` now rejects unverified accounts (403) and malformed tokens (401).
- All business endpoints filter by the JWT `sub` claim; no endpoint trusts client-supplied user IDs.
- Rate-limiting helpers protect auth endpoints.
- Added `security_utils.py` (bcrypt hashing, JWT create/decode, validation, secure codes) and `email_service.py` (async SMTP via aiosmtplib with dev fallback logging).
- AI chat now passes the real user context to `dispatch_tool` and saves `AIMessage`/`AIAction` with `user_id`. Added a `GEMINI_TIMEOUT_SECONDS` timeout so the UI does not hang when Gemini is overloaded.
- Removed the `memory/test_credentials.md` write from `seed()`.

### 3. Admin account
- Updated to `tiagosa743@gmail.com` / `LifeRecord`.
- Seed function keeps the `owner` role account in sync with `ADMIN_EMAIL`/`ADMIN_PASSWORD` and stores only bcrypt hashes.

### 4. Frontend auth UI
- New pages: `Signup.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`.
- `Login.jsx` now includes links to signup/forgot password and displays a theme-matched email-verification modal.
- `AuthContext.jsx` exposes `signup`, `verifyCode`, `resendVerification`, `forgotPassword`, `resetPassword`, `changePassword`.
- `App.js` routes updated with `PublicOnly` and `Protected` wrappers.
- Removed hardcoded single-user copy ("Sá") from `AppShell.jsx` and `Settings.jsx`.

### 5. Documentation
- `README.md` rewritten with multi-user architecture, signup/verification flow, password-reset flow, admin initialization, SMTP setup, migrations, production deployment checklist, and security controls.
- `backend/.env.example` expanded with all new variables.

### 6. Testing
- Added `backend/tests/test_auth_multiuser.py` covering:
  - register → verify → login
  - invalid/expired/reused verification codes
  - forgot → reset → login with new password
  - unverified users blocked from protected endpoints
  - cross-user data isolation (people, transactions, categories)
  - admin existence, verified status, and secure password hashing
- Updated existing tests to use the new admin credentials.
- Latest backend test run: **43 passed, 1 skipped**.
- Frontend `yarn build` succeeds with no errors.

## Test results

```text
cd backend
.venv\Scripts\python.exe -m pytest tests -v
# => 43 passed, 1 skipped in 70.55s

cd frontend
yarn build
# => Compiled successfully.
```

The single skipped test (`test_iteration2.py::TestAITools::test_ai_delete_confirmation`) skipped because Gemini returned `503 UNAVAILABLE` during that run. This is an external provider issue, not a code failure.

## Remaining issues / notes

- **Email delivery:** SMTP is not configured in `backend/.env`. The backend logs emails to the console in development, so verification/reset flows are testable locally. For production, set real SMTP credentials.
- **Gemini availability:** The free-tier model occasionally returns 503/RESOURCE_EXHAUSTED. A `GEMINI_TIMEOUT_SECONDS` guard (default 25s) prevents the UI from hanging, but AI features depend on a working API key and provider availability.
- **Access-token lifetime:** Access tokens now expire after `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` (default 30 minutes) for security. Refresh tokens are generated but not yet used by the frontend; users must re-login after the access token expires. Increase `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` or implement silent refresh if this UX is undesirable.
- **Frontend dev server:** `yarn start` is running on port 3000. Browser console/network testing of the new auth pages has not been performed in this session; API journeys were verified with automated tests and direct REST calls.
- **GET /health 404:** Some external process is polling `/health`, which does not exist. It is harmless but can be ignored or a health endpoint can be added later.
- **Compromised Gemini key:** The existing key in `backend/.env` should be rotated in Google AI Studio before any production use.

## Credentials / configuration you must supply

| Item | Current value | Action needed |
|---|---|---|
| Admin email | `tiagosa743@gmail.com` | Already set in `backend/.env` |
| Admin password | `LifeRecord` | Already set in `backend/.env`; change if desired |
| Gemini API key | configured | Already in `backend/.env` (ignored by Git) |
| SMTP host | empty | Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` in `backend/.env` for real email delivery |
| JWT secret | `dev-jwt-secret-change-in-production` | **Change before production** |
| Production frontend URL | `http://localhost:3000` | Update `FRONTEND_URL` for production |

## Files changed (high-level)

- `backend/server.py` — auth endpoints, user isolation, AI timeout, seed sync
- `backend/models.py` — `user_id` columns and verification fields
- `backend/security_utils.py` — new
- `backend/email_service.py` — new
- `backend/database.py` — (already existed, unchanged)
- `backend/.env` and `backend/.env.example`
- `backend/requirements.txt` — added `aiosmtplib`
- `backend/tests/test_auth_multiuser.py` — new
- `backend/tests/backend_test.py`, `backend/tests/test_iteration2.py` — credential updates
- `frontend/src/App.js`, `AuthContext.jsx`, `pages/Login.jsx`, `pages/Signup.jsx`, `pages/ForgotPassword.jsx`, `pages/ResetPassword.jsx`, `components/AppShell.jsx`, `pages/Settings.jsx`
- `README.md`, `test_result.md`
- `start-all.ps1`, `tools/ensure_db.py`
- `migrate_multiuser.py`
