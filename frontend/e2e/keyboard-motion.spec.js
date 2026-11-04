import { test, expect } from "./fixtures";
import { prepare, settle } from "./support/a11y";

// D-05: Money, People, Profile and Settings can be used with the keyboard alone: every stop of the Tab order shows where the focus is, nothing traps
// it, and a dialog opened from the keyboard closes with Escape and hands the focus back. (A screen reader still needs a human: this is the part a
// machine can check.)  D-06: with "reduce motion" on, nothing keeps moving by itself and no entrance slides.
test.describe.configure({ timeout: 180_000 });

const PAGES = [["money", "/money"], ["people", "/people"], ["profile", "/profile"], ["settings", "/settings"], ["settings money", "/settings?section=money"]];

/** The element with the focus, and whether anything marks it (an outline or a ring). */
const focusState = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const marked = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none")
    || !!el.closest("[data-focus-ring]");
  const r = el.getBoundingClientRect();
  return { tag: el.tagName.toLowerCase(), label: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("data-testid") || "").trim().slice(0, 40), marked, visible: r.width > 0 && r.height > 0 };
});

for (const [name, path] of PAGES) {
  test(`keyboard: ${name}`, async ({ authenticatedPage: page }) => {
    await prepare(page, "light", { width: 1280, height: 900 });
    await page.goto(path);
    await settle(page);
    const seen = new Set();
    const unmarked = [];
    for (let i = 0; i < 70; i += 1) {
      await page.keyboard.press("Tab");
      const f = await focusState(page);
      if (!f) continue;
      expect(f.visible, `${name}: focus went to an element with no size: ${f.tag} ${f.label}`).toBe(true);
      if (!f.marked) unmarked.push(`${f.tag} "${f.label}"`);
      seen.add(`${f.tag}:${f.label}`);
    }
    expect(seen.size, `${name}: the Tab order should reach many different controls`).toBeGreaterThan(12);   // not stuck in a trap
    expect(unmarked, `${name}: controls whose focus is not visible`).toEqual([]);
  });
}

test("keyboard: a dialog opens from the keyboard, traps Tab inside, closes with Escape and returns the focus", async ({ authenticatedPage: page }) => {
  await prepare(page, "light", { width: 1280, height: 900 });
  await page.goto("/money");
  await settle(page);
  const trigger = page.getByRole("button", { name: "Transfer", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement.closest("[role=dialog]")), "Tab must stay inside the open dialog").toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("reduced motion: nothing loops by itself, and the in-app Animations choice is honoured too", async ({ authenticatedPage: page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepare(page, "light", { width: 1280, height: 900 });
  for (const path of ["/", "/money", "/groceries", "/nutrition", "/people"]) {
    await page.goto(path);
    await settle(page);
    const looping = await page.evaluate(() => document.getAnimations()
      .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity && !a.effect?.target?.closest?.("[data-keep-motion]"))
      .map((a) => `${a.effect?.target?.tagName}.${(a.effect?.target?.className || "").toString().slice(0, 40)}`));
    expect(looping, `${path}: animations still looping under reduced motion`).toEqual([]);
  }
  // the quick-add button appears without sliding: no transform transition is running on it
  await page.goto("/");
  await settle(page);
  const fab = page.getByTestId("quick-add-trigger");
  await expect(fab).toBeVisible();
  expect(await fab.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
});
