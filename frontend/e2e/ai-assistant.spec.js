import { test, expect } from "./fixtures";

// Build a server-sent-events body the way /api/ai/chat/stream sends it.
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const stream = (route, events) => route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(events) });

const REPLY = [
  "You have **2.00€** left in cash and **€1,250.00** saved.",
  "",
  "| Date | Description | Amount |",
  "| --- | --- | --- |",
  "| 23 Oct 2026 | Uber Eats | €9.58 |",
  "| 22 Oct 2026 | Turk Kebab | 13.5€ |",
  "",
  "- **Groceries** are on track",
].join("\n");

async function openPanel(page) {
  await page.getByTestId("ai-trigger").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
}

test.describe("Assistant panel", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(2600); // welcome splash
  });

  test("amounts are tidy: no stray asterisks, euro first, ledger styling, tables aligned", async ({ authenticatedPage: page }) => {
    await page.route("**/api/ai/chat/stream", (route) => stream(route, [
      { type: "session", session_id: "s1" },
      { type: "delta", text: REPLY },
      { type: "done", reply: REPLY, session_id: "s1", actions: [{ tool: "create_task", args: {}, error: null }, { tool: "get_tasks", args: {}, error: null }], changed: true },
    ]));
    await openPanel(page);
    await page.getByTestId("ai-input").fill("how much cash do I have?");
    await page.keyboard.press("Enter");

    const reply = page.getByTestId("ai-message-assistant").last();
    await expect(reply).toContainText("You have €2.00 left in cash");
    const text = await reply.innerText();
    expect(text).not.toContain("**");
    expect(text).not.toMatch(/\d€/);
    await expect(reply.locator(".lm-money").first()).toHaveText("€2.00");
    await expect(reply.locator("table")).toBeVisible();
    await expect(reply.locator("td").filter({ hasText: "€13.50" })).toHaveClass(/text-right/);
    await expect(reply.getByTestId("ai-changes")).toContainText("Added a task");
    await expect(reply.getByTestId("ai-changes")).not.toContainText("Checking");
  });

  test("a failed answer keeps the question and offers a retry that works", async ({ authenticatedPage: page }) => {
    let attempts = 0;
    await page.route("**/api/ai/chat/stream", (route) => {
      attempts += 1;
      if (attempts === 1) return stream(route, [{ type: "session", session_id: "s2" }, { type: "error", message: "The assistant is busy right now. Please try again in a moment." }]);
      return stream(route, [{ type: "delta", text: "Back online." }, { type: "done", reply: "Back online.", session_id: "s2", actions: [], changed: false }]);
    });
    await openPanel(page);
    await page.getByTestId("ai-input").fill("hello there");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("ai-error")).toContainText("busy right now");
    await expect(page.getByTestId("ai-message-user")).toHaveCount(1);
    await page.getByTestId("ai-retry").click();
    await expect(page.getByTestId("ai-message-assistant").last()).toContainText("Back online.");
    await expect(page.getByTestId("ai-message-user")).toHaveCount(1); // retry does not duplicate the question
    await expect(page.getByTestId("ai-error")).toHaveCount(0);
  });

  test("streams in pieces, shows progress, and Stop keeps what arrived", async ({ authenticatedPage: page }) => {
    await page.route("**/api/ai/chat/stream", async (route) => {
      await new Promise((r) => setTimeout(r, 4000)); // slow enough to press Stop
      await stream(route, [{ type: "delta", text: "late" }, { type: "done", reply: "late", session_id: "s3", actions: [], changed: false }]);
    });
    await openPanel(page);
    await page.getByTestId("ai-input").fill("take your time");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ai-typing")).toBeVisible();
    await expect(page.getByTestId("ai-stop")).toBeVisible();
    await page.getByTestId("ai-stop").click();
    await expect(page.getByTestId("ai-message-assistant").last()).toHaveAttribute("data-status", "stopped");
    await expect(page.getByTestId("ai-send")).toBeVisible();
  });

  test("the draft survives Esc, focus returns to the button, and Shift+Enter adds a line", async ({ authenticatedPage: page }) => {
    await openPanel(page);
    const input = page.getByTestId("ai-input");
    await expect(input).toBeFocused();
    await input.fill("first line");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("second line");
    await expect(page.getByTestId("ai-message-user")).toHaveCount(0); // nothing was sent
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ai-panel")).toHaveCount(0);
    await expect(page.getByTestId("ai-trigger")).toBeFocused();
    await openPanel(page);
    await expect(page.getByTestId("ai-input")).toHaveValue("first line\nsecond line");
  });

  test("works on a phone: sheet fills the width, nothing overflows sideways", async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.getByTestId("ai-trigger").click();
    const box = await page.getByTestId("ai-panel").boundingBox();
    expect(box.x).toBeLessThanOrEqual(1);
    expect(Math.round(box.width)).toBe(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await expect(page.getByTestId("ai-input")).toBeVisible();
    const send = await page.getByTestId("ai-send").boundingBox();
    expect(send.x + send.width).toBeLessThanOrEqual(390);
  });

  test("respects reduced motion", async ({ authenticatedPage: page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("ai-trigger").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 800 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ai-panel")).toHaveCount(0, { timeout: 800 });
  });

  test("a new chat clears the conversation and shows the suggestions again", async ({ authenticatedPage: page }) => {
    await page.route("**/api/ai/chat/stream", (route) => stream(route, [
      { type: "delta", text: "Noted." }, { type: "done", reply: "Noted.", session_id: "keep-me", actions: [], changed: false }]));
    await openPanel(page);
    await page.getByTestId("ai-input").fill("remember this");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ai-message-assistant").last()).toContainText("Noted.");
    await page.getByTestId("ai-new").click();
    await expect(page.getByTestId("ai-message-user")).toHaveCount(0);
    await expect(page.getByTestId("ai-empty")).toBeVisible();
  });
});

test.describe("Assistant with the real model", () => {
  test("answers from live data and a change shows up on the Tasks page", async ({ authenticatedPage: page, apiContext }) => {
    test.setTimeout(150000);
    await page.goto("/");
    await page.waitForTimeout(2600);
    const title = `E2E AI task ${Date.now()}`;
    try {
      await openPanel(page);
      await page.getByTestId("ai-input").fill("What can I spend right now? Give the amount.");
      await page.keyboard.press("Enter");
      const first = page.getByTestId("ai-message-assistant").last();
      await expect(first).toHaveAttribute("data-status", "done", { timeout: 60000 });
      const answer = await first.innerText();
      expect(answer).toMatch(/€\d/);
      expect(answer).not.toContain("**");
      expect(answer).not.toMatch(/\d€/);

      await page.getByTestId("ai-input").fill(`Add a task called "${title}"`);
      await page.keyboard.press("Enter");
      const second = page.getByTestId("ai-message-assistant").last();
      await expect(second.getByTestId("ai-changes")).toContainText("Added a task", { timeout: 60000 });

      await page.keyboard.press("Escape");
      await page.getByTestId("nav-tasks").click();
      await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
    } finally {
      const tasks = await (await apiContext.get("/api/tasks")).json();
      for (const t of tasks.filter((x) => x.title.includes("E2E AI task"))) await apiContext.delete(`/api/tasks/${t.id}`);
      for (const q of ["E2E AI task", "What can I spend right now"]) {
        const chats = await (await apiContext.get(`/api/ai/conversations?q=${encodeURIComponent(q)}`)).json();
        for (const c of chats) await apiContext.delete(`/api/ai/conversations/${c.id}`);
      }
    }
  });
});
