import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("sidebar renders with navigation links", async ({ page }) => {
    // Diagnostic: check auth API directly
    const authResp = await page.request.get("/api/auth/me");
    const authBody = await authResp.json();
    console.log(`AUTH STATUS: ${authResp.status()}, user: ${authBody?.username}, role: ${authBody?.role}`);

    await page.goto("/");

    // Wait for React to render (the app shows a spinner while loading)
    await page.waitForTimeout(3000);

    // Capture what's actually on the page
    const url = page.url();
    const title = await page.title();
    const bodyText = await page.locator("body").innerText().catch(() => "COULD NOT GET BODY TEXT");
    const hasSidebar = await page.locator("[data-testid='sidebar']").count();
    const hasLanding = await page.locator("text=Know every call").count();
    const allTestIds = await page.locator("[data-testid]").evaluateAll(
      els => els.map(el => el.getAttribute("data-testid"))
    );

    console.log(`PAGE URL: ${url}`);
    console.log(`PAGE TITLE: ${title}`);
    console.log(`SIDEBAR COUNT: ${hasSidebar}`);
    console.log(`LANDING TEXT COUNT: ${hasLanding}`);
    console.log(`ALL TEST IDS: ${JSON.stringify(allTestIds)}`);
    console.log(`BODY TEXT (first 500): ${bodyText.substring(0, 500)}`);

    // Now do the actual assertion
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });
  });
});
