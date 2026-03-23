import { test, expect } from "@playwright/test";

test.describe("Clinical Documentation", () => {
  test("clinical dashboard loads", async ({ page }) => {
    await page.goto("/clinical");
    const hasContent = page.getByText(/clinical|documentation|attestation|upgrade/i).first();
    await expect(hasContent).toBeVisible({ timeout: 10000 });
  });

  test("clinical templates page loads", async ({ page }) => {
    await page.goto("/clinical/templates");
    const content = page.getByText(/template|clinical|specialty|SOAP|upgrade/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("clinical upload page loads", async ({ page }) => {
    await page.goto("/clinical/upload");
    const content = page.getByText(/upload|record|encounter|audio|upgrade/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test("clinical notes page handles missing call gracefully", async ({ page }) => {
    await page.goto("/clinical/notes/nonexistent-id");
    const content = page.getByText(/not found|error|no.*note|upgrade/i).first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});
