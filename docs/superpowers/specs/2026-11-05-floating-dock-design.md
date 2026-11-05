# Floating dock navigation: design

Date: 2026-11-05. Status: approved 2026-11-05; revised the same day (see Revision). Mockups: `.superpowers/brainstorm/` (not committed).

## Intent
Replace the left sidebar (desktop) and the bottom bar with More sheet (phone) by one floating, macOS-Dock-inspired navigation at the bottom of the screen. It is a set of independent glossy tiles, not a bar. Ten destinations are grouped so they fit every screen and make sense: Home, Money, Food, Body, Plan, Settings.

## Goals
- One navigation for every screen size, reached in one gesture (hover or tap a group, then the page).
- Fluid, natural motion: neighbour magnification, a clean staggered unfold of a group's pages, a refined active indicator.
- Every existing route stays reachable; routes, history, guards and active-page detection do not change.

## Non-goals and anti-goals
- No backend change. No new routes. No orange theme (purple, light and dark only).
- Not a full-width bar or one shared rectangular background.
- No exaggerated bounce, no layout shift, no flicker; it must never cover content or controls.

## Decisions (the owner's)
- Groups: **Home** (direct), **Money** = Money + People, **Food** = Groceries + Nutrition, **Body** = Fitness + Body, **Plan** = Tasks + Calendar, **Settings** (direct).
- Style: macOS-style glossy rounded-square tiles, each group with its own colour; icons drawn as SVG in the app (no external images).
- Icons: Home = dashboard (a grid of panels), Money = banknote (cash note), Food = fruit with a leaf, Body = heart with a pulse, Plan = calendar with a tick, Settings = sliders. Sub-page icons follow the same style (People, Groceries, Nutrition, Fitness, Body, Tasks, Calendar), each distinct.
- Sub-pages appear as a clean, smooth unfold of the same tiles above the group (hover on desktop, tap on phone).
- Desktop and phone: the dock hides while scrolling down and returns when scrolling stops.
- Sign out and Profile move to a menu on the avatar in the top bar. The side-menu pin/hover setting is removed from Settings.

## Constraints
- Tokens, not literals, except the per-group tile gradients, which are a documented dock-only exception to the theme's one-accent rule (data-like colour, always paired with a label and the active indicator, never the only signal).
- Motion: expo-out `cubic-bezier(0.16,1,0.3,1)`, 120-220 ms feedback, 420-700 ms structure; both `prefers-reduced-motion` and `no-anim` switch it to instant. Framer Motion only (already a dependency); no new dependencies.
- Accessibility: a `nav` landmark named "Main"; group tiles are buttons (`aria-haspopup`, `aria-expanded`); arrow keys move along the dock and the fan, Esc closes, focus returns to the tile; visible focus; `aria-current="page"` on the current page's tile; tooltips are labels, not the only name; touch targets at least 44 px; no horizontal page scroll at 390/820/1280.
- Safe areas respected; page content gets bottom padding for the dock; contrast checked in both modes.

## Left to the builder (my calls, marked as mine)
- Magnification: cosine falloff, peak 1.5x (not 1.8x), eased; off on touch.
- Fan: 45 ms stagger, rise 14 px with a slight scale and blur-in, closes on outside tap, Esc, or navigation; the fan opens on a 90 ms hover intent so a pass over the dock does not flicker it.
- The active group shows a pressed-in tile with a dot beneath; inside its fan the current page is marked.
- Quick Add stays bottom-right, lifted above the dock; the assistant button stays in the top bar.
- Dock hides after 8 px of downward scroll past 120 px and returns after 180 ms without scrolling, on focus, or on reaching the page end; keyboard focus always shows it.
- The old sidebar skeleton in the route placeholder is removed; the skeleton keeps matching the real layout.

## Tests
`sidebar.spec.js` and `mobile-nav.spec.js` are rewritten for the dock with the same behaviours (every page reachable, current page marked, keyboard, phone). `fixtures.js` no longer sets the sidebar key. New checks: hide on scroll and return, group fan open/close, reduced motion, axe in both themes at three widths. Existing page specs keep passing.

## Revision (owner's, after the first build)
- **Tiles:** forget the glossy macOS tiles; use the round glass tiles with two-tone glyphs in the theme's own surface (card fill, hairline, light top edge, accent ink). The current page fills with the selected-pill gradient, which glides between tiles. This supersedes the per-group tile gradients, so the dock needs no exception to the one-accent rule.
- **Size:** the dock rests small (70%) and grows when the pointer reaches it (a screen that cannot hover shows it full size). It grows about its centre and slides so the tile under the pointer stays under it, kept within the screen.
- **Hover precision:** each tile reacts only to the pointer on the tile itself. There is no magnification of neighbours; the hover zone of a tile (and, for a group, its open fan) is exactly its own box.
- **Motion:** iOS-like springs (quick start, soft settle) for the grow, the lift, the press, the fan and the tooltip; reduced motion and the Animations setting make everything instant.

## Revision 2 (owner's, second round)
- **Neighbour lean:** a very gentle lean on the two tiles beside the hovered one (about 6 percent and 2px); the hovered tile lifts and grows (14 percent, 5px). Hover zones are unchanged (exactly one tile each).
- **Phone (under 640px): no dock.** One button in the middle at the bottom, the ball, in the manner of Pokemon GO's menu: a tap fans out its options and a second tap folds them; or press it and drag a finger to an option, which grows and takes the accent colour with its label, and lifting the finger chooses it (lifting anywhere else closes the menu). The options are the assistant and the quick actions (Expense, Meal, Task, Weight, and More, which opens the full Quick add dialog); each opens straight into its form. Light haptic tick when the finger moves onto an option, where the device supports it.
- **Pages on a phone:** a side menu that slides in from the left, opened by a panel icon at the left of the top bar (the icon Claude's app uses), grouped like the dock (Home; Money; Food; Body; Plan; Settings), folding away when a page is chosen or the panel is dismissed. The assistant button leaves the top bar on a phone and the floating Quick Add button is not shown (the ball replaces both).
- **Tablet and desktop (640px and up):** the dock, with the assistant in the top bar and the floating Quick Add button, as before.

## Revision 3 (owner's)
- No visible text on the dock or the ball: no tooltips over tiles, no labels under the unfolded pages, no label on the ball's options. Every tile keeps its accessible name (`aria-label`), so screen readers still announce it. The side menu on a phone keeps its text, since it is a list.
- Choosing a page does not shrink the dock (people click through pages to look): it stays grown while the pointer is on it, and only the used group's fan folds, until the pointer moves to another tile.
- Hovering and tapping are read from the latest pointer position, so quick movement cannot leave a fan open or a tile lifted; stress tests cover it.
