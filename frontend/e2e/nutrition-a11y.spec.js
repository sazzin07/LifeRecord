import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

// Automated accessibility audit (axe-core, WCAG 2.0/2.1/2.2 A and AA rules) of every Nutrition tab and dialog at desktop, tablet and phone
// widths, in the light and the dark theme. It finds what a machine can find (contrast, names, roles, labels, landmarks, focus order hints);
// it does not replace a screen-reader pass. It also checks that nothing overflows sideways at any width. Runs as the standard test account; the
// data a test adds is removed again. Set A11Y_LIST=1 to print one line per offending element (rule, selector, colours) while fixing findings.

const DAY = "2019-03-04";
const WIDTHS = [["desktop", { width: 1280, height: 800 }], ["tablet", { width: 820, height: 1180 }], ["phone", { width: 390, height: 844 }]];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page, label) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const lines = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join("\n   ")}`);
  if (process.env.A11Y_LIST) for (const v of results.violations) for (const n of v.nodes) console.log(`A11Y|${label}|${v.id}|${v.impact}|${n.target.join(" ")}|${(n.any[0] || n.all[0] || n.none[0] || {}).message || ""}|${n.html.slice(0, 110).replace(/\s+/g, " ")}`);
  expect.soft(lines, `${label}: ${results.violations.length} accessibility violation(s)\n${lines.join("\n")}`).toEqual([]);
  const sideways = await page.evaluate(() => {
    const dlg = document.querySelector("[role=dialog]");
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, dialog: dlg ? dlg.scrollWidth - dlg.clientWidth : 0 };
  });
  expect.soft(sideways.page, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
  expect.soft(sideways.dialog, `${label}: the dialog scrolls sideways`).toBeLessThanOrEqual(1);
}

async function setTheme(page, theme) {
  await page.addInitScript((t) => { try { localStorage.setItem("lm_theme", JSON.stringify(t)); } catch { /* storage unavailable */ } }, theme);
}

async function search(api, q, starts) {
  const res = await (await api.get(`/api/nutrition/foods/search?q=${encodeURIComponent(q)}&limit=30`)).json();
  return res.find((f) => f.name.toLowerCase().startsWith(starts));
}

test.describe("Nutrition accessibility (axe-core)", () => {
  let tag; let made = []; let foods = []; let recipe; let plan;
  test.beforeAll(async ({ apiContext }) => {
    tag = `E2E-${Date.now()}`;
    const lentils = await search(apiContext, "lentils cooked", "lentils, mature seeds, cooked, boiled");
    const zinc = await (await apiContext.post("/api/nutrition/foods", { data: { name: `${tag} zinc crisps`, nutrients: { energy_kcal: 400, zinc_mg: 30, protein_g: 5 } } })).json();
    foods = [zinc];
    for (const [meal, f, g] of [["lunch", lentils, 250], ["dinner", zinc, 100]]) {
      made.push((await (await apiContext.post("/api/nutrition/diary", { data: { date: DAY, meal_type: meal, food_id: f.id, quantity: g, unit: "g" } })).json()).id);
    }
    recipe = await (await apiContext.post("/api/recipes", { data: { name: `${tag} lentil dish`, servings: 2, ingredients: [{ name: "Lentils", quantity: 200, unit: "g", food_id: lentils.id }] } })).json();
    const today = (await (await apiContext.get("/api/nutrition/day")).json()).today;
    plan = await (await apiContext.post("/api/nutrition/plan", { data: { date: today, meal_type: "dinner", recipe_id: recipe.id, quantity: 1 } })).json();
  });
  test.afterAll(async ({ apiContext }) => {
    for (const id of made) await apiContext.delete(`/api/nutrition/diary/${id}`);
    if (plan?.id) await apiContext.delete(`/api/nutrition/plan/${plan.id}`);
    if (recipe?.id) await apiContext.delete(`/api/recipes/${recipe.id}`);
    for (const f of foods) await apiContext.delete(`/api/nutrition/foods/${f.id}`);
  });

  for (const theme of ["light", "dark"]) {
    for (const [size, viewport] of WIDTHS) {
      test(`tabs, ${theme} theme, ${size}`, async ({ authenticatedPage: page }) => {
        await setTheme(page, theme);
        await page.setViewportSize(viewport);
        for (const tab of ["today", "plan", "nutrients", "trends", "foods", "goals"]) {
          await page.goto(`/nutrition?tab=${tab}&date=${DAY}`);
          await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute("data-state", "active");
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(700);   // let bars and charts finish their entrance motion before measuring contrast
          await audit(page, `${tab} tab, ${theme}, ${size}`);
        }
      });

      test(`dialogs, ${theme} theme, ${size}`, async ({ authenticatedPage: page }) => {
        await setTheme(page, theme);
        await page.setViewportSize(viewport);
        const open = async (url, trigger, dialog, label) => {
          await page.goto(url);
          await page.getByTestId(trigger).click();
          await expect(page.getByTestId(dialog)).toBeVisible();
          await page.waitForTimeout(500);
          await audit(page, `${label}, ${theme}, ${size}`);
          await page.keyboard.press("Escape");
          await expect(page.getByTestId(dialog)).not.toBeVisible();
        };
        await open(`/nutrition?date=${DAY}`, "header-add-food", "food-dialog", "add food dialog");
        await open("/nutrition?tab=foods", "new-recipe", "recipe-dialog", "recipe dialog");
        await open("/nutrition?tab=goals", "goal-edit-energy_kcal", "target-dialog", "target dialog");
        await open("/nutrition?tab=plan", "plan-generate", "plan-generator", "week suggestion dialog");
      });
    }
  }
});
