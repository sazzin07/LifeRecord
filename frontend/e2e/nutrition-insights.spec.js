import fs from "node:fs";
import { test, expect } from "./fixtures";

// Trends: weekly and monthly averages for long ranges, and the Patterns and Nutrient density views. Runs as the standard test account;
// the entries a test adds (on days in the past) are removed again.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function food(api, q, starts) {
  const res = await (await api.get(`/api/nutrition/foods/search?q=${encodeURIComponent(q)}&limit=30`)).json();
  return res.find((f) => f.name.toLowerCase().startsWith(starts));
}
async function addDays(api, n) {
  const lentils = await food(api, "lentils cooked", "lentils, mature seeds, cooked, boiled");
  const spinach = await food(api, "spinach raw", "spinach, raw");
  const made = [];
  const today = new Date();
  for (let i = 1; i <= n; i += 1) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    for (const [meal, f, g, t] of [["lunch", lentils, 250, "13:10"], ["dinner", spinach, 150, "20:40"]]) {
      made.push((await (await api.post("/api/nutrition/diary", { data: { date: iso(d), meal_type: meal, food_id: f.id, quantity: g, unit: "g", eaten_at: t } })).json()).id);
    }
  }
  return made;
}
async function clean(api, ids) { for (const id of ids) await api.delete(`/api/nutrition/diary/${id}`); }

test.describe("Nutrition trends and insights", () => {
  test("patterns and variety describe the period, name the missing food groups, and say what they cannot judge", async ({ authenticatedPage: page, apiContext }) => {
    const made = await addDays(apiContext, 6);
    try {
      await page.goto("/nutrition?tab=trends");
      await page.getByTestId("range-30").click();
      await page.getByTestId("view-patterns").click();
      await expect(page.getByTestId("view-patterns")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("patterns-view")).toBeVisible();
      await expect(page.getByTestId("pattern-rhythm")).toContainText("days logged");
      await expect(page.getByTestId("pattern-rhythm")).toContainText("around");          // typical times from the entries that have one
      const variety = page.getByTestId("pattern-variety");
      await expect(variety).toContainText("different foods");
      await expect(variety.getByTestId("group-Legumes")).toContainText("seen");
      await expect(variety.getByTestId("group-Vegetables")).toContainText("seen");
      await page.getByRole("button", { name: "About these numbers" }).click();
      await expect(page.getByText("Descriptions, not medical advice")).toBeVisible();
      await page.keyboard.press("Escape");
      // the group chips never rely on colour alone
      expect(await variety.getByTestId("group-Legumes").innerText()).toMatch(/Legumes/);
      expect(await page.getByTestId("group-Legumes").locator(".sr-only").innerText()).toContain("seen");
    } finally { await clean(apiContext, made); }
  });

  test("nutrient density is its own view: a ladder around the reference, where each nutrient came from, which foods are rich in it, and what cannot be judged", async ({ freshUserPage: { page, fresh } }) => {
    const apiContext = fresh.api;
    await addDays(apiContext, 6);
    {
      await page.goto("/nutrition?tab=trends");
      await page.getByTestId("range-30").click();
      await page.getByTestId("view-density").click();
      const dens = page.getByTestId("pattern-density");
      await expect(dens).toBeVisible();
      await expect(page.getByTestId("pattern-insights")).toHaveCount(0);       // the insights belong to Patterns, not to Density
      await expect(page.getByTestId("pattern-rhythm")).toHaveCount(0);
      // the account has other entries too, so the rungs are taken from what the server judged reliable
      const pat = await (await apiContext.get("/api/nutrition/patterns?days=30")).json();
      const judged = pat.density.filter((x) => x.reliable);
      expect(judged.length).toBeGreaterThan(3);
      const ladder = [...judged].sort((a, b) => a.ratio - b.ratio);          // the page opens the biggest gap by itself, so the test uses the next two rungs
      const one = ladder[1], two = ladder[2];
      const rung = dens.getByTestId(`density-${one.nutrient}`);
      await expect(rung.getByRole("button")).toHaveAttribute("aria-label", /per 1,000 kcal, \d+% of the reference of/);
      await rung.getByRole("button").click();
      const detail = dens.getByTestId(`density-detail-${one.nutrient}`);
      await expect(detail).toContainText("Where it came from in this period");
      await expect(detail).toContainText("Whole foods rich in it");
      // only one rung is open at a time, and pressing it again closes it
      await dens.getByTestId(`density-${two.nutrient}`).getByRole("button").click();
      await expect(detail).toHaveCount(0);
      await expect(dens.getByTestId(`density-detail-${two.nutrient}`)).toBeVisible();
      await dens.getByTestId(`density-${two.nutrient}`).getByRole("button").click();
      await expect(dens.getByTestId(`density-detail-${two.nutrient}`)).toHaveCount(0);
      // a nutrient that most of the energy never reported is kept apart, not judged
      for (const r of pat.density.filter((x) => !x.reliable)) await expect(dens.getByTestId("density-unsure").getByTestId(`density-${r.nutrient}`)).toBeVisible();
      // a rich food can be logged from here: the add dialog opens on it
      await rung.getByRole("button").click();
      await expect(dens.locator('[data-testid^="density-log-"]').first()).toBeVisible();
      await dens.locator('[data-testid^="density-log-"]').first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      // the caveat is one press away
      await dens.getByRole("button", { name: "How to read nutrient density" }).click();
      await expect(page.getByText("not counted as zero")).toBeVisible();
    }
  });

  test("six months show weekly averages and a year shows monthly averages, and the CSV follows", async ({ authenticatedPage: page }) => {
    await page.goto("/nutrition?tab=trends");
    await page.getByTestId("range-180").click();
    await expect(page.getByText("Average energy per week")).toBeVisible();
    await page.getByRole("button", { name: "About the chart" }).click();
    await expect(page.getByText("Each bar is the average of the days you logged in that week")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("range-365").click();
    await expect(page.getByText("Average energy per month")).toBeVisible();
    const dl = page.waitForEvent("download");
    await page.getByTestId("trends-download").click();
    const file = await (await dl).path();
    const header = fs.readFileSync(file, "utf8").split("\n")[0];
    expect(header).toBe("date,end,days_logged,logged,entries,energy_kcal,protein_g,carbs_g,fat_g,fiber_g,sugars_g,sat_fat_g,sodium_mg,drinks_ml");
  });

  test("an empty stretch says so instead of showing zeros, in every view", async ({ authenticatedPage: page }) => {
    await page.goto("/nutrition?tab=trends&date=2019-03-01");
    for (const v of ["overview", "patterns", "density"]) {
      await page.getByTestId(`view-${v}`).click();
      await expect(page.getByTestId("trends-tab")).toContainText(/Nothing is logged in this period yet|Log a few more days/);
    }
  });

  test("the views and ranges fit phone and tablet screens", async ({ authenticatedPage: page, apiContext }) => {
    const made = await addDays(apiContext, 4);
    try {
      for (const [w, h] of [[390, 844], [820, 1180]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto("/nutrition?tab=trends");
        for (const v of ["overview", "patterns", "density"]) {
          await page.getByTestId(`view-${v}`).click();
          await page.waitForTimeout(300);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${v} at ${w}px`).toBeLessThanOrEqual(0);
        }
        await page.getByTestId("range-365").click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `365 days at ${w}px`).toBeLessThanOrEqual(0);
      }
    } finally { await clean(apiContext, made); }
  });
});
