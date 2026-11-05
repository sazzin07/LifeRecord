import { test, expect } from "./fixtures";
import { prepare, settle } from "./support/a11y";

// The refined tabs, control by control: Trends (the chart and the average day), Plan (the week rail, the reasons for disabled buttons), Goals (the groups), Foods,
// the shortened text with its (i) notes, and the assistant entry from the quick-add bar. Each test has an account of its own (made and removed by the fixture).
test.describe.configure({ timeout: 120_000 });

const iso = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
async function food(api, q) {
  const res = await (await api.get(`/api/nutrition/foods/search?q=${encodeURIComponent(q)}&limit=5`)).json();
  return Array.isArray(res) ? res[0] : res.items?.[0];
}
async function seedDays(fresh, days = 5) {
  const set = [["breakfast", "oats", 60], ["lunch", "chicken breast", 150], ["dinner", "rice", 200]];
  for (let d = 0; d < days; d += 1) for (const [meal, q, g] of set) { const f = await food(fresh.api, q); if (f) await fresh.api.post("/api/nutrition/diary", { data: { date: iso(d), meal_type: meal, food_id: f.id, quantity: g, unit: "g" } }); }
}
const tip = (page, name) => page.getByRole("button", { name });

test.describe("Trends", () => {
  test("the bars read one day on hover and with the arrow keys, nothing is written on them, and a day with nothing logged is a dot", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await seedDays(fresh, 4);                                                // today and three days back; the other days of the week stay empty
    await page.goto("/nutrition?tab=trends");
    await settle(page);
    const chart = page.getByTestId("week-bars");
    await expect(chart).toBeVisible();
    await expect(page.getByTestId("week-readout")).toContainText("Average");
    const group = chart.getByRole("group");
    await group.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 250);                                          // the chart is high on the screen, clear of the dock
    await page.waitForTimeout(600);
    const box = await group.boundingBox();
    await page.mouse.move(box.x + box.width - 40, box.y + 40);               // the last bar: today
    await expect(page.getByTestId("week-readout")).toContainText("% of the reference");
    await page.mouse.move(box.x + 60, box.y + 40);                           // the first bar: nothing logged six days ago
    await expect(page.getByTestId("week-readout")).toContainText("nothing logged");
    await page.mouse.move(5, 5);
    await expect(page.getByTestId("week-readout")).toContainText("Average");
    await group.focus();
    await page.keyboard.press("End");
    await expect(page.getByTestId("week-readout")).toContainText("kcal");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("week-readout")).toContainText("kcal");
    await page.keyboard.press("Home");
    await expect(page.getByTestId("week-readout")).toContainText("nothing logged");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("week-readout")).toContainText("Average");
    // the chart text is only the axes: no label sits on a bar
    expect(await chart.locator("svg text").count()).toBeLessThanOrEqual(12);
    await page.getByTestId("range-90").click();
    await expect(page.getByTestId("week-bars")).toBeVisible();
  });

  test("the average day is the same table of tiles as Nutrients, with the long list one press away", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await seedDays(fresh, 3);
    await page.goto("/nutrition?tab=trends");
    await settle(page);
    const table = page.getByTestId("average-table");
    await expect(table).toBeVisible();
    for (const g of ["macro", "fat", "vitamin", "mineral"]) await expect(table.getByTestId(`table-group-${g}`)).toBeVisible();
    await table.getByTestId("tile-protein_g").hover();
    await expect(table.getByTestId("table-readout")).toContainText("Protein");
    await expect(page.getByTestId("trend-protein_g")).toHaveCount(0);
    await page.getByTestId("trends-all-values").click();
    await expect(page.getByTestId("trend-protein_g")).toBeVisible();
    await page.getByTestId("trends-all-values").click();
    await expect(page.getByTestId("trend-protein_g")).toHaveCount(0);
  });

  test("Summary opens, the period note is one press away, and a range with nothing logged says so in every view", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await seedDays(fresh, 2);
    await page.goto("/nutrition?tab=trends");
    await settle(page);
    await page.getByTestId("trends-summary").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await tip(page, "About the averages").click();
    await expect(page.getByText("a day without entries is not counted as zero")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/nutrition?tab=trends&date=2019-03-01");
    for (const v of ["overview", "patterns", "density"]) {
      await page.getByTestId(`view-${v}`).click();
      await expect(page.getByTestId("trends-tab")).toContainText(/Nothing is logged in this period yet/);
    }
  });

  test("Patterns carries the insights, rhythm and variety; Density carries none of them", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await seedDays(fresh, 5);
    await page.goto("/nutrition?tab=trends");
    await settle(page);
    await page.getByTestId("view-patterns").click();
    await expect(page.getByTestId("pattern-rhythm")).toBeVisible();
    await expect(page.getByTestId("pattern-variety")).toBeVisible();
    await expect(page.getByTestId("pattern-density")).toHaveCount(0);
    await page.getByTestId("view-density").click();
    await expect(page.getByTestId("pattern-density")).toBeVisible();
    await expect(page.getByTestId("pattern-rhythm")).toHaveCount(0);
    await expect(page.getByTestId("pattern-variety")).toHaveCount(0);
    await expect(page.getByTestId("pattern-insights")).toHaveCount(0);
  });
});

test.describe("Plan", () => {
  test("the week rail shows seven days, a press brings the day into view, and Copy and Shopping list say why they wait", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await page.goto("/nutrition?tab=plan");
    await settle(page);
    await expect(page.getByTestId("day-ledger")).toBeHidden();
    const rail = page.getByTestId("week-rail");
    await expect(rail.getByRole("button")).toHaveCount(7);
    await expect(page.getByTestId("plan-empty")).toBeVisible();
    await expect(page.getByTestId("plan-copy-week")).toBeDisabled();
    await expect(page.getByTestId("plan-shopping")).toBeDisabled();
    await expect(page.getByTestId("plan-copy-week").locator("xpath=..")).toHaveAttribute("title", /Plan something/);
    await tip(page, "About the plan").click();
    await expect(page.getByText("only counts once you tap")).toBeVisible();
    await page.keyboard.press("Escape");
    // plan something: the hint goes, the buttons wake, the rail shows it
    const f = await food(fresh.api, "oats");
    const today = (await (await fresh.api.get("/api/nutrition/day")).json()).today;
    expect((await fresh.api.post("/api/nutrition/plan", { data: { date: today, meal_type: "breakfast", food_id: f.id, quantity: 60, unit: "g" } })).ok()).toBe(true);
    await page.reload();
    await settle(page);
    await expect(page.getByTestId("plan-empty")).toHaveCount(0);
    await expect(page.getByTestId("plan-copy-week")).toBeEnabled();
    await expect(page.getByTestId("plan-shopping")).toBeEnabled();
    await expect(rail.getByTestId(`rail-${today}`)).toContainText(/\d/);
    await page.getByTestId("week-next").click();
    await expect(page.getByTestId("plan-empty")).toBeVisible();
    await page.getByTestId("week-this").click();
    await expect(page.getByTestId(`plan-day-${today}`)).toBeVisible();
    await rail.getByTestId(`rail-${today}`).click();
    await expect(page.getByTestId(`plan-day-${today}`)).toBeInViewport();
  });
});

test.describe("Goals", () => {
  test("targets come in groups: energy, macros and fats open, vitamins and minerals on a press, and a target can be edited and reset", async ({ freshUserPage: { page } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await page.goto("/nutrition?tab=goals");
    await settle(page);
    await expect(page.getByTestId("day-ledger")).toBeHidden();
    await expect(page.getByTestId("goal-toggle-macro")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("goal-toggle-fat")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("goal-toggle-vitamin")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("goal-vit_c_mg")).toHaveCount(0);
    await page.getByTestId("goal-toggle-vitamin").click();
    await expect(page.getByTestId("goal-vit_c_mg")).toBeVisible();
    await page.getByTestId("goal-toggle-vitamin").click();
    await expect(page.getByTestId("goal-vit_c_mg")).toHaveCount(0);
    await page.getByTestId("goal-toggle-mineral").click();
    await expect(page.getByTestId("goal-calcium_mg")).toBeVisible();
    await page.getByTestId("goal-edit-calcium_mg").click();
    await page.getByTestId("target-target").fill("1000");
    await page.getByTestId("target-save").click();
    await expect(page.getByTestId("goal-calcium_mg")).toContainText("Your target");
    await expect(page.getByTestId("goal-calcium_mg")).toContainText("1,000");
    await page.getByRole("button", { name: "Reset Calcium to suggested" }).click();
    await expect(page.getByTestId("goal-calcium_mg")).not.toContainText("Your target");
    // the sentences that used to open each block are behind (i)
    await tip(page, "About these details").click();
    await expect(page.getByText("stay in your account")).toBeVisible();
    await page.keyboard.press("Escape");
    await tip(page, "About reminders").click();
    await expect(page.getByText("Leave a time empty for no reminder")).toBeVisible();
  });
});

test.describe("Foods and Today", () => {
  test("Foods has the day panel beside it, a search that finds foods, and the database note one press away", async ({ freshUserPage: { page } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await page.goto("/nutrition?tab=foods");
    await settle(page);
    await expect(page.getByTestId("day-ledger")).toBeVisible();
    await page.getByTestId("foods-search").fill("banana");
    await expect(page.getByTestId("foods-results")).toContainText(/banana/i);
    await tip(page, "About the food database").click();
    await expect(page.getByText("About 8,000 USDA reference foods")).toBeVisible();
  });

  test("Today keeps the warnings and moves the explanations behind (i); an insight reads in one line", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    const f = await food(fresh.api, "oats");
    await fresh.api.post("/api/nutrition/diary", { data: { date: iso(0), meal_type: "breakfast", food_id: f.id, quantity: 40, unit: "g" } });
    await page.goto("/nutrition");
    await settle(page);
    const card = page.getByTestId("insights-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("from what you have logged");
    await expect(card).not.toContainText("is not a deficiency");            // the long caveat is not on the page until asked for
    await card.getByRole("button", { name: "More about this" }).first().click();
    await expect(page.getByText("not a deficiency").first()).toBeVisible();
  });

  test("typing a meal offers the assistant: the button opens it with the words already in its box", async ({ freshUserPage: { page } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await page.goto("/nutrition");
    await settle(page);
    await expect(page.getByRole("button", { name: "Ask the assistant to log this" })).toHaveCount(0);
    await page.getByTestId("quick-add-input").fill("two eggs and toast");
    await page.getByRole("button", { name: "Ask the assistant to log this" }).click();
    await expect(page.getByTestId("ai-input")).toBeVisible();
    await expect(page.getByTestId("ai-input")).toHaveValue(/two eggs and toast/);
  });
});
