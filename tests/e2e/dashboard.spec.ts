import { adminTest as test, expect } from "./fixtures";

test.describe("Dashboard — Atlas", () => {
  test("dashboard loads with sidebar and Atlas hero", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='dashboard-page']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='atlas-hero']")).toBeVisible({ timeout: 15000 });
  });

  test("Atlas lens switcher renders all four lenses", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='atlas-hero']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='atlas-lens-type']")).toBeVisible();
    await expect(page.locator("[data-testid='atlas-lens-recency']")).toBeVisible();
    await expect(page.locator("[data-testid='atlas-lens-sentiment']")).toBeVisible();
    await expect(page.locator("[data-testid='atlas-lens-agent']")).toBeVisible();
  });

  test("Day Replay button is present (disabled when no calls today)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='atlas-hero']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='atlas-day-replay']")).toBeVisible();
  });

  test("Lens switching updates aria-pressed state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='atlas-hero']")).toBeVisible({ timeout: 15000 });
    // Default lens is type.
    await expect(page.locator("[data-testid='atlas-lens-type']")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Click recency lens.
    await page.locator("[data-testid='atlas-lens-recency']").click();
    await expect(page.locator("[data-testid='atlas-lens-recency']")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("[data-testid='atlas-lens-type']")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
