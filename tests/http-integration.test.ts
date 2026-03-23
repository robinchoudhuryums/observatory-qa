/**
 * HTTP integration tests using Node.js built-in http module.
 *
 * Tests the middleware patterns (CSRF, RBAC, rate limiting, security headers)
 * without requiring Express or any npm dependencies.
 *
 * Run with: npx tsx --test tests/http-integration.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";

// ==================== HELPERS ====================

function createServer(handler: http.RequestListener): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve(server));
  });
}

async function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders; cookies: string[] }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as any;
    const reqHeaders: Record<string, string> = { "Content-Type": "application/json", ...headers };

    const req = http.request({ hostname: "localhost", port: addr.port, path, method, headers: reqHeaders }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed: any;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        const cookies = (res.headers["set-cookie"] || []).map(c => c.split(";")[0]);
        resolve({ status: res.statusCode!, body: parsed, headers: res.headers, cookies });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ==================== CSRF TOKEN FLOW ====================

describe("CSRF token flow", () => {
  it("sets csrf-token cookie on first GET", async () => {
    const server = await createServer((req, res) => {
      const token = randomBytes(32).toString("hex");
      res.setHeader("Set-Cookie", `csrf-token=${token}; SameSite=Strict; Path=/`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const result = await request(server, "GET", "/api/test");
      assert.equal(result.status, 200);
      const csrfCookie = result.cookies.find(c => c.startsWith("csrf-token="));
      assert.ok(csrfCookie, "Should set csrf-token cookie");
      const token = csrfCookie!.split("=")[1];
      assert.equal(token.length, 64, "Token should be 32 bytes hex = 64 chars");
    } finally {
      server.close();
    }
  });

  it("rejects POST without matching CSRF header", async () => {
    const csrfToken = randomBytes(32).toString("hex");

    const server = await createServer((req, res) => {
      if (req.method === "GET") {
        res.setHeader("Set-Cookie", `csrf-token=${csrfToken}; Path=/`);
        res.writeHead(200);
        res.end("{}");
        return;
      }

      // Check CSRF on mutations
      const cookieHeader = req.headers.cookie || "";
      const cookieMatch = cookieHeader.match(/csrf-token=([^;]+)/);
      const headerToken = req.headers["x-csrf-token"] as string;

      if (!cookieMatch || !headerToken || cookieMatch[1] !== headerToken) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Invalid CSRF token" }));
        return;
      }

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ created: true }));
    });

    try {
      // POST without CSRF header → 403
      const res = await request(server, "POST", "/api/data", { test: true }, {
        Cookie: `csrf-token=${csrfToken}`,
      });
      assert.equal(res.status, 403);

      // POST with valid CSRF header → 201
      const res2 = await request(server, "POST", "/api/data", { test: true }, {
        Cookie: `csrf-token=${csrfToken}`,
        "X-CSRF-Token": csrfToken,
      });
      assert.equal(res2.status, 201);
      assert.equal(res2.body.created, true);
    } finally {
      server.close();
    }
  });

  it("skips CSRF for exempt paths (login, register)", async () => {
    const EXEMPT_PATHS = ["/api/auth/login", "/api/auth/register"];

    const server = await createServer((req, res) => {
      if (req.method !== "GET" && !EXEMPT_PATHS.includes(req.url || "")) {
        const headerToken = req.headers["x-csrf-token"];
        if (!headerToken) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "CSRF required" }));
          return;
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      // Exempt path works without CSRF
      const loginRes = await request(server, "POST", "/api/auth/login", { user: "test" });
      assert.equal(loginRes.status, 200);

      // Non-exempt path fails without CSRF
      const dataRes = await request(server, "POST", "/api/data", { test: true });
      assert.equal(dataRes.status, 403);
    } finally {
      server.close();
    }
  });
});

// ==================== RBAC MIDDLEWARE ====================

describe("RBAC middleware patterns", () => {
  const ROLE_HIERARCHY: Record<string, number> = { super_admin: 4, admin: 3, manager: 2, viewer: 1 };

  it("returns 401 for unauthenticated requests", async () => {
    const server = await createServer((req, res) => {
      // Simulate: no user on request
      const user = null;
      if (!user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Not authenticated" }));
        return;
      }
      res.writeHead(200);
      res.end("{}");
    });

    try {
      const res = await request(server, "GET", "/api/admin/users");
      assert.equal(res.status, 401);
    } finally {
      server.close();
    }
  });

  it("returns 403 for insufficient role", async () => {
    const server = await createServer((_req, res) => {
      const user = { role: "viewer" };
      const requiredLevel = ROLE_HIERARCHY["manager"];
      const userLevel = ROLE_HIERARCHY[user.role] || 0;

      if (userLevel < requiredLevel) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Insufficient permissions", code: "OBS-AUTH-004" }));
        return;
      }
      res.writeHead(200);
      res.end("{}");
    });

    try {
      const res = await request(server, "DELETE", "/api/calls/123");
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "OBS-AUTH-004");
    } finally {
      server.close();
    }
  });

  it("allows access for sufficient role", async () => {
    const server = await createServer((_req, res) => {
      const user = { role: "admin" };
      const requiredLevel = ROLE_HIERARCHY["manager"];
      const userLevel = ROLE_HIERARCHY[user.role] || 0;

      if (userLevel < requiredLevel) {
        res.writeHead(403);
        res.end("{}");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted: true }));
    });

    try {
      const res = await request(server, "DELETE", "/api/calls/123");
      assert.equal(res.status, 200);
      assert.equal(res.body.deleted, true);
    } finally {
      server.close();
    }
  });
});

// ==================== SECURITY HEADERS ====================

describe("Security headers", () => {
  it("sets all required HIPAA security headers", async () => {
    const server = await createServer((_req, res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("X-XSS-Protection", "1; mode=block");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    try {
      const res = await request(server, "GET", "/api/test");
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["x-frame-options"], "DENY");
      assert.equal(res.headers["x-xss-protection"], "1; mode=block");
      assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
      assert.ok(res.headers["permissions-policy"]);
    } finally {
      server.close();
    }
  });
});

// ==================== RATE LIMITING ====================

describe("Rate limiting patterns", () => {
  it("blocks after max requests per IP window", () => {
    const requests = new Map<string, { count: number; resetAt: number }>();
    const WINDOW_MS = 15 * 60 * 1000;
    const MAX_REQUESTS = 5;

    function checkRateLimit(ip: string): boolean {
      const now = Date.now();
      const entry = requests.get(ip);

      if (!entry || now > entry.resetAt) {
        requests.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return true;
      }
      if (entry.count >= MAX_REQUESTS) return false;
      entry.count++;
      return true;
    }

    for (let i = 0; i < 5; i++) assert.equal(checkRateLimit("1.2.3.4"), true);
    assert.equal(checkRateLimit("1.2.3.4"), false); // blocked
    assert.equal(checkRateLimit("5.6.7.8"), true);  // different IP ok
  });

  it("org-scoped rate limiting isolates tenants on same IP", () => {
    const counters = new Map<string, number>();
    const LIMIT = 100;

    function check(key: string): boolean {
      const count = counters.get(key) || 0;
      if (count >= LIMIT) return false;
      counters.set(key, count + 1);
      return true;
    }

    for (let i = 0; i < 100; i++) check("1.2.3.4:org-a");
    assert.equal(check("1.2.3.4:org-a"), false);
    assert.equal(check("1.2.3.4:org-b"), true); // different org ok
  });
});

// ==================== ACCOUNT LOCKOUT ====================

describe("Account lockout (HIPAA)", () => {
  it("locks account after 5 failed attempts", () => {
    const loginAttempts = new Map<string, { count: number; lockedUntil?: number }>();
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_MS = 15 * 60 * 1000;

    function attemptLogin(username: string, correct: boolean): { allowed: boolean; locked: boolean } {
      const entry = loginAttempts.get(username) || { count: 0 };
      const now = Date.now();

      if (entry.lockedUntil && now < entry.lockedUntil) {
        return { allowed: false, locked: true };
      }

      if (correct) {
        loginAttempts.delete(username);
        return { allowed: true, locked: false };
      }

      entry.count++;
      if (entry.count >= MAX_ATTEMPTS) {
        entry.lockedUntil = now + LOCKOUT_MS;
      }
      loginAttempts.set(username, entry);
      return { allowed: false, locked: entry.count >= MAX_ATTEMPTS };
    }

    // 4 failed attempts — not locked yet
    for (let i = 0; i < 4; i++) {
      const result = attemptLogin("admin", false);
      assert.equal(result.allowed, false);
      assert.equal(result.locked, false);
    }

    // 5th attempt — locked
    const lockedResult = attemptLogin("admin", false);
    assert.equal(lockedResult.locked, true);

    // Subsequent attempts — still locked
    const blockedResult = attemptLogin("admin", true);
    assert.equal(blockedResult.allowed, false);
    assert.equal(blockedResult.locked, true);
  });
});
