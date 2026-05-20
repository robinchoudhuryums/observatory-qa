import { adminTest as test, expect } from "./fixtures";

test.describe("Ask Ory FAB", () => {
  test("FAB is visible on the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='ask-ory-fab']")).toBeVisible({ timeout: 15000 });
  });

  test("clicking the FAB opens the panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid='ask-ory-fab']")).toBeVisible({ timeout: 15000 });
    await page.locator("[data-testid='ask-ory-fab']").click();
    await expect(page.locator("[data-testid='ask-ory-panel']")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid='ask-ory-input']")).toBeVisible();
    await expect(page.locator("[data-testid='ask-ory-submit']")).toBeVisible();
  });

  test("FAB is mounted on every authenticated page (Atlas, Galaxy, Patterns)", async ({ page }) => {
    for (const route of ["/", "/galaxy", "/insights", "/transcripts"]) {
      await page.goto(route);
      // FAB or panel must be present (panel may be open from a previous step).
      const fab = page.locator("[data-testid='ask-ory-fab']");
      const panel = page.locator("[data-testid='ask-ory-panel']");
      await expect(fab.or(panel)).toBeVisible({ timeout: 15000 });
    }
  });
});
