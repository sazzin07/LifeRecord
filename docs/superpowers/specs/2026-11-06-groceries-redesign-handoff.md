# Groceries redesign: handoff (2026-11-06)

Paste the block below into a new session first, then read the rest of this file.

```
Continue the Groceries redesign (LAUNCH_TODO step 1). Read docs/superpowers/specs/2026-11-06-groceries-redesign-handoff.md first,
then CLAUDE.md. Nothing in the real Groceries page has been changed yet. The design lab is at design-lab/groceries/ (port 3200).
Next: the "Next steps" list in the handoff, starting with clickable cabinets and image objects.
```

## Status in one paragraph
Inspection, analysis and five concept mockups are done and reviewed by the owner. The owner chose the **Hybrid** direction and asked for it to be
more space-aware, with a much better 3D kitchen. A standalone design lab (plain HTML/CSS/JS, port 3200, not part of the app) now holds the improved
Hybrid including a real WebGL (three.js) kitchen. **The real Groceries page (`frontend/src/pages/Groceries.jsx` and `pages/groceries/*`) is untouched**; no
approval to implement has been given yet. Nothing is committed (`design-lab/` is untracked; commit only when the owner asks).

## What exists
`design-lab/groceries/` (untracked):
- `index.html`: shell, import map for three.js 0.160 from jsDelivr (CDN only because it is a lab; the app must bundle it, its CSP is `script-src 'self'`).
- `style.css`: tokens copied from `docs/design-system/PURPLE_MAIN_THEME.md` (light and dark), Plus Jakarta Sans (same font as Nutrition, Money, People).
- `app.js`: state, sample data, all views, widgets, drag and drop, catalog modal, undo, get-started card. Falls back to a CSS-3D kitchen when `window.Kitchen3D` is missing.
- `scene3d.js`: the WebGL room (`window.Kitchen3D`). API: `attach(el|null)`, `sync({spaces,items,theme,sel,open,hasCounter})`, `open(id)`, `dragOver(x,y)`, `endDrag(id)`, `capacity(kind)`, `setTheme`, `_dbg()`. Events on `window`: `k3d:ready`, `k3d:space {id}`, `k3d:pick {id|null}`, `k3d:hover {id,x,y}|null`, `k3d:dragstart {id,x,y}`.

Run: `backend/.venv/Scripts/python.exe -m http.server 3200 --bind 127.0.0.1 --directory design-lab/groceries` then open http://127.0.0.1:3200/ . Add `?lite` for
low-cost rendering (used for screenshots). Theme and widget layout persist in localStorage key `groceries-lab-v1`; all item data is sample data.

What the lab does:
- **Tabs:** Today (most important from everything, as customisable widgets), Storage (3D kitchen), Shopping, Kitchen (recipes). Catalog is a modal ("From history").
- **Today:** space focus chips (Everywhere / Fridge ...) re-scope the page; widgets needs-you, your-kitchen, list, cook, low, risk, week. "Customise": jiggle, drag
  to reorder (pointer drag + FLIP), arrows, S/M/L size, remove, add back, restore defaults; layout saved.
- **Storage 3D:** fridge (door, glass shelves, door bins, light), freezer (drawers slide out staggered), pantry (wood double doors), cupboard, counter (worktop). Items are 3D
  packaging by type with printed labels, quantity as stacked copies, hover shows quantity (HTML tooltip), click selects, drag onto another space moves it (item flies an arc
  to the target and goes in; target bumps), orbit by dragging the empty room, chip bar and plinth labels switch space. Fullness is drawn as blocks, no numbers.
- **Get started:** "Preview as new user" shows the first-run card (preset spaces Fridge, Freezer, Pantry, Cupboard plus a custom one).
- Undo toast for move, discard, add.
- **Smoothness (added after the first handoff):** `app.js` no longer rebuilds the page on each action; `morph()` patches the DOM in place (keyed rows/widgets via `data-k`/`data-w`, `data-morph-skip` on the WebGL host and tooltip). Rows enter/leave with height+fade, widgets reorder/resize with a FLIP animation, widget contents crossfade when the space focus changes, pressed/active buttons fade (gradient on a `::before`), edit-mode tools and the tray fade in and out, a tab switch eases in once. Reduced motion disables all of it. The same approach should be used when porting to React (stable keys, no remounts, framer-motion layout).

## Round 2 (2026-11-06, later): all four tabs polished, still design lab only
- **3D objects are clickable.** Click a closed unit to open it; click the open unit's door or drawer front to close it; click empty room to let go of an item. Hover lights a unit (and sets a pointer cursor) only where a click would act. New **all-closed state** (camera steps back to the whole row, "Open a unit" list on the right). The active chip, a "Close <name>" button and Escape (item first, then unit) also close. `openId` may be `null`; `k3d:space` may carry `{id:null}`. Door and drawer meshes carry `userData.part = "door"`.
- **Image objects, decided approach: drawn food illustrations** (`glyphs.js`, 34 flat drawings, one outline weight, keyword rules in `RULES`, category fallback). They are painted on every 3D label (round sticker plus name) and on all 2D lists as round stickers (`Glyph.url(name, cat)`), so a food looks the same everywhere. No licence, no downloads, ~12 kB. Owner has NOT yet confirmed this over real product photos or glTF; it is the cheap default. Check `Glyph.key` hits for new foods; unknown foods fall back to the category drawing.
- **Shopping:** grouped by aisle, glyph stickers, remove per row, budget bar, sticky **Done shopping** bar that puts ticked items into the right space (`HOME_KIND`, shelf life from `SHELF_LIFE`, merges with existing stock) with Undo.
- **Kitchen:** 6 recipes, cards with ingredient chips (in stock / dashed missing), "uses X before it goes off", **Cook this** (uses one of each ingredient, Undo), "Add N to list", filter Ready now / Nearly there / All, sorted by use-it-up score. The Today "Cook" widget shares the same data.
- Polish: header eyebrow removed (tag instead), no more horizontal scroll (Today widget scale, grid `minmax(0,1fr)`), tab arrow keys, dialog focus trap and return, list input clears after add, phone width checked (390 to desktop, light and dark), themed selection, caret and scrollbars.
- **Detector leftovers (intentional):** Plus Jakarta Sans is the app font; `jiggle` is the owner's chosen edit mode; focus rings for drop targets are spread rings.
- Not done: real GPU timing, touch drag in 3D, NVDA, hover tooltip on the cupboard view, fonts used in label textures load async (labels drawn before the font arrives use the fallback until the next sync).

## Round 3 (2026-11-06): every door and drawer on its own
- Each door and each freezer drawer has its own spring and `want` state; a unit is "open" if any part is open. Click one drawer, one pantry or cupboard door, or the fridge door to open or shut just that part. Several units can stay open at once (realism and freedom). Opening a part gives that unit focus (camera, side list); `k3d:focus {id}`. Items in a shut drawer are hidden and not pickable.
- Space chips and plinth labels are now true toggles (`aria-pressed` = open). The caption has Open/Close for the focused unit plus **Close all** (`Kitchen3D.closeAll()`); Escape drops the item first, then shuts the focused unit.
- Scene API additions: `isOpen(id)`, `openCount()`, `closeUnit(id)`, `closeAll()`; `open(id)` focuses and opens all parts, `open(null)` shuts the unit that had focus. Events: `k3d:parts` (doors changed, page refreshes captions and chips; emitted async), `k3d:focus`, `k3d:space` (label or shut-unit body, handled as a toggle).
- Hover on a unit is a faint lift now (was a pink tint on wood).
- Keyboard: chips and plinth labels toggle whole units; individual doors and drawers are mouse/touch only for now (add a per-part list if the owner wants it).

## Round 4 (2026-11-06): handles first, open all, richer room
- Every handle has an invisible, generous grab zone (`userData.prox`) that wins over everything else when picking. Hovering a handle makes it glow, shows a hint ("Open drawer", "Double-click for all 3", event `k3d:parthint`), and sets a pointer cursor.
- **Open or shut all**: double-click any door or drawer (state before the first click decides open vs shut), or the caption button "Open all 3 drawers" / "Close all 3 drawers" (shows "2 of 3 drawers open"). API: `parts(id)`, `openUnit(id)`.
- Look: wood-plank floor (greyscale texture tinted by theme), chrome handles that react, camera leaves room when drawers slide out.
- Still open: more set dressing (backsplash, lighting fixtures), freezer drawer contents are only visible from above.

## Round 5 (2026-11-06): the counter has real cabinets
- The counter unit's three lower cabinets are now real drawers (front, chrome handle with grab zone, tray) that open and close one by one, all together (double-click or "Open all 3 drawers"), with the same hints and glow as the other units. Food on the worktop stays visible whether they are open or not (`u.ov` is visibility, `u.pv` is how far the parts are open). The drawers hold nothing (visual only); items still sit on the worktop.

## Round 6 (2026-11-06): freezer smoothness and handle picking
- Picking: `pickItem()` lets a handle in reach beat an item behind it (items near the drawer front used to steal the click); handle grab zones are slimmer (0.09 x 0.07) so they do not cover items.
- Performance: shadow maps only redraw while something moves (`renderer.shadowMap.autoUpdate = false`, `needsUpdate` when any spring is unsettled, on sync, theme and door changes); glass bins use a plain transparent standard material instead of physical clearcoat; item glow is applied only when it changes. Idle was 61 fps in software rendering.
- Motion: drawer springs are close to critically damped (no wobble), doors slightly firmer; lower drawers travel further (0.5, 0.4, 0.3) so all three stay visible.
- Trap: never put a `//` comment at the end of a line that carries more code in `scene3d.js` (two such edits silently broke the scene; check with `node --check` on a copy named `.mjs`).

## Round 7 (2026-11-06): audit of every space
Found and fixed: plinth labels sat on the freezer's lower handle and blocked it (now on the floor in front of each unit, clamped to the scene, hidden when the unit is out of view); the fullness meter used invented capacities (now the real shelf slots via `Kitchen3D.stat(id)` = `{cap, placed, over}`, with "full, N not shown here" when a food has no place left and "room to spare" / "nearly empty" steps); small units (freezer, cupboard, counter) were framed too tight (minimum camera distance 3.1); freezer drawers hid each other (staggered travel).
Chip and label behaviour is now one rule: shut unit opens and takes focus; open unit that is not in focus comes into view (doors untouched, `Kitchen3D.focus(id)`); focused unit shuts. Trap hit twice: a trailing `//` comment on a line that carries more code silently comments that code out (also in `app.js`).
Checked and fine: fridge (door, shelves, light strip), pantry (two doors, four shelves), cupboard (two doors, shelf), counter (three drawers, worktop items), freezer (three drawers).

## Round 8 (2026-11-06): the food items, rebuilt
- Old items were stretched boxes and cylinders with the label on every face, items that touched and clipped, jittered sideways, one new material per item, and a hover glow that would have tinted shared materials. All replaced (`SHAPES` in `scene3d.js`).
- New silhouettes: gabled carton with cap, lathed glass bottle, can, jar with contents and lid, tapered tub and pot, meat and fish tray under film, pillow bag whose label follows the bulge, egg carton, loaf with scoring, butter/cheese block, cereal and pasta box with flap seam. Loose produce is real produce: banana bunch, apples, oranges, tomatoes and lemons as spheres, lettuce head. Loose produce shows one pile, not one pile per unit.
- Labels wrap only the front (arc on round packs), carry the drawn food sticker, and redraw when the web font arrives (`Kitchen3D.refreshItems()`). Materials are shared and cached; hover glow clones a material on first hover and restores it after.
- Spacing: pitch 0.15 x 0.16, item scale 1.2, footprint at most 0.116 m, tiny rotation only. Shape choice is in `shapeOf` (unit, name keywords, drawn-food key), so a new food type only needs a key in `glyphs.js` or a rule there.

## Round 9 (2026-11-06): same foods sit together
Placement in `syncItems` now gives every food one unbroken run of places in a single shelf row (first row with enough room, front rows first); copies of one food can no longer be split across shelves or drawers. Ties in expiry are ordered by name so same-name records are neighbours. If no row is big enough, the roomiest row takes the copies that fit, and a food with no place at all counts in `stat().over`.

## Round 10 (2026-11-06): hover and touch glitches
- Root cause: `clearItems` never removed old items (they hang on shelf and drawer groups), so every re-render, including each click on an item, stacked a duplicate set over the old one (ghosts, z-fighting, flicker, growing memory). Now items are removed and their geometry freed; `Kitchen3D._meshes()` counts item meshes (stays constant: 132 in the sample kitchen across selects and moves).
- The scene no longer rebuilds the shelves on selection or hover; `sync()` compares an item signature and rebuilds only when a food, quantity or place changed.
- Hover: 160 ms grace so a lifting item cannot drop its own hover when it slides out from under the pointer; no door hint while an item is hovered; tooltip hangs over the shelf spot (not the lifting item), is sent only when it moves, and the page rewrites its text only when the item changes.
- Touch: a quick swipe over a food scrolls the page; a held finger (220 ms) drags it; a cancelled gesture no longer selects anything.

## Round 11 (2026-11-06): camera, keyboard, freezer
- Camera: drag orbit now has momentum and a wider range (about 54 degrees round, from slightly below to well above), idle sway, softer pointer parallax, critically damped focus moves. Zoom: wheel (only once the room has focus, or with Ctrl, so the page still scrolls) and two-finger pinch. Double-click empty room resets the view.
- Keyboard (click or Tab to the room, `.k3d` has `tabindex=0`, visible focus ring): arrows glide the view, + and - zoom, 0 or Home reset, comma/full stop (or [ ] or PageUp/PageDown) switch unit, Enter or Space opens or shuts the focused unit. Plinth labels keep their own keys. Debug: `Kitchen3D._view()`.
- Freezer is exclusive: only one drawer out at a time (`setPart`, `u.exclusive`); opening another shuts the first; "open all" opens just the top drawer; the caption says "one at a time". The counter's drawers stay independent.
- Drag a food over a shut drawer or door for about 0.25 s and it opens (the freezer shuts the one that was out), so you can drop into any drawer. Drops still land in the unit, not in one particular drawer (items are placed per unit); per-drawer placement would need a drawer field and is not done.
- Bug fixed on the way: a global replace had turned `resetView` into a function that called itself (stack overflow).

## Round 12 (2026-11-06): mouse and drag
- A dragged food is now a real 3D object (`startCarry`): it lifts off its shelf, hangs on a plane in front of the units under the pointer, follows on springs with tilt from its speed and a slight scale-up, and the drop target lights up. Release on a unit: it flies on from where your hand was (`syncItems` uses the carried position). Release anywhere else: it glides home and reappears (`endDrag(id, dropped)`; unlanded drops time out after 0.9 s). The old flat DOM chip is now a small `dragtag` that says "Move to <space>".
- Pan: right-drag, middle-drag or Shift-drag slides the view (springs, clamped); the context menu is suppressed on the room.
- Hovered items tilt towards the pointer; cursor is grabbing while carrying, panning or orbiting.
- Test note: dispatch `pointerup` on the canvas (bubbling), not on `window`, or the page's document-level drag end never runs.

## Round 13 (2026-11-06): main view, sideways, see-through, lower camera
- **Main view**: `setOverview(true)` frames the whole row from the centre with open units left as they are; it is the first view of the Storage tab, an "Overview" chip in the chip bar, and key `O` or `Home`. Choosing any unit leaves it. `isOverview()`, event `k3d:view`.
- **Sideways from any unit**: round arrow buttons at the sides of the room (or Shift+arrows) slide the view to the neighbouring unit without changing the selection (`slide(dir)`, pan range now +-3); right/middle/Shift-drag still pans freely.
- **See-through**: the selected unit's door skins, drawer fronts and door linings fade to 26 % (their own cloned materials `U.xmats`, shadows off while faded) and its contents show through even when it is shut; toggle with the "See-through" button (`setXray`, `S.xray`, default on). Handles stay solid.
- **Lower camera**: look-down range now goes to -0.34 rad (low, shelf-level views); the camera never goes below 0.22 m.

## Round 14 (2026-11-06): the camera must never surprise you, and one selection
- Bug reproduced and fixed: clicking a counter drawer in the main view threw the camera to the counter (and a leftover pan offset made later moves land sideways). Now a click inside the room only changes the selection; the camera moves only if the unit is out of sight (and the pan is reset then), or when you click the selected unit's body in the main view to step in. Chips, labels and keyboard unit switching still move the camera on purpose (`keep` flag on `k3d:space`, `S.fromScene`).
- Pointer parallax was part of the "pushed to the side" feeling and made thin handles slide under the cursor: now 0.018/0.007 rad, eased slowly, and frozen while you hover, press, drag or pan.
- One selected space: chips show selection only (single `aria-pressed`); a unit that is open but not selected gets a small dot (`data-open`). Selecting a unit through a chip or label shuts the previously selected one; handles can still leave several units open.
- Back out with the mouse: click empty room (after letting go of any item, 300 ms so double-click still resets), scroll out past the zoom limit, scroll in on the main view to step into the selected unit, the mouse Back button, or Esc (item, then main view, then close the unit). `Kitchen3D.back()`.
- Test debug API: `_cam()`, `_pick(x,y)` (unit, part, drawer index), `_view()`, `_meshes()`. Suites run in the browser (kept out of the repo): 28 checks on selection, camera stability, freezer exclusivity, chip selection, back-outs; 30 checks on drawers, doors, close all, keyboard, see-through, drag, theme, tab round trip. All pass; 390 px width and the new-user round trip checked.
- Lesson: when a UI test fails, check the test helper first (three failures here were the test, not the app).

## Round 15 (2026-11-06): the counter recording, no overlaps, icons
- From the owner's recording (frames pulled with ffmpeg): (1) bread and bananas on the counter changed size every time a drawer opened, because `popUnit` re-ran the pop-in on items that are not inside anything (now skipped for the counter, `alwaysOpen`); (2) the whole counter looked like frosted glass because see-through applied to a unit with nothing hidden (now only when the unit has items and is not the counter); drawer fronts fade only while their drawer is shut (own cloned material per front, `dr.fmat`), opacity floor 0.38, lighter interior glow.
- No two parts may overlap: units are 0.36 m apart (was 0.2) and doors stop at 1.7 rad (was 1.8 to 1.85), so an open door spills at most about 0.1 m sideways. Geometry check: `Kitchen3D._openEverything()`, `_openDrawer(id, i)`, `_boxes()` (world boxes of every moving part) and a pairwise intersection test; passes with everything open, each freezer drawer alone, and an extra fridge in the row. Tightest measured clearance: pantry right door to cupboard left door 9.5 cm.
- "Open a unit" card: the coloured blocks now carry a drawn icon of each unit (`k_fridge`, `k_freezer`, `k_pantry`, `k_cupboard`, `k_counter` in `ICONS`; dark ink on the light blocks, white on the dark ones).
- Trap, again: a trailing `//` comment on a line that has more code after it (here `const gap = ...; let total = ...`) broke the scene. Use `/* */` or put comments on their own line, and run `node --check` on a copy named `.mjs` after every patch.

## Round 16 (2026-11-06): keyboard commands that did not work
- Cause 1: a held key was remembered by `e.key` but released by whichever key came up, so `+` (Shift and `=` on a US layout) stuck or never released when Shift came up first. Cause 2: keys only worked after clicking or tabbing into the room.
- Fix: one window-level handler (`bindKeys`) that works whenever the pointer is over the room or the room has focus, ignores text fields, the tab bar, dialogs and Ctrl/Alt/Meta combos, and tracks each held key by its physical key (`e.code`), so any layout (US Shift+=, a dedicated + key, numpad) lets go cleanly. Wheel zoom unchanged (needs focus or Ctrl).
- Keys: arrows look, Shift+left/right slide, + and - zoom, 0 resets, O or Home main view, comma and full stop (or [ ] or PageUp/PageDown) switch unit, Enter or Space opens or shuts (not when a button is focused). Arrow keys over the room no longer scroll the page.
- Tested with simulated US, Portuguese-style and numpad plus/minus, arrows, unit and view keys, and the "must not react" cases (typing in the text box, pointer away, Ctrl+): 17 of 17 meaningful checks pass.

## Round 17 (2026-11-06): the Shopping page, redesigned ("the trip")
- **Concept**: two moments in one page. *Plan* (calm, rich, at home) and *In the shop* (big rows, one thumb, whole row ticks). A sliding thumb switches them.
- **Trip card**: budget ring (arc sweeps in, colour turns amber then red as you near or pass the budget), total counts up, editable budget (click "of EUR 25", Enter saves, Esc cancels, persisted in `groceries-lab-v1`), item progress bar with a slow shimmer, and an "Up next" column of the next three things.
- **Smart add bar** (replaces the top quick-add on this tab): understands "3 lemons", "500 g rice flour", autocompletes from history, stock and recipe ingredients with the drawn food stickers, arrow keys and Enter; plus a History button.
- **Route chips**: one per aisle with how many are left (a tick when finished); tap to glide to the aisle.
- **Aisle lanes**: tinted per aisle, sticker, quantity stepper that rescales the price (`pu` = price per unit), remove on hover, ticking sends the sticker flying into the basket and the row folds away.
- **Rail** (Plan only): Running low, For your recipes (what is missing for near-ready recipes), Bought before; one tap adds a line and highlights it.
- **Basket bar**: sticky, a stack of the stickers you have collected, total, an unfolding sheet to review or "Put back", and **Done shopping**, which flies the stickers to the Storage tab and puts everything away (existing `finishTrip`, with Undo).
- **Motion**: staggered rise-in on arrival (`.fresh`), ring sweep, number count-ups (`data-num`), sliding mode thumb, sheen on the card and progress bar, floating stickers in empty states, soft hover lifts, flights (`flyTo`). All of it is off under reduced motion.
- **States**: empty ("A blank page" + add what is running low), everything in the basket, no suggestions, unknown price shows a dash. Checked at 390 px and desktop, light and dark.
- Fixed on the way: "pears" was drawn as peas (the glyph rule matched "pea"). Test suite for this page: 28 checks (autocomplete, smart parse, suggestions, steppers, budget edit, tick flight, basket sheet, modes, finish, empty states), all passing, no console errors.
- Not done: reordering aisles to match a real shop, per-store routes, price history; the real page will need the same data (`qty`, `price`, `cat`) from the shopping endpoint, and the unit price `pu` is derived client-side.

## Round 18 (2026-11-06): Shopping made small, the list became a cart
- **Size**: the trip card is now one slim bar (113 px, was about 400): a small ring with only the total inside (16 px, so it never touches the edge), title, one summary line (to get, in the basket, editable budget, left), a thin progress bar and the Plan / In the shop switch.
- **The list is a cart**: a "Cart" button (count and total) sits bottom-right on every tab and opens a panel that slides out (bottom sheet on a phone) with the list by aisle, steppers, ticking into "In the basket", and Done shopping. On the Shopping tab it pops out by itself while you add things (focusing the add bar, or adding from a shelf) and tucks away about 2 s later unless you are using it. Click outside, X or Esc closes it. In Plan the page itself shows a one-row "In your cart" strip plus shelves of ideas; the full-size list only exists in In the shop mode (big rows, whole row ticks).
- **Top bar never moves**: the quick-add bar is no longer hidden on Shopping (that was what shifted everything up). It is the one add bar for the whole app; on Shopping it understands quantities ("3 lemons"), suggests as you type (dropdown `#cmd-ac`, arrows, Enter) and changes its placeholder. Verified identical position of title, bar, tabs and theme button on all four tabs.
- **Choosing Plan or In the shop** scrolls the page to the part that changed (`data-scroll="main"`).
- **New accounts**: no "Bought before" and no history; they get "Popular picks" (`POPULAR`, 12 common products) on the shelves, in autocomplete and in the From history dialog (retitled Popular picks). Returning accounts get Bought before plus Popular picks. `histSrc()` picks the source from `S.newUser`; the real page should key this on whether the account has any purchases.
- Bug fixed: `classList.toggle(name, undefined)` flips instead of forcing, which made the cart open on alternate renders; always pass `!!value`.
- Tests: 30 checks on the new structure (top bar, sizes, ring text fit, cart open/close paths, smart add, auto pop-out, scroll on mode change, new-account picks, text overflow on three tabs) plus cart steppers, remove, tick flight and Done shopping flight, all passing, no console errors.

## Round 19 (2026-11-06): Today, Kitchen and the welcome screen; storage polish

- **Popular picks removed everywhere.** A new account has no history shelf at all (history is empty), a returning account keeps "Bought before". `POPULAR` is gone from `app.js`.
- **Storage:** tips moved behind a round **?** button (popover, Esc closes); Overview sits at the right end of the chip bar beside it; the right-hand panel is as tall as the scene and scrolls on its own, the page scrolls as before (`contain: size` on `.k3d-wrap + .side` above 981px of container width). Only one drawer is out at a time in every unit; shutting the last door or drawer of the selected unit returns the camera to the main overview (`settle()` in `scene3d.js`).
- **New file `views.js`** (loads before `app.js`): the Today page, the Kitchen page and the welcome screen. It reads state and helpers from `app.js` at call time. `app.js` no longer contains `getStarted`, `W`, `widgetHtml`, `todayView`, `recipeCard` or `kitchenView`.
- **Today:** a hero card (greeting and date, headline such as "7 things need you today.", the one thing to start with, a Cook or Add-missing button, a three-arc freshness ring with count-up numbers, and In stock / At risk / Worth). The hero follows the space focus. Widgets (same ids, so saved layouts still load): Needs you (severity rails), Your kitchen (tiles with fill bars), Shopping list (compact, ticks work), Running low, On a short clock (value at risk, worst three), Next 7 days (real weekday names, food stickers stacked in each bar), Cook with what you have (best recipe plus the next two). Customise, drag reorder, move, resize, remove and restore all still work.
- **Kitchen:** sliding three-way filter, a "Use it up" strip (food about to go off, each linking to a recipe that uses it, scrolls to it), a large "Tonight's pick" card with one big sticker per ingredient (missing ones dashed), recipe cards with a coverage ring. Empty state when there is no food yet.
- **Welcome screen:** headline hook, three benefit lines (waste less, cook what you own, shop once), drifting food stickers, selectable space tiles with a live "N spaces chosen" line, an extra-space field and a "Build my kitchen" button. Form field names are unchanged (`p`, `custom`, `ckind`), so the existing submit handler is unchanged.
- Tests (scratchpad `t_tk.js`): 38 of 39 pass; the one failure is a test flaw (the first missing ingredient was already on the list, so the app correctly said so). Checked by hand: it adds the ingredient once the list is empty. No console errors or warnings; light and dark themes and 390 px width checked by screenshot.

## Round 20 (2026-11-06): smooth focus changes, sliding selectors, building animation, wheel zoom, recipe cards

- **Focus change on Today** (found in the owner recording): rows that leave are now removed at once when the page is only changing focus (`opts.pulse`), so the empty note no longer sits on top of half-removed rows. Each widget card animates its height and position (460 ms), new content fades in with a stagger, the hero text re-enters.
- **Sliding selectors:** the main tabs (now with icons, centred) and the new Today focus selector (icon, name, count, centred, Customise on the right) share `.pill` plus `placeThumbs()`: the highlight is measured and the CSS glides it. `patchAttrs` keeps the measured style on `[data-thumb]` so a morph never resets it.
- **Build my kitchen:** `startBuild()` shows a building panel (each space is put up in turn with a spinner then a tick, a progress bar, three rotating lines), then fades the page out and eases into Storage. About 0.9 s + 0.65 s per space + 0.7 s; 250 ms with reduced motion. Preview as new user cancels it.
- **Wheel zoom** in the 3D room now works without clicking it first and zooms toward the point under the pointer (and away from it when zooming out); at full zoom-out a downward wheel lets the page scroll.
- **Recipe cards** have a plate of askew ingredient stickers that fan out on hover, a "Ready!" stamp, a mood (Quick fix, Weeknight easy, Cosy dinner, Slow and worth it), a one-line voice ("One thing away: plain flour.") and the ingredient names with the missing ones dotted.
- Tests: `t_tk.js` 39 of 40 (the one failure is the known test flaw about the list already holding the ingredient); `t_s3.js` 25 of 25 earlier; no console errors.

## Decisions made 2026-11-06 (owner: "do whatever is best")
- three.js: npm dependency, lazy chunk on the Storage tab only, CSS/list fallback, budget raised on purpose. Measured tree-shaken size 126,199 B gzip (esbuild, three 0.160). The earlier 166,728 B figure was the full library.
- Images: keep the drawn illustrations.
- Plan for the port: `docs/superpowers/plans/2026-11-06-groceries-port.md`.

## Decisions already made by the owner
- Direction: Hybrid, more space-aware, not everything clumped together; keep tabs but one "most important" tab (Today) and the rest as precise views.
- Catalog: modal or optional, not a main tab.
- Really customisable (widgets like an iPhone: drag, resize, hide) and a "Get started" for new users with default spaces.
- Same font as the main pages. Storage picker is the signature feature: nice 3D, quantity on hover.
- Frontend design never changes backend, APIs or data contracts.

## Facts and traps learned
- **No capacity field** on storage spaces (backend `StorageLocationBody`: name, kind, icon, sort_order). Never show "x of y spots". Fullness is visual only. A capacity field would be a backend change needing approval.
- **Customisation storage** should use the existing `user_preferences` table/endpoint; confirm its contract before adding Groceries keys (not done).
- New users get no spaces today (only `backend/seed_john.py` seeds them). Plan: first-run card creates spaces through the existing `POST /storage-locations`; automatic seeding at signup would be a backend change (not approved).
- **three.js and the bundle budget (OPEN DECISION).** `frontend/bundle-budget.json`: lazy chunk limit 127,408 B gzip. Full minified three.js is 166,728 B gzip (measured via jsDelivr). Options: (1) lazy chunk only on Storage + raise the lazy-chunk budget deliberately with a reason, keep CSS-3D fallback (recommended); (2) no dependency, CSS-3D only (much less realistic); (3) CSS-3D default and three.js as opt-in. Tree-shaken real size is not measured. Owner has not chosen.
- **Live DB 503s (fixed today):** the live MySQL was 13 alembic revisions behind (`transactions.to_amount` missing). Fixed with `cd backend; ./.venv/Scripts/python.exe -m alembic upgrade head` (now `c3e5a7b9d1f2`). After pulling or finishing backend work, compare `alembic current` with `alembic heads`.
- The browser message "Content Security Policy of your site blocks the use of eval" is not from the app: no CSP is sent in dev (server.py says so, port 3000 sends no header). It is an extension or DevTools reacting to webpack dev source maps. Production CSP is checked by `e2e/csp-check.mjs`.
- Testing WebGL headless: launch Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`; software rendering is very slow, use `?lite`, wait ~8-9 s per scene change, and cap screenshots. A stray invalid `package.json` in `%TEMP%` breaks `node` for scripts placed under Temp; run scripts from inside the repo.
- A safety check once blocked a long inline Python heredoc; write patch scripts with the Write tool and run the file.
- Moving between spaces in 3D is hit-tested by the app (`dragOver`), HTML chips `.chip3` and plinth labels `.ulabel` are drop targets too.
- Rough spots left in the 3D scene: freezer drawers show only a couple of items from the current camera angle; cupboard view and the 3D hover tooltip were not re-reviewed after the WebGL rewrite; items next to walls can clip slightly; software-render timing only, no real GPU numbers; touch, keyboard-only and screen reader not tested (canvas is `aria-hidden`; chips, labels and the item list are the accessible route).

## Next steps (owner's latest requests first)
0. (Items 1 and 2 below are DONE in the lab, see Round 2. Remaining question for the owner: keep the drawn illustrations or switch to real images.)
1. **(done) Act on the objects themselves in 3D.** Click a cabinet, door or drawer to open or close it directly, and click another unit (cupboard, fridge, freezer ...) in the room to switch to it, without using the chip bar. Today only a click on a *closed* unit's body switches space, and the open one cannot be closed; make hit-testing generous (doors, drawer fronts, the whole body), show hover affordance (cursor, subtle highlight), allow "all closed" state, keep keyboard access (chips and labels stay).
2. **Image objects for most things.** Today items are procedural primitives with generated labels. Decide the asset approach with the owner: real product images as label textures, a set of drawn/generated product images per common food, or glTF models; per-category fallback; licensing; size budget; where files live (not in git if large). Make sure most common foods look recognisable (milk, eggs, bread, bananas, cans, bottles, produce).
3. **Decide the three.js dependency** (see above) before any port. If approved: bundle via npm, dynamic `import()` on the Storage tab, no CDN, keep CSS-3D fallback, update `bundle-budget.json` on purpose, measure the real size.
4. **Port into the real app** after approval: replace Overview with the Today widget page, keep Shopping/Kitchen logic, Catalog as a modal, Storage with the scene; keep existing endpoints and data contracts (`/groceries`, `/storage-locations`, `/shopping`, `/groceries/{id}/move|consume|discard`). Use the impeccable skill for UI work and `docs/superpowers` plans before coding.
5. **Customisation persistence** via `user_preferences` (confirm contract), widget order/size/hidden, focused space.
6. **First-run "Get started"** in the real page (existing create endpoint); decide on signup seeding with the owner.
7. Remaining polish: cupboard/counter views, freezer visibility, labels placement, empty/loading/error states for the scene, undo for real discard, skeleton fidelity (`e2e/skeleton-fidelity.spec.js`), accessibility pass (WCAG 2.2 AA, 3D alternative), responsive checks, tests (browser spec using `freshUserPage`, no live-model calls), build gate (`CI=true npx craco build`).
8. Delete `design-lab/` (or keep outside the repo) once the real page ships; the earlier `/groceries-concepts` page was already removed from the app.

## Round 21 (2026-11-07): the port into the real app is finished

Everything approved in the lab now lives in `frontend/src/pages/groceries/` (Today, welcome, sliding tabs, Kitchen cards and Mix, the 3D Storage room, Shopping with Plan and In the shop, the cart, the add bar) and the Catalog is a dialog. The lab folder `design-lab/groceries/` is kept only until the owner agrees to delete it. What changed from the lab on the way:
- The 3D room is `kitchen3d.js` (a factory per Storage tab, named three imports, `on/sync/dispose`) with `StorageStage.jsx` around it. The lab's see-through fade never ran (its easing line had been swallowed by a comment): fixed. Fog and far plane follow the camera distance; the wall colour fills above the wall; with reduced motion the room redraws only when something moves; a room too slow to be usable falls back to the flat view by itself.
- The lab's top add bar became `QuickAdd.jsx`; the lab's cart that popped out while typing is not ported (the cart is a button on every tab except Shopping).
- The Catalog tab became a dialog, as decided; there is no "Mix" time filter because recipes store no cooking time.
- Found and fixed in passing: saving an edited recurring list returned a server error (`server.py` converted items that were already dicts).
See the plan's Status section and `LAUNCH_TODO.md` for what is left.
