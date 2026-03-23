import { adminTest as test, expect } from "./fixtures";

test.describe("Admin Settings", () => {
  test("admin page loads for admin user", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.locator("[data-testid='admin-page']")).toBeVisible({ timeout: 15000 });
  });

  test("prompt templates page loads for admin", async ({ page }) => {
    await page.goto("/admin/templates");
    await expect(page.locator("[data-testid='prompt-templates-page']")).toBeVisible({ timeout: 15000 });
  });

  test("audit logs page loads", async ({ page }) => {
    await page.goto("/admin/audit-logs");
    await expect(page.locator("[data-testid='audit-logs-page']")).toBeVisible({ timeout: 15000 });
  });
});
