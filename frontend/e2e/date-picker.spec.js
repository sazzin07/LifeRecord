import { test, expect } from "./fixtures";
import { prepare, settle } from "./support/a11y";

// The redesigned date picker (components/ui/calendar.jsx, date-picker.jsx), driven from the Nutrition day control.
test.describe.configure({ timeout: 90_000 });

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

test.describe("The date picker", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await page.goto("/nutrition");
    await settle(page);
  });

  const open = async (page) => { await page.getByRole("button", { name: /^Day:/ }).click(); await expect(page.getByTestId("calendar")).toBeVisible(); };

  test("it opens with the month on show, marks today and the chosen day, and shows one weekday header per column", async ({ authenticatedPage: page }) => {
    const now = new Date();
    await open(page);
    await expect(page.getByTestId("calendar-heading")).toHaveText(`${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
    await expect(page.getByRole("columnheader")).toHaveCount(7);
    await expect(page.getByTestId(`day-${isoOf(now.getFullYear(), now.getMonth(), now.getDate())}`)).toHaveAttribute("aria-current", "date");
    await expect(page.getByRole("gridcell", { selected: true })).toHaveCount(1);
    // only this month's days are drawn: no greyed days from the neighbours
    const days = await page.locator('[data-testid^="day-20"]').count();
    expect(days).toBe(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
  });

  test("the arrows move by month, the heading opens a month grid, and choosing a month returns to its days", async ({ authenticatedPage: page }) => {
    const now = new Date();
    await open(page);
    await page.getByRole("button", { name: "Next month" }).click();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await expect(page.getByTestId("calendar-heading")).toHaveText(`${MONTHS[next.getMonth()]} ${next.getFullYear()}`);
    await page.getByRole("button", { name: "Previous month" }).click();
    await page.getByRole("button", { name: "Previous month" }).click();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    await expect(page.getByTestId("calendar-heading")).toHaveText(`${MONTHS[prev.getMonth()]} ${prev.getFullYear()}`);

    await page.getByTestId("calendar-heading").click();
    await expect(page.getByTestId("calendar-heading")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/ })).toHaveCount(12);
    await page.getByRole("button", { name: "Next year" }).click();
    await expect(page.getByTestId("calendar-heading")).toHaveText(String(prev.getFullYear() + 1));
    await page.getByRole("button", { name: `March ${prev.getFullYear() + 1}` }).click();
    await expect(page.getByTestId("calendar-heading")).toHaveText(`March ${prev.getFullYear() + 1}`);
    await expect(page.getByTestId(`day-${isoOf(prev.getFullYear() + 1, 2, 10)}`)).toBeVisible();
  });

  test("a click on a day changes the day on the page, settles, and closes the picker; Today comes back", async ({ authenticatedPage: page }) => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() - 1, 14);
    await open(page);
    await page.getByRole("button", { name: "Previous month" }).click();
    await page.getByTestId(`day-${isoOf(target.getFullYear(), target.getMonth(), 14)}`).click();
    await expect(page.getByTestId("calendar")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`date=${isoOf(target.getFullYear(), target.getMonth(), 14)}`));
    await expect(page.getByTestId("day-label")).toBeVisible();
    // reopened, the chosen day is the selected one and the month is its month
    await open(page);
    await expect(page.getByTestId(`day-${isoOf(target.getFullYear(), target.getMonth(), 14)}`)).toHaveAttribute("aria-label", /14/);
    await expect(page.getByRole("gridcell", { selected: true })).toHaveCount(1);
    await page.getByTestId("calendar-today").click();
    await expect(page.getByTestId("calendar")).toHaveCount(0);
    await expect(page).not.toHaveURL(/date=/);
  });

  test("the keyboard works: focus starts on the chosen day, arrows and Page Down move it, Enter chooses, Escape closes and gives focus back", async ({ authenticatedPage: page }) => {
    const now = new Date();
    await open(page);
    const today = page.getByTestId(`day-${isoOf(now.getFullYear(), now.getMonth(), now.getDate())}`);
    await expect(today).toBeFocused();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId(`day-${isoOf(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate())}`)).toBeFocused();
    await page.keyboard.press("PageDown");
    const later = new Date(tomorrow.getFullYear(), tomorrow.getMonth() + 1, Math.min(tomorrow.getDate(), new Date(tomorrow.getFullYear(), tomorrow.getMonth() + 2, 0).getDate()));
    await expect(page.getByTestId("calendar-heading")).toHaveText(`${MONTHS[later.getMonth()]} ${later.getFullYear()}`);
    await expect(page.getByTestId(`day-${isoOf(later.getFullYear(), later.getMonth(), later.getDate())}`)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`date=${isoOf(later.getFullYear(), later.getMonth(), later.getDate())}`));
    await expect(page.getByTestId("calendar")).toHaveCount(0);
    await open(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("calendar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Day:/ })).toBeFocused();
  });

  test("on a phone it fits the screen", async ({ authenticatedPage: page }) => {
    await prepare(page, "dark", { width: 390, height: 844 });
    await page.goto("/nutrition");
    await settle(page);
    await page.getByRole("button", { name: /^Day:/ }).click();
    const box = await page.getByTestId("date-popover").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
