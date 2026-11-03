import { test, expect } from "./fixtures";

test("Profile and Settings are two pages, reachable from each other and from the header", async ({ authenticatedPage: page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("theme-dark")).toBeVisible();
  await page.getByTestId("settings-tab-money").click();
  await expect(page.getByTestId("settings-add-place")).toBeVisible();
  await page.getByTestId("settings-tab-appearance").click();
  await expect(page.getByTestId("change-password-form")).toHaveCount(0);          // sign-in things live on Profile
  await expect(page.getByTestId("settings-logout")).toHaveCount(0);

  await page.getByTestId("tab-profile").click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByTestId("change-password-form")).toBeVisible();
  await expect(page.getByTestId("settings-logout")).toBeVisible();
  await expect(page.getByTestId("theme-dark")).toHaveCount(0);                    // look and money places live on Settings

  await page.getByTestId("tab-settings").click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.getByTestId("header-profile").click();
  await expect(page).toHaveURL(/\/profile$/);
});
