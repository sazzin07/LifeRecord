# Failure sweep (roadmap S-13)

What a person sees when something breaks. Rule: a plain sentence they can act on; never a stack trace, a SQL fragment,
a file path or a provider's raw message; and the browser must be able to read it.

Last run: 2026-11-01 on a scratch stack (`backend/tests/isolated_env.py`), no live model, no real mail.

| # | Failure | What happens | Evidence |
|---|---|---|---|
| 1 | Backend not running | The page shows the amber "Offline / fallback mode" banner with the last data it had; changes are not queued (F-10: declared a non-goal pending the owner). | `frontend/e2e/failure-sweep.spec.js` ("backend down"), banner in `AppShell.jsx` |
| 2 | Database not reachable | `503` `{"detail": "The database is not reachable right now. Please try again in a moment."}`; the detail is logged server-side only; CORS headers are present so the page can show it. **Before this sweep** an unhandled error was `500 text/plain "Internal Server Error"`. | `test_failure_handling.py::test_a_database_that_cannot_be_reached_says_so_and_leaks_nothing` |
| 3 | Any other unexpected error | `500` `{"detail": "Something went wrong on our side. Please try again in a moment."}`; traceback in the log only; CORS headers present. | `test_failure_handling.py::test_an_unexpected_error_is_a_plain_json_sentence_with_cors_and_no_internals` |
| 4 | Model quota exhausted / provider busy | The provider's `429` is retried once, then reported as "The AI usage limit for this plan has been reached for now (5-hour, weekly or monthly). Try again later."; other provider trouble is "The assistant is busy right now. Please try again in a moment." The panel shows it with a "Try again" button. Our own per-person limits answer with their own `429` text (README, "Usage limits"). | `test_ai_opencode.py::test_rate_limit_is_retried_once_then_reported`; `test_usage_limits.py`; `frontend/src/lib/aiStream.test.js` |
| 5 | SMTP / email provider failure | Wrong key, unverified sender, refused recipient, temporary trouble and timeouts each map to a specific message and retry rules; account flows never fail the person's request (mail is sent in the background and logged in `email_events`). | `test_email_smtp.py` (11 tests), `test_email_flows.py` |
| 6 | Session expired | API: `401 "Token expired"`; the app refreshes silently from the HttpOnly cookie and retries once; if that fails it returns to the sign-in page. | `test_failure_handling.py::test_an_expired_session_says_so`; `frontend/e2e/session-cookie.spec.js` |
| 7 | Stale edit (409) | Diary entries carry `if_updated_at`; an edit made on an old copy is refused with a message instead of overwriting. | `test_nutrition_api.py::test_retried_requests_and_concurrent_edits_are_handled` |
| 8 | Upload too large | `413` with the limit in the text ("File too large (max 10 MB)"); nothing is stored. Pictures in chats and photos share the limit. | `test_failure_handling.py::test_a_picture_that_is_too_big_is_refused_with_the_size_limit_and_nothing_is_stored`; `test_chat_images.py::test_files_that_are_not_images_or_are_too_big_are_refused_and_nothing_is_saved` |
| 9 | Too many requests | `429` with a plain message and `Retry-After`. | `test_usage_limits.py`, `test_session_security.py` |

## Known gaps (not failures of this sweep)

- `GET /api/health` answers `200` even when the database is down; it proves the process is up, not that it can work.
  A readiness check that touches the database belongs with the deployment work (S-09), where a load balancer needs it.
- Mutations made while offline are not queued (F-10, an owner decision).
