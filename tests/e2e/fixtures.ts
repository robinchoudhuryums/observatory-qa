import { test as base, expect } from "@playwright/test";

/**
 * Custom test fixtures with built-in authentication.
 *
 * Uses page.request.post() for login (matching auth.spec.ts pattern that works),
 * then navigates to "/" to verify the authenticated view renders.
 */

/** Test fixture that logs in as admin before each test */
export const adminTest = base.extend({
  page: async ({ page }, use) => {
    // Capture console errors for diagnostics
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => {
      consoleErrors.push(`PAGE_ERROR: ${err.name}: ${err.message}`);
    });

    // Login using page.request (shares cookies with browser context)
    // IMPORTANT: Must consume response body (json()) — Playwright may defer
    // cookie storage until the response is fully consumed.
    const resp = await page.request.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
    if (resp.status() !== 200) {
      throw new Error(`Admin login failed: ${resp.status()}`);
    }
    const loginBody = await resp.json();
    if (!loginBody.username) {
      throw new Error(`Admin login response missing username: ${JSON.stringify(loginBody)}`);
    }

    // Navigate and wait for authenticated view
    await page.goto("/");
    try {
      await page.waitForSelector("[data-testid='sidebar']", { timeout: 15000 });
    } catch {
      await page.waitForTimeout(1000);
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
      const html = await page.evaluate(() => document.querySelector("#root")?.innerHTML?.slice(0, 2000) ?? "(empty)");
      const cookies = await page.context().cookies();
      const cookieInfo = cookies.map(c => `${c.name}(secure=${c.secure},httpOnly=${c.httpOnly})`).join(", ");
      throw new Error(
        `Sidebar not found after admin login.\n` +
        `Console errors: ${consoleErrors.join(" | ") || "(none)"}\n` +
        `Cookies: [${cookieInfo}]\n` +
        `Body: ${bodyText}\n` +
        `HTML: ${html}`
      );
    }

    await use(page);
  },
});

/** Test fixture that logs in as viewer before each test */
export const viewerTest = base.extend({
  page: async ({ page }, use) => {
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => {
      consoleErrors.push(`PAGE_ERROR: ${err.name}: ${err.message}`);
    });

    const resp = await page.request.post("/api/auth/login", {
      data: { username: "viewer", password: "viewer123" },
    });
    if (resp.status() !== 200) {
      throw new Error(`Viewer login failed: ${resp.status()}`);
    }
    await resp.json(); // Consume body to finalize cookie storage

    await page.goto("/");
    try {
      await page.waitForSelector("[data-testid='sidebar']", { timeout: 15000 });
    } catch {
      await page.waitForTimeout(1000);
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
      const html = await page.evaluate(() => document.querySelector("#root")?.innerHTML?.slice(0, 2000) ?? "(empty)");
      const cookies = await page.context().cookies();
      const cookieInfo = cookies.map(c => `${c.name}(secure=${c.secure},httpOnly=${c.httpOnly})`).join(", ");
      throw new Error(
        `Sidebar not found after viewer login.\n` +
        `Console errors: ${consoleErrors.join(" | ") || "(none)"}\n` +
        `Cookies: [${cookieInfo}]\n` +
        `Body: ${bodyText}\n` +
        `HTML: ${html}`
      );
    }

    await use(page);
  },
});

export { expect };
