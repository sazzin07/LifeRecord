import { test, expect } from "./fixtures";

// Reference values for children and teenagers (EFSA 2017) and EFSA's upper levels. Runs as the standard test account: the profile is
// changed for the test and put back afterwards, and the food and entry it adds are removed.

const DAY = "2019-03-04";
const year = new Date().getFullYear();

async function restoreProfile(api, before) {
  if (before.exists) {
    await api.put("/api/nutrition/profile", { data: { birth_year: before.birth_year, sex: before.sex, height_cm: before.height_cm, weight_kg: before.weight_kg, activity: before.activity, pregnancy: before.pregnancy, diet_tags: before.diet_tags, allergies: before.allergies, timezone: before.timezone } });
  } else {
    await api.delete("/api/nutrition/profile");
  }
}

test.describe("Reference values by age, and upper levels", () => {
  test("a teenager sees EFSA's values for their age, and a day above an upper level says so without alarm", async ({ authenticatedPage: page, apiContext }) => {
    const before = await (await apiContext.get("/api/nutrition/profile")).json();
    const tag = `E2E-${Date.now()}`;
    const crisps = await (await apiContext.post("/api/nutrition/foods", { data: { name: `${tag} zinc crisps`, nutrients: { energy_kcal: 400, zinc_mg: 30, folate_ug: 900 } } })).json();
    let entry;
    try {
      expect((await apiContext.put("/api/nutrition/profile", { data: { birth_year: year - 14, sex: "F", weight_kg: 50, activity: "moderate", pregnancy: null, diet_tags: [], allergies: [], timezone: before.timezone } })).ok()).toBe(true);
      entry = await (await apiContext.post("/api/nutrition/diary", { data: { date: DAY, meal_type: "lunch", food_id: crisps.id, quantity: 100, unit: "g" } })).json();

      // Today: the banner names the nutrient and the level, and frames it as a prompt to look
      await page.goto(`/nutrition?date=${DAY}`);
      const banner = page.getByTestId("upper-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("Zinc");
      await expect(banner).toContainText("18 mg");
      await expect(banner).toContainText("not a finding");
      await expect(banner).not.toContainText("Folate");   // the folate level covers folic acid only, so it is never compared with logged food

      // Nutrients: the detail says what each level covers
      await page.getByTestId("tab-nutrients").click();
      await expect(page.getByTestId("upper-banner")).toBeVisible();
      await page.getByTestId("nutrient-zinc_mg").locator("button").first().click();
      await expect(page.getByTestId("upper-zinc_mg")).toContainText("Upper level 18 mg a day");
      await expect(page.getByTestId("upper-zinc_mg")).toContainText("above it");
      await page.getByTestId("nutrient-folate_ug").locator("button").first().click();
      await expect(page.getByTestId("upper-folate_ug")).toContainText("Not compared");

      // Goals: age-specific targets, upper and safe levels, and the child note
      await page.getByTestId("tab-goals").click();
      await expect(page.getByTestId("goal-protein_g")).toContainText("44");               // PRI 0.87 g per kg at 14 (girls) x 50 kg = 43.5
      await expect(page.getByTestId("goal-upper-zinc_mg")).toContainText("Upper level 18 mg");
      await expect(page.getByTestId("goal-upper-iron_mg")).toContainText("Safe level 30 mg");
      await expect(page.getByTestId("goal-upper-iron_mg")).toContainText("not a limit");
      await expect(page.getByTestId("goals-tab")).toContainText("not a growth chart");
      await expect(page.getByTestId("sources-card")).toContainText("Tolerable Upper Intake Levels");
    } finally {
      if (entry?.id) await apiContext.delete(`/api/nutrition/diary/${entry.id}`);
      await apiContext.delete(`/api/nutrition/foods/${crisps.id}`);
      await restoreProfile(apiContext, before);
    }
  });

  test("a baby gets no values and is pointed to a doctor, an adult gets the adult ones", async ({ authenticatedPage: page, apiContext }) => {
    const before = await (await apiContext.get("/api/nutrition/profile")).json();
    try {
      expect((await apiContext.put("/api/nutrition/profile", { data: { birth_year: year, sex: "F", pregnancy: null, diet_tags: [], allergies: [], timezone: before.timezone } })).ok()).toBe(true);
      await page.goto("/nutrition?tab=goals");
      await expect(page.getByTestId("goals-tab")).toContainText("start at 1 year");
      await expect(page.getByTestId("goal-energy_kcal")).toHaveCount(0);

      expect((await apiContext.put("/api/nutrition/profile", { data: { birth_year: year - 35, sex: "F", weight_kg: 62, activity: "moderate", pregnancy: null, diet_tags: [], allergies: [], timezone: before.timezone } })).ok()).toBe(true);
      await page.goto("/nutrition?tab=goals");
      await expect(page.getByTestId("goal-energy_kcal")).toBeVisible();
      await expect(page.getByTestId("goal-upper-zinc_mg")).toContainText("Upper level 25 mg");
      await expect(page.getByTestId("goals-tab")).not.toContainText("not a growth chart");
    } finally {
      await restoreProfile(apiContext, before);
    }
  });
});
