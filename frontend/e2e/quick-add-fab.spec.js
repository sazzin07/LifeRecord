import { test, expect } from "./fixtures";
import { prepare } from "./support/a11y";

// The floating Quick Add button gets out of the way of what is being read on a phone, and never on a wide screen.
test("phone: hides while scrolling down, returns on scroll up, at the end of the page and on keyboard focus", async ({ authenticatedPage: page }) => {
  await prepare(page, "light", { width: 390, height: 844 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const fab = page.getByTestId("quick-add-trigger");
  await expect(fab).toBeVisible();
  await expect(fab).not.toHaveAttribute("data-hidden", /.*/);
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect(fab).toHaveAttribute("data-hidden", "true");
  await expect.poll(() => fab.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(fab).not.toHaveAttribute("data-hidden", /.*/);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(fab).toHaveAttribute("data-hidden", "true");
  await fab.focus();
  await expect(fab).not.toHaveAttribute("data-hidden", /.*/);
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect(fab).toHaveAttribute("data-hidden", "true");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(fab).not.toHaveAttribute("data-hidden", /.*/);
});

test("phone: the top bar's three buttons are at least 44px", async ({ authenticatedPage: page }) => {
  await prepare(page, "light", { width: 390, height: 844 });
  await page.goto("/");
  for (const id of ["ai-trigger", "theme-toggle", "header-profile"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box.width, id).toBeGreaterThanOrEqual(44);
    expect(box.height, id).toBeGreaterThanOrEqual(44);
  }
});

test("desktop: never hides", async ({ authenticatedPage: page }) => {
  await prepare(page, "light", { width: 1280, height: 800 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(300);
  await expect(page.getByTestId("quick-add-trigger")).not.toHaveAttribute("data-hidden", /.*/);
});
