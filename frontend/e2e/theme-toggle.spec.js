import { test, expect } from "./fixtures";

/* The theme button shows what is on screen: with the choice left on "System" and a dark device, it offers the light theme (it used to offer the dark one). */
test.describe("Theme button", () => {
  test.use({ colorScheme: "dark" });
  test("on a dark device with the theme on System it offers the light theme, and flips both ways", async ({ freshUserPage: { page } }) => {
    await page.goto("/groceries");
    const toggle = page.getByTestId("theme-toggle");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(toggle).toHaveAttribute("aria-label", "Switch to the light theme");
    await toggle.click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(toggle).toHaveAttribute("aria-label", "Switch to the dark theme");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", "Switch to the light theme");
  });
});
