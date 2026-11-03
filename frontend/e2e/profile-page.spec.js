import { test, expect } from "./fixtures";

test.use({ viewport: { width: 1440, height: 900 } });

test("the name is edited where it is shown: Enter saves, Esc cancels, the header follows", async ({ freshUserPage: { page, fresh } }) => {
  await page.goto("/profile");
  await expect(page.getByTestId("profile-name")).toHaveText("Fresh Tester");
  await page.getByTestId("name-edit").click();
  await page.getByTestId("name-input").fill("Nope");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("profile-name")).toHaveText("Fresh Tester");

  await page.getByTestId("name-edit").click();
  await page.getByTestId("name-input").fill("  Alex   Rivera ");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("profile-name")).toHaveText("Alex Rivera");
  expect((await (await fresh.api.get("/api/auth/me")).json()).name).toBe("Alex Rivera");
  await expect(page.getByTestId("header-profile")).toHaveText("A");

  await page.getByTestId("name-edit").click();
  await page.getByTestId("name-input").fill("   ");
  await expect(page.getByTestId("name-save")).toBeDisabled();
});

test("a new password is judged as it is typed, and changing it asks for the current one first", async ({ freshUserPage: { page, fresh } }) => {
  await page.goto("/profile");
  const save = page.getByTestId("pw-save");
  await expect(save).toBeDisabled();
  await page.getByTestId("pw-new").fill("short");
  await expect(page.getByTestId("pw-strength")).toContainText("Too weak");
  await expect(save).toBeDisabled();

  await page.getByTestId("pw-new").fill("Brandnew123");
  await page.getByTestId("pw-confirm").fill("Brandnew124");
  await expect(page.getByText("do not match")).toBeVisible();
  await expect(save).toBeDisabled();

  await page.getByTestId("pw-confirm").fill("Brandnew123");
  await expect(save).toBeEnabled();
  await save.click();
  const dialog = page.getByTestId("stepup-dialog");
  await expect(dialog).toContainText("every other device is signed out");
  await dialog.getByTestId("stepup-password").fill("definitely-wrong-1");
  await dialog.getByTestId("stepup-submit").click();
  await expect(dialog.getByTestId("stepup-error")).toContainText("Current password is incorrect");
  await expect(page).toHaveURL(/\/profile$/);                            // a typo does not sign you out

  await dialog.getByTestId("stepup-password").fill(fresh.password);
  await dialog.getByTestId("stepup-submit").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("pw-new")).toHaveValue("");
  const again = await fresh.api.post("/api/auth/login", { data: { email: fresh.email, password: "Brandnew123" } });
  expect(again.status()).toBe(200);
});

test("a suggested password fills both fields, is shown, and is strong", async ({ freshUserPage: { page } }) => {
  await page.goto("/profile");
  await page.getByTestId("pw-suggest").click();
  await expect(page.getByTestId("pw-new")).toHaveValue(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
  await expect(page.getByTestId("pw-confirm")).toHaveValue(await page.getByTestId("pw-new").inputValue());
  await expect(page.getByTestId("pw-strength")).toContainText("Strong");
  await expect(page.getByTestId("pw-save")).toBeEnabled();
});

test("the sign-in address is shown and cannot be changed", async ({ freshUserPage: { page, fresh } }) => {
  await page.goto("/profile");
  await expect(page.getByTestId("profile-email")).toHaveText(fresh.email);
  await expect(page.getByText(/change (your )?email/i)).toHaveCount(0);
  await expect(page.getByTestId("email-change-open")).toHaveCount(0);
  const tried = await fresh.api.post("/api/auth/email-change", { data: { new_email: "x@example.com", password: fresh.password } });
  expect(tried.status()).toBeGreaterThanOrEqual(404);
  expect((await (await fresh.api.get("/api/auth/me")).json()).email).toBe(fresh.email);
});
