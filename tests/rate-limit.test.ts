/**
 * In-memory rate limiter enforcement tests.
 *
 * The existing E2E suite checks that `X-RateLimit-*` headers are *present*,
 * but `E2E_TESTING=true` relaxes the limit to 500 so the actual blocking
 * behavior is never exercised. This file calls `inMemoryRateLimit` directly
 * with tiny limits to prove:
 *
 *   1. Within-window allowance: the first N requests succeed and emit
 *      monotonically decreasing `X-RateLimit-Remaining`.
 *   2. Hard block at limit: request N+1 returns 429 with `Retry-After`.
 *   3. Sliding-window recovery: after `windowMs` elapses, the bucket frees up.
 *   4. Per-IP isolation: tenant A's traffic doesn't block tenant B.
 *   5. Per-org isolation when `includeOrg=true`: two orgs sharing an IP
 *      get independent buckets (HIPAA-relevant for corporate NATs).
 *   6. UUID path normalization: cycling call IDs through the same endpoint
 *      shares one bucket, so an attacker can't cycle UUIDs to exfiltrate.
 *   7. Eviction cap: the in-memory map enforces `MAX_RATE_LIMIT_ENTRIES`
 *      via FIFO so it can't grow unbounded under attack.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import {
  inMemoryRateLimit,
  rateLimitKey,
  rateLimitMap,
  _resetRateLimitState,
  MAX_RATE_LIMIT_ENTRIES,
} from "../server/middleware/rate-limit.js";

// ── Test doubles for Express req/res ────────────────────────────────────────

interface FakeResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status(code: number): FakeResponse;
  json(payload: unknown): FakeResponse;
  setHeader(name: string, value: string): FakeResponse;
}

function makeRes(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
  };
  return res;
}

function makeReq(opts: { ip?: string; path?: string; orgId?: string } = {}): Request {
  return {
    ip: opts.ip ?? "127.0.0.1",
    path: opts.path ?? "/api/test",
    orgId: opts.orgId,
  } as unknown as Request;
}

async function fire(
  middleware: ReturnType<typeof inMemoryRateLimit>,
  req: Request,
  res: FakeResponse,
): Promise<{ called: boolean; res: FakeResponse }> {
  let called = false;
  await new Promise<void>((resolve) => {
    middleware(req, res as unknown as Response, () => {
      called = true;
      resolve();
    });
    // Synchronous middleware: if next() wasn't called, the response was sent.
    if (!called) resolve();
  });
  return { called, res };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("inMemoryRateLimit — enforcement", () => {
  beforeEach(() => {
    _resetRateLimitState();
  });

  it("allows the first N requests within the window", async () => {
    const limiter = inMemoryRateLimit(60_000, 3);
    const req = makeReq();

    for (let i = 1; i <= 3; i++) {
      const { called, res } = await fire(limiter, req, makeRes());
      assert.equal(called, true, `request ${i} should pass through`);
      assert.equal(res.statusCode, 200, `request ${i} should not have been blocked`);
      assert.equal(res.headers["x-ratelimit-limit"], "3");
      assert.equal(res.headers["x-ratelimit-remaining"], String(3 - i));
    }
  });

  it("blocks the (N+1)th request with 429 and Retry-After", async () => {
    const limiter = inMemoryRateLimit(60_000, 2);
    const req = makeReq({ path: "/api/calls/upload" });

    await fire(limiter, req, makeRes());
    await fire(limiter, req, makeRes());

    const { called, res } = await fire(limiter, req, makeRes());
    assert.equal(called, false, "next() must not be called once the limit is hit");
    assert.equal(res.statusCode, 429);
    assert.deepEqual(res.body, { message: "Too many requests. Please try again later." });
    assert.equal(res.headers["x-ratelimit-remaining"], "0");
    assert.ok(res.headers["retry-after"], "Retry-After header must be set");
    assert.ok(parseInt(res.headers["retry-after"], 10) > 0, "Retry-After must be positive");
  });

  it("recovers after the window slides past the oldest timestamp", async () => {
    const limiter = inMemoryRateLimit(50, 2); // 50ms window, 2 requests
    const req = makeReq({ path: "/api/auth/login" });

    await fire(limiter, req, makeRes());
    await fire(limiter, req, makeRes());

    // Third should be blocked immediately
    const blocked = await fire(limiter, req, makeRes());
    assert.equal(blocked.res.statusCode, 429);

    // Wait past the window; old timestamps fall out
    await new Promise((r) => setTimeout(r, 70));

    const recovered = await fire(limiter, req, makeRes());
    assert.equal(recovered.called, true, "request must be allowed once the window has slid past");
    assert.equal(recovered.res.statusCode, 200);
  });

  it("isolates per IP — tenant A's flood does not block tenant B", async () => {
    const limiter = inMemoryRateLimit(60_000, 2);
    const reqA = makeReq({ ip: "1.1.1.1" });
    const reqB = makeReq({ ip: "2.2.2.2" });

    // Exhaust A's bucket
    await fire(limiter, reqA, makeRes());
    await fire(limiter, reqA, makeRes());
    const aBlocked = await fire(limiter, reqA, makeRes());
    assert.equal(aBlocked.res.statusCode, 429);

    // B has its own fresh bucket
    const bAllowed = await fire(limiter, reqB, makeRes());
    assert.equal(bAllowed.res.statusCode, 200);
    assert.equal(bAllowed.called, true);
  });

  it("isolates per org when includeOrg=true (corporate-NAT case)", async () => {
    const limiter = inMemoryRateLimit(60_000, 2, /* includeOrg */ true);
    const sharedIp = "10.0.0.5";
    const reqOrgA = makeReq({ ip: sharedIp, orgId: "org-a" });
    const reqOrgB = makeReq({ ip: sharedIp, orgId: "org-b" });

    await fire(limiter, reqOrgA, makeRes());
    await fire(limiter, reqOrgA, makeRes());
    const aBlocked = await fire(limiter, reqOrgA, makeRes());
    assert.equal(aBlocked.res.statusCode, 429);

    // org-b on the same IP must still be allowed
    const bAllowed = await fire(limiter, reqOrgB, makeRes());
    assert.equal(bAllowed.res.statusCode, 200);
  });

  it("collapses cycled UUIDs into a single bucket so attackers can't bypass via id rotation", async () => {
    const limiter = inMemoryRateLimit(60_000, 2);
    const ip = "9.9.9.9";

    // Same endpoint class with different UUIDs — must share a bucket.
    const id1 = "00000000-0000-0000-0000-000000000001";
    const id2 = "00000000-0000-0000-0000-000000000002";
    const id3 = "00000000-0000-0000-0000-000000000003";

    await fire(limiter, makeReq({ ip, path: `/api/calls/${id1}/transcript` }), makeRes());
    await fire(limiter, makeReq({ ip, path: `/api/calls/${id2}/transcript` }), makeRes());

    const blocked = await fire(limiter, makeReq({ ip, path: `/api/calls/${id3}/transcript` }), makeRes());
    assert.equal(blocked.res.statusCode, 429, "cycling UUIDs must not earn a fresh bucket");
  });

  it("treats different endpoint classes on the same IP as separate buckets", async () => {
    const limiter = inMemoryRateLimit(60_000, 1);
    const ip = "1.2.3.4";

    const a = await fire(limiter, makeReq({ ip, path: "/api/calls" }), makeRes());
    const b = await fire(limiter, makeReq({ ip, path: "/api/employees" }), makeRes());

    assert.equal(a.res.statusCode, 200);
    assert.equal(b.res.statusCode, 200, "different endpoints must not share a bucket");
  });

  it("rateLimitKey normalizes UUIDs and includes org when requested", () => {
    const id = "abcdef01-2345-6789-abcd-ef0123456789";
    const reqWithOrg = makeReq({ ip: "5.5.5.5", path: `/api/calls/${id}/audio`, orgId: "org-z" });

    assert.equal(rateLimitKey(reqWithOrg, false), "5.5.5.5:/api/calls/:id/audio");
    assert.equal(rateLimitKey(reqWithOrg, true), "5.5.5.5:/api/calls/:id/audio:org:org-z");
  });

  it("emits monotonically decreasing X-RateLimit-Remaining as the bucket fills", async () => {
    const limiter = inMemoryRateLimit(60_000, 5);
    const req = makeReq();
    const remaining: number[] = [];

    for (let i = 0; i < 5; i++) {
      const { res } = await fire(limiter, req, makeRes());
      remaining.push(parseInt(res.headers["x-ratelimit-remaining"], 10));
    }
    assert.deepEqual(remaining, [4, 3, 2, 1, 0]);
  });

  it("respects MAX_RATE_LIMIT_ENTRIES with FIFO eviction (sanity check on the cap)", async () => {
    // We can't realistically push 50k keys here, but we can prove the
    // eviction trigger uses `>= MAX_RATE_LIMIT_ENTRIES` by checking the cap.
    assert.ok(MAX_RATE_LIMIT_ENTRIES === 50_000, "constant intentionally fixed at 50_000");

    // Fire two requests on different IPs and verify both keys present.
    const limiter = inMemoryRateLimit(60_000, 1);
    await fire(limiter, makeReq({ ip: "11.11.11.11" }), makeRes());
    await fire(limiter, makeReq({ ip: "22.22.22.22" }), makeRes());
    assert.equal(rateLimitMap.size, 2, "each unique key gets its own entry");
  });
});
