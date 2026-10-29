import { test as base, expect, request } from "@playwright/test";

// Owner account used by the e2e suite. TEST_PASSWORD comes from the encrypted secrets store; run the suite with
//   python backend/local_secrets.py run -- npx playwright test
// Standard testing account: John (a39791@aesancho.pt), created by `python backend/seed_john.py`.
export const credentials = {
  email: process.env.TEST_EMAIL || "a39791@aesancho.pt",
  password: process.env.TEST_PASSWORD,
};
if (!credentials.password) {
  throw new Error("TEST_PASSWORD is not set. Run the e2e suite through `python backend/local_secrets.py run -- ...` or export it.");
}

// The suite creates and deletes data: it only runs against a local app.
for (const url of [process.env.API_URL || "http://localhost:8000", process.env.BASE_URL || "http://localhost:3000"]) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host) && process.env.ALLOW_REMOTE_TESTS !== "1") {
    throw new Error(`Refusing to run the e2e suite against ${url}: only a local app is accepted.`);
  }
}

let sessionPromise = null;
function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const anon = await request.newContext({ baseURL: process.env.API_URL || "http://localhost:8000" });
      const res = await anon.post("/api/auth/login", {
        data: credentials,
      });
      const body = await res.json();
      await anon.dispose();
      return { token: body.token, refresh_token: body.refresh_token };
    })();
  }
  return sessionPromise;
}

export const test = base.extend({
  // Log in once per worker through the API and reuse the session (UI logins are rate limited to 10/minute).
  authenticatedPage: async ({ page }, use) => {
    const session = await getSession();
    await page.addInitScript((s) => {
      // Seed once per tab, so signing out inside a test really signs out.
      if (sessionStorage.getItem("e2e_seeded")) return;
      sessionStorage.setItem("e2e_seeded", "1");
      localStorage.setItem("lm_token", s.token);
      if (s.refresh_token) localStorage.setItem("lm_refresh_token", s.refresh_token);
    }, session);
    await page.goto("/");
    await page.waitForURL("/", { timeout: 15000 });
    await use(page);
  },

  // API client for setup and cleanup. It reuses the worker's session so tests do not spend the login rate limit.
  apiContext: async ({}, use) => {
    const session = await getSession();
    const ctx = await request.newContext({
      baseURL: process.env.API_URL || "http://localhost:8000",
      extraHTTPHeaders: { Authorization: `Bearer ${session.token}` },
    });
    await use(ctx);
    await ctx.dispose();
  },
});

export { expect };
