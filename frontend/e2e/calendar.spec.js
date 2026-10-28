import { test, expect } from "./fixtures";

// CAL-001 / CAL-002: month and week grid with tasks, expiring food and logged activity.
const tag = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("month grid shows tasks and expiring food; a day can be opened, filtered and a task completed", async ({ authenticatedPage: page, apiContext }) => {
  const name = tag();
  const today = localIso(new Date());
  const task = await (await apiContext.post("/api/tasks", { data: { title: `${name} task`, due: today, priority: "high" } })).json();
  const food = await (await apiContext.post("/api/groceries", { data: { name: `${name} yoghurt`, quantity: 1, expiration: today } })).json();
  try {
    await page.goto("/calendar");
    await expect(page.getByTestId("calendar-month")).toBeVisible();
    const cell = page.getByTestId(`calendar-day-${today}`);
    await expect(cell).toHaveAttribute("aria-current", "date");
    await expect(cell).toContainText(`${name} task`);
    await expect(cell).toContainText(`${name} yoghurt expires`);

    await cell.click();
    const panel = page.getByTestId("calendar-day-panel");
    await expect(panel.getByTestId(`calendar-event-task-${task.id}`)).toBeVisible();
    await expect(panel.getByTestId(`calendar-event-expiry-${food.id}`)).toBeVisible();

    // Hiding tasks removes them from the grid and the day panel.
    await page.getByTestId("calendar-filter-task").click();
    await expect(cell).not.toContainText(`${name} task`);
    await expect(panel.getByTestId(`calendar-event-task-${task.id}`)).toHaveCount(0);
    await page.getByTestId("calendar-filter-task").click();

    // Complete the task from the calendar.
    await panel.getByTestId(`calendar-event-task-${task.id}`).getByRole("checkbox").click();
    await expect.poll(async () => (await (await apiContext.get("/api/tasks")).json()).find((t) => t.id === task.id)?.done).toBe(true);

    // Month navigation and the week view.
    const title = await page.getByTestId("calendar-title").innerText();
    await page.getByTestId("calendar-next").click();
    await expect(page.getByTestId("calendar-title")).not.toHaveText(title);
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByTestId("calendar-title")).toHaveText(title);
    await page.getByTestId("calendar-view-week").click();
    await expect(page.getByTestId("calendar-week")).toBeVisible();
    await expect(page.locator('[data-testid^="calendar-day-2"]')).toHaveCount(7); // date cells only, not the day panel
    await expect(page.getByTestId(`calendar-day-${today}`)).toContainText(`${name} yoghurt`);
  } finally {
    await apiContext.delete(`/api/tasks/${task.id}`);
    await apiContext.delete(`/api/groceries/${food.id}`);
  }
});

test("the calendar is usable at phone width", async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/calendar");
  await expect(page.getByTestId("calendar-month")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
