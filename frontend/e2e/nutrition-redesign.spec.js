import { test, expect } from "./fixtures";
import { prepare, settle } from "./support/a11y";

// The redesigned Nutrition page (docs/superpowers/specs/2026-11-05-nutrition-redesign-design.md): the orb with what is left of the day, the macro chips, one-tap
// water, the replay of the day, the curve through the day, the constellation of nutrients. Each test has an account of its own (made and removed by the fixture), so
// nothing it logs can change what another spec sees (the foods you eat often, the suggestions).
test.describe.configure({ timeout: 120_000 });

async function food(api, q) {
  const res = await (await api.get(`/api/nutrition/foods/search?q=${encodeURIComponent(q)}&limit=5`)).json();
  return Array.isArray(res) ? res[0] : res.items?.[0];
}

test.describe("Nutrition: the day", () => {
  test.beforeEach(async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "dark", { width: 1360, height: 900 });
    const day = new Date().toISOString().slice(0, 10);
    for (const [meal, q, g] of [["breakfast", "oats", 60], ["lunch", "chicken breast", 150], ["snack", "almonds", 30]]) {
      const f = await food(fresh.api, q);
      if (f) await fresh.api.post("/api/nutrition/diary", { data: { date: day, meal_type: meal, food_id: f.id, quantity: g, unit: "g" } });
    }
  });

  test("the orb says what is left, the chips say where the macros stand, the day curve is drawn", async ({ freshUserPage: { page } }) => {
    await page.goto("/nutrition");
    await settle(page);
    const orb = page.getByTestId("orb");
    await expect(orb).toBeVisible();
    await expect(page.getByTestId("energy-left")).toContainText(/\d/);
    await expect(orb.locator("circle")).toHaveCount(12);                        // a track, a ring and a touch target for energy, protein, carbs and fat
    await expect(page.getByTestId("chip-protein_g")).toContainText("protein");
    await expect(page.getByTestId("day-ledger")).toBeVisible();
    await expect(page.getByTestId("day-curve")).toBeVisible();
  });

  test("the curve can be scrubbed: the pointer reads the energy eaten by that hour", async ({ freshUserPage: { page } }) => {
    await page.goto("/nutrition");
    await settle(page);
    const box = await page.getByTestId("day-curve").locator("svg").boundingBox();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5);
    await expect(page.getByTestId("day-curve")).toContainText("kcal so far");
  });

  test("Replay the day plays the entries back in order and then settles", async ({ freshUserPage: { page } }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });                         // a short replay
    await page.goto("/nutrition");
    await settle(page);
    const left = page.getByTestId("energy-left");
    const before = await left.innerText();
    await page.getByTestId("replay-day").click();
    await expect(page.getByTestId("orb")).toContainText("eaten so far");
    await expect(page.getByTestId("orb")).toContainText("kcal left", { timeout: 8000 });
    expect(await left.innerText()).toBe(before);
  });

  test("one tap on the next glass adds 250 ml of water", async ({ freshUserPage: { page } }) => {
    await page.goto("/nutrition");
    await settle(page);
    const total = page.getByTestId("water-total");
    const before = parseFloat((await total.innerText()).replace(",", "."));
    await page.getByTestId("quick-water").getByRole("button", { name: /Add a glass/ }).click();
    await expect.poll(async () => parseFloat((await total.innerText()).replace(",", ".")), { timeout: 8000 }).toBeGreaterThan(before);
  });

  test("the orb and the day figures stay beside every view that looks at a day, and Plan and Goals have the full width", async ({ freshUserPage: { page } }) => {
    await page.goto("/nutrition");
    await settle(page);
    for (const tab of ["nutrients", "trends", "foods"]) { await page.getByTestId(`tab-${tab}`).click(); await expect(page.getByTestId("orb")).toBeVisible(); }
    for (const tab of ["plan", "goals"]) { await page.getByTestId(`tab-${tab}`).click(); await expect(page.getByTestId("orb")).toBeHidden(); }
  });

  test("the nutrient table shows every nutrient as a tile in its group, reads one out on hover, and hands a pressed one to the list", async ({ freshUserPage: { page } }) => {
    await page.goto("/nutrition?tab=nutrients");
    await settle(page);
    const tiles = page.locator('[data-testid^="tile-"]');
    expect(await tiles.count()).toBeGreaterThan(30);
    for (const g of ["macro", "fat", "vitamin", "mineral"]) await expect(page.getByTestId(`table-group-${g}`)).toBeVisible();
    const protein = page.getByTestId("tile-protein_g");
    await expect(protein).toContainText("Protein");                                  // the full name is in the tile's accessible name
    await protein.hover();
    const read = page.getByTestId("table-readout");
    await expect(read).toContainText("Protein");
    await expect(read).toContainText("%");
    await page.mouse.move(5, 5);
    await expect(read).not.toContainText("Protein");
    await protein.click();
    await expect(page.getByTestId("nutrient-protein_g").getByRole("button", { name: /Protein/ }).first()).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("nutrient-protein_g")).toBeInViewport();
    // the filters act on the tiles too: what does not match is dimmed
    await page.getByTestId("nutrient-filter-nodata").click();
    const total = await tiles.count();
    const dimmed = await tiles.evaluateAll((els) => els.filter((el) => Number(getComputedStyle(el).opacity) < 0.6).length);
    const shown = Number((await page.getByTestId("nutrient-filter-nodata").innerText()).replace(/\D/g, ""));
    await expect.poll(async () => tiles.evaluateAll((els) => els.filter((el) => Number(getComputedStyle(el).opacity) < 0.6).length), { timeout: 4000 }).toBe(total - shown);
    expect(dimmed).toBeGreaterThanOrEqual(0);
    // the words that used to fill the page are one press away
    await page.getByRole("button", { name: "How to read the nutrients" }).click();
    await expect(page.getByText("not the same as zero")).toBeVisible();
  });

  test("on a phone the strip leads, the logging bar is on the first screen, and nothing is wider than the screen", async ({ freshUserPage: { page } }) => {
    await prepare(page, "light", { width: 390, height: 844 });
    await page.goto("/nutrition");
    await settle(page);
    await expect(page.getByTestId("day-strip")).toBeVisible();
    await expect(page.getByTestId("quick-add")).toBeInViewport();
    await page.getByTestId("day-strip").getByRole("button").click();
    await expect(page.getByTestId("orb")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
