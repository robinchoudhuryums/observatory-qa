import { test as base, expect } from "@playwright/test";

/**
 * Custom test fixtures with built-in authentication.
 *
 * Login via browser-native fetch(), then verify the session persists across
 * a full page reload. Includes detailed diagnostics if auth fails.
 *
 * Import { test, expect } from "./fixtures" instead of "@playwright/test"
 * to get auto-login behavior.
 */

async function browserLogin(page: import("@playwright/test").Page, username: string, password: string): Promise<void> {
  // Load the app so we have a JavaScript context in the correct origin
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Login and immediately verify session via /api/auth/me
  const result = await page.evaluate(
    async ({ u, p }) => {
      const loginResp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
        credentials: "include",
      });
      if (!loginResp.ok) return { loginStatus: loginResp.status, meStatus: 0, user: null };

      // Verify session cookie works immediately
      const meResp = await fetch("/api/auth/me", { credentials: "include" });
      const meBody = meResp.ok ? await meResp.json() : null;
      return { loginStatus: loginResp.status, meStatus: meResp.status, user: meBody?.username ?? null };
    },
    { u: username, p: password },
  );

  if (result.loginStatus !== 200) {
    throw new Error(`Login failed for ${username}: HTTP ${result.loginStatus}`);
  }
  if (result.meStatus !== 200) {
    throw new Error(`Session not established for ${username}: /api/auth/me returned ${result.meStatus}`);
  }

  // Full page reload to verify session cookie persists across navigations.
  // This is the critical step: after reload, /api/auth/me must still return 200.
  await page.reload({ waitUntil: "domcontentloaded" });

  // Wait for React to mount and check authenticated state
  const authed = await page.evaluate(async () => {
    const resp = await fetch("/api/auth/me", { credentials: "include" });
    return resp.status;
  });

  if (authed !== 200) {
    const cookies = await page.context().cookies();
    const cookieInfo = cookies.map(c => `${c.name}(secure=${c.secure},sameSite=${c.sameSite},domain=${c.domain})`).join(", ");
    throw new Error(
      `Session lost after reload for ${username}: /api/auth/me returned ${authed}. ` +
      `Cookies: [${cookieInfo}]`
    );
  }

  // Wait for sidebar to appear (proves React rendered authenticated view)
  try {
    await page.waitForSelector("[data-testid='sidebar']", { timeout: 15000 });
  } catch {
    // Capture page state for diagnostics
    const bodySnippet = await page.evaluate(() => document.body.innerText.slice(0, 500));
    const html = await page.evaluate(() => document.querySelector("#root")?.innerHTML?.slice(0, 1000) ?? "(empty)");
    const consoleErrors: string[] = [];
    page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    await page.waitForTimeout(2000);
    throw new Error(
      `Sidebar not found after login+reload for ${username}.\n` +
      `Body text: ${bodySnippet}\n` +
      `Root HTML: ${html}\n` +
      `Console errors: ${consoleErrors.join("; ") || "(none captured)"}`
    );
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
