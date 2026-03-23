import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Dashboard", () => {
  test("dashboard loads with sidebar after login", async ({ page }) => {
    await login(page);
    // After login we should be on the root route with sidebar visible
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 10000 });
  });

  test("shows metrics and content sections", async ({ page }) => {
    await login(page);
    await page.goto("/");

    // Dashboard should show metric-related text (total calls, avg score, etc.)
    const metricText = page
      .getByText(/total calls|calls|average|score|performance/i)
      .first();
    await expect(metricText).toBeVisible({ timeout: 10000 });

    // Should show performance-related content
    const performanceText = page
      .getByText(/performance|top performer|score/i)
      .first();
    await expect(performanceText).toBeVisible({ timeout: 10000 });

    // Should show sentiment-related content
    const sentimentText = page
      .getByText(/sentiment|positive|negative|neutral/i)
      .first();
    await expect(sentimentText).toBeVisible({ timeout: 10000 });
  });

  test("dashboard shows key content sections", async ({ page }) => {
    await login(page);
    await page.goto("/");

    const dashboardContent = page
      .getByText(/monitor|performance|sentiment|calls|overview|trend|updated/i)
      .first();
    await expect(dashboardContent).toBeVisible({ timeout: 10000 });
  });
});
