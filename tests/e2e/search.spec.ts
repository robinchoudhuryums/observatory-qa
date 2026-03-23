import { test, expect } from "@playwright/test";

test.describe("Search Flow", () => {
  test("search page loads with input and content", async ({ page }) => {
    await page.goto("/search");

    await expect(page.locator("[data-testid='search-page']")).toBeVisible({ timeout: 10000 });

    const searchInput = page
      .locator(
        "[data-testid='search-input'], input[placeholder*='search' i], input[type='search'], input[name='search'], input[name='query']",
      )
      .first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    await searchInput.fill("test query");
    await expect(searchInput).toHaveValue("test query");
  });

  test("results area is visible", async ({ page }) => {
    await page.goto("/search");

    await expect(page.locator("[data-testid='search-page']")).toBeVisible({ timeout: 10000 });

    const pageContent = page
      .getByText(/search|results|no calls|enter|keyword/i)
      .first();
    await expect(pageContent).toBeVisible({ timeout: 10000 });
  });
});
