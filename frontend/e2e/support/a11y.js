import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Shared by every accessibility spec: axe-core with the WCAG 2.0/2.1/2.2 A and AA rule sets, plus a check that nothing
// scrolls sideways. A machine finds contrast, names, roles, labels and landmarks; it does not replace a screen-reader pass
// (roadmap D-05). Set A11Y_LIST=1 to print one line per offending element while fixing findings.

export const WIDTHS = [["desktop", { width: 1280, height: 800 }], ["tablet", { width: 820, height: 1180 }], ["phone", { width: 390, height: 844 }]];
export const THEMES = ["light", "dark"];
export const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function audit(page, label, { longList = false } = {}) {
  // A long list (the grocery catalog) always has cards straddling the bottom edge of the window, and some under the
  // fixed quick-add button or the dock; axe then reports their buttons as "partially obscured". For such
  // lists the window is made as tall as the document and those two controls (audited on every other page) are hidden.
  const original = page.viewportSize();
  if (longList) {
    await page.addStyleTag({ content: '[data-testid="quick-add-trigger"], [data-testid="dock"] { display: none !important; }' });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: original.width, height: Math.min(Math.max(height, original.height), 16000) });
    await page.waitForTimeout(300);
  }
  try {
    await auditNow(page, label);
  } finally {
    if (longList) await page.setViewportSize(original);
  }
}

async function auditNow(page, label) {
  // An entrance that is still fading (the assistant's staggered suggestion chips) is measured at a lower contrast than it ends at: wait for running animations first.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), null, { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(100);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const lines = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join("\n   ")}`);
  if (process.env.A11Y_LIST) {
    for (const v of results.violations) {
      for (const n of v.nodes) {
        console.log(`A11Y|${label}|${v.id}|${v.impact}|${n.target.join(" ")}|${(n.any[0] || n.all[0] || n.none[0] || {}).message || ""}|${n.html.slice(0, 110).replace(/\s+/g, " ")}`);
      }
    }
  }
  expect.soft(lines, `${label}: ${results.violations.length} accessibility violation(s)\n${lines.join("\n")}`).toEqual([]);
  const sideways = await page.evaluate(() => {
    const dlg = document.querySelector("[role=dialog]");
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, dialog: dlg ? dlg.scrollWidth - dlg.clientWidth : 0 };
  });
  expect.soft(sideways.page, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
  expect.soft(sideways.dialog, `${label}: the dialog scrolls sideways`).toBeLessThanOrEqual(1);
}

/** Theme and "no welcome splash" for the tab, set before any page script runs. */
export async function prepare(page, theme, viewport) {
  await page.addInitScript((t) => {
    try { localStorage.setItem("lm_theme", JSON.stringify(t)); sessionStorage.setItem("lm_intro", "1"); } catch { /* storage unavailable */ }
  }, theme);
  if (viewport) await page.setViewportSize(viewport);
}

/** Let data arrive and entrance motion finish before measuring contrast on a half-faded element. */
export async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
}
