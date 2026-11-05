import { test, expect } from "./fixtures";
import { prepare, settle } from "./support/a11y";

// The Purple Main Theme (docs/design-system/PURPLE_MAIN_THEME.md): the values the specification tabulates (§B.2, §B.3, §B.5, §B.6), the script that
// applies the saved choice before the first paint, and the two behaviours that are not visible in CSS (the pointer light, the ask bar).

const GLOBAL = {
  light: {
    "--background": "290 26% 96%", "--foreground": "285 30% 11%", "--primary": "280 21% 40%", "--ring": "280 32% 46%", "--border": "285 16% 86%",
    "--muted-foreground": "285 12% 38%", "--accent-ink": "#6c4d7d", "--cta": "linear-gradient(180deg, #876096, #6b4f7b)",
    "--pill": "linear-gradient(135deg, #87699b, #5a4566)", "--line": "rgba(70, 35, 90, 0.14)", "--chart-line": "#7a5a8a", "--scrim": "rgba(40, 20, 55, 0.48)",
  },
  dark: {
    "--background": "285 12% 5%", "--foreground": "300 28% 95%", "--primary": "280 21% 44%", "--ring": "297 48% 76%", "--border": "290 9% 20%",
    "--muted-foreground": "292 10% 70%", "--accent-ink": "#dcb0e5", "--cta": "linear-gradient(180deg, #ecc9f2, #c795d3)",
    "--pill": "linear-gradient(135deg, #87699b, #4f3b5a)", "--line": "rgba(255, 232, 255, 0.12)", "--chart-line": "#dcb0e5", "--scrim": "rgba(7, 5, 10, 0.7)",
  },
};
const MONEY = {
  light: { "--mny-bg": "#f5eff7", "--mny-text": "#231a28", "--mny-green": "#0b7a52", "--mny-neg": "#b4232f", "--mny-amber": "#8f4208", "--mx-orchid": "#6c4d7d" },
  dark: { "--mny-bg": "#0c0a0e", "--mny-text": "#f6f0f7", "--mny-green": "#62e4a4", "--mny-neg": "#ff9fac", "--mny-amber": "#f6c46e", "--mx-orchid": "#dcb0e5" },
};

const read = (page, selector, names) => page.evaluate(([sel, list]) => {
  const el = document.querySelector(sel);
  const cs = getComputedStyle(el);
  return Object.fromEntries(list.map((n) => [n, cs.getPropertyValue(n).trim()]));
}, [selector, names]);

for (const theme of ["light", "dark"]) {
  test(`${theme}: the tokens are the ones the specification lists`, async ({ authenticatedPage: page }) => {
    await prepare(page, theme, { width: 1280, height: 800 });
    await page.goto("/money");
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark");
    expect(await read(page, "html", Object.keys(GLOBAL[theme]))).toEqual(GLOBAL[theme]);
    expect(await read(page, ".mny-theme", Object.keys(MONEY[theme]))).toEqual(MONEY[theme]);
    // the product face is Plus Jakarta Sans, and figures are tabular, not monospace
    const faces = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, fig: getComputedStyle(document.querySelector("[data-testid=money-total]")).fontVariantNumeric }));
    expect(faces.body).toMatch(/^"?Plus Jakarta Sans/);
    expect(faces.fig).toContain("tabular-nums");
    // controls are pills; a Money card is 28px and its stage 32px
    const radii = await page.evaluate(() => ({
      pill: getComputedStyle(document.querySelector(".mny-pill")).borderRadius,
      card: getComputedStyle(document.querySelector(".mny-card")).borderRadius,
      stage: getComputedStyle(document.querySelector(".mny-stage")).borderRadius,
    }));
    expect(radii).toEqual({ pill: "9999px", card: "28px", stage: "32px" });
  });
}

test("the saved theme is applied by the script in <head>, before the app has loaded", async ({ browser }) => {
  for (const [saved, dark] of [["light", false], ["dark", true]]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript((t) => { try { localStorage.setItem("lm_theme", JSON.stringify(t)); } catch { /* none */ } }, saved);
    await page.route("**/static/js/**", (route) => route.abort());          // no application code at all: only theme-init.js can have set the class
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), `saved ${saved}`).toBe(dark);
    await context.close();
  }
});

test("the document is the fallback dark one and loads the script before the page body", async ({ request, baseURL }) => {
  const html = await (await request.get(`${baseURL}/`)).text();
  expect(html).toMatch(/<html lang="en" class="dark">/);
  expect(html).toContain('<meta name="theme-color" content="#0c0a0e"');
  expect(html.indexOf("theme-init.js")).toBeGreaterThan(-1);
  expect(html.indexOf("theme-init.js")).toBeLessThan(html.indexOf('id="root"'));
});

test("the light on a Money card follows the mouse, and only the mouse", async ({ authenticatedPage: page }) => {
  await prepare(page, "dark", { width: 1280, height: 800 });
  await page.goto("/money");
  await settle(page);
  const card = page.locator(".mny-card").first();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.move(box.x + 120, box.y + 80);
  const at = await card.evaluate((el) => [el.style.getPropertyValue("--mx"), el.style.getPropertyValue("--my")]);
  expect(at[0]).toMatch(/^\d+(\.\d+)?px$/);
  expect(Math.round(parseFloat(at[0]))).toBe(120);
  expect(Math.round(parseFloat(at[1]))).toBe(80);
  // a touch does not move it
  await card.evaluate((el) => { el.style.setProperty("--mx", "7px"); });
  await card.dispatchEvent("pointermove", { pointerType: "touch", clientX: box.x + 300, clientY: box.y + 50, bubbles: true });
  expect(await card.evaluate((el) => el.style.getPropertyValue("--mx"))).toBe("7px");
});

test("Money: the ask bar opens the assistant", async ({ authenticatedPage: page }) => {
  await prepare(page, "light", { width: 1280, height: 800 });
  await page.goto("/money");
  await settle(page);
  await page.getByTestId("money-ask-ai").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
});
