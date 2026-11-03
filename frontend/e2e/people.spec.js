import { test, expect } from "./fixtures";
import { audit, prepare } from "./support/a11y";

// The People tab as a person uses it: two separate balances per person, debts entered by hand, payments, clearing, undo, and deleting
// (archiving) with the bar at the top. Runs on the scratch account (John); every person here has a unique name.
const uniqueName = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function createPerson(apiContext, name, extra = {}) {
  const r = await apiContext.post("/api/people", { data: { name, ...extra } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).id;
}
async function addDebt(apiContext, id, direction, amount) {
  const r = await apiContext.post(`/api/debts/people/${id}/adjust/add`, { data: { direction, amount } });
  expect(r.ok(), await r.text()).toBeTruthy();
}
const overlap = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

test.describe("People tab", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto("/people");
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  });

  test("add, edit and search a person; the overview and the directory are there", async ({ authenticatedPage: page }) => {
    const name = uniqueName();
    await expect(page.getByTestId("people-they-owe")).toBeVisible();
    await expect(page.getByTestId("people-i-owe")).toBeVisible();
    await page.getByTestId("add-person-btn").click();
    await expect(page.getByRole("dialog")).toContainText("Add person");
    await page.getByTestId("person-name-input").fill(name);
    await page.getByTestId("person-pref-input").fill("Revolut");
    await page.getByTestId("person-notes-input").fill("Created by Playwright");
    await page.getByTestId("person-form-save").click();
    await expect(page.getByTestId("person-name").filter({ hasText: name })).toBeVisible();

    await page.getByTestId("people-search").fill(name);
    await expect(page.getByTestId(/^person-card-/)).toHaveCount(1);
    const personId = (await page.getByTestId(/^person-card-/).first().getAttribute("data-testid")).replace("person-card-", "");
    await expect(page.getByTestId(`person-card-${personId}`)).toContainText("Settled");

    await page.getByTestId(`person-edit-${personId}`).click();
    await expect(page.getByRole("dialog")).toContainText("Edit person");
    await page.getByTestId("person-name-input").fill(`${name}-edited`);
    await page.getByTestId("person-form-save").click();
    await expect(page.getByTestId("person-name").filter({ hasText: `${name}-edited` })).toBeVisible();
    await page.getByTestId("people-search").fill("zzzz-no-one");
    await expect(page.getByText("No one matches")).toBeVisible();
  });

  test("deleting asks in a bar at the top that names the person and covers nothing; cancelling keeps them; confirming archives them, restorable", async ({ authenticatedPage: page, apiContext }) => {
    const name = uniqueName();
    const id = await createPerson(apiContext, name);
    await addDebt(apiContext, id, "they_owe", 30);
    await page.reload();
    await page.getByTestId("people-search").fill(name);
    await page.getByTestId(`person-delete-${id}`).click();

    const bar = page.getByTestId("delete-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("delete-bar-text")).toContainText(name);
    await expect(bar).toContainText("owes you €30.00");
    await expect(bar).toContainText("no payment is recorded");
    // it sits in the flow, centred near the top: the directory starts below it and nothing is under it
    const box = await bar.boundingBox();
    const list = await page.getByTestId("people-list").boundingBox();
    expect(box.y + box.height, "the bar does not cover the directory").toBeLessThanOrEqual(list.y + 1);
    const viewport = page.viewportSize();
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2) < viewport.width * 0.3, "centred").toBeTruthy();
    await expect(page.getByTestId("delete-confirm")).toHaveCSS("background-color", /rgb\(185, 28, 28\)/);

    await page.getByTestId("delete-cancel").click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId(`person-card-${id}`)).toBeVisible();

    await page.getByTestId(`person-delete-${id}`).click();
    await page.getByTestId("delete-confirm").click();
    await expect(page.getByTestId(`person-card-${id}`)).toHaveCount(0);
    await page.getByTestId("people-archived-toggle").click();
    await expect(page.getByTestId(`person-card-${id}`)).toBeVisible();
    await expect(page.getByTestId(`person-card-${id}`)).toContainText("Settled");     // cleared as part of deleting
    await page.getByTestId(`person-restore-${id}`).click();
    await page.getByTestId("people-archived-toggle").click();
    await expect(page.getByTestId(`person-card-${id}`)).toBeVisible();
  });

  test("asked from far down a long list the delete bar is brought into view with Cancel focused; a payment starts on the favourite account", async ({ authenticatedPage: page, apiContext }) => {
    const prefix = uniqueName();
    let lastId;
    for (let i = 0; i < 14; i += 1) lastId = await createPerson(apiContext, `${prefix}-${String(i).padStart(2, "0")}`);
    await page.reload();
    await page.getByTestId("people-search").fill(prefix);
    await page.getByTestId("people-sort").click();
    await page.getByRole("option", { name: "Name Z-A" }).click();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByTestId(`person-delete-${lastId}`).click();
    const bar = page.getByTestId("delete-bar");
    await expect(bar).toBeVisible();
    await expect.poll(async () => { const b = await bar.boundingBox(); return b && b.y >= 0 && b.y + b.height <= page.viewportSize().height; }, { message: "the bar is inside the window" }).toBe(true);
    await expect(page.getByTestId("delete-cancel")).toBeFocused();
    await page.getByTestId("delete-cancel").click();

    await page.getByTestId(`person-payment-${lastId}`).click();
    await expect(page.getByTestId("debt-account")).toContainText("›");     // "Main account › Place": the favourite, not an empty box
  });

  test("two balances stay apart; add, reduce, correct, pay, clear and restore from the profile", async ({ authenticatedPage: page, apiContext }) => {
    const name = uniqueName();
    const id = await createPerson(apiContext, name);
    await page.reload();
    await page.getByTestId("people-search").fill(name);
    await page.getByTestId(`person-open-${id}`).click();
    const profile = page.getByTestId("person-profile");
    await expect(profile).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/people/${id}`));

    // they owe me €100, I owe them €20: two figures, never one
    await profile.getByTestId("act-add-they_owe").click();
    await page.getByTestId("debt-amount").fill("100");
    await page.getByTestId("debt-submit").click();
    await expect(profile.getByTestId("balance-they_owe-amount")).toHaveText("€100.00");
    await profile.getByTestId("act-add-i_owe").click();
    await page.getByTestId("debt-amount").fill("20");
    await page.getByTestId("debt-note").fill("lunch");
    await page.getByTestId("debt-submit").click();
    await expect(profile.getByTestId("balance-i_owe-amount")).toHaveText("€20.00");
    await expect(profile.getByTestId("balance-they_owe-amount")).toHaveText("€100.00");

    await profile.getByTestId("act-reduce-they_owe").click();
    await page.getByTestId("debt-amount").fill("30");
    await page.getByTestId("debt-submit").click();
    await expect(profile.getByTestId("balance-they_owe-amount")).toHaveText("€70.00");
    await profile.getByTestId("act-correct-they_owe").click();
    await page.getByTestId("debt-amount").fill("65");
    await page.getByTestId("debt-submit").click();
    await expect(profile.getByTestId("balance-they_owe-amount")).toHaveText("€65.00");
    const kinds = await profile.getByTestId("history-row").allInnerTexts();
    expect(kinds.join("\n")).toMatch(/Debt added[\s\S]*Debt reduced[\s\S]*Balance corrected|Balance corrected[\s\S]*Debt reduced[\s\S]*Debt added/);

    // a payment lowers only the debt it settles
    await profile.getByTestId("act-payment-they_owe").click();
    await page.getByTestId("debt-account").click();
    await page.getByRole("option", { name: "Don't record in my accounts" }).click();
    await page.getByTestId("debt-amount").fill("15");
    await page.getByTestId("debt-submit").click();
    await expect(profile.getByTestId("balance-they_owe-amount")).toHaveText("€50.00");
    await expect(profile.getByTestId("balance-i_owe-amount")).toHaveText("€20.00");
    await expect(profile.getByTestId("history-list")).toContainText("Payment received");

    // clearing: a confirmation step, no payment, gone from the history, kept in the cleared items, restorable
    await profile.getByTestId("act-clear-they_owe").click();
    await expect(page.getByTestId("debt-dialog")).toContainText("without a payment");
    await page.getByTestId("debt-submit").click();
    await expect(profile.getByTestId("balance-they_owe-amount")).toHaveText("€0.00");
    await expect(profile.getByTestId("history-list")).not.toContainText("Payment received");
    await profile.getByTestId("toggle-cleared").click();
    await expect(profile.getByTestId("audit-list")).toContainText("Cleared");
    await profile.getByTestId("row-restore").first().click();
    await expect(profile.getByTestId("balance-they_owe-amount")).toHaveText("€50.00");
  });

  test("a payment larger than the debt asks what the extra is, in two clear choices, and records nothing until told", async ({ authenticatedPage: page, apiContext }) => {
    const name = uniqueName();
    const id = await createPerson(apiContext, name);
    await addDebt(apiContext, id, "they_owe", 20);
    await page.goto(`/people/${id}`);
    const profile = page.getByTestId("person-profile");
    await profile.getByTestId("act-payment-they_owe").click();
    await page.getByTestId("debt-account").click();
    await page.getByRole("option", { name: "Don't record in my accounts" }).click();
    await page.getByTestId("debt-amount").fill("30");
    await page.getByTestId("debt-submit").click();
    await expect(page.getByTestId("debt-excess")).toContainText("€10.00 more than is owed");
    await expect(profile.getByTestId("balance-they_owe-amount")).toHaveText("€20.00");           // nothing recorded yet
    await page.getByTestId("debt-excess-opposite").click();
    await expect(profile.getByTestId("balance-they_owe-amount")).toHaveText("€0.00");
    await expect(profile.getByTestId("balance-i_owe-amount")).toHaveText("€10.00");
  });

  test("the profile's close button never touches the name or the amounts, on a phone as on a desktop", async ({ authenticatedPage: page, apiContext }) => {
    const name = `${uniqueName()}-a-rather-long-name-for-a-person`;
    const id = await createPerson(apiContext, name);
    await addDebt(apiContext, id, "they_owe", 1234567.89);
    await addDebt(apiContext, id, "i_owe", 9876543.21);
    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await page.goto(`/people/${id}`);
      const profile = page.getByTestId("person-profile");
      await expect(profile.getByTestId("balance-they_owe-amount")).toContainText("1,234,567.89");
      const close = await profile.getByRole("button", { name: "Close" }).boundingBox();
      for (const target of [profile.getByTestId("profile-name"), profile.getByTestId("balance-they_owe-amount"), profile.getByTestId("balance-i_owe-amount"), profile.getByTestId("profile-edit")]) {
        const b = await target.boundingBox();
        expect(overlap(close, b), `close button overlaps ${await target.getAttribute("data-testid")} at ${size.width}px`).toBe(false);
      }
      const sideways = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dialog: (document.querySelector("[role=dialog]") || {}).scrollWidth - (document.querySelector("[role=dialog]") || {}).clientWidth }));
      expect(sideways.page).toBeLessThanOrEqual(0);
      expect(sideways.dialog).toBeLessThanOrEqual(1);
    }
  });

  test("keyboard: the directory, the dialogs and the delete bar work without a mouse; the page passes the accessibility audit", async ({ authenticatedPage: page, apiContext }) => {
    const name = uniqueName();
    const id = await createPerson(apiContext, name);
    await addDebt(apiContext, id, "they_owe", 12);
    await page.reload();
    await page.getByTestId("people-search").fill(name);
    await expect(page.getByTestId(`person-card-${id}`)).toHaveCSS("opacity", "1");
    await page.waitForTimeout(300);
    await audit(page, "people directory");
    await page.getByTestId(`person-open-${id}`).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("person-profile")).toBeVisible();
    await page.waitForTimeout(500);
    await audit(page, "person profile");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("person-profile")).toHaveCount(0);
    await page.getByTestId(`person-add-debt-${id}`).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("debt-dialog")).toBeVisible();
    await expect(page.getByTestId("debt-amount")).toBeFocused();
    await page.keyboard.press("Escape");
    await page.getByTestId(`person-delete-${id}`).focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await audit(page, "delete bar");
    await page.keyboard.press("Tab");
    await page.getByTestId("delete-cancel").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("delete-bar")).toHaveCount(0);
  });

  test("on a phone in the dark theme the directory and a profile fit and pass the audit", async ({ authenticatedPage: page, apiContext }) => {
    const id = await createPerson(apiContext, uniqueName());
    await addDebt(apiContext, id, "they_owe", 40);
    await addDebt(apiContext, id, "i_owe", 5);
    await prepare(page, "dark", { width: 390, height: 844 });
    await page.goto("/people");
    await expect(page.getByTestId(`person-card-${id}`)).toHaveCSS("opacity", "1");   // rows fade in: audit them once settled
    await page.waitForTimeout(300);
    await audit(page, "people, dark phone");
    await page.goto(`/people/${id}`);
    await expect(page.getByTestId("person-profile")).toBeVisible();
    await page.waitForTimeout(600);
    await audit(page, "profile, dark phone");
  });
});
