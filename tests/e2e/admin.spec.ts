import { test, expect } from "@playwright/test";

test.describe("Admin Settings", () => {
  test("admin page loads for admin user", async ({ page }) => {
    await page.goto("/admin");
    const content = page.getByText(/user|manage|admin|team/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("settings page loads", async ({ page }) => {
    await page.goto("/admin/settings");
    const content = page.getByText(/settings|organization|billing|branding|preferences/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("prompt templates page loads for admin", async ({ page }) => {
    await page.goto("/admin/templates");
    const content = page.getByText(/prompt|template|evaluation|category/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("A/B testing page loads for admin", async ({ page }) => {
    await page.goto("/admin/ab-testing");
    const content = page.getByText(/a\/b|model|test|comparison|upload/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("spend tracking page loads", async ({ page }) => {
    await page.goto("/admin/spend-tracking");
    const content = page.getByText(/spend|cost|usage|track/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("audit logs page loads", async ({ page }) => {
    await page.goto("/admin/audit-logs");
    const content = page.getByText(/audit|log|event|activity/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});
