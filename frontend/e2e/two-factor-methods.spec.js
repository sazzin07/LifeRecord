import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import { newEmail, verificationCode, deleteUser } from "./support-new-user";
import { audit, prepare } from "./support/a11y";

// Passkeys and text messages as second steps, as a person uses them. Passkeys use a REAL WebAuthn ceremony against the server: Chromium's
// virtual authenticator plays the phone/laptop (it signs, keeps a counter and knows the site it belongs to). Text messages go from the
// scratch server to the stand-in for Twilio (backend/tests/fake_twilio.py), which this spec reads like a phone would. Brand-new
// throw-away accounts on the reserved example.com domain, removed afterwards.
const PASSWORD = "TestPass123";
const SMS_BASE = process.env.TWILIO_API_BASE;
const settle = (page) => page.waitForTimeout(500);   // dialogs and screens fade in; an audit mid-fade sees washed-out colours
const audited = async (page, label) => { await settle(page); await audit(page, label); };

function base32(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...text.replace(/[\s=]/g, "").toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function codeFor(secret, offset = 0) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const hmac = crypto.createHmac("sha1", base32(secret)).update(message).digest();
  const at = hmac[19] & 0xf;
  const number = ((hmac[at] & 0x7f) << 24) | (hmac[at + 1] << 16) | (hmac[at + 2] << 8) | hmac[at + 3];
  return String(number % 1000000).padStart(6, "0");
}

const newPhone = () => `+3519${Array.from({ length: 8 }, () => 1 + Math.floor(Math.random() * 9)).join("")}`;

/** The code in the newest text message the stand-in provider got for this number. */
async function textedCode(phone) {
  for (let i = 0; i < 40; i += 1) {
    const messages = await (await fetch(`${SMS_BASE}/_messages?to=${encodeURIComponent(phone)}`)).json();
    if (messages.length) return messages[messages.length - 1].body.match(/(?<!\d)(\d{6})(?!\d)/)[1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no text message reached ${phone}`);
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

/** A phone or laptop that can make and use passkeys. */
async function addVirtualAuthenticator(page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { client, authenticatorId };
}

async function stepUp(page, proof) {
  await page.getByTestId("stepup-password").fill(PASSWORD);
  if (proof) await proof();
  await page.getByTestId("stepup-submit").click();
}

async function saveRecoveryCodes(page) {
  const shown = await page.getByTestId("two-factor-recovery-codes").innerText();
  const codes = shown.split(/\s+/).filter((c) => /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(c));
  expect(codes).toHaveLength(8);
  await page.getByTestId("two-factor-saved").click();
  return codes;
}

async function signOutAndEnterPassword(page, email) {
  await page.getByTestId("settings-logout").click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  expect(page.url(), "a correct password alone must not sign anyone in").toMatch(/\/login$/);
}

test.describe("passkeys and text messages as a second step", () => {
  let email;
  test.beforeEach(async ({ context }) => {
    email = newEmail();
    await context.addInitScript(() => sessionStorage.setItem("lm_intro", "1"));
  });
  test.afterEach(() => deleteUser(email));

  test("a passkey is added in Settings, signs in with one tap, and a missing passkey is refused in words", async ({ page }) => {
    await signUp(page, email);
    const { client, authenticatorId } = await addVirtualAuthenticator(page);

    await page.goto("/profile");
    await expect(page.getByTestId("two-factor-status")).toHaveText("Off");
    await audited(page, "settings, two-step off");
    await page.getByTestId("passkey-add").click();
    await audited(page, "confirm it is you");
    await stepUp(page);
    await saveRecoveryCodes(page);                                  // the first method hands over the recovery codes
    await expect(page.getByTestId("two-factor-status")).toContainText("On · 8 recovery codes left");
    await expect(page.getByTestId("method-passkey-state")).toHaveText("1 added");
    await expect(page.getByTestId("passkey-list").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("passkey-list")).toContainText("not used yet");

    // rename it
    const item = page.getByTestId("passkey-list").locator("li").first();
    await item.getByRole("button", { name: /^Rename/ }).click();
    await page.getByTestId("passkey-name-input").fill("Work laptop");
    await page.getByTestId("passkey-name-save").click();
    await expect(page.getByTestId("passkey-list")).toContainText("Work laptop");
    await audited(page, "settings, passkey added");

    await signOutAndEnterPassword(page, email);
    await expect(page.getByTestId("login-passkey-button")).toBeVisible();   // the passkey is offered first
    await audited(page, "second step: passkey");

    // negative control: with the passkey gone from the device the same click must fail, in words, and sign nobody in
    await client.send("WebAuthn.clearCredentials", { authenticatorId });
    await page.getByTestId("login-passkey-button").click();
    await expect(page.getByTestId("login-second-error")).not.toBeEmpty();
    expect(page.url()).toMatch(/\/login$/);
    await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  });

  test("the passkey really signs in: one tap, a session, and the passkey shows when it was last used", async ({ page }) => {
    await signUp(page, email);
    await addVirtualAuthenticator(page);
    await page.goto("/profile");
    await page.getByTestId("passkey-add").click();
    await stepUp(page);
    await saveRecoveryCodes(page);

    await signOutAndEnterPassword(page, email);
    await page.getByTestId("login-passkey-button").click();
    await page.waitForURL("/");
    await page.goto("/profile");
    await expect(page.getByTestId("passkey-list")).toContainText("last used");
  });

  test("text messages: the code arrives, sets it up, and signs in; the number is only ever shown masked", async ({ page }) => {
    test.skip(!SMS_BASE, "needs the scratch stack's stand-in for the text-message provider");
    const phone = newPhone();
    await signUp(page, email);
    await page.goto("/profile");
    await page.getByTestId("sms-add").click();
    await page.getByTestId("sms-phone").fill(phone);
    await stepUp(page);
    await expect(page.getByTestId("sms-code-dialog")).toBeVisible();
    await expect(page.getByTestId("sms-code-dialog")).not.toContainText(phone);
    await audited(page, "text message: enter the code");
    await page.getByTestId("sms-code").fill(await textedCode(phone));   // the last digit sends it
    await saveRecoveryCodes(page);
    await expect(page.getByTestId("method-sms-state")).toHaveText("On");
    await expect(page.getByTestId("method-sms")).toContainText("•••");
    await expect(page.locator("body")).not.toContainText(phone);

    await signOutAndEnterPassword(page, email);
    await expect(page.getByTestId("login-sms-send")).toBeVisible();
    await audited(page, "second step: text message");
    await page.getByTestId("login-sms-send").click();
    await page.getByTestId("login-sms-code").fill("000000");
    await expect(page.getByTestId("login-second-error")).toContainText(/not right/i);
    await page.getByTestId("login-sms-code").fill(await textedCode(phone));
    await page.waitForURL("/");
  });

  test("with two-step on, adding and removing methods asks for a proof; switching ways at sign-in; recovery codes work with any method", async ({ page }) => {
    await signUp(page, email);
    await addVirtualAuthenticator(page);
    await page.goto("/profile");
    await page.getByTestId("passkey-add").click();
    await stepUp(page);
    const codes = await saveRecoveryCodes(page);

    // adding the authenticator app now needs a proof: the passkey, asked for by the browser
    await page.getByTestId("totp-add").click();
    await expect(page.getByTestId("stepup-passkey-note")).toBeVisible();
    await stepUp(page);
    await page.getByTestId("two-factor-manual").locator("summary").click();
    const secret = (await page.getByTestId("two-factor-secret").innerText()).replace(/\s/g, "");
    await page.getByTestId("two-factor-code").fill(codeFor(secret));
    await expect(page.getByTestId("method-totp-state")).toHaveText("On");
    await expect(page.getByTestId("two-factor-recovery-codes")).toHaveCount(0);       // not the first method: no new codes

    // sign in the other way: switch from the passkey to the app
    await signOutAndEnterPassword(page, email);
    await page.getByTestId("login-use-totp").click();
    await page.getByTestId("login-totp-code").fill(codeFor(secret, 1));
    await page.waitForURL("/");

    // removing the passkey: a recovery code as the proof instead of the passkey
    await page.goto("/profile");
    await page.getByTestId("passkey-list").locator("li").first().getByRole("button", { name: /^Remove/ }).click();
    await page.getByTestId("stepup-password").fill(PASSWORD);
    await page.getByTestId("stepup-method-recovery").click();
    await page.getByTestId("stepup-recovery").fill(codes[1]);
    await audited(page, "remove a passkey, proof by recovery code");
    await page.getByTestId("stepup-submit").click();
    await expect(page.getByTestId("method-passkey-state")).toHaveCount(0);
    await expect(page.getByTestId("two-factor-status")).toContainText("On");

    // a recovery code still signs in, and is spent
    await signOutAndEnterPassword(page, email);
    await page.getByTestId("login-use-recovery").click();
    await page.getByTestId("login-recovery").fill(codes[0]);
    await page.getByTestId("login-recovery-submit").click();
    await page.waitForURL("/");
    await page.goto("/profile");
    await expect(page.getByTestId("two-factor-status")).toContainText("6 recovery codes left");   // two spent: one as a proof, one to sign in
  });

  test("the whole thing also passes the accessibility audit on a phone in the dark theme", async ({ page }) => {
    test.skip(!SMS_BASE, "needs the scratch stack's stand-in for the text-message provider");
    await signUp(page, email);
    await prepare(page, "dark", { width: 390, height: 844 });
    await addVirtualAuthenticator(page);
    await page.goto("/profile");
    await page.getByTestId("passkey-add").click();
    await stepUp(page);
    await saveRecoveryCodes(page);
    await audited(page, "settings with a passkey, dark phone");
    await page.getByTestId("sms-add").click();
    await page.getByTestId("sms-phone").fill(newPhone());
    await page.getByTestId("stepup-password").fill(PASSWORD);
    await audited(page, "add text messages, proof choices, dark phone");
    await page.keyboard.press("Escape");
    await signOutAndEnterPassword(page, email);
    await audited(page, "second step: passkey, dark phone");
    await page.getByTestId("login-use-recovery").click();
    await audited(page, "second step: recovery code, dark phone");
  });
});
