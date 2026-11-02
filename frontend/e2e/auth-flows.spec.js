import { test, expect } from "@playwright/test";
import { newEmail, verificationCode, resetToken, deleteUser } from "./support-new-user";

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

    await page.goto("/settings");
    await page.getByTestId("settings-logout").click();
    await expect(page).toHaveURL(/\/login$/);

    await expect(other).toHaveURL(/\/login$/, { timeout: 5000 });  // no click, no reload, no request in that tab
  });

  test("deactivating signs you out, signing in says why, and the emailed link switches the account back on", async ({ page }) => {
    await signUp(page, email);
    await page.goto("/settings");

    await page.getByTestId("your-data-deactivate-open").click();
    await page.getByTestId("deactivate-account-password").fill("Wrong-pass-1");
    await page.getByTestId("deactivate-account-submit").click();
    await expect(page.getByTestId("deactivate-account-error")).toContainText(/incorrect/i);  // nothing happened
    await expect(page).toHaveURL(/\/settings$/);

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
    await page.goto("/settings");
    await expect(page.getByTestId("your-data")).toBeVisible();
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
    await page.goto("/settings");
    await page.getByTestId("settings-logout").click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByTestId("login-submit").click();
    await page.waitForURL("/");
  });
});
