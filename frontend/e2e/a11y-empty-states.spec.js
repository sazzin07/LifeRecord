import { test, expect } from "@playwright/test";
import { audit, prepare, settle, THEMES, WIDTHS } from "./support/a11y";
import { newEmail, verificationCode, deleteUser } from "./support-new-user";

// D-01 / Review Focus 4: the standard test account has data everywhere, so its pages never show their empty states. A
// brand-new account does: the "Set up your money" card, empty lists, "nothing logged yet". This audits those, at three
// widths in both themes. Signs up a throw-away account (reserved example.com address: never mailed) and removes it after.

// An audit visits many pages (and, for the grocery catalog, ~500 cards), so it gets more than the default 30 seconds.
test.describe.configure({ timeout: 300_000 });

const PASSWORD = "TestPass123";
const PAGES = [["home", "/"], ["money", "/money"], ["people", "/people"], ["groceries", "/groceries"], ["nutrition", "/nutrition"],
  ["fitness", "/fitness"], ["body", "/body"], ["tasks", "/tasks"], ["calendar", "/calendar"], ["settings", "/settings"]];

for (const theme of THEMES) {
  for (const [size, viewport] of WIDTHS) {
    test(`new account, ${theme} theme, ${size}`, async ({ page }) => {
      const email = newEmail();
      try {
        await prepare(page, theme, viewport);
        await page.goto("/signup");
        await page.getByLabel("Name").fill("Nova Newcomer");
        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Password").fill(PASSWORD);
        await page.getByRole("button", { name: /create account/i }).click();
        await expect(page.getByText("Verify your email")).toBeVisible();
        await page.getByLabel("6-digit verification code").fill(verificationCode(email));
        await page.getByRole("button", { name: "Verify email" }).click();
        await page.waitForURL("/");
        for (const [name, path] of PAGES) {
          await page.goto(path);
          await settle(page);
          await audit(page, `empty ${name}, ${theme}, ${size}`);
        }
        await page.goto("/money");
        await expect(page.getByTestId("onboarding-first-account")).toBeVisible();   // the card really was on screen for the audit above
      } finally {
        deleteUser(email);
      }
    });
  }
}
