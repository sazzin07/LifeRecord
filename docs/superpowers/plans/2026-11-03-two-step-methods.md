# Two-step sign-in: passkeys and text-message codes — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Add passkeys / security keys (WebAuthn) and text-message (SMS) codes as second steps beside the authenticator app, and settle the three open decisions from S-18 (deactivation policy, breach check, live restart).

**Architecture:** "Two-step is on" means at least one confirmed method (TOTP, passkeys, SMS). Recovery codes stay account-wide. A correct password still earns only a 5-minute challenge; `/auth/login` now also returns `methods` (ordered: passkey, totp, sms). Every sensitive change (add/remove a method, new recovery codes, turn off) needs the password plus ONE proof when two-step is already on: an authenticator code, SMS code, recovery code or a passkey assertion. New logic lives in `passkeys.py`, `sms_service.py`, `sms_codes.py`, extended `two_factor_api.py`; the UI is split into `components/twofactor/*`.

**Tech Stack:** FastAPI/SQLAlchemy/MySQL, `webauthn` 3.0.1 (py_webauthn, pulls cbor2/pyOpenSSL), Twilio REST over `httpx`, React + shadcn + framer-motion, Playwright virtual authenticator (CDP).

**Spec:** the owner's message of 2026-11-03 (items 1, 2, 4: "do whatever is best"; item 3 needs their domain; two-step: implement SMS and passkeys carefully, clean unique UI/UX).

## Global Constraints

- Existing endpoints and tests keep working: `/auth/2fa`, `/auth/2fa/setup|enable|disable|recovery-codes`, `/auth/login/totp`, response keys `enabled`, `recovery_codes_left`, `requires_totp`, `challenge`.
- Secrets at rest: phone numbers encrypted (Fernet, `UPLOAD_ENCRYPTION_KEY`), SMS codes only as keyed hashes, no phone number or code in any log. Passkeys store only public keys.
- A code or a ceremony works once (conditional UPDATE/DELETE, proved by a concurrency test).
- 400 (not 401) for a wrong password/proof in an authenticated session; tests use `X-Forwarded-For` for other addresses.
- Tests never touch a real SMS provider or the real HIBP service; the SMS provider base URL is overridable (`TWILIO_API_BASE`) and the scratch stack points it at a local fake.
- No live-AI tests; secrets stay out of the project (Twilio token goes in the DPAPI store).
- New tables are created at start-up; an Alembic migration that skips existing tables ships with them.

## Review Focus

- Passkey registered on one origin is refused on another (wrong RP ID / origin) — test in Task 2.
- Replayed assertion / reused registration challenge refused — Task 2.
- Cloned authenticator (sign count goes backwards) refused, but synced passkeys with count 0 work — Task 2.
- Removing the last method turns two-step off cleanly and leaves no orphaned recovery codes — Task 4.
- SMS pumping: resend spacing, per-user hourly cap, global hourly cap; message fails visibly when the provider errors — Task 3.
- Lost-everything path: `owner_admin.py disable-2fa` removes passkeys and SMS too — Task 4.

---

### Task 1: Decisions, config, dependency
**Files:** Modify `backend/requirements.txt`, `backend/.env` (local, ignored), `backend/.env.example`, `backend/tests/isolated_env.py`, `README.md`, `APPLICATION_COMPLETION_ROADMAP.md`.
- [ ] Add `webauthn>=3.0.1,<4` to requirements (installed in venv already).
- [ ] Decision 1: deactivation policy confirmed as built (record in README/roadmap, no code change).
- [ ] Decision 2: `PASSWORD_BREACH_CHECK=1` in `backend/.env` and documented as "on" in `.env.example`; `isolated_env.build_environment` sets `PASSWORD_BREACH_CHECK=0` so scratch servers never call the network.
- [ ] `isolated_env`: scratch env gets `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID=ACtest…`, `TWILIO_AUTH_TOKEN=test`, `TWILIO_FROM=+15005550006`, `TWILIO_API_BASE=http://127.0.0.1:<fake port>`; a fake Twilio (`tests/fake_twilio.py`) runs next to the stack and serves `GET /_messages?to=` for tests.

### Task 2: Passkeys backend (`passkeys.py`, tables, routes)
**Files:** Create `backend/passkeys.py`, `backend/tests/support_webauthn.py` (software authenticator), `backend/tests/test_passkeys.py`; modify `models.py` (`WebauthnCredential`, `WebauthnChallenge`), `two_factor_api.py`, `server.py` (login returns `methods`), migration.
**Interfaces:**
- `passkeys.rp_for(request) -> (rp_id, origin)`: origin from `Origin` header if in `CORS_ORIGINS ∪ FRONTEND_URL` (or `WEBAUTHN_ORIGINS`), rp_id = `WEBAUTHN_RP_ID` or that origin's hostname; else 400.
- `passkeys.begin(db, user, purpose, rp_id) -> (challenge_id, options_json)`; `passkeys.claim_challenge(db, challenge_id, user_id, purpose) -> bytes|None` (single use, 5 min).
- Routes: `POST /auth/2fa/passkeys/options` (register; password [+proof]), `POST /auth/2fa/passkeys` (finish, name), `GET` list via `/auth/2fa`, `DELETE /auth/2fa/passkeys/{id}` (password+proof), `POST /auth/2fa/proof/passkey-options` (for step-up), `POST /auth/login/passkey/options` and `POST /auth/login/passkey` (challenge JWT).
- [ ] Failing tests with the software authenticator: register + sign in; wrong origin; replayed assertion; reused challenge; sign count backwards refused / zero counts allowed; other user's credential refused; excluded duplicate; rename; remove last method.
- [ ] Implement, run, commit.

### Task 3: SMS backend (`sms_service.py`, `sms_codes.py`, tables, routes)
**Files:** Create `backend/sms_service.py`, `backend/sms_codes.py`, `backend/tests/fake_twilio.py`, `backend/tests/test_sms_factor.py`; modify `models.py` (`SmsFactor`, `SmsCode`), `two_factor_api.py`, `email_service.py` (notices `two_factor_method_added/removed`).
**Interfaces:**
- `sms_service.available() -> bool`; `async send(to_e164: str, text: str)` raises `SmsError(message)`; `normalise_phone(text) -> str|None` (E.164, `+` required, 8–15 digits).
- `sms_codes.issue(db, user_id, purpose) / verify(db, user_id, code, purpose)`: 6 digits, HMAC under signing secret + user id, 5 min, 5 tries (atomic UPDATE), resend gap 60 s, 5 sends/hour/user, `SMS_MAX_PER_HOUR` (default 60) global.
- Routes: `POST /auth/2fa/sms/start` (password [+proof], phone → sends code), `POST /auth/2fa/sms/confirm`, `DELETE /auth/2fa/sms`, `POST /auth/2fa/proof/sms-send`, `POST /auth/login/sms/send`, `POST /auth/login/sms`.
- [ ] Tests (fake Twilio gets the real message): bad numbers; set up and sign in; code once only; expiry; five tries; resend gap and caps; provider down → 503 with words, no code left usable-and-unseen; phone never in `/auth/2fa` except masked; unavailable when unconfigured.
- [ ] Implement, run, commit.

### Task 4: One two-step model, step-up proofs, recovery
**Files:** Modify `two_factor_api.py`, `owner_admin.py`, `account_data.py` (NOT_EXPORTED), `server.py` (login/reset use `methods`), `tests/test_two_factor.py`, `test_account_export_delete.py` as needed.
- [ ] `status(db, user_id) -> {enabled, methods, passkeys[], sms{enabled, hint, available}, recovery_codes_left}`; `enabled()` true if any confirmed method.
- [ ] `_proof(db, user, body)` accepting `code` (TOTP / SMS / recovery) or `passkey {challenge_id, credential}`; every management route uses it when two-step is on; recovery codes created when the FIRST method is confirmed.
- [ ] Removing the last method deletes recovery codes; `remove_second_step` and `disable-2fa` clear all three.
- [ ] Security-notice emails when a method is added or removed. Tests for each rule above; existing two-step tests still pass.

### Task 5: Frontend library and sign-in screen
**Files:** Create `frontend/src/lib/webauthn.js` (+ `.test.js`); modify `context/AuthContext.jsx`, `pages/Login.jsx`.
- [ ] `webauthn.js`: `supported()`, `createCredential(optionsJson)`, `getAssertion(optionsJson)` → JSON-safe objects (base64url), friendly `PasskeyCancelled` vs real errors. Unit-tested with a stubbed `navigator.credentials`.
- [ ] Sign-in challenge screen: "Verify it's you", primary method panel (passkey button / 6-digit code / SMS send-then-code), "Other ways" list (only methods the account has, plus recovery code), animated, keyboard and screen-reader friendly, no layout jump, SMS resend countdown.

### Task 6: Settings UI
**Files:** Replace `components/TwoFactor.jsx` with `components/twofactor/{TwoFactor,AuthenticatorSetup,PasskeySection,SmsSetup,RecoveryCodes,StepUp}.jsx`.
- [ ] Card with an overall status line, three method rows (state, action), recovery-codes row; setup flows in dialogs/inline steps; one shared step-up dialog (password + chosen proof); empty/unsupported/unavailable states explained in one line; dark mode and 375 px width.

### Task 7: Browser tests
**Files:** Modify `frontend/e2e/two-factor.spec.js`; create `frontend/e2e/two-factor-methods.spec.js`.
- [ ] Existing three specs adapted to the new UI. New: passkey add + sign-in with a CDP virtual authenticator, SMS add + sign-in reading the fake provider, step-up when removing a method, remove last method, a11y audits (phone, dark). Negative controls for passkey (authenticator removed → fails) and SMS.

### Task 8: Verify, document, restart
- [ ] Full backend run (`LR_ISOLATED=1`), frontend unit tests, strict build, bundle budget, full browser suite on the scratch stack (excluding live-AI specs).
- [ ] README (Two-step section, config table), roadmap S-18 limits updated honestly (SMS never sent through a real provider; passkeys only exercised with software/virtual authenticators), `.env.example`, memory update.
- [ ] Decision 4: restart the live backend with the new code after everything passes, confirm tables and `/api/health`, tell the owner it signed everyone out.
- [ ] Commit per task.
