import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

const RED_PNG = Buffer.from(fs.readFileSync(path.join(__dirname, "red.b64"), "utf8"), "base64");

async function openWide(page) {
  await page.waitForTimeout(2600); // welcome splash
  await page.getByTestId("ai-fab").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  if ((await page.getByTestId("ai-panel").getAttribute("data-wide")) !== "true") await page.getByTestId("ai-wide").click();
}

test.describe("Images in saved chats (real assistant)", () => {
  test.afterEach(async ({ apiContext }) => {
    for (const q of ["IMGCHAT", "image check"]) {
      const chats = await (await apiContext.get(`/api/ai/conversations?q=${encodeURIComponent(q)}`)).json();
      for (const c of chats) await apiContext.delete(`/api/ai/conversations/${c.id}`);
    }
  });

  test("a picture is kept with the chat, shown again after a reload, and removed when the chat is deleted", async ({ authenticatedPage: page, apiContext }) => {
    test.setTimeout(180000);
    const tag = `IMGCHAT${Date.now().toString(36)}`;
    await openWide(page);
    await page.getByTestId("ai-file-input").setInputFiles({ name: "red.png", mimeType: "image/png", buffer: RED_PNG });
    await expect(page.getByAltText("Attached preview")).toBeVisible();
    await page.getByTestId("ai-input").fill(`${tag}: what is the main colour of this image? Answer with one word.`);
    await page.keyboard.press("Enter");
    const reply = page.getByTestId("ai-message-assistant").last();
    await expect(reply).toHaveAttribute("data-status", "done", { timeout: 90000 });
    await expect(reply).toContainText(/red/i);                                      // the model really saw the picture
    await expect(page.getByTestId("ai-message-user").first().getByTestId("ai-image")).toBeVisible();

    // it was stored on the server with the message
    const [chat] = await (await apiContext.get(`/api/ai/conversations?q=${tag}`)).json();
    expect(chat).toBeTruthy();
    const opened = await (await apiContext.get(`/api/ai/conversations/${chat.id}`)).json();
    const first = opened.messages[0];
    expect(first.meta.image.mime).toBe("image/png");
    const raw = await apiContext.get(`/api/ai/conversations/${chat.id}/images/${first.id}`);
    expect(raw.ok()).toBeTruthy();
    expect((await raw.body()).equals(RED_PNG)).toBe(true);

    // a reload and reopening the chat from the list shows the stored picture
    await page.reload();
    await openWide(page);
    await page.getByTestId("ai-search").fill(tag);
    await expect(page.getByTestId("ai-chat-item")).toHaveCount(1);
    await page.getByTestId("ai-chat-row").click();
    const img = page.getByTestId("ai-message-user").first().getByTestId("ai-image");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBe(48);

    // deleting the chat deletes the picture
    await page.getByTestId("ai-chat-menu").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete chat" }).click();
    await expect.poll(async () => (await apiContext.get(`/api/ai/conversations/${chat.id}/images/${first.id}`)).status()).toBe(404);
  });

  test("a file that is not an image is refused with a clear message and nothing is saved", async ({ authenticatedPage: page, apiContext }) => {
    const tag = `IMGCHAT${Date.now().toString(36)}x`;
    await openWide(page);
    await page.getByTestId("ai-file-input").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("just some text, not a picture") });
    await page.getByTestId("ai-input").fill(`${tag} image check`);
    await page.keyboard.press("Enter");   // pressed at once on purpose: the send waits for the file instead of dropping it
    await expect(page.getByTestId("ai-error")).toContainText("not a supported image");
    const found = await (await apiContext.get(`/api/ai/conversations?q=${tag}`)).json();
    expect(found).toHaveLength(0);
  });
});
