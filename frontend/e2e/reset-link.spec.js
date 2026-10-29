import { test, expect } from "./fixtures";

// The emailed reset link must show the reset form even if someone is already signed in in that browser,
// and must take the token out of the address bar. (Nothing is submitted: the owner's password is not touched.)
test("a reset link opens the reset form while signed in and hides the token from the address bar", async ({ authenticatedPage: page }) => {
  await page.goto("/reset-password?token=not-a-real-token");
  await expect(page.locator("input[type=password]")).toHaveCount(2);
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.locator("body")).toContainText("Choose a new password");
});

test("a reset link opens the reset form when signed out", async ({ page }) => {
  await page.goto("/reset-password?token=not-a-real-token");
  await expect(page.locator("input[type=password]")).toHaveCount(2);
  await expect(page).toHaveURL(/\/reset-password$/);
});

test("without a token the form says so and cannot be submitted", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.locator("button[type=submit]")).toBeDisabled();
});
