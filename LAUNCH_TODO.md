# Life Record: what is missing before launch

A short, ordered task list. It says WHAT is missing and in WHAT ORDER. It does not say how or in what style: that is decided with the owner when we reach each step.
Details and evidence for each item are in `APPLICATION_COMPLETION_ROADMAP.md` (row id in brackets). Tick a box when done and add the date.
Last updated: 2026-11-06.

## Order
1. Page redesigns
2. Quality and open decisions (can run alongside step 1)
3. Mobile and all other devices (tablet and phone first)
4. Full security review
5. Launch path

## 1. Page redesigns (complete redesign of each, one at a time, in this order)
- [ ] Groceries
- [ ] Fitness
- [ ] Body
- [ ] Tasks
- [ ] Calendar
- [ ] After them: a visual check that Money, People, Home and Nutrition still match the new pages

## 2. Quality and open decisions
- [ ] Screen reader and keyboard pass, including a real NVDA run [D-05]
- [ ] Inline form errors instead of toasts only [D-08]
- [ ] Performance: timings with 2 years of data and final bundle numbers [D-07]
- [ ] Owner decides: Portuguese INSA food table licence [F-06], Nutrition reference gaps [F-07], splitting `server.py` [F-02]
- [ ] Owner actions: change the owner password [S-01], rotate the pasted keys [S-02], back up `UPLOAD_ENCRYPTION_KEY` [S-08], approve deleting `testuser1@example.com` and old logs [S-14], email sender off @gmail.com [S-06]

## 3. Mobile and all other devices
Turn the whole app into a fully working, fully functional and perfect-looking experience on every screen size, **tablet and phone first**, then laptop and large desktop.
- [ ] Every page and dialog works with touch, no overflow, nothing clipped or overlapping, in portrait and landscape
- [ ] Every action reachable and comfortable on a phone and a tablet
- [ ] Looks right in light and dark on all sizes
- [ ] Browser and device matrix: Safari, Firefox, a real phone and tablet, camera barcode scan, print preview [D-09]

## 4. Full security review
Complete review against every class of attack and failure, before anything goes public:
- [ ] Injection (SQL, command, template), cross-site scripting, CSRF, request forgery on the server side
- [ ] Phishing and account takeover: sign-in, password reset, email and SMS flows, two-step methods, sessions, device trust
- [ ] Rate limits, brute force, enumeration, abuse of the assistant and of uploads, denial of service
- [ ] Access control: every endpoint checked for ownership and isolation between users
- [ ] Secrets, keys, encryption, headers (CSP), cookies, dependencies and known vulnerabilities, logging without leaks
- [ ] Findings fixed and re-tested, results recorded

## 5. Launch path (last)
- [ ] Hosting target chosen [S-09]
- [ ] Deployment rehearsed: HTTPS, CSP header, `ALLOWED_HOSTS`, `COOKIE_SECURE`, TLS to the database [S-09]
- [ ] CI green on GitHub [S-10]
- [ ] Release regression gate on the final commit [S-16]
- [ ] **Launch**
