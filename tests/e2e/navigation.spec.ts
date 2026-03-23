import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("sidebar contains expected navigation links", async ({ page }) => {
    await expect(page.locator("[data-testid='nav-link-dashboard']")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid='nav-link-upload-calls']")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid='nav-link-transcripts']")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid='nav-link-search']")).toBeVisible({ timeout: 5000 });
  });

  test("admin user can see admin links", async ({ page }) => {
    // Admin section may require scrolling in the sidebar
    const adminLink = page.locator("[data-testid='nav-link-admin']");
    await adminLink.scrollIntoViewIfNeeded();
    await expect(adminLink).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid='nav-link-templates']")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid='nav-link-audit-logs']")).toBeVisible({ timeout: 5000 });
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
    const adminLink = page.locator("[data-testid='nav-link-admin']");
    await adminLink.scrollIntoViewIfNeeded();
    await adminLink.click();
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.locator("[data-testid='admin-page']")).toBeVisible({ timeout: 10000 });
  });

  test("can navigate to audit logs page", async ({ page }) => {
    const auditLink = page.locator("[data-testid='nav-link-audit-logs']");
    await auditLink.scrollIntoViewIfNeeded();
    await auditLink.click();
    await expect(page).toHaveURL(/\/admin\/audit-logs/);
    await expect(page.locator("[data-testid='audit-logs-page']")).toBeVisible({ timeout: 10000 });
  });

  test("can logout", async ({ page }) => {
    const logoutBtn = page.locator("[data-testid='logout-button']");
    await logoutBtn.scrollIntoViewIfNeeded();
    await logoutBtn.click();
    // After logout, should see landing page or login
    await expect(page.locator("[data-testid='sidebar']")).not.toBeVisible({ timeout: 5000 });
  });
});
