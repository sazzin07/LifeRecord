import { test, expect } from "./fixtures";

// TASK-001, FIT-001, BODY-001, QUICK-001: edit flows on Tasks, Fitness and Body, and the QuickAdd workout form.
// Records are created through the API with an E2E- prefix and removed afterwards.

const tag = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("edit a task's title, priority, due date and repeat; completing it schedules the next one", async ({ authenticatedPage: page, apiContext }) => {
  const title = tag();
  const created = await (await apiContext.post("/api/tasks", { data: { title } })).json();
  try {
    await page.goto("/tasks");
    await page.getByTestId(`task-edit-${created.id}`).click();
    const dialog = page.getByTestId("task-edit-dialog");
    await expect(dialog).toBeVisible();
    // Repeat needs a due date first.
    await expect(dialog.getByTestId("task-edit-repeat")).toBeDisabled();
    await dialog.getByTestId("task-edit-title").fill(`${title}-edited`);
    await dialog.getByTestId("task-edit-priority").click();
    await page.getByRole("option", { name: "High" }).click();
    await dialog.getByTestId("task-edit-due").click();
    await page.getByRole("button", { name: "Tomorrow" }).click();
    await dialog.getByTestId("task-edit-repeat").click();
    await page.getByRole("option", { name: "Weekly" }).click();
    await dialog.getByTestId("task-edit-save").click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId(`task-title-${created.id}`)).toHaveText(`${title}-edited`);

    const saved = (await (await apiContext.get("/api/tasks")).json()).find((t) => t.id === created.id);
    expect(saved).toMatchObject({ title: `${title}-edited`, priority: "high", recurring: "weekly" });
    expect(saved.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.getByTestId(`task-check-${created.id}`).click();
    await expect(page.getByText("the next one is on your list")).toBeVisible();
    await expect.poll(async () => (await (await apiContext.get("/api/tasks")).json()).filter((t) => t.title === `${title}-edited` && !t.done).length).toBe(1);
  } finally {
    for (const t of await (await apiContext.get("/api/tasks")).json()) {
      if (t.title.startsWith(title)) await apiContext.delete(`/api/tasks/${t.id}`);
    }
  }
});

test("edit a workout's notes and sets, then delete it", async ({ authenticatedPage: page, apiContext }) => {
  const note = tag();
  const w = await (await apiContext.post("/api/workouts", { data: {
    type: "Pull", date: "2026-01-02", notes: note,
    exercises: [{ name: "Pull-ups", sets: [{ reps: 8, weight: 0 }, { reps: 6, weight: 0 }] }],
  } })).json();
  try {
    await page.goto("/fitness");
    await page.getByTestId(`workout-edit-${w.id}`).click();
    const dialog = page.getByTestId("workout-log-dialog");
    await expect(dialog).toContainText("Edit workout");
    // Uneven sets are shown and kept unless the numbers are changed.
    await expect(dialog).toContainText("Logged as 8, 6");
    await dialog.getByTestId("workout-notes").fill(`${note}-edited`);
    await dialog.getByTestId("workout-save").click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId(`workout-${w.id}`)).toContainText(`${note}-edited`);
    let saved = (await (await apiContext.get("/api/workouts")).json()).find((x) => x.id === w.id);
    expect(saved.exercises[0].sets.map((s) => s.reps)).toEqual([8, 6]);

    await page.getByTestId(`workout-edit-${w.id}`).click();
    await dialog.getByLabel("Reps").fill("10");
    await dialog.getByTestId("workout-save").click();
    await expect(dialog).not.toBeVisible();
    saved = (await (await apiContext.get("/api/workouts")).json()).find((x) => x.id === w.id);
    expect(saved.exercises[0].sets.map((s) => s.reps)).toEqual([10, 10]);

    await page.getByTestId(`workout-delete-${w.id}`).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId(`workout-${w.id}`)).toHaveCount(0);
  } finally {
    await apiContext.delete(`/api/workouts/${w.id}`);
  }
});

test("edit a weight check-in", async ({ authenticatedPage: page, apiContext }) => {
  const note = tag();
  const w = await (await apiContext.post("/api/weight", { data: { weight: 81.3, date: "2026-01-02", note } })).json();
  try {
    await page.goto("/body");
    await page.getByTestId(`weight-edit-${w.id}`).click();
    const dialog = page.getByTestId("body-edit-dialog");
    await dialog.getByTestId("body-edit-weight").fill("80.7");
    await dialog.getByTestId("body-edit-note").fill(`${note}-edited`);
    await dialog.getByTestId("body-edit-save").click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId(`weight-${w.id}`)).toContainText("80.7 kg");
    await expect(page.getByTestId(`weight-${w.id}`)).toContainText(`${note}-edited`);
  } finally {
    await apiContext.delete(`/api/weight/${w.id}`);
  }
});

test("QuickAdd workout opens the workout form and logs a session", async ({ authenticatedPage: page, apiContext }) => {
  const note = tag();
  await page.getByTestId("quick-add-trigger").click();
  await page.getByTestId("qa-workout").click();
  const dialog = page.getByTestId("workout-log-dialog");
  await expect(dialog).toContainText("Log workout");
  await dialog.getByTestId("workout-notes").fill(note);
  await dialog.getByTestId("workout-save").click();
  await expect(dialog).not.toBeVisible();
  const mine = (await (await apiContext.get("/api/workouts")).json()).filter((x) => x.notes === note);
  expect(mine).toHaveLength(1);
  expect(mine[0].type).toBe("Push");
  for (const x of mine) await apiContext.delete(`/api/workouts/${x.id}`);
});
