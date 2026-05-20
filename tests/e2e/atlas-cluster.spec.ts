import { adminTest as test, expect } from "./fixtures";

test.describe("Atlas cluster drill-in", () => {
  test("cluster page renders for a known category", async ({ page }) => {
    // Pick any category; the page should render even if there's no data for it.
    await page.goto("/atlas/cluster/inbound");
    await expect(page.locator("[data-testid='atlas-cluster-page']")).toBeVisible({ timeout: 15000 });
  });

  test("breadcrumb back-to-atlas link is present", async ({ page }) => {
    await page.goto("/atlas/cluster/inbound");
    await expect(page.locator("[data-testid='atlas-cluster-page']")).toBeVisible({ timeout: 15000 });
    // The back button leads to the Atlas (dashboard).
    const back = page.getByRole("button", { name: /back to atlas/i });
    await expect(back).toBeVisible();
  });

  test("cluster page handles uncategorized fallback", async ({ page }) => {
    await page.goto("/atlas/cluster/uncategorized");
    await expect(page.locator("[data-testid='atlas-cluster-page']")).toBeVisible({ timeout: 15000 });
  });
});
