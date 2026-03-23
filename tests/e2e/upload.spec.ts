import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Upload Flow", () => {
  test("navigate to upload page via sidebar", async ({ page }) => {
    await login(page);
    await page.locator("[data-testid='nav-link-upload-calls']").click({ timeout: 10000 });
    await expect(page).toHaveURL(/\/upload/);
  });

  test("upload page shows file upload dropzone", async ({ page }) => {
    await login(page);
    await page.goto("/upload");

    const dropzone = page
      .locator(
        "[data-testid='file-upload-dropzone'], [data-testid='file-upload'], [data-testid='dropzone'], [role='button']:has-text('drag'), .dropzone, input[type='file']",
      )
      .first();
    await expect(dropzone).toBeVisible({ timeout: 10000 });
  });

  test("upload page shows drag-and-drop text", async ({ page }) => {
    await login(page);
    await page.goto("/upload");

    const dragText = page
      .getByText(/drag.*drop|browse.*file|upload.*audio|choose.*file|click to select/i)
      .first();
    await expect(dragText).toBeVisible({ timeout: 10000 });
  });

  test("upload page shows correct UI elements for admin", async ({ page }) => {
    await login(page, "admin", "admin123");
    await page.goto("/upload");

    const heading = page
      .getByText(/upload|new call|add call/i)
      .first();
    await expect(heading).toBeVisible({ timeout: 10000 });

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
