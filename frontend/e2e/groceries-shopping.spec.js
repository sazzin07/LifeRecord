import { test, expect } from "./fixtures";
import { openGroceriesTab } from "./support/groceries";

/* The Shopping tab against the real backend, each test on an account of its own: the trip card and its budget, Plan, In the shop,
   the shelves of suggestions, the cart, and Done shopping putting the food in the kitchen. */

async function setup(fresh, items) {
  const list = await (await fresh.api.post("/api/shopping/lists", { data: { name: "Weekly shop" } })).json();
  const made = [];
  for (const it of items) made.push(await (await fresh.api.post("/api/shopping", { data: { list_id: list.id, ...it } })).json());
  return { list, made };
}
const SHOP = [
  { name: "Whole milk", quantity: 2, unit: "L", category: "Dairy", estimated_price: 1.2 },
  { name: "Apples", quantity: 4, unit: "unit", category: "Fruit", estimated_price: 0.5 },
  { name: "Rice", quantity: 1, unit: "kg", category: "Carbohydrates", estimated_price: 2 },
];
const open = async (page) => { await page.goto("/groceries"); await page.getByRole("tab", { name: "Shopping" }).click(); };

test.describe("Groceries Shopping", () => {
  // The cart test passes through the 3D Storage tab, which only redraws when something moves under reduced motion.
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  test.describe.configure({ timeout: 120000 });

  test("the trip card follows the list; a budget and the quantity stepper change real data", async ({ freshUserPage: { page, fresh } }) => {
    const { made } = await setup(fresh, SHOP);
    await open(page);
    const trip = page.getByRole("region", { name: "Your shopping trip" });
    await expect(trip).toContainText("3 items to get");
    await expect(page.getByRole("region", { name: "Shopping list" }).getByTestId("shop-row")).toHaveCount(3);

    const quantity = async () => Number((await (await fresh.api.get("/api/shopping")).json()).items.find((i) => i.id === made[0].id).quantity);
    await page.getByRole("button", { name: "More Whole milk" }).click();
    await expect.poll(quantity).toBe(2.5);   // litres move in halves
    await page.getByRole("button", { name: "Less Whole milk" }).click();
    await expect.poll(quantity).toBe(2);

    await page.getByLabel("List budget").fill("5");
    await page.getByLabel("List budget").blur();
    await expect(trip).toContainText("over");          // 2 x 1.20 + 4 x 0.50 + 2.00 = 6.40 against 5.00
    await expect(trip.getByRole("img", { name: /of a .*5.*budget/ })).toBeVisible();
    await page.getByLabel("List budget").fill("20");
    await page.getByLabel("List budget").blur();
    await expect(trip).toContainText("left");
  });

  test("In the shop: the list by aisle, tap to put things in the basket, Done shopping asks first and fills the kitchen", async ({ freshUserPage: { page, fresh } }) => {
    await fresh.api.post("/api/storage-locations", { data: { name: "Fridge", kind: "fridge", sort_order: 0 } });
    const { made } = await setup(fresh, SHOP);
    await open(page);
    await page.getByRole("button", { name: "In the shop" }).click();
    await expect(page.getByRole("region", { name: "Dairy" })).toContainText("Whole milk");
    await expect(page.getByRole("region", { name: "Fruit" })).toContainText("Apples");
    await expect(page.getByRole("region", { name: "Bread and grains" })).toContainText("Rice");

    await page.getByRole("region", { name: "Dairy" }).getByTestId("shop-row").click();       // the whole row is the target
    await expect(page.getByRole("complementary", { name: "In the basket" })).toContainText("1 in the basket");
    await expect(page.getByRole("button", { name: /^Dairy/ })).toContainText("✓");
    await page.getByRole("region", { name: "Fruit" }).getByRole("checkbox", { name: "Apples in the basket" }).check();
    await expect(page.getByRole("complementary", { name: "In the basket" })).toContainText("2 in the basket");
    await expect.poll(async () => (await (await fresh.api.get("/api/shopping")).json()).items.filter((i) => i.selected).length).toBe(2);

    await page.getByRole("button", { name: "Done shopping" }).click();
    await expect(page.getByRole("dialog")).toContainText("Review purchase");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    expect((await (await fresh.api.get("/api/groceries")).json()).length).toBe(0);           // nothing moved until it is confirmed
    await page.getByRole("button", { name: "Done shopping" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm purchase" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/groceries")).json()).map((g) => g.name).sort()).toEqual(["Apples", "Whole milk"]);
    expect(made.length).toBe(3);
  });

  test("shelves suggest what is running low and add it to the list", async ({ freshUserPage: { page, fresh } }) => {
    await fresh.api.post("/api/storage-locations", { data: { name: "Pantry", kind: "pantry", sort_order: 0 } });
    await fresh.api.post("/api/groceries", { data: { name: "Coffee beans", quantity: 1, unit: "bag", category: "Drinks", storage_location: "Pantry", low_threshold: 3 } });
    await setup(fresh, SHOP);
    await open(page);
    const shelf = page.getByRole("region", { name: "Running low" });
    await expect(shelf).toContainText("Coffee beans");
    await shelf.getByRole("button", { name: "Add Coffee beans to the list" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/shopping")).json()).items.some((i) => i.name === "Coffee beans")).toBe(true);
    await expect(page.getByRole("region", { name: "Shopping list" })).toContainText("Coffee beans");
    await expect(page.getByRole("region", { name: "Running low" })).toHaveCount(0);
  });

  test("the cart is one tap away on every tab but Shopping, opens the list by aisle and changes quantities (phone: in the heading)", async ({ freshUserPage: { page, fresh } }) => {
    const { made } = await setup(fresh, SHOP);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto("/groceries");
    await expect(page.getByTestId("cart-fab")).toHaveCount(0);                 // a phone has no floating button: the cart sits in the page heading
    for (const tab of ["Today", "Storage", "Kitchen"]) {
      await openGroceriesTab(page, tab);
      const box = await page.getByTestId("cart-open").boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(700);
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await openGroceriesTab(page, "Shopping");
    await expect(page.getByTestId("cart-open")).toHaveCount(0);                // the list is the cart there
    await openGroceriesTab(page, "Kitchen");
    await page.getByTestId("cart-open").click();
    const cart = page.getByRole("dialog", { name: "Your cart" });
    await expect(cart).toContainText("3 to get");
    await expect(cart.getByRole("region", { name: "Dairy" })).toContainText("Whole milk");
    await cart.getByRole("button", { name: "More Apples" }).click();
    await expect.poll(async () => Number((await (await fresh.api.get("/api/shopping")).json()).items.find((i) => i.id === made[1].id).quantity)).toBe(5);
    await cart.getByRole("button", { name: "Remove Rice from the list" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/shopping")).json()).items.some((i) => i.name === "Rice")).toBe(false);
  });

  test("lists: create and switch, search, filter by category, select all, delete the selection, delete the list", async ({ freshUserPage: { page, fresh } }) => {
    await setup(fresh, SHOP);
    await open(page);
    await page.getByRole("button", { name: "New list" }).click();
    await page.getByPlaceholder("List name").fill("Party");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("group", { name: "Lists" }).getByRole("button", { name: "Party" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Your list is empty")).toBeVisible();
    await page.getByRole("group", { name: "Lists" }).getByRole("button", { name: "Weekly shop" }).click();
    const rows = page.getByRole("region", { name: "Shopping list" }).getByTestId("shop-row");
    await expect(rows).toHaveCount(3);

    await page.getByLabel("Search the list").fill("app");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Apples");
    await page.getByRole("button", { name: "Clear search" }).click();
    await page.getByRole("combobox", { name: "Filter by category" }).click();
    await page.getByRole("option", { name: "Dairy" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Whole milk");
    await page.getByRole("combobox", { name: "Filter by category" }).click();
    await page.getByRole("option", { name: "All", exact: true }).click();
    await expect(rows).toHaveCount(3);

    await page.getByRole("checkbox", { name: "Select all" }).check();
    await expect(page.getByText("3 selected")).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/shopping")).json()).items.length).toBe(0);

    await page.getByRole("button", { name: "Delete list Weekly shop" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("group", { name: "Lists" }).getByRole("button", { name: "Weekly shop" })).toHaveCount(0);
  });

  test("an item: add, edit, see its price history, delete", async ({ freshUserPage: { page, fresh } }) => {
    await setup(fresh, []);
    await open(page);
    await page.getByRole("button", { name: "Add item" }).first().click();
    await page.getByPlaceholder("Item name").fill("Olive oil");
    await page.getByPlaceholder("Quantity").fill("2");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    const row = page.getByTestId("shop-row").filter({ hasText: "Olive oil" });
    await expect(row).toBeVisible();
    await expect.poll(async () => Number((await (await fresh.api.get("/api/shopping")).json()).items.find((i) => i.name === "Olive oil")?.quantity)).toBe(2);

    await row.getByRole("button", { name: "Edit Olive oil" }).click();
    await page.getByPlaceholder("Item name").fill("Olive oil extra virgin");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("shop-row").filter({ hasText: "Olive oil extra virgin" })).toBeVisible();

    await page.getByTestId("shop-row").first().getByRole("button", { name: "Price history" }).click();
    await expect(page.getByRole("dialog")).toContainText(/price history/i);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Delete Olive oil extra virgin" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/shopping")).json()).items.length).toBe(0);
  });

  test("recurring lists: spawn one now, edit and delete it", async ({ freshUserPage: { page, fresh } }) => {
    await setup(fresh, []);
    await fresh.api.post("/api/shopping/recurring", { data: { name: "Weekend basics", schedule: "weekly", items: [{ name: "Bread", quantity: 1, unit: "unit", category: "Carbohydrates" }] } });
    await open(page);
    const card = page.getByRole("region", { name: "Recurring lists" });
    await expect(card).toContainText("Weekend basics");
    await card.getByRole("button", { name: "Spawn now" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/shopping")).json()).items.some((i) => i.name === "Bread")).toBe(true);

    await card.getByRole("button", { name: "Edit Weekend basics" }).click();
    await page.getByPlaceholder("Template name").fill("Weekend basics 2");
    await page.getByRole("dialog").getByRole("button", { name: /Save|Update/ }).click();
    await expect(card).toContainText("Weekend basics 2");

    await card.getByRole("button", { name: "Delete Weekend basics 2" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(card).toContainText("No recurring templates");
  });

  test("an empty list, and a new account with no list, say what to do next", async ({ freshUserPage: { page, fresh } }) => {
    await fresh.api.post("/api/shopping/lists", { data: { name: "Empty one" } });
    await open(page);
    await expect(page.getByText("Your list is empty")).toBeVisible();
    await page.getByRole("button", { name: "Add item" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "In the shop" }).click();
    await expect(page.getByText("Nothing to find yet")).toBeVisible();
    await page.getByRole("button", { name: "Go to Plan" }).click();
    await expect(page.getByText("Your list is empty")).toBeVisible();
  });
});
