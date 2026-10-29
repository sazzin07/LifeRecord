import { test as base, expect, request } from "@playwright/test";

// Owner account used by the e2e suite; override with TEST_EMAIL / TEST_PASSWORD.
export const credentials = {
  email: process.env.TEST_EMAIL || "tiagosa743@gmail.com",
  password: process.env.TEST_PASSWORD || "LifeRecord",
};

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
