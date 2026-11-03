import { test as base, expect, request } from "@playwright/test";
import { newEmail, verificationCode, deleteUser } from "./support-new-user";

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

const API_URL = process.env.API_URL || "http://localhost:8000";

async function login() {
  const anon = await request.newContext({ baseURL: API_URL });
  const res = await anon.post("/api/auth/login", { data: credentials });
  const body = await res.json();
  await anon.dispose();
  return { token: body.token, refresh_token: body.refresh_token };
}

// One sign-in per worker is reused (UI logins are rate limited to 10/minute); its refresh token moves on with every refresh. Signing out now really ends the session on
// the server, so a test that signs out leaves the shared session dead: the next test notices and signs in again.
let sessionPromise = null;
async function getSession() {
  if (sessionPromise) {
    const session = await sessionPromise;
    const probe = await request.newContext({ baseURL: API_URL, extraHTTPHeaders: { Authorization: `Bearer ${session.token}` } });
    const alive = (await probe.get("/api/auth/me")).ok();
    await probe.dispose();
    if (alive) return session;
  }
  sessionPromise = login();
  return sessionPromise;
}

export const test = base.extend({
  // The page starts signed in the way a returning visitor is: the HttpOnly refresh cookie is in the browser, and the page
  // gets its (in-memory) access token from it at boot. Nothing is written to web storage.
  authenticatedPage: async ({ page, context }, use) => {
    const session = await getSession();
    // The side menu hides until the pointer reaches the left edge; the suite clicks its links directly, so it keeps it open.
    // The owner account is shared by every worker: its look must not follow the account, or one test's theme would reach another's page.
    await context.addInitScript(() => { try { localStorage.setItem("lr-sidebar", "pinned"); localStorage.setItem("lm_sync", "false"); } catch { /* none */ } });
    await context.addCookies([{ name: "lr_refresh", value: session.refresh_token, domain: new URL(API_URL).hostname,
                                path: "/api/auth", httpOnly: true, secure: false, sameSite: "Lax" }]);
    await page.goto("/");
    await page.waitForURL("/", { timeout: 15000 });
    await use(page);
    // Every refresh replaces the refresh token (each is used once), so the browser now holds a newer one than the one it started
    // with. A real browser keeps its cookie up to date by itself; hand the newest back to the shared session, or the next test
    // would start from a token that has already been replaced, which the server rightly takes for a stolen copy.
    const current = (await context.cookies()).find((c) => c.name === "lr_refresh");
    if (current) session.refresh_token = current.value;
  },

  // A brand-new verified account of its own (for tests that change settings the account keeps), signed in the way a returning visitor is.
  // `fresh.email` is updated by a test that changes the address; the account is removed afterwards.
  freshUserPage: async ({ page, context }, use) => {
    const fresh = { email: newEmail(), password: "TestPass123", name: "Fresh Tester" };
    const anon = await request.newContext({ baseURL: API_URL });
    const made = await anon.post("/api/auth/register", { data: { email: fresh.email, password: fresh.password, name: fresh.name } });
    if (!made.ok()) throw new Error(`could not create the test account: ${made.status()}`);
    const verified = await anon.post("/api/auth/verify", { data: { email: fresh.email, code: verificationCode(fresh.email), password: fresh.password } });
    if (!verified.ok()) throw new Error(`could not verify the test account: ${verified.status()}`);
    const login = await (await anon.post("/api/auth/login", { data: { email: fresh.email, password: fresh.password } })).json();
    await anon.dispose();
    fresh.token = login.token;
    fresh.api = await request.newContext({ baseURL: API_URL, extraHTTPHeaders: { Authorization: `Bearer ${login.token}` } });
    await context.addInitScript(() => { try { localStorage.setItem("lr-sidebar", "pinned"); sessionStorage.setItem("lm_intro", "1"); } catch { /* none */ } });
    await context.addCookies([{ name: "lr_refresh", value: login.refresh_token, domain: new URL(API_URL).hostname, path: "/api/auth", httpOnly: true, secure: false, sameSite: "Lax" }]);
    await page.goto("/");
    await page.waitForURL("/", { timeout: 15000 });
    await use({ page, fresh });
    await fresh.api.dispose();
    deleteUser(fresh.email);
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
