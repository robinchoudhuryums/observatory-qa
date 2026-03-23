import { test, expect } from "@playwright/test";

test.describe("Upload Flow", () => {
  test("upload page loads", async ({ page }) => {
    const authResp = await page.request.get("/api/auth/me");
    console.log(`AUTH STATUS: ${authResp.status()}`);

    await page.goto("/upload");
    await page.waitForTimeout(3000);

    const url = page.url();
    const hasSidebar = await page.locator("[data-testid='sidebar']").count();
    const hasUploadPage = await page.locator("[data-testid='upload-page']").count();
    const hasDropzone = await page.locator("[data-testid='file-upload-dropzone']").count();
    const hasLanding = await page.locator("text=Know every call").count();
    const allTestIds = await page.locator("[data-testid]").evaluateAll(
      els => els.map(el => el.getAttribute("data-testid"))
    );

    console.log(`PAGE URL: ${url}`);
    console.log(`SIDEBAR COUNT: ${hasSidebar}`);
    console.log(`UPLOAD PAGE COUNT: ${hasUploadPage}`);
    console.log(`DROPZONE COUNT: ${hasDropzone}`);
    console.log(`LANDING TEXT COUNT: ${hasLanding}`);
    console.log(`ALL TEST IDS: ${JSON.stringify(allTestIds)}`);

    await expect(page.locator("[data-testid='upload-page']")).toBeVisible({ timeout: 15000 });
  });
});
