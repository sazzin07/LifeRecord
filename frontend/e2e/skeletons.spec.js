import { test, expect } from "./fixtures";

// The loading experience: structure at once, each section on its own data, no skeleton over content that is already there, words and a way
// out when a request fails, and nothing that moves when the data lands. Responses are delayed on purpose.
test.use({ viewport: { width: 1440, height: 900 } });

const slow = (page, match, ms) => page.route(match, async (route) => { await new Promise((r) => setTimeout(r, ms)); await route.continue().catch(() => {}); });   // (a late answer after the test moved on is fine)
const fromPath = (path) => (url) => new URL(url).pathname === path;
// A cold start: what an earlier visit left in the browser's last-seen copies is cleared, so the placeholders are what is under test.
const cold = (page) => page.addInitScript(() => Object.keys(localStorage).filter((k) => k.startsWith("lm_cache:")).forEach((k) => localStorage.removeItem(k)));

test("Home: every section draws from its own data, and a slow one does not hold the others", async ({ authenticatedPage: page }) => {
  await cold(page);
  await slow(page, fromPath("/api/tasks"), 5000);
  await page.goto("/");
  await expect(page.getByTestId("hero-ask-ai")).toBeVisible();                        // the page itself, at once
  await expect(page.getByTestId("stat-spent")).toContainText("€");                    // the summary-based cards: real figures
  await expect(page.getByTestId("stat-tasks")).toHaveAttribute("aria-busy", "true");  // the slow one: still its own placeholder
  await expect(page.getByRole("heading", { name: "Nutrition today" })).toBeVisible();
  await expect(page.getByTestId("stat-spent")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("stat-tasks")).not.toHaveAttribute("aria-busy", "true", { timeout: 12000 });   // and it lands by itself
  await expect(page.getByTestId("stat-tasks")).toContainText(/\d/);
});

test("Money: the cards, the chart and the transaction list each wait only for their own request", async ({ authenticatedPage: page }) => {
  const list = page.locator('section[aria-labelledby="mny-txn-h"]');
  await cold(page);
  await slow(page, (url) => new URL(url).pathname === "/api/transactions", 5000);
  await page.goto("/money");
  await expect(page.getByTestId("money-bank")).toBeVisible();                         // figures are in while the list is on its way
  await expect(list.locator('[aria-busy="true"]')).toBeVisible();
  await expect(list.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 12000 });
  await expect(list).toContainText(/Transactions/);
  await page.unroute("**/*");

  const page2 = await page.context().newPage();
  await cold(page2);
  await slow(page2, fromPath("/api/analytics/summary"), 5000);
  await page2.goto("/money");
  await expect(page2.locator('section[aria-labelledby="mny-txn-h"]').getByTestId(/^txn-/).first()).toBeVisible({ timeout: 4000 });   // the list is here...
  await expect(page2.getByTestId("money-bank")).toHaveCount(0);                                                                   // ...the cards are still placeholders
  await expect(page2.locator('main [aria-busy="true"]').first()).toBeVisible();
  await expect(page2.getByTestId("money-bank")).toBeVisible({ timeout: 12000 });
  await page2.close();
});

test("a request that fails says so in words and offers a retry that works; it never leaves a skeleton", async ({ authenticatedPage: page }) => {
  let failing = true;
  await cold(page);
  await page.route((url) => new URL(url).pathname === "/api/tasks", async (route) => {
    if (failing) await route.fulfill({ status: 500, json: { detail: "down" } }); else await route.continue();
  });
  await page.goto("/tasks");
  const error = page.getByTestId("section-error");
  await expect(error).toContainText("Could not load your tasks");
  await expect(page.locator("main .skeleton")).toHaveCount(0);
  failing = false;
  await page.getByTestId("section-retry").click();
  await expect(error).toHaveCount(0);
  await expect(page.getByTestId("task-input").or(page.getByText("No tasks yet")).or(page.locator('[data-testid^="task-"]').first())).toBeVisible();
});

test("a refresh behind content already on screen never puts a skeleton over it", async ({ authenticatedPage: page }) => {
  await page.goto("/money");
  await expect(page.getByTestId("money-bank")).toBeVisible();
  await expect(page.locator("main .skeleton")).toHaveCount(0, { timeout: 10000 });
  await slow(page, "**/api/**", 3000);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lm:refresh")));
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(250);
    expect(await page.locator("main .skeleton").count(), "a skeleton appeared over loaded content").toBe(0);
    await expect(page.getByTestId("money-bank")).toBeVisible();
  }
});

test("placeholders are decoration for assistive technology, and they stop moving for reduced motion", async ({ authenticatedPage: page }) => {
  await cold(page);
  await slow(page, fromPath("/api/analytics/summary"), 4000);
  await page.goto("/money");
  const sk = page.locator("main .skeleton").first();
  await expect(sk).toBeVisible();
  const loose = await page.evaluate(() => [...document.querySelectorAll("main .skeleton")].filter((e) => !e.closest('[aria-hidden="true"]')).length);
  expect(loose, "a placeholder is read out as if it were content").toBe(0);
  await expect(page.locator('main [role="status"][aria-busy="true"]').first()).toBeAttached();       // one announcement for the group
  expect(await sk.evaluate((e) => getComputedStyle(e, "::after").animationName)).toBe("sk-sweep");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await sk.evaluate((e) => getComputedStyle(e, "::after").animationName)).toBe("none");
});

test("when the data lands nothing moves: the layout shift stays small on Home and on Money", async ({ authenticatedPage: page }) => {
  for (const path of ["/", "/money"]) {
    await page.goto("about:blank");
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    });
    await cold(page);
    await slow(page, "**/api/**", 900);
    await page.goto(path);
    await page.waitForTimeout(3500);
    const cls = await page.evaluate(() => window.__cls);
    console.log(`CLS ${path}: ${cls.toFixed(3)}`);
    expect(cls, `${path} moved too much while loading`).toBeLessThan(0.1);
    await page.unroute("**/api/**");
  }
});
