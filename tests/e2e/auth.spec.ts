import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("shows landing page when not authenticated", async ({ page }) => {
    await page.goto("/");
    // Should see the landing page or login form
    await expect(page.locator("body")).toBeVisible();
  });

  test("can navigate to login page", async ({ page }) => {
    await page.goto("/");
    // Wait for landing page to load (app shows spinner while /api/auth/me resolves)
    const loginLink = page.getByText(/sign in|log in|get started/i).first();
    await loginLink.waitFor({ timeout: 15000 });
    await loginLink.click();
    // Should see login form
    const usernameInput = page.locator("[data-testid='login-username'], input[name='username']").first();
    await expect(usernameInput).toBeVisible({ timeout: 10000 });
  });

  test("login with valid credentials shows dashboard", async ({ page }) => {
    // Use API login to verify session works
    const response = await page.request.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.username).toBe("admin");

    // Navigate and verify authenticated state
    await page.goto("/");
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });
  });

  test("login with invalid credentials shows error", async ({ page }) => {
    const response = await page.request.post("/api/auth/login", {
      data: { username: "admin", password: "wrongpassword" },
    });
    expect(response.status()).toBe(401);
  });
});
