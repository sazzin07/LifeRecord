import { test, expect } from "./fixtures";
import { prepare } from "./support/a11y";

// Recurring items on Money: add, see the next date, pause and resume, edit, delete. (The scheduler that records them on their day is off in the
// test stack; backend/tests/test_recurring_api.py covers the recording itself.)
test("a recurring item can be added, paused, resumed, edited and deleted", async ({ authenticatedPage: page, apiContext }) => {
  await prepare(page, "light", { width: 1280, height: 900 });
  const name = `Spec rent ${Date.now()}`;
  await page.goto("/money");
  await expect(page.getByTestId("recurring-card")).toBeVisible();
  await page.getByTestId("recurring-add").click();
  const dialog = page.getByTestId("recurring-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("recurring-name").fill(name);
  await dialog.getByTestId("recurring-amount").fill("650");
  await dialog.getByTestId("recurring-start").fill("2099-01-15");
  await dialog.getByTestId("recurring-save").click();
  await expect(dialog).toBeHidden();

  const row = page.getByTestId("recurring-card").locator("li", { hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Every month");
  await expect(row).toContainText(/15 Jan 2099|Jan 15, 2099/);
  await expect(row).toContainText("650");

  await row.getByRole("button", { name: `Pause ${name}` }).click();
  await expect(row).toContainText("Paused");
  await row.getByRole("button", { name: `Resume ${name}` }).click();
  await expect(row.getByRole("button", { name: `Pause ${name}` })).toBeVisible();

  await row.getByRole("button", { name: `Edit ${name}` }).click();
  await dialog.getByTestId("recurring-amount").fill("700");
  await dialog.getByTestId("recurring-save").click();
  await expect(row).toContainText("700");

  await row.getByRole("button", { name: `Delete ${name}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  const left = await (await apiContext.get("/api/recurring")).json();
  expect(left.some((r) => r.description === name)).toBe(false);
});

test("a rule with a bad amount is refused with words, and the dialog stays open", async ({ authenticatedPage: page }) => {
  await page.goto("/money");
  await page.getByTestId("recurring-add").click();
  const dialog = page.getByTestId("recurring-dialog");
  await dialog.getByTestId("recurring-save").click();
  await expect(page.getByText("Enter an amount above zero")).toBeVisible();
  await expect(dialog).toBeVisible();
});
