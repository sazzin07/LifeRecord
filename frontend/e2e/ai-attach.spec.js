import { test, expect } from "./fixtures";

// Choosing a file and pressing Enter at once must send the message WITH the file. This spec never reaches the live model:
// a request that arrives without the image is blocked here, and one that carries the (invalid) image is refused by the
// server before any model call, which is what the page then shows.
async function openPanel(page) {
  await page.waitForTimeout(2600); // welcome splash
  await page.getByTestId("ai-fab").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
}

test.describe("Assistant attachments", () => {
  test("Enter pressed right after choosing a file still sends the file", async ({ authenticatedPage: page }) => {
    const bodies = [];
    await page.route("**/api/ai/chat**", async (route) => {
      const body = route.request().postDataJSON() || {};
      bodies.push(body);
      if (!body.image_base64) { await route.fulfill({ status: 400, json: { detail: "blocked by the test: no image was sent" } }); return; }
      await route.continue();
    });
    await openPanel(page);
    await page.getByTestId("ai-file-input").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("just some text, not a picture") });
    await page.getByTestId("ai-input").fill("attach race check");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ai-error")).toContainText("not a supported image", { timeout: 15000 });
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every((b) => typeof b.image_base64 === "string" && b.image_base64.startsWith("data:image/png;base64,"))).toBe(true);
  });

  test("a file that cannot be read says so, keeps your text, and nothing is sent", async ({ authenticatedPage: page }) => {
    let sent = 0;
    await page.route("**/api/ai/chat**", async (route) => { sent += 1; await route.fulfill({ status: 400, json: { detail: "blocked by the test" } }); });
    await page.evaluate(() => { // a file the browser fails to read (the page is already loaded, so patch it in place)
      FileReader.prototype.readAsDataURL = function failing() { setTimeout(() => this.onerror && this.onerror(new Event("error")), 1500); };   // slow, so Enter is pressed while it is still reading
    });
    await openPanel(page);
    await page.getByTestId("ai-file-input").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") });
    await page.getByTestId("ai-input").fill("unreadable file check");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ai-image-loading")).toBeVisible();   // Enter was pressed during this: the send is waiting, not dropped
    await expect(page.getByText("Could not read that file")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("ai-image-loading")).toHaveCount(0);
    await expect(page.getByTestId("ai-input")).toHaveValue("unreadable file check"); // the draft is kept
    expect(sent).toBe(0);
  });
});
