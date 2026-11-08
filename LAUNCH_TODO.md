# Life Record: what is missing before launch

A short, ordered task list. It says WHAT is missing and in WHAT ORDER. It does not say how or in what style: that is decided with the owner when we reach each step.
Details and evidence for each item are in `APPLICATION_COMPLETION_ROADMAP.md` (row id in brackets). Tick a box when done and add the date.
Last updated: 2026-11-08 (Groceries finished: cooking time, side rail, phone and tablet pass; hand checks and a later pass listed under it).

## Order
1. Page redesigns
2. AI training and access management
3. Quality and open decisions (can run alongside step 1)
4. Mobile and all other devices (tablet and phone first)
5. Full security review
6. Launch path

## 1. Page redesigns (complete redesign of each, one at a time, in this order)
- [x] Groceries: the whole prototype is in the real app and tested (2026-11-07), and finished on 2026-11-08 with a design critique and a phone and tablet pass. Today, welcome and build animation, Kitchen cards and Mix your meal, 3D Storage room (flat view as fallback), Shopping (trip card, Plan, In the shop, shelves, recurring), cart, Catalog as a dialog, the add bar, server-saved layout, assistant tools. Details in the Status sections of `docs/superpowers/plans/2026-11-06-groceries-port.md`.
  - [x] 2026-11-08: recipes have an optional cooking time (migration, editor, cards, assistant tools, "Under 20 min" in Mix, which now has its own labelled row)
  - [x] 2026-11-08: the sections moved off the top: a retractable rail down the left side (three-bar button folds it to icons, the choice is remembered), a drawer on a phone; the cart is a round fixed button beside the quick-add "+" (in the page heading on a phone); Catalog is in the rail or drawer; Customise shares the space-filter row
  - [x] 2026-11-08: touch screens get 44 px controls (desktop density unchanged); darker greens and badge so text reaches 4.5:1; shorter hint in the add bar on a phone; In the shop is a calm one-line trip card with all aisles in one card; "Estimated" is said once; the item card scrolls into view
  - [x] 2026-11-08: live-model probe of the Groceries assistant tools, `tools/live_groceries_probe.py --run` on a scratch database: 15 calls, 15 of 15 chose a right tool and the data read back as asked (every delete and bulk add waited for a yes)
  - [x] 2026-11-08: the Nutrition day-view skeleton failure is fixed (the suggestions placeholder drew 6 rows for a card that shows 3)
  - [x] 2026-11-08: the two side fixes were checked (`tools/backup.py` skips a photo deleted while it runs; the recurring-list edit no longer errors); the backup-restore tests now back up again when another test worker wrote rows during the comparison (it failed in full runs only)
  - [ ] Try it by hand on a real screen with a GPU (the 3D room was checked in a software-rendered browser only), on a real phone and tablet, and with a screen reader [D-05]
  - [ ] `design-lab/` kept on purpose (owner said keep for now); it is untracked, so deleting it cannot be undone
  - [ ] Run the two new migrations on the live database when it is time to deploy: `d5b7f9a1c3e4` (user_layouts) and `e6c8a0b2d4f1` (recipes.cook_minutes)
  - [ ] Later pass from the critique (design score 26/40 before these fixes; not re-scored): 3D room on a phone fills a third of the stage and the hint wraps into a narrow column; Customise uses "M" and "S" size buttons; a missing price shows three ways (0.00, a dash, "Unknown"); cooking and "Used one" give no undo; the READY stamp is on every recipe whose ingredients are in stock; Flat view truncates long names and eggs and Cheddar show the milk glyph; the shell's top-left menu icon and the new three-bar button sit close together on a phone
  - [ ] Quick-add suggestion list was not seen by the design reviewer when typing in its browser; the e2e test passes, check by hand
- [ ] Fitness
- [ ] Body
- [ ] Tasks
- [ ] Calendar
- [ ] After them: a visual check that Money, People, Home and Nutrition still match the new pages

## 2. AI training and access management (after the redesigns are complete)
Goal: the best possible assistant. It must be able to do **everything a person can do anywhere in the website**, by chat, correctly and safely. Nothing in the app may be reachable only by clicking.
- [ ] Full coverage audit, page by page and button by button, including the redesigned pages. Every action needs a tool, for example:
  - Nutrition: log any food by amount, record individual micronutrients and vitamins, set targets and profile, plan, recipes, water, reports
  - Money: expenses, income, transfers between accounts and places, **moving money between currencies** with the right rates, budgets, recurring items, places and accounts in any currency
  - People and debts, Groceries and kitchen, Fitness and Body, Tasks, Calendar, Settings
- [ ] Every missing tool built; every tool covers all the fields the page itself offers (no half features)
- [ ] Access management: what the assistant may read and change per page and per action, confirmation for risky changes, undo, and an owner setting to switch parts off
- [ ] Training: prompts, tool descriptions and examples tuned so it picks the right tool and handles real, messy requests, checked with bounded live probes that read the data back
- [ ] Every action updates the screen and the data correctly and is isolated to the signed-in user
- [ ] A test list of realistic requests per page, with the expected data change, kept in the repo

## 3. Quality and open decisions
- [ ] Screen reader and keyboard pass, including a real NVDA run [D-05]
- [ ] Inline form errors instead of toasts only [D-08]
- [ ] Performance: timings with 2 years of data and final bundle numbers [D-07]
- [ ] Owner decides: Portuguese INSA food table licence [F-06], Nutrition reference gaps [F-07], splitting `server.py` [F-02]
- [ ] Owner actions: change the owner password [S-01], rotate the pasted keys [S-02], back up `UPLOAD_ENCRYPTION_KEY` [S-08], approve deleting `testuser1@example.com` and old logs [S-14], email sender off @gmail.com [S-06]

## 4. Mobile and all other devices
Turn the whole app into a fully working, fully functional and perfect-looking experience on every screen size, **tablet and phone first**, then laptop and large desktop.
- [ ] Every page and dialog works with touch, no overflow, nothing clipped or overlapping, in portrait and landscape
- [ ] Every action reachable and comfortable on a phone and a tablet
- [ ] Looks right in light and dark on all sizes
- [ ] Browser and device matrix: Safari, Firefox, a real phone and tablet, camera barcode scan, print preview [D-09]

## 5. Full security review
Complete review against every class of attack and failure, before anything goes public:
- [ ] Injection (SQL, command, template), cross-site scripting, CSRF, request forgery on the server side
- [ ] Phishing and account takeover: sign-in, password reset, email and SMS flows, two-step methods, sessions, device trust
- [ ] Rate limits, brute force, enumeration, abuse of the assistant and of uploads, denial of service
- [ ] Access control: every endpoint checked for ownership and isolation between users
- [ ] Secrets, keys, encryption, headers (CSP), cookies, dependencies and known vulnerabilities, logging without leaks
- [ ] Findings fixed and re-tested, results recorded

## 6. Launch path (last)
- [ ] Hosting target chosen [S-09]
- [ ] Deployment rehearsed: HTTPS, CSP header, `ALLOWED_HOSTS`, `COOKIE_SECURE`, TLS to the database [S-09]
- [ ] CI green on GitHub [S-10]
- [ ] Release regression gate on the final commit [S-16]
- [ ] **Launch**
