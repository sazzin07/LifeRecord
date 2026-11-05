import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

const RED_PNG = Buffer.from(fs.readFileSync(path.join(__dirname, "red.b64"), "utf8"), "base64");

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
  await expect(page.getByTestId("header-menu").locator("[data-initials]")).toHaveAttribute("data-initials", "AR");   // drawn by CSS, so it is not text that could differ from the button's name

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

test("a profile photo: choose, place, save, see it in the header and on the profile, and remove it", async ({ freshUserPage: { page, fresh } }) => {
  await page.goto("/profile");
  await expect(page.getByTestId("user-photo")).toHaveCount(0);                        // initials until there is a photo
  await page.getByTestId("photo-open").click();
  const dialog = page.getByTestId("photo-dialog");
  await expect(dialog.getByTestId("photo-save")).toBeDisabled();                      // nothing chosen yet
  await dialog.getByTestId("photo-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(dialog.getByTestId("photo-error")).toContainText("JPEG, PNG or WebP");

  await dialog.getByTestId("photo-file").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: RED_PNG });
  await expect(dialog.getByTestId("photo-crop")).toBeVisible();
  await dialog.getByTestId("photo-zoom").fill("2");
  const box = await dialog.getByTestId("photo-crop").boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120, { steps: 4 });
  await page.mouse.up();
  await dialog.getByTestId("photo-crop").focus();
  await page.keyboard.press("ArrowLeft");                                              // keyboard users can place it too
  await dialog.getByTestId("photo-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("user-photo")).toHaveCount(2);                        // the profile and the header
  // both really show the picture (a revoked or broken address leaves an image that is "there" but empty)
  await expect.poll(() => page.getByTestId("user-photo").evaluateAll((els) => els.every((e) => e.complete && e.naturalWidth > 0))).toBe(true);
  await expect(page.getByTestId("header-menu").getByTestId("user-photo")).toBeVisible();
  const saved = await fresh.api.get("/api/auth/me/photo");
  expect(saved.status()).toBe(200);
  expect(saved.headers()["content-type"]).toBe("image/jpeg");                          // what the screen sends: a square JPEG
  await page.reload();                                                                 // and it is still there
  await expect(page.getByTestId("user-photo")).toHaveCount(2);
  await expect.poll(() => page.getByTestId("user-photo").evaluateAll((els) => els.every((e) => e.complete && e.naturalWidth > 0))).toBe(true);

  // opening it again shows the saved photo in the same window, unchanged: nothing to save until something is moved
  await page.getByTestId("photo-open").click();
  const again = page.getByTestId("photo-dialog");
  await expect(again.getByTestId("photo-crop")).toBeVisible();
  await expect(again.getByTestId("photo-save")).toBeDisabled();
  await expect(again.getByTestId("photo-revert")).toBeDisabled();
  await expect(again.getByTestId("photo-cancel")).toHaveText("Close");
  await again.getByTestId("photo-zoom").fill("2.5");                                    // alter it as if new
  await expect(again.getByTestId("photo-save")).toBeEnabled();
  await expect(again.getByTestId("photo-cancel")).toHaveText("Cancel");
  await again.getByTestId("photo-revert").click();                                      // undo: back to how it opened
  await expect(again.getByTestId("photo-zoom")).toHaveValue("1");
  await expect(again.getByTestId("photo-save")).toBeDisabled();
  await again.getByTestId("photo-file").setInputFiles({ name: "other.png", mimeType: "image/png", buffer: RED_PNG });
  await expect(again.getByTestId("photo-save")).toBeEnabled();                          // a different photo is a change
  await again.getByTestId("photo-revert").click();                                      // reverting a replacement returns to the saved photo
  await expect(again.getByTestId("photo-save")).toBeDisabled();
  await expect(again.getByTestId("photo-crop")).toBeVisible();
  await again.getByTestId("photo-remove").click();
  await expect(page.getByText("Your initials show instead")).toBeVisible();
  await page.getByTestId("photo-remove-yes").click();
  await expect(page.getByTestId("user-photo")).toHaveCount(0);
  expect((await fresh.api.get("/api/auth/me/photo")).status()).toBe(404);
});

test("the profile says at a glance who you are and how the account is protected", async ({ freshUserPage: { page } }) => {
  await page.goto("/profile");
  const facts = page.getByRole("list", { name: "About this account" });
  await expect(facts).toContainText("Email verified");
  await expect(facts).toContainText("Two-step sign-in off");
  await expect(facts).toContainText(/Member since/);
});
