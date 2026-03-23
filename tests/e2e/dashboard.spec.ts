import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("dashboard loads after login", async ({ page }) => {
    // After login the sidebar should already be visible; verify we are on the dashboard
    // URL may or may not have trailing slash depending on browser
    await expect(page).toHaveURL(/\/(dashboard)?$/);
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible();
  });

  test("shows metrics overview cards", async ({ page }) => {
    await page.goto("/");

    // Look for metric cards — common patterns: data-testid, card role, or heading text
    const metricsSection = page
      .locator(
        "[data-testid='metrics-overview'], [data-testid='metrics-cards']",
      )
      .first();

    // If specific test-ids aren't present, fall back to looking for typical dashboard KPIs
    const hasMetricsSection = await metricsSection.isVisible().catch(() => false);
    if (hasMetricsSection) {
      await expect(metricsSection).toBeVisible();
    } else {
      // Dashboard should show some metric-related text (total calls, avg score, etc.)
      const metricText = page
        .getByText(/total calls|calls|average|score|performance/i)
        .first();
      await expect(metricText).toBeVisible({ timeout: 10000 });
    }
  });

  test("shows performance section", async ({ page }) => {
    await page.goto("/");

    const performanceSection = page
      .locator("[data-testid='performance-card'], [data-testid='performance-section']")
      .first();

    const hasSection = await performanceSection.isVisible().catch(() => false);
    if (hasSection) {
      await expect(performanceSection).toBeVisible();
    } else {
      const performanceText = page
        .getByText(/performance|top performer|score/i)
        .first();
      await expect(performanceText).toBeVisible({ timeout: 10000 });
    }
  });

  test("shows sentiment analysis section", async ({ page }) => {
    await page.goto("/");

    const sentimentSection = page
      .locator("[data-testid='sentiment-analysis'], [data-testid='sentiment-section']")
      .first();

    const hasSection = await sentimentSection.isVisible().catch(() => false);
    if (hasSection) {
      await expect(sentimentSection).toBeVisible();
    } else {
      const sentimentText = page
        .getByText(/sentiment|positive|negative|neutral/i)
        .first();
      await expect(sentimentText).toBeVisible({ timeout: 10000 });
    }
  });

  test("dashboard shows key content sections", async ({ page }) => {
    await page.goto("/");

    // Dashboard should have some content — look for common dashboard elements
    // This is a flexible check for any dashboard-related content
    const dashboardContent = page
      .getByText(/monitor|performance|sentiment|calls|overview|trend|updated/i)
      .first();
    await expect(dashboardContent).toBeVisible({ timeout: 10000 });
  });
});
