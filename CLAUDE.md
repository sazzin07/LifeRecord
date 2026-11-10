# Life Record

FastAPI + MySQL backend (`backend/`), React (CRA/craco) + Tailwind + framer-motion frontend (`frontend/`), Windows. Branch `feature/roadmap-completion`. Orchid/plum "Purple Main Theme" (`docs/design-system/PURPLE_MAIN_THEME.md`).

## Finding things (cheap first)
- "What's next / what should we do" with no task given: read `LAUNCH_TODO.md` (the ordered list of what is missing, ending in launch) and propose the first unticked item. It says what and in what order; how and style are decided with the owner then. Update it (tick, date) as items finish.
- Architecture or "where is X": use the graphify query tools on `graphify-out/` (query, path, explain). Never read `graph.json` (7.6 MB). Read `GRAPH_REPORT.md` (~14k tokens) only for broad orientation.
- Status, what is open: `APPLICATION_COMPLETION_ROADMAP.md` (~27k tokens). Grep the row you need (`^| D-`, `^| F-`); do not read it whole unless asked.
- Past decisions and traps: the memory index is already loaded; open only the note that matches the task.
- Small change: read the file directly. Do not spawn agents for what a grep answers.

## Code Reviewer (sub-agent)
- When the user says "Run Code Reviewer" (or asks for a review), delegate to the `code-reviewer` sub-agent (`.claude/agents/code-reviewer.md`, Sonnet 5.5, read-only; for a cheap quick re-check pass `model: "haiku"` on the Agent call): `Agent(subagent_type: "code-reviewer", prompt: "Run Code Reviewer.")`. No file list or context needed; it finds the changes through git. If the type is not found (session started before the file existed), tell the user a restart is needed; do not silently use a general-purpose stand-in.
- It never edits. You decide which findings are valid, fix them, and re-invoke it after significant fixes. Verify its claims against the code before acting.
- It ends each report with a baseline block: merge it by path into `.claude/review-baseline.txt` (local, untracked), unless the verdict is BLOCKED.
- Its Bash guard: `.claude/hooks/readonly-bash.js` (test: `node .claude/hooks/readonly-bash.test.js`).

## Rules
- Superpowers: brainstorm before a new feature, plans in `docs/superpowers/plans/`, specs in `docs/superpowers/specs/`, verify before claiming done. UI work uses the impeccable skill.
- Ambiguous or consequential choice: ask (short, with a recommended default). Otherwise decide and say what was decided.
- Frontend design work never changes backend, APIs or data contracts.
- Commit only when asked. End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never commit secrets, `brag-output*`, `.superpowers/`.
- Secrets live outside the repo (DPAPI, `backend/local_secrets.py`). Never print them.
- No live-model calls unless the owner asks. Bounded probes only: `tools/live_assistant_probe.py`, `tools/live_nutrition_probe.py` (`--run`, scratch DB). Browser filter: `--grep-invert "real assistant|real model|live data|real report|Saved chats"`.
- Say what you are doing in a few words when a step is long.

## Tests
- Backend: `cd backend; LR_ISOLATED=1 ./.venv/Scripts/python.exe -m pytest tests/<files> -q -p no:cacheprovider` (scratch schema, cannot reach a model; xdist is fixed at 2 workers, do not change `pytest.ini`).
- Browser: start `backend/.venv/Scripts/python.exe backend/tests/isolated_env.py serve --frontend-port 3100` (background), then from `frontend/`: `../backend/.venv/Scripts/python.exe ../backend/tests/isolated_env.py run -- npx playwright test <specs> --reporter=list > file`. Stop it by touching `$TEMP/liferecord-scratch-stack.json.stop`.
- Every `run` costs ~1.5 min startup and prints late: write the reporter to a file, wait with `until grep -q finished file; do sleep 3; done`. Batch specs; do not edit `frontend/src` during a run (dev server recompiles).
- Use `freshUserPage` for tests that write data; never leave data on the shared account. Don't run the backend suite and browser suite at once (backup-restore test races).
- Build gate: `CI=true npx craco build` (set `BUILD_PATH` to a scratch dir). Bundle budget in `frontend/bundle-budget.json`.

## Code traps
- Playwright: `locator.hover()` on an SVG ring hits its empty centre; move the mouse to a point on the ring. Strict mode: `orb svg` matches icons, use `.first()`.
- Visible text must be inside the accessible name (WCAG 2.5.3, axe `label-content-name-mismatch`): prefer sr-only text over `aria-label` that differs from the visible text.
- Skeletons mirror the real markup (`data-skeleton`, `sk-ph`); `e2e/skeleton-fidelity.spec.js` compares card boxes. Change real layout, change the placeholder.
- `inert` is `true`, not `"true"`. Never fetch with a null date.
- In bash heredocs an apostrophe can break the tool: write scripts with the Write tool.
- Do not blanket-kill processes; stop background tasks with TaskStop.
- Page CSS lives in `frontend/src/styles/*.css` and is imported by the pages that use it; shared tokens in `index.css`. Old `dark:`/slate/emerald classes stay until the owner says otherwise.
