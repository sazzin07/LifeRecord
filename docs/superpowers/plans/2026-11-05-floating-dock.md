# Floating Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Replace the sidebar and phone bottom bar with the floating glossy-tile dock of `docs/superpowers/specs/2026-11-05-floating-dock-design.md`.

**Architecture:** `components/dock/` holds the data (`dockData.js`), the drawn tiles (`DockTile.jsx`) and the dock (`NavDock.jsx`); `lib/useScrollHide.js` hides it while scrolling. `AppShell.jsx` loses the sidebar, bottom bar and More sheet; the avatar becomes a menu (Profile, Sign out). Framer Motion only; no new dependencies.

**Spec:** the design document above (groups, icons, behaviour, decisions, tests).

## Global Constraints
- Routes, guards, history and active-page detection unchanged; every page reachable on every screen size.
- Motion: expo-out, `prefers-reduced-motion` and `no-anim` give instant changes. Tokens, except the documented per-group tile gradients.
- Phone targets >= 44px; no horizontal scroll at 390/820/1280; safe areas respected.

## Review Focus
- A fan must not flicker when the pointer passes over the dock or moves from tile to fan.
- The dock must never cover content: page bottom padding and the Quick Add button above it.
- Keyboard: arrows along the dock, Enter opens a group and focuses its first page, Esc returns focus to the tile.
- Hidden dock must return on scroll-up, scroll stop, focus and the page end.

### Task 1: Dock components
- [ ] `dockData.js`, `DockTile.jsx` (11 drawn glyphs), `NavDock.jsx`, `lib/useScrollHide.js`.
### Task 2: Shell
- [ ] Remove sidebar, bottom bar, More sheet, pin logic; avatar menu; content padding; remove the side-menu setting (SettingsContext, Settings, RouteSkeleton).
### Task 3: Tests
- [ ] Rewrite `sidebar.spec.js` and `mobile-nav.spec.js` as `dock.spec.js`; adapt `nav-*`, `header-profile`, `logout-btn`, `lr-sidebar` uses; axe both themes at three widths; reduced motion.
### Task 4: Verify
- [ ] Build, unit tests, full browser suite, screenshots of the dock at three widths in both themes; docs and roadmap.
