import { test, expect } from "./fixtures";
import { openGroceriesTab } from "./support/groceries";
import { audit, prepare, THEMES } from "./support/a11y";

/* Groceries navigation against the real backend: the sections as a rail beside the page (folded to icons by the three-bar button, remembered on the
   device), the same sections in a drawer on a phone, the cart as a round button beside the app's quick-add "+" (in the heading on a phone), and every
   control at least 44px on a touch screen. Each test has an account of its own. */

async function household(fresh) {
  await fresh.api.post("/api/storage-locations", { data: { name: "Fridge", kind: "fridge", sort_order: 0 } });
  await fresh.api.post("/api/storage-locations", { data: { name: "Pantry", kind: "pantry", sort_order: 1 } });
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  await fresh.api.post("/api/groceries", { data: { name: "Whole milk", quantity: 2, unit: "L", category: "Dairy", storage_location: "Fridge", expiration: day(1), price: 1.1 } });
  await fresh.api.post("/api/groceries", { data: { name: "Rice", quantity: 1, unit: "kg", category: "Carbohydrates", storage_location: "Pantry", expiration: day(90), price: 2 } });
  await fresh.api.post("/api/recipes", { data: { name: "Milky rice", servings: 2, cook_minutes: 15, calories: 700, protein: 20, ingredients: [{ name: "Rice", quantity: 0.2, unit: "kg" }, { name: "Whole milk", quantity: 0.5, unit: "L" }] } });
  const list = await (await fresh.api.post("/api/shopping/lists", { data: { name: "Weekend shop", budget: 40 } })).json();
  for (const [name, category, quantity, unit, estimated_price] of [["Apples", "Fruit", 4, "unit", 0.5], ["Bread", "Carbohydrates", 1, "unit", 1.8], ["Eggs", "Eggs", 6, "unit", 0.4]]) {
    await fresh.api.post("/api/shopping", { data: { name, category, quantity, unit, estimated_price, list_id: list.id } });
  }
}

const tooSmall = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)]
  .filter((e) => e.offsetParent !== null)
  .map((e) => { const r = e.getBoundingClientRect(); return { name: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
  .filter((b) => b.h < 43.5 || b.w < 43.5), selector);

test.describe("Groceries navigation", () => {
  test("wide: the sections are a rail, the three-bar button folds it to icons (names stay for assistive tech) and the choice is remembered", async ({ freshUserPage: { page, fresh } }) => {
    await household(fresh);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/groceries");
    const rail = page.getByTestId("gt-rail"), toggle = page.getByTestId("gt-rail-toggle");
    await expect(rail).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect((await rail.boundingBox()).width).toBeGreaterThan(170);
    expect(await rail.boundingBox().then((b) => b.x)).toBeLessThan(400);                            // down the left side, not along the top
    for (const name of ["Today", "Storage", "Shopping", "Kitchen"]) await expect(page.getByRole("tab", { name })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Groceries sections" })).toHaveAttribute("aria-orientation", "vertical");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => (await rail.boundingBox()).width).toBeLessThan(70);
    await page.getByRole("tab", { name: "Kitchen" }).click();                                         // still reachable by name when only the icon shows
    await expect(page.getByRole("tab", { name: "Kitchen" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Catalog", exact: true })).toBeVisible();

    await page.reload();                                                                              // remembered on this device
    await expect(page.getByTestId("gt-rail-toggle")).toHaveAttribute("aria-expanded", "false");
    await page.getByTestId("gt-rail-toggle").click();
    await expect(page.getByTestId("gt-rail-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await page.getByTestId("gt-rail").boundingBox()).width).toBeGreaterThan(170);
  });

  test("phone: no rail; the three-bar button in the heading opens the sections as a drawer, choosing one closes it, Escape closes it too", async ({ freshUserPage: { page, fresh } }) => {
    await household(fresh);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/groceries");
    await expect(page.getByTestId("gt-rail")).toHaveCount(0);
    const open = page.getByTestId("gt-drawer-open");
    await expect(open).toBeVisible();
    await expect(open).toContainText("now Today");                                                    // it says where you are
    await open.click();
    const drawer = page.getByRole("dialog", { name: "Groceries" });
    await expect(drawer.getByRole("tab")).toHaveCount(4);
    await drawer.getByRole("tab", { name: "Shopping" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("tabpanel", { name: "Shopping" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
    await expect(open).toContainText("now Shopping");
    await open.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(open).toBeFocused();                                                                 // focus returns to the button that opened it
    await open.click();                                                                               // Catalog lives in the drawer too
    await drawer.getByRole("button", { name: "Catalog" }).click();
    await expect(page.getByRole("dialog", { name: "Catalog" })).toBeVisible();
  });

  test("tablet and wide: the cart is a round button fixed in the corner, left of the quick-add + and clear of it while it unfolds; the Shopping tab has none", async ({ freshUserPage: { page, fresh } }) => {
    await household(fresh);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/groceries");
    const cart = page.getByTestId("cart-fab"), plus = page.getByTestId("quick-add-trigger");
    await expect(cart).toBeVisible();
    await expect(cart).toContainText("Cart, 3 to get");
    const c = await cart.boundingBox(), p = await plus.boundingBox();
    expect(c.x + c.width).toBeLessThanOrEqual(p.x);                                                   // beside it, not on it
    expect(p.x - (c.x + c.width)).toBeLessThanOrEqual(24);
    expect(Math.abs((c.y + c.height / 2) - (p.y + p.height / 2))).toBeLessThanOrEqual(6);             // on the same line
    expect(c.x + c.width).toBeLessThanOrEqual(1280);
    await plus.hover();                                                                               // the + unfolds into a pill: it pushes the cart aside
    await page.waitForTimeout(500);
    const c2 = await cart.boundingBox(), p2 = await plus.boundingBox();
    expect(c2.x + c2.width).toBeLessThanOrEqual(p2.x + 0.5);
    await page.mouse.move(5, 5);
    for (const tab of ["Storage", "Kitchen", "Today"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByTestId("cart-fab")).toBeVisible();                                       // fixed: it follows you from tab to tab
    }
    await page.getByRole("tab", { name: "Shopping" }).click();
    await expect(page.getByTestId("cart-fab")).toHaveCount(0);
    await page.getByRole("tab", { name: "Today" }).click();
    await page.getByTestId("cart-fab").click();
    await expect(page.getByRole("dialog", { name: "Your cart" })).toContainText("3 to get");
  });
});

test.describe("Groceries on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("every control the page offers is at least 44px on a phone", async ({ freshUserPage: { page, fresh } }) => {
    await household(fresh);
    await page.goto("/groceries");
    await expect(page.getByTestId("gt-drawer-open")).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const bad = {};
    const check = async (label, selector, atLeast = 1) => {
      expect(await page.locator(selector).filter({ visible: true }).count(), `${label}: nothing matched ${selector}`).toBeGreaterThanOrEqual(atLeast);
      const small = await tooSmall(page, selector);
      if (small.length) bad[label] = small;
    };
    await check("heading buttons", '[data-testid="gt-drawer-open"], [data-testid="cart-open"]', 2);
    await check("add bar", ".gt-cmd > input, .gt-cmd > .gt-btn", 2);
    for (const part of [".gt-hero .gt-btn", ".gt-toolbar .gt-pill-b", ".gt-tick"]) await expect(page.locator(part).first()).toBeVisible({ timeout: 20000 });   // Today draws in stages after its welcome moment; count controls only once it has
    await page.waitForTimeout(1500);   // the widgets scale in; a box measured mid-entrance is a pixel short
    await check("Today", ".gt-toolbar .gt-pill-b, .gt-toolbar > .gt-btn, .gt-hero .gt-btn, .gt-tick", 6);
    await page.getByTestId("gt-drawer-open").click();
    await check("drawer", '[data-testid="gt-drawer"] .gt-rail-b', 5);
    await page.getByRole("dialog", { name: "Groceries" }).getByRole("tab", { name: "Kitchen" }).click();
    await page.getByTestId("gt-drawer").waitFor({ state: "detached" });
    await check("Kitchen", ".gt-mx, .gt-rc-act .gt-btn, .gt-tap, [data-testid=appliance-card] button", 12);
    await openGroceriesTab(page, "Storage");
    await check("Storage", ".gt-store-head button, .gt-chip", 3);
    await openGroceriesTab(page, "Shopping");
    await check("Shopping", ".gt-mode .gt-pill-b, .gt-listbar .gt-pill-b, .gt-listbar .gt-btn, .gt-qs .gt-btn, .gt-acts .gt-btn, .gt-slist .gt-tick, .gt-shopbar input, .gt-shopbar [role=combobox], .gt-bulk label, .gt-trip-aside input", 14);
    expect(bad, `controls under 44px:\n${JSON.stringify(bad, null, 1)}`).toEqual({});
  });
});

test.describe("Groceries on a touch tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, contextOptions: { reducedMotion: "reduce" } });
  test.describe.configure({ timeout: 120000 });

  test("Today's actions and the Storage chips are at least 44px, and the page ends clear of the corner buttons", async ({ freshUserPage: { page, fresh } }) => {
    await household(fresh);
    await page.goto("/groceries");
    for (const part of [".gt-hero .gt-btn", ".gt-toolbar .gt-pill-b"]) await expect(page.locator(part).first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const small = async (selector) => page.locator(selector).filter({ visible: true }).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.height < 43.5 || r.width < 43.5).map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`));
    expect(await small(".gt-hero .gt-btn, .gt-toolbar .gt-pill-b, .gt-tick")).toEqual([]);
    await openGroceriesTab(page, "Storage");
    await expect(page.locator(".gt-chipbar .gt-chip").first()).toBeVisible({ timeout: 30000 });
    expect(await small(".gt-chipbar .gt-chip")).toEqual([]);
    expect(await page.locator(".gt-main").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))).toBeGreaterThanOrEqual(96);
  });
});

test.describe("Groceries cart on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a cart row keeps its stepper clear of the name and price", async ({ freshUserPage: { page, fresh } }) => {
    await household(fresh);
    await page.goto("/groceries");
    await page.getByTestId("cart-open").click();
    const row = page.getByRole("dialog", { name: "Your cart" }).getByTestId("shop-row").first();
    await expect(row).toBeVisible();
    await expect.poll(async () => (await page.getByRole("dialog", { name: "Your cart" }).boundingBox()).x, { timeout: 5000 }).toBeLessThan(20);   // the drawer has finished sliding in
    const box = (sel) => row.locator(sel).first().boundingBox();
    const [name, steps, price] = [await box(".name"), await box(".gt-qs"), await box(".gt-price")];
    expect(steps.y).toBeGreaterThanOrEqual(name.y + name.height - 1);     // the stepper sits under the name, not on it
    expect(steps.y).toBeGreaterThanOrEqual(price.y + price.height - 1);
    expect(steps.x + steps.width).toBeLessThanOrEqual(390);
  });
});

test.describe("Groceries navigation accessibility (axe, WCAG A and AA)", () => {
  for (const theme of THEMES) {
    test(`the open and folded rail, the drawer and the cart panel, ${theme}`, async ({ freshUserPage: { page, fresh } }) => {
      await household(fresh);
      await prepare(page, theme, { width: 1280, height: 800 });
      await page.goto("/groceries");
      await expect(page.getByTestId("gt-rail")).toBeVisible();
      await page.waitForTimeout(800);
      await audit(page, `rail open, ${theme}`);
      await page.getByTestId("gt-rail-toggle").click();
      await expect.poll(async () => (await page.getByTestId("gt-rail").boundingBox()).width).toBeLessThan(70);
      await audit(page, `rail folded, ${theme}`);
      await page.getByTestId("cart-fab").click();
      await expect(page.getByRole("dialog", { name: "Your cart" })).toBeVisible();
      await page.waitForTimeout(600);
      await audit(page, `cart panel, ${theme}`);
      await page.keyboard.press("Escape");

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/groceries");
      await page.getByTestId("gt-drawer-open").click();
      await expect(page.getByRole("dialog", { name: "Groceries" })).toBeVisible();
      await page.waitForTimeout(600);
      await audit(page, `drawer, ${theme}`);
    });
  }
});

test.describe("Groceries rail stays on screen", () => {
  test.use({ viewport: { width: 1280, height: 800 }, contextOptions: { reducedMotion: "reduce" } });
  test("it is centred vertically and does not move when the page scrolls", async ({ freshUserPage: { page, fresh } }) => {
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    await fresh.api.post("/api/storage-locations", { data: { name: "Fridge", kind: "fridge", sort_order: 0 } });
    for (let i = 0; i < 12; i++) await fresh.api.post("/api/groceries", { data: { name: `Food ${i}`, quantity: 1, unit: "unit", category: "Dairy", storage_location: "Fridge", expiration: day(1 + (i % 3)), price: 1 } });
    await page.goto("/groceries");
    const rail = page.getByTestId("gt-rail");
    await expect(rail).toBeVisible();
    const box = async () => rail.boundingBox();
    await expect.poll(async () => { const b = await box(); return Math.abs(b.y + b.height / 2 - 400); }).toBeLessThan(30);
    const before = await box();
    await page.mouse.wheel(0, 900);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    const after = await box();
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
    expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  });
});
