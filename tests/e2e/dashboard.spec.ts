import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("dashboard loads with sidebar after login", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 10000 });
  });

  test("shows metrics and content sections", async ({ page }) => {
    await page.goto("/");

    const metricText = page
      .getByText(/total calls|calls|average|score|performance/i)
      .first();
    await expect(metricText).toBeVisible({ timeout: 10000 });

    const performanceText = page
      .getByText(/performance|top performer|score/i)
      .first();
    await expect(performanceText).toBeVisible({ timeout: 10000 });

    const sentimentText = page
      .getByText(/sentiment|positive|negative|neutral/i)
      .first();
    await expect(sentimentText).toBeVisible({ timeout: 10000 });
  });

  test("dashboard shows key content sections", async ({ page }) => {
    await page.goto("/");

    const dashboardContent = page
      .getByText(/monitor|performance|sentiment|calls|overview|trend|updated/i)
      .first();
    await expect(dashboardContent).toBeVisible({ timeout: 10000 });
  });
});
