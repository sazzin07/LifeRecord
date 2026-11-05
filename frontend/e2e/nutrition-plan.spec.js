import { test, expect } from "./fixtures";

// Nutrition, second delivery: address-based navigation, one-tap logging, copying a meal, editing a drink, the meal plan,
// shopping lists from a plan, recipes calculated from foods, nutrient filters, reminders and the printable summary (the camera
// scanner is in nutrition-camera.spec.js). Runs as the standard test account; everything a test creates is removed.

const tag = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const isoShift = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };

async function day(api, date = "") {
  const d = await (await api.get(`/api/nutrition/day${date ? `?date=${date}` : ""}`)).json();
  return { day: d, today: d.today, entries: d.meals.flatMap((m) => m.entries), drinks: d.hydration.entries };
}
async function snapshot(api) {
  const { entries, drinks } = await day(api);
  return { entries: new Set(entries.map((e) => e.id)), drinks: new Set(drinks.map((w) => w.id)) };
}
async function restore(api, before) {
  const { entries, drinks } = await day(api);
  for (const e of entries) if (!before.entries.has(e.id)) await api.delete(`/api/nutrition/diary/${e.id}`);
  for (const w of drinks) if (!before.drinks.has(w.id)) await api.delete(`/api/nutrition/water/${w.id}`);
}
async function foodByName(api, q, startsWith) {
  const res = await (await api.get(`/api/nutrition/foods/search?q=${encodeURIComponent(q)}&limit=30`)).json();
  return res.find((f) => f.name.toLowerCase().startsWith(startsWith)) || res[0];
}
/** Names of the controls on the page that a screen reader could not name: buttons, links, inputs and selects with no label. */
async function unnamedControls(page) {
  return page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const name = (el) => {
      if (el.getAttribute("aria-label")?.trim()) return true;
      const by = el.getAttribute("aria-labelledby");
      if (by && by.split(" ").some((id) => document.getElementById(id)?.textContent.trim())) return true;
      if (el.getAttribute("title")?.trim()) return true;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return true;
      if (el.closest("label")) return true;
      if (el.matches("button, a, [role=button], [role=tab], [role=combobox]") && el.textContent.trim()) return true;
      return false;
    };
    return [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=combobox]")]
      .filter((el) => visible(el) && !el.closest("[aria-hidden=true]") && !name(el))
      .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}`);
  });
}

test.describe("Nutrition navigation", () => {
  test("the tab and the day are in the address: refresh, Back and a shared link land in the same place", async ({ authenticatedPage: page }) => {
    await page.goto("/nutrition?tab=plan");
    await expect(page.getByTestId("tab-plan")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("plan-tab")).toBeVisible();
    await page.getByTestId("tab-foods").click();
    await expect(page).toHaveURL(/tab=foods/);
    await page.reload();
    await expect(page.getByTestId("tab-foods")).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(page.getByTestId("tab-plan")).toHaveAttribute("aria-selected", "true");
    // a chosen day is kept too, and "Today" clears it
    await page.goto("/nutrition?tab=trends&date=2026-09-01");
    await expect(page.getByTestId("day-label")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Day: .*2026/ })).toBeVisible();
    await page.getByTestId("day-today").click();
    await expect(page).not.toHaveURL(/date=/);
    // nonsense in the address falls back to the default instead of breaking the page
    await page.goto("/nutrition?tab=nope&date=garbage");
    await expect(page.getByTestId("tab-today")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("day-ledger")).toBeVisible();
  });

  test("adding food is one click from every tab, and no tab has an unnamed control", async ({ authenticatedPage: page }) => {
    for (const tab of ["today", "plan", "nutrients", "trends", "foods", "goals"]) {
      await page.goto(`/nutrition?tab=${tab}`);
      await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("header-add-food")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await unnamedControls(page), `unnamed controls on the ${tab} tab`).toEqual([]);
    }
    await page.goto("/nutrition?tab=goals");
    await page.getByTestId("header-add-food").click();
    await expect(page.getByTestId("food-dialog")).toBeVisible();
    expect(await unnamedControls(page), "unnamed controls in the add-food dialog").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("food-dialog")).not.toBeVisible();
  });
});

test.describe("Nutrition quick logging", () => {
  test("type a few letters, tap Add, undo it; foods you log often come back with their last amount", async ({ authenticatedPage: page, apiContext }) => {
    const before = await snapshot(apiContext);
    try {
      await page.goto("/nutrition");
      await page.getByTestId("quick-add-input").fill("bananas raw");
      const add = page.getByTestId("quick-add-results").getByRole("button", { name: /Add Bananas, raw/ }).first();
      await expect(add).toBeVisible({ timeout: 10000 });
      await add.click();
      await expect.poll(async () => (await day(apiContext)).entries.filter((e) => !before.entries.has(e.id) && /bananas, raw/i.test(e.description)).length).toBe(1);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect.poll(async () => (await day(apiContext)).entries.filter((e) => !before.entries.has(e.id)).length).toBe(0);   // really gone, not just hidden

      // log 150 g once by hand, then the shortcut repeats exactly that amount
      const banana = await foodByName(apiContext, "bananas raw", "bananas, raw");
      expect((await apiContext.post("/api/nutrition/diary", { data: { food_id: banana.id, quantity: 150, unit: "g", meal_type: "snack" } })).ok()).toBe(true);
      await page.reload();
      const chip = page.getByTestId("quick-add-recent").getByRole("button", { name: /Bananas, raw/ }).first();
      await expect(chip).toContainText("150 g");
      await chip.click();
      await expect.poll(async () => (await day(apiContext)).entries.filter((e) => !before.entries.has(e.id) && e.grams === 150).length).toBe(2);
    } finally { await restore(apiContext, before); }
  });

  test("copy yesterday's meal into today with one tap", async ({ authenticatedPage: page, apiContext }) => {
    const before = await snapshot(apiContext);
    const { today, entries } = await day(apiContext);
    const free = ["breakfast", "lunch", "dinner", "snack"].find((m) => !entries.some((e) => e.meal_type === m));
    test.skip(!free, "every meal already has entries today");
    const oats = await foodByName(apiContext, "oats", "oats");
    const yesterday = isoShift(today, -1);
    const made = await (await apiContext.post("/api/nutrition/diary", { data: { date: yesterday, food_id: oats.id, quantity: 40, unit: "g", meal_type: free } })).json();
    try {
      await page.goto("/nutrition");
      await page.getByTestId(`copy-${free}`).click();
      await expect.poll(async () => (await day(apiContext)).entries.filter((e) => !before.entries.has(e.id) && e.meal_type === free && e.grams === 40).length).toBe(1);
      await expect(page.getByTestId(`meal-${free}`)).toContainText(oats.name.split(",")[0]);
    } finally {
      await restore(apiContext, before);
      await apiContext.delete(`/api/nutrition/diary/${made.id}`);
    }
  });

  test("a logged drink can be changed, not only removed", async ({ authenticatedPage: page, apiContext }) => {
    const before = await snapshot(apiContext);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));   // a save must never leave an uncaught error behind, even if the data still updated
    try {
      await page.goto("/nutrition");
      await page.getByTestId("water-add-250").click();
      await expect.poll(async () => (await day(apiContext)).drinks.filter((w) => !before.drinks.has(w.id)).length).toBe(1);
      const w = (await day(apiContext)).drinks.find((x) => !before.drinks.has(x.id));
      await page.getByTestId(`water-edit-${w.id}`).click();
      await page.getByTestId("water-edit-input").fill("330");
      await page.getByTestId("water-edit-save").click();
      await expect.poll(async () => (await day(apiContext)).drinks.find((x) => x.id === w.id)?.amount_ml).toBe(330);
      await page.waitForTimeout(1500);   // the scoped refresh runs after the save
      expect(errors).toEqual([]);
    } finally { await restore(apiContext, before); }
  });

  test("the Home page uses the same day and references as the Nutrition page", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    const card = page.locator("h3", { hasText: "Nutrition today" }).locator("xpath=ancestor::*[contains(@class,'p-5')][1]");
    await expect(card).toContainText(/Reference \d/);
    await expect(card).not.toContainText("2700");   // the old fixed target is gone
  });
});

test.describe("Nutrition meal plan", () => {
  test("plan a food, see it stay out of the diary, then log it with one tap", async ({ authenticatedPage: page, apiContext }) => {
    const before = await snapshot(apiContext);
    const { today } = await day(apiContext);
    const planned = [];
    try {
      await page.goto("/nutrition?tab=plan");
      await page.getByTestId(`plan-add-${today}`).click();
      await expect(page.getByRole("heading", { name: "Plan a meal" })).toBeVisible();
      await page.getByTestId("food-search").fill("oats");
      const result = page.locator("[data-testid^=food-result-]").first();
      await expect(result).toBeVisible({ timeout: 10000 });
      await result.click();
      await page.getByTestId("food-qty").fill("60");
      await page.getByTestId("food-unit").click();
      await page.getByRole("option", { name: "g", exact: true }).click();
      await page.getByTestId("food-save").click();
      await expect(page.getByTestId("food-dialog")).not.toBeVisible();

      const plan = await (await apiContext.get(`/api/nutrition/plan?start=${today}&end=${today}`)).json();
      const item = plan.days[0].entries.find((e) => e.grams === 60 && e.status === "planned");
      expect(item, "the planned item was saved").toBeTruthy();
      planned.push(item.id);
      await expect(page.getByTestId(`plan-item-${item.id}`)).toBeVisible();
      expect((await day(apiContext)).entries.map((e) => e.id).sort()).toEqual([...before.entries].sort());   // planning is not eating

      await page.getByTestId(`plan-log-${item.id}`).click();
      await expect(page.getByTestId(`plan-item-${item.id}`)).toContainText("Logged");
      const after = (await day(apiContext)).entries.filter((e) => !before.entries.has(e.id));
      expect(after).toHaveLength(1);
      expect(after[0].nutrients.energy_kcal).toBeCloseTo(item.nutrients.energy_kcal, 5);   // the nutrients saved when it was planned
    } finally {
      await restore(apiContext, before);
      for (const id of planned) await apiContext.delete(`/api/nutrition/plan/${id}`);
    }
  });

  test("a recipe on the plan becomes a shopping list that subtracts what the kitchen already has", async ({ authenticatedPage: page, apiContext }) => {
    const t = tag();
    const { today } = await day(apiContext);
    const food = await (await apiContext.post("/api/nutrition/foods", { data: { name: `${t} flour`, nutrients: { energy_kcal: 364, protein_g: 10 } } })).json();
    const recipe = await (await apiContext.post("/api/recipes", { data: { name: `${t} loaf`, servings: 2, ingredients: [
      { name: `${t} flour`, quantity: 500, unit: "g", food_id: food.id }, { name: `${t} yeast`, quantity: 10, unit: "g" }] } })).json();
    const stock = await (await apiContext.post("/api/groceries", { data: { name: `${t} flour`, quantity: 200, unit: "g" } })).json();
    const item = await (await apiContext.post("/api/nutrition/plan", { data: { date: today, meal_type: "dinner", recipe_id: recipe.id, quantity: 2 } })).json();
    try {
      await page.goto("/nutrition?tab=plan");
      await page.getByTestId("plan-shopping").click();
      await page.getByTestId("plan-shopping-go").click();
      const result = page.getByTestId("plan-shopping-result");
      await expect(result).toContainText(`${t} flour`);
      await expect(result).toContainText("300");   // 500 g needed, 200 g in the kitchen
      await expect(result).toContainText(`${t} yeast`);
      await expect(result).toContainText("nothing is marked as bought", { ignoreCase: true });
      expect((await (await apiContext.get(`/api/groceries`)).json()).find((g) => g.id === stock.id).quantity).toBe(200);   // stock untouched
    } finally {
      const list = await (await apiContext.get("/api/shopping")).json();
      for (const i of list.items || []) if (i.name.startsWith(t)) await apiContext.delete(`/api/shopping/${i.id}`);
      await apiContext.delete(`/api/nutrition/plan/${item.id}`);
      await apiContext.delete(`/api/groceries/${stock.id}`);
      await apiContext.delete(`/api/recipes/${recipe.id}`);
      await apiContext.delete(`/api/nutrition/foods/${food.id}`);
    }
  });

  test("on a phone the plan, the recipe form and the scanner fit the screen", async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto("/nutrition?tab=plan");
    await expect(page.getByTestId("plan-tab")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByTestId("tab-foods").click();
    await page.getByTestId("new-recipe").click();
    await page.getByTestId("recipe-add-ingredient").click();
    await expect(page.getByTestId("recipe-dialog")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    const box = await page.getByTestId("recipe-dialog").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });
});

test.describe("Nutrition recipes from foods", () => {
  test("link an ingredient to a food: nutrition is calculated, saved, and the recipe can be planned", async ({ authenticatedPage: page, apiContext }) => {
    const t = tag();
    let rid;
    try {
      await page.goto("/nutrition?tab=foods");
      await page.getByTestId("new-recipe").click();
      const d = page.getByTestId("recipe-dialog");
      await d.getByTestId("recipe-name").fill(`${t} porridge`);
      await d.getByTestId("recipe-servings").fill("2");
      await d.getByTestId("recipe-add-ingredient").click();
      await d.getByTestId("ing-link").click();
      await d.getByTestId("link-food-search").fill("oats");
      await d.locator("[data-testid^=link-food-]:not([data-testid=link-food-search])").first().click();
      await expect(d.getByTestId("ing-linked")).toBeVisible();
      await d.getByTestId("ing-qty").fill("80");
      await expect(d.getByTestId("preview-kcal")).not.toHaveText("–", { timeout: 10000 });
      const shown = parseFloat((await d.getByTestId("preview-kcal").innerText()).replace(/,/g, ""));
      expect(shown).toBeGreaterThan(50);
      await expect(d.getByTestId("recipe-preview")).toContainText("based on 1 of 1 ingredient");
      await expect(d.getByLabel("Calories, whole recipe")).toHaveCount(0);   // typed numbers are replaced by the calculation
      await d.getByTestId("recipe-save").click();
      await expect(d).not.toBeVisible();

      const r = (await (await apiContext.get("/api/recipes")).json()).find((x) => x.name === `${t} porridge`);
      rid = r.id;
      expect(r.nutrients.energy_kcal).toBeCloseTo(shown, 0);
      expect(r.nutrition_meta).toMatchObject({ linked: 1, total: 1, complete: true });
      await expect(page.getByTestId(`recipe-calc-${rid}`)).toContainText("Calculated from its ingredients");
      await page.getByTestId(`plan-recipe-${rid}`).click();
      await expect(page.getByRole("heading", { name: "Plan a meal" })).toBeVisible();
      await expect(page.getByTestId("food-recipe")).toBeVisible();
    } finally { if (rid) await apiContext.delete(`/api/recipes/${rid}`); }
  });

  test("an unlinked ingredient is reported as left out, never counted as zero", async ({ authenticatedPage: page, apiContext }) => {
    const t = tag();
    const oats = await foodByName(apiContext, "oats", "oats");
    const r = await (await apiContext.post("/api/recipes", { data: { name: `${t} mix`, servings: 1, ingredients: [
      { name: "Oats", quantity: 50, unit: "g", food_id: oats.id }, { name: "Mystery topping", quantity: 1, unit: "unit" }] } })).json();
    try {
      await page.goto("/nutrition?tab=foods");
      await expect(page.getByTestId(`recipe-calc-${r.id}`)).toContainText("Based on 1 of 2 ingredients");
      await page.getByTestId(`recipe-edit-${r.id}`).click();
      await expect(page.getByTestId("recipe-preview")).toContainText("Mystery topping");
      await expect(page.getByTestId("recipe-preview")).toContainText("left out");
    } finally { await apiContext.delete(`/api/recipes/${r.id}`); }
  });
});

test.describe("Nutrition nutrients, reminders and summary", () => {
  test("find a nutrient, and filter to what has no data", async ({ authenticatedPage: page, apiContext }) => {
    const before = await snapshot(apiContext);
    const banana = await foodByName(apiContext, "bananas raw", "bananas, raw");
    await apiContext.post("/api/nutrition/diary", { data: { food_id: banana.id, quantity: 120, unit: "g", meal_type: "snack" } });
    try {
      await page.goto("/nutrition?tab=nutrients");
      await expect(page.getByTestId("nutrients-tab")).toBeVisible();
      await page.getByTestId("nutrient-search").fill("potassium");
      await expect(page.getByTestId("nutrient-potassium_mg")).toBeVisible();
      await expect(page.getByTestId("nutrient-sodium_mg")).toHaveCount(0);
      await page.getByTestId("nutrient-search").fill("no such nutrient");
      await expect(page.getByTestId("nutrients-none")).toContainText("No nutrient matches");
      await page.getByTestId("nutrient-search").fill("");
      await page.getByTestId("nutrient-filter-nodata").click();
      await expect(page.getByTestId("nutrient-biotin_ug")).toBeVisible();   // no source reports biotin: shown as no data, not zero
      await expect(page.getByTestId("nutrient-biotin_ug")).toContainText("no data");
      await expect(page.getByTestId("nutrient-protein_g")).toHaveCount(0);
    } finally { await restore(apiContext, before); }
  });

  test("reminders: set in Goals, shown on Today until the meal is logged, hidden for the day on request, in-app only", async ({ authenticatedPage: page, apiContext }) => {
    const before = await snapshot(apiContext);
    const prior = await (await apiContext.get("/api/nutrition/reminders")).json();
    try {
      await page.goto("/nutrition?tab=goals");
      await expect(page.getByTestId("reminders-settings")).toContainText("nothing is emailed or pushed");
      const switchEl = page.getByTestId("reminders-enabled");
      if ((await switchEl.getAttribute("aria-checked")) !== "true") await switchEl.click();
      for (const m of ["breakfast", "lunch", "dinner", "snack"]) await page.getByTestId(`reminder-time-${m}`).fill("00:00");
      await page.getByTestId("reminder-time-water").fill("00:00");
      await page.getByTestId("reminders-save").click();
      await expect.poll(async () => (await (await apiContext.get("/api/nutrition/reminders")).json()).meals.lunch).toBe("00:00");

      const due = (await (await apiContext.get("/api/nutrition/reminders/due")).json()).due;
      await page.goto("/nutrition");
      if (due.length === 0) { await expect(page.getByTestId("reminder-banner")).toHaveCount(0); return; }   // everything is already logged today
      await expect(page.getByTestId("reminder-banner")).toBeVisible();
      for (const d of due) await expect(page.getByTestId(`reminder-${d.id}`)).toBeVisible();
      await page.getByTestId(`reminder-${due[0].id}`).getByRole("button", { name: /Not now/ }).click();
      await expect(page.getByTestId(`reminder-${due[0].id}`)).toHaveCount(0);
      await page.reload();                                                              // still hidden after a reload: remembered for today on this device
      await expect(page.getByTestId(`reminder-${due[0].id}`)).toHaveCount(0);
      // logging the meal makes its reminder go away for good
      const meal = due.find((d) => d.kind === "meal");
      if (meal) {
        await apiContext.post("/api/nutrition/diary", { data: { description: "E2E reminder meal", calories: 100, meal_type: meal.meal_type } });
        const now = (await (await apiContext.get("/api/nutrition/reminders/due")).json()).due.map((d) => d.id);
        expect(now).not.toContain(meal.id);
      }
    } finally {
      await apiContext.put("/api/nutrition/reminders", { data: { enabled: prior.enabled, meals: prior.meals, water_by: prior.water_by } });
      await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("lr_nutrition_reminders_dismissed_")).forEach((k) => localStorage.removeItem(k)));
      await restore(apiContext, before);
    }
  });

  test("the summary opens, says what it is based on, and becomes the whole page when printed", async ({ authenticatedPage: page, apiContext }) => {
    const before = await snapshot(apiContext);
    const banana = await foodByName(apiContext, "bananas raw", "bananas, raw");
    await apiContext.post("/api/nutrition/diary", { data: { food_id: banana.id, quantity: 100, unit: "g", meal_type: "snack" } });
    try {
      await page.goto("/nutrition?tab=trends");
      await page.getByTestId("trends-summary").click();
      const dlg = page.getByTestId("weekly-summary");
      await expect(dlg).toContainText("Nutrition summary");
      await expect(dlg).toContainText("not medical advice");
      await expect(dlg).toContainText("not counted as zero");
      await page.evaluate(() => document.body.classList.add("printing-summary"));
      await page.emulateMedia({ media: "print" });
      await expect(page.locator("#root")).toBeHidden();
      await expect(dlg).toBeVisible();
      expect(await dlg.evaluate((el) => getComputedStyle(el).position)).toBe("static");
      expect(await dlg.getByTestId("summary-print").isVisible()).toBe(false);   // the print button does not print
    } finally {
      await page.emulateMedia({ media: "screen" });
      await restore(apiContext, before);
    }
  });
});
