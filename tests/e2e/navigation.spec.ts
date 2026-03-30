import { adminTest as test, expect } from "./fixtures";

test.describe("Navigation", () => {
  test("sidebar renders with navigation links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });

    // Core nav items
    await expect(page.locator("[data-testid='nav-link-dashboard']")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid='nav-link-upload-calls']")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid='nav-link-transcripts']")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid='nav-link-search']")).toBeVisible({ timeout: 5000 });

    // Admin section is collapsed by default — expand it first
    const adminSection = page.locator("button", { hasText: "Admin" });
    if (await adminSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await adminSection.click();
      await expect(page.locator("[data-testid='nav-link-admin']")).toBeVisible({ timeout: 5000 });
      await expect(page.locator("[data-testid='nav-link-templates']")).toBeVisible({ timeout: 5000 });
      await expect(page.locator("[data-testid='nav-link-audit-logs']")).toBeVisible({ timeout: 5000 });
    }
  });

  test("pages load via direct navigation", async ({ page }) => {
    await page.goto("/upload");
    await expect(page.locator("[data-testid='upload-page']")).toBeVisible({ timeout: 15000 });

    await page.goto("/admin");
    await expect(page.locator("[data-testid='admin-page']")).toBeVisible({ timeout: 15000 });

    await page.goto("/admin/audit-logs");
    await expect(page.locator("[data-testid='audit-logs-page']")).toBeVisible({ timeout: 15000 });
  });
});
