import { test, expect } from "./fixtures";

// A skeleton is the real thing without its content: the same cards in the same places and sizes. This puts every card of a page's loading state next to
// the same card once loaded and compares position and size. (A card whose height depends on the data itself, like a list, is compared by top and width.)
test.use({ viewport: { width: 1440, height: 900 } });

const cold = (page) => page.addInitScript(() => Object.keys(localStorage).filter((k) => k.startsWith("lm_cache:")).forEach((k) => localStorage.removeItem(k)));
const dataRoute = (url) => { const p = new URL(url).pathname; return p.startsWith("/api/") && !p.startsWith("/api/auth/me/photo") && !(p.startsWith("/api/auth/") && !p.startsWith("/api/auth/2fa") && !p.startsWith("/api/auth/sessions")); };

/** The boxes of the page's cards, top to bottom: every element the page draws as a card (.mny-card, a Card), measured on the page. */
const cards = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)]
  .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 40)
  .map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-fid") || e.getAttribute("aria-labelledby") || e.getAttribute("data-testid") || "", x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }), selector);

async function compare(page, path, selector, { release, flexible = [], yTolerance = 20, hTolerance = 20, window = 70 }) {
  await cold(page);
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  await page.route((url) => dataRoute(url), async (route) => { await gate; await route.continue().catch(() => {}); });
  await page.goto(path);
  await expect(page.locator('main [role="status"][aria-busy="true"]').first()).toBeAttached();
  await page.waitForTimeout(500);
  const loading = await cards(page, selector);
  open();
  await release(page);
  await page.waitForTimeout(600);
  const loaded = await cards(page, selector);
  console.log(`${path}: ${loading.length} placeholder boxes, ${loaded.length} real boxes`);
  // every placeholder card must have a real one at the same place and size; all differences are reported together
  const problems = [];
  // both states must be a real layout, not just the same layout: a card squeezed into a sliver in both would otherwise "match"
  for (const r of [...loading, ...loaded]) if (r.w < 230) problems.push(`a card only ${r.w}px wide at x=${r.x}: ${r.id || "card"}`);
  for (const sk of loading) {
    const match = (sk.id && loaded.find((r) => r.id === sk.id)) || loaded.find((r) => Math.abs(r.x - sk.x) <= 6 && Math.abs(r.w - sk.w) <= 8 && Math.abs(r.y - sk.y) <= window);
    if (!match) { problems.push(`no real card in the place of ${sk.id || "a card"} ${JSON.stringify(sk)}`); continue; }
    if (!flexible.includes(match.id) && Math.abs(match.h - sk.h) > hTolerance) problems.push(`${match.id || "card"}: ${match.h}px tall, placeholder ${sk.h}px`);
    if (!flexible.includes(match.id) && Math.abs(match.y - sk.y) > yTolerance) problems.push(`${match.id || "card"}: at y=${match.y}, placeholder at y=${sk.y}`);
  }
  expect(problems, [path, ...problems, `real: ${JSON.stringify(loaded)}`].join("\n  ")).toEqual([]);
}

test("Money: every card's placeholder is the size and place of the real card", async ({ authenticatedPage: page }) => {
  await compare(page, "/money", "main section.mny-card, main div.mny-card", {
    release: (p) => expect(p.getByTestId("money-bank")).toBeVisible({ timeout: 15000 }),
    flexible: ["mny-time-h", "mny-cat-h", "mny-merch-h", "mny-inex-h", "mny-txn-h", "mny-budget-h"],      // as tall as the data (a chart row, a list)
  });
});

test("Home: the hero, the cards and the widgets match their placeholders", async ({ authenticatedPage: page }) => {
  await compare(page, "/", "main .card-ambient, main .rounded-3xl", { release: (p) => expect(p.getByTestId("stat-tasks")).not.toHaveAttribute("aria-busy", "true", { timeout: 15000 }), flexible: ["home-tasks", "home-txns", "home-nutrition", "home-people", "home-groceries"], yTolerance: 40 });   // an insight that wraps to a second line (a long person name) makes the insights card one text line taller than its two-row placeholder, and everything below shifts with it; as tall as the day's tasks, transactions, people and lists (the three widgets share one row height)
});

test("Profile: password, two-step, devices and your data keep their size while loading", async ({ freshUserPage: { page } }) => {
  await compare(page, "/profile", "main section.mny-card", { release: (p) => expect(p.getByTestId("sessions-list")).toBeVisible({ timeout: 15000 }) });
});

test("Groceries overview: each section's placeholder is the size and place of the real one", async ({ authenticatedPage: page }) => {
  await compare(page, "/groceries", 'main [role="tabpanel"] .card-ambient, main [role="tabpanel"] button.rounded-2xl', {
    release: (p) => expect(p.locator("main [data-skeleton]")).toHaveCount(0, { timeout: 15000 }),
    flexible: [], yTolerance: 140, hTolerance: 140, window: 200,   // the lists of what to use soon / what is running low are as tall as the stock
  });
});

test("Nutrition day view: the ledger, the meals and the side cards match their placeholders", async ({ authenticatedPage: page }) => {
  await compare(page, "/nutrition", "main .card-ambient", {
    release: (p) => expect(p.locator("main [data-skeleton]")).toHaveCount(0, { timeout: 15000 }),
    flexible: ["day-ledger", "sug-title", "meal-breakfast", "meal-lunch", "meal-dinner", "meal-snack", "meal-other"], yTolerance: 60,   // as tall as the day's entries
  });
});
