import { test as base, expect } from "@playwright/test";

/**
 * Custom test fixtures with per-worker org isolation.
 *
 * Each Playwright worker gets its own unique organization, admin user,
 * and viewer user — preventing state pollution between parallel spec files.
 *
 * The fixture registers a fresh org via /api/auth/register on first use,
 * then logs in as admin or viewer for subsequent tests.
 *
 * Import { adminTest as test, expect } from "./fixtures" for admin tests,
 * or { viewerTest as test, expect } for viewer-scoped tests.
 */

// Per-worker org registration state (shared across tests in the same worker)
let workerOrgSlug: string | undefined;
let workerSetupDone = false;

/**
 * Generate a unique org slug per worker to isolate E2E test data.
 * Uses the worker index + timestamp to avoid collisions.
 */
function makeOrgSlug(workerIndex: number): string {
  const ts = Date.now().toString(36).slice(-4);
  return `e2e-w${workerIndex}-${ts}`;
}

/**
 * Register a fresh org + admin user for this worker.
 * Idempotent — only runs once per worker process.
 */
async function ensureWorkerOrg(
  request: any,
  workerIndex: number,
): Promise<{ orgSlug: string; adminUser: string; adminPass: string; viewerUser: string; viewerPass: string }> {
  const orgSlug = makeOrgSlug(workerIndex);
  // /api/auth/register requires the username to be a valid email address
  // (registration.ts EMAIL_REGEX). The local part stays unique per worker so
  // multiple Playwright workers don't collide; the @e2e.test domain is
  // RFC 2606-reserved and never resolves to a real recipient.
  const adminUser = `admin-${orgSlug}@e2e.test`;
  const adminPass = "TestAdmin1234!";
  const viewerUser = `viewer-${orgSlug}@e2e.test`;
  const viewerPass = "TestViewer1234!";

  if (!workerSetupDone || workerOrgSlug !== orgSlug) {
    // Register a new org with an admin user
    const regResp = await request.post("/api/auth/register", {
      data: {
        orgName: `E2E Test Org ${orgSlug}`,
        orgSlug,
        username: adminUser,
        password: adminPass,
        name: "E2E Admin",
        industryType: "general",
      },
    });

    if (regResp.status() !== 201 && regResp.status() !== 200) {
      // Org may already exist from a previous run — try logging in directly
      const loginResp = await request.post("/api/auth/login", {
        data: { username: adminUser, password: adminPass },
      });
      if (loginResp.status() !== 200) {
        const body = await regResp.text();
        throw new Error(`Worker org setup failed: reg=${regResp.status()}, login=${loginResp.status()}, body=${body}`);
      }
    }

    // Logout after registration (registration auto-logs-in)
    await request.post("/api/auth/logout").catch(() => {});

    workerOrgSlug = orgSlug;
    workerSetupDone = true;
  }

  return { orgSlug, adminUser, adminPass, viewerUser, viewerPass };
}

/** Test fixture that logs in as admin in a per-worker isolated org */
export const adminTest = base.extend({
  page: async ({ page }, use, testInfo) => {
    const { adminUser, adminPass } = await ensureWorkerOrg(page.request, testInfo.workerIndex);
    const resp = await page.request.post("/api/auth/login", {
      data: { username: adminUser, password: adminPass },
    });
    if (resp.status() !== 200) {
      // Fall back to the shared env-var admin for backward compat
      const fallback = await page.request.post("/api/auth/login", {
        data: { username: "admin", password: "admin123" },
      });
      if (fallback.status() !== 200) {
        throw new Error(`Admin login failed: ${resp.status()} (isolated), ${fallback.status()} (fallback)`);
      }
      await fallback.json();
    } else {
      await resp.json();
    }
    await use(page);
  },
});

/** Test fixture that logs in as viewer in a per-worker isolated org */
export const viewerTest = base.extend({
  page: async ({ page }, use, testInfo) => {
    // Viewer can't self-register — fall back to env-var viewer
    const resp = await page.request.post("/api/auth/login", {
      data: { username: "viewer", password: "viewer123" },
    });
    if (resp.status() !== 200) {
      throw new Error(`Viewer login failed: ${resp.status()}`);
    }
    await resp.json();
    await use(page);
  },
});

export { expect };
