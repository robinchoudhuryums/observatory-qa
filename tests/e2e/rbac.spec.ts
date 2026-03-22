import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("RBAC - Role-Based Access Control", () => {
  test("viewer cannot see admin links", async ({ page }) => {
    await login(page, "viewer", "viewer123");
    await expect(page.locator("[data-testid='nav-link-admin']")).not.toBeVisible();
    await expect(page.locator("[data-testid='nav-link-templates']")).not.toBeVisible();
    await expect(page.locator("[data-testid='nav-link-audit-logs']")).not.toBeVisible();
  });

  test("viewer cannot access admin page directly", async ({ page }) => {
    await login(page, "viewer", "viewer123");
    await page.goto("/admin");
    // Should see permission denied message
    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 5000 });
  });

  test("viewer cannot access audit logs directly", async ({ page }) => {
    await login(page, "viewer", "viewer123");
    await page.goto("/admin/audit-logs");
    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 5000 });
  });

  test("admin can access admin page", async ({ page }) => {
    await login(page, "admin", "admin123");
    await page.goto("/admin");
    await expect(page.locator("[data-testid='admin-page']")).toBeVisible({ timeout: 5000 });
  });
});
