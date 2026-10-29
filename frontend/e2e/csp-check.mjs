// One-off manual check (not part of the suite): drives a production build served under the CSP and reports
// any policy violation or console error. Usage (after starting the build on :3100 and an API on :8001):
//   python ../backend/local_secrets.py run -- node e2e/csp-check.mjs
import { chromium } from "@playwright/test";

const base = process.env.CSP_BASE || "http://localhost:3100";
const api = process.env.CSP_API || "http://localhost:8001";
const email = process.env.TEST_EMAIL || "tiagosa743@gmail.com";
const password = process.env.TEST_PASSWORD;
if (!password) throw new Error("TEST_PASSWORD missing; run through local_secrets.py run");

const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`[console.${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(base + "/login");
await page.getByTestId("login-email").fill(email);
await page.getByTestId("login-password").fill(password);
await page.getByTestId("login-submit").click();
await page.waitForURL(base + "/", { timeout: 15000 });

for (const p of ["/", "/money", "/people", "/groceries", "/nutrition", "/fitness", "/body", "/tasks", "/calendar", "/settings"]) {
  await page.goto(base + p);
  await page.waitForLoadState("networkidle");
  const ok = await page.locator("body").innerText();
  console.log(p.padEnd(12), ok.includes("Life Record") ? "rendered" : "EMPTY?");
}
// open the assistant panel and a dialog, which exercise portals, inline styles and fonts
await page.goto(base + "/nutrition");
await page.getByRole("button", { name: "Add meal" }).first().click();
await page.waitForTimeout(500);

const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content);
console.log("CSP active:", !!csp, "| connect-src ->", /connect-src ([^;]*)/.exec(csp || "")?.[1]);
const violations = problems.filter((m) => /Content Security Policy|Refused to|violat/i.test(m));
console.log(`\nconsole/page problems: ${problems.length}, CSP violations: ${violations.length}`);
for (const m of problems) console.log("  " + m.slice(0, 260));
await browser.close();
process.exit(violations.length ? 1 : 0);
