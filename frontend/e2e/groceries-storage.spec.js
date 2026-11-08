import { test, expect } from "./fixtures";

/* The Storage tab: the 3D kitchen (three.js) with its real HTML around it, each test on an account of its own.
   The room is a canvas, so what these tests press are the chips, the plinth labels and the side panel (the same things a keyboard
   or a screen reader uses); the one canvas gesture, dragging food onto another unit, goes through the room's own screen position. */

async function stock(fresh) {
  const place = (name, kind, sort_order) => fresh.api.post("/api/storage-locations", { data: { name, kind, sort_order } });
  await place("Fridge", "fridge", 0); await place("Freezer", "freezer", 1); await place("Pantry", "pantry", 2);
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const add = async (data) => (await (await fresh.api.post("/api/groceries", { data })).json());
  const milk = await add({ name: "Whole milk", quantity: 2, unit: "L", category: "Dairy", storage_location: "Fridge", expiration: day(1), price: 1.2 });
  await add({ name: "Cheddar", quantity: 1, unit: "block", category: "Dairy", storage_location: "Fridge", expiration: day(20) });
  await add({ name: "Rice", quantity: 3, unit: "kg", category: "Carbohydrates", storage_location: "Pantry", expiration: day(120), low_threshold: 5 });
  return { milk };
}

const chip = (page, name) => page.locator(".gt-chipbar").getByRole("button", { name: new RegExp(`^${name}`) });
const room = (page) => page.locator("[data-k3d]");

test.describe("Groceries Storage (3D room)", () => {
  // Reduced motion: the room only redraws when something moves, which keeps a software-rendered browser responsive.
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  test.describe.configure({ timeout: 120000 });   // a software-rendered browser draws the room slowly
  test("open a unit from the chips, see what is inside, and go back to the overview", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Storage" }).click();
    await expect(room(page)).toHaveAttribute("data-view", "overview", { timeout: 20000 });
    await expect(page.getByText("Your kitchen")).toBeVisible();
    await expect(page.locator(".gt-ulabel")).toHaveCount(3);

    await chip(page, "Fridge").click();
    await expect(chip(page, "Fridge")).toHaveAttribute("aria-pressed", "true");
    await expect(room(page)).toHaveAttribute("data-open", "Fridge");
    await expect(room(page)).toHaveAttribute("data-view", "unit");
    const list = page.getByRole("region", { name: "Everything in Fridge" });
    await expect(list).toContainText("Whole milk");
    await expect(list).toContainText("Cheddar");
    await expect(list).not.toContainText("Rice");

    // Another unit takes over; the main view shows the whole kitchen again
    await chip(page, "Pantry").click();
    await expect(room(page)).toHaveAttribute("data-open", "Pantry");
    await expect(page.getByRole("region", { name: "Everything in Pantry" })).toContainText("Rice");
    await page.getByRole("button", { name: "Overview" }).click();
    await expect(room(page)).toHaveAttribute("data-view", "overview");

    // Escape steps back one level at a time: the zoomed view first, then the open unit
    await chip(page, "Pantry").click();
    await expect(room(page)).toHaveAttribute("data-view", "unit");
    await page.keyboard.press("Escape");
    await expect(room(page)).toHaveAttribute("data-view", "overview");
    await page.keyboard.press("Escape");
    await expect(room(page)).toHaveAttribute("data-open", "");
  });

  test("an item's controls: use one, add one, move it, put it on the list, discard asks first", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Storage" }).click();
    await chip(page, "Fridge").click();
    await page.getByRole("button", { name: /^Whole milk/ }).click();
    const card = page.getByRole("region", { name: "Whole milk details" });
    await expect(card).toContainText("2 L");

    const quantity = async () => Number((await (await fresh.api.get("/api/groceries")).json()).find((g) => g.name === "Whole milk").quantity);
    await card.getByRole("button", { name: "Use one Whole milk" }).click();
    await expect.poll(quantity).toBe(1.5);
    await card.getByRole("button", { name: "Add one Whole milk" }).click();
    await expect.poll(quantity).toBe(2);

    await card.getByRole("button", { name: "Add to list" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/shopping")).json()).items.some((i) => i.name === "Whole milk")).toBe(true);

    await card.getByRole("button", { name: "Freezer" }).click();
    await expect.poll(async () => (await (await fresh.api.get("/api/groceries")).json()).find((g) => g.name === "Whole milk").storage_location).toBe("Freezer");
    // It left the open unit, so its card closes with it
    await expect(page.getByRole("region", { name: "Whole milk details" })).toHaveCount(0);

    await chip(page, "Freezer").click();
    await page.getByRole("button", { name: /^Whole milk/ }).click();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("removes Whole milk");
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    expect((await (await fresh.api.get("/api/groceries")).json()).some((g) => g.name === "Whole milk")).toBe(true);
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click({ force: true });   // the room's slow redraw can make the dialog look "unstable" to the click check
    await expect.poll(async () => (await (await fresh.api.get("/api/groceries")).json()).some((g) => g.name === "Whole milk")).toBe(false);
  });

  test("dragging food onto another unit in the room moves it", async ({ freshUserPage: { page, fresh } }) => {
    const { milk } = await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Storage" }).click();
    await chip(page, "Fridge").click();
    // Wait until the milk has popped onto its shelf, then pick it up where it really is on screen
    let at = null;
    await expect.poll(async () => { at = await page.evaluate((id) => document.querySelector("[data-k3d]").__k3d.itemScreenPos(id), milk.id); return !!at; }, { timeout: 20000 }).toBe(true);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 14, at.y + 14, { steps: 4 });
    const to = await chip(page, "Pantry").boundingBox();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(page.locator(".gt-dragtag")).toContainText("Move to Pantry");
    await page.mouse.up();
    await expect.poll(async () => (await (await fresh.api.get("/api/groceries")).json()).find((g) => g.name === "Whole milk").storage_location).toBe("Pantry");
  });

  test("Add space and Edit space: a new unit appears in the room and keeps its name", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Storage" }).click();
    await page.getByRole("button", { name: "Add space" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Garage fridge");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(chip(page, "Garage fridge")).toBeVisible();
    await expect(room(page)).toHaveAttribute("data-open", "Garage fridge", { timeout: 20000 });
    await expect(page.locator(".gt-ulabel")).toHaveCount(4);   // one plinth label per unit
    await page.getByRole("button", { name: "More details" }).click();
    await page.getByRole("button", { name: "Edit Garage fridge" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Garage freezer");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(chip(page, "Garage freezer")).toBeVisible();
    await expect.poll(async () => (await (await fresh.api.get("/api/storage-locations")).json()).map((l) => l.name).sort()).toEqual(["Fridge", "Freezer", "Garage freezer", "Pantry"].sort());
  });

  test("the tips, See-through and closing a unit", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Storage" }).click();
    await page.getByRole("button", { name: "Tips for the room" }).click();
    await expect(page.getByRole("dialog", { name: "Around the room" })).toContainText("Drag an item onto another unit");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Around the room" })).toHaveCount(0);

    await chip(page, "Freezer").click();
    await expect(page.getByText("one at a time")).toBeVisible();
    const seeThrough = page.getByRole("button", { name: "See-through" });
    await expect(seeThrough).toHaveAttribute("aria-pressed", "true");
    await seeThrough.click();
    await expect(seeThrough).toHaveAttribute("aria-pressed", "false");
    await chip(page, "Fridge").click();
    await page.getByRole("button", { name: "Close Fridge" }).click();
    await expect(room(page)).toHaveAttribute("data-open", "");
  });

  test("a new space and the flat view both work; the choice is remembered", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Storage" }).click();
    await expect(room(page)).toBeVisible();
    await page.getByRole("button", { name: "Flat view" }).click();
    await expect(room(page)).toHaveCount(0);
    await expect(page.getByTestId("unit-fridge")).toHaveAttribute("data-mode", "wall");
    await page.getByTestId("unit-fridge").click();
    await expect(page.getByTestId("unit-fridge")).toHaveAttribute("data-mode", "hero");
    await expect(page.getByTestId("shelf-item").first()).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "Storage" }).click();
    await expect(page.getByTestId("unit-fridge")).toBeVisible();
    await page.getByRole("button", { name: "3D room" }).click();
    await expect(room(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Flat view" })).toBeVisible();
  });
});

test.describe("Groceries Storage without WebGL", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : original.call(this, type, ...rest); };
    });
  });

  test("falls back to the flat view and says so", async ({ freshUserPage: { page, fresh } }) => {
    await stock(fresh);
    await page.goto("/groceries");
    await page.getByRole("tab", { name: "Storage" }).click();
    await expect(page.getByText(/3D room could not start here/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("unit-fridge")).toBeVisible();
    await expect(page.getByRole("button", { name: "3D room" })).toHaveCount(0);
  });
});
