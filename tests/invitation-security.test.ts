/**
 * Invitation privilege escalation (F34 / F152).
 *
 * Real csrfMiddleware + setupAuth + login + invitation routes on Express with
 * MemStorage. Before the fix a manager could create an admin invitation, read
 * every pending invitation's stored token hash from GET /api/invitations, and
 * redeem that hash (lookup matched `sha256(input) OR input`) under any
 * username they liked — manager → admin in two requests. Acceptance was also
 * not atomic and skipped the seat quota.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { csrfMiddleware } from "../server/middleware/csrf.js";
import { setupAuth } from "../server/auth.js";
import { registerAuthRoutes } from "../server/routes/auth.js";
import { registerRegistrationRoutes } from "../server/routes/registration.js";
import { storage } from "../server/storage/index.js";

interface Res {
  status: number;
  body: any;
  cookies: string[];
}

function request(
  server: http.Server,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; csrfToken?: string } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
    if (opts.cookie) headers["Cookie"] = opts.cookie;
    if (opts.csrfToken) headers["X-CSRF-Token"] = opts.csrfToken;
    const req = http.request({ hostname: "127.0.0.1", port: addr.port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let body: any = raw;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          /* keep raw */
        }
        const sc = res.headers["set-cookie"];
        resolve({ status: res.statusCode!, body, cookies: Array.isArray(sc) ? sc : sc ? [sc] : [] });
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function cookieValue(lines: string[], name: string): string | undefined {
  for (const line of lines) {
    const [k, v] = line.split(";")[0].split("=");
    if (k === name) return v;
  }
  return undefined;
}

describe("Invitation security", () => {
  let server: http.Server;
  let orgId: string;
  const PASSWORD = "Str0ng-Passw0rd!";

  before(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "invitation-security-test-secret";
    process.env.AUTH_USERS =
      "inv-admin:password123:admin:Inv Admin:default,inv-manager:password123:manager:Inv Manager:default";
    process.env.DISABLE_SECURE_COOKIE = "true";

    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware);
    await setupAuth(app);
    registerAuthRoutes(app);
    registerRegistrationRoutes(app);
    app.get("/api/test/public", (_req, res) => res.json({ ok: true }));

    const org = await storage.getOrganizationBySlug("default");
    orgId = org!.id;
    // Enough seats that only the dedicated seat test hits the limit.
    await storage.upsertSubscription(orgId, { orgId, planTier: "enterprise", status: "active" } as any);

    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function loginAs(username: string) {
    const seed = await request(server, "GET", "/api/test/public");
    const csrfToken = cookieValue(seed.cookies, "csrf-token")!;
    const res = await request(server, "POST", "/api/auth/login", {
      body: { username, password: "password123" },
      cookie: `csrf-token=${csrfToken}`,
    });
    assert.equal(res.status, 200);
    const sid = cookieValue(res.cookies, "connect.sid")!;
    return { csrfToken, cookie: `csrf-token=${csrfToken}; connect.sid=${sid}` };
  }

  async function accept(token: string, extra: Record<string, unknown> = {}) {
    const seed = await request(server, "GET", "/api/test/public");
    const csrfToken = cookieValue(seed.cookies, "csrf-token")!;
    return request(server, "POST", "/api/invitations/accept", {
      body: { token, password: PASSWORD, name: "New Person", ...extra },
      cookie: `csrf-token=${csrfToken}`,
      csrfToken,
    });
  }

  it("a manager cannot create an admin invitation", async () => {
    const m = await loginAs("inv-manager");
    const res = await request(server, "POST", "/api/invitations", {
      body: { email: "escalate@example.com", role: "admin" },
      cookie: m.cookie,
      csrfToken: m.csrfToken,
    });
    assert.equal(res.status, 403);
  });

  it("an admin can, and gets the raw token exactly once", async () => {
    const a = await loginAs("inv-admin");
    const res = await request(server, "POST", "/api/invitations", {
      body: { email: "real-admin@example.com", role: "admin" },
      cookie: a.cookie,
      csrfToken: a.csrfToken,
    });
    assert.equal(res.status, 201);
    assert.match(res.body.token, /^[0-9a-f]{64}$/);
  });

  it("the invitation list never returns tokens", async () => {
    const m = await loginAs("inv-manager");
    await request(server, "POST", "/api/invitations", {
      body: { email: "list-check@example.com", role: "viewer" },
      cookie: m.cookie,
      csrfToken: m.csrfToken,
    });
    const res = await request(server, "GET", "/api/invitations", { cookie: m.cookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body) && res.body.length > 0);
    for (const inv of res.body) assert.equal(inv.token, undefined, "token hash must not be exposed");
  });

  it("the stored token hash is not redeemable", async () => {
    await storage.createInvitation(orgId, { orgId, email: "hash-only@example.com", role: "viewer", invitedBy: "t" });
    const stored = (await storage.listInvitations(orgId)).find((i) => i.email === "hash-only@example.com")!;
    const res = await accept(stored.token);
    assert.equal(res.status, 404);
  });

  it("binds the account to the invited email", async () => {
    const inv = await storage.createInvitation(orgId, {
      orgId,
      email: "bound@example.com",
      role: "viewer",
      invitedBy: "t",
    });
    const wrong = await accept(inv.token, { username: "someone-else" });
    assert.equal(wrong.status, 400);

    const ok = await accept(inv.token);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.user.username, "bound@example.com");
  });

  it("concurrent accepts of one token create exactly one user", async () => {
    const inv = await storage.createInvitation(orgId, {
      orgId,
      email: "race@example.com",
      role: "manager",
      invitedBy: "t",
    });
    const results = await Promise.all([accept(inv.token), accept(inv.token), accept(inv.token)]);
    assert.equal(results.filter((r) => r.status === 201).length, 1, results.map((r) => r.status).join(","));
    const users = (await storage.listUsersByOrg(orgId)).filter((u) => u.username === "race@example.com");
    assert.equal(users.length, 1);
  });

  it("enforces the seat quota at accept time", async () => {
    const small = await storage.createOrganization({
      name: "Small",
      slug: `small-${Date.now()}`,
      status: "active",
    } as any);
    const inv = await storage.createInvitation(small.id, {
      orgId: small.id,
      email: "over-quota@example.com",
      role: "viewer",
      invitedBy: "t",
    });
    // Free tier: 2 seats, filled after the invitation went out.
    for (const n of [1, 2]) {
      await storage.createUser({
        orgId: small.id,
        username: `seat${n}@example.com`,
        passwordHash: "x",
        name: `Seat ${n}`,
        role: "viewer",
      } as any);
    }
    const res = await accept(inv.token);
    assert.equal(res.status, 429);
    assert.equal(res.body.code, "USER_QUOTA_EXCEEDED");
  });
});
