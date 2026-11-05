import { test, expect } from "./fixtures";
import { goToPage } from "./support/dock";

// S-13: what the person sees when the backend cannot be reached or answers with an error (docs/testing/failure-sweep.md).

test.describe("when things break", () => {
  test("backend down: the page says so and keeps what it already had", async ({ authenticatedPage: page }) => {
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    await page.route("**/api/**", (route) => route.abort("connectionrefused"));
    await goToPage(page, "money");
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toContainText("backend unavailable");
    await page.unroute("**/api/**");
    await page.reload();
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);                  // and it recovers by itself
  });

  test("a server error is explained in words, and is not mistaken for being offline", async ({ authenticatedPage: page }) => {
    // A real error response from the server carries CORS headers (see test_failure_handling.py); the mock must too, or the
    // browser would hide it and the page would report "offline", the exact confusion this check guards against.
    await page.route("**/api/transactions/expense", (route) => {
      const cors = { "access-control-allow-origin": new URL(page.url()).origin, "access-control-allow-credentials": "true",
                     "access-control-allow-headers": "authorization,content-type,x-auth-mode", "access-control-allow-methods": "POST" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 500, contentType: "application/json", headers: cors,
                             body: JSON.stringify({ detail: "Something went wrong on our side. Please try again in a moment." }) });
    });
    await page.goto("/money");
    await page.getByTestId("quick-add-trigger").click();
    await page.getByTestId("qa-expense").click();
    await page.getByTestId("expense-amount").fill("3.20");
    await page.getByTestId("expense-merchant").fill("Failure check");
    await page.getByTestId("expense-save").click();
    await expect(page.getByText("Something went wrong on our side")).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  });
});
