# Life Record — Security Audit, Cleanup & Hardening Report

**Date:** 2026-10-13  
**Scope:** `C:\Projects\LifeRecord` (backend, frontend, configuration, dependencies)  
**Objective:** Audit, clean up, optimize, and harden security without adding new features.

---

## Executive Summary

The codebase was audited for security vulnerabilities, dead code, and maintenance issues. Several high- and medium-severity issues were identified and remediated. All backend integration tests pass, and the frontend builds successfully. Some residual risk remains in frontend build-toolchain dependencies; these are documented below.

**Test results:**
- Backend: **50 passed, 0 skipped**
- Frontend build: **success**
- Backend dependency audit (`pip-audit`): **no known vulnerabilities**
- Frontend dependency audit (`yarn audit`): **0 critical, 46 high, 28 moderate** (all in build/dev tooling; see residual risks)

---

## Changes Made After Initial Audit

### A. Gemini model fallback and refresh tokens

Following the initial report, two additional hardening items were implemented:

1. **Gemini model fallback:** The default model changed to `gemini-3.5-flash-lite` and a fallback chain (`GEMINI_MODEL_FALLBACKS`) was added. The `_gemini_generate_with_fallback()` helper retries transient quota/rate-limit/capacity errors against the next configured model.

2. **Refresh token flow:** `/auth/refresh` was added, login/verify/reset now return `refresh_token`, and the frontend (`api.js` + `AuthContext.jsx`) automatically exchanges refresh tokens on 401 and retries the original request.

---

## Findings and Fixes

### 1. CORS misconfiguration — HIGH

**Finding:** `backend/server.py` defaulted `CORS_ORIGINS` to `*` while `allow_credentials=True`. This is a well-known insecure default that allows any origin to make authenticated cross-origin requests.

**Fix:**
- Default origin changed to `http://localhost:3000`.
- `allow_methods` and `allow_headers` restricted to explicit values.
- `max_age=600` added for preflight caching.

**Affected files:** `backend/server.py`, `backend/.env.example`, `backend/.env`

**Verification:** New integration test confirms an unauthorized origin receives no `Access-Control-Allow-Origin` header.

---

### 2. Missing security headers — MEDIUM

**Finding:** The backend returned responses without standard security headers (`X-Content-Type-Options`, `X-Frame-Options`, etc.).

**Fix:** Added a custom `security_headers` middleware that sets:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`

**Affected files:** `backend/server.py`

**Verification:** Integration test verifies the headers are present on API responses.

---

### 3. Missing `Host` header validation — MEDIUM

**Finding:** No validation of the HTTP `Host` header, leaving the application vulnerable to Host-header attacks in production.

**Fix:** Added optional `TrustedHostMiddleware` that activates when `ALLOWED_HOSTS` is configured.

**Affected files:** `backend/server.py`, `backend/.env.example`, `backend/.env`

---

### 4. File upload security gaps — HIGH

**Finding:**
- Photo uploads accepted any extension and arbitrary client-supplied content types.
- No maximum file-size check.
- `save_object`/`read_object` did not verify that resolved paths stayed inside `STORAGE_DIR`, permitting path traversal if an attacker-controlled path reached storage functions.

**Fix:**
- Added `MAX_UPLOAD_SIZE_MB` and `ALLOWED_PHOTO_EXTENSIONS` configuration.
- Photo uploads now validate extension, canonicalize content type, and enforce size limit.
- Audio uploads in `/ai/transcribe` now validate extension and size.
- Added `_safe_storage_path()` that resolves the path and confirms it is inside `STORAGE_DIR`.

**Affected files:** `backend/server.py`, `backend/.env.example`, `backend/.env`

**Verification:** Integration tests reject non-image uploads (400) and oversized uploads (413).

---

### 5. AI chat history not user-scoped — HIGH

**Finding:** `run_ai_chat()` loaded AI message history by `session_id` only. A user knowing another user's session ID could read their chat history.

**Fix:** Added `AIMessage.user_id == user["_id"]` to the history query.

**Affected files:** `backend/server.py`

**Verification:** New integration test seeds a message for one user and confirms another user cannot retrieve it with the same `session_id`.

---

### 6. AI endpoints missing request timeouts — MEDIUM

**Finding:** `/ai/receipt` and `/ai/transcribe` called Gemini without explicit timeouts, allowing unbounded waits.

**Fix:** Added `asyncio.wait_for` with `GEMINI_TIMEOUT_SECONDS` to both endpoints, returning 504 on timeout.

**Affected files:** `backend/server.py`

---

### 7. Email HTML injection — MEDIUM

**Finding:** Verification-code and password-reset email templates interpolated user-controlled names directly into HTML using f-strings, allowing HTML/script injection into emails.

**Fix:** HTML-escape display names and verification codes in HTML bodies; URL-encode reset tokens. Plain-text bodies use the raw values (no HTML interpretation).

**Affected files:** `backend/email_service.py`

---

### 8. Unvalidated Pydantic models — MEDIUM

**Finding:** Many request body models used plain `str`/`float` fields with no maximum lengths or ranges, creating a DoS surface and potential database errors.

**Fix:** Added `Field(..., max_length=...)` / `ge` / `le` constraints to all request models (`LoginBody`, `SignupBody`, `ExpenseBody`, `GroceryBody`, `RecipeBody`, `WorkoutBody`, `AIChatBody`, etc.).

**Affected files:** `backend/server.py`

---

### 9. Vulnerable backend dependencies — HIGH

**Finding:** `pip-audit` reported 14 known vulnerabilities in `starlette==0.37.2` (DoS, SSRF, host/path validation bypasses, etc.) pulled in by `fastapi==0.110.1`.

**Fix:** Upgraded `fastapi>=0.115.0` and `uvicorn>=0.30.0`. Re-ran `pip-audit`: **no known vulnerabilities**.

**Affected files:** `backend/requirements.txt`

**Verification:** Full backend test suite passes after upgrade.

---

### 10. Frontend dependency vulnerabilities — MEDIUM / HIGH (residual)

**Finding:** `yarn audit` initially reported 109 vulnerabilities (2 critical, 73 high, 34 moderate), primarily in `react-scripts` and its transitive build toolchain (`shell-quote`, `fast-uri`, `postcss`, etc.).

**Fix:**
- Bumped `shell-quote` resolution to `1.11.0` (critical).
- Bumped `fast-uri` resolution to `3.1.8` (high).
- Bumped `postcss` to `8.5.23` and aligned transitive postcss resolutions.

**Result:** 0 critical, 46 high, 28 moderate remain. The remaining advisories are in webpack, babel, eslint, and other build-only dependencies that do not process untrusted runtime input. Upgrading `react-scripts` itself would be a large, breaking change beyond the scope of this hardening pass.

**Affected files:** `frontend/package.json`, `frontend/yarn.lock`

---

### 11. Dead/unused imports and code — LOW

**Finding:** `pyflakes` reported unused imports (`tempfile`, `shutil`, `Header`, `EmailStr`, `Any`, `insert`, `create_refresh_token`) and unused exception variables.

**Fix:** Removed unused imports and renamed/shadowing variables.

**Affected files:** `backend/server.py`, `backend/models.py`, `backend/email_service.py`

**Verification:** `pyflakes backend/server.py backend/models.py backend/security_utils.py backend/email_service.py backend/database.py` reports no issues.

---

### 12. Local log file not ignored — LOW

**Finding:** `frontend/frontend.log` was created by `start-all.ps1` and not ignored.

**Fix:** Added `*.log` and `frontend/frontend.log` to `.gitignore`.

**Affected files:** `.gitignore`

---

## Verification Commands

```powershell
# Backend tests
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -v

# Backend static analysis
.\backend\.venv\Scripts\python.exe -m pyflakes backend/server.py backend/models.py backend/security_utils.py backend/email_service.py backend/database.py

# Backend dependency audit
.\backend\.venv\Scripts\python.exe -m pip_audit --requirement backend/requirements.txt

# Frontend build
cd frontend; yarn build

# Frontend dependency audit
cd frontend; yarn audit --level moderate --summary
```

---

## Outstanding / Residual Risks

1. **Frontend build-toolchain vulnerabilities.** 46 high and 28 moderate advisories remain in build-only packages (`react-scripts`, webpack, babel, eslint, etc.). These do not affect the production runtime because the generated static bundle is served, but they affect the development/build environment. A future migration away from Create React App (e.g., to Vite or a maintained framework) would eliminate most of these.

2. **Rate limiting is in-memory.** `_rate_limit_store` resets on server restart and is not shared across workers. For multi-process production deployments, replace with Redis or a similar store.

3. **(RESOLVED) Refresh tokens are now used.** `/auth/refresh` is implemented and the frontend automatically refreshes access tokens on 401. Tokens are still stored in `localStorage`; moving the refresh token to an httpOnly cookie would be a future hardening step.

4. **JWT tokens in `localStorage`.** The frontend stores the access token in `localStorage`. This is acceptable for the current threat model because the app has no XSS sinks (`dangerouslySetInnerHTML`, `eval`, raw `innerHTML`, etc.), but a httpOnly cookie + CSRF protection would be a stronger design.

5. **No Content-Security-Policy header.** A restrictive CSP would break the React dev server. CSP should be configured at the reverse proxy for the production build.

6. **Database runs as root with no password locally.** This is acceptable for local development but must be changed in production (see README checklist).

7. **Gemini API key in `.env`.** The existing key should be treated as compromised and rotated before any production deployment.

---

## Conclusion

All identified critical and high-severity backend vulnerabilities have been remediated and retested. The application now has a stronger security posture with hardened CORS, security headers, input validation, file-upload controls, user-scoped AI history, patched dependencies, and additional integration tests. Residual risks are primarily in the frontend build toolchain and documented above for future work.
