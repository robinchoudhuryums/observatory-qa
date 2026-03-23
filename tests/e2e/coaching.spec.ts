import { adminTest as test, expect } from "./fixtures";

test.describe("Coaching", () => {
  test("coaching page loads", async ({ page }) => {
    await page.goto("/coaching");
    await expect(page.locator("[data-testid='coaching-page']")).toBeVisible({ timeout: 15000 });
  });
});
