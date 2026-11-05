import { test, expect } from "./fixtures";
import { goToPage, openAccountMenu, GROUP_OF } from "./support/dock";

// Navigation (docs/superpowers/specs/2026-11-05-floating-dock-design.md): a floating dock from 640px up; on a phone a ball in the middle (assistant and quick
// actions) and a side menu of pages. Every page is reachable on every size, the current page is announced, it works from the keyboard, and nothing is covered.
const PATH = { home: "/", money: "/money", people: "/people", groceries: "/groceries", nutrition: "/nutrition", fitness: "/fitness", body: "/body",
  tasks: "/tasks", calendar: "/calendar", settings: "/settings" };
const NAMES = Object.keys(PATH);
const tileW = (loc) => loc.evaluate((e) => e.firstElementChild.getBoundingClientRect().width);
const url = (name) => new RegExp(`${PATH[name] === "/" ? "/$" : PATH[name] + "$"}`);

for (const [size, viewport] of [["desktop", { width: 1440, height: 900 }], ["tablet", { width: 820, height: 1180 }]]) {
  test.describe(`dock, ${size}`, () => {
    test.use({ viewport });
    test.beforeEach(async ({ authenticatedPage: page }) => { await page.addInitScript(() => sessionStorage.setItem("lm_intro", "1")); });

    for (const name of NAMES) {
      test(`${name} is reachable, and is announced as the current page`, async ({ authenticatedPage: page }) => {
        await page.goto(name === "home" ? "/tasks" : "/");
        await goToPage(page, name);
        await expect(page).toHaveURL(url(name));
        const group = GROUP_OF[name];
        if (group) await expect(page.getByTestId(`dock-${group}`)).toHaveAttribute("aria-current", "page");
        else await expect(page.getByTestId(`nav-${name}`)).toHaveAttribute("aria-current", "page");
      });
    }

    test("the dock fits the screen, its tiles are big enough to touch, and nothing scrolls sideways", async ({ authenticatedPage: page }) => {
      await page.goto("/money");
      await expect(page.locator("[data-dock-tile]")).toHaveCount(6);
      await page.locator("[data-dock-tile]").first().hover();     // it rests small and grows when the pointer reaches it
      await expect(page.getByTestId("dock")).toHaveAttribute("data-grown", "true");
      await page.waitForTimeout(900);
      const tiles = await page.locator('[data-testid="dock"] [data-dock-tile]').evaluateAll((els) => els.map((e) => { const r = e.firstElementChild.getBoundingClientRect(); return { x: r.x, right: r.right, w: r.width }; }));
      for (const t of tiles) { expect(t.w).toBeGreaterThanOrEqual(44); expect(t.x).toBeGreaterThanOrEqual(0); expect(t.right).toBeLessThanOrEqual(viewport.width); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("dock behaviour", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.beforeEach(async ({ authenticatedPage: page }) => { await page.addInitScript(() => sessionStorage.setItem("lm_intro", "1")); });

  test("from the keyboard: Enter opens a group onto its first page, arrows move, Escape folds it and returns", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    const tile = page.getByTestId("dock-money");
    await page.keyboard.press("Shift");
    await tile.focus();
    await page.keyboard.press("Enter");
    await expect(tile).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("nav-money")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("nav-people")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tile).toHaveAttribute("aria-expanded", "false");
    await expect(tile).toBeFocused();
    await page.keyboard.press("ArrowRight");                                 // along the dock
    await expect(page.getByTestId("dock-food")).toBeFocused();
  });

  test("a group unfolds on hover and folds when the mouse leaves", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.getByTestId("dock-food").hover();
    await expect(page.getByTestId("nav-groceries")).toBeVisible();
    await expect(page.getByTestId("nav-nutrition")).toBeVisible();
    await page.mouse.move(640, 200);
    await expect(page.getByTestId("nav-groceries")).toBeHidden();
  });

  test("it steps aside while the page scrolls down and is back when the scrolling stops", async ({ authenticatedPage: page }) => {
    await page.goto("/money");
    await page.waitForLoadState("networkidle");
    const dock = page.getByTestId("dock");
    await expect(dock).toHaveAttribute("data-hidden", "false");
    for (let i = 0; i < 8; i += 1) { await page.mouse.wheel(0, 140); await page.waitForTimeout(30); }
    await expect(dock).toHaveAttribute("data-hidden", "true");
    await expect(dock).toHaveAttribute("data-hidden", "false", { timeout: 3000 });   // scrolling stopped
    for (let i = 0; i < 8; i += 1) { await page.mouse.wheel(0, 140); await page.waitForTimeout(30); }
    for (let i = 0; i < 3; i += 1) { await page.mouse.wheel(0, -200); await page.waitForTimeout(30); }
    await expect(dock).toHaveAttribute("data-hidden", "false");                       // a scroll up brings it back at once
  });

  test("the account menu holds the profile and Sign out", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await openAccountMenu(page);
    await expect(page.getByTestId("logout-btn")).toBeVisible();
    await page.getByTestId("header-profile").click();
    await expect(page).toHaveURL(/\/profile$/);
  });

  test("it rests small, grows when the pointer is near, stays centred, and stays grown while you click through pages", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1200);
    const home = page.getByTestId("nav-home");
    const centre = async () => page.locator("[data-dock-tile]").evaluateAll((els) => { const c = (i) => { const r = els[i].firstElementChild.getBoundingClientRect(); return r.left + r.width / 2; }; return (c(2) + c(3)) / 2; });   // the middle of two tiles that never lean when Home is hovered
    const rest = await tileW(home);
    await home.hover();
    await expect(page.getByTestId("dock")).toHaveAttribute("data-grown", "true");
    await expect.poll(() => tileW(home), { timeout: 3000 }).toBeGreaterThan(rest * 1.25);
    const grownCentre = await centre();
    await page.mouse.move(640, 200);
    await expect(page.getByTestId("dock")).toHaveAttribute("data-grown", "false");
    await expect.poll(() => tileW(home), { timeout: 3000 }).toBeLessThan(rest * 1.05);
    expect(Math.abs((await centre()) - grownCentre)).toBeLessThan(1);                // nothing slid sideways
    // choosing a page keeps the dock grown (people browse by clicking through): only the fan folds, until the pointer moves to another tile
    await page.getByTestId("dock-money").hover();
    await page.getByTestId("nav-people").click();
    await expect(page).toHaveURL(/\/people$/);
    await expect(page.getByTestId("dock")).toHaveAttribute("data-grown", "true");
    await expect(page.locator("[data-dock-fan]")).toHaveCount(0);
    await page.getByTestId("dock-food").hover();
    await expect(page.getByTestId("nav-groceries")).toBeVisible();
  });

  test("at the far ends of the dock it stays centred and keeps its proportions", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1200);
    const gaps = async () => page.locator("[data-dock-tile]").evaluateAll((els) => { const r = els.map((e) => e.firstElementChild.getBoundingClientRect()); const mid = (r[2].left + r[2].width / 2 + r[3].left + r[3].width / 2) / 2; return { mid, ratio: (r[4].left - r[3].right) / r[3].width }; });   // two tiles away from the hovered one: no lean
    for (const id of ["nav-home", "nav-settings"]) {
      await page.getByTestId(id).hover(); await page.waitForTimeout(1500);
      const g = await gaps();
      expect(Math.abs(g.mid - 640)).toBeLessThan(2);                  // the middle of a 1280px screen, whichever end the pointer is at
    }
    await page.getByTestId("nav-home").hover(); await page.waitForTimeout(1500);
    const grown = await gaps();
    await page.mouse.move(640, 200); await page.waitForTimeout(1500);
    const rest = await gaps();
    expect(Math.abs(grown.ratio - rest.ratio)).toBeLessThan(0.02);   // the gaps stay in proportion to the tiles at both sizes
  });

  test("the tile under the pointer lifts, its two neighbours lean a little, and no other tile moves", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1300);                                  // the entrance has finished
    const sizes = async () => page.locator("[data-dock-tile]").evaluateAll((els) => els.map((e) => e.firstElementChild.getBoundingClientRect().width));   // the drawn tile
    const box = await page.getByTestId("dock-body").boundingBox();     // the fourth tile
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId("dock")).toHaveAttribute("data-grown", "true");
    await page.waitForTimeout(1000);
    const now = await sizes();
    const base = now[0];                                              // Home is far from the pointer
    expect(now[3]).toBeGreaterThan(base * 1.1);                       // the tile under the pointer lifts and grows
    for (const i of [2, 4]) { expect(now[i]).toBeGreaterThan(base * 1.02); expect(now[i]).toBeLessThan(base * 1.1); }   // a gentle lean, no swell
    for (const i of [0, 1, 5]) expect(Math.abs(now[i] - base)).toBeLessThan(0.6);                                          // nothing else changes
  });

  test("moving fast across the dock, in and out, never leaves anything open, lifted or grown", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1300);
    const slots = await page.locator("[data-dock-tile]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
    // sweep left and right, jump between far tiles, dive in and out of the zone, with no pauses
    for (let round = 0; round < 4; round += 1) {
      for (const [x, y] of slots) await page.mouse.move(x, y, { steps: 2 });
      for (const [x, y] of [...slots].reverse()) await page.mouse.move(x, y, { steps: 1 });
      await page.mouse.move(slots[0][0], slots[0][1]); await page.mouse.move(slots[5][0], slots[5][1]);
      await page.mouse.move(slots[1][0], 300); await page.mouse.move(slots[1][0], slots[1][1]); await page.mouse.move(slots[4][0], 300);
    }
    await page.mouse.move(640, 150);                                                   // finally leave
    await expect(page.getByTestId("dock")).toHaveAttribute("data-grown", "false");
    await expect(page.locator("[data-dock-fan]")).toHaveCount(0);
    await page.waitForTimeout(1200);
    const sizes = await page.locator("[data-dock-tile]").evaluateAll((els) => els.map((e) => Math.round(e.firstElementChild.getBoundingClientRect().width * 10) / 10));
    expect(new Set(sizes).size).toBe(1);                                               // every tile is the same small size
  });

  test("pressing different tiles in quick succession ends in a clean state on the last one", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForTimeout(1300);
    const box = async (id) => page.getByTestId(id).boundingBox();
    for (const id of ["dock-food", "dock-body", "dock-plan", "dock-money", "dock-food"]) { const b = await box(id); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
    await expect(page.locator("[data-dock-fan]")).toHaveCount(1);                      // only the last group is open
    await expect(page.getByTestId("nav-groceries")).toBeVisible();
    await page.mouse.click(640, 200);                                                  // a click elsewhere closes it
    await expect(page.locator("[data-dock-fan]")).toHaveCount(0);
  });

  test("with reduced motion the dock grows at once and the tiles do not swell", async ({ authenticatedPage: page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const home = page.getByTestId("nav-home");
    await page.waitForTimeout(300);
    await home.hover();
    await page.waitForTimeout(80);
    const first = await tileW(home);
    await page.waitForTimeout(600);
    expect(Math.round(await tileW(home))).toBe(Math.round(first));
  });
});

test.describe("phone: side menu and ball", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(async ({ authenticatedPage: page }) => { await page.addInitScript(() => sessionStorage.setItem("lm_intro", "1")); });

  for (const name of NAMES) {
    test(`${name} is reachable from the side menu, which shows where you are`, async ({ authenticatedPage: page }) => {
      await page.goto(name === "home" ? "/tasks" : "/");
      await goToPage(page, name);
      await expect(page).toHaveURL(url(name));
      await expect(page.getByTestId("side-menu")).toBeHidden();                        // choosing a page folds it away
      await page.getByTestId("menu-toggle").click();
      await expect(page.getByTestId(`nav-${name}`)).toHaveAttribute("aria-current", "page");
    });
  }

  test("there is no dock; the side menu works from the keyboard and gives the focus back", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await expect(page.getByTestId("dock")).toHaveCount(0);
    const toggle = page.getByTestId("menu-toggle");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("side-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("side-menu")).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test("the ball sits in the middle, is big enough to touch, and a tap opens its six options", async ({ authenticatedPage: page }) => {
    await page.goto("/money");
    const ball = page.getByTestId("ball");
    const box = await ball.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(2);                   // the middle of a 390px screen
    await ball.click();
    for (const k of ["assistant", "expense", "meal", "task", "weight", "more"]) await expect(page.getByTestId(`ball-${k}`)).toBeVisible();
    await page.waitForTimeout(600);
    for (const k of ["assistant", "expense", "meal", "task", "weight", "more"]) {
      const o = await page.getByTestId(`ball-${k}`).boundingBox();
      expect(o.x).toBeGreaterThanOrEqual(0); expect(o.x + o.width).toBeLessThanOrEqual(390);
    }
    await ball.click();                                                               // a tap on the open ball folds it
    await expect(page.getByTestId("ball-assistant")).toBeHidden();
  });

  test("tap the ball, then tap the assistant", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.getByTestId("ball").click();
    await page.getByTestId("ball-assistant").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
  });

  test("press the ball, drag to an option (it grows and changes), lift to choose it", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const ball = await page.getByTestId("ball").boundingBox();
    await page.mouse.move(ball.x + ball.width / 2, ball.y + ball.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId("ball-expense")).toBeVisible();
    await page.waitForTimeout(600);                                                    // the options have fanned out
    const o = await page.getByTestId("ball-expense").boundingBox();
    const idle = o.width;
    await page.mouse.move(ball.x + ball.width / 2, ball.y - 20, { steps: 4 });
    await page.mouse.move(o.x + o.width / 2, o.y + o.height / 2, { steps: 8 });       // the finger reaches the option
    await expect.poll(async () => (await page.getByTestId("ball-expense").boundingBox()).width, { timeout: 2000 }).toBeGreaterThan(idle * 1.2);
    await page.mouse.up();                                                             // lifting chooses it
    await expect(page.getByTestId("expense-dialog")).toBeVisible();
    await expect(page.getByTestId("ball-expense")).toBeHidden();
  });

  test("lifting the finger away from every option closes the menu without choosing", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const ball = await page.getByTestId("ball").boundingBox();
    await page.mouse.move(ball.x + ball.width / 2, ball.y + ball.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(40, 200, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId("ball-expense")).toBeHidden();
    await expect(page.getByTestId("expense-dialog")).toHaveCount(0);
  });

  test("More opens the quick-add dialog, and Task goes straight to the task form", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.getByTestId("ball").click();
    await page.getByTestId("ball-more").click();
    await expect(page.getByTestId("quick-add-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("ball").click();
    await page.getByTestId("ball-task").click();
    await expect(page.getByTestId("task-title")).toBeVisible();
  });

  test("tapping the ball many times, fast, always ends in a clean state", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const b = await page.getByTestId("ball").boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    for (let i = 0; i < 9; i += 1) await page.mouse.click(x, y);                      // an odd number of taps: open
    await expect(page.getByTestId("ball")).toHaveAttribute("aria-expanded", "true");
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 40, y - 40, { steps: 3 }); await page.mouse.move(x + 20, y - 260, { steps: 3 }); await page.mouse.up();   // a drag that lands nowhere
    await expect(page.getByTestId("ball")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("ball-expense")).toBeHidden();
    await page.getByTestId("ball").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ball-expense")).toBeHidden();
  });

  test("the page has room under its last row, above the ball", async ({ authenticatedPage: page }) => {
    await page.goto("/money");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(700);
    const pad = await page.locator("main .lm-page").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    const ball = await page.getByTestId("ball").boundingBox();
    expect(pad).toBeGreaterThanOrEqual(844 - ball.y);                                  // the space under the last row is at least as tall as the ball and its margin
  });
});
