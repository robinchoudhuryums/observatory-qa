/**
 * MFA login routes require the password step (F33 / F153).
 *
 * Mounts the real csrfMiddleware, setupAuth, /api/auth/login and the MFA
 * routes on Express with MemStorage. Before the fix, `/api/auth/mfa/verify`
 * (and backup / WebAuthn / email OTP) took a bare `userId` from the body, so
 * a valid second factor alone was a login — and email OTP did not even check
 * that the user had MFA, making mailbox access equal to account access.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import express from "express";
import { generateSecret, generateSync } from "otplib";
import { csrfMiddleware } from "../server/middleware/csrf.js";
import { setupAuth, hashPassword } from "../server/auth.js";
import { registerAuthRoutes } from "../server/routes/auth.js";
import { registerMfaRoutes } from "../server/routes/mfa.js";
import { storage } from "../server/storage/index.js";
import { encryptMfaSecret } from "../server/services/phi-encryption.js";

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

describe("MFA login routes require the password step", () => {
  let server: http.Server;
  let secret: string;
  let mfaUserId: string;
  const username = `mfa-user-${Date.now()}@example.com`;
  const password = "Correct-Horse-9!";

  before(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "mfa-pending-test-secret";
    process.env.DISABLE_SECURE_COOKIE = "true";

    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware);
    await setupAuth(app);
    registerAuthRoutes(app);
    registerMfaRoutes(app);
    app.get("/api/test/public", (_req, res) => res.json({ ok: true }));
    app.get("/api/test/whoami", (req, res) => res.json({ user: req.isAuthenticated() ? req.user : null }));

    const org = await storage.createOrganization({
      name: "MFA Test Org",
      slug: `mfa-test-${Date.now()}`,
      status: "active",
    } as any);
    const user = await storage.createUser({
      orgId: org.id,
      username,
      passwordHash: await hashPassword(password),
      name: "MFA Viewer",
      role: "viewer",
    } as any);
    mfaUserId = user.id;
    secret = generateSecret();
    await storage.updateUser(org.id, user.id, { mfaEnabled: true, mfaSecret: encryptMfaSecret(secret) } as any);

    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  /** A fresh browser: csrf cookie only, no session. */
  async function freshClient() {
    const seed = await request(server, "GET", "/api/test/public");
    const csrfToken = cookieValue(seed.cookies, "csrf-token")!;
    return { csrfToken, cookie: `csrf-token=${csrfToken}` };
  }

  async function passwordStep() {
    const c = await freshClient();
    const res = await request(server, "POST", "/api/auth/login", {
      body: { username, password },
      cookie: c.cookie,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.mfaRequired, true);
    const sid = cookieValue(res.cookies, "connect.sid");
    assert.ok(sid, "password step must set a session cookie carrying the pending marker");
    return { ...c, cookie: `${c.cookie}; connect.sid=${sid}` };
  }

  it("rejects a valid TOTP code without the password step (no session)", async () => {
    const c = await freshClient();
    const res = await request(server, "POST", "/api/auth/mfa/verify", {
      body: { userId: mfaUserId, code: generateSync({ secret }) },
      cookie: c.cookie,
      csrfToken: c.csrfToken,
    });
    assert.equal(res.status, 401);
    assert.equal(cookieValue(res.cookies, "connect.sid"), undefined, "no session may be created");
  });

  it("rejects backup-code, WebAuthn and email-OTP routes without the password step", async () => {
    const c = await freshClient();
    for (const [path, body] of [
      ["/api/auth/mfa/backup", { userId: mfaUserId, backupCode: "abcd-1234" }],
      ["/api/auth/mfa/webauthn/authenticate-options", { userId: mfaUserId }],
      ["/api/auth/mfa/webauthn/authenticate-verify", { userId: mfaUserId, response: { id: "x" } }],
      ["/api/auth/mfa/email-otp/send", { userId: mfaUserId }],
      ["/api/auth/mfa/email-otp/verify", { userId: mfaUserId, otp: "123456" }],
    ] as const) {
      const res = await request(server, "POST", path, { body, cookie: c.cookie, csrfToken: c.csrfToken });
      assert.equal(res.status, 401, `${path} must require the password step`);
    }
  });

  it("completes login after password step + valid TOTP", async () => {
    const c = await passwordStep();
    const res = await request(server, "POST", "/api/auth/mfa/verify", {
      body: { userId: mfaUserId, code: generateSync({ secret }) },
      cookie: c.cookie,
      csrfToken: c.csrfToken,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.id, mfaUserId);
    const sid = cookieValue(res.cookies, "connect.sid");
    assert.ok(sid, "session regenerated on success");
    const who = await request(server, "GET", "/api/test/whoami", {
      cookie: `csrf-token=${c.csrfToken}; connect.sid=${sid}`,
    });
    assert.equal(who.body.user?.id, mfaUserId);
  });

  it("rejects a body userId that differs from the one that passed the password step", async () => {
    const c = await passwordStep();
    const res = await request(server, "POST", "/api/auth/mfa/verify", {
      body: { userId: "someone-else", code: generateSync({ secret }) },
      cookie: c.cookie,
      csrfToken: c.csrfToken,
    });
    assert.equal(res.status, 401);
  });

  it("email OTP uses a CSPRNG", () => {
    const src = readFileSync(new URL("../server/routes/mfa.ts", import.meta.url), "utf8");
    assert.ok(!src.includes("Math.random"), "OTP must not be generated with Math.random");
  });
});
