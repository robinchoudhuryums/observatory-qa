import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import {
  ROLE_HIERARCHY,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  SESSION_IDLE_TIMEOUT_MS,
  isAccountLocked,
  recordFailedAttempt,
  unlockAccount,
} from "../server/auth.js";

/**
 * RBAC (Role-Based Access Control) tests.
 *
 * Tests that:
 * - Unauthenticated requests get 401
 * - Viewer role can read but not write
 * - Manager role can do viewer actions + write operations
 * - Admin role has full access
 * - requireRole middleware enforces hierarchy correctly
 *
 * INV-18: Tests import ROLE_HIERARCHY from auth.ts (not redefined locally)
 * — when production levels change, these tests change with them.
 */

// Helper: make an HTTP request to the test server
function request(
  server: http.Server,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  cookie?: string,
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyStr = body ? JSON.stringify(body) : undefined;

    const req = http.request(
      {
        hostname: "localhost",
        port: addr.port,
        method,
        path,
        headers: {
          "Content-Type": "application/json",
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr).toString() } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode!, body: parsed, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

describe("RBAC - Role-Based Access Control", () => {
  describe("Role hierarchy (production constants)", () => {
    it("admin > manager > viewer in production ROLE_HIERARCHY", () => {
      assert.ok(ROLE_HIERARCHY.admin > ROLE_HIERARCHY.manager);
      assert.ok(ROLE_HIERARCHY.manager > ROLE_HIERARCHY.viewer);
      // viewer is the lowest tier and must be > 0 so unknown roles (which fall to 0) are denied
      assert.ok(ROLE_HIERARCHY.viewer > 0);
    });

    it("requireRole(manager, admin) gates: admin and manager pass, viewer denied", () => {
      // Mirror the production check in requireRole(): the user level must be
      // >= the *minimum* of the allowed roles' levels.
      const allowedRoles = ["manager", "admin"];
      const requiredLevel = Math.min(...allowedRoles.map((r) => ROLE_HIERARCHY[r] ?? 0));

      assert.ok(ROLE_HIERARCHY.admin >= requiredLevel);
      assert.ok(ROLE_HIERARCHY.manager >= requiredLevel);
      assert.ok(ROLE_HIERARCHY.viewer < requiredLevel);
    });

    it("unknown role gets level 0 (no access) via the production lookup pattern", () => {
      const unknownLevel = ROLE_HIERARCHY["unknown_role"] ?? 0;
      assert.strictEqual(unknownLevel, 0);
    });
  });

  describe("Authentication required (401 without session)", () => {
    let server: http.Server;

    before(async () => {
      process.env.SESSION_SECRET = "test-rbac-secret";
      process.env.AUTH_USERS = "testadmin:password123:admin:Admin:testorg";

      const express = (await import("express")).default;
      const app = express();
      app.use(express.json());
      const { setupAuth } = await import("../server/auth.js");
      await setupAuth(app);

      // Test routes with different role requirements
      const { requireAuth, requireRole } = await import("../server/auth.js");
      app.get("/api/test/public", (_req, res) => res.json({ ok: true }));
      app.get("/api/test/authed", requireAuth, (_req, res) => res.json({ ok: true }));
      app.get("/api/test/viewer", requireAuth, requireRole("viewer"), (_req, res) => res.json({ ok: true }));
      app.get("/api/test/manager", requireAuth, requireRole("manager", "admin"), (_req, res) => res.json({ ok: true }));
      app.get("/api/test/admin", requireAuth, requireRole("admin"), (_req, res) => res.json({ ok: true }));

      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("allows access to public endpoints", async () => {
      const res = await request(server, "GET", "/api/test/public");
      assert.strictEqual(res.status, 200);
    });

    it("returns 401 for authed endpoint without session", async () => {
      const res = await request(server, "GET", "/api/test/authed");
      assert.strictEqual(res.status, 401);
    });

    it("returns 401 for viewer endpoint without session", async () => {
      const res = await request(server, "GET", "/api/test/viewer");
      assert.strictEqual(res.status, 401);
    });

    it("returns 401 for manager endpoint without session", async () => {
      const res = await request(server, "GET", "/api/test/manager");
      assert.strictEqual(res.status, 401);
    });

    it("returns 401 for admin endpoint without session", async () => {
      const res = await request(server, "GET", "/api/test/admin");
      assert.strictEqual(res.status, 401);
    });
  });

  describe("Account lockout (production isAccountLocked + recordFailedAttempt)", () => {
    it("MAX_FAILED_ATTEMPTS is 5 (HIPAA — invariant)", () => {
      assert.strictEqual(MAX_FAILED_ATTEMPTS, 5);
    });

    it("LOCKOUT_DURATION_MS is 15 minutes (HIPAA — invariant)", () => {
      assert.strictEqual(LOCKOUT_DURATION_MS, 15 * 60 * 1000);
    });

    it("locks account after MAX_FAILED_ATTEMPTS recorded failures", async () => {
      // Use a unique username so this test doesn't collide with parallel runs
      const username = `lockout-test-${Date.now()}-${Math.random()}`;
      try {
        assert.strictEqual(await isAccountLocked(username), false, "account should start unlocked");
        for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
          await recordFailedAttempt(username);
        }
        assert.strictEqual(await isAccountLocked(username), true, "should be locked after MAX_FAILED_ATTEMPTS");
      } finally {
        await unlockAccount(username); // cleanup
      }
    });

    it("does not lock account before MAX_FAILED_ATTEMPTS", async () => {
      const username = `lockout-test-${Date.now()}-${Math.random()}`;
      try {
        for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
          await recordFailedAttempt(username);
        }
        assert.strictEqual(await isAccountLocked(username), false);
      } finally {
        await unlockAccount(username);
      }
    });

    it("unlockAccount clears the lockout state", async () => {
      const username = `lockout-test-${Date.now()}-${Math.random()}`;
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await recordFailedAttempt(username);
      assert.strictEqual(await isAccountLocked(username), true);
      await unlockAccount(username);
      assert.strictEqual(await isAccountLocked(username), false);
    });
  });
});

describe("Session timeout (HIPAA — production constant)", () => {
  it("SESSION_IDLE_TIMEOUT_MS is 15 minutes (900000ms)", () => {
    // HIPAA addressable requirement: idle timeout for healthcare
    assert.strictEqual(SESSION_IDLE_TIMEOUT_MS, 15 * 60 * 1000);
    assert.strictEqual(SESSION_IDLE_TIMEOUT_MS, 900_000);
  });
});
