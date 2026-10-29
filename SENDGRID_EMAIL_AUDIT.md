# SendGrid Email Verification & Delivery Audit

**Date:** 2026-10-29 · **Branch:** `feature/roadmap-completion` · **Linked from:** [APPLICATION_COMPLETION_ROADMAP.md](APPLICATION_COMPLETION_ROADMAP.md) §16
**Status of this document:** findings only. **No email changes were made.** No email was sent, no DNS or SendGrid setting was changed, no credential was printed.

## How this audit was done (and what it cannot tell you)

| Method | Used for |
|--------|----------|
| Code inspection | Everything marked **[code]** below. Reading code proves what the app *does*, not that mail *arrives*. |
| Public DNS lookups (read-only) | DMARC/SPF of `gmail.com`, the domain of the configured sender. |
| Read-only SendGrid API `GET`s with the app's own key | Key scopes. Result: the key only holds `mail.send` and `sender_verification_eligible`; every account-level `GET` (verified senders, authenticated domains, suppressions, tracking settings) answered **403**. That is the right least-privilege shape, but it means **the SendGrid account state could not be read** and is marked *unverified* below. |
| One throwaway-account probe against the local API (`example.com`, which the app never mails) | Confirmed the verification lock-out bug (P1-1). The user was deleted afterwards. |
| Tests run | Backend 345 passed at the last full run; none of them sends real mail (a fake transport is used and reserved domains are blocked). |

**Not verified, because it needs your access or a real send:** that any SendGrid mail reaches an inbox, the Single Sender / Domain Authentication status, DNS records at your registrar, suppression lists, the SendGrid activity feed, click-tracking state, and the API-key list in the dashboard.

---

## 1. Summary

| Area | State |
|------|-------|
| Email flows that exist | Signup verification code, resend code, password reset link, scheduled-report delivery, report-recipient verification code. |
| Provider | SendGrid v3 HTTPS API (`email_service.py`), SMTP as an alternative, console log fallback when neither is configured. |
| What works (by code + fake-transport tests) | Request shape, error mapping (401/403/429/5xx/timeout), key redaction, EU host switch, reserved-domain guard, honest `sent / failed / not_configured` for reports, hashed + attempt-limited + rate-limited codes for report recipients. |
| What is broken | **Account verification locks out permanently after 5 wrong codes** (P1-1). Delivery failures of account emails are invisible to the user and to you (P1-2). |
| What is missing | Bounce/block/spam webhooks, retries, security-notification emails, tracking-off for reset links, any logging of delivery outcomes for account mail. |
| What is unverified | Real delivery, sender/domain authentication, DNS. The only configured sender is a `@gmail.com` address, which **cannot** be domain-authenticated and is likely to be spam-foldered or rejected by Gmail (P0-1). |

**Do not mark email authentication or delivery as complete.** Nothing in this audit changes that.

---

## 2. Current implementation

| Flow | Trigger | Code | Delivery | State |
|------|---------|------|----------|-------|
| Signup verification code (6 digits, 15 min) | `POST /auth/register` | `server.py:1218-1252`, template `email_service.py:188-214` | `send_email` → SendGrid if key + sender are set | Works by code; **result ignored** (`server.py:1249`); lock-out bug |
| Resend code | `POST /auth/resend-verification` | `server.py:1255-1284` | same | 90 s cooldown; **does not reset attempts** (P1-1) |
| Verify code | `POST /auth/verify` | `server.py:1287-` | none | 5-attempt cap, never reset |
| Password reset link (30 min, single use) | `POST /auth/forgot-password` | `server.py:1353-1366`, template `email_service.py:217-247` | same | Works by code; result ignored (`server.py:1363`); stores only a hash since Batch 6b |
| Reset password | `POST /auth/reset-password` | `server.py:1369-` | none | Single use, ends all sessions (Batch 6b) |
| Scheduled report | scheduler tick / "run now" | `scheduling.py:609` → `email_service.deliver` | SendGrid, per-recipient status, retry only unreached recipients | Best-implemented flow |
| Report-recipient code | `POST /scheduled/recipients` | `scheduling_api.py:142-182` | `deliver`, rolled back on failure | Good design (hashed code, attempts reset on resend, 5/hour/user), with the HTML-injection problem P2-2 |
| Security notifications (password changed, sign-out-everywhere, new login) | — | — | — | **Missing** |
| Email-address change / account deletion | — | — | — | Do not exist in the app (no such feature), so not required yet |

Provider selection: `provider_name()` returns `sendgrid` when `SENDGRID_API_KEY` **and** `SENDGRID_FROM_EMAIL` are set, else `smtp` when `SMTP_HOST` is set, else `None` (`email_service.py:110-114`). Account emails and reports therefore both use SendGrid when configured. The README's "Email configuration" section still describes only SMTP; it is stale.

Current configuration (names and non-secret facts only): key present in the encrypted store and shaped like a SendGrid key (`SG.`); `SENDGRID_FROM_EMAIL` domain = **`gmail.com`**; `SENDGRID_EU` unset (US host); `FRONTEND_URL=http://localhost:3000`; no SMTP host. No key is present in any tracked file (`git grep` for `SG.…` = 0 hits).

---

## 3. SendGrid integration

**What is right [code]:** HTTPS API with explicit timeouts (20 s / 10 s connect); non-2xx mapped to safe, user-showable messages; the key is stripped from provider error text (`email_service.py:150-151`); the error log line holds only the status code (`:152`); EU residency switch; reserved test domains are never mailed (`:94-103`, tested); the app key has only `mail.send` + `sender_verification_eligible` (verified live, read-only).

**Gaps:**

| # | Finding | Evidence | Fix type |
|---|---------|----------|----------|
| I-1 | No retries or backoff. A `429`/`5xx`/timeout is a permanent failure for that attempt; for account mail the user is never told. | `email_service.py:139-161`, callers `server.py:1249,1282,1363` | Code |
| I-2 | The payload does not set `tracking_settings`. If click tracking is on for the account (SendGrid setting; could not be read: 403), the reset link is rewritten to a `sendgrid.net` redirect, which exposes the reset token to SendGrid and breaks if the tracking domain is not authenticated. | `email_service.py:127-134` | Code (`click_tracking.enable=false`, `open_tracking.enable=false` per message) + check the dashboard |
| I-3 | No `categories`/`custom_args` on account mail, so SendGrid's activity feed cannot tell "verification" from "reset"; no message id is kept (SendGrid returns `X-Message-Id` on 202). | `:127-134`; `custom_args` is only passed by reports (`scheduling.py:609`) | Code |
| I-4 | `Reply-To`, `List-Unsubscribe` not set. Transactional mail does not need unsubscribe, but a monitored `Reply-To` helps trust. | `:127-132` | Code (optional) |
| I-5 | `SMTP_FROM_NAME` is used as the display name of the SendGrid sender: harmless, but the naming is misleading. | `:129` | Cosmetic |
| I-6 | `from` is whatever `SENDGRID_FROM_EMAIL` says; nothing checks at startup that it is verified. A wrong value only shows up as a `403` at the first send. | `:117-122`, `:153-156` | Code (startup warning) |

---

## 4. Domain authentication (SPF / DKIM / DMARC)

**Evidence gathered:**

- Sender domain is `gmail.com` (from the app's configuration).
- Public DNS, looked up today: `_dmarc.gmail.com TXT "v=DMARC1; p=none; sp=quarantine; rua=mailto:mailauth-reports@google.com"`.
- SendGrid account state (verified senders, authenticated domains, link branding): **403 with the app key, unverified.**

**Assessment [inference, not a delivery test]:** you cannot add DNS records to `gmail.com`, so SendGrid cannot sign mail *as* `gmail.com` (DKIM `d=` will be `sendgrid.net`/your `em…` subdomain) and SPF is checked against SendGrid's envelope domain. DMARC alignment with the visible `From: …@gmail.com` therefore cannot pass. Gmail publishes `p=none` for itself, but Google's own sender guidelines require third-party mail that claims a `gmail.com` From to authenticate; expect spam-folder placement or rejection, which would hit exactly the mails that matter (verification codes, reset links). SendGrid's Single Sender Verification of a free-mail address only proves you can read that mailbox. A real test send to a Gmail and an Outlook inbox (with "Show original") is the only way to confirm; it was **not** done here.

**Required, in priority order:**

1. **Get a domain you control** (or use one you already own) and use `no-reply@<yourdomain>` or `accounts@<yourdomain>` as the sender. *(Your action: registrar/DNS access.)*
2. In SendGrid → Settings → Sender Authentication → **Authenticate Your Domain** (not just Single Sender). SendGrid then shows the exact records; **copy them from SendGrid, do not invent them**. Typical shape (placeholders, values come from SendGrid):

   | Type | Host | Value |
   |------|------|-------|
   | CNAME | `em<NNNN>.<yourdomain>` | `u<ID>.wl<NNN>.sendgrid.net` ← from SendGrid |
   | CNAME | `s1._domainkey.<yourdomain>` | `s1.domainkey.u<ID>.wl<NNN>.sendgrid.net` ← from SendGrid |
   | CNAME | `s2._domainkey.<yourdomain>` | `s2.domainkey.u<ID>.wl<NNN>.sendgrid.net` ← from SendGrid |
   | TXT | `_dmarc.<yourdomain>` | `v=DMARC1; p=none; rua=mailto:<mailbox you read>` first, move to `p=quarantine` then `p=reject` once reports show alignment |

   SPF is satisfied through the `em…` CNAME (SendGrid's "automated security"); do **not** add a second SPF `TXT`. If the domain already has an SPF record for another provider, merge instead of duplicating (only one `v=spf1` record may exist).
3. Click **Verify** in SendGrid; it reports each record. Then re-run a test send and read the `Authentication-Results` header: expect `spf=pass`, `dkim=pass` with `d=<yourdomain>`, `dmarc=pass`.
4. Optional: **Link Branding** (so any tracked links use your domain) and **Reverse DNS** need a dedicated IP, which this low volume does not justify.
5. Delete the Single Sender entry for the Gmail address once the domain is authenticated.

---

## 5. User verification flow

| Check | Result | Evidence |
|-------|--------|----------|
| Code strength | 6 digits from `secrets.randbelow` | `security_utils.generate_six_digit_code` |
| Expiry | 15 minutes, checked on verify | `server.py` verify |
| Single use | Code cleared on success | `server.py` verify |
| Attempt limit | 5 wrong codes per account, **never reset** | `server.py:1300`; resend sets code/expiry/timestamp only (`:1277-1279`) |
| Resend cooldown | 90 s, enforced via `last_verification_sent_at` | `server.py:1268-1275` |
| Rate limit | per client+email, DB-backed since Batch 6b | `check_rate_limit` |
| Enumeration | Register and resend answer identically for known/unknown emails, **but** the known-email path returns before hashing the password and sending mail, so response time differs; forgot-password sends mail inline only when the user exists. Not measured (reserved domains skip the send in tests); a real SendGrid round trip adds hundreds of ms on the "exists" side. | `server.py:1218-1252`, `:1353-1366` |
| Storage | Code stored in plain text (15 min lifetime) | `models.py User.verification_code` |
| Unverified accounts | Cannot use the API; `/auth/me` and resend allowed; refresh refused (Batch 6b) | `server.py` |

**Confirmed bug (probe, today):** 5 wrong codes → `400 Invalid verification code`; `POST /auth/resend-verification` → `200` and a new code is stored, but `verification_attempts` stays **5**; verifying with the new, correct code → `400 "Too many failed attempts. Please request a new code."` The message sends the user to a button that cannot help. Only a manual database edit recovers the account.

---

## 6. Other email flows that the app actually needs

| Email | Needed? | Status |
|-------|---------|--------|
| Verification code | Yes | Exists; fix P1-1 |
| Password-reset link | Yes | Exists |
| "Your password was changed" (and "signed out everywhere") | Yes: it is the user's only warning that someone else changed it | **Missing**, trivial now that password change/reset exist (Batch 3, 6b) |
| "New sign-in from a new device" | Nice to have | Missing |
| Scheduled reports | Feature | Exists |
| Report-recipient confirmation | Feature | Exists |
| Email-address change confirmation | Only when that feature exists | n/a |

---

## 7. Deliverability and reliability

| Topic | Today |
|-------|-------|
| Bounces / blocks / spam reports / unsubscribes | **No webhook endpoint, nothing stored.** A mistyped address at signup bounces silently; repeated bounces to bad addresses damage the sender reputation. |
| Suppression lists | Not consulted. SendGrid answers `202` for an address on its suppression list and then drops it; the app would show "sent". |
| Account-mail failures | `send_email` returns `False` on failure and the three callers ignore it (`server.py:1249,1282,1363`): the user is told "you will receive a code shortly" whatever happened. With **no provider configured**, the mail body, including the code and the reset link, is written to the server log (`email_service.py:59-65`). |
| Retries / queue | None. Mail is sent inline inside the request (adds latency; a slow SendGrid slows signup). |
| Duplicate prevention | Resend has a 90 s cooldown; register has none beyond the rate limit; reports use a unique run key (good). |
| Rate limits (SendGrid side) | Your plan has a daily/monthly sending cap (check it in the dashboard; plan terms change); nothing in the app tracks quota. |
| Logging | Reports: outcome stored per recipient. Account mail: one warning line on failure, nothing on success. |
| Idempotency of reset | Token hashed and single use (Batch 6b). |

---

## 8. Security

| Finding | Severity | Evidence |
|---------|----------|----------|
| Verification lock-out is permanent (availability, and an attacker who knows an unverified victim's email can lock them out with 5 guesses) | High | P1-1 |
| Recipient-verification email inserts the sender's account name **unescaped** into the HTML. A name is up to 255 characters of anything, so a user can send "Click <a href=…>here</a> to claim…" to any third-party address **from your verified SendGrid sender**. 5 mails/hour/user, no global cap. | Medium | `scheduling_api.py:171`, `server.py` `SignupBody.name` (`max_length=255`, no character rules) |
| Reset link (with the token) can be rewritten by SendGrid click tracking if that account setting is on | Medium (unverified) | I-2 |
| Reset token stays in the page URL and browser history after use | Low | `frontend/src/pages/ResetPassword.jsx` reads `?token=` and never removes it; add `history.replaceState` and `Referrer-Policy: no-referrer` for that page |
| Plain-text code/link written to logs when no provider is configured | Low in dev, High if it ever happens in production | `email_service.py:59-65` |
| Verification code stored in plain text | Low | model |
| API key handling | OK: stored in the DPAPI store (Batch 6a), never logged, redacted from provider errors, scope-limited. The key was pasted into a chat in an earlier session: **rotate it** (SEC-003). | verified |
| Email enumeration | Responses are uniform; timing differs (above) | `server.py` |

---

## 9. Testing

**Exists:** SendGrid request shape/success, 401/403/429/5xx messages, network failure, EU host (`test_scheduling_engine.py:413-447`, fake transport); reserved-domain guard (`test_email_reserved_domains.py`); report delivery honesty and retry; recipient verification validation (`test_scheduling_api.py`); auth flows with the mail provider off.

**Missing:**

1. Account-mail delivery: verification and reset emails call the provider with the right recipient/subject and a correct reset URL (fake transport).
2. Failure surfacing: provider failure on signup/reset must be visible to the user or retried (once P1-2 is built).
3. Verification lock-out: 5 wrong codes then resend then correct code must succeed.
4. Expired and reused codes/tokens at the HTTP level (reset reuse and hashing are covered; verification expiry is not).
5. HTML escaping of user-supplied names in every template.
6. Webhook signature verification and event handling (once built).
7. One manual end-to-end: signup with a real inbox, receive the code, verify; forgot password, receive the link, reset; check headers for `spf/dkim/dmarc=pass`.

---

## 10. Prioritized gap analysis

| ID | Priority | Gap | Type | Evidence |
|----|----------|-----|------|----------|
| **P0-1** | Blocker for real use | Sender is a `@gmail.com` address; domain authentication impossible, deliverability of every account mail at risk | **External** (domain + DNS + SendGrid) | §4 |
| **P0-2** | Blocker for real use | SendGrid account state unknown: sender verification, authenticated domain, suppressions, click tracking | **External** (dashboard check, 10 min) | §1, key lacks read scopes |
| **P1-1** | High | Verification attempts never reset on resend → account locked forever | **Code** | `server.py:1277-1300`, probe |
| **P1-2** | High | Account-mail failures are invisible; sends are inline and un-retried; plaintext code/link logged when unconfigured | **Code** | §7 |
| **P1-3** | High | Rotate the SendGrid key that was pasted in chat; keep scope `mail.send` only | **External** (you) | SEC-003 |
| **P2-1** | Medium | Event webhook for bounce/block/spam/dropped + a suppression table, so bad addresses stop being mailed and failures are visible | **Code + external** (public HTTPS URL, signed webhook key) | §7 |
| **P2-2** | Medium | HTML-escape `me.name` in the recipient email; add a global hourly cap for recipient mails | **Code** | `scheduling_api.py:171` |
| **P2-3** | Medium | Disable click/open tracking per message for transactional mail; add categories and `X-Message-Id` capture | **Code** | I-2, I-3 |
| **P2-4** | Medium | "Password changed" / "Signed out everywhere" notification emails | **Code** | §6 |
| **P3-1** | Low | Equalize timing in register/forgot (send in a background task, same work on both paths) | **Code** | §5 |
| **P3-2** | Low | Strip the token from the reset URL after load; no-referrer on that page | **Code** (frontend) | §8 |
| **P3-3** | Low | Hash verification codes (same scheme as report recipients); needs the auth tests to stop reading codes from the DB | **Code + tests** | §5 |
| **P3-4** | Low | README email section and `.env.production.example` still describe SMTP only | **Docs** | §2 |

---

## 11. Exact settings, permissions, variables and records

**SendGrid account (your access):**

- Settings → **Sender Authentication** → *Authenticate Your Domain* for the domain you will send from; add the CNAMEs SendGrid shows; click *Verify*.
- Settings → **API Keys**: one key for this app, **Restricted Access** with only `Mail Send → Full Access` (today's key already has `mail.send` and `sender_verification_eligible`). Create a *new* key, store it with `python backend/local_secrets.py set SENDGRID_API_KEY`, then delete the old one. For the webhook work below, no extra key scope is needed (the webhook is inbound).
- Settings → **Tracking**: Click Tracking **off** (or confirm it is off), Open Tracking off. Also set per message in code (P2-3).
- Settings → **Mail Settings**: leave footer/bypass settings off.
- Settings → **Mail Settings → Event Webhook** (only for P2-1): HTTP POST to `https://<your-api-host>/api/webhooks/sendgrid`, events *Delivered, Bounced, Dropped, Deferred, Spam Report, Unsubscribe*, **Signed Event Webhook ON**; SendGrid shows the *verification public key* (from SendGrid) → store as `SENDGRID_WEBHOOK_PUBLIC_KEY`.
- Check the plan's sending limit against expected signups and reports.

**Environment (names only; secrets in the encrypted store, not `.env`):**

| Variable | Where | Value |
|----------|-------|-------|
| `SENDGRID_API_KEY` | secrets store | `SG.<from SendGrid>` |
| `SENDGRID_FROM_EMAIL` | `.env` | `no-reply@<yourdomain>` (the authenticated domain) |
| `SENDGRID_EU` | `.env` | `true` only for an EU-pinned account |
| `SMTP_FROM_NAME` | `.env` | display name, e.g. `Life Record` |
| `FRONTEND_URL` | `.env` | the real **https** URL (reset links; also turns on `Secure` cookies) |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | secrets store | from SendGrid, only with P2-1 |
| `SENDGRID_REPLY_TO` | `.env` | optional, a mailbox you read |

**DNS:** see §4 (three CNAMEs + `_dmarc` TXT, values from SendGrid).

---

## 12. Implementation and test checklist

**Needs you (access/approval), in order**

- [ ] Choose/buy the sending domain; give DNS access or add the records yourself (P0-1).
- [ ] Authenticate the domain in SendGrid and click *Verify* (P0-1).
- [ ] Check SendGrid → Tracking (click/open off), Suppressions (bounces, blocks), Activity feed, Sender list, API-key list (P0-2).
- [ ] Create the new restricted API key; store it with `local_secrets.py set SENDGRID_API_KEY`; delete the old key (P1-3).
- [ ] Approve sending **one** test mail to each of a Gmail and an Outlook inbox you own, then read the original headers for `spf/dkim/dmarc=pass` (needs your say-so: this audit sent none).
- [ ] Decide if you want bounce/spam handling (P2-1); it needs a public HTTPS URL for the webhook.

**Code (after you authorize email changes)**

1. [ ] P1-1: reset `verification_attempts` on resend; test: 5 wrong codes → resend → correct code verifies.
2. [ ] P1-2: send account mail from a background task with 2 retries on 429/5xx/timeout; record outcome (new `email_events` table: purpose, hash of recipient, status, SendGrid message id); never log bodies; return a neutral message to the client but show a "we could not send, try again" state when the provider is down and the account exists; stop the console fallback from printing codes and links unless `ENV=development`.
3. [ ] P2-2: `html.escape` the name in the recipient email; add a per-hour global cap and a test with `<a href=…>` in the name.
4. [ ] P2-3: `tracking_settings` off, `categories`, capture `X-Message-Id`.
5. [ ] P2-4: password-changed and signed-out-everywhere notifications.
6. [ ] P2-1 (if approved): `POST /api/webhooks/sendgrid` verifying the ECDSA signature (`X-Twilio-Email-Event-Webhook-Signature`/`-Timestamp`), storing bounces/blocks/spam reports in `email_suppressions`, and skipping suppressed addresses in `deliver`.
7. [ ] P3 items.

**Tests to write with each item:** provider receives the right recipient/subject/link (fake transport); failure → retry → visible state; expired/reused code; escaping; webhook signature good/bad/replayed; suppressed address is not sent; and the manual end-to-end in §9.7. Keep the rule that automated tests never mail real or reserved domains.

---

## 13. Conclusion

The **code** for sending mail through SendGrid is sound and honestly reports failures for scheduled reports. The **account-verification path** around it has one real bug that locks users out (P1-1) and does not surface delivery failures (P1-2). The **deployment side** (domain, DNS, SendGrid account state) is unproven and, with a `@gmail.com` sender, very likely unreliable. Until a domain is authenticated and a real send has been inspected, email verification and delivery stay **Not Completed** in the roadmap.

---

## 14. Update: fixes implemented (2026-10-29, after the owner authorized email changes)

The owner asked for the `tiagosa743@gmail.com` sender for now, SendGrid's **SMTP relay** as the transport, and working email without errors. Done:

| Audit item | Result |
|------------|--------|
| P1-1 verification lock-out | **Fixed**: a resent code resets the attempt counter (`server.py` resend). Test: 5 wrong codes → resend → new code verifies (`test_email_flows.py`). |
| P1-2 invisible failures, inline sends, no retries, plaintext logging | **Fixed**: emails are sent after the response with up to 3 tries on temporary failures; every outcome is stored in `email_events` (hash + domain, never the address); with no provider nothing is logged unless `EMAIL_LOG_BODIES=true`; SMTP errors map to clear messages (wrong key, unverified sender, refused recipient, temporary trouble). |
| P2-2 unescaped name | **Fixed**: escaped in the recipient-confirmation email (the global hourly cap is still open). |
| P2-3 tracking/categories | **Fixed** for SMTP (`X-SMTPAPI`: click/open tracking off, category) and for the HTTP API payload. |
| P2-4 security notices | **Added**: "password changed", "password reset", "signed out everywhere" emails. |
| P3-1 timing | **Improved**: sending no longer affects response time; registering an existing address does the same hashing work as a new signup. Forgot-password still does one extra DB write for known accounts. |
| Transport | `EMAIL_PROVIDER=smtp`, `smtp.sendgrid.net:587`, user `apikey`, password = the SendGrid API key (copied inside the encrypted store as `SMTP_PASSWORD`). |

**Real send:** one test message to `tiagosa743@gmail.com` was accepted by SendGrid's relay on the first attempt (so the key is valid and SendGrid accepts the sender address). It did **not** appear in the inbox, archive or trash when searched through the Gmail connector (which cannot see Spam). Acceptance is not delivery: the owner must look in Spam and in SendGrid → Email Activity. This is the `@gmail.com`-sender risk from §4; the permanent fix is an authenticated domain (P0-1), which remains **not done**.

Still open from this audit: P0-1 (domain), P0-2 (dashboard check), P1-3 (rotate the key), P2-1 (bounce webhook), P3-2/P3-3.
