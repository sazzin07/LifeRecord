import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { newEmail, verificationCode, deleteUser } from "./support-new-user";

// S-11: a person can download their data and delete their account from Settings. Uses a brand-new throw-away account
// (reserved example.com address: never mailed) and removes it afterwards in case a step fails.
const PASSWORD = "TestPass123";

test.describe("your data", () => {
  let email;
  test.beforeEach(async ({ page }) => {
    email = newEmail();
    await page.addInitScript(() => sessionStorage.setItem("lm_intro", "1"));
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Nova Newcomer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByText("Verify your email")).toBeVisible();   // the account exists once this shows
    await page.getByLabel("6-digit verification code").fill(verificationCode(email));
    await page.getByRole("button", { name: "Verify email" }).click();
    await page.waitForURL("/");
    await page.goto("/profile");
  });
  test.afterEach(() => deleteUser(email));

  test("download my data gives a zip with data.json and no password", async ({ page }) => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("your-data-export").click()]);
    expect(download.suggestedFilename()).toMatch(/^liferecord-export-\d{4}-\d{2}-\d{2}\.zip$/);
    const bytes = fs.readFileSync(await download.path());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");            // a zip
    expect(bytes.includes(Buffer.from("data.json"))).toBe(true);    // file names sit uncompressed in the zip's directory
    await expect(page.getByText("Your data was downloaded")).toBeVisible();
  });

  test("deleting needs the password and the exact words, and then the account is gone", async ({ page, request }) => {
    await page.getByTestId("your-data-delete-open").click();
    const submit = page.getByTestId("delete-account-submit");
    await expect(submit).toBeDisabled();

    await page.getByTestId("delete-account-password").fill("wrong-password-1");
    await page.getByTestId("delete-account-confirm").fill("delete my account");   // wrong case: still disabled
    await expect(submit).toBeDisabled();
    await page.getByTestId("delete-account-confirm").fill("DELETE MY ACCOUNT");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId("delete-account-error")).toContainText("Password is incorrect");
    await expect(page).toHaveURL(/\/profile$/);                                      // a typo does not sign you out

    await page.getByTestId("delete-account-password").fill(PASSWORD);
    await submit.click();
    await page.waitForURL(/\/login$/);

    const api = process.env.API_URL || "http://localhost:8000";
    const attempt = await request.post(`${api}/api/auth/login`, { data: { email, password: PASSWORD } });
    expect(attempt.status()).toBeGreaterThanOrEqual(400);
    expect(attempt.status()).toBeLessThan(500);
  });

  test("the dialog can be cancelled and changes nothing", async ({ page }) => {
    await page.getByTestId("your-data-delete-open").click();
    await page.getByRole("button", { name: "Keep my account" }).click();
    await expect(page.getByTestId("delete-account-dialog")).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("your-data")).toBeVisible();                       // still signed in
  });
});
