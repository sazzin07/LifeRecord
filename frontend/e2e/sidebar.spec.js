import { test, expect } from "./fixtures";

test.describe("Side menu", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("is a thin icon strip that widens on hover and can be pinned open", async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => localStorage.setItem("lr-sidebar", "auto")); // runs after the fixture's, so the menu starts unpinned
    await page.reload();
    const bar = page.getByTestId("sidebar");
    const width = () => bar.evaluate((el) => el.getBoundingClientRect().width);
    await expect(bar).toHaveAttribute("data-expanded", "false");
    expect(await width()).toBeLessThan(80);
    await expect(page.locator("main")).toHaveClass(/lg:pl-16/);

    await page.getByTestId("nav-money").hover();
    await expect(bar).toHaveAttribute("data-expanded", "true");
    await expect.poll(width).toBeGreaterThan(220);
    await page.getByTestId("nav-money").click();
    await expect(page).toHaveURL(/\/money$/);
    await expect(bar).toHaveAttribute("data-expanded", "false");   // choosing a page folds it away, pointer still on it
    await expect.poll(width).toBeLessThan(80);
    await page.mouse.move(900, 400);
    await page.getByTestId("nav-money").hover();                   // ... and it opens again when the pointer comes back
    await expect(bar).toHaveAttribute("data-expanded", "true");

    await page.mouse.move(900, 400);
    await expect(bar).toHaveAttribute("data-expanded", "false");
    await expect.poll(width).toBeLessThan(80);

    await page.keyboard.press("Shift");                         // the last input was the keyboard: focus lands visibly
    await page.getByTestId("nav-home").focus();               // keyboard focus widens it too
    await expect(bar).toHaveAttribute("data-expanded", "true");
    await page.getByTestId("sidebar-pin").click();
    await page.mouse.move(900, 400);
    await expect(bar).toHaveAttribute("data-expanded", "true");
    await expect(page.locator("main")).toHaveClass(/lg:pl-60/);
  });
});
