import { expect, type Page } from "@playwright/test";

/**
 * Log in as a specific user. Navigates to the landing page, clicks through
 * to the login form, fills credentials, submits, and waits for the sidebar
 * to confirm a successful authenticated session.
 */
export async function login(
  page: Page,
  username = "admin",
  password = "admin123",
) {
  await page.goto("/");

  // Wait for either the landing page "Sign In" link or the login form input.
  // The app first shows a loading spinner while /api/auth/me resolves, then
  // renders the landing page (unauthenticated) or dashboard (authenticated).
  const loginLink = page.getByText(/sign in|log in|get started/i).first();
  const usernameInput = page.locator("[data-testid='login-username'], input[name='username']").first();

  // Wait for one of the two to appear (landing page button or auth form input)
  await Promise.race([
    loginLink.waitFor({ timeout: 15000 }).catch(() => {}),
    usernameInput.waitFor({ timeout: 15000 }).catch(() => {}),
  ]);

  // If on landing page, click through to login form
  if (await loginLink.isVisible()) {
    await loginLink.click();
    // Wait for the auth page to load (lazy-loaded via Suspense)
    await usernameInput.waitFor({ timeout: 10000 });
  }

  await usernameInput.fill(username);

  const passwordInput = page.locator("input[type='password']").first();
  await passwordInput.fill(password);

  const submitBtn = page
    .getByRole("button", { name: /sign in|log in|submit/i })
    .first();
  await submitBtn.click();

  await expect(page.locator("[data-testid='sidebar']")).toBeVisible({
    timeout: 15000,
  });
}
