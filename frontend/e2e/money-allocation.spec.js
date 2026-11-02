import { test, expect } from "@playwright/test";
import { newEmail, verificationCode, deleteUser } from "./support-new-user";

// A main account and its places are one amount of money. Signs up a brand-new account (reserved example.com address:
// never mailed) with €200 in hand, and removes it afterwards.
const PASSWORD = "TestPass123";

test.describe("places are part of the main account's money", () => {
  let email;
  test.beforeEach(async ({ page }) => {
    email = newEmail();
    await page.addInitScript(() => sessionStorage.setItem("lm_intro", "1")); // skip the welcome splash
  });
  test.afterEach(() => deleteUser(email));

  async function setUp(page) {
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Alma Allocator");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByText("Verify your email")).toBeVisible();
    await page.getByLabel("6-digit verification code").fill(verificationCode(email));
    await page.getByRole("button", { name: "Verify email" }).click();
    await page.waitForURL("/");
    await page.goto("/money");
    await page.getByTestId("onboarding-balance-cash").fill("200");
    await page.getByTestId("onboarding-create").click();
    await expect(page.getByTestId("money-cash")).toContainText("200.00");
  }

  async function openNewPlace(page, name, amount) {
    await page.getByTestId("money-cash").getByRole("button", { name: "Add sub-place" }).click();
    const dialog = page.getByTestId("account-dialog");
    await dialog.getByTestId("account-name").fill(name);
    await dialog.getByTestId("account-balance").fill(amount);
    return dialog;
  }

  test("a new place is carved out of the money in hand, never added to it", async ({ page }) => {
    await setUp(page);
    const dialog = await openNewPlace(page, "Wallet", "50");
    await expect(dialog.getByTestId("account-new-money")).not.toBeChecked(); // unchecked by default
    await expect(dialog.getByTestId("account-allocation")).toContainText("The total stays €200.00");
    await dialog.getByTestId("account-save").click();
    await expect(dialog).toBeHidden();

    const card = page.getByTestId("money-cash");
    await expect(card).toContainText("200.00"); // the total did not grow to €250
    await card.getByRole("button", { name: /^Show 1 place$/ }).click();
    await expect(page.getByTestId("unassigned-cash")).toContainText("150.00");
  });

  test("asking for more than is available is refused up front, and new money is the way to add more", async ({ page }) => {
    await setUp(page);
    let dialog = await openNewPlace(page, "Wallet", "50");
    await dialog.getByTestId("account-save").click();
    await expect(dialog).toBeHidden();

    dialog = await openNewPlace(page, "Greedy", "160");
    await expect(dialog.getByTestId("account-allocation")).toContainText("exceeds the available balance of €150.00");
    await expect(dialog.getByTestId("account-save")).toBeDisabled();

    await dialog.getByLabel("Add this amount as new money to the main account").check();
    await expect(dialog.getByTestId("account-allocation")).toContainText("total goes from €200.00 to €360.00");
    await expect(dialog.getByTestId("account-save")).toBeEnabled();
    await dialog.getByTestId("account-save").click();
    await expect(dialog).toBeHidden();

    const card = page.getByTestId("money-cash");
    await expect(card).toContainText("360.00");
    await card.getByRole("button", { name: /Show 2 places/ }).click();
    await expect(page.getByTestId("unassigned-cash")).toContainText("150.00"); // nothing was taken from it
  });

  test("deleting a place gives its money back", async ({ page }) => {
    await setUp(page);
    const dialog = await openNewPlace(page, "Wallet", "50");
    await dialog.getByTestId("account-save").click();
    await expect(dialog).toBeHidden();

    const card = page.getByTestId("money-cash");
    await card.getByRole("button", { name: /^Show 1 place$/ }).click();
    await page.getByRole("button", { name: "Delete Wallet" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(card).toContainText("200.00");
    await expect(card.getByRole("button", { name: /places/ })).toHaveCount(0); // no places left
  });
  test("the expense and transfer forms say what is available instead of failing on the first try", async ({ page }) => {
    await setUp(page);
    // Everything in hand goes into one place: Money in hand itself has nothing left of its own.
    const dialog = await openNewPlace(page, "Wallet", "200");
    await dialog.getByTestId("account-save").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("allocation-cash")).toContainText("€0.00 not in a place");

    // A new expense starts on the place that has the money, not on the empty main account.
    await page.getByTestId("add-expense-btn").click();
    const expense = page.getByTestId("expense-dialog");
    await expect(expense.getByTestId("expense-account")).toContainText("Wallet");
    await expense.getByTestId("expense-amount").fill("250");
    await expect(expense.getByTestId("expense-spend-warning")).toContainText("more than the €200.00 available in Wallet");
    await expect(expense.getByTestId("expense-save")).toBeDisabled();
    await expense.getByTestId("expense-amount").fill("20");
    await expect(expense.getByTestId("expense-spend-warning")).toHaveCount(0);
    await expense.getByTestId("expense-save").click();
    await expect(page.getByText("Expense added")).toBeVisible();
    await expect(page.getByTestId("money-cash")).toContainText("180.00");

    // The transfer form shows what can be moved and blocks more than that.
    await page.getByRole("button", { name: "Transfer", exact: true }).first().click();
    const transfer = page.getByRole("dialog");
    await transfer.getByLabel("Move money from").click();
    await page.getByRole("option", { name: /Money in hand › Wallet · €180\.00/ }).click();
    await expect(transfer.getByTestId("transfer-note")).toContainText("Available to move from Wallet: €180.00");
    await transfer.getByTestId("transfer-amount").fill("500");
    await expect(transfer.getByTestId("transfer-note")).toContainText("more than the €180.00 available in Wallet");
    await transfer.getByRole("button", { name: "All of it" }).click();
    await expect(transfer.getByTestId("transfer-amount")).toHaveValue("180");
    await expect(transfer.getByTestId("transfer-note")).not.toContainText("more than");
  });
});
