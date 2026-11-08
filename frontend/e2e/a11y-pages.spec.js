import { test, expect } from "./fixtures";
import { openQuickAdd, openAssistant } from "./support/dock";
import { audit, prepare, settle, THEMES, WIDTHS } from "./support/a11y";
import { openCatalog, openGroceriesTab } from "./support/groceries";

// D-01: axe-core on every signed-in page and its main dialogs, at desktop/tablet/phone widths in both themes, as the
// standard test account (John, who has data on every page). Nutrition has its own spec (nutrition-a11y.spec.js); new
// accounts with no data are covered by a11y-empty-states.spec.js, public pages by a11y-public.spec.js.

const PAGES = [["home", "/"], ["money", "/money"], ["people", "/people"], ["fitness", "/fitness"], ["body", "/body"], ["tasks", "/tasks"],
  ["calendar", "/calendar"], ["settings", "/settings"], ["settings money", "/settings?section=money"], ["settings calendar", "/settings?section=calendar"],
  ["settings device", "/settings?section=device"], ["profile", "/profile"]];
// An audit visits many pages (and, for the grocery catalog, ~500 cards), so it gets more than the default 30 seconds.
test.describe.configure({ timeout: 300_000 });

const GROCERY_TABS = ["Today", "Storage", "Shopping", "Kitchen"];

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
        // The Storage tab draws a 3D room; with reduced motion it only redraws when something moves, which keeps a software-rendered browser responsive.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/groceries");
        for (const tab of GROCERY_TABS) {
          await openGroceriesTab(page, tab);
          await settle(page);
          await audit(page, `groceries ${tab}, ${theme}, ${size}`);
        }
        // The catalog is a dialog over the page
        await openCatalog(page);
        await expect(page.getByRole("dialog", { name: "Catalog" })).toBeVisible();
        await settle(page);
        await audit(page, `groceries Catalog, ${theme}, ${size}`, { longList: true });
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
        const quickAdd = "quick-add-trigger";   // the round "+" floating at the bottom-right, on every screen size
        await open("/money", [(p) => openQuickAdd(p)], byId("quick-add-dialog"), "quick add");
        await open("/money", [(p) => openQuickAdd(p), tap("qa-expense")], byId("expense-dialog"), "add expense");
        await open("/settings?section=money", [tap("settings-add-place")], (p) => p.getByRole("dialog"), "add place");
        await open("/profile", [tap("photo-open")], byId("photo-dialog"), "profile photo");
        await open("/profile", [tap("your-data-delete-open")], byId("delete-account-dialog"), "delete account");
        await open("/profile", [tap("your-data-deactivate-open")], byId("deactivate-account-dialog"), "deactivate account");
        await open("/", [(p) => p.keyboard.press("Control+K")], (p) => p.getByRole("dialog"), "command palette");
        await open("/", [(p) => openAssistant(p)], byId("ai-panel"), "assistant");
      });
    });
  }
}
