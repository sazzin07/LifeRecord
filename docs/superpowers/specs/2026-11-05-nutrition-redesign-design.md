# Nutrition page redesign: design

Date: 2026-11-05. Status: approved by the owner (direction, look and scope chosen from five interactive mockups, `.superpowers/brainstorm/`, not committed).

## Intent
The owner's first moves on the page are to record a meal, add water, or see the whole nutrition picture, in a clean, easy-to-reach interface. The redesign turns the page into one distinctive, art-directed experience (the "Hybrid / Lumen" direction) while every existing capability stays.

## Decisions (the owner's)
- **Direction:** Hybrid. A sticky left panel (desktop) holding the nested-ring "orb" (energy outside; protein, carbs, fat inside) with the remaining calories as the hero figure, the macro chips and a one-tap water row. On the right: an always-on quick-log bar (search, scan, recipe), then the views, switched by a sliding-indicator control. On a phone the panel is the top block and the views follow.
- **Borrowed:** Atlas's replay of the day and its nutrient "constellation" in the Levels view; Daybreak's cumulative-energy curve against pace in the Today view.
- **Look:** the Purple Main Theme's palette, light and dark tokens, pill controls and the dock; the page has its own layout, scale, charts and motion. Macro colours are data colours (protein violet, carbs amber, fat rose, water blue).
- **Scope:** every area stays reachable and is restyled to match: Today, Plan, Nutrients (Levels), Trends (Week), Foods (with recipes) and Goals. Today is built first and most fully.

## Goals
- Daily energy, target and remaining at a glance; macros, water and the meal log one gesture away; levels sorted lowest first; a week that can be scrubbed.
- Charts that are original and legible: nested rings, a day replay, a nutrient constellation, a pace curve, a scrubbable week.
- Motion that tells the story: reveals on entry, rings that draw, a replay of the day, a sliding view indicator; all off for `prefers-reduced-motion` and the Animations setting.

## Non-goals and anti-goals
- No backend, API, data-model or business-rule change. No new dependencies. No feature removed or silently replaced.
- No decorative clutter, no glass without a purpose, no repeated card grids as the page structure.

## Constraints
- Frontend only: reuse `useFetch` data (`/nutrition/day`, `/nutrition/insights`, `/nutrition/trends`, plan, foods, goals) and the existing dialogs, undo behaviour, copy-yesterday, drinks, add/edit/duplicate/move/delete, barcode scan, recipes, suggestions and the assistant hooks.
- The tab and the day stay in the address (`?tab=...&date=...`); test ids that tests rely on are kept.
- Skeletons mirror the real layout (the fidelity test); light and dark; phone, tablet and desktop; axe clean; visible focus; targets of at least 44px on a phone.
- No uppercase text; figures tabular; gain/spend/limit meanings follow the theme (green/rose/amber with words), nutrient status always with a word.

## Left to the builder
- The exact radii and ring widths, the replay speed control, how the curve handles days with no entries, and the empty, loading and error states, each mirroring the real layout.
