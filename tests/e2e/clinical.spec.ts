import { adminTest as test, expect } from "./fixtures";

test.describe("Clinical Documentation", () => {
  test("clinical dashboard loads", async ({ page }) => {
    await page.goto("/clinical");
    // Clinical page or upgrade prompt
    const content = page.getByText(/clinical|documentation|attestation|upgrade/i).first();
    await expect(content).toBeVisible({ timeout: 15000 });
  });

  test("clinical templates page loads", async ({ page }) => {
    await page.goto("/clinical/templates");
    const content = page.getByText(/template|clinical|specialty|SOAP|upgrade/i).first();
    await expect(content).toBeVisible({ timeout: 15000 });
  });
});
