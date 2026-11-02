import { test, expect } from "./fixtures";

// Signing out in the browser ends the session on the SERVER: a copy of the access token (as a script, a shared screen or a
// proxy log could have made) stops working at once, and a second tab of the same browser is signed out with it.
// Uses the shared worker session through the fixture; signing out kills it, so the fixture signs in again for the next test.

const API = process.env.API_URL || "http://localhost:8000";

test("signing out kills a copied access token and signs out the other tab", async ({ authenticatedPage: page, context, request }) => {
  // Capture the access token the page itself sends, the way anything watching the traffic could.
  let copied = null;
  page.on("request", (r) => {
    const auth = r.headers()["authorization"];
    if (auth && r.url().includes("/api/") && !copied) copied = auth;
  });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect.poll(() => copied, { timeout: 10000 }).toBeTruthy();

  const withCopy = () => request.get(`${API}/api/tasks`, { headers: { Authorization: copied } });
  expect((await withCopy()).status()).toBe(200);

  // A second tab in the same browser, signed in through the same cookie.
  const other = await context.newPage();
  await other.goto("/money");
  await expect(other.getByRole("heading", { name: "Money" })).toBeVisible();

  await page.goto("/settings");
  await page.getByTestId("settings-logout").click();
  await expect(page).toHaveURL(/\/login$/);

  expect((await withCopy()).status(), "the copied token must stop working the moment the user signs out").toBe(401);

  // The other tab's memory still holds an access token, but the server has ended the session: its next request fails, the
  // refresh fails too, and the app takes it to the login page.
  await other.goto("/tasks");
  await expect(other).toHaveURL(/\/login$/);
  await other.close();
});
