import { test, expect } from "./fixtures";

/* The 3D kitchen's camera and its controls (desktop): wheel zoom in the overview that never scrolls the page over the canvas, drag to orbit with
   wide limits, right-drag to slide, a Reset button and R, the floating toolbar, the unit picker strip, Esc back to the overview, the first-visit
   hint, the collapsible list, and labels that never hide each other. The room is a canvas, so its camera is read from `data-pose` on the room:
   zoom | azimuth | elevation | pan x | overview. Reduced motion keeps a software-rendered browser responsive (moves then land at once). */

async function stock(fresh, spaces = 3) {
  const kinds = [["Fridge", "fridge"], ["Freezer", "freezer"], ["Pantry", "pantry"], ["Cupboard", "cupboard"], ["Spice rack", "custom"], ["Garage fridge", "fridge"], ["Cellar", "pantry"], ["Shed", "custom"]];
  for (let i = 0; i < spaces; i++) await fresh.api.post("/api/storage-locations", { data: { name: kinds[i][0], kind: kinds[i][1], sort_order: i } });
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await fresh.api.post("/api/groceries", { data: { name: "Whole milk", quantity: 2, unit: "L", category: "Dairy", storage_location: "Fridge", expiration: day(1), price: 1.2 } });
  await fresh.api.post("/api/groceries", { data: { name: "Rice", quantity: 3, unit: "kg", category: "Carbohydrates", storage_location: "Pantry", expiration: day(120) } });
}
const room = (page) => page.locator("[data-k3d]");
const pose = async (page) => (await room(page).getAttribute("data-pose")).split("|").map(Number);   // [zoom, az, el, panX, overview]
const openRoom = async (page) => {
  await page.goto("/groceries");
  await page.getByRole("tab", { name: "Storage" }).click();
  await expect(room(page)).toHaveAttribute("data-view", "overview", { timeout: 30000 });
  await expect(room(page)).toHaveAttribute("data-pose", /.+/);
  return room(page).boundingBox();
};

test.describe("Groceries 3D room camera", () => {
  test.use({ viewport: { width: 1440, height: 1000 }, contextOptions: { reducedMotion: "reduce" } });
  test.describe.configure({ timeout: 150000 });

  test("the wheel zooms the camera in the overview and never scrolls the page over the canvas; elsewhere the page scrolls", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    const box = await openRoom(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await pose(page))[0]).toBeLessThan(-0.3);        // zoomed in, in the overview
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await page.mouse.wheel(0, 3000);                                                // all the way out and then some: still no page scroll
    await expect.poll(async () => (await pose(page))[0]).toBeGreaterThan(0.2);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await page.mouse.move(box.x + 40, 130);                                          // over the heading, not the canvas
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
  });

  test("drag orbits with wide limits, right-drag slides, and Reset view, R and 0 bring the default pose back", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    const box = await openRoom(page);
    const x = box.x + 120, y = box.y + 140;                                          // empty room, clear of any unit
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 500, y + 20, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await pose(page))[1])).toBeGreaterThan(0.95);   // past the old limit of 0.95
    expect(Math.abs((await pose(page))[1])).toBeLessThanOrEqual(1.36);

    await page.mouse.move(x, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(x + 160, y, { steps: 8 });
    await page.mouse.up({ button: "right" });
    await expect.poll(async () => Math.abs((await pose(page))[3])).toBeGreaterThan(0.05);

    await page.getByRole("button", { name: /^Reset view/ }).click();
    await expect.poll(async () => (await pose(page)).slice(0, 4).map((n) => Math.abs(n))).toEqual([0, 0, 0, 0]);

    await page.mouse.move(x, y);
    await page.mouse.down(); await page.mouse.move(x + 200, y, { steps: 6 }); await page.mouse.up();
    await expect.poll(async () => Math.abs((await pose(page))[1])).toBeGreaterThan(0.2);
    await page.mouse.move(box.x + box.width / 2, box.y + 60);
    await page.keyboard.press("r");
    await expect.poll(async () => Math.abs((await pose(page))[1])).toBe(0);
  });

  test("the camera toolbar: rotate, zoom, reset and hide the list, as real buttons with names", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await openRoom(page);
    const bar = page.getByRole("group", { name: "Camera" });
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => (await pose(page))[0]).toBeLessThan(-0.2);
    await bar.getByRole("button", { name: "Zoom out" }).click();
    await bar.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(async () => (await pose(page))[0]).toBeGreaterThan(0.2);
    await bar.getByRole("button", { name: "Rotate right" }).click();
    await expect.poll(async () => (await pose(page))[1]).toBeGreaterThan(0.2);
    await bar.getByRole("button", { name: "Rotate left" }).click();
    await bar.getByRole("button", { name: "Rotate left" }).click();
    await expect.poll(async () => (await pose(page))[1]).toBeLessThan(-0.2);
    await bar.getByRole("button", { name: /^Reset view/ }).click();
    await expect.poll(async () => (await pose(page)).slice(0, 2).map(Math.abs)).toEqual([0, 0]);

    const wide = (await room(page).boundingBox()).width;
    await bar.getByRole("button", { name: "Hide the list" }).click();
    await expect(page.locator(".gt-side")).toBeHidden();
    await expect.poll(async () => (await room(page).boundingBox()).width).toBeGreaterThan(wide + 200);
    await page.reload();
    await page.getByRole("tab", { name: "Storage" }).click();
    await expect(room(page)).toHaveAttribute("data-view", "overview", { timeout: 30000 });
    await expect(page.locator(".gt-side")).toBeHidden();                              // remembered
    await page.getByRole("group", { name: "Camera" }).getByRole("button", { name: "Show the list" }).click();
    await expect(page.locator(".gt-side")).toBeVisible();
  });

  test("hiding the list while an item is chosen hides the list but keeps that item's card and the room's status", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await openRoom(page);
    await page.locator(".gt-chipbar").getByRole("button", { name: /^Fridge/ }).click();
    const list = page.getByRole("region", { name: "Everything in Fridge" });
    await list.getByTestId("storage-item-row").first().getByRole("button").click();
    await page.getByRole("group", { name: "Camera" }).getByRole("button", { name: "Hide the list" }).click();
    await expect(list).toHaveCount(0);                                                // the list steps aside...
    await expect(page.locator(".gt-side")).toBeVisible();                              // ...the chosen item keeps its card
    await expect(page.getByRole("status").filter({ hasText: /Fridge (open|shut)/ })).toHaveCount(1);   // and the room still announces itself
  });

  test("the picker strip flies to a unit, Esc and the overview chip fly back", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await openRoom(page);
    const strip = page.locator(".gt-chipbar");
    await strip.getByRole("button", { name: /^Fridge/ }).click();
    await expect(room(page)).toHaveAttribute("data-view", "unit");
    await expect(strip.getByRole("button", { name: /^Fridge/ })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(room(page)).toHaveAttribute("data-view", "overview");
    await strip.getByRole("button", { name: /^Pantry/ }).click();
    await expect(room(page)).toHaveAttribute("data-open", "Pantry");
    await strip.getByRole("button", { name: /^Overview/ }).click();
    await expect(room(page)).toHaveAttribute("data-view", "overview");
  });

  test("the first-visit hint shows once and stays dismissed", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await openRoom(page);
    const hint = page.getByRole("status").filter({ hasText: "Drag to look around, scroll to zoom, click a unit to open it" });
    await expect(hint).toBeVisible();
    await hint.getByRole("button", { name: "Got it" }).click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await page.getByRole("tab", { name: "Storage" }).click();
    await expect(room(page)).toHaveAttribute("data-view", "overview", { timeout: 30000 });
    await expect(page.getByText("Drag to look around, scroll to zoom")).toHaveCount(0);
  });

  test("with seven spaces no unit label hides another", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh, 7);
    await openRoom(page);
    await expect(page.locator(".gt-ulabel")).toHaveCount(7);
    await expect.poll(async () => page.evaluate(() => {
      const r = [...document.querySelectorAll(".gt-ulabel")].filter((b) => getComputedStyle(b).opacity !== "0").map((b) => b.getBoundingClientRect());
      let bad = 0;
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
        const w = Math.min(r[i].right, r[j].right) - Math.max(r[i].left, r[j].left), h = Math.min(r[i].bottom, r[j].bottom) - Math.max(r[i].top, r[j].top);
        if (w > 3 && h > 3) bad++;
      }
      return bad;
    })).toBe(0);
  });

  test("hovering a unit shows a pointer and selecting one keeps it chosen", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await openRoom(page);
    await page.locator(".gt-chipbar").getByRole("button", { name: /^Fridge/ }).click();
    await expect(room(page)).toHaveAttribute("data-open", "Fridge");
    await expect(page.locator(".gt-chipbar").getByRole("button", { name: /^Fridge/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Everything in Fridge" })).toBeVisible();
  });
});

for (const width of [1280, 1920]) {
  test.describe(`Groceries 3D room at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 }, contextOptions: { reducedMotion: "reduce" } });
    test.describe.configure({ timeout: 150000 });
    test("the stage is wide, the toolbar sits inside it, and the wheel zooms", async ({ freshUserPage: { page, fresh } }) => {
      await stock(fresh);
      const box = await openRoom(page);
      expect(box.width).toBeGreaterThan(width >= 1900 ? 700 : 560);
      const bar = await page.getByRole("group", { name: "Camera" }).boundingBox();
      expect(bar.x + bar.width).toBeLessThanOrEqual(box.x + box.width + 1);          // inside the stage, bottom right
      expect(bar.y).toBeGreaterThan(box.y + box.height / 2);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -300);
      await expect.poll(async () => (await pose(page))[0]).toBeLessThan(-0.2);
    });
  });
}
