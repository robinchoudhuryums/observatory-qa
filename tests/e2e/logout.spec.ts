import { adminTest as test, expect } from "./fixtures";

test.describe("Logout", () => {
  test("can logout and see landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });
    await page.locator("[data-testid='logout-button']").click({ timeout: 10000 });
    await expect(page.locator("[data-testid='sidebar']")).not.toBeVisible({ timeout: 10000 });
  });
});
