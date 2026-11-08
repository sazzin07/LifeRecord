import { test, expect } from "./fixtures";

/* The add bar at the top of Groceries, against the real backend, each test on an account of its own. */
test.use({ contextOptions: { reducedMotion: "reduce" } });
test.describe.configure({ timeout: 120000 });

const bar = (page) => page.getByRole("combobox", { name: /^Add (a food|to the shopping list)/ });
const food = async (fresh) => (await (await fresh.api.get("/api/groceries")).json());
const shop = async (fresh) => (await (await fresh.api.get("/api/shopping")).json()).items;

test.describe("Groceries add bar", () => {
  test("a food goes into the open space; 'buy ...' goes on the list", async ({ freshUserPage: { page, fresh } }) => {
    await fresh.api.post("/api/storage-locations", { data: { name: "Fridge", kind: "fridge", sort_order: 0 } });
    await fresh.api.post("/api/storage-locations", { data: { name: "Pantry", kind: "pantry", sort_order: 1 } });
    await fresh.api.post("/api/shopping/lists", { data: { name: "Weekly shop" } });
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Storage" }).click();
    await page.locator(".gt-chipbar").getByRole("button", { name: /^Pantry/ }).click();
    await expect(page.locator("[data-k3d]")).toHaveAttribute("data-open", "Pantry", { timeout: 20000 });

    await expect(bar(page)).toHaveAttribute("placeholder", /put it in Pantry/);
    await bar(page).fill("coffee beans");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await food(fresh)).find((g) => g.name === "Coffee beans")?.storage_location).toBe("Pantry");
    await expect(bar(page)).toHaveValue("");

    await bar(page).fill("buy oat milk");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(async () => (await shop(fresh)).some((i) => i.name === "Oat milk")).toBe(true);
    expect((await food(fresh)).some((g) => g.name === "Oat milk")).toBe(false);
  });

  test("on Shopping it understands quantities and suggests what you know", async ({ freshUserPage: { page, fresh } }) => {
    await fresh.api.post("/api/storage-locations", { data: { name: "Fridge", kind: "fridge", sort_order: 0 } });
    await fresh.api.post("/api/groceries", { data: { name: "Whole milk", quantity: 2, unit: "L", category: "Dairy", storage_location: "Fridge" } });
    await fresh.api.post("/api/shopping/lists", { data: { name: "Weekly shop" } });
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Shopping" }).click();

    await bar(page).fill("3 lemons");
    await page.keyboard.press("Enter");
    await expect.poll(async () => { const l = (await shop(fresh)).find((i) => i.name === "Lemons"); return l && Number(l.quantity); }).toBe(3);

    await bar(page).fill("500 g rice");
    await page.keyboard.press("Enter");
    await expect.poll(async () => { const r = (await shop(fresh)).find((i) => i.name === "Rice"); return r && `${Number(r.quantity)} ${r.unit}`; }).toBe("500 g");

    await bar(page).fill("milk");
    const options = page.getByRole("listbox", { name: "Suggestions" });
    await expect(options.getByRole("option", { name: /Whole milk/ })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(options.getByRole("option", { name: /Whole milk/ })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await shop(fresh)).some((i) => i.name === "Whole milk")).toBe(true);
    await expect(page.getByRole("region", { name: "Shopping list" })).toContainText("Whole milk");
    await bar(page).fill("zzz");
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveValue("");
  });

  test("with no kitchen set up it says so instead of failing silently", async ({ freshUserPage: { page, fresh } }) => {
    await fresh.api.post("/api/shopping/lists", { data: { name: "Weekly shop" } });
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Shopping" }).click();
    await page.getByRole("tab", { name: "Today" }).click();
    await expect(bar(page)).toBeVisible();
    await bar(page).fill("apples");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Set up your kitchen first")).toBeVisible();
    expect((await food(fresh)).length).toBe(0);
  });
});
