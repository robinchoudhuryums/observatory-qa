import { adminTest as test, expect } from "./fixtures";

test.describe("Dashboard", () => {
  test("dashboard loads with sidebar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='dashboard-page']")).toBeVisible({ timeout: 15000 });
  });

  test("shows metrics overview", async ({ page }) => {
    // Navigate and wait for full page load
    await page.goto("/");
    // Wait for the dashboard to confirm auth succeeded and page rendered
    await expect(page.locator("[data-testid='dashboard-page']")).toBeVisible({ timeout: 30000 });
    // MetricsOverview renders in all states (loading, error, success)
    await expect(page.locator("[data-testid='metrics-overview']")).toBeVisible({ timeout: 15000 });
  });

  test("shows sentiment analysis", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sentiment-analysis']")).toBeVisible({ timeout: 15000 });
  });

  test("shows performance card", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='performance-card']")).toBeVisible({ timeout: 15000 });
  });
});
