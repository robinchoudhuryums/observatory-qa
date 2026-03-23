import { expect, type Page } from "@playwright/test";

/**
 * Log in via the API and set the session cookie on the page.
 * This avoids the complexity of navigating the SPA login flow
 * (landing page → auth page transition, lazy loading, etc.)
 * and directly establishes an authenticated session.
 */
export async function login(
  page: Page,
  username = "admin",
  password = "admin123",
) {
  // Use the page's request context so cookies are automatically shared
  const response = await page.request.post("/api/auth/login", {
    data: { username, password },
  });

  if (response.status() !== 200) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Login API failed: ${response.status()} ${response.statusText()} — ${body}`,
    );
  }

  // Navigate to dashboard — session cookie is already set from the API call.
  // Do NOT use waitUntil:"networkidle" — WebSocket connections prevent it from resolving.
  await page.goto("/");

  // Wait for authenticated app to render (sidebar indicates successful auth)
  await expect(page.locator("[data-testid='sidebar']")).toBeVisible({
    timeout: 15000,
  });

  // Wait for React to stabilize after initial data queries (calls, employees,
  // access-requests). These useQuery hooks in the sidebar trigger re-renders
  // that detach/recreate DOM elements. A brief wait lets them settle.
  await page.waitForTimeout(1500);
}
