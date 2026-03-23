import { test as base, expect } from "@playwright/test";

/**
 * Custom test fixtures with built-in authentication.
 *
 * Navigates to the app first, then logs in via the browser's native fetch()
 * inside page.evaluate(). This guarantees cookies are stored in the browser's
 * cookie jar and sent with subsequent page.goto() navigations — avoiding
 * edge-cases where page.request cookies don't sync with the browser context.
 *
 * Import { test, expect } from "./fixtures" instead of "@playwright/test"
 * to get auto-login behavior.
 */

async function browserLogin(page: import("@playwright/test").Page, username: string, password: string): Promise<void> {
  // Load the app so we have a JavaScript context in the correct origin
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Login via browser-native fetch (cookies are set directly in the browser jar)
  const status = await page.evaluate(
    async ({ u, p }) => {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
        credentials: "include",
      });
      return resp.status;
    },
    { u: username, p: password },
  );

  if (status !== 200) {
    throw new Error(`Login failed for ${username}: ${status}`);
  }
}

/** Test fixture that logs in as admin before each test */
export const adminTest = base.extend({
  page: async ({ page }, use) => {
    await browserLogin(page, "admin", "admin123");
    await use(page);
  },
});

/** Test fixture that logs in as viewer before each test */
export const viewerTest = base.extend({
  page: async ({ page }, use) => {
    await browserLogin(page, "viewer", "viewer123");
    await use(page);
  },
});

export { expect };
