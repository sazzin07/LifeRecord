import { test, expect } from "./fixtures";

// Swapping one ingredient of a recipe: the panel shows what it would do to the whole recipe per serving; nothing changes until "Use" and Save.

test.describe("Recipe ingredient alternatives", () => {
  test("find a lower-sodium swap, see its effect on the recipe, use it, and save", async ({ authenticatedPage: page, apiContext }) => {
    const tag = `E2E-${Date.now()}`;
    const make = async (name, n) => (await (await apiContext.post("/api/nutrition/foods", { data: { name: `${tag} ${name}`, nutrients: n } })).json());
    const salted = await make("Salted cracker", { energy_kcal: 430, sodium_mg: 1100, protein_g: 9 });
    const plain = await make("Plain cracker", { energy_kcal: 420, sodium_mg: 300, protein_g: 9 });
    const recipe = await (await apiContext.post("/api/recipes", { data: { name: `${tag} plate`, servings: 2, ingredients: [{ name: "Crackers", quantity: 100, unit: "g", food_id: salted.id }] } })).json();
    try {
      await page.goto("/nutrition?tab=foods");
      await page.getByTestId(`recipe-edit-${recipe.id}`).click();
      const dlg = page.getByTestId("recipe-dialog");
      await expect(dlg.getByTestId("ing-linked")).toBeVisible();
      await dlg.getByTestId("ing-swap").click();
      await expect(dlg.getByTestId("alt-nutrient")).toContainText("less sodium");
      await dlg.getByTestId("alt-go").click();
      const row = dlg.getByTestId(`alt-${plain.id}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText("550 → 150 mg");                       // 1,100 mg over two servings, against 300 mg over two
      await expect(row).toContainText("-73%");
      await expect(row).toContainText("kcal");
      await expect(dlg.getByTestId(`alt-${salted.id}`)).toHaveCount(0);     // the same food is not its own alternative
      expect((await (await apiContext.get("/api/recipes")).json()).find((r) => r.id === recipe.id).ingredients[0].food_id).toBe(salted.id);   // nothing saved yet

      await row.getByRole("button", { name: "Use" }).click();
      await expect(dlg.getByTestId("ing-linked")).toContainText("Plain cracker");
      await expect(dlg.getByTestId("ing-qty")).toHaveValue("100");
      await expect(dlg.getByTestId("preview-kcal")).toHaveText("210");      // 420 kcal over two servings
      await dlg.getByTestId("recipe-save").click();
      await expect(dlg).not.toBeVisible();
      const saved = (await (await apiContext.get("/api/recipes")).json()).find((r) => r.id === recipe.id);
      expect(saved.ingredients[0].food_id).toBe(plain.id);
      expect(saved.nutrients.sodium_mg).toBeCloseTo(150, 1);
    } finally {
      await apiContext.delete(`/api/recipes/${recipe.id}`);
      await apiContext.delete(`/api/nutrition/foods/${salted.id}`);
      await apiContext.delete(`/api/nutrition/foods/${plain.id}`);
    }
  });

  test("when nothing does better, or the food has no value to compare, the panel says so", async ({ authenticatedPage: page, apiContext }) => {
    const tag = `E2E-${Date.now()}`;
    const only = await (await apiContext.post("/api/nutrition/foods", { data: { name: `${tag} Only cracker`, nutrients: { energy_kcal: 430, sodium_mg: 900, protein_g: 9 } } })).json();
    const recipe = await (await apiContext.post("/api/recipes", { data: { name: `${tag} solo`, servings: 1, ingredients: [{ name: "Cracker", quantity: 50, unit: "g", food_id: only.id }] } })).json();
    try {
      await page.goto("/nutrition?tab=foods");
      await page.getByTestId(`recipe-edit-${recipe.id}`).click();
      const dlg = page.getByTestId("recipe-dialog");
      await dlg.getByTestId("ing-swap").click();
      await dlg.getByTestId("alt-go").click();
      await expect(dlg.getByTestId("alt-none")).toContainText("does better");
      // the panel only offers nutrients the food actually reports
      await dlg.getByTestId("alt-nutrient").click();
      await expect(page.getByRole("option", { name: "more fibre" })).toHaveCount(0);
      await expect(page.getByRole("option", { name: "less sodium" })).toBeVisible();
    } finally {
      await apiContext.delete(`/api/recipes/${recipe.id}`);
      await apiContext.delete(`/api/nutrition/foods/${only.id}`);
    }
  });
});
