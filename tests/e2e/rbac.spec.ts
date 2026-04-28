import { viewerTest as test, expect } from "./fixtures";

test.describe("RBAC - Role-Based Access Control", () => {
  test("viewer cannot see admin links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='nav-link-administration']")).not.toBeVisible();
    await expect(page.locator("[data-testid='nav-link-prompt-templates']")).not.toBeVisible();
    await expect(page.locator("[data-testid='nav-link-audit-logs']")).not.toBeVisible();
  });

  test("viewer cannot access admin page directly", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 10000 });
  });

  test("viewer can access upload page", async ({ page }) => {
    await page.goto("/upload");
    await expect(page.locator("[data-testid='upload-page']")).toBeVisible({ timeout: 15000 });
  });
});
