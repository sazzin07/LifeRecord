import { test, expect } from "@playwright/test";
import { audit, prepare, settle, THEMES, WIDTHS } from "./support/a11y";

// D-01: the pages anyone can open without signing in (sign in, sign up, forgotten and reset password), at three widths in
// both themes. No account is needed, so this spec runs without the test password.

// An audit visits many pages (and, for the grocery catalog, ~500 cards), so it gets more than the default 30 seconds.
test.describe.configure({ timeout: 300_000 });

const PAGES = [["sign in", "/login"], ["sign up", "/signup"], ["forgot password", "/forgot-password"], ["reset password", "/reset-password?token=not-a-real-token"]];

for (const theme of THEMES) {
  for (const [size, viewport] of WIDTHS) {
    test(`public pages, ${theme} theme, ${size}`, async ({ page }) => {
      await prepare(page, theme, viewport);
      for (const [name, path] of PAGES) {
        await page.goto(path);
        await expect(page.locator("form").first()).toBeVisible();
        await settle(page);
        await audit(page, `${name}, ${theme}, ${size}`);
      }
    });
  }
}
