import { adminTest as test, expect } from "./fixtures";

test.describe("Search Flow", () => {
  test("search page loads with input", async ({ page }) => {
    await page.goto("/search");
    await expect(page.locator("[data-testid='search-page']")).toBeVisible({ timeout: 15000 });

    const searchInput = page
      .locator("input[placeholder*='search' i], input[type='search'], input[name='search'], input[name='query']")
      .first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    await searchInput.fill("test query");
    await expect(searchInput).toHaveValue("test query");
  });

  test("search page shows content", async ({ page }) => {
    await page.goto("/search");
    await expect(page.locator("[data-testid='search-page']")).toBeVisible({ timeout: 15000 });
  });
});
