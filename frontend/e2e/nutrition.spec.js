import { test, expect } from "./fixtures";

// TEST-003: the manual meal and recipe forms on the Nutrition page (NUTR-001, NUTR-002), no AI involved.
// Records carry an E2E- prefix and are removed afterwards through the API.

const tag = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const today = () => new Date().toISOString().slice(0, 10);

async function cleanup(apiContext, prefix) {
  for (const m of await (await apiContext.get(`/api/meals?date=${today()}`)).json()) {
    if (m.description.startsWith(prefix)) await apiContext.delete(`/api/meals/${m.id}`);
  }
  for (const r of await (await apiContext.get("/api/recipes")).json()) {
    if (r.name.startsWith(prefix)) await apiContext.delete(`/api/recipes/${r.id}`);
  }
}

test("log, edit and delete a meal by hand", async ({ authenticatedPage: page, apiContext }) => {
  const name = tag();
  try {
    await page.goto("/nutrition");
    await page.getByRole("button", { name: "Add meal" }).first().click();
    const dialog = page.getByTestId("meal-dialog");
    await expect(dialog).toContainText("Log a meal");
    await dialog.getByPlaceholder("What did you eat?").fill(name);
    await dialog.getByPlaceholder("Calories").fill("420");
    await dialog.getByPlaceholder("Protein (g)").fill("30");
    await dialog.getByPlaceholder("Carbs (g)").fill("45");
    await dialog.getByPlaceholder("Fat (g)").fill("12");
    await dialog.getByRole("button", { name: "Log meal" }).click();
    await expect(dialog).not.toBeVisible();

    const saved = (await (await apiContext.get(`/api/meals?date=${today()}`)).json()).find((m) => m.description === name);
    expect(saved).toMatchObject({ calories: 420, protein: 30, carbs: 45, fat: 12, date: today() });
    const row = page.getByTestId(`meal-${saved.id}`);
    await expect(row).toContainText(name);
    await expect(row).toContainText("420 kcal");

    await page.getByTestId(`meal-edit-${saved.id}`).click({ force: true });
    await expect(dialog).toContainText("Edit meal");
    await dialog.getByPlaceholder("Calories").fill("500");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toContainText("500 kcal");
    const edited = (await (await apiContext.get(`/api/meals?date=${today()}`)).json()).find((m) => m.id === saved.id);
    expect(edited.calories).toBe(500);

    await page.getByTestId(`meal-delete-${saved.id}`).click({ force: true });
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId(`meal-${saved.id}`)).toHaveCount(0);
    const left = (await (await apiContext.get(`/api/meals?date=${today()}`)).json()).filter((m) => m.id === saved.id);
    expect(left).toHaveLength(0);
  } finally {
    await cleanup(apiContext, name);
  }
});

test("a meal needs a description", async ({ authenticatedPage: page, apiContext }) => {
  const before = (await (await apiContext.get(`/api/meals?date=${today()}`)).json()).length;
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "Add meal" }).first().click();
  const dialog = page.getByTestId("meal-dialog");
  await dialog.getByPlaceholder("Calories").fill("100");
  await dialog.getByRole("button", { name: "Log meal" }).click();
  // The browser blocks the submit: dialog stays open and nothing is created.
  await expect(dialog).toBeVisible();
  expect((await (await apiContext.get(`/api/meals?date=${today()}`)).json()).length).toBe(before);
});

test("create, edit and delete a recipe with ingredients", async ({ authenticatedPage: page, apiContext }) => {
  const name = tag();
  try {
    await page.goto("/nutrition");
    await page.getByRole("button", { name: "New recipe" }).click();
    const dialog = page.getByTestId("recipe-dialog");
    await expect(dialog).toContainText("New recipe");
    await dialog.getByPlaceholder("Recipe name").fill(name);
    await dialog.getByPlaceholder("Servings").fill("2");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.getByPlaceholder("Name", { exact: true }).fill("E2E rice");
    await dialog.getByPlaceholder("Qty").fill("200");
    await dialog.getByPlaceholder("Unit").fill("g");
    await dialog.getByPlaceholder("Calories / serving").fill("350");
    await dialog.getByRole("button", { name: "Create recipe" }).click();
    await expect(dialog).not.toBeVisible();

    const saved = (await (await apiContext.get("/api/recipes")).json()).find((r) => r.name === name);
    expect(saved).toMatchObject({ servings: 2, calories: 350 });
    expect(saved.ingredients).toEqual([expect.objectContaining({ name: "E2E rice", quantity: 200, unit: "g" })]);
    const card = page.getByTestId(`recipe-${saved.id}`);
    await expect(card).toContainText("200g E2E rice");

    await page.getByTestId(`recipe-edit-${saved.id}`).click();
    await expect(dialog).toContainText("Edit recipe");
    await dialog.getByPlaceholder("Servings").fill("4");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card).toContainText("4 servings");
    const edited = (await (await apiContext.get("/api/recipes")).json()).find((r) => r.id === saved.id);
    expect(edited.servings).toBe(4);

    await page.getByTestId(`recipe-delete-${saved.id}`).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId(`recipe-${saved.id}`)).toHaveCount(0);
  } finally {
    await cleanup(apiContext, name);
  }
});
