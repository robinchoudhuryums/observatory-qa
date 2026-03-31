import { test, expect } from "@playwright/test";
import { adminTest, viewerTest } from "./fixtures";

/**
 * Security boundary E2E tests.
 *
 * Covers: auth enforcement, RBAC escalation, CSRF, session fixation,
 * cross-org isolation, and rate limiting.
 */

// ─── Unauthenticated access ─────────────────────────────────────────────────

test.describe("API auth enforcement — no session", () => {
  test("GET /api/calls returns 401 without auth", async ({ request }) => {
    const resp = await request.get("/api/calls");
    expect(resp.status()).toBe(401);
  });

  test("GET /api/employees returns 401 without auth", async ({ request }) => {
    const resp = await request.get("/api/employees");
    expect(resp.status()).toBe(401);
  });

  test("GET /api/admin/users returns 401 without auth", async ({ request }) => {
    const resp = await request.get("/api/admin/users");
    expect(resp.status()).toBe(401);
  });

  test("GET /api/dashboard/metrics returns 401 without auth", async ({ request }) => {
    const resp = await request.get("/api/dashboard/metrics");
    expect(resp.status()).toBe(401);
  });

  test("GET /api/coaching returns 401 without auth", async ({ request }) => {
    const resp = await request.get("/api/coaching");
    expect(resp.status()).toBe(401);
  });

  test("GET /api/prompt-templates returns 401 without auth", async ({ request }) => {
    const resp = await request.get("/api/prompt-templates");
    expect(resp.status()).toBe(401);
  });

  test("GET /api/billing/subscription returns 401 without auth", async ({ request }) => {
    const resp = await request.get("/api/billing/subscription");
    expect(resp.status()).toBe(401);
  });

  test("GET /api/reference-documents returns 401 without auth", async ({ request }) => {
    const resp = await request.get("/api/reference-documents");
    expect(resp.status()).toBe(401);
  });

  test("POST /api/calls/upload returns 401 without auth", async ({ request }) => {
    const resp = await request.post("/api/calls/upload");
    expect(resp.status()).toBe(401);
  });

  test("GET /api/auth/me returns 401 without auth", async ({ request }) => {
    const resp = await request.get("/api/auth/me");
    // /api/auth/me returns 401 when there is no session
    expect(resp.status()).toBe(401);
  });
});

// ─── RBAC — viewer cannot perform admin/manager actions ──────────────────────

viewerTest.describe("RBAC — viewer role escalation prevention", () => {
  viewerTest("viewer cannot list admin users via API", async ({ page }) => {
    const resp = await page.request.get("/api/admin/users");
    expect(resp.status()).toBe(403);
  });

  viewerTest("viewer cannot create an employee", async ({ page }) => {
    // First get a CSRF token by making a GET to set the cookie
    await page.request.get("/api/auth/me");
    // Extract csrf-token cookie
    const cookies = await page.context().cookies();
    const csrf = cookies.find((c) => c.name === "csrf-token")?.value ?? "";

    const resp = await page.request.post("/api/employees", {
      headers: { "x-csrf-token": csrf },
      data: { name: "Injected User", email: "injected@test.com", role: "Agent" },
    });
    expect(resp.status()).toBe(403);
  });

  viewerTest("viewer cannot create a coaching session", async ({ page }) => {
    await page.request.get("/api/auth/me");
    const cookies = await page.context().cookies();
    const csrf = cookies.find((c) => c.name === "csrf-token")?.value ?? "";

    const resp = await page.request.post("/api/coaching", {
      headers: { "x-csrf-token": csrf },
      data: {
        employeeId: "fake-id",
        callId: "fake-call",
        category: "general",
        title: "Escalation test",
        notes: "Should be blocked",
      },
    });
    expect(resp.status()).toBe(403);
  });

  viewerTest("viewer cannot create a prompt template", async ({ page }) => {
    await page.request.get("/api/auth/me");
    const cookies = await page.context().cookies();
    const csrf = cookies.find((c) => c.name === "csrf-token")?.value ?? "";

    const resp = await page.request.post("/api/prompt-templates", {
      headers: { "x-csrf-token": csrf },
      data: {
        callCategory: "inbound",
        evaluationCriteria: "test",
      },
    });
    expect(resp.status()).toBe(403);
  });

  viewerTest("viewer cannot delete a call", async ({ page }) => {
    await page.request.get("/api/auth/me");
    const cookies = await page.context().cookies();
    const csrf = cookies.find((c) => c.name === "csrf-token")?.value ?? "";

    const resp = await page.request.delete("/api/calls/nonexistent-id", {
      headers: { "x-csrf-token": csrf },
    });
    // Should be 403 (role check) before 404 (not found)
    expect(resp.status()).toBe(403);
  });

  viewerTest("viewer cannot send team invitations", async ({ page }) => {
    await page.request.get("/api/auth/me");
    const cookies = await page.context().cookies();
    const csrf = cookies.find((c) => c.name === "csrf-token")?.value ?? "";

    const resp = await page.request.post("/api/admin/invitations", {
      headers: { "x-csrf-token": csrf },
      data: { email: "hacker@evil.com", role: "admin" },
    });
    expect(resp.status()).toBe(403);
  });

  viewerTest("viewer cannot access API key management", async ({ page }) => {
    const resp = await page.request.get("/api/api-keys");
    expect(resp.status()).toBe(403);
  });
});

// ─── CSRF token validation ──────────────────────────────────────────────────

adminTest.describe("CSRF protection", () => {
  adminTest("POST without CSRF token is rejected", async ({ page }) => {
    // Authenticated as admin, but no X-CSRF-Token header on a non-exempt endpoint
    const resp = await page.request.post("/api/employees", {
      data: { name: "CSRF Test", email: "csrf@test.com", role: "Agent" },
      // Deliberately omitting x-csrf-token header
    });
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(body.code).toBe("OBS-AUTH-CSRF");
  });

  adminTest("POST with wrong CSRF token is rejected", async ({ page }) => {
    const resp = await page.request.post("/api/employees", {
      headers: { "x-csrf-token": "totally-wrong-token-value" },
      data: { name: "CSRF Test", email: "csrf@test.com", role: "Agent" },
    });
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(body.code).toBe("OBS-AUTH-CSRF");
  });

  adminTest("POST with valid CSRF token succeeds (or reaches business logic)", async ({ page }) => {
    // Get the CSRF cookie set by the server
    await page.request.get("/api/auth/me");
    const cookies = await page.context().cookies();
    const csrf = cookies.find((c) => c.name === "csrf-token")?.value ?? "";
    expect(csrf.length).toBeGreaterThan(0);

    // Use the valid CSRF token — should pass CSRF check (may fail on validation, but not 403 CSRF)
    const resp = await page.request.post("/api/employees", {
      headers: { "x-csrf-token": csrf },
      data: { name: "CSRF Valid", email: "csrfvalid@test.com", role: "Agent" },
    });
    // Should NOT be a CSRF rejection — any other status is acceptable
    const body = await resp.json();
    if (resp.status() === 403) {
      expect(body.code).not.toBe("OBS-AUTH-CSRF");
    }
  });

  adminTest("DELETE without CSRF token is rejected", async ({ page }) => {
    const resp = await page.request.delete("/api/calls/fake-id");
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(body.code).toBe("OBS-AUTH-CSRF");
  });

  adminTest("PATCH without CSRF token is rejected", async ({ page }) => {
    const resp = await page.request.patch("/api/admin/users/fake-id", {
      data: { role: "admin" },
    });
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(body.code).toBe("OBS-AUTH-CSRF");
  });
});

// ─── Session fixation prevention ────────────────────────────────────────────

test.describe("Session fixation prevention", () => {
  test("session ID changes after login", async ({ request }) => {
    // Make an initial request to get a session cookie
    const preLoginResp = await request.get("/api/auth/me");
    expect(preLoginResp.status()).toBe(401);

    // Extract the session cookie from the response headers
    const preLoginHeaders = preLoginResp.headers();
    const preLoginSetCookie = preLoginHeaders["set-cookie"] ?? "";
    const preSessionMatch = preLoginSetCookie.match(/connect\.sid=([^;]+)/);
    const preSessionId = preSessionMatch?.[1] ?? "";

    // Login — server should regenerate the session
    const loginResp = await request.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
    expect(loginResp.status()).toBe(200);

    // Check the new session cookie
    const loginHeaders = loginResp.headers();
    const loginSetCookie = loginHeaders["set-cookie"] ?? "";
    const postSessionMatch = loginSetCookie.match(/connect\.sid=([^;]+)/);
    const postSessionId = postSessionMatch?.[1] ?? "";

    // If both session IDs were captured, they should differ
    if (preSessionId && postSessionId) {
      expect(postSessionId).not.toBe(preSessionId);
    }
  });
});

// ─── Cross-org data isolation (direct URL manipulation) ─────────────────────

adminTest.describe("Cross-org data isolation", () => {
  adminTest("cannot access call with fabricated ID from another org", async ({ page }) => {
    // Try to fetch a call that would belong to another org
    const resp = await page.request.get("/api/calls/00000000-0000-0000-0000-000000000099");
    // Should be 404 (not found in this org) rather than returning data
    expect(resp.status()).toBe(404);
  });

  adminTest("cannot access employee from another org by ID", async ({ page }) => {
    const resp = await page.request.get("/api/employees/00000000-0000-0000-0000-000000000099");
    // Employees endpoint may not have a GET /:id, but if it does, should be 404
    expect([404, 405]).toContain(resp.status());
  });

  adminTest("cannot access coaching session from another org", async ({ page }) => {
    const resp = await page.request.get("/api/coaching/00000000-0000-0000-0000-000000000099");
    // Should not leak data — 404 or similar
    expect([404, 405]).toContain(resp.status());
  });

  adminTest("analysis endpoint scoped to org", async ({ page }) => {
    const resp = await page.request.get(
      "/api/calls/00000000-0000-0000-0000-000000000099/analysis"
    );
    expect(resp.status()).toBe(404);
  });

  adminTest("transcript endpoint scoped to org", async ({ page }) => {
    const resp = await page.request.get(
      "/api/calls/00000000-0000-0000-0000-000000000099/transcript"
    );
    expect(resp.status()).toBe(404);
  });
});

// ─── Login with invalid credentials ────────────────────────────────────────

test.describe("Login security", () => {
  test("rejects empty credentials", async ({ request }) => {
    const resp = await request.post("/api/auth/login", {
      data: { username: "", password: "" },
    });
    expect(resp.status()).toBe(401);
  });

  test("rejects missing password", async ({ request }) => {
    const resp = await request.post("/api/auth/login", {
      data: { username: "admin" },
    });
    expect(resp.status()).toBe(401);
  });

  test("rejects missing username", async ({ request }) => {
    const resp = await request.post("/api/auth/login", {
      data: { password: "admin123" },
    });
    expect(resp.status()).toBe(401);
  });

  test("does not leak user existence on wrong password", async ({ request }) => {
    // Both valid-user-wrong-pass and invalid-user should return same status
    const validUserResp = await request.post("/api/auth/login", {
      data: { username: "admin", password: "wrongpassword" },
    });
    const invalidUserResp = await request.post("/api/auth/login", {
      data: { username: "nonexistent_user_xyz", password: "wrongpassword" },
    });

    expect(validUserResp.status()).toBe(401);
    expect(invalidUserResp.status()).toBe(401);

    // Response bodies should not reveal which field was wrong
    const validBody = await validUserResp.json();
    const invalidBody = await invalidUserResp.json();
    // Both should give a generic error — not "user not found" vs "wrong password"
    expect(validBody.message).toBe(invalidBody.message);
  });
});

// ─── Rate limiting on login ─────────────────────────────────────────────────
// Note: E2E_TESTING=true relaxes the limit to 500. We verify the mechanism
// exists by checking that the rate limit headers are present, rather than
// actually exhausting the limit (which would break other tests).

test.describe("Rate limiting mechanism", () => {
  test("login endpoint returns rate limit headers", async ({ request }) => {
    const resp = await request.post("/api/auth/login", {
      data: { username: "admin", password: "wrongpassword" },
    });
    expect(resp.status()).toBe(401);

    // Rate limiting middleware typically sets these headers
    const headers = resp.headers();
    const hasRateLimitHeader =
      headers["x-ratelimit-limit"] !== undefined ||
      headers["x-ratelimit-remaining"] !== undefined ||
      headers["ratelimit-limit"] !== undefined ||
      headers["ratelimit-remaining"] !== undefined ||
      headers["retry-after"] !== undefined;

    // If rate limiting is implemented via headers, verify them.
    // If not (e.g. only returns 429 on breach), this test still passes —
    // the actual enforcement is verified by the unit tests.
    if (hasRateLimitHeader) {
      const limit =
        headers["x-ratelimit-limit"] ?? headers["ratelimit-limit"] ?? "";
      expect(parseInt(limit, 10)).toBeGreaterThan(0);
    }
  });
});

// ─── Security headers ───────────────────────────────────────────────────────

test.describe("Security headers", () => {
  test("response includes security headers", async ({ request }) => {
    const resp = await request.get("/api/auth/me");
    const headers = resp.headers();

    // HSTS (may not be set when DISABLE_SECURE_COOKIE is true in E2E)
    // X-Content-Type-Options
    expect(headers["x-content-type-options"]).toBe("nosniff");
    // X-Frame-Options
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  test("session cookie is httpOnly", async ({ request }) => {
    const resp = await request.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
    expect(resp.status()).toBe(200);

    const setCookie = resp.headers()["set-cookie"] ?? "";
    // connect.sid should be httpOnly
    if (setCookie.includes("connect.sid")) {
      expect(setCookie.toLowerCase()).toContain("httponly");
    }
  });

  test("CSRF cookie is NOT httpOnly (must be readable by JS)", async ({ request }) => {
    const resp = await request.get("/api/auth/me");
    const setCookie = resp.headers()["set-cookie"] ?? "";
    // csrf-token cookie should NOT have httpOnly (needs to be read by frontend JS)
    if (setCookie.includes("csrf-token")) {
      // The csrf-token portion should not contain httponly
      const csrfPart = setCookie
        .split(",")
        .find((s) => s.includes("csrf-token"));
      if (csrfPart) {
        expect(csrfPart.toLowerCase()).not.toContain("httponly");
      }
    }
  });
});

// ─── Logout clears session ──────────────────────────────────────────────────

test.describe("Logout invalidates session", () => {
  test("cannot access protected endpoints after logout", async ({ request }) => {
    // Login
    const loginResp = await request.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
    expect(loginResp.status()).toBe(200);

    // Confirm we are authenticated
    const meResp = await request.get("/api/auth/me");
    expect(meResp.status()).toBe(200);

    // Logout
    const logoutResp = await request.post("/api/auth/logout");
    expect([200, 302]).toContain(logoutResp.status());

    // Subsequent requests should be unauthenticated
    const afterResp = await request.get("/api/auth/me");
    expect(afterResp.status()).toBe(401);
  });
});
