import { test, expect } from "@playwright/test";

// This test runs in the "logout" project which has its own fresh login,
// separate from the shared admin storageState. This prevents the server-side
// session.destroy() from invalidating other parallel tests' sessions.
test.describe("Logout", () => {
  test("can logout and see landing page", async ({ page }) => {
    // Login with a fresh session for this test only
    const baseURL = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
    const response = await page.context().request.post(`${baseURL}/api/auth/login`, {
      data: { username: "admin", password: "admin123" },
    });
    expect(response.status()).toBe(200);

    // Extract and set cookies
    const setCookieHeaders = response.headersArray().filter(
      (h) => h.name.toLowerCase() === "set-cookie",
    );
    for (const header of setCookieHeaders) {
      const parts = header.value.split(";")[0];
      const [name, ...valueParts] = parts.split("=");
      await page.context().addCookies([{
        name: name.trim(),
        value: valueParts.join("="),
        url: baseURL,
      }]);
    }

    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });
    await page.locator("[data-testid='logout-button']").click({ timeout: 10000 });
    await expect(page.locator("[data-testid='sidebar']")).not.toBeVisible({ timeout: 10000 });
  });
});
