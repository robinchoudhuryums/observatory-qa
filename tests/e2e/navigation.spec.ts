import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("sidebar renders with navigation links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 10000 });

    // Core nav items
    await expect(page.locator("[data-testid='nav-link-dashboard']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-upload-calls']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-transcripts']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-search']")).toBeVisible({ timeout: 10000 });

    // Admin links (admin user)
    await expect(page.locator("[data-testid='nav-link-admin']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-templates']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='nav-link-audit-logs']")).toBeVisible({ timeout: 10000 });
  });

  test("pages load via direct navigation", async ({ page }) => {
    await page.goto("/upload");
    await expect(page.locator("[data-testid='upload-page']")).toBeVisible({ timeout: 10000 });

    await page.goto("/admin");
    await expect(page.locator("[data-testid='admin-page']")).toBeVisible({ timeout: 10000 });

    await page.goto("/admin/audit-logs");
    await expect(page.locator("[data-testid='audit-logs-page']")).toBeVisible({ timeout: 10000 });
  });

  test("can logout", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 10000 });
    await page.locator("[data-testid='logout-button']").click({ timeout: 10000 });
    await expect(page.locator("[data-testid='sidebar']")).not.toBeVisible({ timeout: 10000 });
  });
});
