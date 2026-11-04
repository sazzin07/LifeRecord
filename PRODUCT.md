# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Today: the owner, as the only active user during local development. At launch: everyone, on a separate public domain, each with an independent account. The app is built multi-user from the start: every data row belongs to one account, and the AI assistant runs under the authenticated user's context only.

## Product Purpose

Life Record is a private personal life-management application. It unifies personal and shared finance, groceries, nutrition, fitness, body and weight tracking, tasks, calendar, and an AI assistant that turns natural language, voice, or receipt photos into structured, connected data. Success means one place where a person's daily life records stay consistent with each other.

## Positioning

Connected data from one input: a sentence, a voice note or a receipt photo becomes linked finance, grocery, nutrition and task records in the same account, not separate apps that never talk to each other.

## Operating Context

- Runs locally on Windows for now via `start-all.ps1` (MariaDB/MySQL, FastAPI backend, React frontend, phpMyAdmin).
- Public launch is planned on a separate domain once the app is finished; deployment is not yet scheduled.
- Voice transcription and receipt scanning use Gemini; chat uses OpenCode Go or Gemini. Both run server-side only.

## Capabilities and Constraints

- Modules: finance (personal and shared accounts, transactions, categories, people), groceries and price records, nutrition (meals, recipes), fitness (workouts), body and weight entries, progress photos, tasks, calendar, AI assistant.
- Auth: JWT access tokens, refresh token in an HttpOnly cookie, bcrypt password hashes; email verification and password reset via SendGrid SMTP when configured.
- Storage is the local filesystem for progress photos.
- Multi-user isolation is a hard constraint: no query or AI tool call may cross account boundaries.

## Brand Commitments

- Name: "Life Record" is final.

## Evidence on Hand

- Working application code in `backend/` and `frontend/`.
- Existing visual material: `design_guidelines.json` and `Design Inspiration/`. These are recorded as files only; their visual direction is not confirmed here.
- No public customers, testimonials, benchmarks, or launch-date claims exist yet; future work must not invent them.

## Product Principles

- One account owns its data exclusively; isolation outranks convenience.
- Natural input (text, voice, photo) should produce structured records the user can review.
- Local-first development now; the same product must work unchanged when it goes public.

## Open Decisions

- Public domain name and hosting: undecided.
- Public-launch timing: undecided.
- Visual direction for the public launch: undecided (to be decided in a later new-work pass, not here).
