import { test, expect } from "@playwright/test";
import { credentials } from "./fixtures";

// SEC-006: signing in through the real login page keeps the refresh token out of JavaScript's reach.
// Uses the owner account for one UI login (the login rate limit is 10/minute, so this spec logs in once).

test("the refresh token lives in an HttpOnly cookie, and the session recovers from it", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(credentials.email);
  await page.getByTestId("login-password").fill(credentials.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL("/", { timeout: 15000 });

  // Not readable by page scripts: absent from storage and from document.cookie.
  expect(await page.evaluate(() => localStorage.getItem("lm_refresh_token"))).toBeNull();
  expect(await page.evaluate(() => document.cookie)).not.toContain("lr_refresh");
  const cookie = (await context.cookies()).find((c) => c.name === "lr_refresh");
  expect(cookie).toBeTruthy();
  expect(cookie).toMatchObject({ httpOnly: true, path: "/api/auth", sameSite: "Lax" });

  // An expired/garbled access token is replaced silently using the cookie; the user stays on the page.
  await page.evaluate(() => localStorage.setItem("lm_token", "not-a-valid-token"));
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.locator("body")).toContainText("Tasks");
  const renewed = await page.evaluate(() => localStorage.getItem("lm_token"));
  expect(renewed).toBeTruthy();
  expect(renewed).not.toBe("not-a-valid-token");

  // Signing out removes the cookie, and the page can no longer recover a session.
  await page.goto("/settings");
  await page.getByTestId("settings-logout").click();
  await expect(page).toHaveURL("/login");
  expect((await context.cookies()).find((c) => c.name === "lr_refresh")).toBeUndefined();
});
