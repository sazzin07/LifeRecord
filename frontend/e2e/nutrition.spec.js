import { test, expect } from "./fixtures";

// The redesigned Nutrition page, as a person uses it: the food database, portions, the diary, hydration, nutrients,
// goals and the food/recipe library. Runs as the standard test account; everything a test creates is removed again.

const tag = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function dayEntries(api, date = "") {
  const d = await (await api.get(`/api/nutrition/day${date ? `?date=${date}` : ""}`)).json();
  return { day: d, entries: d.meals.flatMap((m) => m.entries) };
}

async function cleanup(api, before) {
  const { entries } = await dayEntries(api);
  for (const e of entries) if (!before.has(e.id)) await api.delete(`/api/nutrition/diary/${e.id}`);
}

async function openAdd(page) {
  await page.getByTestId("add-food").first().click();
  await expect(page.getByTestId("food-dialog")).toBeVisible();
}

async function pickFood(page, query, nameFragment) {
  await page.getByTestId("food-search").fill(query);
  const result = page.locator("[data-testid^=food-result-]").filter({ hasText: nameFragment }).first();
  await expect(result).toBeVisible({ timeout: 10000 });
  await result.click();
  await expect(page.getByTestId("food-portion")).toBeVisible();
}

test.describe("Nutrition", () => {
  test("search a food, choose a portion, see the live nutrition, add it, edit, duplicate, move and delete it", async ({ authenticatedPage: page, apiContext }) => {
    const { entries: beforeEntries } = await dayEntries(apiContext);
    const before = new Set(beforeEntries.map((e) => e.id));
    try {
      await page.goto("/nutrition");
      await expect(page.getByTestId("day-ledger")).toBeVisible();
      await openAdd(page);
      await pickFood(page, "spinach raw", "Spinach, raw");

      // portion step: the food's own units, and a preview that follows the amount
      await page.getByTestId("food-unit").click();
      await expect(page.getByRole("option", { name: "1 cup" })).toBeVisible();
      await page.getByRole("option", { name: "g", exact: true }).click();
      await page.getByTestId("food-qty").fill("200");
      await expect(page.getByTestId("food-preview")).toContainText("200 g");
      await page.getByTestId("food-meal").click();
      await page.getByRole("option", { name: "Lunch" }).click();
      await page.getByTestId("food-save").click();
      await expect(page.getByTestId("food-dialog")).not.toBeVisible();

      // persisted, with scaled nutrients and the right meal
      const { entries } = await dayEntries(apiContext);
      const e = entries.find((x) => !before.has(x.id));
      expect(e).toMatchObject({ meal_type: "lunch", quantity: 200, unit: "g", grams: 200, source: "food", quality: "verified" });
      expect(e.nutrients.energy_kcal).toBeGreaterThan(30);
      const row = page.getByTestId(`entry-${e.id}`);
      await expect(row).toContainText("Spinach, raw");
      await expect(row).toContainText("200 g");

      // edit the amount
      await page.getByTestId(`entry-menu-${e.id}`).click();
      await page.getByTestId("entry-edit").click();
      await page.getByTestId("food-qty").fill("100");
      await page.getByTestId("food-save").click();
      await expect(page.getByTestId("food-dialog")).not.toBeVisible();
      await expect.poll(async () => (await dayEntries(apiContext)).entries.find((x) => x.id === e.id).grams).toBe(100);

      // duplicate, then move the copy to dinner
      await page.getByTestId(`entry-menu-${e.id}`).click();
      await page.getByTestId("entry-duplicate").click();
      await expect.poll(async () => (await dayEntries(apiContext)).entries.filter((x) => !before.has(x.id)).length).toBe(2);
      const copy = (await dayEntries(apiContext)).entries.find((x) => !before.has(x.id) && x.id !== e.id);
      await page.getByTestId(`entry-menu-${copy.id}`).click();
      await page.getByRole("menuitem", { name: "Move to dinner" }).click();
      await expect.poll(async () => (await dayEntries(apiContext)).entries.find((x) => x.id === copy.id).meal_type).toBe("dinner");

      // delete asks first
      await page.getByTestId(`entry-menu-${copy.id}`).click();
      await page.getByTestId("entry-delete").click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await expect(page.getByTestId(`entry-${copy.id}`)).toHaveCount(0);
      await expect.poll(async () => (await dayEntries(apiContext)).entries.some((x) => x.id === copy.id)).toBe(false);

      // survives a reload
      await page.reload();
      await expect(page.getByTestId(`entry-${e.id}`)).toBeVisible();
    } finally {
      await cleanup(apiContext, before);
    }
  });

  test("type a meal in; it counts, and its missing vitamins show as no data rather than zero", async ({ authenticatedPage: page, apiContext }) => {
    const { entries: b } = await dayEntries(apiContext);
    const before = new Set(b.map((e) => e.id));
    const name = tag();
    try {
      await page.goto("/nutrition");
      await openAdd(page);
      await page.getByTestId("food-tab-quick").click();
      await page.getByTestId("quick-description").fill(name);
      await page.getByTestId("quick-calories").fill("333");
      await page.getByTestId("quick-protein").fill("20");
      await page.getByTestId("quick-save").click();
      await expect(page.getByTestId("food-dialog")).not.toBeVisible();
      const e = (await dayEntries(apiContext)).entries.find((x) => x.description === name);
      expect(e.nutrients).toEqual({ energy_kcal: 333, protein_g: 20 });
      expect(e.source).toBe("quick");
      await expect(page.getByTestId(`entry-${e.id}`)).toContainText("Yours");
      await page.getByTestId("tab-nutrients").click();
      await expect(page.getByTestId("nutrients-tab")).toBeVisible();
      await page.getByTestId("nutrient-iodine_ug").locator("button").first().click();
      await expect(page.getByTestId("nutrient-iodine_ug")).toContainText(/no data/i);
      await expect(page.getByTestId("nutrient-biotin_ug")).toContainText(/no data/i);
    } finally {
      await cleanup(apiContext, before);
    }
  });

  test("water: quick buttons and a custom amount update the total, and a drink can be removed", async ({ authenticatedPage: page, apiContext }) => {
    const start = (await (await apiContext.get("/api/nutrition/day")).json()).hydration;
    await page.goto("/nutrition");
    await expect(page.getByTestId("hydration-card")).toBeVisible();
    await page.getByTestId("water-add-250").click();
    await expect.poll(async () => (await (await apiContext.get("/api/nutrition/day")).json()).hydration.drinks_ml).toBe(start.drinks_ml + 250);
    await page.getByTestId("water-custom").fill("330");
    await page.getByTestId("hydration-card").getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(async () => (await (await apiContext.get("/api/nutrition/day")).json()).hydration.drinks_ml).toBe(start.drinks_ml + 580);
    const now = (await (await apiContext.get("/api/nutrition/day")).json()).hydration;
    for (const w of now.entries.filter((x) => !start.entries.find((y) => y.id === x.id))) {
      await page.getByRole("button", { name: `Remove ${w.amount_ml} ml drink` }).first().click();
    }
    await expect.poll(async () => (await (await apiContext.get("/api/nutrition/day")).json()).hydration.drinks_ml).toBe(start.drinks_ml);
  });

  test("goals: details give EFSA references, own targets win and unsafe ones are flagged; clearing restores general values", async ({ authenticatedPage: page, apiContext }) => {
    const before = await (await apiContext.get("/api/nutrition/profile")).json();
    try {
      await page.goto("/nutrition");
      await page.getByTestId("tab-goals").click();
      await expect(page.getByTestId("profile-form")).toBeVisible();
      await page.getByTestId("profile-year").fill(String(new Date().getFullYear() - 35));
      await page.getByTestId("profile-sex").click();
      await page.getByRole("option", { name: "Female" }).click();
      await page.getByTestId("profile-weight").fill("62");
      await page.getByTestId("profile-activity").click();
      await page.getByRole("option", { name: /Moderately active/ }).click();
      await page.getByTestId("profile-save").click();
      await expect(page.getByTestId("goal-energy_kcal")).toContainText("2,080");
      await expect(page.getByTestId("goal-iron_mg")).toContainText("16");
      await expect(page.getByTestId("sources-card")).toContainText("EFSA");

      // a very low energy target is allowed (their choice) but flagged
      await page.getByTestId("goal-edit-energy_kcal").click();
      await page.getByTestId("target-target").fill("900");
      await page.getByTestId("target-save").click();
      await expect(page.getByText(/very low for most adults/)).toBeVisible();
      await expect(page.getByTestId("goal-energy_kcal")).toContainText("900");
      await expect(page.getByTestId("goal-energy_kcal")).toContainText("Your target");
      await page.getByRole("button", { name: "Reset Energy to suggested" }).click();
      await expect(page.getByTestId("goal-energy_kcal")).toContainText("2,080");
    } finally {
      await apiContext.delete("/api/nutrition/profile");
      if (before.exists) await apiContext.put("/api/nutrition/profile", { data: { birth_year: before.birth_year, sex: before.sex, height_cm: before.height_cm, weight_kg: before.weight_kg, activity: before.activity, pregnancy: before.pregnancy, diet_tags: before.diet_tags, allergies: before.allergies, timezone: before.timezone } });
    }
  });

  test("foods: search the database, open a food's full nutrient table, create your own food and use it", async ({ authenticatedPage: page, apiContext }) => {
    const name = tag();
    const { entries: b } = await dayEntries(apiContext);
    const before = new Set(b.map((e) => e.id));
    let foodId;
    try {
      await page.goto("/nutrition");
      await page.getByTestId("tab-foods").click();
      await page.getByTestId("foods-search").fill("salmon atlantic farmed");
      const row = page.locator("[data-testid^=food-row-]").first();
      await expect(row).toBeVisible({ timeout: 10000 });
      await row.click();
      const detail = page.getByTestId("food-detail");
      await expect(detail).toContainText("Vitamin B12");
      await expect(detail).toContainText("not reported");   // gaps are shown as gaps
      await expect(detail).toContainText("USDA");
      await page.keyboard.press("Escape");

      await page.getByTestId("create-food").click();
      await page.getByTestId("cf-name").fill(name);
      await page.getByTestId("cf-energy_kcal").fill("400");
      await page.getByTestId("cf-protein_g").fill("30");
      await page.getByTestId("cf-carbs_g").fill("80");   // 110 g of macros per 100 g: must be refused
      await page.getByTestId("cf-save").click();
      await expect(page.getByRole("alert")).toContainText(/more than 100 g/);
      await page.getByTestId("cf-carbs_g").fill("40");
      await page.getByTestId("cf-save").click();
      await expect(page.getByTestId("create-food-dialog")).not.toBeVisible();
      await expect(page.getByText(name).first()).toBeVisible();
      foodId = (await (await apiContext.get("/api/nutrition/foods/mine")).json()).find((f) => f.name === name).id;

      await page.getByTestId("tab-today").click();
      await openAdd(page);
      await pickFood(page, name, name);
      await expect(page.getByTestId("food-preview")).toContainText("400 kcal");   // 100 g default
      await page.getByTestId("food-save").click();
      await expect.poll(async () => (await dayEntries(apiContext)).entries.some((x) => x.food_id === foodId)).toBe(true);
    } finally {
      await cleanup(apiContext, before);
      if (foodId) await apiContext.delete(`/api/nutrition/foods/${foodId}`);
    }
  });

  test("recipes: create, log a serving to the diary, delete", async ({ authenticatedPage: page, apiContext }) => {
    const name = tag();
    const { entries: b } = await dayEntries(apiContext);
    const before = new Set(b.map((e) => e.id));
    let rid;
    try {
      await page.goto("/nutrition");
      await page.getByTestId("tab-foods").click();
      await page.getByTestId("new-recipe").click();
      const d = page.getByTestId("recipe-dialog");
      await d.getByPlaceholder("Recipe name").fill(name);
      await d.getByPlaceholder("Servings").fill("2");
      await d.getByLabel("Calories, whole recipe").fill("350");
      await d.getByLabel("Protein (g), whole recipe").fill("25");
      await d.getByRole("button", { name: "Create recipe" }).click();
      await expect(d).not.toBeVisible();
      rid = (await (await apiContext.get("/api/recipes")).json()).find((r) => r.name === name).id;
      await page.getByTestId(`log-recipe-${rid}`).click();
      await expect.poll(async () => (await dayEntries(apiContext)).entries.find((x) => x.recipe_id === rid)?.nutrients.energy_kcal).toBe(175);   // recipe totals are for the whole recipe
    } finally {
      await cleanup(apiContext, before);
      if (rid) await apiContext.delete(`/api/recipes/${rid}`);
    }
  });

  test("trends: ranges switch, an empty period says so, and the CSV downloads", async ({ authenticatedPage: page }) => {
    await page.goto("/nutrition");
    await page.getByTestId("tab-trends").click();
    await expect(page.getByTestId("trends-tab")).toBeVisible();
    await page.getByTestId("range-30").click();
    await expect(page.getByTestId("trends-tab")).toContainText("a day without entries is not counted as zero");
    const dl = page.waitForEvent("download");
    await page.getByTestId("trends-download").click();
    expect((await dl).suggestedFilename()).toMatch(/^nutrition-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("day navigation: yesterday opens, a day with nothing says so, Today returns", async ({ authenticatedPage: page }) => {
    await page.goto("/nutrition");
    await expect(page.getByTestId("day-ledger")).toBeVisible();
    for (let i = 0; i < 40; i += 1) await page.getByTestId("day-prev").click();
    await expect(page.getByTestId("day-ledger")).toContainText("Nothing logged for this day yet");
    await page.getByTestId("day-today").click();
    await expect(page.getByTestId("day-today")).toHaveCount(0);
  });

  test("on a phone nothing scrolls sideways and the dialog fits", async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/nutrition");
    await expect(page.getByTestId("day-ledger")).toBeVisible();
    for (const t of ["today", "nutrients", "trends", "foods", "goals"]) {
      await page.getByTestId(`tab-${t}`).click();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), t).toBe(true);
    }
    await page.getByTestId("tab-today").click();
    await openAdd(page);
    const box = await page.getByTestId("food-dialog").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(376);
    expect(await page.evaluate(() => { const d = document.querySelector("[data-testid=food-dialog]"); return d.scrollWidth <= d.clientWidth + 1; })).toBe(true);
  });
});
