import { test, expect } from "./fixtures";
import { prepare, settle } from "./support/a11y";

// The refined Nutrition layout: the day panel follows the tab, never overlaps or clips, becomes a strip below 1024 px; the orb's figure always sits inside its
// rings and the rings can be read by hover, focus and tap. Each test has an account of its own (made and removed by the fixture).
test.describe.configure({ timeout: 120_000 });

async function food(api, q) {
  const res = await (await api.get(`/api/nutrition/foods/search?q=${encodeURIComponent(q)}&limit=5`)).json();
  return Array.isArray(res) ? res[0] : res.items?.[0];
}
async function log(fresh, meal, q, g, times = 1) {
  const f = await food(fresh.api, q);
  const day = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < times; i += 1) if (f) await fresh.api.post("/api/nutrition/diary", { data: { date: day, meal_type: meal, food_id: f.id, quantity: g, unit: "g" } });
}
const seed = async (fresh) => { await log(fresh, "breakfast", "oats", 60); await log(fresh, "lunch", "chicken breast", 150); await log(fresh, "snack", "almonds", 30); };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const box = async (loc) => (await loc.boundingBox());
// a point on a ring (the middle of a ring's own box is the empty centre of the orb, so the mouse is sent to the ring itself)
const RING_R = { energy: 148, protein_g: 130, carbs_available_g: 114, fat_g: 98 };
async function ringPoint(page, key) {
  const b = await page.getByTestId("orb").locator("svg").first().boundingBox();
  const s = b.width / 320, a = (125 * Math.PI) / 180;
  return { x: b.x + b.width / 2 + Math.cos(a) * RING_R[key] * s, y: b.y + b.height / 2 + Math.sin(a) * RING_R[key] * s };
}
const hoverRing = async (page, key) => { const p = await ringPoint(page, key); await page.mouse.move(p.x, p.y); };
const clickRing = async (page, key) => { const p = await ringPoint(page, key); await page.mouse.click(p.x, p.y); };

test.describe("The day panel follows the tab", () => {
  test("it is beside Today, Nutrients, Trends and Foods and gives its width to Plan and Goals, then takes it back", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "dark", { width: 1440, height: 900 });
    await seed(fresh);
    await page.goto("/nutrition");
    await settle(page);
    for (const tab of ["today", "nutrients", "trends", "foods"]) {
      await page.getByTestId(`tab-${tab}`).click();
      await expect(page.getByTestId("day-ledger")).toBeVisible();
      await expect(page.getByTestId("orb")).toBeVisible();
    }
    const withPanel = await box(page.getByTestId("quick-add"));
    for (const tab of ["plan", "goals"]) {
      await page.getByTestId(`tab-${tab}`).click();
      await expect(page.getByTestId("day-ledger")).toBeHidden();
      await expect.poll(async () => (await box(page.getByTestId("quick-add"))).width, { timeout: 5000 }).toBeGreaterThan(withPanel.width + 250);
    }
    await page.getByTestId("tab-today").click();
    await expect(page.getByTestId("day-ledger")).toBeVisible();
    await expect.poll(async () => Math.abs((await box(page.getByTestId("quick-add"))).width - withPanel.width), { timeout: 5000 }).toBeLessThan(2);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("it stays in view while the page scrolls and never touches the content beside it", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1440, height: 900 });
    await seed(fresh);
    await page.goto("/nutrition?tab=nutrients");
    await settle(page);
    await page.mouse.move(900, 400);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(500);
    const panel = await box(page.getByTestId("day-ledger"));
    const main = await box(page.getByTestId("quick-add"));
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(900);
    expect(panel.x + panel.width).toBeLessThanOrEqual(main.x);
  });

  test("on a short laptop screen the panel scrolls inside itself instead of being cut off", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1280, height: 640 });
    await seed(fresh);
    await page.goto("/nutrition");
    await settle(page);
    // the whole orb is on screen at once, and once the page has scrolled the panel sits under the top bar with its bottom edge inside the screen
    await page.mouse.move(900, 400);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(500);
    const panel = await box(page.getByTestId("day-ledger"));
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.y + panel.height).toBeLessThanOrEqual(640);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300);
    const room = await page.getByTestId("day-ledger").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(room.scroll).toBeGreaterThanOrEqual(room.client);
    // the whole orb is on screen: the energy figure is visible without scrolling the page
    await expect(page.getByTestId("energy-left")).toBeInViewport();
  });

  test("below 1024 px the panel is a slim strip that stays under the top bar and opens the whole day in a sheet", async ({ freshUserPage: { page, fresh } }) => {
    await seed(fresh);
    for (const [w, h] of [[820, 1100], [390, 844]]) {
      await prepare(page, "light", { width: w, height: h });
      await page.goto("/nutrition");
      await settle(page);
      await expect(page.getByTestId("day-ledger")).toHaveCount(0);
      const strip = page.getByTestId("day-strip");
      await expect(strip).toBeVisible();
      await expect(page.getByTestId("quick-add")).toBeInViewport();      // the logging bar is on the first screen, not pushed below an orb
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.mouse.move(w / 2, h / 2);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(400);
      expect((await box(strip)).y).toBeLessThan(120);                  // still on screen after the page has scrolled
      await strip.getByRole("button").click();
      const sheet = page.getByTestId("day-sheet");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId("orb")).toBeVisible();
      await expect(sheet.getByTestId("chip-protein_g")).toBeVisible();
      await expect(sheet.getByTestId("quick-water")).toBeVisible();
      await expect(sheet.getByTestId("day-next")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await page.getByTestId("tab-plan").scrollIntoViewIfNeeded();
      await page.getByTestId("tab-plan").click();
      await expect(strip).toHaveCount(0);
    }
  });

  test("nothing is wider than the screen on any tab at desktop, tablet and phone sizes", async ({ freshUserPage: { page, fresh } }) => {
    await seed(fresh);
    for (const [w, h] of [[1440, 900], [1024, 800], [820, 1100], [390, 844]]) {
      await prepare(page, "light", { width: w, height: h });
      for (const tab of ["today", "nutrients", "trends", "foods", "plan", "goals"]) {
        await page.goto(`/nutrition${tab === "today" ? "" : `?tab=${tab}`}`);
        await settle(page);
        expect(await overflow(page), `${tab} at ${w}`).toBeLessThanOrEqual(0);
      }
    }
  });
});

test.describe("The orb", () => {
  // where the figure sits against the innermost ring, measured from what the browser drew
  const inside = (page) => page.evaluate(() => {
    const orb = document.querySelector('[data-testid="orb"] svg').getBoundingClientRect();
    const scale = orb.width / 320, cx = orb.x + orb.width / 2, cy = orb.y + orb.height / 2, free = (98 - 5) * scale;     // the innermost ring's inner edge
    const node = document.querySelector('[data-testid="energy-left"]');
    const range = document.createRange(); range.selectNodeContents(node);
    const rects = [...range.getClientRects()].concat([...node.parentElement.querySelectorAll("p")].map((p) => { const r = document.createRange(); r.selectNodeContents(p); return r.getBoundingClientRect(); }));
    const far = Math.max(...rects.flatMap((r) => [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => Math.hypot(x - cx, y - cy))));
    return { far, free };
  });

  test("the figure and its labels sit inside the innermost ring at four, five, six and seven characters, at desktop, tablet and phone sizes", async ({ freshUserPage: { page, fresh } }) => {
    await seed(fresh);
    for (const times of [0, 3, 6]) {
      if (times) await log(fresh, "dinner", "olive oil", 1000, times * 2);                     // pushes the day far over its energy: more digits
      for (const [w, h] of [[1440, 900], [820, 1100], [390, 844]]) {
        await prepare(page, "light", { width: w, height: h });
        await page.goto("/nutrition");
        await settle(page);
        if (w < 1024) { await page.getByTestId("day-strip").getByRole("button").click(); await expect(page.getByTestId("orb")).toBeVisible(); await page.waitForTimeout(700); }
        await page.waitForTimeout(500);
        const text = (await page.getByTestId("energy-left").innerText()).trim();
        const r = await inside(page);
        expect(r.far, `"${text}" at ${w}px`).toBeLessThanOrEqual(r.free);
      }
    }
  });

  test("hovering a ring or a figure under it names the nutrient in the middle, and leaving gives the remainder back", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "dark", { width: 1360, height: 900 });
    await seed(fresh);
    await page.goto("/nutrition");
    await settle(page);
    await page.waitForTimeout(1800);
    const orb = page.getByTestId("orb");
    await hoverRing(page, "protein_g");
    const read = page.getByTestId("orb-readout");
    await expect(read).toContainText("Protein");
    await expect(read).toContainText(/\d/);
    await expect(read).toContainText("g");
    await expect.poll(() => orb.getByRole("button", { name: /^Fat:/ }).evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 3000 }).toBeLessThan(0.5);
    await page.mouse.move(700, 600);
    await expect(page.getByTestId("energy-left")).toBeVisible();
    await expect(read).toHaveCount(0);
    await page.getByTestId("chip-fat_g").hover();
    await expect(page.getByTestId("orb-readout")).toContainText("Fat");
    await page.mouse.move(700, 600);
    await hoverRing(page, "energy");
    await expect(page.getByTestId("orb-readout")).toContainText("Energy");
    await expect(page.getByTestId("orb-readout")).toContainText("kcal");
  });

  test("a tap pins a ring until a tap elsewhere or Escape; the keyboard reaches every ring", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await seed(fresh);
    await page.goto("/nutrition");
    await settle(page);
    await page.waitForTimeout(1800);
    await clickRing(page, "carbs_available_g");
    await page.mouse.move(700, 700);                                       // the pointer leaves: a pinned ring stays
    await expect(page.getByTestId("orb-readout")).toContainText("Carbohydrate");
    await page.mouse.click(900, 500);                                      // a tap on the page lets go
    await expect(page.getByTestId("orb-readout")).toHaveCount(0);
    await clickRing(page, "carbs_available_g");
    await page.mouse.move(700, 700);
    await expect(page.getByTestId("orb-readout")).toContainText("Carbohydrate");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("orb-readout")).toHaveCount(0);
    // keyboard: Tab reaches the rings in turn, each one reads out, Enter pins
    const names = [];
    await page.getByTestId("orb").getByRole("button", { name: /^Energy:/ }).focus();
    for (let i = 0; i < 4; i += 1) {
      const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || "");
      names.push(label.split(":")[0]);
      await page.keyboard.press("Tab");
    }
    expect(names).toEqual(["Energy", "Protein", "Carbohydrate", "Fat"]);
  });

  test("the rings are named for assistive technology and the figures under the orb are buttons that light them", async ({ freshUserPage: { page, fresh } }) => {
    await prepare(page, "light", { width: 1360, height: 900 });
    await seed(fresh);
    await page.goto("/nutrition");
    await settle(page);
    for (const name of [/^Energy:/, /^Protein:/, /^Carbohydrate:/, /^Fat:/]) await expect(page.getByTestId("orb").getByRole("button", { name })).toHaveCount(1);
    await expect(page.getByTestId("chip-protein_g")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("chip-protein_g").click();
    await expect(page.getByTestId("chip-protein_g")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("orb-readout")).toContainText("Protein");
  });
});
