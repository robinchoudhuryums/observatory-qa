import { adminTest as test, expect } from "./fixtures";

test.describe("Upload Flow", () => {
  test("upload page loads with dropzone", async ({ page }) => {
    await page.goto("/upload");
    await expect(page.locator("[data-testid='upload-page']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='file-upload-dropzone']")).toBeVisible({ timeout: 10000 });
  });
});
