import { test, expect } from "@playwright/test";

test.describe("Search Flow", () => {
  test("search page loads", async ({ page }) => {
    // Diagnostic: check auth API directly
    const authResp = await page.request.get("/api/auth/me");
    console.log(`AUTH STATUS: ${authResp.status()}`);

    await page.goto("/search");
    await page.waitForTimeout(3000);

    const url = page.url();
    const hasSidebar = await page.locator("[data-testid='sidebar']").count();
    const hasSearchPage = await page.locator("[data-testid='search-page']").count();
    const hasLanding = await page.locator("text=Know every call").count();
    const allTestIds = await page.locator("[data-testid]").evaluateAll(
      els => els.map(el => el.getAttribute("data-testid"))
    );

    console.log(`PAGE URL: ${url}`);
    console.log(`SIDEBAR COUNT: ${hasSidebar}`);
    console.log(`SEARCH PAGE COUNT: ${hasSearchPage}`);
    console.log(`LANDING TEXT COUNT: ${hasLanding}`);
    console.log(`ALL TEST IDS: ${JSON.stringify(allTestIds)}`);

    await expect(page.locator("[data-testid='search-page']")).toBeVisible({ timeout: 15000 });
  });
});
