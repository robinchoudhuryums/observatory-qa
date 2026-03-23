import { expect, type Page } from "@playwright/test";

/**
 * Log in via the API and explicitly set the session cookie on the browser context.
 * Uses cookie extraction rather than relying on implicit page.request cookie sharing,
 * which is unreliable in CI (intermittent failures where the sidebar never appears
 * because the session cookie wasn't sent with page.goto).
 */
export async function login(
  page: Page,
  username = "admin",
  password = "admin123",
) {
  const baseURL = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");

  // Use a standalone fetch-like approach via context request to get session cookie
  const apiContext = page.context().request;
  const response = await apiContext.post(`${baseURL}/api/auth/login`, {
    data: { username, password },
  });

  if (response.status() !== 200) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Login API failed: ${response.status()} ${response.statusText()} — ${body}`,
    );
  }

  // Extract session cookie from response and explicitly add to browser context.
  // This is more reliable than relying on implicit cookie sharing between
  // page.request and the browser, which fails intermittently in CI.
  const setCookieHeaders = response.headersArray().filter(
    (h) => h.name.toLowerCase() === "set-cookie",
  );

  for (const header of setCookieHeaders) {
    const parts = header.value.split(";")[0]; // "connect.sid=s%3A..."
    const [name, ...valueParts] = parts.split("=");
    const value = valueParts.join("="); // rejoin in case value contains =
    await page.context().addCookies([{
      name: name.trim(),
      value,
      url: baseURL,
    }]);
  }

  // Navigate to dashboard with session cookie set
  await page.goto("/");

  // Wait for authenticated app to render (sidebar indicates successful auth)
  await expect(page.locator("[data-testid='sidebar']")).toBeVisible({
    timeout: 15000,
  });

  // Brief wait for sidebar data queries to settle (prevents DOM detachment)
  await page.waitForTimeout(1500);
}
