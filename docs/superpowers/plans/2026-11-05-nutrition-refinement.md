# Nutrition Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the work shares one dev stack and one `frontend/src` tree, so it runs inline, not in parallel subagents). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Nutrition page's layout flexible and overlap-free, every control real and distinct, the date picker minimal and fluid, the nutrient circles and tiles interactive, the text lighter, and every tab cohesive. Frontend only.

**Architecture:** One tab-aware shell (`Nutrition.jsx`) owns the day panel: a flexible sticky column from 1024 px on the tabs that look at one day (Today, Nutrients, Trends, Foods), none on Plan and Goals, and a slim sticky strip with a bottom sheet below 1024 px. Shared pieces are new and small: `InfoTip` (secondary text behind an ⓘ), the redesigned `Calendar`/`DatePicker`, `NutrientTable` (grouped tiles, used by Nutrients and Trends). Rings and tiles share one readout idea: hover or tap names the nutrient and its value without a floating box.

**Tech Stack:** React 18 (CRA/craco), Tailwind, framer-motion 11, date-fns 4, Radix popover/dialog, Playwright (isolated stack).

**Spec:** the brief in the 2026-11-05 conversation ("Refine and Complete the Nutrition Page UX/UI") and the owner's answers: panel hidden on Plan and Goals; slim strip + sheet below 1024 px; interactive orb rings plus uniquely shaped nutrient tiles grouped by kind; Nutrient Density as a nutrient-first view with real sources; the shared date picker redesigned; safety caveats shortened and moved behind ⓘ; the duplicate header "Assistant" removed; disabled Plan buttons say why. Earlier design records: `docs/superpowers/specs/2026-11-05-nutrition-redesign-design.md`, `docs/design-system/PURPLE_MAIN_THEME.md`.

## Global Constraints

- No backend, API, model or data-contract change. Reuse `/nutrition/day|trends|patterns|contributors|rich-in|insights`.
- Purple Main Theme tokens only (`pill-fill`, `bg-field`, `border-line`, `card-ambient`, `--chart-*`); no uppercase labels; green = good/in-range, amber = below/watch, red = over; `emerald/teal/slate` classes are legacy ramps and stay.
- Visible text must be contained in the accessible name (WCAG 2.5.3). Keyboard reachable, focus rings kept, `prefers-reduced-motion` and the app's animations setting respected (`useSettings().animations`).
- Skeleton fidelity: placeholders mirror real markup (`data-skeleton`, `sk-ph`); the fidelity test compares `main .card-ambient` boxes.
- Test ids kept where they still mean the same thing: `day-ledger`, `orb`, `energy-left`, `chip-*`, `day-prev|next|today|label`, `tab-*`, `view-*`, `range-*`, `nutrient-search`, `nutrient-filter-*`, `quick-add*`, `water-*`, `plan-*`, `goal-*`.
- Never leave data on the test account; use `freshUserPage`. Do not edit `frontend/src` while Playwright runs.

## Review Focus

- A six- or seven-digit energy figure ("12,345") and a negative remainder must stay inside the inner ring at every orb size.
- A 1280x720 laptop: the sticky panel is taller than the viewport and must scroll inside itself, never get clipped.
- Switching Today to Plan to Foods quickly must not leave a half-hidden panel or a stuck width.
- A touch tap on a ring or tile must select without also jumping away; tapping elsewhere clears it.
- Density with a range that has no contributors or no rich-in foods says so, never an empty box.

---

### Task 1: InfoTip and the new Calendar/DatePicker

**Files:** Create `frontend/src/components/InfoTip.jsx`; rewrite `frontend/src/components/ui/calendar.jsx` and `frontend/src/components/ui/date-picker.jsx`.

**Interfaces:**
- Produces `InfoTip({ label?: string, children, className? })`: an ⓘ button (`aria-label` = label, default "More about this"); hover or focus or tap opens a small popover with `children`.
- Produces `Calendar({ selected?: Date, onSelect(date), defaultMonth?: Date, today?: Date })` (single mode; Monday first; keyboard grid; month and year jump) and `DatePicker` with the same props as today (`value, onChange, placeholder, presets, clearable, className, disabled, aria-label, id`).

- [ ] Write the failing spec `e2e/date-picker.spec.js`: open the Nutrition day picker; the dialog shows the month name and weekday letters; "Next month" and "Previous month" change the heading; clicking the heading opens a month grid; choosing a month returns to days; ArrowRight/ArrowDown/PageDown move focus; Enter selects, closes the popover and changes `day-label`/URL `date`; the selected day has `aria-selected="true"`, today has `aria-current="date"`; Escape closes and returns focus to the trigger.
- [ ] Implement the calendar (date-fns only, no react-day-picker): 7x6 grid with blank outside days, 36 px cells, selected = `pill-fill` circle, today = ring, hover = `bg-field`; month slide + fade (direction aware) via framer-motion, none when reduced; popover grows from the trigger (existing Radix animate-in classes). Footer: "Today" and, when `clearable`, "Clear".
- [ ] Run the spec until it passes; confirm the other DatePicker users still open (Tasks, Body, Groceries, QuickAdd, ScheduleFields, ExpenseDialog, EditExpenseDialog, WorkoutDialog, ReceiptReview) with `pages-smooth` and `a11y-pages`.

### Task 2: The tab-aware day panel, DayStrip and the shell

**Files:** Modify `frontend/src/pages/Nutrition.jsx`; create `frontend/src/pages/nutrition/DayPanel.jsx` (panel body: day navigation, orb, chips, water, empty state), `frontend/src/pages/nutrition/DayStrip.jsx` (slim strip + bottom sheet).

**Interfaces:**
- Consumes `NutritionOrb`, `MacroChips`, `QuickWater`, `PLACEHOLDER_DAY`, `useMediaQuery("(min-width: 1024px)")`.
- Produces `PANEL_TABS = new Set(["today","nutrients","trends","foods"])`; `DayPanel({ day, loading, date, today, go, openAdd })`; `DayStrip({ day, loading, date, today, go, openAdd })`.

- [ ] Write the failing spec `e2e/nutrition-layout.spec.js` ("the panel follows the tab"): at 1440x900 `day-ledger` is visible on today, nutrients, trends, foods and absent on plan and goals; on those four its box stays in the viewport while the page scrolls (sticky) and never intersects the content column; at 1280x720 the panel scrolls inside itself (its `scrollHeight` may exceed `clientHeight`, its bottom never exceeds the viewport); at 820 and 390 there is a `day-strip` (sticky under the header) and no `orb` until the strip is pressed, which opens a sheet containing `orb`, `chip-*`, the water row, and closes with Escape; no horizontal overflow at 390/820/1024/1440.
- [ ] Implement: grid column `clamp(17rem, 24vw, 22rem)` from 1024 px; on tabs outside `PANEL_TABS` the column and gap animate to 0 (opacity and `inert` too), 0.35 s expo ease, none when reduced; tab content cross-fades in (8 px rise). Panel `lg:sticky lg:top-24 lg:max-h-[calc(100svh-7rem)] lg:overflow-y-auto` with a hidden scrollbar. Remove the header "Assistant" button and the subtitle sentence. Orb width follows the viewport height.
- [ ] Day navigation becomes one pill: previous, the picker trigger (flat, centred), next; "Today" chip only when another day is shown.
- [ ] Run the spec until it passes; update `nutrition-redesign.spec.js` ("beside Nutrients and Trends" now also Foods; Plan and Goals hide it).

### Task 3: The orb (no overlap, interactive rings)

**Files:** Modify `frontend/src/pages/nutrition/Orb.jsx`, `frontend/src/index.css` (one small rule for the container-scaled figure).

**Interfaces:** `NutritionOrb({ day, loading, active, onActive })` and `MacroChips({ day, loading, active, onActive })` where `active` is `null | "energy" | "protein_g" | "carbs_available_g" | "fat_g"`; `DayPanel` holds the state so a chip and a ring light each other.

- [ ] Write failing tests in `nutrition-layout.spec.js`: for 4-, 5- and 6-digit remainders (log enough food through the API) the `energy-left` box lies inside the inner free circle; hovering a ring shows its name and value in the centre (`orb-readout`), the other rings dim; leaving restores the remainder; keyboard focus on a ring shows the same; on a touch context a tap pins it, a tap on the centre or outside clears it, Escape clears.
- [ ] Re-cut the geometry (energy r148/w12, protein r130/w10, carbs r114/w10, fat r98/w10; free inner radius about 89 units) and size the figure from the digit count in container-query units with a rem fallback; the label wraps inside the inner circle.
- [ ] Rings become focusable groups with a wider invisible hit stroke; active ring thickens, others fade to 0.4; the centre cross-fades between the remainder and the ring readout (`name / value unit / of target · percent · status`). Replay ignores hover.

### Task 4: NutrientTable and the Nutrients tab

**Files:** Create `frontend/src/pages/nutrition/NutrientTable.jsx` (replaces `Constellation.jsx`, which is deleted); modify `NutrientsTab.jsx`, `shared.jsx` (`Coverage`, `UpperLevelBanner`).

**Interfaces:** `NutrientTable({ items, onPick, match?, readout? })` where `items` are `{ key, name, unit, group, p, intake }` as built in `NutrientsTab`; groups render as labelled blocks (Macros, Fats, Vitamins, Minerals, Other); each tile shows a symbol (chemical symbol for minerals, letter for vitamins, short code for macros) and fills from the bottom to its share of the reference; `match(item) -> boolean` dims the rest; a readout line above names the hovered, focused or tapped nutrient with value, percent and status. Mouse click picks (hands over to the list); touch first tap selects and the readout offers "Details".

- [ ] Write failing tests: every nutrient has a tile with its full name in its accessible name; hovering shows `table-readout` with name, value and percent; a mouse click opens that nutrient's row in the list; on touch the first tap shows the readout without opening the row; the filter pills dim non-matching tiles; the removed "Reading this page" card is gone and an ⓘ holds its words; partial-data dots appear only when an entry lacks the value.
- [ ] Implement; compact `UpperLevelBanner` to one line plus ⓘ; shorten row `Details` (sources, rich foods, short partial-data note).

### Task 5: Trends (Averages, Patterns, Density)

**Files:** Create `frontend/src/pages/nutrition/WeekBars.jsx`, `frontend/src/pages/nutrition/DensityView.jsx`; modify `TrendsTab.jsx`, `PatternsView.jsx`.

**Interfaces:** `WeekBars({ series, target, bucket })` (scrubbable SVG bars, dashed reference, readout line, no label on the bars); `DensityView({ rows, foods, start, end, onLog })`; `PatternsView({ view, days, date, onLog })` shows insights only for `patterns` and only non-`density-*` ids, and delegates `density` to `DensityView`.

- [ ] Write failing tests: Averages shows stat tiles, the bars (hover reads the day) and the grouped table of the average day (reusing `NutrientTable`) with the long list behind "All values"; Patterns has no density insight lines; Density has no Insights list, ranks nutrients by ratio on a diverging bar, puts unreliable ones under "Not enough data", and selecting a nutrient shows "Your sources in this period" (from `/nutrition/contributors`) and "Foods rich in it" (from `/nutrition/rich-in`, with a log button that opens the add dialog) or an honest empty line.
- [ ] Implement; move each footnote and the period sentence behind ⓘ.

### Task 6: Plan, Foods, Goals

**Files:** Modify `PlanTab.jsx`, `FoodsTab.jsx`, `GoalsTab.jsx`, `Reminders.jsx`.

- [ ] Plan: a week rail (seven compact day tiles with a fill for planned energy, today marked; press scrolls to and highlights that day); the explainer becomes ⓘ; one empty hint instead of an empty card; "Copy to next week" and "Shopping list" disabled with a visible reason; day cards lose chrome.
- [ ] Goals: targets grouped by kind in collapsible sections (Energy and macros, Fats, Vitamins, Minerals); row = name, value, edit, reset; reference kind and source live in the edit dialog and a row tooltip; upper level stays as a short chip; "About you" and Reminders get a quieter layout and shorter copy.
- [ ] Foods: shorter copy (database blurb behind ⓘ), compact empty states, same card language.
- [ ] Update `nutrition.spec.js`, `nutrition-plan.spec.js`, `nutrition-insights.spec.js`, `nutrition-reference.spec.js` for the changed copy and structure.

### Task 7: Today polish and the text pass

**Files:** Modify `TodayTab.jsx`, `QuickAdd.jsx`, `shared.jsx`.

- [ ] Energy-mismatch note and reference note move behind ⓘ on the macro row; the "Again, with the amount you used last time" caption becomes "Log again"; insight "why" sentences shorten ("0 of 95 mg (0%)" plus a short partial-data clause; the deficiency sentence behind ⓘ) without changing the backend.
- [ ] Hydration, quality and insights cards share the new card language; headings and spacing follow the rhythm of the other tabs.

### Task 8: Verification

- [ ] `npm run lint` and `npm run build` in `frontend/` (note the CSS budget figure).
- [ ] Targeted specs: `nutrition*.spec.js`, `date-picker`, `dock`, `a11y-pages`, `pages-smooth`, `theme`, `skeleton-fidelity`.
- [ ] Then the full browser suite once; the six AI-key specs are known to fail without keys.
- [ ] Capture the page at 1440, 1280x720, 1024, 820 and 390 in light and dark, every tab; read the screenshots for overlap, clipping and contrast.
- [ ] Update the memory file and `MEMORY.md`; commit when asked.

---

## Result (2026-11-05)

Built as planned, inline. What differs from the plan, and why:

- **Week rail and Foods tab panel**: added during review (the rail gives Plan a distinct overview; Foods now has the day panel because the brief asks for it on every tab except Plan and Goals).
- **Panel width** animates through a flex column (`width`, `margin`, `opacity`, `visibility`) instead of `grid-template-columns`, which does not interpolate `minmax()`.
- **Orb figure** is sized in container-query units from its own width and digit count; the rings were re-cut (r148/130/114/98, widths 12/10/10/10) so the free inner circle is about 89 units of the 320-unit box.
- **Food search** (`nutrition_api.search_terms`): not planned. Checking what a person or the assistant types showed that "2 eggs" found cornbread made with 2% milk and "eggs, boiled" found nothing; amounts and filler words are now ignored and a word that matches nothing is dropped from the end (backend test added).
- **Assistant**: the confirmation description for destructive nutrition tools now says to confirm in one call on the turn the user agrees; `tools/live_nutrition_probe.py` (bounded, scratch database, real key from the encrypted store, never part of the suite) checks real data changes. It needs `foods=True` in the scratch start, otherwise the assistant correctly finds nothing to log.
- Not done on purpose: the shared `confirm_token` field of `AIChatBody` is unused by the backend and the frontend (left alone: a contract field); the CSS budget (`bundle-budget.json`, main.css 20.9 kB) was not raised (measured 28.1 kB gzip after this work, 26.8 kB before it) because that is the owner's open decision.
