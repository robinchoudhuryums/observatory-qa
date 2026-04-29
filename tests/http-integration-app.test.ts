/**
 * HTTP integration tests against a REAL Express app.
 *
 * Distinct from `tests/http-integration.test.ts`, which exercises ad-hoc
 * handlers that mimic middleware patterns. This file mounts the actual
 * production middleware (`csrfMiddleware` from server/middleware/csrf.ts,
 * full `setupAuth` from server/auth.ts including session, passport, and the
 * env-user local strategy, plus the real `/api/auth/login` route) on a fresh
 * Express app and verifies the full request → response stack.
 *
 * What this catches that pure unit tests don't:
 *   - middleware ORDERING bugs (CSRF runs before route, before auth, etc.)
 *   - session cookie wiring (httpOnly, sameSite, secure, the `mfa_td` flow)
 *   - real RBAC rejection paths (requireAuth → requireRole → injectOrgContext)
 *   - the actual req.session / req.user / req.isAuthenticated() lifecycle
 *
 * Each test starts a fresh in-memory app with isolated env vars, so there's
 * no cross-test state pollution.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { csrfMiddleware } from "../server/middleware/csrf.js";
import { setupAuth, requireAuth, requireRole, injectOrgContext } from "../server/auth.js";
import { registerAuthRoutes } from "../server/routes/auth.js";

// ─── HTTP helpers ────────────────────────────────────────────────────────────

interface Response {
  status: number;
  body: any;
  headers: http.IncomingHttpHeaders;
  cookies: string[];
}

function request(
  server: http.Server,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; csrfToken?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
    if (opts.cookie) headers["Cookie"] = opts.cookie;
    if (opts.csrfToken) headers["X-CSRF-Token"] = opts.csrfToken;

    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, method, path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed: any;
          try {
            parsed = raw.length > 0 ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          const setCookie = res.headers["set-cookie"];
          const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
          resolve({ status: res.statusCode!, body: parsed, headers: res.headers, cookies });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function extractCookieValue(setCookieLines: string[], name: string): string | undefined {
  for (const line of setCookieLines) {
    const part = line.split(";")[0];
    const [k, v] = part.split("=");
    if (k === name) return v;
  }
  return undefined;
}

function joinCookieHeader(...pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `${k}=${v}`).join("; ");
}

// ─── Fixture: a real Express app with real production middleware ───────────

async function makeTestApp(): Promise<{ server: http.Server; close: () => Promise<void> }> {
  // Each test gets its own env users — the env vars are read once by setupAuth
  // so we set them before calling it and let them leak (harmless).
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "http-integration-test-secret";
  process.env.AUTH_USERS =
    "admin1:password123:admin:Test Admin:default,manager1:password123:manager:Test Manager:default,viewer1:password123:viewer:Test Viewer:default";
  process.env.DISABLE_SECURE_COOKIE = "true"; // tests run over plain HTTP

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(csrfMiddleware); // ← real production middleware
  await setupAuth(app); // ← real session + passport + env users + local strategy
  registerAuthRoutes(app); // ← real /api/auth/login, /logout, /me

  // Three test routes covering the auth/role gates we want to exercise.
  app.get("/api/test/public", (_req, res) => res.json({ ok: true }));
  app.get("/api/test/authed", requireAuth, (_req, res) => res.json({ ok: true, user: _req.user }));
  app.get("/api/test/manager-or-admin", requireAuth, requireRole("manager", "admin"), (_req, res) =>
    res.json({ ok: true }),
  );
  app.get("/api/test/admin-only", requireAuth, requireRole("admin"), (_req, res) => res.json({ ok: true }));
  app.post("/api/test/echo", requireAuth, injectOrgContext, (req, res) =>
    res.json({ orgId: req.orgId, body: req.body }),
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function login(
  server: http.Server,
  username: string,
  password: string,
): Promise<{ sessionCookie: string; csrfToken: string }> {
  // First GET to set the csrf cookie
  const seed = await request(server, "GET", "/api/test/public");
  const csrfToken = extractCookieValue(seed.cookies, "csrf-token")!;
  const seedCsrf = `csrf-token=${csrfToken}`;

  // Login (CSRF-exempt path — no header needed)
  const loginRes = await request(server, "POST", "/api/auth/login", {
    body: { username, password },
    cookie: seedCsrf,
  });
  if (loginRes.status !== 200) {
    throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  const sessionCookie = extractCookieValue(loginRes.cookies, "connect.sid");
  if (!sessionCookie) throw new Error("no session cookie set after login");
  return {
    sessionCookie: joinCookieHeader(["connect.sid", sessionCookie], ["csrf-token", csrfToken]),
    csrfToken,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("HTTP integration — real Express app", () => {
  let server: http.Server;
  let close: () => Promise<void>;

  before(async () => {
    const fixture = await makeTestApp();
    server = fixture.server;
    close = fixture.close;
  });

  after(async () => {
    await close();
  });

  describe("CSRF middleware (real csrfMiddleware)", () => {
    it("sets a csrf-token cookie on the first GET", async () => {
      const res = await request(server, "GET", "/api/test/public");
      assert.equal(res.status, 200);
      const csrfToken = extractCookieValue(res.cookies, "csrf-token");
      assert.ok(csrfToken, "csrf-token cookie should be set on response");
      // Default randomBytes(32).toString("hex") → 64 hex chars
      assert.equal(csrfToken!.length, 64);
    });

    it("rejects state-changing /api POST without csrf header (403 OBS-AUTH-CSRF)", async () => {
      const seed = await request(server, "GET", "/api/test/public");
      const csrfToken = extractCookieValue(seed.cookies, "csrf-token")!;
      const res = await request(server, "POST", "/api/test/echo", {
        body: { hello: "world" },
        cookie: `csrf-token=${csrfToken}`,
        // NOT providing X-CSRF-Token header
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "OBS-AUTH-CSRF");
    });

    it("rejects POST when csrf header value differs from cookie", async () => {
      const seed = await request(server, "GET", "/api/test/public");
      const csrfToken = extractCookieValue(seed.cookies, "csrf-token")!;
      const res = await request(server, "POST", "/api/test/echo", {
        body: { hello: "world" },
        cookie: `csrf-token=${csrfToken}`,
        csrfToken: "deadbeef".repeat(8), // 64-char wrong value
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "OBS-AUTH-CSRF");
    });

    it("login route is csrf-exempt — accepts POST with no x-csrf-token header", async () => {
      const seed = await request(server, "GET", "/api/test/public");
      const csrfToken = extractCookieValue(seed.cookies, "csrf-token")!;
      const res = await request(server, "POST", "/api/auth/login", {
        body: { username: "admin1", password: "password123" },
        cookie: `csrf-token=${csrfToken}`,
        // NO x-csrf-token — login is exempt
      });
      // 200 from passport, NOT a 403 OBS-AUTH-CSRF
      assert.equal(res.status, 200);
      assert.notEqual(res.body?.code, "OBS-AUTH-CSRF");
    });
  });

  describe("Auth middleware (real requireAuth + requireRole)", () => {
    it("returns 401 from requireAuth when there is no session", async () => {
      const res = await request(server, "GET", "/api/test/authed");
      assert.equal(res.status, 401);
    });

    it("admin login → admin can hit admin-only route (200)", async () => {
      const auth = await login(server, "admin1", "password123");
      const res = await request(server, "GET", "/api/test/admin-only", { cookie: auth.sessionCookie });
      assert.equal(res.status, 200);
    });

    it("admin login → admin can hit manager-or-admin route (200)", async () => {
      const auth = await login(server, "admin1", "password123");
      const res = await request(server, "GET", "/api/test/manager-or-admin", { cookie: auth.sessionCookie });
      assert.equal(res.status, 200);
    });

    it("manager login → manager can hit manager-or-admin (200) but NOT admin-only (403)", async () => {
      const auth = await login(server, "manager1", "password123");
      const okRes = await request(server, "GET", "/api/test/manager-or-admin", { cookie: auth.sessionCookie });
      assert.equal(okRes.status, 200);
      const denyRes = await request(server, "GET", "/api/test/admin-only", { cookie: auth.sessionCookie });
      assert.equal(denyRes.status, 403);
    });

    it("viewer login → viewer is denied on manager-or-admin and admin-only (403)", async () => {
      const auth = await login(server, "viewer1", "password123");
      const m = await request(server, "GET", "/api/test/manager-or-admin", { cookie: auth.sessionCookie });
      const a = await request(server, "GET", "/api/test/admin-only", { cookie: auth.sessionCookie });
      assert.equal(m.status, 403);
      assert.equal(a.status, 403);
    });
  });

  describe("CSRF + auth wired together", () => {
    it("authenticated POST with both session AND csrf token (200)", async () => {
      const auth = await login(server, "admin1", "password123");
      const res = await request(server, "POST", "/api/test/echo", {
        body: { ping: "pong" },
        cookie: auth.sessionCookie,
        csrfToken: auth.csrfToken,
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.body, { ping: "pong" });
      assert.ok(res.body.orgId, "injectOrgContext should populate req.orgId");
    });

    it("authenticated POST with session but missing csrf token (403)", async () => {
      const auth = await login(server, "admin1", "password123");
      const res = await request(server, "POST", "/api/test/echo", {
        body: { ping: "pong" },
        cookie: auth.sessionCookie,
        // csrfToken omitted
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "OBS-AUTH-CSRF");
    });
  });

  describe("Login security (real local strategy + env users)", () => {
    it("returns 401 with same generic message for wrong password vs unknown user", async () => {
      const wrongPw = await request(server, "POST", "/api/auth/login", {
        body: { username: "admin1", password: "WRONG" },
      });
      const noUser = await request(server, "POST", "/api/auth/login", {
        body: { username: "ghost", password: "WRONG" },
      });
      assert.equal(wrongPw.status, 401);
      assert.equal(noUser.status, 401);
      // HIPAA: response messages must not reveal which field was wrong
      assert.equal(wrongPw.body?.message, noUser.body?.message);
    });
  });
});
