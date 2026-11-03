import { test, expect } from "./fixtures";

// Settings the account keeps. Each test has an account of its own: the shared owner account never syncs its look in this suite.
test.use({ viewport: { width: 1440, height: 900 } });

const html = (page) => page.locator("html");
const prefs = async (fresh) => (await fresh.api.get("/api/preferences")).json();

test("the theme applies at once, is saved to the account, and follows the person to a browser that has never seen it", async ({ freshUserPage: { page, fresh } }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("theme-system")).toHaveAttribute("aria-checked", "true");   // a new account starts on the device choice
  await page.getByTestId("theme-dark").click();
  await expect(html(page)).toHaveClass(/dark/);
  await expect(page.getByTestId("settings-saved").first()).toBeVisible();
  await expect.poll(async () => (await prefs(fresh)).preferences.theme).toBe("dark");
  expect((await prefs(fresh)).saved).toBe(true);

  // another device: nothing remembered locally, so what the account saved is what shows
  await page.evaluate(() => { localStorage.removeItem("lm_theme"); localStorage.removeItem("lm_sync"); });
  await page.reload();
  await expect(html(page)).toHaveClass(/dark/);
  await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");
});

test("turning sync off keeps this device its own look, and the account keeps its own", async ({ freshUserPage: { page, fresh } }) => {
  await page.goto("/settings");
  await page.getByTestId("theme-dark").click();
  await expect.poll(async () => (await prefs(fresh)).preferences.theme).toBe("dark");
  await page.getByTestId("settings-tab-device").click();
  await page.getByTestId("sync-toggle").click();                       // this device now keeps its own choices
  await page.getByTestId("settings-tab-appearance").click();
  await page.getByTestId("theme-light").click();
  await expect(html(page)).not.toHaveClass(/dark/);
  await page.waitForTimeout(800);
  expect((await prefs(fresh)).preferences.theme).toBe("dark");          // not sent to the account
  await page.goto("/settings?section=device");
  await expect(html(page)).not.toHaveClass(/dark/);                     // and the dark of the account does not override it
  await page.getByTestId("sync-toggle").click();                       // sync back on: the choice of the account returns
  await expect(html(page)).toHaveClass(/dark/);
});

test("animations, the first day of the week and what Money opens on each do what they say", async ({ freshUserPage: { page, fresh } }) => {
  await page.goto("/settings");
  await page.getByTestId("anim-toggle").click();
  await expect(html(page)).toHaveClass(/no-anim/);
  await page.getByTestId("anim-toggle").click();
  await expect(html(page)).not.toHaveClass(/no-anim/);

  await page.getByTestId("settings-tab-calendar").click();
  await page.getByTestId("week-start-sunday").click();
  await page.getByTestId("settings-tab-money").click();
  await page.getByTestId("money-period-day").click();
  await expect.poll(async () => (await prefs(fresh)).preferences).toMatchObject({ week_start: "sunday", money_period: "day" });

  await page.goto("/calendar");
  const firstHeader = page.getByTestId("calendar-month").locator("div.grid").first().locator("div").first();
  await expect(firstHeader).toHaveText("Sun");

  await page.goto("/money");
  await expect(page.getByTestId("period-day")).toHaveAttribute("aria-pressed", "true");
});

test("the side menu choice belongs to this device: a thin strip or always open", async ({ freshUserPage: { page, fresh } }) => {
  await page.goto("/settings?section=device");
  const bar = page.getByTestId("sidebar");
  await expect(bar).toHaveAttribute("data-expanded", "true");           // the fixture starts it pinned open
  await page.getByTestId("side-menu-auto").click();
  await page.mouse.move(900, 500);
  await expect(bar).toHaveAttribute("data-expanded", "false");
  await page.getByTestId("side-menu-open").click();
  await expect(bar).toHaveAttribute("data-expanded", "true");
  expect(Object.keys((await prefs(fresh)).preferences)).not.toContain("side_menu");   // never sent to the account
});

test("categories: add with a budget, rename, refuse a duplicate, and delete with a warning", async ({ freshUserPage: { page } }) => {
  await page.goto("/settings?section=money");
  await page.getByTestId("category-input").fill("Coffee");
  await page.getByTestId("category-budget-input").fill("30");
  await page.getByTestId("category-add").click();
  await expect(page.getByTestId("category-Coffee")).toContainText("€30.00 / month");

  await page.getByTestId("category-input").fill("coffee");
  await page.getByTestId("category-add").click();                       // the same name in another case
  await expect(page.getByText(/already have a category called/i)).toBeVisible();

  await page.getByRole("button", { name: "Edit Coffee category" }).click();
  await page.getByTestId("category-edit-name").fill("Espresso");
  await page.getByTestId("category-edit-budget").fill("");
  await page.getByTestId("category-edit-save").click();
  await expect(page.getByTestId("category-Espresso")).toContainText("No budget");
  await expect(page.getByTestId("category-Coffee")).toHaveCount(0);

  await page.getByRole("button", { name: "Delete Espresso category" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Past transactions keep the name");
  await dialog.getByRole("button", { name: "Delete category" }).click();
  await expect(page.getByTestId("category-Espresso")).toHaveCount(0);
});

test("reset puts the look and display choices back after a warning", async ({ freshUserPage: { page, fresh } }) => {
  await page.goto("/settings");
  await page.getByTestId("theme-dark").click();
  await page.getByTestId("settings-tab-calendar").click();
  await page.getByTestId("week-start-sunday").click();
  await expect.poll(async () => (await prefs(fresh)).preferences).toMatchObject({ theme: "dark", week_start: "sunday" });
  await page.getByTestId("settings-tab-device").click();
  await page.getByTestId("settings-reset").click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Nothing you recorded changes");
  await dialog.getByRole("button", { name: "Reset" }).click();
  await expect.poll(async () => (await prefs(fresh)).preferences).toMatchObject({ theme: "system", week_start: "monday", animations: true, money_period: "week" });
  await page.getByTestId("settings-tab-calendar").click();
  await expect(page.getByTestId("week-start-monday")).toHaveAttribute("aria-checked", "true");
});

test("every tab opens its own page of settings, by click, by keyboard and by address", async ({ freshUserPage: { page } }) => {
  await page.goto("/settings");
  const expectations = { appearance: "theme-dark", money: "settings-add-place", calendar: "week-start-sunday", nutrition: "settings-nutrition-link", assistant: "assistant-example", device: "side-menu-auto" };
  for (const [tab, marker] of Object.entries(expectations)) {
    await page.getByTestId(`settings-tab-${tab}`).click();
    await expect(page.getByTestId(`settings-tab-${tab}`)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId(marker).first()).toBeVisible();
    await expect(page).toHaveURL(tab === "appearance" ? /\/settings$/ : new RegExp(`section=${tab}`));
  }
  await page.getByTestId("settings-tab-appearance").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("settings-tab-money")).toHaveAttribute("aria-selected", "true");
  await page.goto("/settings?section=device");                              // a link lands on the tab
  await expect(page.getByTestId("side-menu-auto")).toBeVisible();
  await page.goto("/settings?section=nutrition");
  await page.getByTestId("settings-nutrition-link").click();
  await expect(page).toHaveURL(/\/nutrition\?tab=goals/);
});

test("the assistant examples open the assistant with the sentence ready, and the side menu never scrolls sideways", async ({ freshUserPage: { page } }) => {
  await page.goto("/settings?section=assistant");
  await page.getByTestId("assistant-example").first().click();
  await expect(page.locator("textarea").first()).toHaveValue(/dark mode/i);
  await page.keyboard.press("Escape");
  const sideways = await page.getByTestId("sidebar").locator("nav").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sideways).toBeLessThanOrEqual(0);
});
