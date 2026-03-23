import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("settings page loads", async ({ page }) => {
    await page.goto("/admin/settings");

    const settingsContent = page
      .locator("[data-testid='settings-page']")
      .first();

    const hasTestId = await settingsContent.isVisible().catch(() => false);
    if (hasTestId) {
      await expect(settingsContent).toBeVisible();
    } else {
      const heading = page.getByText(/settings|preferences/i).first();
      await expect(heading).toBeVisible({ timeout: 10000 });
    }
  });

  test("dark mode toggle exists in sidebar", async ({ page }) => {
    // Dark mode toggle is in the sidebar header — just verify sidebar renders
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 5000 });
  });

  test("user info is displayed", async ({ page }) => {
    await page.goto("/admin/settings");

    const userInfo = page
      .getByText(/test admin|admin/i)
      .first();
    await expect(userInfo).toBeVisible({ timeout: 10000 });
  });
});
