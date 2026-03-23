import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Navigation", () => {
  test("sidebar renders with navigation links", async ({ page }) => {
    await login(page);
    // Verify key nav items exist in the sidebar
    await expect(page.locator("[data-testid='nav-link-dashboard']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-upload-calls']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-transcripts']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-search']")).toBeVisible({ timeout: 10000 });

    // Admin user should also see admin links
    await expect(page.locator("[data-testid='nav-link-admin']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-templates']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-audit-logs']")).toBeVisible({ timeout: 10000 });
  });

  test("pages load via direct navigation", async ({ page }) => {
    await login(page);

    // Upload page
    await page.goto("/upload");
    await expect(page.locator("[data-testid='upload-page']")).toBeVisible({ timeout: 10000 });

    // Reports page
    await page.goto("/reports");
    await expect(page.locator("body")).toBeVisible();

    // Admin page
    await page.goto("/admin");
    await expect(page.locator("[data-testid='admin-page']")).toBeVisible({ timeout: 10000 });

    // Audit logs page
    await page.goto("/admin/audit-logs");
    await expect(page.locator("[data-testid='audit-logs-page']")).toBeVisible({ timeout: 10000 });
  });

  test("can logout", async ({ page }) => {
    await login(page);
    await page.locator("[data-testid='logout-button']").click({ timeout: 10000 });
    // After logout, should see landing page or login
    await expect(page.locator("[data-testid='sidebar']")).not.toBeVisible({ timeout: 10000 });
  });
});
