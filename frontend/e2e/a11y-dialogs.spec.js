import { test, expect } from "./fixtures";
import { audit, prepare, settle, THEMES, WIDTHS } from "./support/a11y";

// D-01 / D-03 sweep for the dialogs the page-level audit does not open: Money (transfer, budgets, a place) and People (add a person,
// add a debt, record a payment). Every one is audited at desktop/tablet/phone widths in both themes, and must close with Escape.
test.describe.configure({ timeout: 300_000 });

for (const theme of THEMES) {
  for (const [size, viewport] of WIDTHS) {
    test(`money and people dialogs, ${theme}, ${size}`, async ({ authenticatedPage: page, apiContext }) => {
      await prepare(page, theme, viewport);
      const open = async (url, steps, dialog, label) => {
        await page.goto(url);
        await settle(page);
        for (const step of steps) await step(page);
        await expect(dialog(page)).toBeVisible();
        await page.waitForTimeout(500);
        await audit(page, `${label}, ${theme}, ${size}`);
        await page.keyboard.press("Escape");
        await expect(dialog(page)).toBeHidden();
      };
      const dlg = (p) => p.getByRole("dialog");
      await open("/money", [(p) => p.getByRole("button", { name: "Transfer", exact: true }).click()], dlg, "money transfer");
      await open("/money", [(p) => p.getByRole("button", { name: "Budgets", exact: true }).click()], dlg, "money budgets");
      await open("/money", [(p) => p.getByTestId("recurring-add").click()], (p) => p.getByTestId("recurring-dialog"), "money recurring");
      await open("/money", [(p) => p.getByRole("button", { name: "Add sub-place" }).first().click()], (p) => p.getByTestId("account-dialog"), "money add place");
      await open("/people", [(p) => p.getByTestId("add-person-btn").click()], dlg, "people add person");
      const people = await (await apiContext.get("/api/people")).json();
      await open("/people", [(p) => p.getByTestId(`person-add-debt-${people[0].id}`).click()], (p) => p.getByTestId("debt-dialog"), "people add debt");
      await open("/people", [(p) => p.getByTestId(`person-payment-${people[0].id}`).click()], (p) => p.getByTestId("debt-dialog"), "people payment");
    });
  }
}
