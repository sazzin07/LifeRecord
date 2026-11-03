import { test, expect } from "./fixtures";
import { audit, prepare, settle, THEMES, WIDTHS } from "./support/a11y";

// D-01: axe-core on every signed-in page and its main dialogs, at desktop/tablet/phone widths in both themes, as the
// standard test account (John, who has data on every page). Nutrition has its own spec (nutrition-a11y.spec.js); new
// accounts with no data are covered by a11y-empty-states.spec.js, public pages by a11y-public.spec.js.

const PAGES = [["home", "/"], ["money", "/money"], ["people", "/people"], ["fitness", "/fitness"], ["body", "/body"], ["tasks", "/tasks"],
  ["calendar", "/calendar"], ["settings", "/settings"], ["settings money", "/settings?section=money"], ["settings calendar", "/settings?section=calendar"],
  ["settings assistant", "/settings?section=assistant"], ["settings device", "/settings?section=device"], ["profile", "/profile"]];
// An audit visits many pages (and, for the grocery catalog, ~500 cards), so it gets more than the default 30 seconds.
test.describe.configure({ timeout: 300_000 });

const GROCERY_TABS = ["Overview", "Storage", "Shopping", "Catalog", "Kitchen"];

for (const theme of THEMES) {
  for (const [size, viewport] of WIDTHS) {
    test.describe(`${theme} theme, ${size}`, () => {
      test.beforeEach(async ({ authenticatedPage: page }) => { await prepare(page, theme, viewport); });

      test("pages", async ({ authenticatedPage: page }) => {
        for (const [name, path] of PAGES) {
          await page.goto(path);
          await settle(page);
          await audit(page, `${name}, ${theme}, ${size}`);
        }
        await page.goto("/calendar");
        await page.getByTestId("calendar-view-week").click();
        await settle(page);
        await audit(page, `calendar week, ${theme}, ${size}`);
      });

      test("person detail and groceries tabs", async ({ authenticatedPage: page, apiContext }) => {
        const people = await (await apiContext.get("/api/people")).json();
        await page.goto(`/people/${people[0].id}`);
        await settle(page);
        await audit(page, `person detail, ${theme}, ${size}`);
        await page.goto("/groceries");
        for (const tab of GROCERY_TABS) {
          await page.getByRole("tab", { name: tab }).click();
          await settle(page);
          await audit(page, `groceries ${tab}, ${theme}, ${size}`, { longList: tab === "Catalog" });
        }
      });

      test("dialogs and panels", async ({ authenticatedPage: page }) => {
        const open = async (url, steps, dialog, label) => {
          await page.goto(url);
          await settle(page);
          for (const click of steps) await click(page);
          await expect(dialog(page)).toBeVisible();
          await page.waitForTimeout(500);
          await audit(page, `${label}, ${theme}, ${size}`);
          await page.keyboard.press("Escape");
          await expect(dialog(page)).toBeHidden();
        };
        const byId = (id) => (p) => p.getByTestId(id);
        const tap = (id) => (p) => p.getByTestId(id).click();
        // The top bar's "Add" exists from the sm breakpoint up; on a phone the round "+" in the bottom bar does the same job.
        const quickAdd = viewport.width < 640 ? "mobile-quick-add" : "quick-add-trigger";
        await open("/money", [tap(quickAdd)], byId("quick-add-dialog"), "quick add");
        await open("/money", [tap(quickAdd), tap("qa-expense")], byId("expense-dialog"), "add expense");
        await open("/settings?section=money", [tap("settings-add-place")], (p) => p.getByRole("dialog"), "add place");
        await open("/profile", [tap("your-data-delete-open")], byId("delete-account-dialog"), "delete account");
        await open("/profile", [tap("your-data-deactivate-open")], byId("deactivate-account-dialog"), "deactivate account");
        await open("/", [tap("command-bar-trigger")], (p) => p.getByRole("dialog"), "search and commands");
        await open("/", [tap("ai-fab")], byId("ai-panel"), "assistant");
      });
    });
  }
}
