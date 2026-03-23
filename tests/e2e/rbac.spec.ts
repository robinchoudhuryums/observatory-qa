import { test, expect } from "@playwright/test";

// This spec runs under the "viewer" project (viewer storageState)
test.describe("RBAC - Role-Based Access Control", () => {
  test("viewer cannot see admin links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-admin']")).not.toBeVisible();
    await expect(page.locator("[data-testid='nav-link-templates']")).not.toBeVisible();
    await expect(page.locator("[data-testid='nav-link-audit-logs']")).not.toBeVisible();
  });

  test("viewer cannot access admin page directly", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 5000 });
  });

  test("viewer cannot access audit logs directly", async ({ page }) => {
    await page.goto("/admin/audit-logs");
    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 5000 });
  });

  test("viewer can access upload page", async ({ page }) => {
    await page.goto("/upload");
    const uploadContent = page
      .getByText(/drag.*drop|browse.*file|upload|choose.*file|click to select/i)
      .first();
    await expect(uploadContent).toBeVisible({ timeout: 10000 });
  });
});
