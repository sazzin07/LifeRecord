import { test, expect } from "./fixtures";

const uniqueName = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.describe("Groceries kitchen", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto("/groceries");
    await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
  });

  test("opens on the Overview tab", async ({ authenticatedPage: page }) => {
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("data-state", "active");
    await expect(page.getByText("Items in stock")).toBeVisible();
  });

  test("zoom into a space, switch from the speed dial, and zoom back out", async ({ authenticatedPage: page }) => {
    await page.getByRole("tab", { name: "Storage" }).click();
    await expect(page.getByTestId("unit-fridge")).toHaveAttribute("data-mode", "wall");

    // Zoom in: the clicked unit becomes the hero, the others shrink into the rail
    await page.getByTestId("unit-fridge").click();
    await expect(page.getByTestId("unit-fridge")).toHaveAttribute("data-mode", "hero");
    await expect(page.getByTestId("unit-pantry")).toHaveAttribute("data-mode", "mini");
    await expect(page.getByTestId("shelf-item").first()).toBeVisible();

    // A shelf chip offers quick actions without opening the full list
    await page.getByTestId("shelf-item").first().click();
    await expect(page.getByRole("button", { name: /^Use one / })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Use one / })).toHaveCount(0);

    // Speed dial switches space; details are not forced open
    await page.getByTestId("unit-pantry").click();
    await expect(page.getByTestId("unit-pantry")).toHaveAttribute("data-mode", "hero");
    await expect(page.getByTestId("unit-fridge")).toHaveAttribute("data-mode", "mini");
    await expect(page.getByRole("region", { name: "Inside Pantry" })).toHaveCount(0);

    // More details reveals the full list for the selected space
    await page.getByRole("button", { name: "More details" }).click();
    await expect(page.getByRole("region", { name: "Inside Pantry" })).toBeVisible();

    // All spaces / Esc zoom back out
    await page.getByRole("button", { name: "All spaces" }).click();
    await expect(page.getByTestId("unit-pantry")).toHaveAttribute("data-mode", "wall");
    await expect(page.getByRole("region", { name: "Inside Pantry" })).toHaveCount(0);
    await page.getByTestId("unit-freezer").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("unit-freezer")).toHaveAttribute("data-mode", "wall");
  });

  test("switching spaces keeps the page where it is", async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.getByRole("tab", { name: "Storage" }).click();
    await page.getByTestId("unit-fridge").click();
    await page.getByRole("button", { name: "More details" }).click();
    await expect(page.getByRole("region", { name: "Inside Fridge" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 180));
    await page.waitForTimeout(700);
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(100);

    // Click without letting Playwright scroll the element into view, as a real tap would
    await page.getByTestId("unit-pantry").getByRole("button").evaluate((el) => el.click());
    await expect(page.getByTestId("unit-pantry")).toHaveAttribute("data-mode", "hero");
    await expect(page.getByRole("region", { name: "Inside Pantry" })).toBeVisible();
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => window.scrollY);
    expect(Math.abs(after - before)).toBeLessThan(60);
  });

  test("Overview jumps straight into the zoomed space", async ({ authenticatedPage: page }) => {
    await page.getByRole("button", { name: /^Greek yoghurt/ }).first().click();
    await expect(page.getByRole("tab", { name: "Storage" })).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("unit-fridge")).toHaveAttribute("data-mode", "hero");
    // The zoomed state survives a trip to another tab
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("tab", { name: "Storage" }).click();
    await expect(page.getByTestId("unit-fridge")).toHaveAttribute("data-mode", "hero");
  });

  test("expiry uses the themed date picker, not the browser's", async ({ authenticatedPage: page }) => {
    await page.getByRole("tab", { name: "Storage" }).click();
    await page.getByTestId("unit-fridge").click();
    await page.getByRole("button", { name: /^Add item to Fridge/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator('input[type="date"]')).toHaveCount(0);
    await dialog.getByRole("button", { name: "Expiry date" }).click();
    await page.getByRole("button", { name: "Tomorrow" }).click();
    await expect(dialog.getByRole("button", { name: "Expiry date" })).not.toContainText("No expiry");
    await page.keyboard.press("Escape");
  });

  test("add, adjust, move and discard an item from the details panel", async ({ authenticatedPage: page }) => {
    const name = uniqueName();
    await page.getByRole("tab", { name: "Storage" }).click();
    await page.getByTestId("unit-fridge").click();
    await page.getByRole("button", { name: "More details" }).click();
    const panel = page.getByRole("region", { name: "Inside Fridge" });
    await expect(panel).toBeVisible();

    // Add an item straight into the fridge
    await panel.getByRole("button", { name: "Add item" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByLabel("Quantity", { exact: true }).fill("3");
    await dialog.getByRole("button", { name: "Add to inventory" }).click();
    const row = panel.getByTestId("storage-item").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("3 unit");

    // Quick quantity adjustments persist
    await row.getByRole("button", { name: `Use one ${name}` }).click();
    await expect(row).toContainText("2 unit");
    await row.getByRole("button", { name: `Add one ${name}` }).click();
    await expect(row).toContainText("3 unit");
    await page.reload();
    await page.getByRole("tab", { name: "Storage" }).click();
    await page.getByTestId("unit-fridge").click();
    await page.getByRole("button", { name: "More details" }).click();
    await expect(page.getByTestId("storage-item").filter({ hasText: name })).toContainText("3 unit");

    // Move to the pantry, then switch to it from the speed dial (details stay open)
    await page.getByRole("button", { name: `Move ${name}` }).click();
    await page.getByRole("menuitem", { name: "Move to Pantry" }).click();
    await expect(page.getByTestId("storage-item").filter({ hasText: name })).toHaveCount(0);
    await page.getByTestId("unit-pantry").click();
    const pantryRow = page.getByTestId("storage-item").filter({ hasText: name });
    await expect(pantryRow).toBeVisible();

    // Discard needs confirmation
    await pantryRow.getByRole("button", { name: `Discard ${name}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
    await expect(pantryRow).toHaveCount(0);
  });

  test("list budget: empty means none, zero stays zero, saves once on blur", async ({ authenticatedPage: page }) => {
    await page.getByRole("tab", { name: "Shopping" }).click();
    const budget = page.getByLabel("List budget");
    await expect(budget).toBeVisible();
    const original = await budget.inputValue();

    // Typing does not save per keystroke: no toast until we leave the field
    await budget.fill("");
    await budget.type("12.5");
    await expect(page.getByText("Budget updated")).toHaveCount(0);
    await budget.blur();
    await expect(page.getByText("Budget updated")).toHaveCount(1);
    await expect(page.getByText(/remaining of|over budget/)).toBeVisible();

    // Zero stays zero and offers a recommendation
    await budget.fill("0");
    await budget.blur();
    await expect(budget).toHaveValue("0");
    await expect(page.getByText(/Recommended budget/)).toBeVisible();

    // Clearing the box means no budget
    await budget.fill("");
    await budget.blur();
    await expect(budget).toHaveValue("");
    await expect(budget).toHaveAttribute("placeholder", "No budget");
    await expect(page.getByText(/No limit set/)).toBeVisible();

    // Restore whatever the list had
    if (original !== "") { await budget.fill(original); await budget.blur(); }
  });

  test("catalog: search, filter, add, edit and remove a product", async ({ authenticatedPage: page }) => {
    const name = uniqueName();
    await page.getByRole("tab", { name: "Catalog" }).click();
    await expect(page.getByTestId("product-card").first()).toBeVisible();

    // Search and category filter narrow the grid
    const all = await page.getByTestId("product-card").count();
    await page.getByLabel("Search the catalog").fill("zzz-no-such-food");
    await expect(page.getByText("No products match")).toBeVisible();
    await page.getByLabel("Search the catalog").fill("");
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("button", { name: /^Dairy/ }).click();
    await page.keyboard.press("Escape");
    expect(await page.getByTestId("product-card").count()).toBeLessThan(all);
    await page.getByRole("button", { name: "Clear all filters" }).click();

    // Add a product
    await page.getByRole("button", { name: "Add product" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Add product" }).click();
    await page.getByLabel("Search the catalog").fill(name);
    const card = page.getByTestId("product-card").filter({ hasText: name });
    await expect(card).toHaveCount(1);

    // Adding to inventory opens the item dialog prefilled, and saves nothing until confirmed
    await card.getByRole("button", { name: `Add ${name} to inventory` }).click();
    await expect(page.getByRole("dialog").getByLabel("Name", { exact: true })).toHaveValue(name);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // Edit, then remove with confirmation
    await card.getByRole("button", { name: `More actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(name + "-x");
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
    await page.getByLabel("Search the catalog").fill(name + "-x");
    const edited = page.getByTestId("product-card").filter({ hasText: name + "-x" });
    await expect(edited).toHaveCount(1);
    await edited.getByRole("button", { name: `More actions for ${name}-x` }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(edited).toHaveCount(0);
  });

  test("catalog: the list pages through 50 at a time; filters show only when on and can be saved", async ({ authenticatedPage: page }) => {
    await page.getByRole("tab", { name: "Catalog" }).click();
    await page.getByRole("button", { name: "List", exact: true }).click();
    const pager = page.getByRole("navigation", { name: "Catalog pages" }).first();
    await expect(page.getByTestId("product-card")).toHaveCount(50);
    await expect(pager).toContainText("1–50 of");
    await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeDisabled();
    await page.getByRole("button", { name: "Next page" }).first().click();
    await expect(pager).toContainText("51–100 of");
    await page.getByRole("button", { name: "Previous page" }).first().click();
    await expect(pager).toContainText("1–50 of");

    // Nothing is shown as active until a filter is on; each active one can be removed on its own
    const active = page.getByRole("group", { name: "Active filters" });
    await expect(active).toHaveCount(0);
    await page.getByRole("button", { name: /^Filters/ }).click();
    const popover = page.getByRole("dialog");
    await popover.getByRole("button", { name: /^Dairy/ }).click();
    await popover.getByRole("group", { name: "Diet" }).getByRole("button", { name: "Vegan" }).click();
    await page.keyboard.press("Escape");
    await expect(active).toContainText("Dairy");
    await expect(active).toContainText("Vegan");
    await active.getByRole("button", { name: "Remove Vegan filter" }).click();
    await expect(active).not.toContainText("Vegan");

    // Save the combination as a quick filter, use it, then delete it
    const name = uniqueName();
    await active.getByRole("button", { name: "Save filters" }).click();
    await page.getByLabel("Saved filter name").fill(name);
    await page.getByRole("button", { name: "Save and pin" }).click();
    const quick = page.getByRole("group", { name: "Quick filters" }).getByRole("button", { name: name });
    await expect(quick).toHaveAttribute("aria-pressed", "true");
    await quick.click();
    await expect(active).toHaveCount(0);
    await quick.click();
    await expect(active).toContainText("Dairy");
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("button", { name: `Delete saved filter ${name}` }).click();
    await expect(quick).toHaveCount(0);
  });

  test("kitchen: recipes ranked by stock, add missing to a list, appliances", async ({ authenticatedPage: page, apiContext }) => {
    const tag = uniqueName();
    const created = await (await apiContext.post("/api/recipes", { data: {
      name: `${tag} recipe`, servings: 2,
      ingredients: [{ name: `${tag} saffron`, quantity: 1, unit: "jar" }] } })).json();
    try {
      await page.reload();
      await page.getByRole("tab", { name: "Kitchen" }).click();
      await expect(page.getByTestId("recipe-card").first()).toBeVisible();

      // Cooking is confirmed first (cancel: stock untouched)
      const card = page.getByTestId("recipe-card").filter({ hasText: tag });
      await expect(card).toContainText("1 missing");
      await card.getByRole("button", { name: "Cook this" }).click();
      await expect(page.getByRole("alertdialog")).toContainText("missing");
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

      // Missing ingredients become shopping-list entries with an editable quantity
      await card.getByRole("button", { name: /^Add 1 to a list/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(`${tag} saffron quantity`).fill("2");
      await dialog.getByRole("button", { name: /^Add 1 to list/ }).click();
      await expect(page.getByText(/Added 1 item to/)).toBeVisible();
      const shopping = await (await apiContext.get("/api/shopping")).json();
      const entry = shopping.items.find((i) => i.name === `${tag} saffron`);
      expect(entry && Number(entry.quantity)).toBe(2);
      const stock = await (await apiContext.get("/api/groceries")).json();
      expect(stock.some((g) => g.name === `${tag} saffron`)).toBe(false);
      if (entry) await apiContext.delete(`/api/shopping/${entry.id}`);

      // Appliances: add and remove
      await page.getByRole("button", { name: "Add appliance" }).click();
      await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(`${tag} grill`);
      await page.getByRole("dialog").getByRole("button", { name: "Add appliance" }).click();
      const app = page.getByTestId("appliance-card").filter({ hasText: `${tag} grill` });
      await expect(app).toHaveCount(1);
      await app.getByRole("button", { name: `Remove ${tag} grill` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
      await expect(app).toHaveCount(0);
    } finally {
      await apiContext.delete(`/api/recipes/${created.id}`);
    }
  });

  test("shopping: delete a single item from the list (BUG-006)", async ({ authenticatedPage: page, apiContext }) => {
    const name = uniqueName();
    // The page opens the first list that is not archived: put the item there (the account has several lists).
    const lists = (await (await apiContext.get("/api/shopping")).json()).lists;
    const shown = lists.find((l) => !l.archived) || lists[0];
    const item = await (await apiContext.post("/api/shopping", { data: { name, list_id: shown.id } })).json();
    try {
      await page.reload();
      await page.getByRole("tab", { name: "Shopping" }).click();
      await page.getByRole("button", { name: `Delete ${name}` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(page.getByText("Could not delete")).toHaveCount(0);
      await expect(page.getByRole("button", { name: `Delete ${name}` })).toHaveCount(0);
      await expect.poll(async () => (await (await apiContext.get("/api/shopping")).json()).items.some((i) => i.id === item.id)).toBe(false);
    } finally {
      await apiContext.post("/api/shopping/bulk-delete", { data: { ids: [item.id] } });
    }
  });

  test("no empty-state flash: last-seen data shows instantly, skeleton on a cold start", async ({ authenticatedPage: page }) => {
    // Slow every API response so any placeholder would have time to show
    await page.route("**/api/**", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    const flashes = [];
    page.on("framenavigated", () => {});
    await page.exposeFunction("reportFlash", (t) => flashes.push(t));
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const t = document.body?.innerText || "";
        for (const bad of ["Nothing about to expire", "Stocked up", "No products match", "No recipes yet"]) {
          if (t.includes(bad)) window.reportFlash(bad);
        }
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });

    // Cold start (cache emptied): a skeleton, not "nothing here"
    // Clear before the app boots on every load, so a warm-up from the previous page cannot refill it
    await page.addInitScript(() => Object.keys(localStorage).filter((k) => k.startsWith("lm_cache:")).forEach((k) => localStorage.removeItem(k)));
    await page.goto("/groceries");
    await expect(page.getByLabel("Loading groceries")).toBeVisible();
    await expect(page.getByText("Items in stock")).toBeVisible({ timeout: 10000 });

    // Leave and come back: the last-seen data is there immediately, long before the 1.5s responses arrive
    await page.getByTestId("nav-tasks").click();
    await page.getByTestId("nav-groceries").click();
    await expect(page.getByRole("button", { name: /^Greek yoghurt/ }).first()).toBeVisible({ timeout: 800 });
    await page.getByRole("tab", { name: "Catalog" }).click();
    await expect(page.getByTestId("product-card").first()).toBeVisible({ timeout: 800 });
    await page.getByRole("tab", { name: "Kitchen" }).click();
    await expect(page.getByTestId("recipe-card").first()).toBeVisible({ timeout: 800 });

    expect(flashes).toEqual([]);
  });

  test("signing out clears the cached page data", async ({ authenticatedPage: page }) => {
    await page.goto("/groceries");
    await expect(page.getByText("Items in stock")).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("lm_cache:")))).toBe(true);
    await page.getByTestId("logout-btn").click();
    await page.waitForURL(/login/);
    // the page may still be settling after the redirect, so retry until the cache is gone
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("lm_cache:"))).catch(() => true)).toBe(false);
  });
});
