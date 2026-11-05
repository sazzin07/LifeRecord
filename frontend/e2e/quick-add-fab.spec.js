import { test, expect } from "./fixtures";
import { prepare } from "./support/a11y";

// The floating Quick Add button is for wider screens and never hides; a phone has the ball instead.
test("phone: the ball steps aside while the page scrolls down and is back when the scrolling stops", async ({ authenticatedPage: page }) => {
  await prepare(page, "light", { width: 390, height: 844 });
  await page.goto("/money");
  await page.waitForLoadState("networkidle");
  const wrap = page.getByTestId("ball-wrap");
  await expect(wrap).toBeVisible();
  await expect(page.getByTestId("quick-add-trigger")).toHaveCount(0);          // the floating button is for wider screens
  await expect(wrap).toHaveAttribute("data-hidden", "false");
  for (let i = 0; i < 8; i += 1) { await page.mouse.wheel(0, 140); await page.waitForTimeout(30); }
  await expect(wrap).toHaveAttribute("data-hidden", "true");
  await expect(wrap).toHaveAttribute("data-hidden", "false", { timeout: 3000 });
});

test("phone: the top bar's three buttons are at least 44px", async ({ authenticatedPage: page }) => {
  await prepare(page, "light", { width: 390, height: 844 });
  await page.goto("/");
  for (const id of ["menu-toggle", "theme-toggle", "header-menu"]) {
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
