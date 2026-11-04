import { expect, request } from "@playwright/test";
import { test as authed, credentials } from "./fixtures";

// Chats are created through the real assistant (one short message each), then managed through the real UI.
const TAG = `e2echat${Date.now().toString(36)}`;
const API = process.env.API_URL || "http://localhost:8000";
const made = [];

async function login() {
  const anon = await request.newContext({ baseURL: API });
  const res = await anon.post("/api/auth/login", { data: credentials });
  const { token } = await res.json();
  await anon.dispose();
  return request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

async function makeChat(api, word) {
  const res = await api.post("/api/ai/chat", { data: { message: `Reply with just the word ok. Reference ${TAG} ${word}` }, timeout: 90000 });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { session_id } = await res.json();
  made.push(session_id);
  return session_id;
}

async function openWide(page) {
  await page.getByTestId("ai-trigger").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  if ((await page.getByTestId("ai-panel").getAttribute("data-wide")) !== "true") await page.getByTestId("ai-wide").click();
  await expect(page.getByTestId("ai-panel")).toHaveAttribute("data-wide", "true");
}

const item = (page, word) => page.getByTestId("ai-chat-item").filter({ hasText: word });

authed.describe("Saved chats", () => {
  let api;
  authed.beforeAll(async () => {
    authed.setTimeout(240000);
    api = await login();
    await makeChat(api, "alpha");
    await makeChat(api, "bravo");
  });
  authed.afterAll(async () => {
    for (const id of made) await api.delete(`/api/ai/conversations/${id}`).catch(() => {});
    await api.dispose();
  });
  authed.beforeEach(async ({ authenticatedPage: page }) => {
    await page.waitForTimeout(2600); // welcome splash
    await openWide(page);
    await page.getByTestId("ai-search").fill(TAG);
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(2, { timeout: 10000 });
  });

  authed("lists chats newest first with a title and preview, and reopens one with its messages", async ({ authenticatedPage: page }) => {
    const rows = page.getByTestId("ai-chat-item");
    await expect(rows.first()).toContainText("bravo");                 // the most recently active chat is first
    await expect(rows.first()).toContainText("ok");                    // preview of the reply
    await item(page, "alpha").getByTestId("ai-chat-row").click();
    await expect(page.getByTestId("ai-message-user").first()).toContainText(`${TAG} alpha`);
    await expect(page.getByTestId("ai-message-assistant").first()).toContainText(/ok/i);
    await expect(page.getByTestId("ai-save-state")).toHaveAttribute("data-state", "saved");
    await expect(item(page, "alpha").getByTestId("ai-chat-row")).toHaveAttribute("aria-current", "true");
  });

  authed("search narrows the list and explains when nothing matches", async ({ authenticatedPage: page }) => {
    await page.getByTestId("ai-search").fill(`${TAG} bravo`);
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(1);
    await expect(page.getByTestId("ai-chat-item")).toContainText("bravo");
    await page.getByTestId("ai-search").fill("zzz-no-such-chat");
    await expect(page.getByTestId("ai-chat-list-empty")).toContainText("No chats match");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.getByTestId("ai-search")).toHaveValue("");
  });

  authed("sorting by title orders the list alphabetically", async ({ authenticatedPage: page }) => {
    await page.getByRole("combobox", { name: "Sort chats" }).click();
    await page.getByRole("option", { name: "Title A–Z" }).click();
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(2);
    await expect(page.getByTestId("ai-chat-item").first()).toContainText("alpha");
    await expect(page.getByTestId("ai-chat-item").nth(1)).toContainText("bravo");
  });

  authed("rename keeps the new name after a reload", async ({ authenticatedPage: page }) => {
    const newName = `Renamed ${TAG}`;
    await item(page, "alpha").getByTestId("ai-chat-menu").click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByTestId("ai-rename-input").fill(newName);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ai-chat-item").filter({ hasText: newName })).toHaveCount(1);
    await page.reload();
    await page.waitForTimeout(2600);
    await openWide(page);
    await page.getByTestId("ai-search").fill(newName);
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(1);
    await expect(page.getByTestId("ai-chat-item")).toContainText(newName);
    // put it back so the other tests still find it by its first words
    await page.getByTestId("ai-chat-menu").click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByTestId("ai-rename-input").fill(`Reply with just the word ok. Reference ${TAG} alpha`);
    await page.keyboard.press("Enter");
  });

  authed("archive hides a chat, the Archived view lists it, and restore brings it back", async ({ authenticatedPage: page }) => {
    await item(page, "bravo").getByTestId("ai-chat-menu").click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(1);
    await page.getByTestId("ai-archived-toggle").click();
    await expect(page.getByTestId("ai-chat-item").filter({ hasText: "bravo" })).toHaveCount(1);
    await item(page, "bravo").getByTestId("ai-chat-menu").click();
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await page.getByTestId("ai-archived-toggle").click();
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(2);
  });

  authed("deleting asks first, then removes the chat for good", async ({ authenticatedPage: page }) => {
    const id = await makeChat(api, "charlie");
    await page.getByTestId("ai-search").fill(`${TAG} charlie`);
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(1, { timeout: 10000 });
    await page.getByTestId("ai-chat-menu").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("removed for good");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(1);       // cancelling keeps it
    await page.getByTestId("ai-chat-menu").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete chat" }).click();
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(0);
    await expect.poll(async () => (await api.get(`/api/ai/conversations/${id}`)).status()).toBe(404);
  });

  authed("switching chats keeps the draft you were typing", async ({ authenticatedPage: page }) => {
    await item(page, "alpha").getByTestId("ai-chat-row").click();
    await page.getByTestId("ai-input").fill("a half-written thought");
    await item(page, "bravo").getByTestId("ai-chat-row").click();
    await expect(page.getByTestId("ai-message-user").first()).toContainText(`${TAG} bravo`);
    await expect(page.getByTestId("ai-input")).toHaveValue("a half-written thought");
    await item(page, "alpha").getByTestId("ai-chat-row").click();
    await expect(page.getByTestId("ai-message-user").first()).toContainText(`${TAG} alpha`);
  });

  authed("offline: the last-seen chats stay visible with a notice", async ({ authenticatedPage: page, context }) => {
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toBeVisible();
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(2);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("status").filter({ hasText: "You are offline" })).toHaveCount(0);
  });

  authed("on a phone the menu opens over the chat and picking a chat closes it", async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByTestId("ai-search").waitFor({ state: "hidden" }).catch(() => {});
    if (!(await page.getByTestId("ai-menu").isVisible())) await page.getByTestId("ai-trigger").click();
    await page.getByTestId("ai-menu").click();
    await page.getByTestId("ai-search").fill(`${TAG} alpha`);
    await page.getByTestId("ai-chat-row").first().click();
    await expect(page.getByTestId("ai-menu-panel")).toHaveCount(0);
    await expect(page.getByTestId("ai-message-user").first()).toContainText(`${TAG} alpha`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});

