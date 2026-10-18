import { test, expect } from "./fixtures";

test.describe("Smoke tests", () => {
  test("all main tabs load", async ({ authenticatedPage: page }) => {
    const tabs = ["/", "/money", "/people", "/groceries", "/nutrition", "/fitness", "/body", "/tasks", "/calendar", "/settings"];

    for (const path of tabs) {
      await page.goto(path);
      await expect(page).toHaveURL(path);
      // Ensure the app root rendered (no blank error screen)
      await expect(page.locator("body")).toContainText("Life Record");
    }
  });

  test("logout flow", async ({ authenticatedPage: page }) => {
    await page.goto("/settings");
    await page.getByTestId("settings-logout").click();
    await expect(page).toHaveURL("/login");
    await expect(page.getByTestId("login-form")).toBeVisible();
  });
});
