import { test, expect } from "./fixtures";

// "What could I eat?" on the Today tab: ideas with reasons, a meal and an aim to choose, one tap to add with Undo, diet words that exclude,
// and a clear message when suggestions cannot be loaded. Runs as the standard test account; everything a test creates is removed.

const tag = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function snapshot(api) {
  const d = await (await api.get("/api/nutrition/day")).json();
  return new Set(d.meals.flatMap((m) => m.entries).map((e) => e.id));
}
async function restoreEntries(api, before) {
  const d = await (await api.get("/api/nutrition/day")).json();
  for (const e of d.meals.flatMap((m) => m.entries)) if (!before.has(e.id)) await api.delete(`/api/nutrition/diary/${e.id}`);
}
/** A recipe built to be an excellent answer to "protein and fibre still needed", so it is found without depending on what else is saved. */
async function strongRecipe(api, name) {
  const food = await (await api.post("/api/nutrition/foods", { data: { name: `${name} beans`, nutrients: { energy_kcal: 100, protein_g: 10, fiber_g: 8 } } })).json();
  const recipe = await (await api.post("/api/recipes", { data: { name, servings: 1, ingredients: [{ name: `${name} beans`, quantity: 400, unit: "g", food_id: food.id }] } })).json();
  return { food, recipe };
}
async function cleanup(api, { food, recipe }) {
  await api.delete(`/api/recipes/${recipe.id}`);
  await api.delete(`/api/nutrition/foods/${food.id}`);
}
async function reveal(page) {   // the ideas are the top three; open the rest if needed
  const more = page.getByTestId("suggestions-more");
  if (await more.count() && (await more.getAttribute("aria-expanded")) !== "true") await more.click();
}

test.describe("Nutrition suggestions", () => {
  test("ideas come with reasons, and one tap adds an idea to the diary with Undo", async ({ authenticatedPage: page, apiContext }) => {
    const before = await snapshot(apiContext);
    const made = await strongRecipe(apiContext, tag());
    try {
      await page.goto("/nutrition");
      const card = page.getByTestId("suggestions");
      await expect(card).toBeVisible();
      await expect(page.getByTestId("suggestions-context")).toContainText("kcal fits this meal");
      await expect(page.getByTestId("suggestions-focus")).toContainText("Still needed");
      await page.getByTestId("suggestions-aim").click();
      await page.getByRole("option", { name: "Aim: Protein" }).click();
      await reveal(page);
      const idea = page.getByTestId(`idea-recipe-${made.recipe.id}`);
      await expect(idea).toBeVisible({ timeout: 10000 });
      await expect(idea).toContainText("% of what is left");   // it states how much of which nutrient it covers
      await expect(idea).toContainText("Protein");
      await idea.getByTestId(`idea-why-${made.recipe.id}`).click();
      await expect(idea).toContainText("Covers");
      await expect(idea).toContainText("kcal, which fits the roughly");

      await idea.getByTestId(`idea-log-${made.recipe.id}`).click();
      await expect.poll(async () => (await (await apiContext.get("/api/nutrition/day")).json()).meals.flatMap((m) => m.entries).filter((e) => e.recipe_id === made.recipe.id).length).toBe(1);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect.poll(async () => (await (await apiContext.get("/api/nutrition/day")).json()).meals.flatMap((m) => m.entries).filter((e) => e.recipe_id === made.recipe.id).length).toBe(0);
    } finally { await restoreEntries(apiContext, before); await cleanup(apiContext, made); }
  });

  test("choosing a meal and a nutrient to aim at changes the ideas and says what is still needed", async ({ authenticatedPage: page }) => {
    await page.goto("/nutrition");
    await expect(page.getByTestId("suggestions-context")).toContainText("kcal fits this meal");
    const dinner = await page.getByTestId("suggestions-context").innerText();
    await page.getByTestId("suggest-meal-snack").click();
    await expect(page.getByTestId("suggest-meal-snack")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("suggestions-context")).not.toHaveText(dinner);        // a snack gets a smaller share of the day's energy
    await page.getByTestId("suggestions-aim").click();
    await page.getByRole("option", { name: "Aim: Calcium" }).click();
    await expect(page.getByTestId("suggestions-focus")).toContainText("Calcium");
    await expect(page.getByTestId("suggestions-focus")).not.toContainText("Protein");
  });

  test("an allergy word leaves a recipe out and the card says that something was left out", async ({ authenticatedPage: page, apiContext }) => {
    const word = `zzallergen${Date.now().toString(36)}`;
    const made = await strongRecipe(apiContext, `E2E ${word} stew`);
    const before = await (await apiContext.get("/api/nutrition/profile")).json();
    try {
      await page.goto("/nutrition");
      await page.getByTestId("suggestions-aim").click();
      await page.getByRole("option", { name: "Aim: Protein" }).click();
      await reveal(page);
      await expect(page.getByTestId(`idea-recipe-${made.recipe.id}`)).toBeVisible({ timeout: 10000 });
      expect((await apiContext.put("/api/nutrition/profile", { data: { ...before, allergies: [word] } })).ok()).toBe(true);
      await page.reload();
      await page.getByTestId("suggestions-aim").click();
      await page.getByRole("option", { name: "Aim: Protein" }).click();
      await expect(page.getByTestId("suggestions")).toContainText("left out because of your diet or allergy words");
      await expect(page.getByTestId(`idea-recipe-${made.recipe.id}`)).toHaveCount(0);
    } finally {
      if (before.exists) await apiContext.put("/api/nutrition/profile", { data: { birth_year: before.birth_year, sex: before.sex, height_cm: before.height_cm, weight_kg: before.weight_kg, activity: before.activity, pregnancy: before.pregnancy, diet_tags: before.diet_tags, allergies: before.allergies, timezone: before.timezone } });
      else await apiContext.delete("/api/nutrition/profile");
      await cleanup(apiContext, made);
    }
  });

  test("when suggestions cannot be loaded the card says so and can try again", async ({ authenticatedPage: page }) => {
    await page.route("**/api/nutrition/suggestions**", (route) => route.abort());
    await page.goto("/nutrition");
    await expect(page.getByTestId("suggestions").getByRole("alert")).toContainText("could not be loaded");
    await page.unroute("**/api/nutrition/suggestions**");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("suggestions-context")).toContainText("kcal");
  });

  test("the reasons open from the keyboard and the controls have names", async ({ authenticatedPage: page, apiContext }) => {
    const made = await strongRecipe(apiContext, tag());
    try {
      await page.goto("/nutrition");
      await page.getByTestId("suggestions-aim").click();
      await page.getByRole("option", { name: "Aim: Protein" }).click();
      await reveal(page);
      const why = page.getByTestId(`idea-why-${made.recipe.id}`);
      await why.focus();
      await expect(why).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press("Enter");
      await expect(why).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("button", { name: /^Add .* to / }).first()).toBeVisible();   // the add buttons say what they add and where
    } finally { await cleanup(apiContext, made); }
  });

  test("on a phone and a tablet the card fits the screen", async ({ authenticatedPage: page }) => {
    for (const [w, h] of [[390, 844], [820, 1180]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/nutrition");
      await expect(page.getByTestId("suggestions")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow at ${w}px`).toBeLessThanOrEqual(0);
    }
  });
});
