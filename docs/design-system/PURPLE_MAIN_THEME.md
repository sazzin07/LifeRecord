# PURPLE MAIN THEME — Complete Design System Specification

> **Status of this document:** authoritative, self-contained, generated from the live implementation on 2026-11-04.
> Colour values below were read from the running application (computed styles and CSS custom properties) and from source; where a value
> could not be established exactly it is labelled **(approximate)** or listed in §K.6 "Known gaps and unresolved details".
> The theme is specified entirely in this file; the verbatim stylesheet, Tailwind config and the source of the shared components that carry the
> theme are embedded in §K.5/§K.8, so no repository access or other document is needed. (Comments inside the embedded CSS that mention internal
> audit ids can be ignored.) The Home page's stage has its own, separate amber theme which is **not** part of this specification.
>
> **Stack the examples target:** React 19, Create React App via CRACO, Tailwind CSS 3 (`darkMode: ["class"]`), `tailwindcss-animate`,
> Radix UI primitives (shadcn/ui style wrappers), Framer Motion 11, Recharts 3, lucide-react icons, Sonner toasts.

## Contents
A. Identity and philosophy · B. Colour system · C. Typography · D. Spacing and layout · E. Components · F. Motion · G. Depth and effects ·
H. Interaction states · I. Light mode · J. Dark mode · K. Implementation reference · L. Rules for future work

---

## A. Theme identity and design philosophy

**Name:** Purple Main Theme (internal names: "plum look", "orchid"; CSS scopes `:root`/`.dark`, `.mny-theme`, `.ppl-theme`).

**Where it applies:** every part of the product **except the Home page's own stage** (which has a separate amber theme): the app shell
(sidebar, top bar, mobile bottom bar, floating Quick Add), the AI assistant, and the pages Money, People, Groceries, Nutrition, Fitness,
Body, Tasks, Calendar, Settings, Profile and the sign-in / sign-up / password pages.

**Personality:** calm, private, precise, quietly premium. A personal-finance-and-life dashboard that feels like an instrument panel rather
than a form: dark glass cards float over a soft mauve haze, controls are pills, figures are large and light, and a single mauve gradient
marks "where you are" or "what you chose".

**Aesthetic direction (the reference):** a dark investment-dashboard look — near-black plum surfaces, a soft mauve/grey haze behind them,
generously rounded cards (24–32px), pill buttons with a hairline outline, a light-edged top highlight on every card, large tabular
numerals, an orchid area chart with a dashed marker, and "watchlist" rows separated by hairlines. The light theme is the same design
translated to lilac and ivory: the haze becomes a pale lilac wash, glass becomes white, the same mauve gradient marks selection.

**Intended experience:** orientation first (what page, what period, how much), then detail. One accent hue (mauve/orchid) is used for
navigation state, primary actions, charts and brand marks, so colour never has to compete with data. Green, rose and amber are
reserved for meaning (gain, spend, locked/pending) and are always paired with a sign, arrow or word.

**Hierarchy and emphasis:**
1. The figure or title (large, light-to-medium weight, tight tracking).
2. The control that matters (filled mauve gradient or the light "CTA" pill).
3. Supporting text (secondary colour, 12–14px).
4. Chrome (hairlines, outlines at 10–14% opacity).

**Balance of contrast, clarity, depth, whitespace:** surfaces are separated by *luminance and a hairline*, not by heavy shadows; depth
comes from a 1px light top edge, a long soft drop shadow (negative spread), and in dark the haze showing between cards. Whitespace is
generous inside cards (20–24px padding) and tighter between related groups (gap 16px). Text always meets WCAG AA (see §B.4).

**What makes it distinctive**
- Mauve-tinted neutrals everywhere (no navy, no pure grey): even `slate-*` is remapped to a plum ramp.
- Pill geometry for every control; card geometry 24–28px; stage 32px.
- A sliding gradient "pill" that physically moves between active navigation items.
- A light that follows the mouse across a card (mouse only).
- Tabular, same-family numerals for money (no monospace).

**Principles that must never be compromised**
1. **One accent hue.** Mauve/orchid for brand and state; green/rose/amber only for meaning, never decoration.
2. **Pill controls, soft cards.** No square corners on controls; no sharp-cornered cards.
3. **Hairline + highlight depth.** A 1px outline, a light top edge, a long soft shadow. No hard offset shadows, no coloured glows around cards.
4. **Tokens, not literals.** Every surface colour comes from a variable so the two themes cannot drift.
5. **Contrast floor.** Text ≥ 4.5:1 (large ≥ 3:1) in both themes; meaning never carried by colour alone.
6. **Motion is expo-out, short, and respects reduced motion.** Nothing bounces; nothing delays access to content.

---

## B. Complete colour system

### B.1 How colour is delivered
Three layers, all driven by CSS custom properties switched by the `dark` class on `<html>`:

1. **Global tokens** (`:root` = light, `.dark` = dark): shadcn-style HSL triples (`--background`, `--primary` …, used as `hsl(var(--x))`)
   plus *semantic surface variables* with full colour values (`--line`, `--field`, `--card-fill` …). Components read these.
2. **`.mny-theme`** (Money, Settings, Profile): the same look expressed as `--mny-*` and `--mx-*` variables for the bespoke classes
   (`.mny-card`, `.mny-pill` …).
3. **`.ppl-theme`** (People): `--ppl-*` variables for the People page's own classes.

Tailwind exposes them as: `bg-background text-foreground bg-card bg-popover bg-primary text-primary-foreground bg-secondary bg-muted
text-muted-foreground bg-accent bg-destructive border-border ring-ring` (HSL tokens) and `border-line border-line-strong bg-field bg-hover
bg-sidebar bg-scrim text-accent-ink` (semantic).

The theme is chosen by a user setting (Light / Dark / System); the `dark` class is toggled on `<html>`. A tiny same-origin script (`public/theme-init.js`, loaded in `<head>`, source in §K.5) applies the saved choice to `<html>` before first paint, so neither theme flashes; `<html class="dark">` in the HTML is only the fallback if the script cannot run.

### B.2 Global tokens — Dark mode (rendered values)
| Token | Value | HEX | RGB | HSL | Purpose | Use it for |
|---|---|---|---|---|---|---|
| `--background` | `285 12% 5%` | #0e0b0e | rgb(14, 11, 14) | 285 12% 5% | Page canvas colour under the haze | `body`, `bg-background`, dialog/sheet base |
| `--foreground` | `300 28% 95%` | #f6eff6 | rgb(246, 239, 246) | 300 28% 95% | Primary text | Body text, headings, icons that are not accented |
| `--card` | `285 10% 8%` | #151216 | rgb(21, 18, 22) | 285 10% 8% | Card colour (token form) | `bg-card`, expanded sidebar peek, `Card` fallbacks |
| `--card-foreground` | `300 28% 95%` | #f6eff6 | rgb(246, 239, 246) | 300 28% 95% | Text on a card | Default text inside cards |
| `--popover` | `285 11% 10%` | #1b171c | rgb(27, 23, 28) | 285 11% 10% | Floating-surface colour | Select / dropdown / popover / toast background |
| `--popover-foreground` | `300 28% 95%` | #f6eff6 | rgb(246, 239, 246) | 300 28% 95% | Text on floating surfaces | Menu items, toast text |
| `--primary` | `280 21% 44%` | #785988 | rgb(120, 89, 136) | 280 21% 44% | The mauve action colour (filled) | Default `Button`, switch (checked), checkbox (checked), focus accents via `/opacity` |
| `--primary-foreground` | `0 0% 100%` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Text on `--primary` | Always white |
| `--secondary` | `285 9% 14%` | #252027 | rgb(37, 32, 39) | 285 9% 14% | Quiet neutral fill | Secondary buttons, chips (token form) |
| `--secondary-foreground` | `300 28% 95%` | #f6eff6 | rgb(246, 239, 246) | 300 28% 95% | Text on `--secondary` | — |
| `--muted` | `285 9% 14%` | #252027 | rgb(37, 32, 39) | 285 9% 14% | Muted fill | `bg-muted`, subdued blocks |
| `--muted-foreground` | `292 10% 70%` | #b8abba | rgb(184, 171, 186) | 292 10% 70% | Secondary text (the contrast-floor target) | Captions, descriptions, placeholders, inactive nav; `text-slate-400/500` (light) and `text-slate-500/600` (dark) are forced to this |
| `--accent` | `295 18% 18%` | #352636 | rgb(53, 38, 54) | 295 18% 18% | Highlighted-row fill | Menu item focus (`focus:bg-accent`), ghost-button hover |
| `--accent-foreground` | `300 45% 92%` | #f4e1f4 | rgb(244, 225, 244) | 300 45% 92% | Text on `--accent` | Menu item focus text |
| `--destructive` | `0 72% 56%` | #e03e3e | rgb(224, 62, 62) | 0 72% 56% | Danger action fill | Destructive `Button`, `Alert` destructive |
| `--destructive-foreground` | `0 0% 100%` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Text on `--destructive` | White |
| `--border` | `290 9% 20%` | #362e38 | rgb(54, 46, 56) | 290 9% 20% | Default hairline | Every element's default `border-color` (`* { @apply border-border }`) |
| `--input` | `290 9% 24%` | #413843 | rgb(65, 56, 67) | 290 9% 24% | Control outline (token form) | Switch off-state track, legacy `border-input` |
| `--ring` | `297 48% 76%` | #dca4df | rgb(220, 164, 223) | 297 48% 76% | Focus ring colour | `focus-visible:ring-ring` on every control |
| `--radius` | `1rem` | — | — | — | Base radius (1rem = 16px) | Tailwind `rounded-lg` = this, `md` = −2px, `sm` = −4px |
| `--line` | `rgba(255, 232, 255, 0.12)` | #ffe8ff @ 12% alpha | rgba(255, 232, 255, 0.12) | 300 100% 95% | Semantic hairline on glass surfaces | `border-line` — cards, dialogs, popovers, sidebar, header |
| `--line-strong` | `rgba(255, 232, 255, 0.22)` | #ffe8ff @ 22% alpha | rgba(255, 232, 255, 0.22) | 300 100% 95% | Semantic firm outline | `border-line-strong` — fields, outline buttons, header buttons, card hover |
| `--field` | `rgba(0, 0, 0, 0.35)` | #000000 @ 35% alpha | rgba(0, 0, 0, 0.35) | 0 0% 0% | Control fill | `bg-field` — inputs, selects, textareas, tab list, outline button |
| `--hover` | `rgba(255, 255, 255, 0.08)` | #ffffff @ 8% alpha | rgba(255, 255, 255, 0.08) | 0 0% 100% | Neutral hover wash | `hover:bg-hover` on ghost-like surfaces, nav items, icon buttons |
| `--sidebar` | `rgba(13, 10, 16, 0.75)` | #0d0a10 @ 75% alpha | rgba(13, 10, 16, 0.75) | 270 23% 5% | Docked sidebar fill | `bg-sidebar` (with `backdrop-blur-xl`) |
| `--card-fill` | `linear-gradient(180deg, rgba(255, 240, 255, 0.05), rgba(255, 240, 255, 0.012)), #0e0b10` | — | — | — | The shared card/dialog fill (gradient) | `.card-ambient`, dialogs (`[background:var(--card-fill)]`) |
| `--card-edge` | `inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 22px 44px -30px rgba(0, 0, 0, 0.85)` | — | — | — | The shared card shadow stack | `.card-ambient` |
| `--glass` | `rgba(16, 13, 18, 0.72)` | #100d12 @ 72% alpha | rgba(16, 13, 18, 0.72) | 276 16% 6% | Header glass | `.glass` (top bar) |
| `--glass-strong` | `rgba(14, 11, 16, 0.92)` | #0e0b10 @ 92% alpha | rgba(14, 11, 16, 0.92) | 276 19% 5% | Opaque-ish glass | `.glass-strong` (mobile bottom nav, assistant panel) |
| `--pop-shadow` | `0 24px 60px -20px rgba(0, 0, 0, 0.85)` | — | — | — | Elevation for floating layers | Dialogs, sheets, popovers, dropdowns, selects, assistant, tooltips on charts |
| `--scrim` | `rgba(7, 5, 10, 0.7)` | #07050a @ 70% alpha | rgba(7, 5, 10, 0.7) | 264 33% 3% | Overlay dimming colour | `bg-scrim` behind dialogs, sheets and the assistant |
| `--fab-shadow` | `0 12px 28px -10px rgba(200, 140, 220, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4)` | — | — | — | Floating Quick Add shadow | `shadow-[var(--fab-shadow)]` on the FAB |
| `--fab-shadow-hover` | `0 18px 34px -12px rgba(200, 140, 220, 0.65), 0 3px 8px rgba(0, 0, 0, 0.45)` | — | — | — | Floating Quick Add shadow, hover | FAB hover |
| `--accent-ink` | `#dcb0e5` | #dcb0e5 | rgb(220, 176, 229) | 290 50% 79% | Brand-coloured text/icon on any surface | `text-accent-ink` (profile initials, sparkles, accent icons) |
| `--cta` | `linear-gradient(180deg, #ecc9f2, #c795d3)` | — | — | — | The main-action gradient | `.cta-fill`: floating Quick Add, send button, New chat, `Add expense` |
| `--cta-ink` | `#2a1433` | #2a1433 | rgb(42, 20, 51) | 283 44% 14% | Text/icon on `--cta` | `.cta-fill` colour |
| `--pill` | `linear-gradient(135deg, #87699b, #4f3b5a)` | — | — | — | Selected-state gradient | `.pill-fill`: active nav pill, user chat bubble |
| `--skeleton` | `rgba(255, 238, 255, 0.07)` | #ffeeff @ 7% alpha | rgba(255, 238, 255, 0.07) | 300 100% 97% | Skeleton block fill | `.skeleton` |
| `--skeleton-sweep` | `rgba(255, 236, 255, 0.08)` | #ffecff @ 8% alpha | rgba(255, 236, 255, 0.08) | 300 100% 96% | Skeleton moving highlight | `.skeleton::after` |
| `--scroll` | `rgba(220, 176, 229, 0.26)` | #dcb0e5 @ 26% alpha | rgba(220, 176, 229, 0.26) | 290 50% 79% | Scrollbar thumb | `::-webkit-scrollbar-thumb`, `scrollbar-color` |
| `--tip-bg` | `#1d1720` | #1d1720 | rgb(29, 23, 32) | 280 16% 11% | Chart tooltip background | Recharts default tooltip, `.mny-tip` |
| `--tip-ink` | `#f6f0f7` | #f6f0f7 | rgb(246, 240, 247) | 291 30% 95% | Chart tooltip text | Recharts tooltip label/items |
| `--chart-grid` | `rgba(255, 232, 255, 0.07)` | #ffe8ff @ 7% alpha | rgba(255, 232, 255, 0.07) | 300 100% 95% | Chart grid lines | `.recharts-cartesian-grid line` |
| `--chart-axis` | `rgba(255, 232, 255, 0.16)` | #ffe8ff @ 16% alpha | rgba(255, 232, 255, 0.16) | 300 100% 95% | Chart axis line/ticks | `.recharts-cartesian-axis-line` |
| `--chart-line` | `#dcb0e5` | #dcb0e5 | rgb(220, 176, 229) | 290 50% 79% | Primary data stroke | Area/line strokes (Money, Body, Groceries price, Nutrition reference line) |
| `--chart-line-soft` | `#c795d3` | #c795d3 | rgb(199, 149, 211) | 288 41% 71% | Secondary data fill | Bars (energy bars, expense bar) |
| `--haze` | `radial-gradient(75% 55% at 82% -10%, rgba(150, 118, 160, 0.42), transparent 72%), radial-gradient(55% 42% at 0% 6%, rgba(120, 96, 132, 0.18), transparent 70%), radial-gradient(60% 40% at 50% 115%, rgba(140, 105, 150, 0.16), transparent 70%)` | — | — | — | The mauve background haze (3 radial gradients) | `body` `background-image`, fixed |

### B.3 Global tokens — Light mode (rendered values)
| Token | Value | HEX | RGB | HSL | Purpose | Use it for |
|---|---|---|---|---|---|---|
| `--background` | `290 26% 96%` | #f7f2f7 | rgb(247, 242, 247) | 290 26% 96% | Page canvas colour under the haze | `body`, `bg-background`, dialog/sheet base |
| `--foreground` | `285 30% 11%` | #201424 | rgb(32, 20, 36) | 285 30% 11% | Primary text | Body text, headings, icons that are not accented |
| `--card` | `0 0% 100%` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Card colour (token form) | `bg-card`, expanded sidebar peek, `Card` fallbacks |
| `--card-foreground` | `285 30% 11%` | #201424 | rgb(32, 20, 36) | 285 30% 11% | Text on a card | Default text inside cards |
| `--popover` | `0 0% 100%` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Floating-surface colour | Select / dropdown / popover / toast background |
| `--popover-foreground` | `285 30% 11%` | #201424 | rgb(32, 20, 36) | 285 30% 11% | Text on floating surfaces | Menu items, toast text |
| `--primary` | `280 21% 40%` | #6d517b | rgb(109, 81, 123) | 280 21% 40% | The mauve action colour (filled) | Default `Button`, switch (checked), checkbox (checked), focus accents via `/opacity` |
| `--primary-foreground` | `0 0% 100%` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Text on `--primary` | Always white |
| `--secondary` | `290 22% 93%` | #f0e9f1 | rgb(240, 233, 241) | 290 22% 93% | Quiet neutral fill | Secondary buttons, chips (token form) |
| `--secondary-foreground` | `285 30% 11%` | #201424 | rgb(32, 20, 36) | 285 30% 11% | Text on `--secondary` | — |
| `--muted` | `290 22% 93%` | #f0e9f1 | rgb(240, 233, 241) | 290 22% 93% | Muted fill | `bg-muted`, subdued blocks |
| `--muted-foreground` | `285 12% 38%` | #67556d | rgb(103, 85, 109) | 285 12% 38% | Secondary text (the contrast-floor target) | Captions, descriptions, placeholders, inactive nav; `text-slate-400/500` (light) and `text-slate-500/600` (dark) are forced to this |
| `--accent` | `290 32% 92%` | #efe4f1 | rgb(239, 228, 241) | 290 32% 92% | Highlighted-row fill | Menu item focus (`focus:bg-accent`), ghost-button hover |
| `--accent-foreground` | `280 32% 24%` | #442a51 | rgb(68, 42, 81) | 280 32% 24% | Text on `--accent` | Menu item focus text |
| `--destructive` | `0 72% 46%` | #ca2121 | rgb(202, 33, 33) | 0 72% 46% | Danger action fill | Destructive `Button`, `Alert` destructive |
| `--destructive-foreground` | `0 0% 100%` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Text on `--destructive` | White |
| `--border` | `285 16% 86%` | #ded6e1 | rgb(222, 214, 225) | 285 16% 86% | Default hairline | Every element's default `border-color` (`* { @apply border-border }`) |
| `--input` | `285 14% 78%` | #cbbfcf | rgb(203, 191, 207) | 285 14% 78% | Control outline (token form) | Switch off-state track, legacy `border-input` |
| `--ring` | `280 32% 46%` | #82509b | rgb(130, 80, 155) | 280 32% 46% | Focus ring colour | `focus-visible:ring-ring` on every control |
| `--radius` | `1rem` | — | — | — | Base radius (1rem = 16px) | Tailwind `rounded-lg` = this, `md` = −2px, `sm` = −4px |
| `--line` | `rgba(70, 35, 90, 0.14)` | #46235a @ 14% alpha | rgba(70, 35, 90, 0.14) | 278 44% 25% | Semantic hairline on glass surfaces | `border-line` — cards, dialogs, popovers, sidebar, header |
| `--line-strong` | `rgba(70, 35, 90, 0.3)` | #46235a @ 30% alpha | rgba(70, 35, 90, 0.3) | 278 44% 25% | Semantic firm outline | `border-line-strong` — fields, outline buttons, header buttons, card hover |
| `--field` | `rgba(255, 255, 255, 0.85)` | #ffffff @ 85% alpha | rgba(255, 255, 255, 0.85) | 0 0% 100% | Control fill | `bg-field` — inputs, selects, textareas, tab list, outline button |
| `--hover` | `rgba(90, 50, 110, 0.07)` | #5a326e @ 7% alpha | rgba(90, 50, 110, 0.07) | 280 38% 31% | Neutral hover wash | `hover:bg-hover` on ghost-like surfaces, nav items, icon buttons |
| `--sidebar` | `rgba(255, 255, 255, 0.78)` | #ffffff @ 78% alpha | rgba(255, 255, 255, 0.78) | 0 0% 100% | Docked sidebar fill | `bg-sidebar` (with `backdrop-blur-xl`) |
| `--card-fill` | `linear-gradient(180deg, #ffffff, #fbf8fc)` | — | — | — | The shared card/dialog fill (gradient) | `.card-ambient`, dialogs (`[background:var(--card-fill)]`) |
| `--card-edge` | `inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 2px rgba(70, 35, 90, 0.06), 0 20px 44px -28px rgba(70, 35, 90, 0.34)` | — | — | — | The shared card shadow stack | `.card-ambient` |
| `--glass` | `rgba(255, 255, 255, 0.74)` | #ffffff @ 74% alpha | rgba(255, 255, 255, 0.74) | 0 0% 100% | Header glass | `.glass` (top bar) |
| `--glass-strong` | `rgba(255, 255, 255, 0.94)` | #ffffff @ 94% alpha | rgba(255, 255, 255, 0.94) | 0 0% 100% | Opaque-ish glass | `.glass-strong` (mobile bottom nav, assistant panel) |
| `--pop-shadow` | `0 24px 60px -22px rgba(70, 35, 90, 0.4)` | — | — | — | Elevation for floating layers | Dialogs, sheets, popovers, dropdowns, selects, assistant, tooltips on charts |
| `--scrim` | `rgba(40, 20, 55, 0.48)` | #281437 @ 48% alpha | rgba(40, 20, 55, 0.48) | 274 47% 15% | Overlay dimming colour | `bg-scrim` behind dialogs, sheets and the assistant |
| `--fab-shadow` | `0 12px 28px -10px rgba(107, 79, 123, 0.6), 0 2px 6px rgba(70, 35, 90, 0.22)` | — | — | — | Floating Quick Add shadow | `shadow-[var(--fab-shadow)]` on the FAB |
| `--fab-shadow-hover` | `0 18px 34px -12px rgba(107, 79, 123, 0.7), 0 3px 8px rgba(70, 35, 90, 0.28)` | — | — | — | Floating Quick Add shadow, hover | FAB hover |
| `--accent-ink` | `#6c4d7d` | #6c4d7d | rgb(108, 77, 125) | 279 24% 40% | Brand-coloured text/icon on any surface | `text-accent-ink` (profile initials, sparkles, accent icons) |
| `--cta` | `linear-gradient(180deg, #876096, #6b4f7b)` | — | — | — | The main-action gradient | `.cta-fill`: floating Quick Add, send button, New chat, `Add expense` |
| `--cta-ink` | `#ffffff` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Text/icon on `--cta` | `.cta-fill` colour |
| `--pill` | `linear-gradient(135deg, #87699b, #5a4566)` | — | — | — | Selected-state gradient | `.pill-fill`: active nav pill, user chat bubble |
| `--skeleton` | `rgba(90, 50, 110, 0.09)` | #5a326e @ 9% alpha | rgba(90, 50, 110, 0.09) | 280 38% 31% | Skeleton block fill | `.skeleton` |
| `--skeleton-sweep` | `rgba(255, 255, 255, 0.7)` | #ffffff @ 70% alpha | rgba(255, 255, 255, 0.7) | 0 0% 100% | Skeleton moving highlight | `.skeleton::after` |
| `--scroll` | `rgba(110, 75, 130, 0.32)` | #6e4b82 @ 32% alpha | rgba(110, 75, 130, 0.32) | 278 27% 40% | Scrollbar thumb | `::-webkit-scrollbar-thumb`, `scrollbar-color` |
| `--tip-bg` | `#ffffff` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Chart tooltip background | Recharts default tooltip, `.mny-tip` |
| `--tip-ink` | `#231a28` | #231a28 | rgb(35, 26, 40) | 279 21% 13% | Chart tooltip text | Recharts tooltip label/items |
| `--chart-grid` | `rgba(70, 35, 90, 0.1)` | #46235a @ 10% alpha | rgba(70, 35, 90, 0.1) | 278 44% 25% | Chart grid lines | `.recharts-cartesian-grid line` |
| `--chart-axis` | `rgba(70, 35, 90, 0.22)` | #46235a @ 22% alpha | rgba(70, 35, 90, 0.22) | 278 44% 25% | Chart axis line/ticks | `.recharts-cartesian-axis-line` |
| `--chart-line` | `#7a5a8a` | #7a5a8a | rgb(122, 90, 138) | 280 21% 45% | Primary data stroke | Area/line strokes (Money, Body, Groceries price, Nutrition reference line) |
| `--chart-line-soft` | `#9a6aab` | #9a6aab | rgb(154, 106, 171) | 284 28% 54% | Secondary data fill | Bars (energy bars, expense bar) |
| `--haze` | `radial-gradient(75% 55% at 82% -10%, rgba(196, 160, 214, 0.5), transparent 72%), radial-gradient(55% 42% at 0% 6%, rgba(214, 186, 226, 0.35), transparent 70%), radial-gradient(60% 40% at 50% 115%, rgba(200, 165, 215, 0.3), transparent 70%)` | — | — | — | The mauve background haze (3 radial gradients) | `body` `background-image`, fixed |

### B.4 Contrast (computed from the values above)
**Dark mode**

| Text | On | Ratio | Result |
|---|---|---|---|
| Body text `--foreground` (`#f6eff6`) | page background `--background` | 17.33:1 | pass |
| Secondary text `--muted-foreground` (`#b8abba`) | page background | 8.92:1 | pass |
| Secondary text `--muted-foreground` (`#b8abba`) | card fill (#0e0b10) | 8.91:1 | pass |
| Accent text `--accent-ink` (`#dcb0e5`) | card fill (#0e0b10) | 10.60:1 | pass |
| White on default button `--primary` (`#ffffff`) | `--primary` | 5.86:1 | pass |
| White on selected-pill gradient (light end) (`#ffffff`) | `--pill` start #87699b | 4.64:1 | pass |
| White on selected-pill gradient (dark end) (`#ffffff`) | `--pill` end #4f3b5a | 9.97:1 | pass |
| `--cta-ink` on CTA (start) (`#2a1433`) | `--cta` start #ecc9f2 | 11.40:1 | pass |
| `--cta-ink` on CTA (end) (`#2a1433`) | `--cta` end #c795d3 | 6.95:1 | pass |
| Money text `--mny-text` (`#f6f0f7`) | Money card (#0e0b10) | 17.44:1 | pass |
| Money muted `--mny-muted` (`#b8adbb`) | Money card (#0e0b10) | 9.06:1 | pass |
| Gain `--mny-green` (`#62e4a4`) | Money card (#0e0b10) | 12.25:1 | pass |
| Spend `--mny-neg` (`#ff9fac`) | Money card (#0e0b10) | 10.06:1 | pass |
| Locked `--mny-amber` (`#f6c46e`) | Money card (#0e0b10) | 12.14:1 | pass |

**Light mode**

| Text | On | Ratio | Result |
|---|---|---|---|
| Body text `--foreground` (`#201424`) | page background `--background` | 16.01:1 | pass |
| Secondary text `--muted-foreground` (`#67556d`) | page background | 6.13:1 | pass |
| Secondary text `--muted-foreground` (`#67556d`) | card fill (#ffffff) | 6.78:1 | pass |
| Accent text `--accent-ink` (`#6c4d7d`) | card fill (#ffffff) | 7.01:1 | pass |
| White on default button `--primary` (`#ffffff`) | `--primary` | 6.75:1 | pass |
| White on selected-pill gradient (light end) (`#ffffff`) | `--pill` start #87699b | 4.64:1 | pass |
| White on selected-pill gradient (dark end) (`#ffffff`) | `--pill` end #5a4566 | 8.48:1 | pass |
| `--cta-ink` on CTA (start) (`#ffffff`) | `--cta` start #876096 | 5.07:1 | pass |
| `--cta-ink` on CTA (end) (`#ffffff`) | `--cta` end #6b4f7b | 6.93:1 | pass |
| Money text `--mny-text` (`#231a28`) | Money card (#ffffff) | 16.80:1 | pass |
| Money muted `--mny-muted` (`#65586d`) | Money card (#ffffff) | 6.62:1 | pass |
| Gain `--mny-green` (`#0b7a52`) | Money card (#ffffff) | 5.36:1 | pass |
| Spend `--mny-neg` (`#b4232f`) | Money card (#ffffff) | 6.52:1 | pass |
| Locked `--mny-amber` (`#8f4208`) | Money card (#ffffff) | 7.12:1 | pass |

Text that reads below its floor in a component is a defect, not a design choice. Large text (≥ 24px, or ≥ 18.66px bold) needs 3:1.

### B.5 Money / Settings / Profile scope (`.mny-theme`) — Dark mode
| Token | Value | HEX | RGB | HSL | Purpose | Use it for |
|---|---|---|---|---|---|---|
| `--mny-bg` | `#0c0a0e` | #0c0a0e | rgb(12, 10, 14) | 270 17% 5% | Stage base colour | `.mny-stage` background (under the lights) |
| `--mny-lights` | `radial-gradient(75% 55% at 78% -8%, rgba(150, 118, 160, 0.42), transparent 72%), radial-gradient(55% 40% at 0% 8%, rgba(120, 96, 132, 0.22), transparent 70%), radial-gradient(60% 40% at 50% 112%, rgba(140, 105, 150, 0.2), transparent 70%)` | — | — | — | Stage haze (3 radial gradients) | `.mny-stage` background |
| `--mny-surface` | `#100d12` | #100d12 | rgb(16, 13, 18) | 276 16% 6% | Card surface (legacy token) | Skeleton rows, tooltips, base `.mny-card` |
| `--mny-surface-2` | `#1b161e` | #1b161e | rgb(27, 22, 30) | 278 15% 10% | Second surface (rows, bars, sticky date bar) | `.mny-row:hover`, `.mny-bar`, `bg-[var(--mny-surface-2)]` |
| `--mny-line` | `rgba(255, 232, 255, 0.1)` | #ffe8ff @ 10% alpha | rgba(255, 232, 255, 0.1) | 300 100% 95% | Stage hairline | `.mny-stage`, `.mny-hair`, skeleton |
| `--mny-shadow` | `inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 24px 48px -30px rgba(0, 0, 0, 0.9)` | — | — | — | Card shadow stack (legacy) | Base `.mny-card` (replaced by `--mx-card` + `--card-edge` look) |
| `--mny-text` | `#f6f0f7` | #f6f0f7 | rgb(246, 240, 247) | 291 30% 95% | Primary text on the stage | Titles, figures |
| `--mny-muted` | `#b8adbb` | #b8adbb | rgb(184, 173, 187) | 287 9% 71% | Secondary text on the stage | Captions, labels (`.mny-muted`) |
| `--mny-green` | `#62e4a4` | #62e4a4 | rgb(98, 228, 164) | 150 71% 64% | Gain / positive / success text | Income, 'still in hand', status chips (`.mny-green`) |
| `--mny-green-tint` | `rgba(98, 228, 164, 0.13)` | #62e4a4 @ 13% alpha | rgba(98, 228, 164, 0.13) | 150 71% 64% | Tint behind green | Status chips |
| `--mny-grad` | `linear-gradient(135deg, #87699b, #5a4566)` | — | — | — | Selected-pill gradient | `.mny-pill[aria-pressed=true]` |
| `--mny-on-grad` | `#ffffff` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Text on `--mny-grad` | White |
| `--mny-neg` | `#ff9fac` | #ff9fac | rgb(255, 159, 172) | 352 100% 81% | Spend / negative / over-budget text | Net negative, 'more than before' (`.mny-neg`) |
| `--mny-neg-tint` | `rgba(255, 140, 160, 0.14)` | #ff8ca0 @ 14% alpha | rgba(255, 140, 160, 0.14) | 350 100% 77% | Tint behind negative | `.mny-state.neg` |
| `--mny-amber` | `#f6c46e` | #f6c46e | rgb(246, 196, 110) | 38 88% 70% | Locked / pending / warning text | `.mny-amber` |
| `--mny-amber-tint` | `rgba(246, 196, 110, 0.14)` | #f6c46e @ 14% alpha | rgba(246, 196, 110, 0.14) | 38 88% 70% | Tint behind amber | `.mny-state.amber`, unplaced-money banner |
| `--mx-orchid` | `#dcb0e5` | #dcb0e5 | rgb(220, 176, 229) | 290 50% 79% | Accent ink on the stage | Icons, focus outline, badge glyphs |
| `--mx-orchid-deep` | `#a87bb6` | #a87bb6 | rgb(168, 123, 182) | 286 29% 60% | Deeper orchid | Reserved accent (defined, lightly used) |
| `--mx-edge` | `rgba(255, 232, 255, 0.1)` | #ffe8ff @ 10% alpha | rgba(255, 232, 255, 0.1) | 300 100% 95% | Card/stage outline | `.mny-card`, `.mny-stage` |
| `--mx-edge-hover` | `rgba(255, 232, 255, 0.18)` | #ffe8ff @ 18% alpha | rgba(255, 232, 255, 0.18) | 300 100% 95% | Card outline on hover; tooltip edge | `.mny-card:hover`, `.mny-tip` |
| `--mx-hair` | `rgba(255, 232, 255, 0.1)` | #ffe8ff @ 10% alpha | rgba(255, 232, 255, 0.1) | 300 100% 95% | Divider inside a card | `.mx-asset`, `.mx-list` |
| `--mx-card` | `linear-gradient(180deg, rgba(255, 240, 255, 0.055), rgba(255, 240, 255, 0.012)), #0e0b10` | — | — | — | Card fill (gradient) | `.mny-card` |
| `--mx-glow` | `rgba(220, 176, 229, 0.11)` | #dcb0e5 @ 11% alpha | rgba(220, 176, 229, 0.11) | 290 50% 79% | Pointer-follow light | `.mny-card::before` |
| `--mx-tile` | `rgba(0, 0, 0, 0.32)` | #000000 @ 32% alpha | rgba(0, 0, 0, 0.32) | 0 0% 0% | Inner tile fill | `.mny-tile` |
| `--mx-tile-edge` | `rgba(255, 232, 255, 0.12)` | #ffe8ff @ 12% alpha | rgba(255, 232, 255, 0.12) | 300 100% 95% | Inner tile outline | `.mny-tile`, `.mny-badge`, `.mny-bar` |
| `--mx-badge` | `rgba(0, 0, 0, 0.35)` | #000000 @ 35% alpha | rgba(0, 0, 0, 0.35) | 0 0% 0% | Round icon badge fill | `.mny-badge` |
| `--mx-pill` | `rgba(0, 0, 0, 0.38)` | #000000 @ 38% alpha | rgba(0, 0, 0, 0.38) | 0 0% 0% | Resting pill fill | `.mny-pill` |
| `--mx-pill-edge` | `rgba(255, 240, 255, 0.24)` | #fff0ff @ 24% alpha | rgba(255, 240, 255, 0.24) | 300 100% 97% | Resting pill outline | `.mny-pill` |
| `--mx-pill-hover` | `rgba(255, 240, 255, 0.1)` | #fff0ff @ 10% alpha | rgba(255, 240, 255, 0.1) | 300 100% 97% | Pill hover fill | `.mny-pill:hover` |
| `--mx-pill-hover-edge` | `rgba(255, 240, 255, 0.4)` | #fff0ff @ 40% alpha | rgba(255, 240, 255, 0.4) | 300 100% 97% | Pill hover outline | `.mny-pill:hover`, `.mx-ask:hover` |
| `--mx-cta` | `linear-gradient(180deg, #ecc9f2, #c795d3)` | — | — | — | Main-action gradient on the stage | `.mny-cta` |
| `--mx-cta-ink` | `#2a1433` | #2a1433 | rgb(42, 20, 51) | 283 44% 14% | Text on the main action | `.mny-cta` |
| `--mx-cta-shadow` | `inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 12px 26px -14px rgba(220, 150, 235, 0.7)` | — | — | — | Main-action shadow | `.mny-cta` |
| `--mx-field` | `rgba(0, 0, 0, 0.38)` | #000000 @ 38% alpha | rgba(0, 0, 0, 0.38) | 0 0% 0% | Field fill on the stage | `.mny-field` |
| `--mx-field-edge` | `rgba(255, 240, 255, 0.2)` | #fff0ff @ 20% alpha | rgba(255, 240, 255, 0.2) | 300 100% 97% | Field outline on the stage | `.mny-field` |
| `--mx-ask` | `rgba(0, 0, 0, 0.45)` | #000000 @ 45% alpha | rgba(0, 0, 0, 0.45) | 0 0% 0% | Ask-bar fill | `.mx-ask` |
| `--mx-ask-edge` | `rgba(255, 240, 255, 0.12)` | #fff0ff @ 12% alpha | rgba(255, 240, 255, 0.12) | 300 100% 97% | Ask-bar outline | `.mx-ask` |
| `--mx-bar` | `rgba(0, 0, 0, 0.4)` | #000000 @ 40% alpha | rgba(0, 0, 0, 0.4) | 0 0% 0% | Progress track | `.mny-bar` |
| `--mx-bar-fill` | `linear-gradient(90deg, #a87bb6, #e0b6e8)` | — | — | — | Progress fill | `.mny-bar > span` |
| `--mx-warn-fill` | `linear-gradient(90deg, #d49a3a, #f6c46e)` | — | — | — | Progress ≥ 80% | `.mny-bar > span.warn` |
| `--mx-over-fill` | `linear-gradient(90deg, #e0566a, #ff9fac)` | — | — | — | Progress over budget | `.mny-bar > span.over` |
| `--mx-row` | `rgba(255, 240, 255, 0.045)` | #fff0ff @ 4.5% alpha | rgba(255, 240, 255, 0.045) | 300 100% 97% | List-row hover wash | `.mny-row:hover` |
| `--mx-arc` | `rgba(220, 176, 229, 0.34)` | #dcb0e5 @ 34% alpha | rgba(220, 176, 229, 0.34) | 290 50% 79% | Bottom arc of light | `.mx-glow::after` |
| `--mx-bloom` | `rgba(220, 176, 229, 0.38)` | #dcb0e5 @ 38% alpha | rgba(220, 176, 229, 0.38) | 290 50% 79% | Corner bloom core | `.mx-bloom::after` |
| `--mx-bloom-soft` | `rgba(160, 120, 175, 0.14)` | #a078af @ 14% alpha | rgba(160, 120, 175, 0.14) | 284 26% 58% | Corner bloom falloff | `.mx-bloom::after` |
| `--mx-tip` | `#1d1720` | #1d1720 | rgb(29, 23, 32) | 280 16% 11% | Money tooltip fill | `.mny-tip` |
| `--mx-selection` | `rgba(220, 176, 229, 0.32)` | #dcb0e5 @ 32% alpha | rgba(220, 176, 229, 0.32) | 290 50% 79% | Text selection | `.mny-theme ::selection` |
| `--mx-chip` | `rgba(0, 0, 0, 0.3)` | #000000 @ 30% alpha | rgba(0, 0, 0, 0.3) | 0 0% 0% | Chip fill | `.mx-chip` |
| `--mx-chip-edge` | `rgba(255, 240, 255, 0.2)` | #fff0ff @ 20% alpha | rgba(255, 240, 255, 0.2) | 300 100% 97% | Chip outline | `.mx-chip` |
| `--mx-state` | `rgba(98, 228, 164, 0.13)` | #62e4a4 @ 13% alpha | rgba(98, 228, 164, 0.13) | 150 71% 64% | Positive status chip fill | `.mny-state` |

### B.6 Money / Settings / Profile scope (`.mny-theme`) — Light mode
| Token | Value | HEX | RGB | HSL | Purpose | Use it for |
|---|---|---|---|---|---|---|
| `--mny-bg` | `#f5eff7` | #f5eff7 | rgb(245, 239, 247) | 285 33% 95% | Stage base colour | `.mny-stage` background (under the lights) |
| `--mny-lights` | `radial-gradient(75% 55% at 78% -8%, rgba(196, 160, 214, 0.5), transparent 72%), radial-gradient(55% 40% at 0% 8%, rgba(214, 186, 226, 0.36), transparent 70%), radial-gradient(60% 40% at 50% 112%, rgba(200, 165, 215, 0.3), transparent 70%)` | — | — | — | Stage haze (3 radial gradients) | `.mny-stage` background |
| `--mny-surface` | `#ffffff` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Card surface (legacy token) | Skeleton rows, tooltips, base `.mny-card` |
| `--mny-surface-2` | `#f4eef7` | #f4eef7 | rgb(244, 238, 247) | 280 36% 95% | Second surface (rows, bars, sticky date bar) | `.mny-row:hover`, `.mny-bar`, `bg-[var(--mny-surface-2)]` |
| `--mny-line` | `rgba(70, 35, 90, 0.13)` | #46235a @ 13% alpha | rgba(70, 35, 90, 0.13) | 278 44% 25% | Stage hairline | `.mny-stage`, `.mny-hair`, skeleton |
| `--mny-shadow` | `inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 2px rgba(70, 35, 90, 0.06), 0 22px 46px -30px rgba(70, 35, 90, 0.38)` | — | — | — | Card shadow stack (legacy) | Base `.mny-card` (replaced by `--mx-card` + `--card-edge` look) |
| `--mny-text` | `#231a28` | #231a28 | rgb(35, 26, 40) | 279 21% 13% | Primary text on the stage | Titles, figures |
| `--mny-muted` | `#65586d` | #65586d | rgb(101, 88, 109) | 277 11% 39% | Secondary text on the stage | Captions, labels (`.mny-muted`) |
| `--mny-green` | `#0b7a52` | #0b7a52 | rgb(11, 122, 82) | 158 83% 26% | Gain / positive / success text | Income, 'still in hand', status chips (`.mny-green`) |
| `--mny-green-tint` | `rgba(11, 122, 82, 0.12)` | #0b7a52 @ 12% alpha | rgba(11, 122, 82, 0.12) | 158 83% 26% | Tint behind green | Status chips |
| `--mny-grad` | `linear-gradient(135deg, #87699b, #5a4566)` | — | — | — | Selected-pill gradient | `.mny-pill[aria-pressed=true]` |
| `--mny-on-grad` | `#ffffff` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Text on `--mny-grad` | White |
| `--mny-neg` | `#b4232f` | #b4232f | rgb(180, 35, 47) | 355 67% 42% | Spend / negative / over-budget text | Net negative, 'more than before' (`.mny-neg`) |
| `--mny-neg-tint` | `rgba(200, 40, 60, 0.1)` | #c8283c @ 10% alpha | rgba(200, 40, 60, 0.1) | 352 67% 47% | Tint behind negative | `.mny-state.neg` |
| `--mny-amber` | `#8f4208` | #8f4208 | rgb(143, 66, 8) | 26 89% 30% | Locked / pending / warning text | `.mny-amber` |
| `--mny-amber-tint` | `rgba(217, 138, 11, 0.16)` | #d98a0b @ 16% alpha | rgba(217, 138, 11, 0.16) | 37 90% 45% | Tint behind amber | `.mny-state.amber`, unplaced-money banner |
| `--mx-orchid` | `#6c4d7d` | #6c4d7d | rgb(108, 77, 125) | 279 24% 40% | Accent ink on the stage | Icons, focus outline, badge glyphs |
| `--mx-orchid-deep` | `#8b6a9d` | #8b6a9d | rgb(139, 106, 157) | 279 21% 52% | Deeper orchid | Reserved accent (defined, lightly used) |
| `--mx-edge` | `rgba(70, 35, 90, 0.12)` | #46235a @ 12% alpha | rgba(70, 35, 90, 0.12) | 278 44% 25% | Card/stage outline | `.mny-card`, `.mny-stage` |
| `--mx-edge-hover` | `rgba(70, 35, 90, 0.26)` | #46235a @ 26% alpha | rgba(70, 35, 90, 0.26) | 278 44% 25% | Card outline on hover; tooltip edge | `.mny-card:hover`, `.mny-tip` |
| `--mx-hair` | `rgba(70, 35, 90, 0.12)` | #46235a @ 12% alpha | rgba(70, 35, 90, 0.12) | 278 44% 25% | Divider inside a card | `.mx-asset`, `.mx-list` |
| `--mx-card` | `linear-gradient(180deg, #ffffff, #fbf8fc)` | — | — | — | Card fill (gradient) | `.mny-card` |
| `--mx-glow` | `rgba(150, 100, 180, 0.13)` | #9664b4 @ 13% alpha | rgba(150, 100, 180, 0.13) | 278 35% 55% | Pointer-follow light | `.mny-card::before` |
| `--mx-tile` | `rgba(90, 50, 110, 0.05)` | #5a326e @ 5% alpha | rgba(90, 50, 110, 0.05) | 280 38% 31% | Inner tile fill | `.mny-tile` |
| `--mx-tile-edge` | `rgba(70, 35, 90, 0.12)` | #46235a @ 12% alpha | rgba(70, 35, 90, 0.12) | 278 44% 25% | Inner tile outline | `.mny-tile`, `.mny-badge`, `.mny-bar` |
| `--mx-badge` | `rgba(122, 90, 138, 0.1)` | #7a5a8a @ 10% alpha | rgba(122, 90, 138, 0.1) | 280 21% 45% | Round icon badge fill | `.mny-badge` |
| `--mx-pill` | `rgba(255, 255, 255, 0.85)` | #ffffff @ 85% alpha | rgba(255, 255, 255, 0.85) | 0 0% 100% | Resting pill fill | `.mny-pill` |
| `--mx-pill-edge` | `rgba(70, 35, 90, 0.3)` | #46235a @ 30% alpha | rgba(70, 35, 90, 0.3) | 278 44% 25% | Resting pill outline | `.mny-pill` |
| `--mx-pill-hover` | `rgba(90, 50, 110, 0.08)` | #5a326e @ 8% alpha | rgba(90, 50, 110, 0.08) | 280 38% 31% | Pill hover fill | `.mny-pill:hover` |
| `--mx-pill-hover-edge` | `rgba(70, 35, 90, 0.5)` | #46235a @ 50% alpha | rgba(70, 35, 90, 0.5) | 278 44% 25% | Pill hover outline | `.mny-pill:hover`, `.mx-ask:hover` |
| `--mx-cta` | `linear-gradient(180deg, #876096, #6b4f7b)` | — | — | — | Main-action gradient on the stage | `.mny-cta` |
| `--mx-cta-ink` | `#ffffff` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Text on the main action | `.mny-cta` |
| `--mx-cta-shadow` | `inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 12px 26px -14px rgba(107, 79, 123, 0.7)` | — | — | — | Main-action shadow | `.mny-cta` |
| `--mx-field` | `rgba(255, 255, 255, 0.92)` | #ffffff @ 92% alpha | rgba(255, 255, 255, 0.92) | 0 0% 100% | Field fill on the stage | `.mny-field` |
| `--mx-field-edge` | `rgba(70, 35, 90, 0.28)` | #46235a @ 28% alpha | rgba(70, 35, 90, 0.28) | 278 44% 25% | Field outline on the stage | `.mny-field` |
| `--mx-ask` | `rgba(255, 255, 255, 0.75)` | #ffffff @ 75% alpha | rgba(255, 255, 255, 0.75) | 0 0% 100% | Ask-bar fill | `.mx-ask` |
| `--mx-ask-edge` | `rgba(70, 35, 90, 0.2)` | #46235a @ 20% alpha | rgba(70, 35, 90, 0.2) | 278 44% 25% | Ask-bar outline | `.mx-ask` |
| `--mx-bar` | `rgba(90, 50, 110, 0.1)` | #5a326e @ 10% alpha | rgba(90, 50, 110, 0.1) | 280 38% 31% | Progress track | `.mny-bar` |
| `--mx-bar-fill` | `linear-gradient(90deg, #8b6a9d, #6c4d7d)` | — | — | — | Progress fill | `.mny-bar > span` |
| `--mx-warn-fill` | `linear-gradient(90deg, #d49a3a, #b8760b)` | — | — | — | Progress ≥ 80% | `.mny-bar > span.warn` |
| `--mx-over-fill` | `linear-gradient(90deg, #d8485c, #b4232f)` | — | — | — | Progress over budget | `.mny-bar > span.over` |
| `--mx-row` | `rgba(90, 50, 110, 0.05)` | #5a326e @ 5% alpha | rgba(90, 50, 110, 0.05) | 280 38% 31% | List-row hover wash | `.mny-row:hover` |
| `--mx-arc` | `rgba(160, 110, 190, 0.34)` | #a06ebe @ 34% alpha | rgba(160, 110, 190, 0.34) | 278 38% 59% | Bottom arc of light | `.mx-glow::after` |
| `--mx-bloom` | `rgba(180, 135, 205, 0.4)` | #b487cd @ 40% alpha | rgba(180, 135, 205, 0.4) | 279 41% 67% | Corner bloom core | `.mx-bloom::after` |
| `--mx-bloom-soft` | `rgba(190, 150, 210, 0.14)` | #be96d2 @ 14% alpha | rgba(190, 150, 210, 0.14) | 280 40% 71% | Corner bloom falloff | `.mx-bloom::after` |
| `--mx-tip` | `#ffffff` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Money tooltip fill | `.mny-tip` |
| `--mx-selection` | `rgba(160, 110, 190, 0.3)` | #a06ebe @ 30% alpha | rgba(160, 110, 190, 0.3) | 278 38% 59% | Text selection | `.mny-theme ::selection` |
| `--mx-chip` | `rgba(255, 255, 255, 0.7)` | #ffffff @ 70% alpha | rgba(255, 255, 255, 0.7) | 0 0% 100% | Chip fill | `.mx-chip` |
| `--mx-chip-edge` | `rgba(70, 35, 90, 0.22)` | #46235a @ 22% alpha | rgba(70, 35, 90, 0.22) | 278 44% 25% | Chip outline | `.mx-chip` |
| `--mx-state` | `rgba(11, 122, 82, 0.12)` | #0b7a52 @ 12% alpha | rgba(11, 122, 82, 0.12) | 158 83% 26% | Positive status chip fill | `.mny-state` |

### B.7 People scope (`.ppl-theme`) — Dark mode
| Token | Value | HEX | RGB | HSL | Purpose | Use it for |
|---|---|---|---|---|---|---|
| `--ppl-bg` | `#0c0a0e` | #0c0a0e | rgb(12, 10, 14) | 270 17% 5% | People stage base | `.ppl-stage` |
| `--ppl-lights` | `radial-gradient(75% 55% at 82% -8%, rgba(150, 118, 160, 0.4), transparent 72%), radial-gradient(55% 40% at 0% 100%, rgba(140, 105, 150, 0.16), transparent 70%)` | — | — | — | People stage haze | `.ppl-stage` |
| `--ppl-surface` | `#100d12` | #100d12 | rgb(16, 13, 18) | 276 16% 6% | Solid surface (carries figures) | `.ppl-solid` |
| `--ppl-surface-2` | `#1b161e` | #1b161e | rgb(27, 22, 30) | 278 15% 10% | Second surface | Rows, inputs |
| `--ppl-line` | `rgba(255, 232, 255, 0.1)` | #ffe8ff @ 10% alpha | rgba(255, 232, 255, 0.1) | 300 100% 95% | Hairline | Borders |
| `--ppl-text` | `#f6f0f7` | #f6f0f7 | rgb(246, 240, 247) | 291 30% 95% | Primary text | — |
| `--ppl-muted` | `#b8adbb` | #b8adbb | rgb(184, 173, 187) | 287 9% 71% | Secondary text | `.ppl-muted` |
| `--ppl-teal-text` | `#dcb0e5` | #dcb0e5 | rgb(220, 176, 229) | 290 50% 79% | Brand text ('they owe you'; legacy name, now orchid) | `.ppl-teal`, focus outline, caret |
| `--ppl-teal-fill` | `#cc93d8` | #cc93d8 | rgb(204, 147, 216) | 290 47% 71% | Brand fill | `.ppl-btn-primary` |
| `--ppl-on-fill` | `#1d0f25` | #1d0f25 | rgb(29, 15, 37) | 278 42% 10% | Text on the brand fill | `.ppl-btn-primary` |
| `--ppl-teal-tint` | `rgba(220, 176, 229, 0.13)` | #dcb0e5 @ 13% alpha | rgba(220, 176, 229, 0.13) | 290 50% 79% | Brand tint | Selection, chips |
| `--ppl-amber-text` | `#f6c46e` | #f6c46e | rgb(246, 196, 110) | 38 88% 70% | 'You owe' text | `.ppl-amber` |
| `--ppl-amber-fill` | `#f6c46e` | #f6c46e | rgb(246, 196, 110) | 38 88% 70% | Amber fill | Status dots |
| `--ppl-amber-tint` | `rgba(246, 196, 110, 0.14)` | #f6c46e @ 14% alpha | rgba(246, 196, 110, 0.14) | 38 88% 70% | Amber tint | Chips |
| `--ppl-glass` | `rgba(18, 14, 21, 0.66)` | #120e15 @ 66% alpha | rgba(18, 14, 21, 0.66) | 274 20% 7% | Floating-layer glass | `.ppl-glass` (side sheet, dialogs, delete bar) |
| `--ppl-glass-line` | `rgba(255, 232, 255, 0.14)` | #ffe8ff @ 14% alpha | rgba(255, 232, 255, 0.14) | 300 100% 95% | Glass edge | `.ppl-glass` |
| `--ppl-glass-shadow` | `0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 28px 70px -24px rgba(0, 0, 0, 0.75), 0 2px 10px rgba(0, 0, 0, 0.35)` | — | — | — | Glass shadow stack | `.ppl-glass` |

### B.8 People scope (`.ppl-theme`) — Light mode
| Token | Value | HEX | RGB | HSL | Purpose | Use it for |
|---|---|---|---|---|---|---|
| `--ppl-bg` | `#f3edf5` | #f3edf5 | rgb(243, 237, 245) | 285 29% 95% | People stage base | `.ppl-stage` |
| `--ppl-lights` | `radial-gradient(75% 55% at 82% -8%, rgba(196, 160, 214, 0.5), transparent 72%), radial-gradient(55% 40% at 0% 100%, rgba(214, 186, 226, 0.32), transparent 70%)` | — | — | — | People stage haze | `.ppl-stage` |
| `--ppl-surface` | `#ffffff` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Solid surface (carries figures) | `.ppl-solid` |
| `--ppl-surface-2` | `#f6f0f8` | #f6f0f8 | rgb(246, 240, 248) | 285 36% 96% | Second surface | Rows, inputs |
| `--ppl-line` | `rgba(70, 35, 90, 0.14)` | #46235a @ 14% alpha | rgba(70, 35, 90, 0.14) | 278 44% 25% | Hairline | Borders |
| `--ppl-text` | `#231a28` | #231a28 | rgb(35, 26, 40) | 279 21% 13% | Primary text | — |
| `--ppl-muted` | `#65586d` | #65586d | rgb(101, 88, 109) | 277 11% 39% | Secondary text | `.ppl-muted` |
| `--ppl-teal-text` | `#6c4d7d` | #6c4d7d | rgb(108, 77, 125) | 279 24% 40% | Brand text ('they owe you'; legacy name, now orchid) | `.ppl-teal`, focus outline, caret |
| `--ppl-teal-fill` | `#7a5a8a` | #7a5a8a | rgb(122, 90, 138) | 280 21% 45% | Brand fill | `.ppl-btn-primary` |
| `--ppl-on-fill` | `#ffffff` | #ffffff | rgb(255, 255, 255) | 0 0% 100% | Text on the brand fill | `.ppl-btn-primary` |
| `--ppl-teal-tint` | `rgba(122, 90, 138, 0.12)` | #7a5a8a @ 12% alpha | rgba(122, 90, 138, 0.12) | 280 21% 45% | Brand tint | Selection, chips |
| `--ppl-amber-text` | `#92400e` | #92400e | rgb(146, 64, 14) | 23 82% 31% | 'You owe' text | `.ppl-amber` |
| `--ppl-amber-fill` | `#d98a0b` | #d98a0b | rgb(217, 138, 11) | 37 90% 45% | Amber fill | Status dots |
| `--ppl-amber-tint` | `rgba(217, 138, 11, 0.16)` | #d98a0b @ 16% alpha | rgba(217, 138, 11, 0.16) | 37 90% 45% | Amber tint | Chips |
| `--ppl-glass` | `rgba(255, 255, 255, 0.72)` | #ffffff @ 72% alpha | rgba(255, 255, 255, 0.72) | 0 0% 100% | Floating-layer glass | `.ppl-glass` (side sheet, dialogs, delete bar) |
| `--ppl-glass-line` | `rgba(255, 255, 255, 0.85)` | #ffffff @ 85% alpha | rgba(255, 255, 255, 0.85) | 0 0% 100% | Glass edge | `.ppl-glass` |
| `--ppl-glass-shadow` | `0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 24px 60px -24px rgba(70, 35, 90, 0.35), 0 2px 8px rgba(70, 35, 90, 0.08)` | — | — | — | Glass shadow stack | `.ppl-glass` |

### B.9 Remapped Tailwind palettes (identical in both themes)
These replace Tailwind's defaults, so any existing `slate-*`, `emerald-*`, `teal-*` class renders in the plum look.
`slate` is the neutral ramp (plum-tinted). `emerald` and `teal` are the **orchid ramp** (the legacy class names remain, the colours are mauve).
Colours that carry meaning are written as `green-*`, `red-*`, `amber-*` (Tailwind defaults) — do **not** use `emerald-*` for success.

**`slate`**

| `slate-*` step | HEX | RGB | HSL |
|---|---|---|---|
| 50 | #f7f4f8 | rgb(247, 244, 248) | 285 22% 96% |
| 100 | #efe9f1 | rgb(239, 233, 241) | 285 22% 93% |
| 200 | #ddd3e0 | rgb(221, 211, 224) | 286 17% 85% |
| 300 | #c5b8ca | rgb(197, 184, 202) | 283 15% 76% |
| 400 | #a699ad | rgb(166, 153, 173) | 279 11% 64% |
| 500 | #857790 | rgb(133, 119, 144) | 274 10% 52% |
| 600 | #655a6d | rgb(101, 90, 109) | 275 10% 39% |
| 700 | #4a424f | rgb(74, 66, 79) | 277 9% 28% |
| 800 | #322c37 | rgb(50, 44, 55) | 273 11% 19% |
| 900 | #1d1921 | rgb(29, 25, 33) | 270 14% 11% |
| 950 | #100d12 | rgb(16, 13, 18) | 276 16% 6% |

**`emerald` (orchid ramp)**

| `emerald-*` step | HEX | RGB | HSL |
|---|---|---|---|
| 50 | #fbf5fd | rgb(251, 245, 253) | 285 67% 98% |
| 100 | #f4e6f8 | rgb(244, 230, 248) | 287 56% 94% |
| 200 | #ead0f1 | rgb(234, 208, 241) | 287 54% 88% |
| 300 | #dcb0e5 | rgb(220, 176, 229) | 290 50% 79% |
| 400 | #cc93d8 | rgb(204, 147, 216) | 290 47% 71% |
| 500 | #b87cc8 | rgb(184, 124, 200) | 287 41% 64% |
| 600 | #9a6aab | rgb(154, 106, 171) | 284 28% 54% |
| 700 | #7a5a8a | rgb(122, 90, 138) | 280 21% 45% |
| 800 | #644873 | rgb(100, 72, 115) | 279 23% 37% |
| 900 | #4a3555 | rgb(74, 53, 85) | 279 23% 27% |
| 950 | #2d1f35 | rgb(45, 31, 53) | 278 26% 16% |

**`teal` (deep mauve ramp)**

| `teal-*` step | HEX | RGB | HSL |
|---|---|---|---|
| 50 | #faf5fc | rgb(250, 245, 252) | 283 54% 97% |
| 100 | #f1e5f6 | rgb(241, 229, 246) | 282 49% 93% |
| 200 | #e3cdec | rgb(227, 205, 236) | 283 45% 86% |
| 300 | #d2afe0 | rgb(210, 175, 224) | 283 44% 78% |
| 400 | #bc90cf | rgb(188, 144, 207) | 282 40% 69% |
| 500 | #a276b6 | rgb(162, 118, 182) | 281 30% 59% |
| 600 | #855f98 | rgb(133, 95, 152) | 280 23% 48% |
| 700 | #6c4d7d | rgb(108, 77, 125) | 279 24% 40% |
| 800 | #573e66 | rgb(87, 62, 102) | 278 24% 32% |
| 900 | #402e4b | rgb(64, 46, 75) | 277 24% 24% |
| 950 | #271c2e | rgb(39, 28, 46) | 277 24% 15% |

### B.10 Fixed (theme-independent) brand colours
| Name | Value | HEX / RGB / HSL | Used for |
|---|---|---|---|
| Logo tile gradient | `linear-gradient(135deg, #e2b6ea, #a679b2)` with ink `#2a1433` | #e2b6ea → #a679b2; ink rgb(42,20,51) | Sidebar/top-bar logo tile; assistant avatar. Same in both themes. |
| Selected pill (light end) | `#87699b` | rgb(135,105,155), hsl 275 20% 52% | Start of `--pill` / `--mny-grad` (both themes) |
| Selected pill (dark end) | dark `#4f3b5a` (shell pill) / `#5a4566` (Money pill, light shell pill) | rgb(79,59,90) / rgb(90,69,102) | End of the pill gradient |
| Orchid text on dark | `#dcb0e5` | rgb(220,176,229), hsl 289 50% 80% | `--accent-ink`, `--chart-line`, `--mx-orchid` (dark) |
| Orchid text on light | `#6c4d7d` | rgb(108,77,125), hsl 281 24% 40% | `--accent-ink`, `--mx-orchid` (light) |

### B.11 Data / category colours
Category colours are *data*, not brand, and are the same in both themes (`CATEGORY_COLORS` in `lib/api.js`; also embedded in §K.8):
| Category | HEX | | Category | HEX |
|---|---|---|---|---|
| Groceries | `#10B981` | | Health | `#EF4444` |
| Eating Out | `#F59E0B` | | Travel | `#14B8A6` |
| Transport | `#6366F1` | | Subscriptions | `#F97316` |
| Shopping | `#EC4899` | | Bills | `#64748B` |
| Entertainment | `#8B5CF6` | | Other / unknown | `#94A3B8` |
| Work | `#0EA5E9` | | Fitness | `#059669` |

Rules: use the colour for dots, bars and tinted icon backgrounds (hex + `26` alpha ≈ 15%); for text in a data colour use `.tint-text` (`color-mix(in srgb, var(--tint) 58%, black)` in light, `58%, white` in dark) so it keeps 4.5:1. Nutrition meal-type, workout-type and grocery-category colours follow the same rule (their maps live in the page modules shown in §K.8 where relevant).

### B.12 Semantic status colours
| Meaning | Dark text | Light text | Fill/tint | Always paired with |
|---|---|---|---|---|
| Gain / positive | `--mny-green` #62e4a4 | #0b7a52 | `--mny-green-tint` | "+" sign, arrow-down-right, the word "income" |
| Spend / negative / over budget | `--mny-neg` #ff9fac | #b4232f | `--mny-neg-tint` | "−" sign, arrow, "over budget" |
| Locked / pending / warning | `--mny-amber` #f6c46e | #8f4208 | `--mny-amber-tint` | lock icon, "locked", "pending" |
| Destructive action | `--destructive` 0 72% 56% (hsl) | 0 72% 46% (hsl) | `bg-destructive` | trash icon + confirm dialog |
| Info | none dedicated: use `--accent-ink` | | | |

### B.13 Overlays, shadows and glow colours
See §G. Scrim: dark `rgba(7, 5, 10, 0.7)`, light `rgba(40, 20, 55, 0.48)`. Pop shadow: dark `0 24px 60px -20px rgba(0, 0, 0, 0.85)`, light `0 24px 60px -22px rgba(70, 35, 90, 0.4)`.

---

## C. Typography system

**Font loading.** One Google Fonts CSS `@import` at the top of `index.css` loads: **Plus Jakarta Sans 400, 500, 600, 700** (the product face),
Manrope 300–700 (used only by the Home page's separate theme), Inter 400–900 and JetBrains Mono 500–700 (legacy/fallback), `display=swap`.
`public/index.html` additionally `<link>`s Plus Jakarta Sans 600 with `preconnect` to `fonts.googleapis.com` / `fonts.gstatic.com`.
The CSP allows only `fonts.googleapis.com` (styles) and `fonts.gstatic.com` (fonts).

**Stacks**
- Body / UI: the `body` rule uses `'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`; Tailwind's `font-sans` (used by `font-sans` utilities and the toaster) is the shorter `'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif`. Both resolve to Plus Jakarta Sans.
- Mono (code only): `'JetBrains Mono', ui-monospace, monospace` (`font-mono`, `.lm-money` in assistant replies). **Money figures are NOT monospace**:
  `.stat-num` = `font-family: inherit; font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1`. Plus Jakarta Sans has true tabular numerals
  (measured: "1111" and "0000" render at identical width).
- Rendering: `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale`.

**Weights in use:** 400 body · 500 controls, nav, Money page title · 600 headings, figures, active states · **700** the wordmark, `SectionHeading` page titles (non-Money pages) and the occasional strong figure.

**Scale actually used** (Tailwind rem scale, 16px root; measured in the app where noted)
| Role | Size / weight / tracking / line-height | Notes |
|---|---|---|
| Money page title `.mx-title` | `clamp(1.75rem, 3.6vw, 2.5rem)` (40px at ≥1111px wide), 500, `-0.025em`, 1.1 | measured 40px / 500 |
| Other page titles (`SectionHeading`) | `text-xl sm:text-2xl` (20 → 24px), 700, `tracking-tight` | |
| Section / card heading `.mx-h` | 1.0625rem (17px), 600 | `<h3>` |
| shadcn card title | 600, `leading-none tracking-tight` | |
| Dialog title | `text-lg` (18px), 600, `leading-none tracking-tight` | |
| Hero figure `.mx-fig` | `text-[2.5rem] sm:text-[3rem]` (40/48px), 600, `-0.03em`, 1.05, tabular | measured 48px / 600 |
| Row/tile figure | `text-lg`–`text-xl` (18–20px), 600 | |
| Body | 14–16px (`text-sm` 14px most controls; base 16px), 400 | |
| Secondary / caption | 12–14px (`text-xs` 12px, `text-sm`), `--muted-foreground` / `--mny-muted` | |
| Micro | 11px (`text-[11px]`), 10px in the mobile bottom nav (`text-[10px]` 500) | |
| Button | 14px (`text-sm`), 500, nowrap | `sm` size 12px |
| Input | 16px on phone (`text-base`), 14px from `md` (`md:text-sm`) | prevents iOS zoom |
| Pill (Money) | 14px, 500; small pill 12px | |
| Nav item | 14px, 500 | |
| Badge | 12px, 600 | |
| Chart ticks | 11px, `--muted-foreground` | |

Line-height defaults to Tailwind's per-size values; headings use `leading-none`/`1.1`. No text-transform is used except `capitalize`
on payment-method pills. There are **no uppercase eyebrow labels above headings** (deliberately removed). `text-wrap: balance` is not used in this theme.

**Responsive:** the page title uses `clamp`; figures step 40 → 48px at `sm` (640px); inputs step 16 → 14px at `md` (768px). No other fluid type.

---

## D. Spacing and layout system

**Spacing scale:** Tailwind's 4px scale. Habitual values: card padding `p-5` (20px) → `sm:p-6` (24px); gap between cards `gap-4` (16px) (`sm:gap-5` on the Money stage);
inner groups `gap-2`–`gap-3`; list-row padding `px-5 py-3`; tile padding `p-3`–`p-3.5`; section vertical rhythm `space-y-4 sm:space-y-5`.

**Radii (rendered):**
| Element | Radius |
|---|---|
| Buttons, inputs, selects, tab list & triggers, pills, chips, nav items, FAB, avatars | `9999px` (fully round) |
| Textarea | 16px (`rounded-2xl`) |
| Money/Settings/Profile card `.mny-card` | 28px |
| Shared card `.card-ambient` (`Card`) | 24px |
| Dialog / alert dialog / sheet (bottom) | 24px (`rounded-3xl`) / sheet bottom sheet top corners 24px |
| Popover / dropdown / select menu | 16px (`rounded-2xl`); menu items 12px (`rounded-sm` = `--radius`−4px) |
| Money tile `.mny-tile` | 20px |
| Stage `.mny-stage` / `.mny-theme` | 32px (Money page); `.mny-stage` base 1.75rem = 28px |
| People stage | 1.75rem (28px); solid surface 1.25rem (20px) |
| Skeleton block | 8px (`0.5rem`) default; pills/avatars use `!rounded-full` |
| Tailwind overrides | `rounded-lg` = 16px, `rounded-md` = 14px, `rounded-sm` = 12px |

**Containers & grid**
- App content: `max-w-7xl` (1280px) centred, horizontal padding `px-4 sm:px-6`, vertical `py-6`, bottom `pb-40` on phone (clears the bottom bar and FAB) / `lg:pb-24`.
- Sidebar offset: content gets `lg:pl-16` (collapsed rail) or `lg:pl-60` (docked, 240px).
- Header height 64px (`h-16`); bottom bar height 64px.
- Money dashboard grid: `grid gap-4 md:grid-cols-2 lg:grid-cols-12`; top row 4/4/4 columns (total + flow, accounts, period), second row 8/4 (chart, category), third row 6/6.
- Settings / Profile use two-column layouts inside the stage; People uses a 2-up summary then a directory list.

**Breakpoints (Tailwind defaults, not customised):** `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536.
- `< lg` (1024): sidebar hidden; bottom navigation (Home, Money, People, Tasks, More) + floating Quick Add above it; content padding bottom 160px.
- `≥ lg`: sidebar rail/dock, no bottom bar; Quick Add bottom-right `bottom-6 right-6`.
- Phone targets: header buttons are 44px (`h-11 w-11`), 40px from `sm`; bottom-nav items ≥ 44px tall.
- Horizontal overflow is never allowed: scrollable pill rows are internal (`overflow-x-auto scrollbar-hide`).

---

## E. Component design specifications

Colours below are token names; resolve them with §B. "Both themes" means the token value changes with the theme but the structure does not.

> **Selected-tab fill:** implemented as `data-[state=active]:bg-[image:var(--pill)] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]` (a background-image utility that reads the token; a plain custom class cannot be used as a Tailwind variant). Verified in both themes: the selected tab renders the `--pill` gradient.

### E.1 Buttons (`components/ui/button.jsx`)
Base (all variants): `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium`,
`transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]`,
`active:scale-[0.97]`, focus: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`,
disabled: `opacity-50 pointer-events-none`, inner icons `size-4` (16px), `shrink-0`. Reduced motion: no transition, no press scale.

| Variant | Classes | Appearance |
|---|---|---|
| **default (primary)** | `bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-primary/85` | Mauve fill (`hsl 280 21% 40%` light / `44%` dark), white text, 1px top highlight; hover = 85% opacity |
| **destructive** | `bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90` | Red fill, white text |
| **outline** | `border border-line-strong bg-field hover:bg-hover` | Field-coloured pill with firm outline |
| **secondary** | `bg-hover text-secondary-foreground hover:bg-hover` | Neutral wash; **hover shows no change** (same token) |
| **ghost** | `hover:bg-accent hover:text-accent-foreground` | No fill until hover |
| **link** | `text-primary underline-offset-4 hover:underline` | Text only |

Sizes: `default h-10 px-5 py-2` (40px) · `sm h-8 px-3.5 text-xs` (32px) · `lg h-11 px-8` (44px) · `icon h-10 w-10`.
Other button recipes used app-wide (all pills):
- **CTA pill** (`.cta-fill`: `background: var(--cta); color: var(--cta-ink)`): the single most important action in a view — Add expense, New chat, send, Quick Add. Dark: light orchid `#ecc9f2 → #c795d3` with ink `#2a1433`. Light: deep mauve `#876096 → #6b4f7b` with white (≥ 5.07:1 at the lighter end).
  Money variant `.mny-cta` adds `box-shadow: var(--mx-cta-shadow)` (inset top highlight + a coloured drop shadow, dark `0 12px 26px -14px rgba(220,150,235,.7)`).
- **Selected pill** (`.pill-fill` / `.mny-pill[aria-pressed=true]`): `--pill` gradient, white text, inset highlight `rgba(255,255,255,.22)`, no border.
- **Resting pill** (`.mny-pill`): height 40px (small 32px), padding `0 1.15rem` (small `0 0.85rem`), `1px` outline `--mx-pill-edge`, fill `--mx-pill`, text `--mny-text`, 14px/500.
- **Icon button** (`.mny-icon-btn`): 32×32 round, `--mny-muted` → `--mny-text` on hover with `--mny-surface-2` fill; danger variant turns `--mny-neg` on hover.
- **Header buttons** (assistant, theme toggle, profile): `h-11 w-11` phone / `h-10 w-10` ≥sm, round, `border-line-strong bg-field`, hover `bg-hover`, `active:scale-95`. The Assistant button is a pill (`h-10 px-4 gap-2`) with a sparkles icon in `text-accent-ink` that rotates 18° and scales 1.1 on hover.
- **Floating Quick Add (FAB)**: 56px round, `cta-fill`, fixed `bottom: calc(5rem + safe-area)` right 16px on phone, `lg:bottom-6 lg:right-6`; shadow from the tokens `--fab-shadow` / `--fab-shadow-hover` (§G table); `+` icon 24px rotates 90° on hover/focus; on `lg` an "Add" label expands from 0 to 5rem on hover/focus. Focus ring `ring-emerald-600` (orchid-600 `#9a6aab`) with offset 2.
- States: hover = brightness/opacity change (`hover:brightness-105` on CTA); active = scale .97 (FAB: Framer `whileTap` `scale .92` is what pointer users see; the CSS `active:scale-95` only applies when Framer's tap is disabled, i.e. with reduced motion); disabled = 50% opacity (pill: dashed border, 60% opacity); loading = replace label with `Loader2` spinner (`animate-spin`).

### E.2 Inputs, search, textarea, select
| Control | Classes (structure) | Notes |
|---|---|---|
| Input | `flex h-10 w-full rounded-full border border-line-strong bg-field px-4 py-1 text-base md:text-sm shadow-sm transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed` | 40px; 36px in Money (`mny-field h-9`) |
| Search field | Input with leading `Search` icon (16px, `--mny-muted`, `left-3`), `pl-9`, clear button `X` at `right-2.5` | |
| Textarea | `min-h-[60px] rounded-2xl border-line-strong bg-field px-4 py-2.5` | 16px radius, not pill |
| Select trigger | `h-10 w-full rounded-full border-line-strong bg-field px-4 py-2 text-sm hover:border-line-strong focus:ring-1 focus:ring-ring` + chevron | |
| Select menu | `rounded-2xl border border-line bg-popover shadow-[var(--pop-shadow)]`, items `rounded-sm py-1.5 pl-2 pr-8 text-sm focus:bg-accent focus:text-accent-foreground`, check icon at right | opens with fade + zoom-95 + slide-2 |
| Money field `.mny-field` | `background: var(--mx-field); border-color: var(--mx-field-edge); border-radius: 9999px` | dark: `rgba(0,0,0,.38)` / `rgba(255,240,255,.2)`; light: `rgba(255,255,255,.92)` / `rgba(70,35,90,.28)` |
| Number inputs | browser spinners removed | quantities use in-app steppers |

Focus: 1px ring in `--ring` (dark orchid `#dcb0e5`-ish `hsl 297 48% 76%`, light `hsl 280 32% 46%`). Placeholder `--muted-foreground`. Disabled: 50%.

### E.3 Checkbox, radio, switch
- Checkbox: 18.4px (`1.15rem`) square, `rounded-[0.4rem]`, `border-2 border-slate-300` (dark `slate-600`), fill on checked/indeterminate `bg-primary`, check `text-primary-foreground`; hover `border-primary`; transition `all 150ms`; focus ring 2px + offset 2.
- Switch: 36×20px track (`h-5 w-9`), `rounded-full`, checked `bg-primary`, unchecked `bg-input`, 16px thumb `bg-background` translating 16px, `transition-colors` / `transition-transform`.
- Radio group (Settings theme choice) is a custom radiogroup: tiles `rounded-2xl p-1.5` with a mini preview, selected ring `border-2` in `--mx-orchid`, ring slides between options via Framer `layoutId`, spring `stiffness 500 damping 40`.

### E.4 Cards, tiles and dashboard widgets
| Element | Spec |
|---|---|
| **Shared card** (`Card`, `.card-ambient`) | radius 24px · fill `--card-fill` · 1px `--line` border · shadow `--card-edge` · hover border → `--line-strong` over 220ms (no pointer light) |
| **Money card `.mny-card`** | radius 28px · fill `--mx-card` · border `--mx-edge` · direct children lifted above a pointer-light layer · hover border `--mx-edge-hover`; padding `p-5 sm:p-6` |
| **Hero card `.mny-hero`** | border `color-mix(in srgb, var(--mx-orchid) 35%, transparent)` |
| **Tile `.mny-tile`** | radius 20px · `--mx-tile` fill · `--mx-tile-edge` border |
| **Round badge `.mny-badge`** | 40px circle · `--mx-badge` fill · orchid glyph |
| **Watchlist row `.mx-asset`** | `padding: 14px 0`, hairline `--mx-hair` between rows (first row no top rule) |
| **Bloom / arc** | `.mx-bloom::after` (top-right radial bloom, blur 8px) on the total card; `.mx-glow::after` (bottom arc of light) on the flow card |
| **Stat figure** | `.mx-fig` 600, `-0.03em`; labels 12–14px `--mny-muted`; hint 11px |
| **Progress bar** `.mny-bar` | 8.8px (`0.55rem`) track, pill, fill gradient; ≥80% `warn`, over `over`; `role="progressbar"` with `aria-valuenow` |
| **State chip `.mny-state`** | inline-grid pill, 11px/600, tinted fill (green / amber / neg) |
| **Chip `.mx-chip`** | pill, 12px/600, `--mx-chip` fill + `--mx-chip-edge` outline |

### E.5 Navigation
- **Sidebar** (`≥lg`): fixed left, rail 64px → 240px; `border-r border-line backdrop-blur-xl`, fill `--sidebar` (docked) or `bg-card` (floating peek, with `--pop-shadow`); width/box-shadow transition 300ms expo-out; labels fade 200ms. Header 64px with logo tile (32px, `rounded-xl`, gradient) + "Life Record" 700. Nav items: `rounded-full px-[11px] py-2.5 text-sm font-medium`, 18px icons; inactive `text-muted-foreground`, hover `bg-hover text-foreground`; **active**: white text over a gradient `--pill` pill (`motion.span layoutId="nav-pill"`, spring `stiffness 420, damping 38`) that slides between items. Pin button 32px round. Footer: "Sign out" row.
- **Top bar**: `sticky top-0 z-20 h-16 border-b border-line`, `.glass` (blur 22px saturate 150%), content width matches page (`max-w-7xl`), right-aligned: Assistant pill, theme toggle, profile avatar button; on phone the logo shows left.
- **Mobile bottom bar**: `fixed bottom-0 h-16 glass-strong border-t border-line`, 4 items + More; item `px-4 py-1.5 rounded-full text-[10px] font-medium`, icons 20px; active = white text over the sliding `--pill` pill (`layoutId="mnav-pill"`, same spring); `active:scale-95`; More opens a **bottom sheet** (`rounded-t-3xl`, 3-column grid of `rounded-2xl` tiles, selected tile `--pill` gradient; "Sign out" full-width pill).
- **Tabs** (shadcn `Tabs`, Groceries/Nutrition): list `h-10 rounded-full border border-line bg-field p-1 text-muted-foreground`; trigger `rounded-full px-4 py-1.5 text-sm font-medium`; selected = `--pill` gradient + white text. Panels fade up on activation (§F).
- **Period / filter pills** (Money): scroll-snap row of `.mny-pill` with `aria-pressed`; selected uses `--mny-grad`.

### E.6 Overlays
- **Dialog / alert dialog**: overlay `bg-scrim backdrop-blur-md`; content `fixed centre, w-[calc(100%-1.5rem)] max-w-lg max-h-[92vh] rounded-3xl border border-line [background:var(--card-fill)] p-6 shadow-[var(--pop-shadow)]`, grid gap 16px; title 18px/600; description 14px muted; footer buttons right-aligned (stacked reversed on phone). Close button top-right 24px.
- **Sheet**: same overlay; panel `border border-line bg-background p-6 shadow-[var(--pop-shadow)]`, side sheets `w-3/4 sm:max-w-sm`, bottom sheet full-width.
- **Popover** `w-72 rounded-2xl border-line bg-popover p-4 shadow-[var(--pop-shadow)]`; **dropdown / context menu** `rounded-2xl border-line bg-popover p-1.5 min-w-[8rem]`, item `rounded-sm px-2 py-1.5 text-sm`, focus `bg-accent`.
- **Tooltip** (`Hint`): `rounded-lg bg-foreground text-background px-2.5 py-1.5 text-xs font-medium shadow-md` — inverted colours in both themes (light chip on dark, dark chip on light).
- **Toast** (Sonner): top-centre, `rounded-2xl border border-line bg-popover shadow-[var(--pop-shadow)]`, close button, description `text-muted-foreground`. Sonner's `theme` prop follows the saved choice (`light` / `dark` / `system`).
- **Assistant window** (`AIAssistant`): scrim `bg-scrim` + animated backdrop blur to 6px; panel `glass-strong border border-line` with a top-right `radial-gradient(70% 45% at 85% -10%, hsl(var(--primary)/0.2), transparent 70%)`, `shadow-[var(--pop-shadow)]`, desktop `h-[min(780px,calc(100dvh-3rem))] max-w-[1060px] rounded-3xl`, phone `h-[calc(100dvh-2.5rem)] rounded-t-3xl` bottom sheet. Left rail 280px `border-r border-line bg-field`. User bubble: `.pill-fill`, `rounded-3xl rounded-br-lg px-4 py-2.5 text-[14px]`, max 85% width. Assistant avatar 28px `rounded-lg` logo gradient. Suggestion chips `rounded-2xl border border-line bg-field px-3.5 py-3 text-sm hover:bg-hover`. Composer: `rounded-[1.375rem] border border-border bg-card p-2`, focus-within ring orchid 20%, send button 36px round `.cta-fill`. Typing indicator: three 6px dots in orchid. Streaming caret: 0.5ch × 1.05em orchid bar, blink `steps(2, jump-none)`.

### E.7 Tables, lists, rows
- **Transaction/list row** `.mny-row`: `px-5 py-3`, 40px round icon (data colour at ~15% alpha + 12px dot or arrow), title 14px/500, meta 12px muted, figure right-aligned 14px/600 tabular; hover/focus-within wash `--mx-row`; row actions fade in on hover (`sm:opacity-0 group-hover:opacity-100`, 0→1).
- **Date group header**: `sticky top-0 z-10 border-y bg-[var(--mny-surface-2)] px-5 py-1.5 text-xs font-semibold` with the day's net figure on the right.
- **People directory**: grid-like rows with a header (`Person / They owe you / You owe`), 36–40px avatar initials (orchid tint), row hover wash; "Debt" and "Payment" pills; select checkboxes; delete uses a top "bar" glass layer (`.ppl-glass`).
- **Kitchen / grocery lists**: rows with 40px icon badge, name 14px/500, meta 12px muted, `Add` pill.

### E.8 Badges, chips, status
`Badge` (shadcn): `rounded-md border px-2.5 py-0.5 text-xs font-semibold` — default (primary), secondary, destructive, outline. Confidence badges (`common.jsx`): pill, 11px/600, tinted 50/500-alpha pairs (exact / estimated / historical / unknown). Money status chips `.mny-state`. Priority/label dots 8px.

### E.9 Charts and statistics (Recharts)
- Area chart (Money): stroke `var(--chart-line)` 2.5px, fill gradient top 34% → 0% of `--chart-line`, `type="monotone"`, grid horizontal-only `--chart-grid`, ticks 11px `--muted-foreground`, no axis lines/ticks, dashed cursor (`3 5`) in `--line-strong`, active dot r=7 (`fill: var(--tip-bg)`, stroke `--chart-line`, width 4). Mount animation 1100ms ease-out.
- Donut: inner 48 / outer 76, padding angle 3, data colours.
- Bars: income `var(--mny-green)`, expense `var(--chart-line-soft)`, radius 7, 14px thick, 900ms.
- Line (Body weight): stroke `--chart-line` 2.5px, dots r=3 (`--chart-line`), active dot r=6, 1000ms.
- Energy bars (Nutrition trends): `--chart-line-soft` fill, reference line dashed `--chart-line`.
- Tooltip: `--tip-bg` fill, `--line` border, 16px radius, `--pop-shadow`, 12px text, label/items `--tip-ink`.
- Statistic tiles: label (12–14px muted) over a figure (`.mx-fig`, tabular) over a hint (11–12px muted).

### E.10 Skeletons, empty and error states
- **Skeleton** `.skeleton`: `border-radius 8px; background: var(--skeleton)`; a `::after` sweep `linear-gradient(90deg, transparent, var(--skeleton-sweep), transparent)` translating −100% → 100% over **1.5s ease-in-out infinite**. Placeholders mirror real markup (`[data-skeleton]` wrapper makes `.mny-num`/`.sk-ph` keep their box but lose their ink and show the sweep). Group announcements are a single `role="status"`. Real content replaces a skeleton with `.sk-reveal` (opacity 0→1, 260ms `cubic-bezier(.2,0,0,1)`).
- **Empty state**: centred, `py-14 px-6`, 56px round `.mny-badge` icon, title 600, one-line muted explanation (max-width 24rem), a CTA pill when an action exists.
- **Error block** (`ErrorBlock`): `rounded-2xl border border-dashed border-border px-5 py-8` centred, 20px amber alert icon, "Could not load X." 14px/500, "Nothing is lost. Check your connection and try again." 12px muted, outline "Try again" pill with a rotate icon. `role="alert"`.
- Offline banner: full-width amber strip `bg-amber-700 text-white text-sm font-medium`.

---

## F. Animation and motion design system

**Philosophy.** Motion explains change and rewards attention; it never delays content. One easing family dominates — **expo-out
`cubic-bezier(0.16, 1, 0.3, 1)`** — fast start, long soft settle. Small feedback is 120–220ms; structure (pages, cards) 420–700ms;
only physical things (the sliding nav pill, the FAB, the mobile sheet) use springs. Entrances animate **opacity + a short rise (8–14px)**
(optionally a few px of blur); nothing bounces; nothing overshoots except the very light FAB spring. Exits are faster and quieter than entrances.

**Tokens**
```css
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);   /* the house curve */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);       /* small colour/width changes */
--ease-in:       cubic-bezier(0.4, 0, 1, 1);       /* exits (assistant) */
--dur-press: 120ms;  --dur-hover-fast: 160ms;  --dur-hover: 220ms;  --dur-card: 220ms;
--dur-panel: 380ms (tab panel) to 460ms (page);  --dur-enter: 620ms (blocks) to 700ms (Money);  --stagger: 55ms (blocks) / 65ms (Money);
```

| # | Where | Trigger | Properties (from → to) | Duration / easing | Delay / stagger | Theme difference |
|---|---|---|---|---|---|---|
| 1 | Page container `.lm-page` (`AppShell`, remounted per route via `key`) | route change | opacity 0→1, translateY 10px→0 | 460ms expo-out, `both` | none | none |
| 2 | Page blocks `.lm-page > * > :nth-child(-n+10)` (excl. `.mx-rise`, `.hm-rise`) | mount | opacity 0→1, translateY 14px→0 | 620ms expo-out | child *n*: `(n−1)·55ms` for 2–8; ≥9 = 440ms | none |
| 3 | `.lm-in` cards (StatCard etc.) | mount | opacity, translateY 12→0, blur 5px→0 | 600ms expo-out | none | none |
| 4 | Radix tab panel `[role=tabpanel][data-state=active]` | tab chosen | opacity 0→1, translateY 8px→0 | 380ms expo-out | none | none |
| 5 | Money blocks `.mx-rise` | mount | opacity 0→1, translateY 12→0, blur 6px→0 | 700ms expo-out | `i·65ms`, `i` = 0…10 set inline | none |
| 6 | `.mx-appear` (figures replacing placeholders) | data arrives | opacity 0→1, blur 4px→0 | 420ms expo-out | none | none |
| 7 | Budget bars `.mny-bar > span` | mount / value change | `transform: scaleX(0)→1` (origin left); width transition on change | 900ms expo-out (mount), 500ms `cubic-bezier(.2,0,0,1)` (width) | 300ms | none |
| 8 | Buttons (`Button`) | hover / press | background, border, colour, transform, shadow; press `scale(.97)` | 200ms expo-out | — | none |
| 9 | Pills `.mny-pill` | hover / press | background, border, colour 180ms; transform 120ms; press `scale(.97)` | expo-out | — | none |
| 10 | Shared card `.card-ambient` | hover (mouse) | border-colour → `--line-strong`, 220ms. **No pointer light.** |
| 10b | Money / Settings / Profile card `.mny-card` | hover (mouse) | border → `--mx-edge-hover` 220ms; pointer-light layer (`::before`) opacity 0→1 over 300ms, centred on the pointer: `--mx/--my` (px) are set by one delegated `pointermove` handler on the stage (§K.2), mouse only | expo-out | — | glow colour differs (§B tokens `--mx-glow`) |
| 11 | Sidebar | pointer enters / leaves, pin | width 64↔240px + box-shadow 300ms expo-out; labels opacity 200ms; retract on choose | | 220ms close delay | none |
| 12 | Nav pill (`layoutId="nav-pill"`, `"mnav-pill"`) | route change | shared-layout move between items | spring `stiffness 420, damping 38` | — | none |
| 13 | Nav items / mobile items | hover / press | colour 200ms; mobile `active:scale-95` | | | |
| 14 | Floating Quick Add | mount; scroll down/up on phone | enter: opacity 0→1, scale .7→1, y 16→0 spring `damping 22 stiffness 320`, delay .35s; hide: opacity 0, y 24, 180ms expo-out; hover y −2; tap scale .92; `+` rotates 90° (300ms); "Add" label expands (300ms) | | | none |
| 15 | Assistant button sparkles | hover | rotate 18°, scale 1.1 | 300ms expo-out | | |
| 16 | Dialog / alert dialog | open / close | content: fade + zoom 95→100 (+ `slide`), overlay fade (tailwindcss-animate) | content `duration-300 ease-[expo-out]`; overlay default 150ms | — | none |
| 17 | Sheet | open / close | slide from side/bottom | open 500ms / close 300ms expo-out | | |
| 18 | Popover, dropdown, context menu, select, hover-card | open / close | fade + zoom-95 + 2-unit slide from the anchored side | tailwindcss-animate default (150ms) | | |
| 19 | Assistant (desktop) | open | scrim: opacity + backdrop blur 0→6px 320ms expo-out. Panel: opacity 0→1 200ms linear; scale .96→1 and y 18→0, 440ms expo-out; transform-origin `88% 0%` (the button's corner). Exit 160ms ease-in to opacity 0, scale .985, y 8 | | header slides from y −8 (delay .10s), left rail from x −12 (delay .14s), each 420ms expo-out; suggestion chips y 8→0, 400ms, delay `.28 + i·.05` s | none |
| 20 | Assistant (phone) | open / close | bottom sheet from y 100% | spring `damping 34 stiffness 360`; exit 240ms ease-in | | |
| 21 | Assistant chat menu (phone) | open | slides from left | spring `damping 34 stiffness 380`; scrim 150ms | | |
| 22 | Typing indicator `.lm-typing i` | streaming | translateY 0→−4px, opacity .45→1 | 1.2s ease-in-out infinite | dots delayed 0 / .15 / .3s | colour `color-mix(in srgb, var(--accent-ink) 70%, transparent)` — follows the theme |
| 23 | Streaming caret | streaming | blink | 1s `steps(2, jump-none)` infinite | | colour `var(--accent-ink)` — follows the theme |
| 24 | Skeleton sweep | loading | translateX −100%→100% | 1.5s ease-in-out infinite | | sweep colour from `--skeleton-sweep` |
| 25 | Skeleton → content `.sk-reveal` | data arrives | opacity 0→1 | 260ms `cubic-bezier(.2,0,0,1)` | | |
| 26 | Charts | mount | Area 1100ms ease-out; Bars 900ms; Line 1000ms | | | |
| 27 | `.pulse-ring` | attention | box-shadow ring 0→14px, opacity 40%→0 | 2.4s infinite | | `color-mix(in srgb, var(--accent-ink) 40%, transparent)` |
| 28 | Row action buttons | row hover/focus-within | opacity 0→1 | `transition-opacity` (150ms default) | | |
| 29 | Checkbox | toggle | all properties | 150ms | | |
| 30 | **Theme switching** | user toggles theme | **No transition is implemented**: the `dark` class flips and colours change instantly. Do not add a global `* { transition }`. | | | |

**Reduced motion and the Animations setting.** Two independent switches both disable motion:
1. `@media (prefers-reduced-motion: reduce)`: every keyframe animation above is set to `none` (`.lm-page`, block stagger, tab panels, skeleton sweep, typing, caret, `.mx-*`), transitions are removed from cards/pills, Button transitions and press-scale are removed (`motion-reduce:*`), Framer uses `useReducedMotion()` (assistant becomes a 120ms opacity fade, FAB and nav pill become instant).
2. The **Animations** setting in Settings adds class `no-anim` to `<html>`; every rule has a `.no-anim …{ animation: none !important }` twin.
Any new animation MUST ship with both overrides.

---

## G. Shadows, depth, transparency and effects

**Elevation levels**
| Level | Use | Dark | Light |
|---|---|---|---|
| 0 — canvas | body | `--background` + `--haze` | `--background` + `--haze` |
| 1 — card | `.card-ambient` | `inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 22px 44px -30px rgba(0, 0, 0, 0.85)` | `inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 2px rgba(70, 35, 90, 0.06), 0 20px 44px -28px rgba(70, 35, 90, 0.34)` |
| 2 — card hover | | border brightens to `--line-strong`; pointer light fades in | same |
| 3 — floating | dialogs, sheets, popovers, menus, assistant, expanded sidebar | `0 24px 60px -20px rgba(0, 0, 0, 0.85)` | `0 24px 60px -22px rgba(70, 35, 90, 0.4)` |
| CTA pill `.mny-cta` | | `0 12px 26px -14px rgba(220,150,235,.7)` | `0 12px 26px -14px rgba(107,79,123,.7)` |
| Floating Quick Add (FAB) | | `0 12px 28px -10px rgba(200, 140, 220, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4)` (hover `0 18px 34px -12px rgba(200, 140, 220, 0.65), 0 3px 8px rgba(0, 0, 0, 0.45)`) | `0 12px 28px -10px rgba(107, 79, 123, 0.6), 0 2px 6px rgba(70, 35, 90, 0.22)` (hover `0 18px 34px -12px rgba(107, 79, 123, 0.7), 0 3px 8px rgba(70, 35, 90, 0.28)`) |

Rules: shadows always have a **y offset and a long blur with negative spread**; the 1px top highlight (`inset 0 1px 0 rgba(255,255,255,.06–.95)`) is what makes a card read as glass. No zero-offset coloured halos around cards; no hard offset shadows.

**Glass / blur**
- `.glass` (top bar): `background: var(--glass); backdrop-filter: blur(22px) saturate(150%)`.
- `.glass-strong` (bottom bar, assistant): `background: var(--glass-strong); backdrop-filter: blur(28px) saturate(160%)`.
- Sidebar: `backdrop-blur-xl` over `--sidebar`.
- Overlays: `bg-scrim backdrop-blur-md`; assistant scrim blur animates 0→6px.
- **Glass belongs on floating/structural layers only** (header, bottom bar, sidebar, overlays, assistant, People's side sheet/dialogs/delete bar). Content cards are opaque-ish gradient fills, not blurred.
- Fallback: where `backdrop-filter` is unsupported People's glass falls back to `--ppl-surface`.

**Haze.** `--haze` (3 radial gradients, `background-attachment: fixed`) sits behind everything; the Money/Settings/Profile stage repeats it with its own `--mny-lights`. Cards must stay readable without it.

**Focus rings.** Controls: `ring-2 ring-ring ring-offset-2 ring-offset-background` (inputs/selects 1px). Stage pages: `outline: 2px solid var(--mx-orchid); outline-offset: 3px`. People: `2px solid var(--ppl-teal-text)`, offset 2px. Never remove focus visibility.

**Selection.** `::selection` = mauve at 30% (`rgba(160,110,190,.3)`; Money stage `--mx-selection`).

**Scrollbars.** 8px, thumb `var(--scroll)` (hover `--line-strong`), `scrollbar-color` for Firefox; horizontal pill rows use `.scrollbar-hide`.

**Where not to use effects:** no blur on list rows or tiles; no gradient text; no glow on text; at most one CTA pill (the light-orchid / deep-mauve `--cta` gradient) per view — selected-state pills (`--pill` gradient) may appear as often as there are selections.

---

## H. Interaction and state specifications
| State | Rule |
|---|---|
| Hover | Fill → `--hover` / `--mx-pill-hover`, border → `--line-strong`, text → foreground; cards add the pointer light (mouse only, `@media (hover: hover)`). Never change layout. |
| Focus | Visible ring/outline as in §G on every interactive element; keyboard focus on the sidebar opens it (peek). |
| Active / pressed | `scale(.97)` (buttons, pills), `.95` (nav items, header buttons, FAB), 120ms. |
| Selected | Gradient `--pill` + white text (`aria-pressed="true"` pills, active nav, active tab, user bubble); ring in orchid for radio tiles; `aria-selected`/`aria-current` always set. |
| Disabled | 50% opacity, `pointer-events: none`; Money pills: dashed outline, 60%, muted text. Months in the future: "· soon". |
| Loading | Skeleton mirroring the real layout; buttons swap their label for a spinner; one polite `role=status` per group; `aria-busy`. |
| Success | Sonner toast (`toast.success`), inline "Saved" badge in Settings; no confetti. |
| Error | Inline `role=alert` text with recovery ("Try again"), `ErrorBlock` for sections, never a bare skeleton that waits forever; field errors in `--destructive`/`--mny-neg`. |
| Open/closed, expanded/collapsed | Radix `data-[state]` animations (§F); sidebar width transition; Collapsible content for places. |
| Dragging | Not used. |
| Theme switch | Instant; `localStorage lm_theme` + synced to the account preference; System follows the OS live. |

---

## I. Light mode specification (standalone)
**Mood:** lilac and ivory. Paper-white glass cards on a pale lilac haze; ink is a deep plum-black; the mauve gradient is identical to dark so
selection looks the same in both themes.

- **Canvas:** `--background` 290 26% 96% = #f7f2f7; haze = radial-gradient(75% 55% at 82% -10%, rgba(196, 160, 214, 0.5), transparent 72%), radial-gradient(55% 42% at 0% 6%, rgba(214, 186, 226, 0.35), transparent 70%), radial-gradient(60% 40% at 50% 115%, rgba(200, 165, 215, 0.3), transparent 70%).
- **Text:** `--foreground` #201424; secondary `--muted-foreground` #67556d; accent ink `#6c4d7d`.
- **Card:** `linear-gradient(180deg, #ffffff, #fbf8fc)`, border `rgba(70, 35, 90, 0.14)`, shadow `inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 2px rgba(70, 35, 90, 0.06), 0 20px 44px -28px rgba(70, 35, 90, 0.34)` (a white top highlight plus a long lilac-tinted shadow).
- **Controls:** fill `rgba(255, 255, 255, 0.85)`, outline `rgba(70, 35, 90, 0.3)`, hover wash `rgba(90, 50, 110, 0.07)`; default button = `hsl(280 21% 40%)` with white text.
- **Glass:** sidebar `rgba(255, 255, 255, 0.78)`, header `rgba(255, 255, 255, 0.74)`, bottom bar/assistant `rgba(255, 255, 255, 0.94)`.
- **CTA:** `linear-gradient(180deg, #876096, #6b4f7b)` with white text (deeper than dark so it holds against white). Selected pill `linear-gradient(135deg, #87699b, #5a4566)`, white text.
- **Overlay:** scrim `rgba(40, 20, 55, 0.48)` with `backdrop-blur-md`; floating shadow `0 24px 60px -22px rgba(70, 35, 90, 0.4)`.
- **Charts:** line `#7a5a8a`, soft `#9a6aab`, grid `rgba(70, 35, 90, 0.1)`, tooltip `#ffffff` on `#231a28`.
- **Money stage:** base `#f5eff7`, surface `#ffffff`, text `#231a28`, muted `#65586d`, gain `#0b7a52`, spend `#b4232f`, locked `#8f4208`.
- **Contrast floor overrides (light):** `text-slate-400/500` → `--muted-foreground`; `text-emerald-500/600` → `#6c4d7d`; `text-red-500` → `#c2262e`; `text-amber-600` → `#a24a08`.
- **Differences from dark beyond colour:** cards gain a real drop shadow (dark relies on the haze); borders are plum at 12–14% instead of white-pink at 10–12%; the CTA is a *deep* mauve with white ink instead of a *light* orchid with dark ink; tooltips (Hint) invert to a dark chip.
- **Status:** rendered and reviewed on Money, Groceries, Settings, People and Home, and it passes the automated axe colour-contrast audit on every page, dialog, empty state and public page at desktop, tablet and phone widths (2026-11-04).

## J. Dark mode specification (standalone)
**Mood:** plum-black with a visible mauve haze; cards are near-black glass; the accent is a *light* orchid so it glows against the dark.

- **Canvas:** `--background` 285 12% 5% = #0e0b0e; haze = radial-gradient(75% 55% at 82% -10%, rgba(150, 118, 160, 0.42), transparent 72%), radial-gradient(55% 42% at 0% 6%, rgba(120, 96, 132, 0.18), transparent 70%), radial-gradient(60% 40% at 50% 115%, rgba(140, 105, 150, 0.16), transparent 70%).
- **Text:** `--foreground` #f6eff6; secondary #b8abba; accent ink `#dcb0e5`.
- **Card:** `linear-gradient(180deg, rgba(255, 240, 255, 0.05), rgba(255, 240, 255, 0.012)), #0e0b10` (a faint pink-white wash over `#0e0b10`), border `rgba(255, 232, 255, 0.12)`, shadow `inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 22px 44px -30px rgba(0, 0, 0, 0.85)`.
- **Controls:** fill `rgba(0, 0, 0, 0.35)` (translucent black, so they look inset), outline `rgba(255, 232, 255, 0.22)`, hover `rgba(255, 255, 255, 0.08)`; default button `hsl(280 21% 44%)` white text.
- **Glass:** sidebar `rgba(13, 10, 16, 0.75)`, header `rgba(16, 13, 18, 0.72)`, bottom bar/assistant `rgba(14, 11, 16, 0.92)`.
- **CTA:** `linear-gradient(180deg, #ecc9f2, #c795d3)`, ink `#2a1433`. Selected pill `linear-gradient(135deg, #87699b, #4f3b5a)`.
- **Overlay:** scrim `rgba(7, 5, 10, 0.7)`; floating shadow `0 24px 60px -20px rgba(0, 0, 0, 0.85)`.
- **Charts:** line `#dcb0e5`, soft `#c795d3`, tooltip `#1d1720`.
- **Money stage:** base `#0c0a0e`, surface `#100d12`, text `#f6f0f7`, muted `#b8adbb`, gain `#62e4a4`, spend `#ff9fac`, locked `#f6c46e`.
- **Contrast floor overrides (dark):** `text-slate-500/600` → `--muted-foreground`; `text-emerald-500…800` → `#dcb0e5`; `text-red-500` → `#ff9fac`; `text-amber-600` → `#f6c46e`.
- **Not an inversion:** neutrals keep a plum cast (never navy/grey); status colours are re-picked lighter, not inverted; depth comes from luminance steps and the 1px highlight (shadows are nearly invisible on a dark canvas); the haze shows between cards; accent ink is *lighter* than the fills it sits next to.
- **Status:** visually reviewed on every page and passes the same automated axe colour-contrast audit (desktop/tablet/phone), re-run 2026-11-04.

---

## K. Implementation reference

### K.1 Required setup
1. `public/index.html`: `<html lang="en" class="dark">` (fallback), `<script src="%PUBLIC_URL%/theme-init.js"></script>` in `<head>` (applies the saved theme before paint; the CSP allows only `script-src 'self'`, hence an external file), `<meta name="theme-color" content="#0c0a0e">`, Plus Jakarta Sans 600 `<link>` with preconnects.
2. `src/index.css` imports the font CSS and defines the tokens (below). `src/theme/orchid.css` (imported in `src/index.js` right after `index.css`) defines the Money/Settings/Profile scope.
3. `tailwind.config.js`: `darkMode: ["class"]`, `fontFamily.sans`, remapped `slate/emerald/teal`, semantic colours (the unused `chart-1…5` entries were removed), `plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")]`.
4. A settings provider toggles `document.documentElement.classList` (`dark`) from the saved preference: `dark` → add; `light` → remove; `system` → follow `prefers-color-scheme` live; also stores `lm_theme` and `no-anim`.

### K.2 Using the tokens (examples)
```jsx
// A glass card with a pill CTA
<div className="card-ambient rounded-3xl border p-6">
  <h3 className="text-lg font-semibold tracking-tight">Total available</h3>
  <p className="stat-num mt-4 text-[2.5rem] font-semibold tracking-[-0.03em] sm:text-[3rem]">€5,144.60</p>
  <button className="cta-fill mt-6 inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold active:scale-[0.97]">Add expense</button>
</div>
```
```jsx
// A field
<input className="h-10 w-full rounded-full border border-line-strong bg-field px-4 text-base md:text-sm placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring" />
// A selected pill
<button aria-pressed="true" className="pill-fill h-10 rounded-full px-5 text-sm font-medium">Week</button>
```
```css
/* a new themed surface: always variables, never literals */
.my-surface { background: var(--card-fill); border: 1px solid var(--line); border-radius: 24px; box-shadow: var(--card-edge); }
.my-surface:hover { border-color: var(--line-strong); }
```

### K.3 Motion snippets
```css
@keyframes lm-block-in { from { opacity: 0; transform: translateY(14px); } }
.lm-page > * > :nth-child(-n+10):not(.mx-rise):not(.hm-rise) { animation: lm-block-in 620ms cubic-bezier(0.16,1,0.3,1) both; animation-delay: calc(var(--lm-i,0) * 55ms); }
@media (prefers-reduced-motion: reduce) { .lm-page > * > * { animation: none !important; } }
.no-anim .lm-page > * > * { animation: none !important; }
```
```jsx
// the sliding active pill (Framer Motion)
{isActive && <motion.span layoutId="nav-pill" className="absolute inset-0 -z-10 rounded-full pill-fill"
  transition={{ type: "spring", stiffness: 420, damping: 38 }} />}
```

### K.4 Responsive and accessibility rules
- Mobile-first; breakpoints §D; no horizontal page scroll; phone touch targets ≥ 44px; `env(safe-area-inset-bottom)` on the FAB.
- WCAG AA contrast in both themes (§B.4); never colour alone; visible focus; `aria-pressed/selected/current/busy/live` used as described; skeleton groups are `role=status`; decorative icons `aria-hidden`.
- Reduced motion and the Animations setting must disable every animation (§F).
- Inputs are 16px on phones to prevent iOS zoom.

### K.5 Complete source of the theme layer (verbatim, current)
The three files below are the authoritative implementation. Reproduce them exactly, then rebuild components from §E.

**`tailwind.config.js`**
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
    // `overline` is a Tailwind utility; without this an app's own eyebrow-label class draws a line above the text.
    blocklist: ["overline"],
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        /* The plum look. `slate` is the neutral ramp, tinted towards plum so no navy shows through anywhere; `emerald` and `teal` (the app's brand
           hue in a few hundred class names) are the orchid ramp. Colours that carry a meaning (a gain, a warning) are written as green/red/amber. */
        /* the theme's semantic surface colours (defined per theme in index.css) */
        line: 'var(--line)', 'line-strong': 'var(--line-strong)', field: 'var(--field)', hover: 'var(--hover)', sidebar: 'var(--sidebar)', scrim: 'var(--scrim)', 'accent-ink': 'var(--accent-ink)',
        slate: { 50: '#f7f4f8', 100: '#efe9f1', 200: '#ddd3e0', 300: '#c5b8ca', 400: '#a699ad', 500: '#857790', 600: '#655a6d', 700: '#4a424f', 800: '#322c37', 900: '#1d1921', 950: '#100d12' },
        emerald: { 50: '#fbf5fd', 100: '#f4e6f8', 200: '#ead0f1', 300: '#dcb0e5', 400: '#cc93d8', 500: '#b87cc8', 600: '#9a6aab', 700: '#7a5a8a', 800: '#644873', 900: '#4a3555', 950: '#2d1f35' },
        teal: { 50: '#faf5fc', 100: '#f1e5f6', 200: '#e3cdec', 300: '#d2afe0', 400: '#bc90cf', 500: '#a276b6', 600: '#855f98', 700: '#6c4d7d', 800: '#573e66', 900: '#402e4b', 950: '#271c2e' },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0'
          },
          to: {
            height: 'var(--radix-accordion-content-height)'
          }
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)'
          },
          to: {
            height: '0'
          }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
```

**`src/index.css`**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;600;700&family=Manrope:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  /* The plum look, in two themes. `:root` is the light one (lilac and ivory), `.dark` the dark one (plum-black). The semantic variables
     (--line, --field, --hover, --card-fill ...) are what surfaces read, so a component never needs to know which theme it is in. */
  :root {
    --background: 290 26% 96%;
    --foreground: 285 30% 11%;
    --card: 0 0% 100%;
    --card-foreground: 285 30% 11%;
    --popover: 0 0% 100%;
    --popover-foreground: 285 30% 11%;
    --primary: 280 21% 40%;
    --primary-foreground: 0 0% 100%;
    --secondary: 290 22% 93%;
    --secondary-foreground: 285 30% 11%;
    --muted: 290 22% 93%;
    --muted-foreground: 285 12% 38%;
    --accent: 290 32% 92%;
    --accent-foreground: 280 32% 24%;
    --destructive: 0 72% 46%;
    --destructive-foreground: 0 0% 100%;
    --border: 285 16% 86%;
    --input: 285 14% 78%;
    --ring: 280 32% 46%;
    --radius: 1rem;
    --line: rgba(70, 35, 90, 0.14);
    --line-strong: rgba(70, 35, 90, 0.3);
    --field: rgba(255, 255, 255, 0.85);
    --hover: rgba(90, 50, 110, 0.07);
    --sidebar: rgba(255, 255, 255, 0.78);
    --card-fill: linear-gradient(180deg, #ffffff, #fbf8fc);
    --card-edge: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 2px rgba(70, 35, 90, 0.06), 0 20px 44px -28px rgba(70, 35, 90, 0.34);
    --glass: rgba(255, 255, 255, 0.74);
    --glass-strong: rgba(255, 255, 255, 0.94);
    --pop-shadow: 0 24px 60px -22px rgba(70, 35, 90, 0.4);
    --scrim: rgba(40, 20, 55, 0.48);
    --fab-shadow: 0 12px 28px -10px rgba(107, 79, 123, 0.6), 0 2px 6px rgba(70, 35, 90, 0.22);
    --fab-shadow-hover: 0 18px 34px -12px rgba(107, 79, 123, 0.7), 0 3px 8px rgba(70, 35, 90, 0.28);
    --accent-ink: #6c4d7d;
    --cta: linear-gradient(180deg, #876096, #6b4f7b);
    --cta-ink: #ffffff;
    --pill: linear-gradient(135deg, #87699b, #5a4566);
    --skeleton: rgba(90, 50, 110, 0.09);
    --skeleton-sweep: rgba(255, 255, 255, 0.7);
    --scroll: rgba(110, 75, 130, 0.32);
    --tip-bg: #ffffff;
    --tip-ink: #231a28;
    --chart-grid: rgba(70, 35, 90, 0.1);
    --chart-axis: rgba(70, 35, 90, 0.22);
    --chart-line: #7a5a8a;
    --chart-line-soft: #9a6aab;
    --haze:
      radial-gradient(75% 55% at 82% -10%, rgba(196, 160, 214, 0.5), transparent 72%),
      radial-gradient(55% 42% at 0% 6%, rgba(214, 186, 226, 0.35), transparent 70%),
      radial-gradient(60% 40% at 50% 115%, rgba(200, 165, 215, 0.3), transparent 70%);
    color-scheme: light;
  }
  .dark {
    --background: 285 12% 5%;
    --foreground: 300 28% 95%;
    --card: 285 10% 8%;
    --card-foreground: 300 28% 95%;
    --popover: 285 11% 10%;
    --popover-foreground: 300 28% 95%;
    --primary: 280 21% 44%;
    --primary-foreground: 0 0% 100%;
    --secondary: 285 9% 14%;
    --secondary-foreground: 300 28% 95%;
    --muted: 285 9% 14%;
    --muted-foreground: 292 10% 70%;
    --accent: 295 18% 18%;
    --accent-foreground: 300 45% 92%;
    --destructive: 0 72% 56%;
    --destructive-foreground: 0 0% 100%;
    --border: 290 9% 20%;
    --input: 290 9% 24%;
    --ring: 297 48% 76%;
    --line: rgba(255, 232, 255, 0.12);
    --line-strong: rgba(255, 232, 255, 0.22);
    --field: rgba(0, 0, 0, 0.35);
    --hover: rgba(255, 255, 255, 0.08);
    --sidebar: rgba(13, 10, 16, 0.75);
    --card-fill: linear-gradient(180deg, rgba(255, 240, 255, 0.05), rgba(255, 240, 255, 0.012)), #0e0b10;
    --card-edge: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 22px 44px -30px rgba(0, 0, 0, 0.85);
    --glass: rgba(16, 13, 18, 0.72);
    --glass-strong: rgba(14, 11, 16, 0.92);
    --pop-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.85);
    --scrim: rgba(7, 5, 10, 0.7);
    --fab-shadow: 0 12px 28px -10px rgba(200, 140, 220, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4);
    --fab-shadow-hover: 0 18px 34px -12px rgba(200, 140, 220, 0.65), 0 3px 8px rgba(0, 0, 0, 0.45);
    --accent-ink: #dcb0e5;
    --cta: linear-gradient(180deg, #ecc9f2, #c795d3);
    --cta-ink: #2a1433;
    --pill: linear-gradient(135deg, #87699b, #4f3b5a);
    --skeleton: rgba(255, 238, 255, 0.07);
    --skeleton-sweep: rgba(255, 236, 255, 0.08);
    --scroll: rgba(220, 176, 229, 0.26);
    --tip-bg: #1d1720;
    --tip-ink: #f6f0f7;
    --chart-grid: rgba(255, 232, 255, 0.07);
    --chart-axis: rgba(255, 232, 255, 0.16);
    --chart-line: #dcb0e5;
    --chart-line-soft: #c795d3;
    --haze:
      radial-gradient(75% 55% at 82% -10%, rgba(150, 118, 160, 0.42), transparent 72%),
      radial-gradient(55% 42% at 0% 6%, rgba(120, 96, 132, 0.18), transparent 70%),
      radial-gradient(60% 40% at 50% 115%, rgba(140, 105, 150, 0.16), transparent 70%);
    color-scheme: dark;
  }
}

@layer base {
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground;
    font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    /* the mauve haze behind the glass cards, fixed so it stays put while the page scrolls */
    background-image: var(--haze);
    background-attachment: fixed;
  }
  .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
  /* Figures use the same face as the words, in tabular numerals so columns of amounts line up (they were monospace before). */
  .stat-num { font-family: inherit; font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
}

/* ---- Contrast floor (WCAG AA, roadmap D-01 / D-04) --------------------------------------------------------------
   Secondary and accent text is written all over the app as text-slate-400/500, text-emerald-600, text-red-500 and
   text-amber-600. On white those fall below 4.5:1 (slate-400 is 2.6:1) and on the dark cards slate-500 is 3.9:1, so the
   fix lives here, once, instead of in several hundred class lists. The selectors use :where(), so they carry the same
   specificity as the utility they adjust: an explicit dark:text-*, hover:text-* or focus:text-* on the same element still
   wins. Add a colour here only when the audit (e2e/a11y-*.spec.js) finds it failing. */
/* Text in a data colour (a category, a workout type): the colour arrives as --tint and is darkened in the light theme, or
   lightened in the dark one, until it reads at 4.5:1 on its own pale tint. The raw colour stays for dots, bars and icons. */
.tint-text { color: color-mix(in srgb, var(--tint) 58%, black); }
:where(.dark) .tint-text { color: color-mix(in srgb, var(--tint) 58%, white); }

@layer utilities {
  :where(:root:not(.dark)) .text-slate-400,
  :where(:root:not(.dark)) .text-slate-500 { color: hsl(var(--muted-foreground)); }
  :where(:root:not(.dark)) .text-emerald-500,
  :where(:root:not(.dark)) .text-emerald-600 { color: #6c4d7d; }
  :where(:root:not(.dark)) .text-red-500 { color: #c2262e; }
  :where(:root:not(.dark)) .text-amber-600 { color: #a24a08; }
  :where(.dark) .text-slate-500,
  :where(.dark) .text-slate-600 { color: hsl(var(--muted-foreground)); }
  :where(.dark) .text-emerald-500,
  :where(.dark) .text-emerald-600,
  :where(.dark) .text-emerald-700,
  :where(.dark) .text-emerald-800 { color: #dcb0e5; }
  :where(.dark) .text-red-500 { color: #ff9fac; }
  :where(.dark) .text-amber-600 { color: #f6c46e; }
}

/* Surfaces */
.glass { background: var(--glass); backdrop-filter: blur(22px) saturate(150%); -webkit-backdrop-filter: blur(22px) saturate(150%); }
.glass-strong { background: var(--glass-strong); backdrop-filter: blur(28px) saturate(160%); -webkit-backdrop-filter: blur(28px) saturate(160%); }

/* The shared card: glass over the haze, with a light top edge, as in the reference. */
.card-ambient { background: var(--card-fill); border-color: var(--line); border-radius: 1.5rem; box-shadow: var(--card-edge);
  transition: border-color 220ms cubic-bezier(0.16, 1, 0.3, 1); }
@media (hover: hover) { .card-ambient:hover { border-color: var(--line-strong); } }

/* The filled brand pill (the main action). */
.cta-fill { background: var(--cta); color: var(--cta-ink); }
.pill-fill { background: var(--pill); color: #fff; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22); }

::selection { background: rgba(160, 110, 190, 0.3); }

/* Skeleton: a quiet block with a light sweep across it. The sweep is a transform (no layout, no paint of the page), and it stops for
   reduced motion and for the Animations switch. A block is decoration: the group around it carries the one announcement (components/skeletons.jsx). */
.skeleton { overflow: hidden; border-radius: 0.5rem; background: var(--skeleton); }
.skeleton:not(.absolute) { position: relative; }   /* (a block that places itself keeps doing so: the chart skeleton positions its area) */
.skeleton::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, var(--skeleton-sweep), transparent); animation: sk-sweep 1.5s ease-in-out infinite; }
@keyframes sk-sweep { to { transform: translateX(100%); } }
/* Content that replaces a skeleton fades in (opacity only: the skeleton already held the space, so nothing moves). */
@keyframes sk-reveal { from { opacity: 0; } to { opacity: 1; } }
.sk-reveal { animation: sk-reveal 260ms cubic-bezier(0.2, 0, 0, 1) both; }
@media (prefers-reduced-motion: reduce) { .skeleton::after { animation: none; display: none; } .sk-reveal { animation: none; } }
.no-anim .skeleton::after { animation: none; display: none; }
.no-anim .sk-reveal { animation: none; }

/* Entrance animations */
@keyframes lm-fade-up {
  from { opacity: 0; transform: translateY(12px); filter: blur(5px); }
  to { opacity: 1; transform: translateY(0); filter: blur(0); }
}
.lm-in { animation: lm-fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
.no-anim .lm-in { animation: none !important; }

@keyframes lm-pulse-ring {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-ink) 40%, transparent); }
  70% { box-shadow: 0 0 0 14px color-mix(in srgb, var(--accent-ink) 0%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-ink) 0%, transparent); }
}
.pulse-ring { animation: lm-pulse-ring 2.4s infinite; }

/* Custom scrollbar */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--scroll); border-radius: 8px; }
::-webkit-scrollbar-thumb:hover { background: var(--line-strong); }
html { scrollbar-color: var(--scroll) transparent; }

[data-debug-wrapper="true"] { display: contents !important; }

.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* Numeric fields: drop the browser spinners; quantities are typed or use the in-app steppers. */
input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

/* Keep the layout steady when content above/below a focus target changes size. */
html { overflow-anchor: auto; }

/* Page change: a short fade, nothing that moves layout. */
@keyframes lm-page-in { from { opacity: 0; transform: translateY(10px); } }
.lm-page { animation: lm-page-in 0.46s cubic-bezier(0.16, 1, 0.3, 1) both; }
.no-anim .lm-page { animation: none !important; }
@media (prefers-reduced-motion: reduce) { .lm-page { animation: none; } }

/* ---- Assistant ---- */
.lm-money { font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 600; font-size: 0.92em; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; white-space: nowrap; }
.lm-ai-prose > :first-child { margin-top: 0; }
.lm-streaming .lm-ai-prose > :last-child::after { content: ""; display: inline-block; width: 0.5ch; height: 1.05em; margin-left: 2px; vertical-align: text-bottom; border-radius: 1px; background: var(--accent-ink); animation: lm-caret 1s steps(2, jump-none) infinite; }
@keyframes lm-caret { to { visibility: hidden; } }
.lm-typing { display: inline-flex; gap: 4px; }
.lm-typing i { width: 6px; height: 6px; border-radius: 9999px; background: color-mix(in srgb, var(--accent-ink) 70%, transparent); animation: lm-dot 1.2s ease-in-out infinite; }
.lm-typing i:nth-child(2) { animation-delay: 0.15s; }
.lm-typing i:nth-child(3) { animation-delay: 0.3s; }
@keyframes lm-dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.45; } 30% { transform: translateY(-4px); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .lm-typing i { animation: none; opacity: 0.7; }
  .lm-streaming .lm-ai-prose > :last-child::after { animation: none; }
}
.no-anim .lm-typing i, .no-anim .lm-streaming .lm-ai-prose > :last-child::after { animation: none; }

/* ---- Printing the nutrition summary: the app is hidden and the open dialog becomes the whole page ---- */
@media print {
  body.printing-summary #root,
  body.printing-summary [data-radix-popper-content-wrapper],
  body.printing-summary [class~="fixed"][class~="inset-0"],
  body.printing-summary [data-sonner-toaster] { display: none !important; }
  body.printing-summary [data-print-area] {
    position: static !important; transform: none !important; max-width: none !important; max-height: none !important; width: 100% !important;
    overflow: visible !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; color: #000 !important; background: #fff !important;
  }
  body.printing-summary [data-print-area] button[aria-label="Close"],
  body.printing-summary [data-print-area] > button { display: none !important; }
}

/* ------------------------------------------------------------------------------------------------------------------------------
   People: deep teal and amber, liquid glass on the floating layers only (the side sheet, dialogs, the delete bar), solid surfaces
   for everything that carries a figure. `.ppl-theme` also remaps the shared component tokens, so inputs, selects and buttons inside
   it take this palette without being restyled one by one. Direction is never colour alone: icons and words say "owes you" / "you owe".
   ------------------------------------------------------------------------------------------------------------------------------ */
.ppl-theme {
  --ppl-bg: #f3edf5; --ppl-lights: radial-gradient(75% 55% at 82% -8%, rgba(196, 160, 214, 0.5), transparent 72%), radial-gradient(55% 40% at 0% 100%, rgba(214, 186, 226, 0.32), transparent 70%);
  --ppl-surface: #ffffff; --ppl-surface-2: #f6f0f8; --ppl-line: rgba(70, 35, 90, 0.14);
  --ppl-text: #231a28; --ppl-muted: #65586d;
  --ppl-teal-text: #6c4d7d; --ppl-teal-fill: #7a5a8a; --ppl-on-fill: #ffffff; --ppl-teal-tint: rgba(122, 90, 138, 0.12);
  --ppl-amber-text: #92400e; --ppl-amber-fill: #d98a0b; --ppl-amber-tint: rgba(217, 138, 11, 0.16);
  --ppl-glass: rgba(255, 255, 255, 0.72); --ppl-glass-line: rgba(255, 255, 255, 0.85);
  --ppl-glass-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 24px 60px -24px rgba(70, 35, 90, 0.35), 0 2px 8px rgba(70, 35, 90, 0.08);
  color: var(--ppl-text);
  caret-color: var(--ppl-teal-text);
  scrollbar-color: var(--scroll) transparent;
}
.dark .ppl-theme {
  --ppl-bg: #0c0a0e; --ppl-lights: radial-gradient(75% 55% at 82% -8%, rgba(150, 118, 160, 0.4), transparent 72%), radial-gradient(55% 40% at 0% 100%, rgba(140, 105, 150, 0.16), transparent 70%);
  --ppl-surface: #100d12; --ppl-surface-2: #1b161e; --ppl-line: rgba(255, 232, 255, 0.1);
  --ppl-text: #f6f0f7; --ppl-muted: #b8adbb;
  --ppl-teal-text: #dcb0e5; --ppl-teal-fill: #cc93d8; --ppl-on-fill: #1d0f25; --ppl-teal-tint: rgba(220, 176, 229, 0.13);
  --ppl-amber-text: #f6c46e; --ppl-amber-fill: #f6c46e; --ppl-amber-tint: rgba(246, 196, 110, 0.14);
  --ppl-glass: rgba(18, 14, 21, 0.66); --ppl-glass-line: rgba(255, 232, 255, 0.14);
  --ppl-glass-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 28px 70px -24px rgba(0, 0, 0, 0.75), 0 2px 10px rgba(0, 0, 0, 0.35);
}
.ppl-theme ::selection { background: var(--ppl-teal-tint); color: inherit; }
.ppl-theme :focus-visible { outline: 2px solid var(--ppl-teal-text); outline-offset: 2px; }
.ppl-stage { position: relative; isolation: isolate; background: var(--ppl-lights), var(--ppl-bg); border: 1px solid var(--ppl-line); border-radius: 1.75rem; }
/* A floating layer: translucent, blurred, hairline edge, a lit top edge. Used on the sheet, dialogs and the delete bar only. */
.ppl-theme.ppl-glass, .ppl-glass { background: var(--ppl-glass); backdrop-filter: blur(24px) saturate(165%); -webkit-backdrop-filter: blur(24px) saturate(165%);
  border: 1px solid var(--ppl-glass-line); box-shadow: var(--ppl-glass-shadow); color: var(--ppl-text); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .ppl-theme.ppl-glass, .ppl-glass { background: var(--ppl-surface); }
}
.ppl-solid { background: var(--ppl-surface); border: 1px solid var(--ppl-line); border-radius: 1.25rem; }
.ppl-muted { color: var(--ppl-muted); }
.ppl-teal { color: var(--ppl-teal-text); }
.ppl-amber { color: var(--ppl-amber-text); }
.ppl-row { transition: background-color 160ms cubic-bezier(0.2, 0, 0, 1); }
.ppl-row:hover, .ppl-row:focus-within { background: var(--ppl-surface-2); }
.ppl-chip { border: 1px solid var(--ppl-line); color: var(--ppl-muted); transition: background-color 160ms cubic-bezier(0.2, 0, 0, 1), color 160ms; }
.ppl-chip:hover { background: var(--ppl-surface-2); color: var(--ppl-text); }
.ppl-chip[aria-pressed="true"] { background: var(--ppl-teal-tint); color: var(--ppl-teal-text); border-color: var(--ppl-teal-text); }
.ppl-theme .ppl-btn-primary, .ppl-theme .ppl-btn-primary:hover { background: var(--ppl-teal-fill); color: var(--ppl-on-fill); }
.ppl-theme .ppl-btn-primary:hover { filter: brightness(1.07); }
.ppl-theme .ppl-btn-primary:disabled { opacity: 0.5; }
.ppl-theme .ppl-btn-danger, .ppl-theme .ppl-btn-danger:hover { background: #b91c1c; color: #fff; }
.ppl-theme .ppl-btn-danger:hover { filter: brightness(0.9); }
.dark .ppl-theme .ppl-btn-danger, .dark .ppl-theme .ppl-btn-danger:hover { background: #ef4444; color: #1b0505; }
.dark .ppl-theme .ppl-btn-danger:hover { filter: brightness(1.08); }
@media (prefers-reduced-motion: reduce) { .ppl-row, .ppl-chip { transition: none; } }

/* ------------------------------------------------------------------------------------------------------------------------------
   Money: a bento of rounded surfaces on a deep green stage, outlined pill controls, one filled gradient for the active choice and
   the main action. Scoped as .mny-theme, which also remaps the shared component tokens so inputs, selects and buttons inside take
   the palette. Colour never carries a meaning alone: signs, arrows and words say gain / spend / locked.
   ------------------------------------------------------------------------------------------------------------------------------ */
.mny-theme ::selection { background: var(--mny-green-tint); color: inherit; }
.mny-theme :focus-visible { outline: 2px solid var(--mny-green); outline-offset: 2px; }
.mny-stage { position: relative; isolation: isolate; background: var(--mny-lights), var(--mny-bg); border: 1px solid var(--mny-line); border-radius: 1.75rem; padding: 0.75rem; }
@media (min-width: 640px) { .mny-stage { padding: 1.25rem; } }
@media (min-width: 1024px) { .mny-stage { padding: 1.5rem; } }
.mny-card { background: var(--mny-surface); border: 1px solid var(--mny-line); border-radius: 1.5rem; box-shadow: var(--mny-shadow); min-width: 0; }
.mny-card.mny-hero { border-color: color-mix(in srgb, var(--mny-green) 45%, var(--mny-line)); }
.mny-tile { background: var(--mny-surface-2); border: 1px solid var(--mny-line); border-radius: 1.1rem; min-width: 0; }
.mny-title { color: var(--mny-text); }
.mny-muted { color: var(--mny-muted); }
.mny-green { color: var(--mny-green); }
.mny-neg { color: var(--mny-neg); }
.mny-amber { color: var(--mny-amber); }
.mny-num { font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.mny-hair { border-color: var(--mny-line); }
/* Pill controls: outlined at rest, the green gradient when chosen. */
.mny-pill { display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem; height: 2.25rem; padding: 0 1rem; border-radius: 9999px; border: 1px solid var(--mny-line);
  background: transparent; color: var(--mny-muted); font-size: 0.875rem; font-weight: 500; white-space: nowrap; flex-shrink: 0;
  transition: background-color 160ms cubic-bezier(0.2, 0, 0, 1), color 160ms, border-color 160ms, transform 120ms; }
.mny-pill:hover:not(:disabled) { background: var(--mny-surface-2); color: var(--mny-text); }
.mny-pill:active:not(:disabled) { transform: scale(0.97); }
.mny-pill[aria-pressed="true"] { background: var(--mny-grad); color: var(--mny-on-grad); border-color: transparent; font-weight: 600; }
.mny-pill:disabled { border-style: dashed; opacity: 0.6; cursor: not-allowed; }
.mny-pill.sm { height: 1.9rem; padding: 0 0.8rem; font-size: 0.75rem; }
.mny-cta, .mny-cta:hover:not(:disabled) { background: var(--mny-grad); color: var(--mny-on-grad); border-color: transparent; font-weight: 600; }
.mny-cta:hover:not(:disabled) { filter: brightness(1.06); }
.mny-theme .mny-field { border-radius: 9999px; background: var(--mny-surface-2); border-color: var(--mny-line); }
.mny-icon-btn { display: inline-grid; place-items: center; height: 2rem; width: 2rem; border-radius: 9999px; color: var(--mny-muted); transition: background-color 160ms, color 160ms; }
.mny-icon-btn:hover { background: var(--mny-surface-2); color: var(--mny-text); }
.mny-icon-btn.danger:hover { color: var(--mny-neg); }
.mny-badge { display: inline-grid; place-items: center; height: 2.5rem; width: 2.5rem; flex-shrink: 0; border-radius: 9999px; background: var(--mny-surface); border: 1px solid var(--mny-line); color: var(--mny-green); }
.mny-row { transition: background-color 160ms cubic-bezier(0.2, 0, 0, 1); }
.mny-row:hover, .mny-row:focus-within { background: var(--mny-surface-2); }
.mny-bar { height: 0.5rem; border-radius: 9999px; background: var(--mny-surface-2); overflow: hidden; border: 1px solid var(--mny-line); }
.mny-bar > span { display: block; height: 100%; border-radius: 9999px; background: var(--mny-grad); transition: width 500ms cubic-bezier(0.2, 0, 0, 1); }
.mny-bar > span.warn { background: #e0a93a; }
.mny-bar > span.over { background: #e5604d; }
.mny-tip { background: var(--mny-surface); border: 1px solid var(--mny-line); border-radius: 0.9rem; padding: 0.6rem 0.8rem; box-shadow: 0 14px 30px -12px rgba(0, 0, 0, 0.45); color: var(--mny-text); }
.mny-state { display: inline-flex; align-items: center; gap: 0.25rem; border-radius: 9999px; padding: 0.1rem 0.55rem; font-size: 0.6875rem; font-weight: 600; background: var(--mny-green-tint); color: var(--mny-green); }
.mny-state.amber { background: var(--mny-amber-tint); color: var(--mny-amber); }
.mny-state.neg { background: var(--mny-neg-tint); color: var(--mny-neg); }
/* The one authored moment: the cards rise in a short stagger when the page opens. */
@keyframes mny-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.mny-in { animation: mny-rise 520ms cubic-bezier(0.2, 0, 0, 1) both; animation-delay: calc(var(--i, 0) * 55ms); }
@media (prefers-reduced-motion: reduce) { .mny-in { animation: none; } .mny-pill, .mny-row, .mny-bar > span { transition: none; } }


/* Cards of components shared with the rest of the app (two-step, devices, your data) take the same surface inside these pages. */
.mny-theme .card-ambient { background: var(--mny-surface); border-color: var(--mny-line); border-radius: 1.5rem; box-shadow: var(--mny-shadow); }

.initials-pseudo::before { content: attr(data-initials); }

/* Money and Settings sit on near-white or near-black surfaces: the placeholder is a tint of the text colour, so it shows on any of them. */
.mny-theme .skeleton { background: color-mix(in srgb, var(--mny-text) 9%, transparent); }

/* Skeleton by the real markup. A part of the page whose data is on its way is drawn exactly as it will be (same elements, same text size), inside a
   [data-skeleton] wrapper; the figures and lines that depend on data (.mny-num, .sk-ph) keep their box and lose their ink, and a sweep runs over them.
   The text in them is a stand-in of the right length, never real: the wrapper is also `inert` and its status is announced once. */
[data-skeleton] .mny-num, [data-skeleton] .sk-ph {
  position: relative; display: inline-block; max-width: 100%; overflow: hidden; vertical-align: top; border-radius: 0.375rem; user-select: none;
  color: transparent !important; background: color-mix(in srgb, var(--mny-text) 9%, transparent);
}
[data-skeleton] .mny-num::after, [data-skeleton] .sk-ph::after {
  content: ""; position: absolute; inset: 0; transform: translateX(-100%); animation: sk-sweep 1.5s ease-in-out infinite;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
}
.dark [data-skeleton] .mny-num::after, .dark [data-skeleton] .sk-ph::after { background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.07), transparent); }
@media (prefers-reduced-motion: reduce) { [data-skeleton] .mny-num::after, [data-skeleton] .sk-ph::after { animation: none; display: none; } }
.no-anim [data-skeleton] .mny-num::after, .no-anim [data-skeleton] .sk-ph::after { animation: none; display: none; }

/* Chart tooltips (recharts draws them white by default): the theme's glass, like the cards. */
.recharts-default-tooltip { background-color: var(--tip-bg) !important; border: 1px solid var(--line) !important; border-radius: 16px !important; box-shadow: var(--pop-shadow); }
.recharts-tooltip-label, .recharts-tooltip-item { color: var(--tip-ink) !important; }
.recharts-cartesian-grid line { stroke: var(--chart-grid); }
.recharts-cartesian-axis-line, .recharts-cartesian-axis-tick-line { stroke: var(--chart-axis); }
.recharts-text { fill: hsl(var(--muted-foreground)); }

/* ---- Motion shared by every page (Home and Money keep their own) ---- */
/* The top-level blocks of a page settle in one after another, from the top. Opacity and a short rise only: nothing that reflows. */
@keyframes lm-block-in { from { opacity: 0; transform: translateY(14px); } }
.lm-page > * > :nth-child(-n+10):not(.mx-rise):not(.hm-rise) { animation: lm-block-in 620ms cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: calc((var(--lm-i, 0)) * 55ms); }
.lm-page > * > :nth-child(2) { --lm-i: 1; } .lm-page > * > :nth-child(3) { --lm-i: 2; } .lm-page > * > :nth-child(4) { --lm-i: 3; } .lm-page > * > :nth-child(5) { --lm-i: 4; }
.lm-page > * > :nth-child(6) { --lm-i: 5; } .lm-page > * > :nth-child(7) { --lm-i: 6; } .lm-page > * > :nth-child(8) { --lm-i: 7; } .lm-page > * > :nth-child(n+9) { --lm-i: 8; }
/* A tab panel (Radix) fades up when its tab is chosen. */
@keyframes lm-tab-in { from { opacity: 0; transform: translateY(8px); } }
[role="tabpanel"][data-state="active"] { animation: lm-tab-in 380ms cubic-bezier(0.16, 1, 0.3, 1) both; }
@media (prefers-reduced-motion: reduce) { .lm-page > * > *, [role="tabpanel"][data-state="active"] { animation: none !important; } }
.no-anim .lm-page > * > *, .no-anim [role="tabpanel"][data-state="active"] { animation: none !important; }
```

**`src/theme/orchid.css`**
```css
/* The plum look for every page that uses the .mny-* classes (Money, Profile, Settings): a stage with a mauve haze, glass cards, outlined pills and
   one mauve gradient for the active choice. Two themes: `.mny-theme` carries the light values (lilac and ivory), `.dark .mny-theme` the dark ones
   (plum-black). Every rule below reads the --mx-* variables, so nothing is written twice. Colour never carries a meaning alone: signs, arrows
   and words say gain / spend / locked. */

.mny-theme {
  --mny-bg: #f5eff7;
  --mny-lights:
    radial-gradient(75% 55% at 78% -8%, rgba(196, 160, 214, 0.5), transparent 72%),
    radial-gradient(55% 40% at 0% 8%, rgba(214, 186, 226, 0.36), transparent 70%),
    radial-gradient(60% 40% at 50% 112%, rgba(200, 165, 215, 0.3), transparent 70%);
  --mny-surface: #ffffff; --mny-surface-2: #f4eef7; --mny-line: rgba(70, 35, 90, 0.13);
  --mny-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 2px rgba(70, 35, 90, 0.06), 0 22px 46px -30px rgba(70, 35, 90, 0.38);
  --mny-text: #231a28; --mny-muted: #65586d;
  --mny-green: #0b7a52; --mny-green-tint: rgba(11, 122, 82, 0.12);
  --mny-grad: linear-gradient(135deg, #87699b, #5a4566); --mny-on-grad: #ffffff;
  --mny-neg: #b4232f; --mny-neg-tint: rgba(200, 40, 60, 0.1);
  --mny-amber: #8f4208; --mny-amber-tint: rgba(217, 138, 11, 0.16);
  --mx-orchid: #6c4d7d; --mx-orchid-deep: #8b6a9d;
  --mx-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --mx-edge: rgba(70, 35, 90, 0.12); --mx-edge-hover: rgba(70, 35, 90, 0.26); --mx-hair: rgba(70, 35, 90, 0.12);
  --mx-card: linear-gradient(180deg, #ffffff, #fbf8fc);
  --mx-glow: rgba(150, 100, 180, 0.13);
  --mx-tile: rgba(90, 50, 110, 0.05); --mx-tile-edge: rgba(70, 35, 90, 0.12);
  --mx-badge: rgba(122, 90, 138, 0.1);
  --mx-pill: rgba(255, 255, 255, 0.85); --mx-pill-edge: rgba(70, 35, 90, 0.3); --mx-pill-hover: rgba(90, 50, 110, 0.08); --mx-pill-hover-edge: rgba(70, 35, 90, 0.5);
  --mx-cta: linear-gradient(180deg, #876096, #6b4f7b); --mx-cta-ink: #ffffff; --mx-cta-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 12px 26px -14px rgba(107, 79, 123, 0.7);
  --mx-field: rgba(255, 255, 255, 0.92); --mx-field-edge: rgba(70, 35, 90, 0.28);
  --mx-ask: rgba(255, 255, 255, 0.75); --mx-ask-edge: rgba(70, 35, 90, 0.2);
  --mx-bar: rgba(90, 50, 110, 0.1); --mx-bar-fill: linear-gradient(90deg, #8b6a9d, #6c4d7d);
  --mx-warn-fill: linear-gradient(90deg, #d49a3a, #b8760b); --mx-over-fill: linear-gradient(90deg, #d8485c, #b4232f);
  --mx-row: rgba(90, 50, 110, 0.05);
  --mx-arc: rgba(160, 110, 190, 0.34); --mx-bloom: rgba(180, 135, 205, 0.4); --mx-bloom-soft: rgba(190, 150, 210, 0.14);
  --mx-tip: #ffffff; --mx-selection: rgba(160, 110, 190, 0.3);
  --mx-chip: rgba(255, 255, 255, 0.7); --mx-chip-edge: rgba(70, 35, 90, 0.22);
  --mx-state: rgba(11, 122, 82, 0.12);
  font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  scrollbar-color: var(--scroll) transparent;
}
.dark .mny-theme {
  --mny-bg: #0c0a0e;
  --mny-lights:
    radial-gradient(75% 55% at 78% -8%, rgba(150, 118, 160, 0.42), transparent 72%),
    radial-gradient(55% 40% at 0% 8%, rgba(120, 96, 132, 0.22), transparent 70%),
    radial-gradient(60% 40% at 50% 112%, rgba(140, 105, 150, 0.2), transparent 70%);
  --mny-surface: #100d12; --mny-surface-2: #1b161e; --mny-line: rgba(255, 232, 255, 0.1);
  --mny-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 24px 48px -30px rgba(0, 0, 0, 0.9);
  --mny-text: #f6f0f7; --mny-muted: #b8adbb;
  --mny-green: #62e4a4; --mny-green-tint: rgba(98, 228, 164, 0.13);
  --mny-neg: #ff9fac; --mny-neg-tint: rgba(255, 140, 160, 0.14);
  --mny-amber: #f6c46e; --mny-amber-tint: rgba(246, 196, 110, 0.14);
  --mx-orchid: #dcb0e5; --mx-orchid-deep: #a87bb6;
  --mx-edge: rgba(255, 232, 255, 0.1); --mx-edge-hover: rgba(255, 232, 255, 0.18); --mx-hair: rgba(255, 232, 255, 0.1);
  --mx-card: linear-gradient(180deg, rgba(255, 240, 255, 0.055), rgba(255, 240, 255, 0.012)), #0e0b10;
  --mx-glow: rgba(220, 176, 229, 0.11);
  --mx-tile: rgba(0, 0, 0, 0.32); --mx-tile-edge: rgba(255, 232, 255, 0.12);
  --mx-badge: rgba(0, 0, 0, 0.35);
  --mx-pill: rgba(0, 0, 0, 0.38); --mx-pill-edge: rgba(255, 240, 255, 0.24); --mx-pill-hover: rgba(255, 240, 255, 0.1); --mx-pill-hover-edge: rgba(255, 240, 255, 0.4);
  --mx-cta: linear-gradient(180deg, #ecc9f2, #c795d3); --mx-cta-ink: #2a1433; --mx-cta-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 12px 26px -14px rgba(220, 150, 235, 0.7);
  --mx-field: rgba(0, 0, 0, 0.38); --mx-field-edge: rgba(255, 240, 255, 0.2);
  --mx-ask: rgba(0, 0, 0, 0.45); --mx-ask-edge: rgba(255, 240, 255, 0.12);
  --mx-bar: rgba(0, 0, 0, 0.4); --mx-bar-fill: linear-gradient(90deg, #a87bb6, #e0b6e8);
  --mx-warn-fill: linear-gradient(90deg, #d49a3a, #f6c46e); --mx-over-fill: linear-gradient(90deg, #e0566a, #ff9fac);
  --mx-row: rgba(255, 240, 255, 0.045);
  --mx-arc: rgba(220, 176, 229, 0.34); --mx-bloom: rgba(220, 176, 229, 0.38); --mx-bloom-soft: rgba(160, 120, 175, 0.14);
  --mx-tip: #1d1720; --mx-selection: rgba(220, 176, 229, 0.32);
  --mx-chip: rgba(0, 0, 0, 0.3); --mx-chip-edge: rgba(255, 240, 255, 0.2);
  --mx-state: rgba(98, 228, 164, 0.13);
}
/* the dropdowns of the page's own selects open outside the stage (a portal): same face and corners */
.mx-pop { font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif; border-radius: 18px; }
.mny-theme { border-radius: 32px; border-color: var(--mx-edge); }
.mny-theme ::selection { background: var(--mx-selection); }
.mny-theme :focus-visible { outline: 2px solid var(--mx-orchid); outline-offset: 3px; }
.mny-theme .mny-num { font-feature-settings: "tnum" 1; }

/* ---- surfaces ---- */
.mny-theme .mny-card {
  position: relative; border-radius: 28px;
  background: var(--mx-card);
  border-color: var(--mx-edge);
  transition: border-color 220ms var(--mx-ease);
}
.mny-theme .mny-card::before { /* a soft light that follows the pointer (mouse only) */
  content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0; border-radius: inherit;
  background: radial-gradient(380px circle at var(--mx, 50%) var(--my, 0%), var(--mx-glow), transparent 65%);
  transition: opacity 300ms var(--mx-ease);
}
.mny-theme .mny-card > * { position: relative; z-index: 1; }
@media (hover: hover) {
  .mny-theme .mny-card:hover { border-color: var(--mx-edge-hover); }
  .mny-theme .mny-card:hover::before { opacity: 1; }
}
.mny-theme .mny-card.mny-hero { border-color: color-mix(in srgb, var(--mx-orchid) 35%, transparent); }
.mny-theme .mny-tile { border-radius: 20px; background: var(--mx-tile); border-color: var(--mx-tile-edge); }
.mny-theme .mny-badge { background: var(--mx-badge); border-color: var(--mx-tile-edge); color: var(--mx-orchid); }

/* the card with an arc of light along its bottom edge, and the one with a bloom in its corner */
.mx-glow::after { content: ""; position: absolute; left: 50%; bottom: -46%; width: 120%; aspect-ratio: 1; transform: translateX(-50%); border-radius: 50%; z-index: 0; pointer-events: none;
  background: radial-gradient(closest-side, transparent 62%, var(--mx-arc) 79%, transparent 100%); }
.mx-bloom::after { content: ""; position: absolute; right: -14%; top: -40%; width: 70%; aspect-ratio: 1; border-radius: 50%; z-index: 0; pointer-events: none;
  background: radial-gradient(closest-side, var(--mx-bloom), var(--mx-bloom-soft) 55%, transparent 100%); filter: blur(8px); }

/* ---- type ---- */
.mny-theme .mny-title { letter-spacing: -0.005em; }
.mx-h { font-size: 1.0625rem; font-weight: 600; color: var(--mny-text); }
.mx-title { font-size: clamp(1.75rem, 3.6vw, 2.5rem); font-weight: 500; letter-spacing: -0.025em; line-height: 1.1; color: var(--mny-text); }
.mx-fig { font-weight: 600; letter-spacing: -0.03em; line-height: 1.05; font-variant-numeric: tabular-nums; }

/* ---- pills: outlined; the chosen one takes the mauve gradient ---- */
.mny-theme .mny-pill { height: 2.5rem; padding: 0 1.15rem; border-color: var(--mx-pill-edge); background: var(--mx-pill); color: var(--mny-text); font-weight: 500;
  transition: background-color 180ms var(--mx-ease), border-color 180ms, color 180ms, transform 120ms var(--mx-ease); }
.mny-theme .mny-pill:hover:not(:disabled):not([aria-pressed="true"]) { background: var(--mx-pill-hover); border-color: var(--mx-pill-hover-edge); }
.mny-theme .mny-pill[aria-pressed="true"] { background: var(--mny-grad); color: var(--mny-on-grad); border-color: transparent; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22); }
.mny-theme .mny-pill.sm { height: 2rem; padding: 0 0.85rem; }
.mny-theme .mny-pill:disabled { color: var(--mny-muted); }
.mny-theme .mny-cta, .mny-theme .mny-cta:hover:not(:disabled) { background: var(--mx-cta); color: var(--mx-cta-ink); border-color: transparent; box-shadow: var(--mx-cta-shadow); }
.mny-theme .mny-field { background: var(--mx-field); border-color: var(--mx-field-edge); }

/* the ask bar: a wide pill, as in the reference */
.mx-ask { display: flex; align-items: center; gap: 10px; height: 3rem; padding: 0 1.2rem; border-radius: 999px; text-align: left;
  border: 1px solid var(--mx-ask-edge); background: var(--mx-ask); color: var(--mny-muted); font-size: 0.9375rem;
  transition: border-color 180ms, background-color 180ms, color 180ms, transform 120ms var(--mx-ease); }
.mx-ask:hover { border-color: var(--mx-pill-hover-edge); color: var(--mny-text); }
.mx-ask:active { transform: scale(0.985); }

.mx-chip { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 12px; font-size: 0.75rem; font-weight: 600;
  border: 1px solid var(--mx-chip-edge); background: var(--mx-chip); color: var(--mny-text); }

/* ---- the "watchlist": rows on a hairline, the way the reference lists its holdings ---- */
.mx-asset { padding: 14px 0; border-top: 1px solid var(--mx-hair); }
.mx-asset:first-child { border-top: 0; padding-top: 4px; }
.mx-asset:last-child { padding-bottom: 0; }
.mx-list > li, .mx-list > div.mx-li { padding: 12px 0; border-top: 1px solid var(--mx-hair); }
.mx-list > li:first-child { border-top: 0; padding-top: 2px; }

/* ---- progress bars (budgets) ---- */
.mny-theme .mny-bar { height: 0.55rem; background: var(--mx-bar); border-color: var(--mx-tile-edge); }
.mny-theme .mny-bar > span { background: var(--mx-bar-fill); transform-origin: left; animation: mx-bar 900ms var(--mx-ease) both; animation-delay: 300ms; }
.mny-theme .mny-bar > span.warn { background: var(--mx-warn-fill); }
.mny-theme .mny-bar > span.over { background: var(--mx-over-fill); }
@keyframes mx-bar { from { transform: scaleX(0); } }

.mny-theme .mny-tip { background: var(--mx-tip); border-color: var(--mx-edge-hover); border-radius: 18px; padding: 0.7rem 0.95rem; }
.mny-theme .mny-state { background: var(--mx-state); }
.mny-theme .mny-state.neg { background: var(--mny-neg-tint); }
.mny-theme .mny-state.amber { background: var(--mny-amber-tint); }
.mny-theme .mny-row:hover, .mny-theme .mny-row:focus-within { background: var(--mx-row); }
.mny-theme .mny-skip { background: transparent; }

/* ---- motion: one staggered entrance; figures and bars arrive softly ---- */
@keyframes mx-rise { from { opacity: 0; transform: translateY(12px); filter: blur(6px); } }
.mx-rise { animation: mx-rise 700ms var(--mx-ease) both; animation-delay: calc(var(--i, 0) * 65ms); }
@keyframes mx-appear { from { opacity: 0; filter: blur(4px); } }
.mx-appear { animation: mx-appear 420ms var(--mx-ease) both; }
.mx-press { transition: transform 120ms var(--mx-ease); }
.mx-press:active { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) {
  .mx-rise, .mx-appear, .mny-theme .mny-bar > span { animation: none !important; }
  .mny-theme .mny-card, .mny-theme .mny-pill, .mx-ask { transition: none !important; }
}
.no-anim .mx-rise, .no-anim .mx-appear, .no-anim .mny-theme .mny-bar > span { animation: none !important; }
```

**`public/theme-init.js`** (runs before first paint)
```js
/* Sets the theme class on <html> before the first paint, so a light-theme visitor never sees a flash of dark.
   Same rule as the settings provider (src/context/SettingsContext.jsx): the saved choice is "light", "dark" or "system"
   (stored as JSON under lm_theme); no saved choice means "system". Loaded as an external same-origin script because the
   Content-Security-Policy allows only script-src 'self'. */
(function () {
  var root = document.documentElement;
  var choice = "system";
  try {
    var raw = window.localStorage.getItem("lm_theme");
    if (raw !== null) choice = JSON.parse(raw);
  } catch (e) { /* storage unavailable: follow the device */ }
  var dark = choice === "dark" || (choice !== "light" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) root.classList.add("dark"); else root.classList.remove("dark");
})();
```

**Shared primitives** — the complete current source of the shared components that carry the theme is in §K.8.

### K.5b Cascade order and stale rules (important)
`index.css` still contains the *original* Money rules (written for a green design: `.mny-stage` radius 1.75rem, `.mny-card` radius 1.5rem (24px), `.mny-tile` 1.1rem, `.mny-pill` height 2.25rem with an outline in `--mny-line`, `.mny-bar` 0.5rem, a `--mny-green` focus outline, and flat `--mny-*` colours). **`src/theme/orchid.css` must be imported after `index.css` and it wins**: every rule there is scoped `.mny-theme …` (one class more than the base rules). The effective values are the ones in §D/§E (28px card, 20px tile, 40px pill, 8.8px bar, orchid focus outline). When rebuilding from scratch you can omit the stale base rules and keep only the orchid.css versions, provided you also keep the `.mny-stage`, `.mny-hair`, `.mny-num`, `.mny-row`, `.mny-icon-btn`, `.mny-state`, `.mny-tip` and skeleton rules from `index.css` (they are not overridden).
The scope classes sit on **one element**: Money/Profile/Settings render `className="mny-theme mny-stage …"` on the page's root; People renders `ppl-theme ppl-stage` the same way.

### K.5c Behaviour that is not visible in CSS
| Behaviour | Spec |
|---|---|
| Sidebar peek | `mouseenter`/focus-visible opens immediately (`setPeek(true)`); `mouseleave`/blur closes after **220ms**; choosing a link or Sign out closes immediately. Pin button toggles `sideMenu` between `"auto"` (rail + peek) and `"open"` (docked); the choice is a per-device setting persisted by the settings provider. Touch/no-hover devices always dock. |
| Quick Add (FAB) hide | Only when the viewport is narrower than 1024px: hide when scrolled down by more than 8px **and** `scrollY ≥ 120`; show again on scrolling up by more than 8px, within 80px of the page end, when `scrollY < 120`, or when the button takes keyboard focus. Wide screens never hide it. |
| Pointer light | one `onPointerMove` on the stage: `if (e.pointerType !== "mouse") return; const card = e.target.closest(".mny-card"); if (!card) return; const r = card.getBoundingClientRect(); card.style.setProperty("--mx", `${e.clientX - r.left}px`); card.style.setProperty("--my", `${e.clientY - r.top}px`);` (full function in §K.8 `Money.jsx` excerpt) |
| Tooltips | Radix `TooltipProvider delayDuration=250` (250ms open delay) |
| Toasts | Sonner `<Sonner position="top-center" richColors closeButton … />`, library-default duration (4s), classes in §E.6 |
| Z-index scale | sticky date header 10 · top bar 20 · docked sidebar 30 · bottom bar 30 · FAB 30 · peek sidebar 40 · assistant scrim 40 · dialogs/sheets/popovers/menus/tooltips/assistant panel 50 · intro splash 100 |
| Intro splash | on first load per session a full-screen `bg-slate-950` splash ("Welcome back, Name" 30–36px/800 + "Here's what's happening today." muted) fades out after ~2.1s (`opacity` 500ms) |
| Spinner / loader sizes | `Loader2` 16px (`h-4 w-4`) with `animate-spin`; inline button spinners same |
| Assistant button | 44px tall on phones (`h-11`, icon-only), 40px (`sm:h-10`) with label from `sm` |
| Logo | 32px rounded-xl tile, lucide `Sparkles` 16px glyph, wordmark "Life Record" 700 / `tracking-tight` |

### K.5d Page layouts (described from the rendered pages)
These are structural descriptions from the rendered app at 1440px (values come from the tokens/classes above).
- **Money:** stage (`.mny-stage`, 32px radius) → header (title + subline, right-aligned action pills: Transfer, Budgets, Export, **Add expense** = CTA) → period pill row (scroll-snap) beside the 19rem ask bar → 3 cards (total + flow stack | accounts watchlist | this-period tiles) → chart card (8) + category donut card (4) → merchants + income/expense cards → budgets → transactions card with sticky date groups.
- **Settings / Profile:** stage with the page title left and a two-option segmented control (Profile | Settings) right. Settings: left vertical list of section buttons (selected = pill gradient) + a large card with a section header (round icon badge, title, description) and rows. Profile: identity card (96px avatar, name, chips), then a 2-column row (Password | Two-step), a full-width Sessions card and a 3-column "Your data" row.
- **People:** `.ppl-stage` with title + CTA, a summary card split in two columns ("They owe you" / "You owe", large tabular figures in orchid / amber) next to a "Latest" panel, a search pill + sort select, filter pills (Everyone, They owe me, I owe them, Settled, Archived), then the directory (header row + rows with avatar, name, two balances, Debt/Payment pills, edit/delete icon buttons). Floating layers (profile sheet, dialogs, delete bar) use `.ppl-glass`.
- **Groceries / Nutrition / Fitness / Body / Tasks / Calendar:** page title + subline + right-aligned pills, then a shadcn `Tabs` list (Groceries, Nutrition), then `Card`s (`card-ambient`) in 1–3 column grids with `gap-4`. Nutrition's left column is the diary (quick-add field, energy card with a segmented bar, meal cards) and the right column stacks Hydration / Insights / Sources cards.
- **Login / Sign-up / Forgot / Reset:** split screen. Left half: brand panel (haze background, logo, 4xl–5xl headline 700 with the second clause in orchid, supporting sentence, three-word footer). Right half: centred 384px form (heading, field labels 14px/500, pill inputs with leading icons, a full-width pill button using the default/primary variant, secondary links in orchid).

### K.6 Status, known gaps and unresolved details
**Resolved in the current implementation (verified 2026-11-04):** the selected-tab fill (§E.5); the toaster now follows the saved theme; the unused `chart-1…5` Tailwind colours were removed; the assistant caret/typing dots/pulse ring and the Quick Add shadow now read theme variables; the light CTA gradient start was darkened to `#876096` (5.07:1 with white); the flash of dark for light-theme users is removed by `public/theme-init.js`.

**Automated verification:** the axe colour-contrast audits (all pages, person detail, grocery tabs, dialogs and panels, empty states, public pages, nutrition) pass in **both** themes at desktop, tablet and phone widths. The Money skeleton-fidelity test fails only on accounts without locked money or sub-places, by design: the Money skeleton always draws the fullest shape (a "locked" line and a places line), so a brand-new account's real cards are ~22px shorter.

**Remaining, to be aware of (none block reproduction):**
1. **Stale base rules** in `index.css` for the old green Money design (see §K.5b): `orchid.css` must be imported after it and wins.
2. **`.card-ambient` has no pointer light** (only `.mny-card` and Home's cards do); cards on other pages are border-only on hover.
3. **`Tooltip` inverts** (`bg-foreground text-background`) rather than using a themed surface (intentional).
4. **Intentional literals:** the Settings theme-preview palettes; `bg-black/50` caption chips over Body progress photos; the logo/avatar gradient and ink; the selected-pill gradient end colours (`#87699b`, `#4f3b5a`, `#5a4566`) are fixed in both themes.
5. **Two sets of card/popover colour:** the HSL tokens `--card`/`--popover` (used by `bg-card`/`bg-popover`) and the glass `--card-fill`; both exist on purpose.
6. **Page-specific measurements not taken:** People, Profile, Settings, Calendar and Nutrition internal spacing/heights were reviewed visually and through the shared tokens, not individually measured; compare screenshots when rebuilding them.
7. **Legacy class names** (`emerald`, `teal`, `ppl-teal`) remain (their colours are orchid/mauve) to avoid rewriting hundreds of class lists.
8. **HSL columns:** for HSL-triple tokens the HSL column shows the authored triple; HEX/RGB are computed (rounding may shift a channel by 1).
9. **Approximation:** the Money page title size (40px) is a 1440px measurement of a `clamp()`.
10. **Not implemented (proposals):** a light-theme variant of the Settings preview tiles is not needed (they show both themes); a global theme-switch transition is deliberately absent.

### K.8 Source of the shared components that carry the theme (verbatim, current)
These files are what the class strings in §E refer to. Reproduce them to get identical structure. (Imports of app-specific helpers such as `cn` = `clsx` + `tailwind-merge`, `@/lib/*` and routes can be replaced by equivalents; they do not affect appearance.)

**`src/components/ui/button.jsx`**
```jsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-primary/85",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-line-strong bg-field hover:bg-hover",
        secondary:
          "bg-hover text-secondary-foreground hover:bg-hover",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
```

**`src/components/ui/input.jsx`**
```jsx
import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-full border border-line-strong bg-field px-4 py-1 text-base shadow-sm transition-[border-color,background-color,box-shadow] duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input }
```

**`src/components/ui/textarea.jsx`**
```jsx
import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-2xl border border-line-strong bg-field px-4 py-2.5 transition-[border-color,background-color] duration-200 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Textarea.displayName = "Textarea"

export { Textarea }
```

**`src/components/ui/select.jsx`**
```jsx
import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between whitespace-nowrap rounded-full border border-line-strong bg-field px-4 py-2 transition-[border-color,background-color] duration-200 hover:border-line-strong text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}>
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}>
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}>
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-2xl border border-line bg-popover text-popover-foreground shadow-[var(--pop-shadow)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}>
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn("p-1", position === "popper" &&
          "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}>
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}>
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
```

**`src/components/ui/tabs.jsx`**
```jsx
import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-full border border-line bg-field p-1 text-muted-foreground",
      className
    )}
    {...props} />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium ring-offset-background transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-[image:var(--pill)] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]",
      className
    )}
    {...props} />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props} />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

**`src/components/ui/card.jsx`**
```jsx
import * as React from "react"

import { cn } from "@/lib/utils"

const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("card-ambient rounded-3xl border text-card-foreground", className)}
    {...props} />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props} />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props} />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props} />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
```

**`src/components/ui/dialog.jsx`**
```jsx
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-scrim backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-1.5rem)] max-w-lg max-h-[92vh] overflow-y-auto translate-x-[-50%] translate-y-[-50%] gap-4 rounded-3xl border border-line [background:var(--card-fill)] p-6 shadow-[var(--pop-shadow)] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl",
        className
      )}
      {...props}>
      {children}
      <DialogPrimitive.Close
        className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
```

**`src/components/ui/alert-dialog.jsx`**
```jsx
import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-scrim backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref} />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-1.5rem)] max-w-lg max-h-[92vh] overflow-y-auto translate-x-[-50%] translate-y-[-50%] gap-4 rounded-3xl border border-line [background:var(--card-fill)] p-6 shadow-[var(--pop-shadow)] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl",
        className
      )}
      {...props} />
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}
    {...props} />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0", className)}
    {...props} />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
```

**`src/components/ui/sheet.jsx`**
```jsx
import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva } from "class-variance-authority";
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-scrim backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref} />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-50 gap-4 border border-line bg-background p-6 shadow-[var(--pop-shadow)] transition ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

const SheetContent = React.forwardRef(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
      <SheetPrimitive.Close
        className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}
    {...props} />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props} />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
```

**`src/components/ui/popover.jsx`**
```jsx
import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-2xl border border-line bg-popover p-4 text-popover-foreground shadow-[var(--pop-shadow)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
        className
      )}
      {...props} />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
```

**`src/components/ui/dropdown-menu.jsx`**
```jsx
import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props}>
    {children}
    <ChevronRight className="ml-auto" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-2xl border border-line bg-popover p-1.5 text-popover-foreground shadow-[var(--pop-shadow)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
      className
    )}
    {...props} />
))
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-2xl border border-line bg-popover p-1.5 text-popover-foreground shadow-[var(--pop-shadow)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
        className
      )}
      {...props} />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props} />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}>
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}>
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
    {...props} />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props} />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({
  className,
  ...props
}) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props} />
  );
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
```

**`src/components/ui/tooltip.jsx`**
```jsx
import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props} />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
```

**`src/components/ui/hint.jsx`**
```jsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Themed replacement for the browser's native `title` tooltip. Wraps a single focusable child. */
export function Hint({ label, children, side = "top" }) {
  if (!label) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
```

**`src/components/ui/checkbox.jsx`**
```jsx
import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer grid h-[1.15rem] w-[1.15rem] shrink-0 place-items-center rounded-[0.4rem] border-2 border-slate-300 bg-background transition-all duration-150 dark:border-slate-600",
      "hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
      className
    )}
    {...props}>
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current animate-in zoom-in-50 duration-150 motion-reduce:animate-none">
      <Check className="h-3 w-3" strokeWidth={3.5} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
```

**`src/components/ui/switch.jsx`**
```jsx
import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}>
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )} />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
```

**`src/components/ui/badge.jsx`**
```jsx
import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}) {
  return (<div className={cn(badgeVariants({ variant }), className)} {...props} />);
}

export { Badge, badgeVariants }
```

**`src/components/ui/progress.jsx`**
```jsx
import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
      className
    )}
    {...props}>
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }} />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
```

**`src/components/ui/skeleton.jsx`**
```jsx
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props} />
  );
}

export { Skeleton }
```

**`src/components/ui/sonner.jsx`**
```jsx
import { Toaster as Sonner, toast } from "sonner"
import { useSettings } from "@/context/SettingsContext"

/** App-wide toasts, themed with the same tokens as cards and dialogs and following the in-app theme. */
const Toaster = (props) => {
  const { theme } = useSettings() || { theme: "light" }

  return (
    <Sonner
      theme={theme}
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !border !border-line !bg-popover !shadow-[var(--pop-shadow)] !font-sans",
          title: "!font-semibold",
          description: "!text-muted-foreground",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
```

**`src/components/ui/alert.jsx`**
```jsx
import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props} />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props} />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props} />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
```

**`src/components/AppShell.jsx`**
```jsx
import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { prefetchRoute, warmAllRoutes } from "@/lib/routes";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Wallet, Users, ShoppingCart, Utensils, Dumbbell,
  HeartPulse, CheckSquare, Calendar, Settings as SettingsIcon,
  Sparkles, LogOut, Sun, Moon, Ellipsis, Pin, PinOff,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { UserAvatar } from "@/components/UserAvatar";
import { useSettings } from "@/context/SettingsContext";
import { AIAssistant } from "@/components/AIAssistant";
import { CommandBar } from "@/components/CommandBar";
import { QuickAdd } from "@/components/QuickAdd";
import { QuickAddFab } from "@/components/QuickAddFab";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/money", label: "Money", icon: Wallet },
  { to: "/people", label: "People", icon: Users },
  { to: "/groceries", label: "Groceries", icon: ShoppingCart },
  { to: "/nutrition", label: "Nutrition", icon: Utensils },
  { to: "/fitness", label: "Fitness", icon: Dumbbell },
  { to: "/body", label: "Body", icon: HeartPulse },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

// The phone's bottom bar has room for four pages and "More"; every other page is behind "More". Quick add floats above the bar.
const BAR_PATHS = ["/", "/money", "/people", "/tasks"];
const MOBILE_NAV = [NAV[0], NAV[1], NAV[2], NAV[7]];
const MORE_NAV = NAV.filter((n) => !BAR_PATHS.includes(n.to));   // derived, so a page added to NAV can never be unreachable on a phone

export function openAI(prompt) {
  window.dispatchEvent(new CustomEvent("lm:openAI", { detail: { prompt, opener: document.activeElement } }));
}

function Intro({ name, onDone }) {
  useEffect(() => {
    const seen = sessionStorage.getItem("lm_intro");
    if (seen) { onDone(); return; }
    sessionStorage.setItem("lm_intro", "1");
    const t = setTimeout(onDone, 2100);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <motion.div exit={{ opacity: 0 }} transition={{ duration: 0.5 }}
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950 text-white">
      <div className="text-center px-6">
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="text-3xl sm:text-4xl font-extrabold tracking-tight">Welcome back{name ? `, ${name}` : ""}</motion.p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.6 }}
          className="mt-3 text-slate-400">Here's what's happening today.</motion.p>
      </div>
    </motion.div>
  );
}

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const { theme, setTheme, sideMenu, setSideMenu, bindServer, pull } = useSettings();
  const nav = useNavigate();
  const loc = useLocation();
  const [intro, setIntro] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef(null);
  // On a wide screen the side menu is a thin strip of icons that widens over the page while the pointer (or keyboard focus) is
  // on it. A screen that cannot hover keeps it open, and the pin keeps it open for anyone who prefers that.
  const pinned = sideMenu === "open";
  const [canHover, setCanHover] = useState(() => (typeof window.matchMedia !== "function" ? true : window.matchMedia("(hover: hover)").matches));
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(hover: hover)");
    const on = () => setCanHover(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  const docked = pinned || !canHover;
  const expanded = docked || peek;
  const showPeek = () => { clearTimeout(peekTimer.current); setPeek(true); };
  const hidePeek = () => { clearTimeout(peekTimer.current); peekTimer.current = setTimeout(() => setPeek(false), 220); };
  // Choosing a page folds the menu back to its strip, even while the pointer is still on it; it opens again when the pointer re-enters.
  const retract = () => { clearTimeout(peekTimer.current); setPeek(false); };
  const togglePin = () => setSideMenu(pinned ? "auto" : "open");

  // The person's saved choices (theme, animations, week start...) are asked for at sign-in, when the tab comes back to the front, and after
  // anything that refreshes the data (the assistant changing a setting is one). `pull` is read through a ref so a choice made here is never
  // answered by an older copy from the server.
  const pullRef = useRef(pull);
  pullRef.current = pull;
  useEffect(() => {
    if (!user?.id) return undefined;
    bindServer(true);
    pullRef.current({ force: true });
    const again = () => pullRef.current();
    const visible = () => { if (document.visibilityState === "visible") again(); };
    window.addEventListener("lm:refresh", again);
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("lm:refresh", again); document.removeEventListener("visibilitychange", visible); bindServer(false); };
  }, [user?.id, bindServer]);
  const inMore = MORE_NAV.some((n) => loc.pathname === n.to || loc.pathname.startsWith(n.to + "/"));

  // Once things are quiet after sign-in, download every page and warm its data, one page at a time.
  useEffect(() => {
    if (!user?.id) return undefined;
    const t = setTimeout(() => { stopWarm = warmAllRoutes(user.id); }, 1200);
    let stopWarm = () => {};
    return () => { clearTimeout(t); stopWarm(); };
  }, [user?.id]);
  // Moving towards a link is a strong hint: refresh that page's code and data before the click lands.
  const warm = (to) => { if (user?.id) prefetchRoute(to, user.id, { maxAgeMs: 15_000 }); };
  // New page: start at the top, like a real navigation.
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener("lm:offline", off);
    window.addEventListener("lm:online", on);
    return () => { window.removeEventListener("lm:offline", off); window.removeEventListener("lm:online", on); };
  }, []);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="App min-h-screen">
      <AnimatePresence>{intro && <Intro key="intro" name={user?.name} onDone={() => setIntro(false)} />}</AnimatePresence>

      {/* Desktop sidebar */}
      <aside data-testid="sidebar" data-expanded={expanded}
        onMouseEnter={showPeek} onMouseLeave={hidePeek} onFocus={(e) => { if (e.target.matches(":focus-visible")) showPeek(); }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) hidePeek(); }}
        className={cn("hidden lg:flex flex-col fixed inset-y-0 left-0 overflow-hidden border-r border-line backdrop-blur-xl transition-[width,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          expanded ? "w-60" : "w-16", docked ? "bg-sidebar z-30" : "bg-card z-40", expanded && !docked && "shadow-[var(--pop-shadow)]")}>
        <div className="h-16 flex shrink-0 items-center gap-2 border-b border-border px-4">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#e2b6ea,#a679b2)] text-[#2a1433] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Sparkles className="h-4 w-4" /></div>
          <span className={cn("whitespace-nowrap font-bold tracking-tight text-foreground transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0")}>Life Record</span>
          {canHover && expanded && (
            <button type="button" data-testid="sidebar-pin" onClick={togglePin} aria-pressed={pinned} aria-label={pinned ? "Let the menu hide again" : "Keep the menu open"}
              className="ml-auto grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground">
              {pinned ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} data-testid={`nav-${n.label.toLowerCase()}`}
              onMouseEnter={() => warm(n.to)} onFocus={() => warm(n.to)} onTouchStart={() => warm(n.to)} onClick={retract}
              className={({ isActive }) => cn(
                "relative isolate flex items-center gap-3 whitespace-nowrap rounded-full px-[11px] py-2.5 text-sm font-medium transition-colors duration-200",
                isActive ? "text-white" : "text-muted-foreground hover:bg-hover hover:text-foreground"
              )}>
              {({ isActive }) => (<>
                {isActive && <motion.span layoutId="nav-pill" aria-hidden="true" className="absolute inset-0 -z-10 rounded-full pill-fill shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]" transition={{ type: "spring", stiffness: 420, damping: 38 }} />}
                <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /><span className={cn("transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0")}>{n.label}</span>
              </>)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <button data-testid="logout-btn" onClick={() => { retract(); logout(); }}
            className="flex w-full items-center gap-3 whitespace-nowrap rounded-full px-[11px] py-2.5 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-hover hover:text-foreground">
            <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /><span className={cn("transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0")}>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <header className={cn("glass sticky top-0 z-20 h-16 border-b border-line", docked ? "lg:pl-60" : "lg:pl-16")}>
        {/* The same width as the page below, so the bar lines up with the content. */}
        <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:px-6">
          <div className="lg:hidden flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-[linear-gradient(135deg,#e2b6ea,#a679b2)] text-[#2a1433]"><Sparkles className="h-4 w-4" /></div>
            <span className="font-bold tracking-tight">Life Record</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" data-testid="ai-trigger" aria-label="Open the assistant" aria-haspopup="dialog" onClick={() => openAI()}
              className="group flex h-11 min-w-[2.75rem] items-center justify-center gap-2 rounded-full sm:h-10 sm:min-w-0 border border-line-strong bg-field px-3 text-sm font-semibold text-foreground transition-[background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-line-strong hover:bg-hover active:scale-[0.96] motion-reduce:transition-colors motion-reduce:active:scale-100 sm:pl-3.5 sm:pr-4">
              <Sparkles className="h-4 w-4 text-accent-ink transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-[18deg] group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:transform-none" aria-hidden="true" />
              <span className="hidden sm:inline">Assistant</span>
            </button>
            <button data-testid="theme-toggle" aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-field text-foreground transition-[border-color,background-color,transform] duration-200 hover:bg-hover active:scale-95 sm:h-10 sm:w-10">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <NavLink to="/profile" data-testid="header-profile" aria-label={`Your profile${user?.name ? `, ${user.name}` : ""}`}
              className="grid h-11 w-11 place-items-center overflow-hidden rounded-full border border-line-strong bg-field text-sm font-semibold text-accent-ink transition-[border-color,transform] duration-200 hover:border-line-strong active:scale-95 sm:h-10 sm:w-10">
              {/* Decorative: the button's label already names the person (the initials would not match it). A fixed size, so a large photo is scaled, not cropped by its own size. */}
              <span aria-hidden="true" className="block h-[38px] w-[38px] overflow-hidden rounded-full"><UserAvatar size="h-[38px] w-[38px]" className="text-xs" decorative /></span>
            </NavLink>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className={docked ? "lg:pl-60" : "lg:pl-16"}>
        {offline && (
          <div data-testid="offline-banner" className="bg-amber-700 text-white text-sm font-medium text-center py-2 px-4">
            ⚠️ Offline / fallback mode — backend unavailable. Showing last known data; changes won't save until reconnected.
          </div>
        )}
        <div key={loc.pathname} className="lm-page max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-40 lg:pb-24">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden glass-strong fixed bottom-0 inset-x-0 z-30 flex h-16 items-center justify-around border-t border-line px-2">
        {MOBILE_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} data-testid={`mnav-${n.label.toLowerCase()}`}
            onTouchStart={() => warm(n.to)} onFocus={() => warm(n.to)}
            className={({ isActive }) => cn("relative isolate flex flex-col items-center gap-0.5 rounded-full px-4 py-1.5 text-[10px] font-medium transition-colors duration-200 active:scale-95",
              isActive ? "text-white" : "text-muted-foreground")}>
            {({ isActive }) => (<>
              {isActive && <motion.span layoutId="mnav-pill" aria-hidden="true" className="absolute inset-0 -z-10 rounded-full pill-fill shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]" transition={{ type: "spring", stiffness: 420, damping: 38 }} />}
              <n.icon className="h-5 w-5" />{n.label}
            </>)}
          </NavLink>
        ))}
        <button ref={moreButton} type="button" data-testid="mnav-more" aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={inMore ? "page" : undefined}
          onClick={() => setMoreOpen(true)}
          className={cn("flex flex-col items-center gap-0.5 rounded-full px-4 py-1.5 text-[10px] font-medium transition-[color,background-color,transform] duration-200 active:scale-95",
            inMore ? "bg-hover text-foreground" : "text-muted-foreground")}>
          <Ellipsis className="h-5 w-5" aria-hidden="true" />More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        {/* Opened from state rather than a Trigger, so Radix cannot return the focus by itself: put it back by hand. */}
        <SheetContent side="bottom" className="lg:hidden rounded-t-3xl pb-8" data-testid="more-sheet"
          onCloseAutoFocus={(e) => { e.preventDefault(); moreButton.current?.focus(); }}>
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">The other pages, and sign out</SheetDescription>
          </SheetHeader>
          <nav aria-label="More pages" className="mt-4 grid grid-cols-3 gap-2">
            {MORE_NAV.map((n) => (
              <NavLink key={n.to} to={n.to} data-testid={`more-${n.label.toLowerCase()}`} onClick={() => setMoreOpen(false)}
                className={({ isActive }) => cn("flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-xs font-medium transition-[background-color,border-color,transform] duration-200 active:scale-95",
                  isActive ? "border-transparent pill-fill"
                           : "border-line bg-field text-foreground hover:bg-hover")}>
                <n.icon className="h-5 w-5" aria-hidden="true" />{n.label}
              </NavLink>
            ))}
          </nav>
          <button type="button" data-testid="more-signout" onClick={logout}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-line-strong bg-field py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-hover">
            <LogOut className="h-4 w-4" aria-hidden="true" />Sign out
          </button>
        </SheetContent>
      </Sheet>

      <QuickAddFab onClick={() => setQuickOpen(true)} />
      <AIAssistant />
      <CommandBar open={cmdOpen} setOpen={setCmdOpen} onQuickAdd={() => setQuickOpen(true)} />
      <QuickAdd open={quickOpen} setOpen={setQuickOpen} />
    </div>
  );
}
```

**`src/components/QuickAddFab.jsx`**
```jsx
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";

/** Hides while the page is being scrolled down on a phone or tablet (where it would sit over the content being read) and comes back on the
 *  first scroll up, at the end of the page, or when it takes keyboard focus. A wide screen never hides it. */
function useHideOnScrollDown() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const narrow = window.matchMedia("(max-width: 1023px)");
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const nearEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 80;
      if (!narrow.matches || nearEnd || y < 120) setHidden(false);
      else if (y - last > 8) setHidden(true);
      else if (last - y > 8) setHidden(false);
      if (Math.abs(y - last) > 8) last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return [hidden, setHidden];
}

/** Quick add, floating in the bottom-right corner. It opens the same dialog the top bar's "Add" used to. On a phone it sits above the
 *  bottom bar and the device's safe area; on a wide screen it is a round button that unfolds into a labelled pill while it is hovered
 *  or focused. The page keeps clear space under its last row (AppShell), so the button never covers the end of a page. */
export function QuickAddFab({ onClick }) {
  const reduce = useReducedMotion();
  const [hidden, setHidden] = useHideOnScrollDown();
  return (
    <motion.button type="button" data-testid="quick-add-trigger" aria-label="Quick add" aria-haspopup="dialog" onClick={onClick}
      data-hidden={hidden || undefined} onFocus={() => setHidden(false)}
      initial={reduce ? false : { opacity: 0, scale: 0.7, y: 16 }} animate={{ opacity: hidden ? 0 : 1, scale: 1, y: hidden ? 24 : 0 }}
      transition={reduce ? { duration: 0 } : hidden ? { duration: 0.18, ease: [0.16, 1, 0.3, 1] } : { type: "spring", damping: 22, stiffness: 320, delay: 0.35 }}
      whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.92, y: 0 }}
      style={hidden ? { pointerEvents: "none" } : undefined}
      className="group fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 items-center justify-center overflow-hidden rounded-full cta-fill px-[1.0625rem] outline-none transition-[background-color,box-shadow] duration-200 hover:brightness-105 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 motion-reduce:transition-none lg:bottom-6 lg:right-6 shadow-[var(--fab-shadow)] hover:shadow-[var(--fab-shadow-hover)]">
      <Plus className="h-6 w-6 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-90 group-focus-visible:rotate-90 motion-reduce:transition-none motion-reduce:group-hover:rotate-0" aria-hidden="true" />
      <span className="hidden max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold opacity-0 transition-[max-width,margin,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:ml-2 group-hover:max-w-[5rem] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[5rem] group-focus-visible:opacity-100 motion-reduce:transition-none lg:inline" aria-hidden="true">Add</span>
    </motion.button>
  );
}
```

**`src/components/skeletons.jsx`**
```jsx
import { useRef } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Card } from "@/components/common";
import { cn } from "@/lib/utils";

/* One skeleton system for the whole app.
   - `Sk`        a placeholder block. Give it the size of what it stands for (a text line is h-4, a figure is the figure's own height).
   - `Busy`      the group around placeholders: ONE polite announcement ("Loading balances"), and aria-busy for tools; the blocks are hidden from them.
   - `Resolve`   one section's life: skeleton while it has nothing, an error with Retry if the request failed, the content (faded in only if a
                 skeleton was shown, so cached or instant content never flickers) when it has data.
   A section decides for ITSELF from its own data; nothing here waits for another section. */

export function Sk({ className, style }) {
  return <span aria-hidden="true" className={cn("skeleton block", className)} style={style} />;
}

/** `n` lines of text; the last is shorter, the way a paragraph ends. `widths` overrides them (Tailwind width classes). */
export function SkLines({ n = 3, className, line = "h-3.5", widths }) {
  const w = widths || Array.from({ length: n }, (_, i) => (i === n - 1 ? "w-3/5" : i % 2 ? "w-11/12" : "w-full"));
  return <div className={cn("space-y-2", className)}>{w.map((x, i) => <Sk key={i} className={cn(line, x)} />)}</div>;
}

/** Rows with a round or square lead, a title and a figure: lists of people, transactions, accounts, devices. */
export function SkRows({ n = 4, lead = "round", className, rowClass = "py-2.5", figure = true }) {
  return (
    <div className={cn("divide-y divide-border/60", className)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={cn("flex items-center gap-3", rowClass)}>
          {lead && <Sk className={cn("h-10 w-10 shrink-0", lead === "round" ? "rounded-full" : "rounded-xl")} />}
          <div className="min-w-0 flex-1 space-y-1.5"><Sk className={cn("h-3.5", i % 2 ? "w-2/5" : "w-1/2")} /><Sk className="h-3 w-1/3" /></div>
          {figure && <Sk className="h-4 w-16 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

/** A card of the same padding the real ones use, with a title line. */
export function SkCard({ children, className, title = true }) {
  return (
    <Card className={cn("p-5", className)}>
      {title && <Sk className="mb-4 h-4 w-32" />}
      {children}
    </Card>
  );
}

/** A chart's place: axis ticks on the left, faint grid, and a soft area shape so the eye reads "chart", not "box". */
export function SkChart({ className, height = 220 }) {
  return (
    <div className={cn("relative", className)} style={{ height }} aria-hidden="true">
      <div className="absolute inset-y-2 left-0 flex w-8 flex-col justify-between">{[0, 1, 2, 3].map((i) => <Sk key={i} className="h-2.5 w-6" />)}</div>
      <div className="absolute inset-y-2 left-10 right-0 flex flex-col justify-between">{[0, 1, 2, 3].map((i) => <span key={i} className="h-px w-full bg-border/60" />)}</div>
      <Sk className="absolute bottom-2 left-10 right-0 rounded-t-3xl" style={{ height: "55%" }} />
    </div>
  );
}

/** A form: a label and a field per row (the profile forms, the goals). `cols` puts two fields side by side from `sm`. */
export function SkForm({ n = 4, cols = 2, className }) {
  return (
    <div className={cn("grid gap-4", cols === 2 && "sm:grid-cols-2", className)} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <div key={i} className="space-y-1.5"><Sk className="h-3 w-24" /><Sk className="h-10 w-full !rounded-md" /></div>)}
    </div>
  );
}

export function Busy({ label = "Loading", children, className }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** What replaces a section whose request failed: the words, and a way to try again. Same height as a short card so the page does not jump. */
export function ErrorBlock({ what = "this", onRetry, className }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-5 py-8 text-center", className)} data-testid="section-error">
      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Could not load {what}.</p>
      <p className="max-w-xs text-xs text-slate-600 dark:text-slate-400">Nothing is lost. Check your connection and try again.</p>
      {onRetry && (
        <button type="button" onClick={onRetry} data-testid="section-retry"
          className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800">
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />Try again
        </button>
      )}
    </div>
  );
}

/** `loading`/`error` come from useFetch (or any state with the same meaning). `skeleton` is what the finished section will look like, empty.
 *  `as` is the element around the content ("div" by default; pass `contents`-style layouts by giving className). */
export function Resolve({ loading, error, onRetry, skeleton, label = "Loading", what, children, className, errorClassName }) {
  const waited = useRef(false);
  if (loading) waited.current = true;
  if (loading) return <Busy label={label} className={className}>{skeleton}</Busy>;
  if (error) return <div className={className}><ErrorBlock what={what || label.replace(/^Loading /i, "")} onRetry={onRetry} className={errorClassName} /></div>;
  return <div className={cn(className, waited.current && "sk-reveal")}>{children}</div>;
}
```

**`src/components/common.jsx`**
```jsx
import { cn } from "@/lib/utils";

const CONF = {
  exact: { bg: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-500/30", label: "Exact" },
  estimated: { bg: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-500/30", label: "Estimated" },
  historical: { bg: "bg-indigo-50 dark:bg-indigo-500/10", text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-200 dark:border-indigo-500/30", label: "Historical" },
  unknown: { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-600 dark:text-slate-300", border: "border-slate-200 dark:border-slate-700", label: "Unknown" },
};

export function ConfidenceBadge({ type = "exact", children }) {
  const c = CONF[type] || CONF.unknown;
  return (
    <span data-testid={`confidence-${type}`} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", c.bg, c.text, c.border)}>
      {children || c.label}
    </span>
  );
}

export function SectionHeading({ title, sub, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{title}</h2>
        {sub && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Label({ children }) {
  return <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</span>;
}

export function Card({ className, children, ...props }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card card-ambient", className)} {...props}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, accent = "text-slate-900 dark:text-slate-50", testid, className, loading = false }) {
  // An amount or a percentage is set large; a word (a category name) is set as text, or "Entertainment" outgrows its card.
  const wordy = typeof value === "string" && /[A-Za-z]{4,}/.test(value);
  if (loading) {
    // The same card, the same label, the figure and its hint as placeholders of their own size: nothing moves when the number arrives.
    return (
      <Card className={cn("p-4 sm:p-5", className)} data-testid={testid} aria-busy="true">
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          {Icon && <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />}
        </div>
        <span aria-hidden="true" className="skeleton mt-2 block h-7 w-28 sm:h-9" />
        {hint !== undefined && <span aria-hidden="true" className="skeleton mt-1.5 block h-3 w-24" />}
        <span className="sr-only">Loading {label}</span>
      </Card>
    );
  }
  return (
    <Card className={cn("p-4 sm:p-5 lm-in", className)} data-testid={testid}>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {Icon && <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />}
      </div>
      <div className={cn("mt-2 stat-num font-extrabold tracking-tight break-words", wordy ? "text-base sm:text-lg" : "text-xl sm:text-3xl", accent)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ icon: Icon, title, sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {Icon && <div className="mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 p-4"><Icon className="h-7 w-7 text-slate-500 dark:text-slate-400" /></div>}
      <p className="font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      {sub && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{sub}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SkeletonCard({ className }) {
  return (
    <Card className={cn("p-5", className)} aria-hidden="true">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-8 w-32 mt-3" />
      <div className="skeleton h-3 w-20 mt-3" />
    </Card>
  );
}

export function Avatar({ name, photo, size = "h-9 w-9" }) {
  const initials = (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return photo ? (
    <img src={photo} alt={name} className={cn("rounded-full object-cover", size)} />
  ) : (
    <div className={cn("rounded-full grid place-items-center bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-semibold text-xs", size)}>
      {initials}
    </div>
  );
}
```

**`src/pages/Money.jsx` (excerpt: the pointer-light handler)**
```jsx
/** One handler for the whole page: the card under the mouse gets the pointer position, and its light follows it (mouse only). */
function followPointer(e) {
  if (e.pointerType !== "mouse") return;
  const card = e.target.closest?.(".mny-card");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
}
```

**`src/lib/api.js` (excerpt: money formatting and category colours)**
```js
export const eur = (n) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(n || 0));

export const CATEGORY_COLORS = {
  Groceries: "#10B981", "Eating Out": "#F59E0B", Transport: "#6366F1", Shopping: "#EC4899",
  Entertainment: "#8B5CF6", Work: "#0EA5E9", Fitness: "#059669", Health: "#EF4444",
  Travel: "#14B8A6", Subscriptions: "#F97316", Bills: "#64748B", Other: "#94A3B8",
};
```

---

## L. Rules for future design work

**The prime rule: follow this specification; do not invent a new visual style.** If a need is not covered, derive it from the closest existing component and the principles in §A, then add it to this document.

1. **Tokens first.** Surfaces use `--card-fill`, `--line`, `--line-strong`, `--field`, `--hover`, `--sidebar`, `--glass*`, `--pop-shadow`, `--scrim`; text uses `text-foreground`, `text-muted-foreground`, `text-accent-ink`; actions use `bg-primary`, `.cta-fill`, `.pill-fill`. Inside `.mny-theme` use `--mny-*`/`--mx-*`.
2. **Never hard-code** a hex/rgba for a surface, border, text or shadow in a component. If a literal is unavoidable (data colour, fixed art), say why in a comment and check it in both themes.
3. **Choosing colour:** accent = mauve/orchid only. Gain = `--mny-green`, spend = `--mny-neg`, locked/pending = `--mny-amber` — each with a sign/icon/word. Data colours only for dots/bars/tinted icons.
4. **New components:** pill controls (h-10, `rounded-full`), cards 24–28px, hairline `--line`, 1px highlight, long soft shadow, `p-5 sm:p-6`, gap 16px, 14px text, figures tabular. Reuse `Card`, `Button`, `Input`, `Select`, `Dialog`, `Tabs`, skeleton and empty/error patterns before creating anything.
5. **New animations:** expo-out curve, opacity + ≤14px rise, 120–220ms feedback / 420–700ms structure, stagger 55–65ms, ≤10 staggered items; pair every keyframe with `prefers-reduced-motion` and `.no-anim` overrides; animate `opacity/transform/filter` (and `height` only for tiny bars); never layout-shift.
6. **Light/dark parity:** define both values at the same time in the same variable block; verify contrast for both (≥4.5:1 text); check screenshots of both themes; no component may look correct in only one.
7. **Avoid:** square controls, hard offset shadows, coloured glows, gradient text, uppercase eyebrow labels above headings, glass on content cards, nested cards, pure grey or navy neutrals, emoji as icons (use lucide, 1.5–2px stroke, 16/18/20px), any second accent hue, bouncing/overshooting motion, theme-switch transitions.
8. **Validate every new component** against this checklist: (a) uses tokens only; (b) correct radius/height; (c) all states present — hover, focus-visible, active, selected, disabled, loading, empty, error; (d) AA contrast in both themes; (e) keyboard reachable with visible focus; (f) works at 390px with no horizontal scroll and ≥44px targets; (g) motion follows §F with both reduced-motion switches; (h) screenshot compared in light and dark.
