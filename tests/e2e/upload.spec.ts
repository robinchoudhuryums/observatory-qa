import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Upload Flow", () => {
  test("upload page loads with dropzone and instructions", async ({ page }) => {
    await login(page);
    await page.goto("/upload");

    // The upload area should be visible
    const dropzone = page
      .locator(
        "[data-testid='file-upload-dropzone'], [data-testid='file-upload'], [data-testid='dropzone'], input[type='file']",
      )
      .first();
    await expect(dropzone).toBeVisible({ timeout: 10000 });

    // Should contain drag-and-drop or file upload instructions
    const dragText = page
      .getByText(/drag.*drop|browse.*file|upload.*audio|choose.*file|click to select/i)
      .first();
    await expect(dragText).toBeVisible({ timeout: 10000 });

    // A file input should exist (may be hidden for styling)
    const fileInput = page.locator("input[type='file']");
    await expect(fileInput).toBeAttached();
  });

  test("viewer can access upload page", async ({ page }) => {
    await login(page, "viewer", "viewer123");
    await page.goto("/upload");

    const uploadContent = page
      .getByText(/drag.*drop|browse.*file|upload|choose.*file|click to select/i)
      .first();
    await expect(uploadContent).toBeVisible({ timeout: 10000 });
  });
});
