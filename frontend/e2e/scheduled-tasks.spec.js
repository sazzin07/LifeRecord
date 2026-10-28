import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect } from "./fixtures";

const BACKEND = path.resolve(__dirname, "../../backend");
const PY = path.join(BACKEND, ".venv/Scripts/python.exe");
const seedHistory = (arg) => JSON.parse(execFileSync(PY, ["tests/support_seed_runs.py", arg], { cwd: BACKEND, encoding: "utf8" }).trim().split("\n").pop());

async function openScheduled(page) {
  await page.waitForTimeout(2600); // welcome splash
  await page.getByTestId("ai-fab").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  if ((await page.getByTestId("ai-panel").getAttribute("data-wide")) !== "true") await page.getByTestId("ai-wide").click();
  await page.getByTestId("ai-nav-scheduled").click();
  await expect(page.getByTestId("scheduled-view")).toBeVisible();
}

async function cleanup(apiContext) {
  const tasks = await (await apiContext.get("/api/scheduled/tasks")).json();
  for (const t of tasks.filter((x) => /^E2E/.test(x.title) || /^Copy of E2E/.test(x.title))) await apiContext.delete(`/api/scheduled/tasks/${t.id}`);
}

const apiTask = (title, extra = {}) => ({
  title, instruction: "Count my open tasks and list any that are overdue.", timezone: "UTC", data_sources: ["tasks"], recipients: [],
  schedule: { kind: "daily", time: "09:00" }, ...extra,
});

test.describe("Scheduled tasks", () => {
  test.afterEach(async ({ apiContext }) => { await cleanup(apiContext); });

  test("create step by step: live schedule check, validation, no email promised, explicit confirmation", async ({ authenticatedPage: page, apiContext }) => {
    await openScheduled(page);
    await page.getByTestId("scheduled-new").click();
    await page.getByTestId("wizard-manual").click();

    await page.getByTestId("schedule-kind").click();
    await page.getByRole("option", { name: "Every day" }).click();
    await page.getByTestId("schedule-time").fill("99:99");
    await expect(page.getByTestId("schedule-error")).toContainText("Time must look like");
    await expect(page.getByTestId("wizard-next")).toBeDisabled();
    await page.getByTestId("schedule-time").fill("07:30");
    await expect(page.getByTestId("schedule-preview")).toContainText("Every day at 07:30");
    await expect(page.getByTestId("schedule-preview").locator("li")).toHaveCount(5);
    await page.getByTestId("wizard-next").click();

    await page.getByTestId("task-title").fill("E2E morning report");
    await page.getByTestId("task-instruction").fill("Summarise my open tasks and anything overdue.");
    await page.getByTestId("source-tasks").click();
    const mailReady = (await (await apiContext.get("/api/scheduled/options")).json()).email.configured;
    if (mailReady) {
      await expect(page.getByTestId("email-not-ready")).toHaveCount(0);
      await expect(page.getByTestId("recipient-check").first()).toBeEnabled();               // your own verified address can be ticked
    } else {
      await expect(page.getByTestId("email-not-ready")).toContainText("can’t be emailed yet"); // honest about the missing mail setup
      await expect(page.getByTestId("recipient-check").first()).toBeDisabled();
    }
    await page.getByTestId("wizard-next").click();

    await expect(page.getByTestId("wizard-review")).toContainText("E2E morning report");
    await expect(page.getByTestId("wizard-review")).toContainText("No one. Results stay in the run history.");
    await expect(page.getByTestId("wizard-activate")).toBeDisabled();           // nothing runs until it is confirmed
    expect((await (await apiContext.get("/api/scheduled/tasks")).json()).filter((t) => t.title === "E2E morning report")).toHaveLength(0);
    await page.getByTestId("wizard-confirm").click();
    await page.getByTestId("wizard-activate").click();

    await expect(page.getByTestId("task-detail")).toBeVisible();
    await expect(page.getByTestId("task-status")).toHaveText("Active");
    const made = (await (await apiContext.get("/api/scheduled/tasks")).json()).find((t) => t.title === "E2E morning report");
    expect(made.status).toBe("active");
    expect(made.data_sources).toEqual(["tasks"]);
    expect(made.next_run_at).toBeTruthy();
    expect(made.confirmed_at).toBeTruthy();
  });

  test("a task that has not been confirmed is clearly a draft and can be reviewed, saved or activated later", async ({ authenticatedPage: page, apiContext }) => {
    const draft = await (await apiContext.post("/api/scheduled/tasks", { data: apiTask("E2E draft task") })).json();
    await openScheduled(page);
    const card = page.getByTestId("task-card").filter({ hasText: "E2E draft task" });
    await expect(card).toContainText("Needs review");
    await expect(card).toContainText("Not running yet");
    await card.click();
    await expect(page.getByTestId("task-detail")).toContainText("not running yet");
    await expect(page.getByTestId("history-empty")).toContainText("Preview it");
    await page.getByTestId("task-review").click();
    await expect(page.getByTestId("wizard-review")).toBeVisible();
    await page.getByTestId("wizard-save-draft").click();
    await expect(page.getByTestId("task-status")).toHaveText("Needs review");
    expect((await (await apiContext.get(`/api/scheduled/tasks/${draft.id}`)).json()).status).toBe("draft");
  });

  test("pause and resume from the card; the next run time comes back", async ({ authenticatedPage: page, apiContext }) => {
    const t = await (await apiContext.post("/api/scheduled/tasks", { data: apiTask("E2E toggle task") })).json();
    await apiContext.post(`/api/scheduled/tasks/${t.id}/activate`, { data: { confirm: true } });
    await openScheduled(page);
    const card = page.getByTestId("task-card").filter({ hasText: "E2E toggle task" });
    await expect(card.getByTestId("task-status")).toHaveText("Active");
    await card.getByTestId("task-card-toggle").click();
    await expect(card.getByTestId("task-status")).toHaveText("Paused");
    await expect(card.getByTestId("task-card-toggle")).toContainText("Resume");
    await card.getByTestId("task-card-toggle").click();
    await expect(card.getByTestId("task-status")).toHaveText("Active");
    const after = await (await apiContext.get(`/api/scheduled/tasks/${t.id}`)).json();
    expect(after.status).toBe("active");
    expect(new Date(after.next_run_at).getTime()).toBeGreaterThan(Date.now());
  });

  test("duplicate makes an unconfirmed copy, and delete asks first", async ({ authenticatedPage: page, apiContext }) => {
    const t = await (await apiContext.post("/api/scheduled/tasks", { data: apiTask("E2E copy me") })).json();
    await apiContext.post(`/api/scheduled/tasks/${t.id}/activate`, { data: { confirm: true } });
    await openScheduled(page);
    await page.getByTestId("task-card").filter({ hasText: "E2E copy me" }).click();
    await page.getByTestId("task-duplicate").click();
    await expect.poll(async () => (await (await apiContext.get("/api/scheduled/tasks")).json()).filter((x) => x.title === "Copy of E2E copy me").map((x) => x.status)).toEqual(["draft"]);

    await page.getByTestId("task-delete").click();
    await expect(page.getByRole("alertdialog")).toContainText("will stop running");
    await page.getByRole("button", { name: "Cancel" }).click();
    expect((await apiContext.get(`/api/scheduled/tasks/${t.id}`)).status()).toBe(200);
    await page.getByTestId("task-delete").click();
    await page.getByRole("button", { name: "Delete task" }).click();
    await expect(page.getByTestId("scheduled-view")).toBeVisible();
    await expect.poll(async () => (await apiContext.get(`/api/scheduled/tasks/${t.id}`)).status()).toBe(404);
  });

  test("failures are explained and retryable; an email that was not delivered is never shown as sent", async ({ authenticatedPage: page }) => {
    const { task_id: seeded } = seedHistory("seed");
    try {
      await openScheduled(page);
      await page.getByTestId("task-card").filter({ hasText: "E2E seeded history" }).click();
      const rows = page.getByTestId("run-row");
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0).getByTestId("run-status")).toHaveText("Succeeded");
      await expect(rows.nth(0).getByTestId("delivery-status")).toHaveText("Not delivered");
      await expect(rows.nth(1).getByTestId("run-status")).toHaveText("Failed");
      await expect(rows.nth(2).getByTestId("run-status")).toHaveText("Missed");

      await rows.nth(1).click();
      await expect(page.getByTestId("run-error")).toContainText("usage limit");
      await expect(page.getByTestId("run-retry")).toBeVisible();
      await page.getByRole("button", { name: "Back to history" }).click();

      await rows.nth(0).click();
      await expect(page.getByTestId("run-output")).toContainText("€214.60");
      await expect(page.getByTestId("run-delivery")).toContainText("sender address is not verified");
      await expect(page.getByTestId("delivery-status")).toHaveText("Not delivered");
      await expect(page.getByText("Emailed")).toHaveCount(0);
      await page.getByTestId("run-retry-email").click();            // retries; that address is not verified for this account, so nothing is sent
      await expect(page.getByTestId("run-delivery")).toContainText("no longer verified");
      await expect(page.getByTestId("delivery-status")).toHaveText("Not delivered");
      expect(seeded).toBeTruthy();
    } finally { seedHistory("clean"); }
  });

  test("on a phone the whole flow fits without sideways scrolling", async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(2600);
    await page.getByTestId("ai-fab").click();
    await page.getByTestId("ai-menu").click();
    await page.getByTestId("ai-nav-scheduled").click();
    await page.getByTestId("scheduled-new").click();
    await page.getByTestId("wizard-manual").click();
    for (const step of [1, 2, 3]) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `step ${step}`).toBe(false);
      const box = await page.getByTestId("task-wizard").boundingBox();
      expect(box.width).toBeLessThanOrEqual(390);
      if (step < 3) {
        if (step === 2) { await page.getByTestId("task-title").fill("E2E phone"); await page.getByTestId("task-instruction").fill("Summarise my tasks please."); }
        await page.getByTestId("wizard-next").click();
      }
    }
  });
});

test.describe("Scheduled tasks with the real assistant", () => {
  test.afterEach(async ({ apiContext }) => { await cleanup(apiContext); });

  test("a plain-language request becomes a reviewable schedule", async ({ authenticatedPage: page }) => {
    test.setTimeout(120000);
    await openScheduled(page);
    await page.getByTestId("scheduled-new").click();
    await page.getByTestId("wizard-request").fill("Every Monday at 9:00 AM, review my spending from the previous week, summarize the key changes, and email me the results.");
    await page.getByTestId("wizard-draft").click();
    await expect(page.getByTestId("schedule-preview")).toContainText("Every Monday at 09:00", { timeout: 60000 });
    await page.getByTestId("wizard-next").click();
    await expect(page.getByTestId("task-title")).not.toHaveValue("");
    await expect(page.getByTestId("task-instruction")).toHaveValue(/spend/i);
    await expect(page.getByTestId("source-money")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("task-title").fill("E2E drafted by AI");
    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-save-draft").click();
    await expect(page.getByTestId("task-status")).toHaveText("Needs review");
  });

  test("preview writes a real report from live data without emailing, and Run now adds to the history", async ({ authenticatedPage: page, apiContext }) => {
    test.setTimeout(240000);
    const t = await (await apiContext.post("/api/scheduled/tasks", { data: apiTask("E2E live report", { data_sources: ["tasks", "money"], instruction: "Report how many tasks I have open and what I can spend right now." }) })).json();
    await openScheduled(page);
    await page.getByTestId("task-card").filter({ hasText: "E2E live report" }).click();
    await page.getByTestId("task-preview").click();
    const row = page.getByTestId("run-row").first();
    await expect(row.getByTestId("run-status")).toHaveText("Succeeded", { timeout: 120000 });
    await row.click();
    const output = page.getByTestId("run-output");
    await expect(output).toContainText(/€\d/);
    expect(await output.innerText()).not.toContain("**");
    await expect(page.getByTestId("run-delivery")).toHaveCount(0);   // a preview never emails
    await page.getByRole("button", { name: "Back to history" }).click();

    await apiContext.post(`/api/scheduled/tasks/${t.id}/activate`, { data: { confirm: true } });
    await page.getByRole("button", { name: "Back to scheduled tasks" }).click();
    await page.getByTestId("task-card").filter({ hasText: "E2E live report" }).click();
    await page.getByTestId("task-run-now").click();
    await expect(page.getByTestId("run-row")).toHaveCount(2, { timeout: 20000 });
    await expect(page.getByTestId("run-row").first().getByTestId("run-status")).toHaveText("Succeeded", { timeout: 120000 });
    const runs = await (await apiContext.get(`/api/scheduled/tasks/${t.id}/runs`)).json();
    expect(runs.map((r) => r.trigger).sort()).toEqual(["manual", "preview"]);
    expect(runs.every((r) => r.status === "succeeded" && r.tools_used?.length > 0)).toBe(true);
  });

  test("the scheduler really runs a due task by itself, once", async ({ apiContext }) => {
    test.setTimeout(240000);
    const at = new Date(Date.now() + 80_000);            // the next minute boundary at least ~80s away
    at.setUTCSeconds(0, 0); at.setUTCMinutes(at.getUTCMinutes() + 1);
    const hhmm = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
    const date = at.toISOString().slice(0, 10);
    const t = await (await apiContext.post("/api/scheduled/tasks", { data: apiTask("E2E scheduled by itself", { schedule: { kind: "once", date, time: hhmm }, instruction: "How many tasks do I have open? One sentence." }) })).json();
    const act = await apiContext.post(`/api/scheduled/tasks/${t.id}/activate`, { data: { confirm: true } });
    expect(act.ok(), await act.text()).toBeTruthy();

    await expect.poll(async () => (await (await apiContext.get(`/api/scheduled/tasks/${t.id}/runs`)).json()).map((r) => r.status).join(","), { timeout: 200000, intervals: [3000] }).toBe("succeeded");
    const runs = await (await apiContext.get(`/api/scheduled/tasks/${t.id}/runs`)).json();
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger).toBe("schedule");
    expect(new Date(runs[0].scheduled_for).toISOString().slice(0, 16)).toBe(at.toISOString().slice(0, 16));
    const done = await (await apiContext.get(`/api/scheduled/tasks/${t.id}`)).json();
    expect(done.status).toBe("completed");
    await new Promise((r) => setTimeout(r, 35_000));      // another scheduler pass must not run it again
    expect(await (await apiContext.get(`/api/scheduled/tasks/${t.id}/runs`)).json()).toHaveLength(1);
  });
});
