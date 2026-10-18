import { test as base, expect, request } from "@playwright/test";

export const test = base.extend({
  authenticatedPage: async ({ page }, use) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(process.env.TEST_EMAIL || "tiagosa743@gmail.com");
    await page.getByTestId("login-password").fill(process.env.TEST_PASSWORD || "LifeRecord");
    await page.getByTestId("login-submit").click();
    await page.waitForURL("/", { timeout: 15000 });
    await use(page);
  },

  apiContext: async ({}, use) => {
    const anon = await request.newContext({
      baseURL: process.env.API_URL || "http://localhost:8000",
    });
    const res = await anon.post("/api/auth/login", {
      data: {
        email: process.env.TEST_EMAIL || "tiagosa743@gmail.com",
        password: process.env.TEST_PASSWORD || "LifeRecord",
      },
    });
    const body = await res.json();
    await anon.dispose();

    const ctx = await request.newContext({
      baseURL: process.env.API_URL || "http://localhost:8000",
      extraHTTPHeaders: { Authorization: `Bearer ${body.token}` },
    });
    await use(ctx);
    await ctx.dispose();
  },
});

export { expect };
