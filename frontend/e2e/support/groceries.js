// Groceries navigation: on a tablet or a wider screen the sections are a rail beside the page; on a phone they are in a drawer that the
// three-bar button in the heading opens (choosing a section closes it). These helpers work at every size.
const settled = (page) => page.getByTestId("gt-drawer").waitFor({ state: "detached" });   // a drawer still sliding out must not be mistaken for an open one

/** Wait until the page has drawn its navigation, then say whether the target is in the drawer (a phone) or already on screen (the rail). */
async function inDrawer(page, target) {
  const burger = page.getByTestId("gt-drawer-open");
  await target.or(burger).first().waitFor({ state: "visible" });
  return burger.isVisible();
}

export async function openGroceriesTab(page, name) {
  await settled(page);
  const tab = page.getByRole("tab", { name, exact: true });
  const drawer = await inDrawer(page, tab);
  if (drawer) await page.getByTestId("gt-drawer-open").click();
  await tab.click();
  if (drawer) await settled(page);
}

export async function openCatalog(page) {
  await settled(page);
  const button = page.getByRole("button", { name: "Catalog", exact: true });
  const drawer = await inDrawer(page, button);
  if (drawer) await page.getByTestId("gt-drawer-open").click();
  await button.click();
  if (drawer) await settled(page);
}
