import { test, expect } from "./fixtures";
import { goToPage } from "./support/dock";

// Every page the dock links to, in the order we browse them.
const PAGES = ["home", "money", "people", "groceries", "nutrition", "fitness", "body", "tasks", "calendar", "settings"];
const EMPTY_STATES = [
  "No tasks yet", "No people yet", "Your body log starts here", "No meals logged today", "No recipes yet", "No progress photos yet",
  "Your training history starts here", "Nothing scheduled", "No transactions here", "Nothing about to expire",
];

const mainText = (page) => page.locator("main").innerText();
const settle = async (page) => {
  await expect(page.locator('main [aria-busy="true"], main .skeleton')).toHaveCount(0, { timeout: 15000 });
};

test.describe("Browsing between pages", () => {
  test("revisiting a page shows the last-seen content instantly, even on a slow network", async ({ authenticatedPage: page }) => {
    test.setTimeout(180000);
    await page.waitForTimeout(2600); // the once-per-session welcome splash

    // First pass on a normal network: remember what each page looks like
    const seen = {};
    for (const p of PAGES) {
      await goToPage(page, p);
      await page.waitForTimeout(500); // let React swap pages (the old one stays up for a moment) before checking
      await settle(page);
      await page.waitForTimeout(300);
      seen[p] = (await mainText(page)).length;
      expect(seen[p], `${p} should have content`).toBeGreaterThan(40);
    }

    // Second pass with every API response delayed 1.5s: content must be there within 300ms, no skeleton, no flash
    await page.route("**/api/**", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    for (const p of [...PAGES].reverse()) {
      await goToPage(page, p);
      await page.waitForTimeout(300);
      const busy = await page.locator('main [aria-busy="true"], main .skeleton').count();
      const text = await mainText(page);
      expect(busy, `${p}: skeleton visible on a warm revisit`).toBe(0);
      expect(text.length, `${p}: content missing on a warm revisit`).toBeGreaterThan(seen[p] * 0.7);
    }
  });

  test("a cold start shows skeletons, never an empty state for data on its way", async ({ authenticatedPage: page }) => {
    test.setTimeout(120000);
    await page.waitForTimeout(2600);
    await page.addInitScript(() => Object.keys(localStorage).filter((k) => k.startsWith("lm_cache:")).forEach((k) => localStorage.removeItem(k)));
    await page.route("**/api/**", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    // (Settings and Profile have no data to wait for on arrival: they draw at once, which is the point.)
    for (const p of ["tasks", "people", "body", "nutrition", "calendar", "money", "fitness"]) {
      await page.goto(`/${p}`);
      await page.waitForTimeout(350);
      const text = await mainText(page);
      for (const phrase of EMPTY_STATES) expect(text, `${p} flashed "${phrase}"`).not.toContain(phrase);
      expect(await page.locator('main [aria-busy="true"], main .skeleton').count(), `${p}: expected a skeleton`).toBeGreaterThan(0);
    }
  });

  test("changes show up on other pages after a short background refresh", async ({ authenticatedPage: page, apiContext }) => {
    test.setTimeout(90000);
    await page.waitForTimeout(2600);
    await goToPage(page, "home");
    await expect(page.getByTestId("stat-tasks")).toBeVisible({ timeout: 15000 });
    const before = await page.getByTestId("stat-tasks").innerText();

    await goToPage(page, "tasks");
    await settle(page);
    const title = `E2E task ${Date.now()}`;
    await page.getByTestId("task-input").fill(title);
    await page.keyboard.press("Enter");
    await expect(page.getByText(title)).toBeVisible();

    // Home reads the same data; after the background refresh its open-task count must change
    await goToPage(page, "home");
    await expect.poll(async () => page.getByTestId("stat-tasks").innerText(), { timeout: 15000 }).not.toBe(before);

    const tasks = await (await apiContext.get("/api/tasks")).json();
    for (const t of tasks.filter((x) => x.title === title)) await apiContext.delete(`/api/tasks/${t.id}`);
  });
});
