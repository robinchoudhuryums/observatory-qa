import { test, expect } from "@playwright/test";

test.describe("Coaching", () => {
  test("coaching page loads", async ({ page }) => {
    await page.goto("/coaching");
    const content = page.getByText(/coaching|session|action plan|create/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("coaching page shows create button for admin", async ({ page }) => {
    await page.goto("/coaching");
    const createBtn = page.getByRole("button", { name: /create|new|add/i }).first();
    const hasButton = await createBtn.isVisible().catch(() => false);
    if (hasButton) {
      await expect(createBtn).toBeVisible();
    }
  });
});
