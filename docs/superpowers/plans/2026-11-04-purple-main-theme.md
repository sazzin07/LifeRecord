# Purple Main Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Every page, component, state and mode of the app looks and behaves as `docs/design-system/PURPLE_MAIN_THEME.md` describes, in light and dark, with no business-logic change.

**Architecture:** The theme is three CSS layers switched by the `dark` class (global tokens in `index.css`, the Money/Settings/Profile scope in `theme/orchid.css`, the People scope in `index.css`) plus token-driven shared components. The spec embeds the verbatim source of that layer (§K.5, §K.8); this plan installs it, merges it with the code added since the spec's base commit (5f93dc8), then audits every page for literals and old classes.

**Tech Stack:** React 19 (CRA/craco), Tailwind 3 (`darkMode: ["class"]`), tailwindcss-animate, Radix/shadcn wrappers, Framer Motion, Recharts, Sonner. No new dependencies.

**Spec:** `docs/design-system/PURPLE_MAIN_THEME.md` (copied from the worktree branch `worktree-polymorphic-petting-wall`, where it was written). The orange Home spec is out of scope and is not copied.

## Global Constraints

- Values come from the spec unchanged: token names, hex/HSL, radii, durations, easing, shadow stacks.
- Surfaces, borders, text, shadows read CSS variables. A literal is allowed only for data colours, fixed art (logo/avatar gradient, selected-pill ends), Settings theme-preview tiles, and `bg-black/50` photo captions (spec §K.6.4), each with a comment.
- Gain = `--mny-green`, spend = `--mny-neg`, locked = `--mny-amber`, always with a sign/icon/word. `emerald-*`/`teal-*` classes stay (they render orchid); anything that means success/gain/warning is written `green-*`/`red-*`/`amber-*`.
- Visual change only: no routes, API calls, permissions, copy or data flow change. Test assertions are not edited; only selectors that the restyle changes.
- Every animation has a `prefers-reduced-motion` and `.no-anim` override. No theme-switch transition.
- Text ≥ 4.5:1 (large ≥ 3:1) in both themes. Phone targets ≥ 44px. No horizontal page scroll.
- Not done in this plan, by instruction: committing (the owner asks), the orange Home theme.

## Review Focus

- A `text-emerald-*` that meant "gain" turns orchid: check Nutrition/Fitness/Body/Groceries for positive/success text and move those to `green-*`.
- Portal dialogs (Money's five `mny-dialog` dialogs) are outside `.mny-theme`: their `--mny-*`/`--mx-*` variables and pill/field rules must still resolve.
- The skeleton placeholders must keep matching the real markup (`e2e/skeleton-fidelity.spec.js`): new radii/padding must not move a card.
- Recharts takes colours from `var(--chart-*)`: a leftover `#10B981` stroke would be green on a plum page.
- First paint: `public/theme-init.js` must apply a saved light choice before React so a light user never sees dark.

---

### Task 1: Spec in the repo, baseline

**Files:**
- Create: `docs/design-system/PURPLE_MAIN_THEME.md`

- [x] Copy the spec to `docs/design-system/PURPLE_MAIN_THEME.md` (done; the orange spec is not copied).
- [x] Extract the embedded source blocks (§K.5, §K.8) to a scratch folder and compare with the worktree and main (24 files identical to the worktree's token-driven components; `index.css`, `tailwind.config.js`, `orchid.css`, `AppShell.jsx` differ because the worktree has since moved to an orange look, so the spec text is the purple source).
- [x] Record the baseline: `yarn build` warnings on the untouched tree; unit tests green.

### Task 2: Tokens, stylesheet, Tailwind, fonts, theme-init

**Files:**
- Modify: `frontend/tailwind.config.js`, `frontend/src/index.css`, `frontend/src/index.js`, `frontend/public/index.html`
- Create: `frontend/src/theme/orchid.css`, `frontend/public/theme-init.js`

**Interfaces:**
- Produces: the variables of spec §B (`--line`, `--field`, `--card-fill`, `--cta`, `--pill`, `--chart-*`, `--haze`, `--mny-*`, `--mx-*`) and the classes `.glass`, `.card-ambient`, `.cta-fill`, `.pill-fill`, `.skeleton`, `.mx-*`.

- [x] `tailwind.config.js` and `theme/orchid.css` and `theme-init.js`: the spec's text unchanged.
- [x] `index.css`: three-way merge (base 5f93dc8, ours main, theirs spec). Keep this repo's later additions: `.stat-num` in the `[data-skeleton]` rules and `[data-skeleton] { --sk-ink }`. Drop the `.mny-dialog` surface/token block (superseded: see Task 5).
- [x] `index.html`: `class="dark"` fallback, `theme-color #0c0a0e`, `theme-init.js` in `<head>`, Plus Jakarta Sans 600 link. `index.js`: import `orchid.css` after `index.css`.
- [x] Verify: dev server compiles; computed `--background`, `--primary`, `--ring`, `--cta` equal the spec table in both modes.

### Task 3: Shared components

**Files:** Modify `frontend/src/components/ui/{button,input,textarea,select,tabs,card,dialog,alert-dialog,sheet,popover,dropdown-menu,context-menu,hover-card,sonner}.jsx`.

- [x] Replace with the spec's source; `dialog.jsx` is a three-way merge that keeps the focus-return behaviour added after the base. `context-menu.jsx` and `hover-card.jsx` are not embedded in the spec: apply §E.6 (`rounded-2xl border-line bg-popover p-1.5 shadow-[var(--pop-shadow)]`) by hand.
- [x] Verify: components render with tokens only (grep for literals in `components/ui`).

### Task 4: App shell and assistant

**Files:** Modify `AppShell.jsx`, `QuickAddFab.jsx`, `AIAssistant.jsx`, `ai/{ChatSidebar,Composer,Message}.jsx`.

- [x] `AppShell.jsx`: three-way merge (keeps the recurring notice and the main-currency sync).
- [x] Assistant per spec §E.6: scrim `bg-scrim`, panel `glass-strong border-line` with the primary corner glow and `--pop-shadow`, rail `border-line bg-field`, chips `rounded-2xl border-line bg-field hover:bg-hover`, send/New chat `cta-fill`, user bubble `pill-fill`, avatar gradient `#e2b6ea → #a679b2` with ink `#2a1433`.

### Task 5: Pages and portal dialogs

**Files:** the pages and dialogs with literals or semantic emerald (list produced by the audit), the five `mny-dialog` dialogs.

- [x] Money dialogs: `className="mny-theme mny-dialog …"`; one rule `.mny-theme.mny-dialog` keeps the dialog at the shared radius and hairline.
- [x] Charts: Body, Groceries, Nutrition Trends, Money, Fitness strokes/fills from `var(--chart-line)`, `var(--chart-line-soft)`, tooltip from `--tip-*`; Settings theme previews use the plum palettes.
- [x] Semantic emerald → green; remaining hex literals justified or replaced; Home, People, Login/Sign-up/Forgot/Reset checked against §K.5d.

### Task 6: Verification

- [x] `yarn build` with no new warnings; bundle budget check; `craco test` unit tests.
- [x] Playwright: skeleton-fidelity, a11y suites, keyboard-motion, quick-add-fab, and the specs for every page; fix only selectors.
- [x] axe contrast on every page, light and dark, at 390 / 768 / 1280 widths; screenshots of every page in both modes.
- [x] Leftover search: old greens/teals/oranges, `rounded-xl` controls, `Inter`-only fonts, hard shadows.
- [x] Docs: `PRODUCT.md`, README, roadmap D-11, `design_guidelines.json`; memory note. Not committed (the owner asks).
