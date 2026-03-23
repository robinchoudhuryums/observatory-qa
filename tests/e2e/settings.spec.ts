import { adminTest as test, expect } from "./fixtures";

test.describe("Settings Page", () => {
  test("settings page loads", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page.locator("[data-testid='settings-page']")).toBeVisible({ timeout: 15000 });
  });
});
