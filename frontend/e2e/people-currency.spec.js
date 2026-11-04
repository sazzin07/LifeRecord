import { test, expect } from "./fixtures";
import { audit, prepare, settle } from "./support/a11y";

// F-19: a person can owe in two currencies at once. The list says so under their name, the profile has a switch between the currencies, and
// the debt dialog opens in the currency being looked at. Nothing is added across currencies. (The shared account's Revolut is put in USD for the
// test and back to EUR afterwards; the person made here is archived with its balances cleared.)
for (const theme of ["light", "dark"]) test(`a person owes in EUR and USD (${theme}): the list, the profile switch and the dialog keep them apart`, async ({ authenticatedPage: page, apiContext }) => {
  await prepare(page, theme, { width: 1280, height: 900 });
  const accounts = await (await apiContext.get("/api/accounts")).json();
  const revolut = accounts.find((a) => a.type === "revolut" && !a.parent_id);
  let personId = null;
  try {
    expect((await apiContext.put(`/api/accounts/${revolut.id}`, { data: { currency: "USD" } })).ok()).toBe(true);
    const person = await (await apiContext.post("/api/people", { data: { name: `E2E-USD ${Date.now()}` } })).json();
    personId = person.id;
    expect((await apiContext.post(`/api/debts/people/${personId}/adjust/add`, { data: { direction: "they_owe", amount: 20 } })).ok()).toBe(true);
    expect((await apiContext.post(`/api/debts/people/${personId}/adjust/add`, { data: { direction: "they_owe", amount: 30, currency: "USD" } })).ok()).toBe(true);

    await page.goto("/people");
    const row = page.getByTestId(`person-open-${personId}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("other-currency-USD")).toContainText("$30.00");
    await expect(row.getByTestId("other-currency-USD")).toContainText("in USD");
    await settle(page);
    await audit(page, `people list, two currencies, ${theme}`);

    await page.goto(`/people/${personId}`);
    await expect(page.getByTestId("ledger-switch")).toBeVisible();
    await expect(page.getByTestId("balance-they_owe-amount")).toContainText("€20.00");
    await page.getByTestId("ledger-USD").click();
    await expect(page.getByTestId("balance-they_owe-amount")).toContainText("$30.00");
    await settle(page);
    await audit(page, `person profile, USD ledger, ${theme}`);

    await page.getByTestId("act-add-they_owe").click();
    const dialog = page.getByTestId("debt-dialog");
    await expect(dialog.getByTestId("debt-currency")).toContainText("USD");
    await page.waitForTimeout(500);
    await audit(page, `debt dialog, two currencies, ${theme}`);
    await dialog.getByTestId("debt-amount").fill("5");
    await dialog.getByTestId("debt-submit").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("balance-they_owe-amount")).toContainText("$35.00");
    await page.getByTestId("ledger-EUR").click();
    await expect(page.getByTestId("balance-they_owe-amount")).toContainText("€20.00");   // the other ledger never moved
  } finally {
    if (personId) await apiContext.post(`/api/debts/people/${personId}/archive`, { data: { clear_balances: true } });
    await apiContext.put(`/api/accounts/${revolut.id}`, { data: { currency: "EUR" } });
  }
});
