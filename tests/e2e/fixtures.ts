import { test as base, expect } from "@playwright/test";

/**
 * Custom test fixtures with built-in authentication.
 *
 * Uses page.request.post() for login (matching the pattern from auth.spec.ts).
 * Consumes the response body to ensure cookies are finalized.
 *
 * Import { test, expect } from "./fixtures" instead of "@playwright/test"
 * to get auto-login behavior.
 */

/** Test fixture that logs in as admin before each test */
export const adminTest = base.extend({
  page: async ({ page }, use) => {
    const resp = await page.request.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
    if (resp.status() !== 200) {
      throw new Error(`Admin login failed: ${resp.status()}`);
    }
    await resp.json(); // Consume body to finalize cookie storage
    await use(page);
  },
});

/** Test fixture that logs in as viewer before each test */
export const viewerTest = base.extend({
  page: async ({ page }, use) => {
    const resp = await page.request.post("/api/auth/login", {
      data: { username: "viewer", password: "viewer123" },
    });
    if (resp.status() !== 200) {
      throw new Error(`Viewer login failed: ${resp.status()}`);
    }
    await resp.json(); // Consume body to finalize cookie storage
    await use(page);
  },
});

export { expect };
