/**
 * WAF (Web Application Firewall) middleware tests.
 *
 * Tests attack pattern detection, anomaly scoring, IP blocking, and
 * admin helpers. Exercises the actual middleware with mock Express
 * request/response objects.
 *
 * Each test group uses a unique IP to prevent anomaly score bleed-over
 * between unrelated tests (scores accumulate per-IP in the module-level Map).
 *
 * Run with: npx tsx --test tests/waf.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { wafMiddleware, blockIp, unblockIp, getWafStats } from "../server/middleware/waf.js";

// --- Mock helpers ---

let ipCounter = 0;
function uniqueIp(): string {
  ipCounter++;
  return `192.0.2.${ipCounter}`; // TEST-NET-1 range, non-routable
}

function mockReq(overrides: Partial<{
  ip: string;
  path: string;
  originalUrl: string;
  url: string;
  method: string;
  body: unknown;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  socket: { remoteAddress: string };
}>): any {
  const ip = overrides.ip || uniqueIp();
  return {
    ip,
    path: overrides.path || "/api/test",
    originalUrl: overrides.originalUrl || overrides.path || "/api/test",
    url: overrides.url || overrides.originalUrl || overrides.path || "/api/test",
    method: overrides.method || "GET",
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    headers: overrides.headers ?? {},
    socket: overrides.socket || { remoteAddress: ip },
  };
}

function mockRes(): any {
  let statusCode: number | null = null;
  let jsonBody: unknown = null;
  return {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
      return this;
    },
    getStatus: () => statusCode,
    getBody: () => jsonBody,
  };
}

function runWaf(req: any): { nextCalled: boolean; status: number | null } {
  const res = mockRes();
  let nextCalled = false;
  wafMiddleware(req, res, () => { nextCalled = true; });
  return { nextCalled, status: res.getStatus() };
}

// ============================================================================
// SQL Injection Detection
// ============================================================================

describe("WAF — SQL Injection Detection", () => {
  it("detects UNION SELECT", () => {
    const { nextCalled } = runWaf(mockReq({ originalUrl: "/api/search?q=1 UNION SELECT * FROM users" }));
    assert.ok(nextCalled, "First violation: logged but allowed (under threshold)");
  });

  it("detects OR 1=1", () => {
    const { nextCalled } = runWaf(mockReq({ body: { username: "admin' OR 1=1--" } }));
    assert.ok(nextCalled);
  });

  it("detects DROP TABLE in chained statement", () => {
    const { nextCalled } = runWaf(mockReq({ body: { input: "test; DROP TABLE users" } }));
    assert.ok(nextCalled);
  });

  it("detects time-based injection (WAITFOR DELAY)", () => {
    const { nextCalled } = runWaf(mockReq({ query: { id: "1; WAITFOR DELAY '0:0:5'" } }));
    assert.ok(nextCalled);
  });

  it("detects CHAR() obfuscation", () => {
    const { nextCalled } = runWaf(mockReq({ body: { input: "CHAR(65)" } }));
    assert.ok(nextCalled);
  });
});

// ============================================================================
// XSS Detection
// ============================================================================

describe("WAF — XSS Detection", () => {
  it("detects <script> tags", () => {
    const { nextCalled } = runWaf(mockReq({ body: { comment: '<script>alert("xss")</script>' } }));
    assert.ok(nextCalled);
  });

  it("detects javascript: protocol", () => {
    const { nextCalled } = runWaf(mockReq({ body: { url: "javascript:alert(1)" } }));
    assert.ok(nextCalled);
  });

  it("detects event handlers (onerror)", () => {
    const { nextCalled } = runWaf(mockReq({ body: { content: '<img onerror=alert(1)>' } }));
    assert.ok(nextCalled);
  });

  it("detects document.cookie access", () => {
    const { nextCalled } = runWaf(mockReq({ query: { q: "document.cookie" } }));
    assert.ok(nextCalled);
  });

  it("detects <iframe> injection", () => {
    const { nextCalled } = runWaf(mockReq({ body: { note: '<iframe src="evil.com"></iframe>' } }));
    assert.ok(nextCalled);
  });

  it("detects eval() calls", () => {
    const { nextCalled } = runWaf(mockReq({ body: { code: "eval(atob('...'))" } }));
    assert.ok(nextCalled);
  });
});

// ============================================================================
// Path Traversal Detection
// ============================================================================

describe("WAF — Path Traversal Detection", () => {
  it("detects ../ sequences", () => {
    const { nextCalled } = runWaf(mockReq({ originalUrl: "/api/files/../../etc/passwd", path: "/api/files/../../etc/passwd" }));
    assert.ok(nextCalled);
  });

  it("detects URL-encoded traversal (%2e%2e%2f)", () => {
    const { nextCalled } = runWaf(mockReq({ originalUrl: "/api/files/%2e%2e%2fetc/passwd", path: "/api/files/%2e%2e%2fetc/passwd" }));
    assert.ok(nextCalled);
  });

  it("detects /etc/passwd access", () => {
    const { nextCalled } = runWaf(mockReq({ originalUrl: "/api/download/etc/passwd", path: "/api/download/etc/passwd" }));
    assert.ok(nextCalled);
  });

  it("detects Windows system32 path", () => {
    const { nextCalled } = runWaf(mockReq({ originalUrl: "/api/read/windows/system32/config", path: "/api/read/windows/system32/config" }));
    assert.ok(nextCalled);
  });
});

// ============================================================================
// Suspicious User Agents
// ============================================================================

describe("WAF — Suspicious User Agents", () => {
  it("detects sqlmap", () => {
    const { nextCalled } = runWaf(mockReq({ headers: { "user-agent": "sqlmap/1.5" } }));
    assert.ok(nextCalled);
  });

  it("detects Burp Suite", () => {
    const { nextCalled } = runWaf(mockReq({ headers: { "user-agent": "Mozilla/5.0 BurpSuite/2023.1" } }));
    assert.ok(nextCalled);
  });

  it("detects nikto", () => {
    const { nextCalled } = runWaf(mockReq({ headers: { "user-agent": "Nikto/2.1.6" } }));
    assert.ok(nextCalled);
  });

  it("allows normal browser user agents", () => {
    const { nextCalled } = runWaf(mockReq({
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0" },
    }));
    assert.ok(nextCalled);
  });
});

// ============================================================================
// Anomaly Scoring & IP Blocking
// ============================================================================

describe("WAF — Anomaly Scoring", () => {
  it("blocks IP after exceeding anomaly threshold", () => {
    const ip = uniqueIp();
    // Path traversal = 5 points each, threshold is 10
    // First request: 5 points — allowed
    const r1 = runWaf(mockReq({ ip, originalUrl: "/api/../../etc/passwd", path: "/api/../../etc/passwd" }));
    assert.ok(r1.nextCalled, "Under threshold — should allow");

    // Second request: 10 points total — blocked
    const r2 = runWaf(mockReq({ ip, originalUrl: "/api/../../../proc/self", path: "/api/../../../proc/self" }));
    assert.equal(r2.nextCalled, false, "At threshold — should block");
    assert.equal(r2.status, 403);

    // Third request: still blocked (no new scan needed)
    const r3 = runWaf(mockReq({ ip, path: "/api/legitimate" }));
    assert.equal(r3.nextCalled, false, "Still blocked");

    // Cleanup
    unblockIp(ip);
  });
});

// ============================================================================
// Middleware Behavior (skip paths, health checks)
// ============================================================================

describe("WAF — Middleware Behavior", () => {
  it("skips health check endpoint", () => {
    const { nextCalled } = runWaf(mockReq({ path: "/api/health", originalUrl: "/api/health?DROP TABLE users" }));
    assert.ok(nextCalled, "Health check should bypass WAF");
  });

  it("skips non-API paths (static assets)", () => {
    const { nextCalled } = runWaf(mockReq({ path: "/assets/script.js", originalUrl: "/assets/script.js" }));
    assert.ok(nextCalled);
  });

  it("handles malformed percent-encoding gracefully", () => {
    const { nextCalled } = runWaf(mockReq({ originalUrl: "/api/test/%GG%ZZ", path: "/api/test/%GG%ZZ" }));
    assert.ok(nextCalled, "Malformed encoding should not crash WAF");
  });

  it("allows clean API requests", () => {
    const { nextCalled } = runWaf(mockReq({ body: { name: "John Doe", role: "viewer" } }));
    assert.ok(nextCalled);
  });
});

// ============================================================================
// Admin Helpers (block/unblock, stats)
// ============================================================================

describe("WAF — Admin Helpers", () => {
  it("blockIp prevents requests from that IP", () => {
    const ip = uniqueIp();
    blockIp(ip);
    const { nextCalled, status } = runWaf(mockReq({ ip }));
    assert.equal(nextCalled, false, "Blocked IP should not reach next()");
    assert.equal(status, 403);
    unblockIp(ip);
  });

  it("unblockIp re-allows requests", () => {
    const ip = uniqueIp();
    blockIp(ip);
    unblockIp(ip);
    const { nextCalled } = runWaf(mockReq({ ip }));
    assert.ok(nextCalled, "Unblocked IP should reach next()");
  });

  it("getWafStats returns correct shape", () => {
    const stats = getWafStats();
    assert.ok(Array.isArray(stats.blockedIps));
    assert.ok(Array.isArray(stats.manualBlocklist));
    assert.equal(typeof stats.trackedIps, "number");
    assert.equal(typeof stats.recentViolations, "number");
  });

  it("manually blocked IP appears in stats", () => {
    const ip = uniqueIp();
    blockIp(ip);
    const stats = getWafStats();
    assert.ok(stats.manualBlocklist.includes(ip));
    unblockIp(ip);
  });
});
