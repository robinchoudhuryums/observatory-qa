import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Search Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("search page loads", async ({ page }) => {
    await page.goto("/search");
    await expect(page.locator("[data-testid='search-page']")).toBeVisible({ timeout: 10000 });
  });

  test("search input is visible", async ({ page }) => {
    await page.goto("/search");

    const searchInput = page
      .locator(
        "[data-testid='search-input'], input[placeholder*='search' i], input[type='search'], input[name='search'], input[name='query']",
      )
      .first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
  });

  test("can type a search query", async ({ page }) => {
    await page.goto("/search");

    const searchInput = page
      .locator(
        "[data-testid='search-input'], input[placeholder*='search' i], input[type='search'], input[name='search'], input[name='query']",
      )
      .first();
    await searchInput.waitFor({ timeout: 10000 });
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
