# Groceries: port the design lab into the real app

Source of truth for look and behaviour: `design-lab/groceries/` (app.js, scene3d.js, glyphs.js, style.css) and `docs/superpowers/specs/2026-11-06-groceries-redesign-handoff.md`. Design only: **no backend, API or data-contract change** (no capacity field, no signup seeding, no new endpoints).

## Decisions (made 2026-11-06, owner said "do whatever is best")
1. **three.js**: add as an npm dependency, load with dynamic `import()` only when the Storage tab opens, in its own lazy chunk. Keep a CSS-3D (or plain list) fallback if WebGL fails. No CDN (production CSP is `script-src 'self'`).
   Measured tree-shaken size (esbuild, three 0.160, only the classes the scene uses): **126,199 B gzip**. With the scene code about 136 kB. Raise `bundle-budget.json` `lazy chunk` `gzip_largest` to the measured chunk size + 10 % and `total_gzip` by the same amount, in the same commit, with that reason in the note. Re-measure after the real build; do not guess.
2. **Food images**: keep the drawn illustrations (`glyphs.js`, 34 drawings plus category fallback). No licence, about 12 kB, one look in 3D and 2D. Real photos or glTF stay a possible later upgrade, not a blocker.

## Steps
1. **Spec check**: confirm the current endpoints and shapes in `frontend/src/pages/Groceries.jsx` and `pages/groceries/*`: `/groceries`, `/storage-locations` (name, kind, icon, sort_order), `/shopping`, `/groceries/{id}/move|consume|discard`. The lab's `loc`, `d` (days left), `low` map onto the real fields; list the mapping in the PR description.
2. **Shared pieces first**: `glyphs` as a small module (`Glyph.key/draw/url`), `styles/groceries.css` from the lab tokens (use the existing shared tokens in `index.css`, do not copy the lab's duplicates), recipe/aisle/home-space constants.
3. **Tabs**: Today (widget page), Storage, Shopping, Kitchen, with "From history" as a modal. Replace the old Overview. Keep Shopping and Kitchen logic that already talks to the API.
4. **Storage scene**: port `scene3d.js` as `GroceryScene.jsx` (lazy). Keep the event contract (pick, space incl. `null`, hover, dragstart) as props/callbacks. Closed state, click-to-close doors, drag between units.
5. **Today widgets**: order/size/hidden and focused space in `user_preferences` (confirm that endpoint's contract first; fall back to localStorage only if it cannot hold the keys, and say so).
6. **Get started**: first-run card creates spaces through the existing `POST /storage-locations`.
7. **Smoothness**: stable keys, no remounts, framer-motion `layout` for widgets, height/fade for rows; reduced motion disables it.
8. **Real actions**: Done shopping moves ticked items to stock through the existing endpoints (create or increase); Cook uses one of each ingredient through `consume`; Undo where the API allows (discard has none today: say so in the UI or soft-delay it).
9. **Skeletons** mirror the real markup (`data-skeleton`, `sk-ph`); update `e2e/skeleton-fidelity.spec.js`.
10. **Accessibility**: WCAG 2.2 AA, canvas `aria-hidden` with chips, plinth labels and the item list as the full alternative, visible text inside accessible names, axe clean.

## Verify (before saying done)
- Backend untouched: no backend test run needed beyond a smoke check; `git diff --stat backend/` must be empty.
- Browser: new spec using `freshUserPage` (get started, add food, move, open/close unit, done shopping, cook), run with the filter from CLAUDE.md; run `skeleton-fidelity` and axe specs for the page.
- Build gate: `CI=true npx craco build` with `BUILD_PATH` set to a scratch dir; compare to `bundle-budget.json`.
- Visual check at 390, 768 and 1400 px, light and dark.
- Then delete `design-lab/` (or move it out of the repo) and tick LAUNCH_TODO step 1 "Groceries" with the date.


## Status 2026-11-07 (port started; owner said go)

Owner decisions: layout saved on the server (one deliberate backend change), keep every existing feature in the new look, the assistant must reach all page data and change nearly everything the page can change, with confirm-first on risky changes (see memory `groceries-port-decisions-2026-11-07`).

**Done and verified**
- Backend: `user_layouts` table + migration `d5b7f9a1c3e4`, `GET/PUT/DELETE /layouts/groceries` (`layouts_api.py`), 13 new assistant tools in `ai_tools_groceries.py` (layout read and change, delete inventory item, edit or delete catalog product, import library, delete storage space, edit or delete appliance, edit or delete shopping list, edit or delete recurring list, put a recipe's missing ingredients on a list). Every delete or bulk add previews first and acts only on a later turn after the user agrees. Tests: `tests/test_groceries_layout_and_ai.py`; isolation matrix, export/populate and API-surface snapshot updated. Full backend suite: 1099 passed, 2 skipped.
- Frontend: new Today tab (hero, seven widgets, customise with move, resize, remove, drag, restore; focus on a space; server-saved layout), welcome and "Build my kitchen" (really creates the spaces while the animation plays), sliding tab pill (keyboard tab list), Kitchen recipe cards with plates, Ready stamp, voice line, per-serving protein and energy, and "Mix your meal" (goal plus ingredient choices combined, counts per chip, dimmed when nothing would be left). Cooking from Today asks first.
- Browser tests: `e2e/groceries-today.spec.js` (7 tests), updated `groceries.spec.js`, `skeleton-fidelity.spec.js`, `a11y-pages.spec.js`; axe clean on all five Groceries tabs, two themes, three widths.

**Stage 2, later on 2026-11-07: everything else from the prototype**
- Storage: `kitchen3d.js` (the lab's three.js room, one instance per tab, `createKitchen3D()` with `on/sync/dispose`) and `StorageStage.jsx` (canvas host, plinth labels, space chips, caption, tips, drag onto another unit, item card with use/add/move/add to list/edit/discard, space list). `three` 0.160.0 is an exact dependency (named imports, so it tree-shakes), loaded only when the Storage tab opens (lazy chunk, about 128 kB gzip). Fallbacks: the old CSS-3D scene is the "Flat view" (button, remembered in localStorage `lr-groceries-flat`); it is also used automatically when WebGL cannot start or the context is lost, and when the first frames are slower than 250 ms (the room then says it was too slow; pressing "3D room" on purpose skips that check). With reduced motion the room redraws only when something moves. Fixed on the way: the lab's see-through easing was swallowed by a comment, fog and far plane now follow the camera (the phone overview showed no units), the wall colour fills above the wall.
- Shopping: `ShoppingTab.jsx` (trip card with the budget ring, the existing `BudgetField`, Plan and In the shop modes, lists as a pill, search, category filter, Generate, Add item, select all and submit, shelves Running low / For your recipes / Bought before, recurring lists, recommendation, aisle lanes with big tap rows, route chips, basket bar and Done shopping that still goes through the existing purchase review). Ticks are optimistic and a refresh that started before a tick cannot undo it.
- Cart: `CartDock.jsx`, a button above the quick-add button on every tab except Shopping, opening the list by aisle in a sheet with steppers, remove and Done shopping.
- Catalog: now a dialog opened from the button beside the tabs (the tab is gone); the catalog code is unchanged.
- Add bar: `QuickAdd.jsx` at the top of the page (food into the open space, "buy ..." onto the list, quantities and suggestions on Shopping).
- Bundle budget reset on purpose on 2026-11-07 (see the note inside `frontend/bundle-budget.json`): lazy chunk limit 144,058 B, total 1,075,990 B, new "css chunk" role; main.js and main.css limits unchanged.
- Tests: `e2e/groceries-today.spec.js` (7), `groceries-storage.spec.js` (7), `groceries-shopping.spec.js` (8), `groceries-quickadd.spec.js` (3), `groceries.spec.js` (adapted), axe over Today, Storage, Shopping, Kitchen and the Catalog dialog in both themes at three widths, `a11y-empty-states`, `smoke`, `dock`, `keyboard-motion`, `pages-smooth`, Groceries skeleton fidelity. Storage specs run with reduced motion (headless Chromium here renders in software at about 1 frame per second) and use the chips, labels and side panel; dragging food between units goes through `itemScreenPos` on the room.

**Final review, same day (everything clicked through by tests)**
- Browser: 40 of 41 in the Groceries batch passed (Today, Storage, Shopping, add bar, groceries.spec, skeleton fidelity); the one failure is the Nutrition day-view skeleton test (see below). axe is clean on Today, Storage, Shopping, Kitchen and the Catalog dialog in light and dark at desktop, tablet and phone, and on the empty-state pages. smoke, dock, keyboard-motion and pages-smooth passed (62). Production build with `CI=true` is clean; the bundle check is within the new budget.
- Backend: full suite 1099 passed, 2 skipped, and the backup-restore test failed once (the one that had failed once before, unexplained). Cause found: the backup listed the photo files first and a parallel test deleted one before it was zipped, which aborted the whole backup. `tools/backup.py` now skips a file that vanished while it runs and records how many (`files_gone_while_running`); the test passes alone and the real backup no longer dies when someone deletes a photo during the nightly run.
- Bugs found by the new tests and fixed: saving an edited recurring list returned a server error (`server.py` called `model_dump()` on dicts; regression test added); the phone tab row did not stack (a container query on the container itself); the phone Shopping page and the Catalog dialog scrolled sideways; a tick could be undone by an older refresh.

**Left over (also in LAUNCH_TODO.md)**
1. Real GPU, phone and screen reader checks by hand; `design-lab/` kept until the owner agrees to delete it; nothing committed.
2. Mix your meal has no time filter (no cooking time on recipes); the prototype's cart that opened by itself while typing is not ported.
3. Live-model probes of the 13 assistant tools and the migration on the live database are still to do.
4. `skeleton-fidelity` Nutrition day view failed on the shared test account (not touched by this work).

## Status 2026-11-08 (finishing pass: cooking time, critique, side rail, phone and tablet)

Owner answers (2026-11-08): add the cooking-time field; keep `design-lab/` for now; commit in logical commits; run the emulated phone and tablet pass, the Impeccable critique, the Nutrition skeleton look and the live probes; fix all four critique groups; the cart is a round fixed button beside the quick-add "+" (tab row on a phone, then the whole tab selector moved to a retractable left rail with a three-bar button).

**Built and verified**
- Recipes: optional `cook_minutes` (1 to 1440). Migration `e6c8a0b2d4f1`, `RecipeBody`, create and update (a save that does not mention the time keeps it, null clears it), `_recipe_line`, `create_recipe` and `update_recipe` tools (0 or null removes it on update), `suggest_recipes_from_inventory` returns it and takes `max_minutes`. Editor field "Cook time (min)" (shared Nutrition `RecipeDialog`), shown on Kitchen cards, the Today widget and the Nutrition recipe list (`lib/cookTime.js`). Mix has an "It takes" row with "Under 20 min" (a recipe with no time is never quick; the chip dims with a reason read by screen readers when nothing qualifies). Tests: 4 backend, 5 unit (`kitchenMix.test.js`), 2 browser.
- Navigation: `groceries/Rail.jsx`. Tablet and wider: a sticky rail (icon + name, folded to icons by the three-bar button, remembered in localStorage `lr-groceries-rail`, open by default from 1024 px). Phone (under 640 px): a three-bar button in the heading opens a compact floating drawer; the heading shows the section; focus returns to the button. Vertical tab list (up, down, left, right, Home, End). Catalog is in the rail or drawer.
- Cart: `CartDock` is a panel opened by page state. From 640 px its button is a round icon portalled into `#shell-fab-slot`, a new slot beside the quick-add "+" in `QuickAddFab` (one flex row, so the "+" unfolding pushes it aside); on a phone it sits in the heading. Hidden on Shopping, as before.
- Touch: `@media (pointer: coarse)` raises buttons, pills, Mix chips, steppers, icon buttons and ticks to 44 px (ticks keep their size, the tap area is a label); desktop sizes unchanged.
- Contrast: "In stock" green-700, `--gt-green` #086944, "On your list" badge dark text on amber.
- Shopping: In the shop shows a one-line trip card and all aisles in one card; Plan rows are two lines on a narrow container; "Estimated" is said once; the progress bar has a text value; tick column aligned; basket bar leaves room for the corner "+".
- Other: add-bar hint is short on a phone; the Storage item card scrolls into view; short (landscape) screens drop the subtitle and tighten spacing; Customise shares the space-filter row on a narrow page.
- Nutrition skeleton failure: the suggestions card shows 3 ideas but its placeholder drew 6 rows; it now draws 3 rows of the real height plus the footer strip. The skeleton test's tolerances note that card and the narrower Groceries widgets.
- Assistant: `tools/live_groceries_probe.py --run` (15 calls, 15 of 15, data read back). Not a guarantee of live behaviour.
- Bundle budget: css chunk limit raised on purpose (note in `bundle-budget.json`).
- Impeccable critique snapshot: `.impeccable/critique/2026-11-08T16-58-07Z__frontend-src-pages-groceries-jsx.md` (26/40 before the fixes; the fixes were not re-scored).

**Still open** (also in LAUNCH_TODO.md): hand checks on real hardware, the later pass from the critique (3D room framing on a phone, Customise M/S labels, missing-price wording, undo for Used one and cooking, READY spectrum, Flat view names), the two live migrations, `design-lab/` kept.

