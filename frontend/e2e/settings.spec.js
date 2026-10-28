import { test, expect } from "./fixtures";

// ACCT-001 / AUTH-001. The password test never submits a correct current password: that would change the real
// owner password. The successful change is covered by backend/tests/test_change_password.py with a throwaway user.
const tag = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("add, edit and delete a money place from Settings", async ({ authenticatedPage: page, apiContext }) => {
  const name = tag();
  await page.goto("/settings");
  try {
    await page.getByTestId("settings-add-place").click();
    const dialog = page.getByTestId("account-dialog");
    await dialog.getByTestId("account-name").fill(name);
    await dialog.getByTestId("account-parent").click();
    await page.getByRole("option", { name: "Revolut" }).click();
    await dialog.getByTestId("account-save").click();
    await expect(dialog).not.toBeVisible();

    let acc = (await (await apiContext.get("/api/accounts")).json()).find((a) => a.name === name);
    expect(acc).toMatchObject({ type: "revolut_space" });
    await expect(page.getByTestId(`settings-account-${acc.id}`)).toBeVisible();

    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await dialog.getByTestId("account-balance").fill("12.5");
    await dialog.getByTestId("account-save").click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId(`settings-account-${acc.id}`)).toContainText("12.50");

    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId(`settings-account-${acc.id}`)).toHaveCount(0);
    acc = (await (await apiContext.get("/api/accounts")).json()).find((a) => a.name === name);
    expect(acc).toBeUndefined();
  } finally {
    const left = (await (await apiContext.get("/api/accounts")).json()).find((a) => a.name === name);
    if (left) await apiContext.delete(`/api/accounts/${left.id}`);
  }
});

test("change password: checks the new password and a wrong current password keeps you signed in", async ({ authenticatedPage: page }) => {
  await page.goto("/settings");
  const form = page.getByTestId("change-password-form");
  const save = form.getByTestId("pw-save");
  await expect(save).toBeDisabled();

  await form.getByTestId("pw-current").fill("definitely-wrong-1");
  await form.getByTestId("pw-new").fill("short");
  await expect(form).toContainText("At least 8 characters");
  await expect(save).toBeDisabled();

  await form.getByTestId("pw-new").fill("Brandnew123");
  await form.getByTestId("pw-confirm").fill("Brandnew124");
  await expect(form).toContainText("do not match");
  await expect(save).toBeDisabled();

  await form.getByTestId("pw-confirm").fill("Brandnew123");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("Current password is incorrect")).toBeVisible();
  // Still signed in and still on Settings (a 401 here used to send the user to the login page).
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
