# Prompt for the next session (copy everything below the line)

---

Read `CLAUDE.md` (global and repo), `LAUNCH_TODO.md`, and the memory note `groceries-finishing-2026-11-08`. Then continue Life Record on branch `feature/roadmap-completion`.

**State.** The Groceries page is finished and committed (about 10 commits, not pushed). Last full results: backend 1103 passed (one load-sensitive auth test passes alone), frontend unit tests pass, browser tests pass, axe passes at three widths in both themes, live assistant probe 15 of 15. The design was re-scored 28/40 before the last round of fixes; it was not re-scored after.

**First, check the app runs.** Run `start-all.ps1` (it now applies database migrations first), open http://localhost:3000, sign in and open Groceries. Last time the page failed because the live database was behind the code and the dev server had hung. If something does not load, check `alembic current` against `alembic heads` and `logs/frontend.log`.

**Then, for Groceries only, if you want it closed for good:**
1. Re-score the design (Impeccable critique with two isolated reviewers; see `.impeccable/critique/` for the first snapshot).
2. Remaining items in `LAUNCH_TODO.md` under Groceries: the 3D room framing on a phone, Shopping row controls on a phone, hand checks on real hardware (GPU, phone, tablet, screen reader), `design-lab/` kept on purpose (untracked).
3. Owner hand checks cannot be done by you.

**Otherwise move on:** the next unticked redesign is **Fitness** (then Body, Tasks, Calendar). Follow the repo rules: brainstorm and ask first, plans in `docs/superpowers/plans/`, UI work with the impeccable skill, commit only when asked, no live-model calls unless asked.

**Traps worth remembering:** Playwright `--grep` values with `|` and no space get split by cmd on Windows (run whole files); never make a page root a `.gt` size container; do not reuse CSS class names without a grep (`gt-panel` clashed); price x quantity is the worth of stock; the live database must be migrated whenever the backend gains a migration.
