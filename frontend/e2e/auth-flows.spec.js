import { test, expect } from "@playwright/test";
import { goToPage } from "./support/dock";
import { newEmail, verificationCode, resetToken, ageRotation, deleteUser } from "./support-new-user";

// The account lifecycle as a person sees it, on brand-new throw-away accounts (reserved example.com address, never mailed,
// removed afterwards): signing out in one tab, switching the account off and back on, and not being locked out of your own
// browser by somebody else guessing at your address.
const PASSWORD = "TestPass123";
const API = process.env.API_URL || "http://localhost:8000";

async function signUp(page, email) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Nova Newcomer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByText("Verify your email")).toBeVisible();
  await page.getByLabel("6-digit verification code").fill(verificationCode(email));
  await page.getByRole("button", { name: "Verify email" }).click();
  await page.waitForURL("/");
}

test.describe("account lifecycle", () => {
  let email;
  test.beforeEach(async ({ context }) => {
    email = newEmail();
    await context.addInitScript(() => sessionStorage.setItem("lm_intro", "1"));
  });
  test.afterEach(() => deleteUser(email));

  test("signing out in one tab signs the other tab out at once, without it being touched", async ({ page, context }) => {
    await signUp(page, email);
    const other = await context.newPage();
    await other.goto("/money");
    await expect(other.getByRole("heading", { name: "Money", exact: true })).toBeVisible();
    // Cut that tab off from the server, so the only way it can learn about the sign-out is from the other tab. (Otherwise a
    // background request would find out by itself and this would prove nothing about the message between tabs.)
    await other.route("**/api/**", (route) => route.abort());

    await page.goto("/profile");
    await page.getByTestId("settings-logout").click();
    await expect(page).toHaveURL(/\/login$/);

    await expect(other).toHaveURL(/\/login$/, { timeout: 5000 });  // no click, no reload, no request in that tab
  });

  test("deactivating signs you out, signing in says why, and the emailed link switches the account back on", async ({ page }) => {
    await signUp(page, email);
    await page.goto("/profile");

    await page.getByTestId("your-data-deactivate-open").click();
    await page.getByTestId("deactivate-account-password").fill("Wrong-pass-1");
    await page.getByTestId("deactivate-account-submit").click();
    await expect(page.getByTestId("deactivate-account-error")).toContainText(/incorrect/i);  // nothing happened
    await expect(page).toHaveURL(/\/profile$/);

    await page.getByTestId("deactivate-account-password").fill(PASSWORD);
    await page.getByTestId("deactivate-account-submit").click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByTestId("login-submit").click();
    await expect(page.getByText(/deactivated/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // what "Forgot password" mails: opening it with a new password reactivates the account and signs in
    await page.goto(`/reset-password?token=${encodeURIComponent(resetToken(email))}`);
    await page.getByLabel("New password").fill("Welcome-back-5");
    await page.getByLabel("Confirm password").fill("Welcome-back-5");
    await page.getByRole("button", { name: "Reset password" }).click();
    await page.waitForURL("/");
    await page.goto("/profile");
    await expect(page.getByTestId("your-data")).toBeVisible();
  });

  test("the refresh cookie changes at every refresh and normal use does not notice: reloads and tabs opened together stay signed in", async ({ page, context }) => {
    await signUp(page, email);
    const cookie = async () => (await context.cookies()).find((c) => c.name === "lr_refresh")?.value;
    const first = await cookie();
    for (let n = 0; n < 4; n++) {
      await page.reload();
      await expect(page.getByTestId("your-data").or(page.getByRole("heading", { name: "Home" }).first()).or(page.locator("main")).first()).toBeVisible();
      expect(page.url()).not.toMatch(/\/login/);
    }
    expect(await cookie(), "every refresh hands out a new refresh token").not.toBe(first);

    // three tabs opened in the same instant all refresh with the same cookie: none of them may be signed out
    const tabs = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
    await Promise.all(tabs.map((tab) => tab.goto("/money")));
    for (const tab of tabs) {
      await expect(tab.getByRole("heading", { name: "Money", exact: true })).toBeVisible();
      expect(tab.url()).not.toMatch(/\/login/);
    }
  });

  test("the list of sessions shows another browser and signing it out there signs it out", async ({ page, browser }) => {
    await signUp(page, email);
    const other = await browser.newContext();
    await other.addInitScript(() => sessionStorage.setItem("lm_intro", "1"));
    const otherPage = await other.newPage();
    await otherPage.goto("/login");
    await otherPage.getByTestId("login-email").fill(email);
    await otherPage.getByTestId("login-password").fill(PASSWORD);
    await otherPage.getByTestId("login-submit").click();
    await otherPage.waitForURL("/");

    await page.goto("/profile");
    const rows = page.getByTestId("sessions-list").locator("li");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("session-current")).toHaveCount(1);
    await rows.filter({ hasNot: page.getByTestId("session-current") }).getByRole("button", { name: /^Sign out/ }).click();
    await expect(rows).toHaveCount(1);

    await otherPage.goto("/tasks");
    await expect(otherPage).toHaveURL(/\/login$/);
    await other.close();
  });

  test("an answer to a refresh that never arrives is repeated and does not look like a stolen copy, however late the repeat is", async ({ page, context, playwright }) => {
    await signUp(page, email);
    const server = await playwright.request.newContext();
    let attempts = 0;
    let rotatedOnTheServer = false;
    let expireOnce = true;
    // The access token "expires": the next call to /tasks is refused, which makes the page refresh its session, once, by itself.
    await context.route("**/api/tasks**", (route) => {
      if (route.request().method() === "GET" && expireOnce) {
        expireOnce = false;
        return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Token expired" }) });
      }
      return route.continue();
    });
    await context.route("**/api/auth/refresh", async (route) => {
      if (route.request().method() !== "POST") return route.continue();  // the browser's CORS preflight is not the refresh
      attempts += 1;
      if (attempts === 1) {
        // the server hears this one and replaces the token; the answer is lost on the way back
        const sent = route.request().headers();
        const cookie = (await context.cookies()).find((c) => c.name === "lr_refresh").value;
        const heard = await server.post(route.request().url(), { data: {}, headers: { "x-auth-mode": "cookie", "x-refresh-key": sent["x-refresh-key"] || "", "x-session-proof": sent["x-session-proof"] || "", cookie: `lr_refresh=${cookie}` } });
        rotatedOnTheServer = heard.ok();  // the browser's own signature goes along, exactly as in the real request
        return route.abort("connectionreset");
      }
      ageRotation(email);  // by the time the page asks again, hours have passed
      return route.continue();
    });
    // What matters is the outcome: the refused request is repeated with the new token and succeeds (the heading alone appears at
    // once, long before the second refresh is answered).
    const repeated = page.waitForResponse((r) => r.url().includes("/api/tasks") && r.request().method() === "GET" && r.status() === 200, { timeout: 20000 });
    await goToPage(page, "tasks");
    await repeated;
    expect(attempts, "the page asked again after the answer was lost").toBeGreaterThanOrEqual(2);
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    expect(page.url(), "a lost answer must not sign the person out").not.toMatch(/\/login/);
    expect(rotatedOnTheServer, "the server really did replace the token before the answer was lost").toBe(true);
    await server.dispose();
  });

  test("a page that starts while the server cannot be reached waits and carries on; it does not sign you out", async ({ page, context }) => {
    await signUp(page, email);
    let reachable = false;
    await context.route("**/api/auth/refresh", (route) => (reachable ? route.continue() : route.abort("connectionrefused")));
    await page.goto("/money");
    await expect(page.getByTestId("server-unreachable")).toBeVisible({ timeout: 20000 });
    expect(page.url()).not.toMatch(/\/login/);
    reachable = true;
    await expect(page.getByRole("heading", { name: "Money", exact: true })).toBeVisible({ timeout: 20000 });
  });

  test("a copy of the refresh cookie on its own opens nothing, and trying does not sign the real browser out", async ({ page, context, playwright }) => {
    await signUp(page, email);  // the app binds the session to a key that never leaves this browser
    const cookie = (await context.cookies()).find((c) => c.name === "lr_refresh").value;
    const thief = await playwright.request.newContext();
    const copy = await thief.post(`${API}/api/auth/refresh`, { data: {}, headers: { "x-auth-mode": "cookie", cookie: `lr_refresh=${cookie}` } });
    expect(copy.status(), "the cookie without the key must not refresh anything").toBe(401);
    await thief.dispose();
    await page.reload();  // the real browser, which can sign, carries on
    await expect(page.locator("main").first()).toBeVisible({ timeout: 20000 });
    expect(page.url()).not.toMatch(/\/login/);
  });

  test("locked out of new devices by somebody's guessing: the sign-in page says so and offers the way back in by email", async ({ page, request }) => {
    await signUp(page, email);
    await page.goto("/profile");
    await page.getByTestId("settings-logout").click();
    await expect(page).toHaveURL(/\/login$/);
    await page.context().clearCookies();  // this browser is now a stranger to the account, like a new device
    let locked = false;
    for (let n = 1; n <= 30 && !locked; n++) {
      const r = await request.post(`${API}/api/auth/login`, { data: { email, password: "Wrong-pass-1" }, headers: { "X-Forwarded-For": `198.51.100.${n}` } });
      locked = r.status() === 429;
    }
    expect(locked, "guessing from many addresses should lock the account for new devices").toBe(true);

    await page.reload();
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-locked")).toBeVisible();
    const sent = page.waitForResponse((r) => r.url().includes("/api/auth/forgot-password") && r.status() === 200);
    await page.getByTestId("login-locked-email").click();
    await sent;
    await expect(page.getByText(/link is on its way/i).first()).toBeVisible();
  });

  test("somebody guessing at your address cannot keep you out of a browser you already use", async ({ page, request }) => {
    await signUp(page, email);

    // a stranger, from many addresses and with no cookies, until the account turns them away
    let refused = 0;
    for (let n = 1; n <= 30 && !refused; n++) {
      const r = await request.post(`${API}/api/auth/login`, {
        data: { email, password: "Wrong-pass-1" }, headers: { "X-Forwarded-For": `198.51.100.${n}` },
      });
      if (r.status() === 429) refused = n;
    }
    expect(refused, "30 wrong passwords from 30 addresses should have been turned away").toBeGreaterThan(0);
    const stranger = await request.post(`${API}/api/auth/login`, { data: { email, password: PASSWORD }, headers: { "X-Forwarded-For": "198.51.100.250" } });
    expect(stranger.status(), "a stranger holding the right password waits like any other").toBe(429);

    // the owner's own browser signs out and in again without any delay
    await page.goto("/profile");
    await page.getByTestId("settings-logout").click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByTestId("login-submit").click();
    await page.waitForURL("/");
  });
});
