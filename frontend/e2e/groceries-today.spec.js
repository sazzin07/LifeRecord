import { test, expect } from "./fixtures";

/* The Groceries Today page against the real backend, each test on an account of its own: the welcome and building animation create real
   storage spaces, the layout is saved on the server (and survives a reload), and the page's actions change real stock and lists. */

async function stock(fresh) {
  const places = await (await fresh.api.post("/api/storage-locations", { data: { name: "Fridge", kind: "fridge", sort_order: 0 } })).json();
  await fresh.api.post("/api/storage-locations", { data: { name: "Freezer", kind: "freezer", sort_order: 1 } });
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const add = async (data) => (await (await fresh.api.post("/api/groceries", { data })).json());
  const milk = await add({ name: "Whole milk", quantity: 2, unit: "L", category: "Dairy", storage_location: "Fridge", expiration: day(1), price: 1.2 });
  await add({ name: "Rice", quantity: 3, unit: "kg", category: "Carbohydrates", storage_location: "Fridge", expiration: day(60), price: 2, low_threshold: 5 });
  return { places, milk };
}

test.describe("Groceries Today", () => {
  test("a new account is welcomed, and Build my kitchen really creates the spaces", async ({ freshUserPage: { page, fresh } }) => {
    await page.goto("/groceries");
    await expect(page.getByRole("heading", { name: /Know what you have/ })).toBeVisible();
    await expect(page.getByText("4 spaces chosen")).toBeVisible();
    await page.getByRole("checkbox", { name: /Cupboard/ }).uncheck({ force: true });
    await expect(page.getByText("3 spaces chosen")).toBeVisible();
    await page.getByLabel("Another space").fill("Garage fridge");
    await page.getByRole("button", { name: "Build my kitchen" }).click();
    await expect(page.getByRole("status")).toContainText("Building your kitchen");
    await expect(page.getByRole("tab", { name: "Storage" })).toHaveAttribute("aria-selected", "true", { timeout: 15000 });
    const spaces = await (await fresh.api.get("/api/storage-locations")).json();
    expect(spaces.map((s) => s.name).sort()).toEqual(["Fridge", "Freezer", "Garage fridge", "Pantry"].sort());
  });

  test("the hero counts what is going off, and Used one and Freeze change the stock", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    const hero = page.getByRole("region", { name: "Today at a glance" });
    await expect(hero).toContainText("One thing needs you today.");
    await expect(hero).toContainText("Start with whole milk");

    await page.getByRole("button", { name: "Used one Whole milk" }).click();
    await expect.poll(async () => Number((await (await fresh.api.get("/api/groceries")).json()).find((g) => g.name === "Whole milk").quantity)).toBe(1.5);
    await page.getByRole("button", { name: "Freeze Whole milk" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/groceries")).json()).find((g) => g.name === "Whole milk").storage_location).toBe("Freezer");
  });

  test("expired food can be thrown away in one tap, one at a time or all together, and put back with Undo", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    for (const name of ["Old yoghurt", "Lettuce"]) await fresh.api.post("/api/groceries", { data: { name, quantity: 1, unit: "unit", category: "Dairy", storage_location: "Fridge", expiration: day(-3), price: 1 } });
    const names = async () => (await (await fresh.api.get("/api/groceries")).json()).map((g) => g.name).sort();
    await page.goto("/groceries");
    const hero = page.getByRole("region", { name: "Today at a glance" });
    await expect(hero).toContainText("3 things need you today.");

    // one at a time, from its own row (an expired row offers Throw away, not Used one)
    await expect(page.getByRole("button", { name: "Used one Old yoghurt" })).toHaveCount(0);
    await page.getByRole("button", { name: "Throw away Lettuce" }).click();
    await expect.poll(names).toEqual(["Old yoghurt", "Rice", "Whole milk"]);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(names).toEqual(["Lettuce", "Old yoghurt", "Rice", "Whole milk"]);

    // all of them, after a yes
    await hero.getByRole("button", { name: /Throw away 2 expired/ }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Old yoghurt");
    await page.getByRole("alertdialog").getByRole("button", { name: "Throw away" }).click();
    await expect.poll(names).toEqual(["Rice", "Whole milk"]);
    await expect(hero).toContainText("One thing needs you today.");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(names).toEqual(["Lettuce", "Old yoghurt", "Rice", "Whole milk"]);
  });

  test("customising: cards move only by dragging their handle (or the arrow keys on it), and the order is saved", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.setViewportSize({ width: 1280, height: 1400 });   // tall, so no card sits at the edge where the page scrolls by itself
    await page.goto("/groceries");
    await page.getByRole("button", { name: "Customise" }).click();
    await expect(page.getByRole("button", { name: /^Move .* earlier$/ })).toHaveCount(0);   // no arrow buttons any more
    const order = async () => (await (await fresh.api.get("/api/layouts/groceries")).json()).layout.widgets.map((w) => w.id);
    const first = page.getByRole("button", { name: /^Move Needs you/ }), second = page.getByRole("region", { name: "Your kitchen" });
    await first.scrollIntoViewIfNeeded();
    const a = await first.boundingBox(), b = await second.boundingBox();
    await page.mouse.move(a.x + 12, a.y + 12);
    await page.mouse.down();
    const others = () => page.evaluate(() => [...document.querySelectorAll(".gt-w:not(.held)")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y + scrollY)]; }));
    const before = await others();
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2, { steps: 12 });
    expect(await others()).toEqual(before);                                           // nothing reflows while a card is held
    await expect(page.locator(".gt-w[data-drop]")).toHaveCount(1);                    // a marker shows where it will land
    const held = await page.locator(".gt-w.held .gt-grip").boundingBox();
    expect(Math.abs(held.x + 12 - (b.x + b.width / 2 + 60))).toBeLessThan(40);        // and the card is under the pointer where it was grabbed
    await page.mouse.up();
    await expect.poll(order).toEqual(["kitchen", "needs", "list", "cook", "low", "risk", "week"]);

    await page.getByRole("button", { name: /^Move Needs you/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(order).toEqual(["kitchen", "list", "needs", "cook", "low", "risk", "week"]);
  });

  test("the freshness ring: exact shares, a closed circle, a zero share draws nothing, changes slide instead of jumping, empty says so", async ({ freshUserPage: { page, fresh } }) => {
    await fresh.api.post("/api/storage-locations", { data: { name: "Pantry", kind: "pantry", sort_order: 0 } });
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    for (let i = 0; i < 21; i++) await fresh.api.post("/api/groceries", { data: { name: `Item ${i}`, quantity: 1, unit: "unit", category: "Pantry", storage_location: "Pantry", expiration: day(i < 15 ? 30 : -3), price: 1 } });
    await page.goto("/groceries");
    const ring = page.locator(".gt-ring");
    const arcs = async () => Object.fromEntries(await ring.locator(".gt-ring-arc").evaluateAll((els) => els.map((e) => [e.dataset.key, Number(e.dataset.len)])));
    await expect(ring.locator(".gt-ring-mid")).toContainText("71");
    await expect(ring.locator(".gt-ring-mid")).toContainText("% fresh");
    const a = await arcs();
    expect(a.gone).toBeCloseTo((6 / 21) * 100, 2);
    expect(a.fresh).toBeCloseTo((15 / 21) * 100, 2);
    expect(a.soon).toBe(0);                                                            // nothing drawn for a zero share
    expect(a.gone + a.soon + a.fresh).toBeCloseTo(100, 2);                              // a closed circle
    await expect(ring).toHaveAttribute("aria-label", /71 percent fresh: 15 items fresh, 0 going off soon, 6 gone off/);
    await expect(ring.locator(".gt-ring-track")).toHaveCount(1);                       // the full track underneath

    // a change slides from the old value: sample the pink arc while the expired food is thrown away
    await page.getByRole("region", { name: "Today at a glance" }).getByRole("button", { name: /Throw away 6 expired/ }).click();
    await page.evaluate(() => { window.__dash = []; const arc = document.querySelector('.gt-ring-arc[data-key="gone"]'); const t0 = performance.now(); const tick = () => { window.__dash.push(parseFloat(getComputedStyle(arc).strokeDasharray)); if (performance.now() - t0 < 1600) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await page.getByRole("alertdialog").getByRole("button", { name: "Throw away" }).click();
    await expect.poll(async () => (await arcs()).fresh).toBe(100);
    await expect(ring.locator(".gt-ring-mid")).toContainText("100");
    await page.waitForTimeout(1700);
    const samples = (await page.evaluate(() => window.__dash)).filter((n) => !Number.isNaN(n));
    const seq = samples;
    expect(Math.max(...seq)).toBeGreaterThan(20);                                     // it started from the old length...
    expect(seq.some((n) => n > 1 && n < 27)).toBe(true);                               // ...passed through the values in between...
    expect(seq[seq.length - 1]).toBeLessThan(0.5);                                    // ...and landed on none
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1] + 0.01);   // never jumping back up

    // nothing at all: an empty track and an em dash, no NaN
    for (const g of await (await fresh.api.get("/api/groceries")).json()) await fresh.api.delete(`/api/groceries/${g.id}`);
    await page.reload();
    await expect(ring.locator(".gt-ring-mid")).toContainText("—");
    await expect(ring).toHaveAttribute("aria-label", "Nothing in stock to measure");
    expect(Object.values(await arcs()).every((n) => n === 0)).toBe(true);
  });

  test("the layout is saved on the server and is there after a reload", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("button", { name: "Customise" }).click();
    await expect(page.getByRole("button", { name: "Remove Running low" })).toBeVisible();
    await page.getByRole("button", { name: "Remove Running low" }).click();
    await page.getByRole("button", { name: "Change size of Shopping list, now medium" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/layouts/groceries")).json()).saved).toBe(true);

    await page.reload();
    await expect(page.getByRole("region", { name: "Shopping list" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Running low" })).toHaveCount(0);
    const saved = (await (await fresh.api.get("/api/layouts/groceries")).json()).layout;
    expect(saved.widgets.find((w) => w.id === "list").size).toBe("l");
    expect(saved.widgets.some((w) => w.id === "low")).toBe(false);

    // Add it back, and restore the defaults
    await page.getByRole("button", { name: "Customise" }).click();
    await page.getByRole("button", { name: "Running low" }).click();
    await expect(page.getByRole("region", { name: "Running low" })).toBeVisible();
    await page.getByRole("button", { name: "Restore defaults" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/layouts/groceries")).json()).saved).toBe(false);
  });

  test("focusing a space narrows the whole page and is remembered", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("button", { name: /^Freezer/ }).first().click();
    await expect(page.getByRole("region", { name: "Today at a glance" })).toContainText("· Freezer");
    await expect.poll(async () => (await (await fresh.api.get("/api/layouts/groceries")).json()).layout.focus).not.toBe("all");
    await page.reload();
    await expect(page.getByRole("region", { name: "Today at a glance" })).toContainText("· Freezer");
    await page.getByRole("button", { name: /^Everywhere/ }).click();
    await expect(page.getByRole("region", { name: "Today at a glance" })).not.toContainText("· Freezer");
  });

  test("the tabs are a keyboard tab list", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Today" }).focus();
    await page.keyboard.press("ArrowDown");                                   // the sections run down the side, so down is next
    await expect(page.getByRole("tab", { name: "Storage" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");                                  // the sideways arrows work too
    await expect(page.getByRole("tab", { name: "Storage" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Kitchen" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
  });
  test("cooking from Today asks first and changes nothing until you agree", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await fresh.api.post("/api/recipes", { data: { name: "Milky rice", servings: 2, ingredients: [{ name: "Whole milk", quantity: 1, unit: "L" }, { name: "Rice", quantity: 1, unit: "kg" }] } });
    await page.goto("/groceries");
    await page.getByRole("button", { name: "Cook Milky rice" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Uses up");                           // it names the food and the amounts
    await expect(page.getByRole("alertdialog")).toContainText("cannot be undone from here");
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    const quantity = async () => Number((await (await fresh.api.get("/api/groceries")).json()).find((g) => g.name === "Whole milk").quantity);
    expect(await quantity()).toBe(2);
    await page.getByRole("button", { name: "Cook Milky rice" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cook it" }).click();
    await expect.poll(quantity).toBeLessThan(2);
  });

  test("Mix your meal: a goal and ingredient choices combine, order the recipes and count what is left", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    const recipe = (name, calories, protein, ingredients) => fresh.api.post("/api/recipes", { data: { name, servings: 2, calories, protein, ingredients: ingredients.map((n) => ({ name: n, quantity: 1, unit: "unit" })) } });
    await recipe("Chicken traybake", 1000, 80, ["Chicken thighs", "Spinach"]);
    await recipe("Cheesy pasta", 1400, 40, ["Pasta", "Cheddar"]);
    await recipe("Green salad", 300, 10, ["Lettuce", "Cucumber"]);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Kitchen" }).click();
    const cards = page.getByTestId("recipe-card");
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole("button", { name: /^Under 20 min/ })).toHaveAttribute("aria-disabled", "true");   // none of these recipes has a time yet

    await page.getByRole("button", { name: /^Most protein/ }).click();
    await expect(cards.first()).toContainText("Chicken traybake");
    await expect(page.getByText("3 recipes for Most protein")).toBeVisible();
    await page.getByRole("button", { name: /^Most energy/ }).click();
    await expect(cards.first()).toContainText("Cheesy pasta");
    await page.getByRole("button", { name: /^Lightest/ }).click();
    await expect(cards.first()).toContainText("Green salad");

    // Combine: the best for energy that has dairy; the chips say how many are left, and one that would leave none is dimmed
    await page.getByRole("button", { name: /^Most energy/ }).click();
    await page.getByRole("button", { name: /^Dairy/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Cheesy pasta");
    await expect(page.getByText("1 recipe for Most energy + Dairy")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Meat \d/ })).toHaveAttribute("aria-disabled", "true");

    // Meat-free and Meat cannot both be on; starting over brings everything back
    await page.getByRole("button", { name: /^Dairy/ }).click();
    await page.getByRole("button", { name: /^Meat-free/ }).click();
    await expect(cards).toHaveCount(2);
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(cards).toHaveCount(3);
  });

  test("Mix your meal: Under 20 min keeps the quick recipes, never one without a time, and combines with the rest", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    const recipe = (name, cook_minutes, ingredients) => fresh.api.post("/api/recipes", { data: { name, servings: 2, calories: 800, protein: 30, cook_minutes, ingredients: ingredients.map((n) => ({ name: n, quantity: 1, unit: "unit" })) } });
    await recipe("Cheese omelette", 12, ["Free-range eggs", "Cheddar"]);
    await recipe("Chicken stew", 95, ["Chicken thighs", "Spinach"]);
    await recipe("Green salad", null, ["Lettuce", "Cucumber"]);
    await recipe("Spinach wrap", 20, ["Spinach", "Wraps"]);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Kitchen" }).click();
    const cards = page.getByTestId("recipe-card");
    await expect(cards).toHaveCount(4);
    await expect(page.getByText("12 min", { exact: false }).first()).toBeVisible();          // the time is on the card
    await expect(page.getByTestId("recipe-card").filter({ hasText: "Chicken stew" })).toContainText("1 h 35 min");

    const quick = page.getByRole("button", { name: /^Under 20 min/ });
    await expect(quick).toContainText("2");                                                  // the omelette and the wrap; the salad has no time
    await quick.click();
    await expect(quick).toHaveAttribute("aria-pressed", "true");
    await expect(cards).toHaveCount(2);
    await expect(page.getByText("2 recipes for Under 20 min")).toBeVisible();
    await expect(page.getByTestId("recipe-card").filter({ hasText: "Green salad" })).toHaveCount(0);
    await expect(page.getByTestId("recipe-card").filter({ hasText: "Chicken stew" })).toHaveCount(0);

    // combined with an ingredient choice, and the choice counts agree with what is left
    await page.getByRole("button", { name: /^Dairy/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Cheese omelette");
    await expect(page.getByText("1 recipe for Dairy + Under 20 min")).toBeVisible();

    await page.getByRole("button", { name: "Start over" }).click();
    await expect(cards).toHaveCount(4);
    await expect(quick).toHaveAttribute("aria-pressed", "false");
  });

  test("a recipe's cooking time is saved from the recipe editor, kept by a save that leaves it alone, and removed when emptied", async ({ freshUserPage: { page, fresh } }) => {
    const made = await (await fresh.api.post("/api/recipes", { data: { name: "Porridge", servings: 1, ingredients: [{ name: "Oats", quantity: 50, unit: "g" }] } })).json();
    expect(made.cook_minutes).toBeNull();
    await page.goto("/nutrition");
    await page.getByTestId("tab-foods").click();
    await page.getByTestId(`recipe-edit-${made.id}`).click();
    const dialog = page.getByTestId("recipe-dialog");
    await expect(dialog.getByTestId("recipe-minutes")).toHaveValue("");
    await dialog.getByTestId("recipe-minutes").fill("15");
    await dialog.getByTestId("recipe-save").click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId(`recipe-${made.id}`)).toContainText("15 min");
    const saved = async () => (await (await fresh.api.get("/api/recipes")).json()).find((r) => r.id === made.id);
    expect((await saved()).cook_minutes).toBe(15);

    // the assistant or an older screen saves without the field: the time stays (checked on the API the page uses)
    expect((await (await fresh.api.put(`/api/recipes/${made.id}`, { data: { name: "Porridge", servings: 2, ingredients: [{ name: "Oats", quantity: 50, unit: "g" }] } })).json()).cook_minutes).toBe(15);

    await page.reload();
    await page.getByTestId("tab-foods").click();
    await page.getByTestId(`recipe-edit-${made.id}`).click();
    await expect(page.getByTestId("recipe-dialog").getByTestId("recipe-minutes")).toHaveValue("15");
    await page.getByTestId("recipe-dialog").getByTestId("recipe-minutes").fill("0");           // 0 is not a time: the editor refuses it
    await page.getByTestId("recipe-dialog").getByTestId("recipe-save").click();
    await expect(page.getByTestId("recipe-dialog")).toBeVisible();
    expect((await saved()).cook_minutes).toBe(15);
    await page.getByTestId("recipe-dialog").getByTestId("recipe-minutes").fill("");
    await page.getByTestId("recipe-dialog").getByTestId("recipe-save").click();
    await expect(page.getByTestId("recipe-dialog")).not.toBeVisible();
    await expect.poll(async () => (await saved()).cook_minutes).toBeNull();
  });
});
