# Groceries 3D kitchen: camera motion spec (from the @lynam_up reels)

Sources (viewed 2026-11-09 in the built-in browser, no login, sampled frames only):
- https://www.instagram.com/reel/DfVT3CKT_45/ (28 s, 1080x1920)
- https://www.instagram.com/reel/DfaE5_jTtFs/ (29 s, 720x1280)
Caption of both: "Scroll & Interactive Website" for new-development / leasing teams.
Both are laptop screen recordings of a scroll-driven real-estate site, so only the site's look and sequence are visible, not its code or exact timings.

## Observed (frames)
Reel 2 sequence: tower exterior at dusk (wide hero) -> scrolling down the tower, floors separate into floating slabs (exploded view) -> living-room interior render -> "CHEF'S KITCHEN" interior -> isometric cutaway "dollhouse" of the restaurant floor -> "THE RESTAURANT" interior.
Reel 1 sequence: exterior -> isometric 3D apartment cutaway (floor plan with furniture, tilted top-down) -> amenity (pool) render.

## Design language
- Dark, near-black stage, one warm dusk accent, cinematic, no visible chrome around the 3D.
- Tiny top bar, one room label bottom-left (large, uppercase, small caps feel), and a thumbnail strip along the bottom edge as a room picker.
- Pattern: overview (exterior or dollhouse cutaway) -> zoom into one space -> labelled interior -> pick another space from the strip.
- Cutaways are isometric/tilted-top-down, with the roof and walls removed, so every space is readable at once.

## Inferred (not measured, treat as starting values)
- Scroll-scrubbed camera path: progress maps to one continuous move, with eased start and end, between exterior, cutaway and interior.
- Transitions between spaces are a push-in plus a short cross-fade, not hard cuts.
- Starting values: fly-to 700-900 ms, ease-in-out (cubic-bezier(0.65, 0, 0.35, 1)); label fade 250 ms, 120 ms after the camera settles; intro 1.2 s; orbit damping about 0.08-0.1.

## What to take for LifeRecord
1. Dollhouse cutaway as the default overview of the kitchen: open top, tilted about 35-45 degrees, so every storage unit is visible at once.
2. Click or pick a unit -> push-in to it, with its label bottom-left and the item list beside it.
3. Bottom strip of unit thumbnails (Fridge, Freezer, Pantry, Shelf...) as the picker, mirroring the room strip; the active one is highlighted.
4. Dark stage with the orchid/plum accent in place of dusk orange.
## What not to take
- Scroll-hijacking. Here the page also holds grocery lists, so the camera follows drag, the picker and clicks, not page scroll. An optional scroll-scrubbed intro only if it never traps the page scroll.
- Photoreal imagery and the exploded multi-floor view (the kitchen has one level).
