import { test, expect } from "@playwright/test";

test.describe("Upload Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Diagnostic: verify the session is valid before running tests
    const authResponse = await page.request.get("/api/auth/me");
    if (authResponse.status() !== 200) {
      const cookies = await page.context().cookies();
      const cookieNames = cookies.map(c => `${c.name}=${c.value.substring(0, 20)}...`);
      throw new Error(
        `Session invalid! /api/auth/me returned ${authResponse.status()}. ` +
        `Cookies: [${cookieNames.join(", ")}]. ` +
        `URL: ${page.url()}`
      );
    }
  });

  test("upload page loads with dropzone and instructions", async ({ page }) => {
    await page.goto("/upload");

    const dropzone = page
      .locator(
        "[data-testid='file-upload-dropzone'], [data-testid='file-upload'], [data-testid='dropzone'], input[type='file']",
      )
      .first();
    await expect(dropzone).toBeVisible({ timeout: 15000 });

    const dragText = page
      .getByText(/drag.*drop|browse.*file|upload.*audio|choose.*file|click to select/i)
      .first();
    await expect(dragText).toBeVisible({ timeout: 10000 });

    const fileInput = page.locator("input[type='file']");
    await expect(fileInput).toBeAttached();
  });
});
