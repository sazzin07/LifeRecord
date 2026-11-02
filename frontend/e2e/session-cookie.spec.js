import { test, expect } from "@playwright/test";
import { credentials } from "./fixtures";

// SEC-006 and S-03: signing in through the real login page keeps BOTH tokens out of JavaScript's reach. The refresh token is
// an HttpOnly cookie; the short-lived access token is held in memory only, so nothing that could be copied by a script is
// ever written to web storage, and a reload or a second tab recovers the session from the cookie.
// Uses the test account for one UI login (the login rate limit is 10/minute, so this spec logs in once).

const storedKeys = (page) => page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
const tokenKeys = (keys) => [...keys.local, ...keys.session].filter((k) => /token|jwt|auth|session_id/i.test(k) && !/^lm_(ai_session|session)/.test(k));

test("no token is ever stored by the page, and the session recovers from the cookie", async ({ page, context }) => {
  await page.addInitScript(() => sessionStorage.setItem("lm_intro", "1"));
  await page.goto("/login");
  await page.getByTestId("login-email").fill(credentials.email);
  await page.getByTestId("login-password").fill(credentials.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL("/", { timeout: 15000 });

  // Neither token is in storage or in document.cookie.
  expect(tokenKeys(await storedKeys(page))).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).not.toContain("lr_refresh");
  const cookie = (await context.cookies()).find((c) => c.name === "lr_refresh");
  expect(cookie).toBeTruthy();
  expect(cookie).toMatchObject({ httpOnly: true, path: "/api/auth", sameSite: "Lax" });

  // After a full reload the access token (memory only) is gone; the cookie brings the session back without the login page.
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  expect(tokenKeys(await storedKeys(page))).toEqual([]);

  // A second tab in the same browser is signed in too (the refresh does not rotate, so tabs never revoke each other).
  const other = await context.newPage();
  await other.addInitScript(() => sessionStorage.setItem("lm_intro", "1"));
  await other.goto("/money");
  await expect(other).toHaveURL(/\/money$/);
  await expect(other.getByRole("heading", { name: "Money" })).toBeVisible();
  await other.close();

  // Signing out removes the cookie, and the page can no longer recover a session.
  await page.goto("/settings");
  await page.getByTestId("settings-logout").click();
  await expect(page).toHaveURL("/login");
  expect((await context.cookies()).find((c) => c.name === "lr_refresh")).toBeUndefined();
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login$/);
});
