import { adminTest as test, expect } from "./fixtures";

test.describe("Galaxy view", () => {
  test("galaxy page renders", async ({ page }) => {
    await page.goto("/galaxy");
    await expect(page.locator("[data-testid='galaxy-page']")).toBeVisible({ timeout: 15000 });
  });

  test("month navigation buttons present", async ({ page }) => {
    await page.goto("/galaxy");
    await expect(page.locator("[data-testid='galaxy-page']")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /previous month/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /next month/i })).toBeVisible();
  });

  test("next-month button is disabled when at current month", async ({ page }) => {
    await page.goto("/galaxy");
    await expect(page.locator("[data-testid='galaxy-page']")).toBeVisible({ timeout: 15000 });
    const nextButton = page.getByRole("button", { name: /next month/i });
    await expect(nextButton).toBeDisabled();
  });
});
