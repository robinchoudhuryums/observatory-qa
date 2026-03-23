import { test, expect } from "@playwright/test";

test.describe("Settings Page", () => {
  test("settings page loads with user info", async ({ page }) => {
    await page.goto("/admin/settings");

    const heading = page.getByText(/settings|preferences/i).first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    const userInfo = page
      .getByText(/test admin|admin/i)
      .first();
    await expect(userInfo).toBeVisible({ timeout: 10000 });
  });
});
