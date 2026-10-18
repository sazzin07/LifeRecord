import { test, expect } from "./fixtures";

const uniqueName = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.describe("People tab", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto("/people");
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  });

  test("add, edit, search and delete a person", async ({ authenticatedPage: page }) => {
    const name = uniqueName();

    // Add person
    await page.getByTestId("add-person-btn").click();
    await expect(page.getByRole("dialog")).toContainText("Add person");
    await page.getByTestId("person-name-input").fill(name);
    await page.getByTestId("person-payment-input").fill("Revolut");
    await page.getByTestId("person-notes-input").fill("Created by Playwright");
    await page.getByTestId("person-form-save").click();
    await expect(page.getByText(name)).toBeVisible();

    // Search finds the person
    await page.getByTestId("people-search").fill(name);
    await expect(page.getByTestId(/^person-card-/)).toHaveCount(1);

    // Edit person
    const card = page.getByTestId(/^person-card-/).first();
    const personId = (await card.getAttribute("data-testid")).replace("person-card-", "");
    await page.getByTestId(`person-edit-${personId}`).click();
    await expect(page.getByRole("dialog")).toContainText("Edit person");
    const newName = `${name}-edited`;
    await page.getByTestId("person-name-input").fill(newName);
    await page.getByTestId("person-form-save").click();
    await expect(page.getByText(newName)).toBeVisible();

    // Delete person
    page.on("dialog", async (dialog) => await dialog.accept());
    await page.getByTestId(`person-delete-${personId}`).click();
    await expect(page.getByText(newName)).not.toBeVisible();
  });

  test("bulk delete people", async ({ authenticatedPage: page }) => {
    const names = [uniqueName(), uniqueName()];

    for (const name of names) {
      await page.getByTestId("add-person-btn").click();
      await page.getByTestId("person-name-input").fill(name);
      await page.getByTestId("person-form-save").click();
      await expect(page.getByText(name)).toBeVisible();
    }

    // Select all visible (should include our two new people)
    await page.getByTestId("people-search").fill("E2E-");
    await page.getByTestId("select-all").click();
    await expect(page.getByTestId("bulk-delete-bar")).toBeVisible();

    const countText = await page.getByTestId("selected-count").textContent();
    const count = parseInt(countText, 10);
    expect(count).toBeGreaterThanOrEqual(2);

    await page.getByTestId("bulk-delete-btn").click();
    await page.getByTestId("bulk-delete-confirm").click();

    for (const name of names) {
      await expect(page.getByText(name)).not.toBeVisible();
    }
  });

  test("person detail and record payment", async ({ authenticatedPage: page, apiContext }) => {
    const name = uniqueName();

    await page.getByTestId("add-person-btn").click();
    await page.getByTestId("person-name-input").fill(name);
    await page.getByTestId("person-form-save").click();
    await expect(page.getByText(name)).toBeVisible();

    // Create an expense via API so the person owes money.
    const personRes = await apiContext.get("/api/people");
    const people = await personRes.json();
    const person = people.find((p) => p.name === name);
    expect(person).toBeTruthy();

    await apiContext.post("/api/transactions/expense", {
      data: {
        amount: 20,
        description: "Test dinner",
        category: "Food",
        account: "revolut",
        merchant: "Test Restaurant",
        participants: ["Me", name],
        paid_by: "Me",
      },
    });

    await page.reload();
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

    const card = page.getByTestId(/^person-card-/).filter({ hasText: name });
    await expect(card).toContainText("+€10");
    await card.click();

    await expect(page.getByRole("dialog")).toContainText(name);
    await expect(page.getByTestId("detail-edit-btn")).toBeVisible();
    await expect(page.getByTestId("detail-delete-btn")).toBeVisible();

    // Record payment
    await page.getByTestId("record-payment-btn").click();
    await page.getByTestId("payment-amount").fill("10.50");
    await page.getByTestId("payment-save").click();
    await expect(page.getByRole("dialog")).toContainText("Payment via Revolut");

    // Close detail and delete the person
    await page.keyboard.press("Escape");
    page.on("dialog", async (dialog) => await dialog.accept());
    await page.getByTestId(`person-delete-${person.id}`).click();
    await expect(page.getByText(name)).not.toBeVisible();
  });

  test("delete person from detail modal", async ({ authenticatedPage: page }) => {
    const name = uniqueName();

    await page.getByTestId("add-person-btn").click();
    await page.getByTestId("person-name-input").fill(name);
    await page.getByTestId("person-form-save").click();
    await expect(page.getByText(name)).toBeVisible();

    const card = page.getByTestId(/^person-card-/).filter({ hasText: name });
    await card.click();

    await page.getByTestId("detail-delete-btn").click();
    await page.getByTestId("detail-delete-confirm").click();

    await expect(page.getByText(name)).not.toBeVisible();
  });
});
