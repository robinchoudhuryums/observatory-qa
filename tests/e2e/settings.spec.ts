import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Settings Page", () => {
  test("settings page loads with user info", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings");

    // Page should show settings-related content
    const heading = page.getByText(/settings|preferences/i).first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Should show the logged-in user's name or username
    const userInfo = page
      .getByText(/test admin|admin/i)
      .first();
    await expect(userInfo).toBeVisible({ timeout: 10000 });
  });
});
