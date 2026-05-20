import { adminTest as test, expect } from "./fixtures";

test.describe("Patterns view", () => {
  test("insights page renders the patterns view", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.locator("[data-testid='insights-page']")).toBeVisible({ timeout: 15000 });
  });

  test("days window switcher renders all three options", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.locator("[data-testid='insights-page']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='patterns-days-7']")).toBeVisible();
    await expect(page.locator("[data-testid='patterns-days-30']")).toBeVisible();
    await expect(page.locator("[data-testid='patterns-days-90']")).toBeVisible();
  });

  test("switching days window updates aria-pressed", async ({ page }) => {
    await page.goto("/insights");
    await expect(page.locator("[data-testid='insights-page']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='patterns-days-30']")).toHaveAttribute("aria-pressed", "true");
    await page.locator("[data-testid='patterns-days-7']").click();
    await expect(page.locator("[data-testid='patterns-days-7']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-testid='patterns-days-30']")).toHaveAttribute("aria-pressed", "false");
  });
});
