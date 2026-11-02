import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import { newEmail, verificationCode, deleteUser } from "./support-new-user";
import { audit, prepare } from "./support/a11y";

// Two-step sign-in, as a person does it: turn it on in Settings with a code from an authenticator app (computed here from the
// secret the page shows, exactly as the app would), sign in with password and code, use a recovery code, turn it off. Brand-new
// throw-away accounts (reserved example.com address, never mailed), removed afterwards.
const PASSWORD = "TestPass123";

function base32(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...text.replace(/[\s=]/g, "").toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// RFC 6238, SHA-1, 6 digits, 30-second steps. `offset` picks a later step: a code is accepted once, so the next sign-in needs the next one.
function codeFor(secret, offset = 0) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const hmac = crypto.createHmac("sha1", base32(secret)).update(message).digest();
  const at = hmac[19] & 0xf;
  const number = ((hmac[at] & 0x7f) << 24) | (hmac[at + 1] << 16) | (hmac[at + 2] << 8) | hmac[at + 3];
  return String(number % 1000000).padStart(6, "0");
}

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

async function turnOn(page) {
  await page.goto("/settings");
  await page.getByTestId("two-factor-open").click();
  await page.getByTestId("two-factor-password").fill(PASSWORD);
  await page.getByTestId("two-factor-start").click();
  const secret = (await page.getByTestId("two-factor-secret").innerText()).replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expect(page.getByTestId("two-factor-link")).toHaveAttribute("href", /^otpauth:\/\/totp\//);
  await audit(page, "two-step setup");
  await page.getByTestId("two-factor-code").fill(codeFor(secret));
  await page.getByTestId("two-factor-confirm").click();
  const shown = await page.getByTestId("two-factor-recovery-codes").innerText();
  const codes = shown.split(/\s+/).filter((c) => /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(c));
  expect(codes).toHaveLength(8);
  await audit(page, "recovery codes");
  await page.getByTestId("two-factor-saved").click();
  await expect(page.getByTestId("two-factor-status")).toContainText("On");
  return { secret, codes };
}

async function signOutAndStartSigningIn(page, email) {
  await page.getByTestId("settings-logout").click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-totp-code")).toBeVisible();
  expect(page.url(), "a correct password alone must not sign anyone in").toMatch(/\/login$/);
}

test.describe("two-step sign-in", () => {
  let email;
  test.beforeEach(async ({ context }) => {
    email = newEmail();
    await context.addInitScript(() => sessionStorage.setItem("lm_intro", "1"));
  });
  test.afterEach(() => deleteUser(email));

  test("turn it on with an authenticator code, then sign in with the password and a code; a wrong code is refused in words", async ({ page }) => {
    await signUp(page, email);
    const { secret } = await turnOn(page);
    await signOutAndStartSigningIn(page, email);
    await audit(page, "second step at sign-in");

    await page.getByTestId("login-totp-code").fill("000000");
    await page.getByTestId("login-totp-submit").click();
    await expect(page.getByText(/not right/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByTestId("login-totp-code").fill(codeFor(secret, 1));  // the step after the one that turned it on
    await page.getByTestId("login-totp-submit").click();
    await page.waitForURL("/");
  });

  test("a recovery code signs in once; the settings show how many are left; the password and a code turn it off", async ({ page }) => {
    await signUp(page, email);
    const { secret, codes } = await turnOn(page);
    await signOutAndStartSigningIn(page, email);
    await page.getByTestId("login-totp-code").fill(codes[0]);
    await page.getByTestId("login-totp-submit").click();
    await page.waitForURL("/");

    await page.goto("/settings");
    await expect(page.getByTestId("two-factor-status")).toContainText("7 recovery codes left");
    await page.getByTestId("two-factor-manage-open").click();
    await page.getByTestId("two-factor-manage-password").fill(PASSWORD);
    await page.getByTestId("two-factor-manage-code").fill(codeFor(secret, 1));
    await page.getByTestId("two-factor-turn-off").click();
    await expect(page.getByTestId("two-factor-open")).toBeVisible();

    // plain sign-in again
    await page.getByTestId("settings-logout").click();
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByTestId("login-submit").click();
    await page.waitForURL("/");
  });

  test("the setup, the recovery codes and the second step also pass the accessibility audit on a phone in the dark theme", async ({ page }) => {
    await signUp(page, email);
    await prepare(page, "dark", { width: 390, height: 844 });
    await turnOn(page);                                    // audits the setup and the recovery codes on the way
    await signOutAndStartSigningIn(page, email);
    await audit(page, "second step at sign-in, dark phone");
  });
});
