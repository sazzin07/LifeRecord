import { test, expect } from "./fixtures";

// D-02: on a phone, every page is reachable in two taps without the keyboard or the search bar, and the page you are on is announced.
test.use({ viewport: { width: 390, height: 844 } });

const BAR = ["Home", "Money", "People", "Tasks"];                       // one tap
const MORE = ["Groceries", "Nutrition", "Fitness", "Body", "Calendar", "Settings"];   // two taps
const PATH = { Home: "/", Money: "/money", People: "/people", Tasks: "/tasks", Groceries: "/groceries", Nutrition: "/nutrition",
  Fitness: "/fitness", Body: "/body", Calendar: "/calendar", Settings: "/settings" };

test.describe("phone navigation", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => sessionStorage.setItem("lm_intro", "1"));
  });

  for (const name of BAR) {
    test(`${name} is one tap away and is announced as the current page`, async ({ authenticatedPage: page }) => {
      await page.goto(name === "Home" ? "/tasks" : "/");
      await page.getByTestId(`mnav-${name.toLowerCase()}`).click();
      await expect(page).toHaveURL(new RegExp(`${PATH[name] === "/" ? "/$" : PATH[name] + "$"}`));
      await expect(page.getByTestId(`mnav-${name.toLowerCase()}`)).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("mnav-more")).not.toHaveAttribute("aria-current", "page");
    });
  }

  for (const name of MORE) {
    test(`${name} is two taps away (More, then ${name}) and More shows where you are`, async ({ authenticatedPage: page }) => {
      await page.goto("/");
      await page.getByTestId("mnav-more").click();                                    // tap 1
      const link = page.getByTestId(`more-${name.toLowerCase()}`);
      await expect(link).toBeVisible();
      await link.click();                                                              // tap 2
      await expect(page).toHaveURL(new RegExp(`${PATH[name]}$`));
      await expect(page.getByTestId("more-sheet")).toBeHidden();                       // the sheet closed itself
      await expect(page.getByTestId("mnav-more")).toHaveAttribute("aria-current", "page");
      await page.getByTestId("mnav-more").click();                                     // reopened, the current page is marked in the list
      await expect(page.getByTestId(`more-${name.toLowerCase()}`)).toHaveAttribute("aria-current", "page");
    });
  }

  test("the sheet works from the keyboard and gives the focus back", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    const more = page.getByTestId("mnav-more");
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("more-sheet")).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement.closest('[data-testid="more-sheet"]'))).toBe(true);   // focus stays inside
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("more-sheet")).toBeHidden();
    await expect(more).toBeFocused();
  });

  test("the sheet also holds Sign out, and the bar does not overlap the quick-add button", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    await page.getByTestId("mnav-more").click();
    await expect(page.getByTestId("more-signout")).toBeVisible();
    await page.keyboard.press("Escape");
    const bar = await page.locator("nav.glass-strong").boundingBox();
    const ai = await page.getByTestId("quick-add-trigger").boundingBox();
    expect(ai.y + ai.height).toBeLessThanOrEqual(bar.y + 1);                          // the quick-add button sits above the bar
  });
});
