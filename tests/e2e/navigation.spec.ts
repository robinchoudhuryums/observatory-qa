import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("sidebar contains expected navigation links", async ({ page }) => {
    await expect(page.locator("[data-testid='nav-link-dashboard']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-upload-calls']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-transcripts']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-search']")).toBeVisible();
  });

  test("admin user can see admin links", async ({ page }) => {
    await expect(page.locator("[data-testid='nav-link-admin']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-templates']")).toBeVisible();
    await expect(page.locator("[data-testid='nav-link-audit-logs']")).toBeVisible();
  });

  test("can navigate to upload page", async ({ page }) => {
    await page.locator("[data-testid='nav-link-upload-calls']").click();
    await expect(page).toHaveURL(/\/upload/);
  });

  test("can navigate to reports page", async ({ page }) => {
    await page.locator("[data-testid='nav-link-reports']").click();
    await expect(page).toHaveURL(/\/reports/);
  });

  test("can navigate to admin page", async ({ page }) => {
    await page.locator("[data-testid='nav-link-admin']").click();
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.locator("[data-testid='admin-page']")).toBeVisible();
  });

  test("can navigate to audit logs page", async ({ page }) => {
    await page.locator("[data-testid='nav-link-audit-logs']").click();
    await expect(page).toHaveURL(/\/admin\/audit-logs/);
    await expect(page.locator("[data-testid='audit-logs-page']")).toBeVisible();
  });

  test("can logout", async ({ page }) => {
    await page.locator("[data-testid='logout-button']").click();
    // After logout, should see landing page or login
    await expect(page.locator("[data-testid='sidebar']")).not.toBeVisible({ timeout: 5000 });
  });
});
