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
    await check("Today", ".gt-toolbar .gt-pill-b, .gt-toolbar > .gt-btn, .gt-hero .gt-btn", 3);
    await page.getByTestId("gt-drawer-open").click();
    await check("drawer", '[data-testid="gt-drawer"] .gt-rail-b', 5);
    await page.getByRole("dialog", { name: "Groceries" }).getByRole("tab", { name: "Kitchen" }).click();
    await page.getByTestId("gt-drawer").waitFor({ state: "detached" });
    await check("Kitchen", ".gt-mx, .gt-rc-act .gt-btn", 8);
    await openGroceriesTab(page, "Shopping");
    await check("Shopping", ".gt-mode .gt-pill-b, .gt-listbar .gt-pill-b, .gt-listbar .gt-btn, .gt-qs .gt-btn, .gt-acts .gt-btn, .gt-slist .gt-tick", 12);
    expect(bad, `controls under 44px:\n${JSON.stringify(bad, null, 1)}`).toEqual({});
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
