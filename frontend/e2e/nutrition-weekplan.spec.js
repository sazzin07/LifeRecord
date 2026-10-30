import { test, expect } from "./fixtures";

// "Suggest a week": the proposal is previewed (nothing saved), items can be dropped one by one, and only the kept ones are added as planned
// (not eaten) entries. Runs as the standard test account; everything a test creates is removed.

async function planned(api, from, days) {
  const end = new Date(from + "T00:00:00"); end.setDate(end.getDate() + days - 1);
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  const p = await (await api.get(`/api/nutrition/plan?start=${from}&end=${to}`)).json();
  return p.days.flatMap((d) => d.entries);
}
async function dayInfo(api) {
  const d = await (await api.get("/api/nutrition/day")).json();
  return { today: d.today, entries: d.meals.flatMap((m) => m.entries).length };
}
async function stockRecipes(api, tag) {
  const f = await (await api.post("/api/nutrition/foods", { data: { name: `${tag} base`, nutrients: { energy_kcal: 110, protein_g: 9, fiber_g: 9 } } })).json();
  const rs = [];
  for (let i = 0; i < 3; i += 1) rs.push(await (await api.post("/api/recipes", { data: { name: `${tag} dish ${i}`, servings: 1, ingredients: [{ name: "base", quantity: 400 + i * 10, unit: "g", food_id: f.id }] } })).json());
  return { f, rs };
}

test.describe("Nutrition week suggestions", () => {
  test("preview first, drop what you do not want, and only the kept items are planned", async ({ authenticatedPage: page, apiContext }) => {
    const tag = `E2E-${Date.now()}`;
    const made = await stockRecipes(apiContext, tag);
    const { today, entries } = await dayInfo(apiContext);
    const before = new Set((await planned(apiContext, today, 5)).map((e) => e.id));
    try {
      await page.goto("/nutrition?tab=plan");
      await page.getByTestId("plan-generate").click();
      await expect(page.getByTestId("plan-options")).toBeVisible();
      await page.getByTestId("pg-days").click();
      await page.getByRole("option", { name: "3 days" }).click();
      await page.getByTestId("pg-slot-breakfast").click();            // lunch and dinner only
      await expect(page.getByTestId("pg-slot-breakfast")).toHaveAttribute("aria-pressed", "false");
      await page.getByTestId("pg-aim").click();
      await page.getByRole("option", { name: "More fibre" }).click();
      await page.getByTestId("pg-preview").click();
      const preview = page.getByTestId("plan-preview");
      await expect(preview).toContainText("proposed for");
      await expect(preview).toContainText("averages");                 // how the week compares with the reference
      const boxes = preview.getByRole("checkbox");
      const total = await boxes.count();
      expect(total).toBeGreaterThanOrEqual(2);
      expect((await planned(apiContext, today, 5)).filter((e) => !before.has(e.id))).toHaveLength(0);   // a preview saves nothing

      await boxes.first().click();                                     // drop the first item
      await expect(boxes.first()).not.toBeChecked();
      await expect(page.getByTestId("pg-apply")).toContainText(`Add ${total - 1} items`);
      await page.getByTestId("pg-apply").click();
      await expect(page.getByTestId("plan-generator")).not.toBeVisible();
      const added = (await planned(apiContext, today, 5)).filter((e) => !before.has(e.id));
      expect(added).toHaveLength(total - 1);
      expect(added.every((e) => e.status === "planned" && e.nutrients.energy_kcal > 0)).toBe(true);
      expect((await dayInfo(apiContext)).entries).toBe(entries);       // planned is not eaten
      await expect(page.getByTestId(`plan-item-${added[0].id}`)).toBeVisible();
    } finally {
      for (const e of (await planned(apiContext, today, 5)).filter((x) => !before.has(x.id))) await apiContext.delete(`/api/nutrition/plan/${e.id}`);
      for (const r of made.rs) await apiContext.delete(`/api/recipes/${r.id}`);
      await apiContext.delete(`/api/nutrition/foods/${made.f.id}`);
    }
  });

  test("changing options goes back without saving, and the dialog fits phone and tablet screens", async ({ authenticatedPage: page, apiContext }) => {
    const { today } = await dayInfo(apiContext);
    const before = new Set((await planned(apiContext, today, 7)).map((e) => e.id));
    for (const [w, h] of [[390, 844], [820, 1180]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/nutrition?tab=plan");
      await page.getByTestId("plan-generate").click();
      await page.getByTestId("pg-preview").click();
      await expect(page.getByTestId("plan-preview")).toBeVisible();
      const box = await page.getByTestId("plan-generator").boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await page.getByTestId("pg-back").click();
      await expect(page.getByTestId("plan-options")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("plan-generator")).not.toBeVisible();
    }
    expect((await planned(apiContext, today, 7)).filter((e) => !before.has(e.id))).toHaveLength(0);
  });
});
