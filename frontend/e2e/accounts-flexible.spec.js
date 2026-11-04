import { test, expect } from "./fixtures";
import { prepare, settle } from "./support/a11y";

// Money, made flexible: put money into a chosen place without editing the whole balance, give a place a currency of its own (10 EUR and 15 CHF side
// by side), make more accounts, and see both amounts of a transfer. Everything made here is removed again.
test.describe.configure({ timeout: 120_000 });

const accountsOf = async (api) => (await api.get("/api/accounts")).json();

test("Add money lands in the chosen place and shows in the history", async ({ authenticatedPage: page, apiContext }) => {
  await prepare(page, "light", { width: 1280, height: 900 });
  await page.goto("/money");
  await settle(page);
  const note = `Spec gift ${Date.now()}`;
  await page.getByTestId("add-money-btn").click();
  const dialog = page.getByTestId("add-money-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("add-money-where").click();
  await page.getByRole("option", { name: /Money in hand › Wallet/ }).click();
  await dialog.getByTestId("add-money-amount").fill("7.5");
  await expect(dialog.getByTestId("add-money-preview")).toContainText("goes from");
  await dialog.getByTestId("add-money-note").fill(note);
  await dialog.getByTestId("add-money-submit").click();
  await expect(page.getByText(/added to Money in hand › Wallet/)).toBeVisible();
  const txns = await (await apiContext.get("/api/transactions")).json();
  const t = txns.find((x) => x.description === note);
  expect(t).toBeTruthy();
  expect(t.type).toBe("income");
  expect(t.gross_amount).toBe(7.5);
  await apiContext.delete(`/api/transactions/${t.id}`);
});

test("a place can hold another currency, and a transfer shows what leaves and what arrives", async ({ authenticatedPage: page, apiContext }) => {
  await prepare(page, "light", { width: 1280, height: 900 });
  const name = `Swiss ${Date.now()}`;
  let placeId = null;
  let transferId = null;
  try {
    await page.goto("/money");
    await settle(page);
    await page.getByRole("button", { name: "Add sub-place" }).first().click();
    const dialog = page.getByTestId("account-dialog");
    await dialog.getByTestId("account-name").fill(name);
    await dialog.getByTestId("account-currency").click();
    await page.getByRole("option", { name: /^CHF ·/ }).click();
    await dialog.getByTestId("account-balance").fill("15");
    await expect(dialog.getByTestId("account-allocation")).toContainText("nothing is converted");
    await dialog.getByTestId("account-save").click();
    await expect(dialog).toBeHidden();

    const mine = (await accountsOf(apiContext)).find((a) => a.name === name);
    placeId = mine.id;
    expect(mine.currency).toBe("CHF");
    expect(mine.balance).toBe(15);
    await expect(page.getByTestId("other-balance-CHF").first()).toContainText("15.00");   // the main account lists it apart, in its own currency

    await page.getByRole("button", { name: "Transfer", exact: true }).click();
    const t = page.getByRole("dialog");
    await t.getByRole("combobox", { name: "Move money from" }).click();
    await page.getByRole("option", { name: /^Money in hand › Wallet/ }).click();
    await t.getByRole("combobox", { name: "Move money to" }).click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
    await t.getByTestId("transfer-amount").fill("4");
    await t.getByTestId("transfer-arrives").fill("3.9");
    await expect(t.getByTestId("transfer-summary")).toContainText("leaves");
    await expect(t.getByTestId("transfer-summary")).toContainText("arrives in");
    await t.getByRole("button", { name: "Transfer", exact: true }).click();
    await expect(page.getByText("Transfer done")).toBeVisible();
    const made = (await (await apiContext.get("/api/transactions")).json()).find((x) => x.type === "transfer" && x.to_amount === 3.9);
    transferId = made?.id;
    expect(made.currency).toBe("EUR");
    expect(made.to_currency).toBe("CHF");

    // the next transfer between the same pair starts from the rate just used
    await page.getByRole("button", { name: "Transfer", exact: true }).click();
    const t2 = page.getByRole("dialog");
    await t2.getByRole("combobox", { name: "Move money from" }).click();
    await page.getByRole("option", { name: /^Money in hand › Wallet/ }).click();
    await t2.getByRole("combobox", { name: "Move money to" }).click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
    await t2.getByTestId("transfer-amount").fill("10");
    await expect(t2.getByTestId("transfer-arrives")).toHaveValue("9.75");
    await t2.getByRole("button", { name: "Cancel" }).click();
  } finally {
    if (transferId) await apiContext.delete(`/api/transactions/${transferId}`);
    if (placeId) {
      await apiContext.put(`/api/accounts/${placeId}`, { data: { balance: 0 } });
      await apiContext.delete(`/api/accounts/${placeId}`);
    }
  }
});

test("a new account of your own, in any currency, with places of its own", async ({ authenticatedPage: page, apiContext }) => {
  await prepare(page, "light", { width: 1280, height: 900 });
  const name = `Savings ${Date.now()}`;
  let id = null;
  try {
    await page.goto("/money");
    await settle(page);
    await page.getByTestId("add-account").click();
    const dialog = page.getByTestId("account-dialog");
    await expect(dialog).toContainText("New account");
    await dialog.getByTestId("account-name").fill(name);
    await dialog.getByTestId("account-kind").click();
    await page.getByRole("option", { name: /^Bank account/ }).click();
    await dialog.getByTestId("account-currency").click();
    await page.getByRole("option", { name: /^CHF ·/ }).click();
    await dialog.getByTestId("account-balance").fill("40");
    await dialog.getByTestId("account-save").click();
    await expect(dialog).toBeHidden();
    const made = (await accountsOf(apiContext)).find((a) => a.name === name);
    id = made.id;
    expect(made.currency).toBe("CHF");
    expect(made.type).toBe("bank");
    await expect(page.getByTestId(`money-account-${id}`)).toContainText(name);
    await expect(page.getByTestId(`money-account-${id}`)).toContainText("40.00");
    await page.getByTestId(`money-account-${id}`).getByRole("button", { name: "Add sub-place" }).click();   // a bank account can have places too
    await expect(page.getByTestId("account-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    if (id) {
      await apiContext.put(`/api/accounts/${id}`, { data: { balance: 0 } });
      await apiContext.delete(`/api/accounts/${id}`);
    }
  }
});
