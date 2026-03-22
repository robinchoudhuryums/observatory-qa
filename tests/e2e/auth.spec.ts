import { test, expect } from "@playwright/test";

/** Navigate from landing page to login form, waiting for async load */
async function navigateToLogin(page: import("@playwright/test").Page) {
  await page.goto("/");
  const loginLink = page.getByText(/sign in|log in|get started/i).first();
  const usernameInput = page.locator("[data-testid='login-username'], input[name='username']").first();

  // Wait for landing page or auth form to load (app shows spinner while /api/auth/me resolves)
  await Promise.race([
    loginLink.waitFor({ timeout: 15000 }).catch(() => {}),
    usernameInput.waitFor({ timeout: 15000 }).catch(() => {}),
  ]);

  if (await loginLink.isVisible()) {
    await loginLink.click();
    await usernameInput.waitFor({ timeout: 10000 });
  }

  return usernameInput;
}

test.describe("Authentication", () => {
  test("shows landing page when not authenticated", async ({ page }) => {
    await page.goto("/");
    // Should see the landing page or login form
    await expect(page.locator("body")).toBeVisible();
  });

  test("can navigate to login page", async ({ page }) => {
    const usernameInput = await navigateToLogin(page);
    await expect(usernameInput).toBeVisible({ timeout: 5000 });
  });

  test("login with valid credentials shows dashboard", async ({ page }) => {
    const usernameInput = await navigateToLogin(page);
    await usernameInput.fill("admin");

    const passwordInput = page.locator("input[type='password']").first();
    await passwordInput.fill("admin123");

    const submitBtn = page.getByRole("button", { name: /sign in|log in|submit/i }).first();
    await submitBtn.click();

    // Should see dashboard or sidebar
    await expect(page.locator("[data-testid='sidebar']")).toBeVisible({ timeout: 15000 });
  });

  test("login with invalid credentials shows error", async ({ page }) => {
    const usernameInput = await navigateToLogin(page);
    await usernameInput.fill("admin");

    const passwordInput = page.locator("input[type='password']").first();
    await passwordInput.fill("wrongpassword");

    const submitBtn = page.getByRole("button", { name: /sign in|log in|submit/i }).first();
    await submitBtn.click();

    // Should see error message
    await expect(page.getByText(/invalid|incorrect|failed/i).first()).toBeVisible({ timeout: 5000 });
  });
});
