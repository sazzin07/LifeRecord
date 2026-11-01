import { test, expect } from "@playwright/test";
import { newEmail, verificationCode, deleteUser } from "./support-new-user";

// F-01: a person who has just signed up can set up their money and record a first expense, with no help.
// Signs up a brand-new account (reserved example.com address: never mailed) and removes it afterwards.
const PASSWORD = "TestPass123";

test.describe("new account onboarding", () => {
  let email;
  test.beforeEach(async ({ page }) => {
    email = newEmail();
    await page.addInitScript(() => sessionStorage.setItem("lm_intro", "1")); // skip the welcome splash
  });
  test.afterEach(() => deleteUser(email));

  async function signUpAndVerify(page) {
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Nova Newcomer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByText("Verify your email")).toBeVisible();
    const code = verificationCode(email);
    await page.getByLabel("6-digit verification code").fill(code);
    await page.getByRole("button", { name: "Verify email" }).click();
    await page.waitForURL("/");
  }

  test("signup, set up money, first expense", async ({ page }) => {
    await signUpAndVerify(page);

    // The starter categories are there, no accounts yet.
    await page.goto("/money");
    const card = page.getByTestId("onboarding-first-account");
    await expect(card).toBeVisible();

    // Trying to add an expense now explains what to do instead of failing.
    await page.getByTestId("quick-add-trigger").click();
    await page.getByTestId("qa-expense").click();
    await expect(page.getByTestId("expense-no-account")).toBeVisible();
    await expect(page.getByTestId("expense-save")).toBeDisabled();
    await page.keyboard.press("Escape");

    // Set up "Money in hand" with 50 euros.
    await expect(page.getByTestId("onboarding-account-cash")).toBeChecked();
    await page.getByTestId("onboarding-balance-cash").fill("50");
    await page.getByTestId("onboarding-create").click();
    await expect(card).toBeHidden();
    await expect(page.getByTestId("money-cash")).toContainText("50");

    // First expense, using a starter category.
    await page.getByTestId("quick-add-trigger").click();
    await page.getByTestId("qa-expense").click();
    await expect(page.getByTestId("expense-no-account")).toHaveCount(0);
    await page.getByTestId("expense-amount").fill("12.50");
    await page.getByTestId("expense-merchant").fill("Corner shop");
    await page.getByTestId("expense-save").click();
    await expect(page.getByText("Expense added")).toBeVisible();
    await expect(page.getByTestId("money-cash")).toContainText("37.50");
  });

  test("the setup form asks for at least one place and a sensible amount", async ({ page }) => {
    await signUpAndVerify(page);
    await page.goto("/money");
    await page.getByTestId("onboarding-account-cash").click(); // untick the only chosen place
    await expect(page.getByTestId("onboarding-problem")).toContainText("Choose at least one place");
    await expect(page.getByTestId("onboarding-create")).toBeDisabled();
    await page.getByTestId("onboarding-account-bank").click();
    await page.getByTestId("onboarding-balance-bank").fill("-5");
    await expect(page.getByTestId("onboarding-problem")).toContainText("zero or more");
  });
});
