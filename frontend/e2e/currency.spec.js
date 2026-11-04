import { test, expect } from "./fixtures";
import { prepare } from "./support/a11y";

// F-09: an account in another currency shows its own symbol, the totals stay one per currency, and a transfer between two currencies asks
// for both amounts and shows the rate that implies (nothing is converted). The shared account's Revolut is put in USD for the test and
// back to EUR afterwards (the transfer is removed first: a crossing transfer pins the currencies of the accounts it touches).
test("a USD Revolut has its own total, and a transfer to the EUR bank asks what arrives", async ({ authenticatedPage: page, apiContext }) => {
  await prepare(page, "light", { width: 1280, height: 900 });
  const accounts = await (await apiContext.get("/api/accounts")).json();
  const revolut = accounts.find((a) => a.type === "revolut" && !a.parent_id);
  expect(revolut.currency).toBe("EUR");
  let transferId = null;
  try {
    expect((await apiContext.put(`/api/accounts/${revolut.id}`, { data: { currency: "usd" } })).ok()).toBe(true);
    await page.goto("/money");
    const totals = page.getByTestId("money-by-currency");
    await expect(totals).toBeVisible();
    await expect(totals).toContainText("in USD");            // (en-IE writes dollars as "US$")

    await page.getByRole("button", { name: "Transfer", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Move money from" }).click();
    await page.getByRole("option", { name: /^Revolut › Default/ }).click();
    await dialog.getByRole("combobox", { name: "Move money to" }).click();
    await page.getByRole("option", { name: /^Main bank/ }).click();
    await expect(dialog.getByTestId("transfer-arrives")).toBeVisible();      // two currencies: the arriving amount is asked for
    await expect(dialog.getByRole("button", { name: "Transfer", exact: true })).toBeDisabled();
    await dialog.getByTestId("transfer-amount").fill("10");
    await dialog.getByTestId("transfer-arrives").fill("9");
    await expect(dialog.getByTestId("transfer-rate")).toContainText("1 USD = 0.9000 EUR");
    await dialog.getByRole("button", { name: "Transfer", exact: true }).click();
    await expect(page.getByText("Transfer done")).toBeVisible();

    const txns = await (await apiContext.get("/api/transactions")).json();
    const t = txns.find((x) => x.type === "transfer" && x.to_amount === 9 && x.gross_amount === 10);
    expect(t).toBeTruthy();
    transferId = t.id;
    expect(t.currency).toBe("USD");
    expect(t.to_currency).toBe("EUR");
    await page.reload();
    await expect(page.getByTestId(`txn-${t.id}`)).toContainText("$10.00");
    await expect(page.getByTestId(`txn-${t.id}`)).toContainText("€9.00");
  } finally {
    if (transferId) await apiContext.delete(`/api/transactions/${transferId}`);
    await apiContext.put(`/api/accounts/${revolut.id}`, { data: { currency: "EUR" } });
  }
  const after = await (await apiContext.get("/api/accounts")).json();
  expect(after.find((a) => a.id === revolut.id).currency).toBe("EUR");
});
