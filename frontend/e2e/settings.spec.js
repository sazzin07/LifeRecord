import { test, expect } from "./fixtures";

// ACCT-001. Money places on Settings, and signing out everywhere. The password, name and address flows are in profile-page.spec.js, on throwaway accounts.
const tag = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("add, edit and delete a money place from Settings", async ({ authenticatedPage: page, apiContext }) => {
  const name = tag();
  await page.goto("/settings?section=money");
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

test("sign out on all devices asks first, calls the server, then returns to the login page", async ({ authenticatedPage: page }) => {
  // The endpoint is answered by the test: calling the real one would end the owner's own session for the whole suite.
  let called = 0;
  await page.route("**/api/auth/logout-all", (route) => { called += 1; route.fulfill({ status: 200, json: { message: "Signed out on all devices" } }); });
  await page.goto("/profile");
  await page.getByTestId("settings-logout-all").click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Sign out on all devices?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(called).toBe(0);
  await page.getByTestId("settings-logout-all").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(called).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("lm_token"))).toBeNull();
});
