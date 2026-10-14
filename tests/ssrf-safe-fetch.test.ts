/**
 * SSRF hardening (F35).
 *
 * Before the fix `validateUrl` was the only guard: synchronous, no DNS, and
 * blind to bracketed / hex-form IPv4-mapped IPv6 hosts (the WHATWG URL parser
 * rewrites `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`). `fetch` then
 * followed redirects anywhere, and the reference-document URL import stored
 * the response body where GET /api/reference-documents/:id reads it back —
 * read-back SSRF from a free self-registered admin account.
 */
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import dns from "node:dns";
import express from "express";
import { validateUrl, isBlockedIp, safeFetch, SsrfBlockedError } from "../server/utils/url-validation.js";
import { csrfMiddleware } from "../server/middleware/csrf.js";
import { setupAuth } from "../server/auth.js";
import { registerAuthRoutes } from "../server/routes/auth.js";
import { registerOnboardingRoutes } from "../server/routes/onboarding.js";

/** DNS answer an attacker controls: a public-looking name pointing at loopback. */
function resolveEverythingToLoopback() {
  mock.method(dns, "lookup", (_host: string, opts: any, cb: any) => {
    const callback = typeof opts === "function" ? opts : cb;
    if (typeof opts === "object" && opts?.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
  });
}

describe("isBlockedIp / validateUrl", () => {
  it("blocks IPv4-mapped IPv6 in hex and dotted form, bracketed or not", () => {
    for (const ip of [
      "[::ffff:a9fe:a9fe]",
      "::ffff:a9fe:a9fe",
      "::ffff:169.254.169.254",
      "[::ffff:7f00:1]",
      "[::1]",
      "::",
      "64:ff9b::a9fe:a9fe", // NAT64
      "2002:a9fe:a9fe::1", // 6to4
      "fe90::1", // link-local (fe80::/10, not just fe80:)
      "fd12:3456::1",
      "ff02::1",
    ]) {
      assert.equal(isBlockedIp(ip), true, `${ip} must be blocked`);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "2606:4700:4700::1111", "[2606:4700:4700::1111]", "::ffff:808:808"]) {
      assert.equal(isBlockedIp(ip), false, `${ip} must be allowed`);
    }
  });

  it("rejects metadata/loopback URLs the old validator let through", () => {
    for (const url of [
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
      "http://[::ffff:127.0.0.1]:6379/",
      "http://localhost./",
      "http://user:pass@example.com/",
    ]) {
      assert.equal(validateUrl(url).valid, false, `${url} must be rejected`);
    }
    // Decimal/hex IPv4 forms are canonicalised by the URL parser.
    assert.equal(validateUrl("http://2852039166/").valid, false);
    assert.equal(validateUrl("https://example.com/docs").valid, true);
  });
});

describe("safeFetch", () => {
  let target: http.Server;
  let port: number;
  let hits = 0;

  before(async () => {
    target = http.createServer((_req, res) => {
      hits++;
      res.setHeader("content-type", "text/plain");
      res.end("INTERNAL-SECRET-CONTENT");
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    port = (target.address() as { port: number }).port;
  });

  after(async () => {
    mock.restoreAll();
    await new Promise<void>((r) => target.close(() => r()));
  });

  it("refuses a public-looking hostname that resolves to loopback, without connecting", async () => {
    hits = 0;
    resolveEverythingToLoopback();
    try {
      await assert.rejects(safeFetch(`http://docs.attacker-controlled.test:${port}/`), SsrfBlockedError);
    } finally {
      mock.restoreAll();
    }
    assert.equal(hits, 0, "no connection may reach the internal server");
  });

  it("refuses an IPv4-mapped IPv6 literal pointing at loopback", async () => {
    hits = 0;
    await assert.rejects(safeFetch(`http://[::ffff:7f00:1]:${port}/`), SsrfBlockedError);
    assert.equal(hits, 0);
  });
});

describe("POST /api/reference-documents/url", () => {
  let app: http.Server;
  let target: http.Server;
  let targetPort: number;
  let hits = 0;

  before(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "ssrf-test-secret";
    process.env.AUTH_USERS = "ssrf-admin:password123:admin:SSRF Admin:default";
    process.env.DISABLE_SECURE_COOKIE = "true";

    target = http.createServer((_req, res) => {
      hits++;
      res.setHeader("content-type", "text/plain");
      res.end("INTERNAL-SECRET-CONTENT from an internal-only service");
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    targetPort = (target.address() as { port: number }).port;

    const e = express();
    e.use(express.json());
    e.use(csrfMiddleware);
    await setupAuth(e);
    registerAuthRoutes(e);
    registerOnboardingRoutes(e);
    e.get("/api/test/public", (_req, res) => res.json({ ok: true }));
    app = http.createServer(e);
    await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  });

  after(async () => {
    await new Promise<void>((r) => app.close(() => r()));
    await new Promise<void>((r) => target.close(() => r()));
  });

  function req(method: string, path: string, opts: { body?: unknown; cookie?: string; csrf?: string } = {}) {
    return new Promise<{ status: number; body: any; cookies: string[] }>((resolve, reject) => {
      const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (bodyStr) headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
      if (opts.cookie) headers.Cookie = opts.cookie;
      if (opts.csrf) headers["X-CSRF-Token"] = opts.csrf;
      const port = (app.address() as { port: number }).port;
      const r = http.request({ hostname: "127.0.0.1", port, method, path, headers }, (res) => {
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
      r.on("error", reject);
      if (bodyStr) r.write(bodyStr);
      r.end();
    });
  }

  it("does not fetch (or store) an internal service behind a rebinding DNS name", async () => {
    const seed = await req("GET", "/api/test/public");
    const csrf = seed.cookies
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("csrf-token="))!
      .split("=")[1];
    const login = await req("POST", "/api/auth/login", {
      body: { username: "ssrf-admin", password: "password123" },
      cookie: `csrf-token=${csrf}`,
    });
    const sid = login.cookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("connect.sid="))!;
    const cookie = `csrf-token=${csrf}; ${sid}`;

    hits = 0;
    resolveEverythingToLoopback();
    let res;
    try {
      res = await req("POST", "/api/reference-documents/url", {
        body: { url: `http://docs.attacker-controlled.test:${targetPort}/secret`, name: "x" },
        cookie,
        csrf,
      });
    } finally {
      mock.restoreAll();
    }
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(hits, 0, "the internal service must not be contacted");
    assert.ok(!JSON.stringify(res.body).includes("INTERNAL-SECRET"), "no response content may leak");
  });
});
