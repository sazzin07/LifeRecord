// The dock's six tiles: two pages are direct, the other eight sit in a group that unfolds above its tile.
// On a phone (under 640px) there is no dock: the pages are in a side menu opened by the panel button in the top bar, and the assistant and the quick
// actions are in the ball in the middle at the bottom.
export const GROUP_OF = { money: "money", people: "money", groceries: "food", nutrition: "food", fitness: "body", body: "body", tasks: "plan", calendar: "plan" };
export const isPhone = (page) => (page.viewportSize()?.width ?? 1280) < 640;

/** Go to a page the way a person does: through the dock (open its group, then the page), or on a phone through the side menu. */
export async function goToPage(page, name) {
  if (isPhone(page)) {
    await page.getByTestId("menu-toggle").click();
    await page.getByTestId(`nav-${name}`).click();
    return;
  }
  const group = GROUP_OF[name];
  if (group) await page.getByTestId(`dock-${group}`).click();
  await page.getByTestId(`nav-${name}`).click();
}

/** Open the account menu in the top bar (the profile and Sign out live there). */
export async function openAccountMenu(page) {
  await page.getByTestId("header-menu").click();
}

/** Open the assistant: the top bar button, or on a phone the ball's first option. */
export async function openAssistant(page) {
  if (isPhone(page)) { await page.getByTestId("ball").click(); await page.getByTestId("ball-assistant").click(); }
  else await page.getByTestId("ai-trigger").click();
}

/** Open the Quick add dialog: the floating button, or on a phone the ball's "More". */
export async function openQuickAdd(page) {
  if (isPhone(page)) { await page.getByTestId("ball").click(); await page.getByTestId("ball-more").click(); }
  else await page.getByTestId("quick-add-trigger").click();
}
