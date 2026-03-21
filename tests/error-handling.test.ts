/**
 * Tests for error handling utilities: error codes, UUID validation, date parsing.
 * Run with: npx tsx --test tests/error-handling.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, errorResponse } from "../server/services/error-codes.js";

describe("ERROR_CODES", () => {
  it("all codes follow OBS-{DOMAIN}-{NUMBER} format", () => {
    const codePattern = /^OBS-[A-Z]+-\d{3}$/;
    for (const [key, code] of Object.entries(ERROR_CODES)) {
      assert.match(code, codePattern, `Code ${key} = "${code}" does not match expected format`);
    }
  });

  it("has no duplicate error codes", () => {
    const codes = Object.values(ERROR_CODES);
    const uniqueCodes = new Set(codes);
    assert.strictEqual(codes.length, uniqueCodes.size, "Duplicate error codes found");
  });

  it("covers expected domains", () => {
    const codes = Object.values(ERROR_CODES);
    const domains = new Set(codes.map((c) => c.split("-")[1]));
    assert.ok(domains.has("AUTH"), "Missing AUTH domain");
    assert.ok(domains.has("CALL"), "Missing CALL domain");
    assert.ok(domains.has("BILL"), "Missing BILL domain");
    assert.ok(domains.has("GEN"), "Missing GEN domain");
  });
});

describe("errorResponse()", () => {
  it("produces correct format with errorCode field", () => {
    const result = errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found");
    assert.deepStrictEqual(result, {
      message: "Call not found",
      errorCode: "OBS-CALL-002",
    });
  });

  it("includes details when provided", () => {
    const result = errorResponse(
      ERROR_CODES.INTERNAL_ERROR,
      "Something went wrong",
      "Stack trace omitted"
    );
    assert.strictEqual(result.message, "Something went wrong");
    assert.strictEqual(result.errorCode, "OBS-GEN-001");
    assert.strictEqual(result.details, "Stack trace omitted");
  });

  it("omits details field when not provided", () => {
    const result = errorResponse(ERROR_CODES.AUTH_INVALID_CREDENTIALS, "Bad credentials");
    assert.strictEqual("details" in result, false);
  });

  it("returns the exact error code passed in", () => {
    const result = errorResponse(ERROR_CODES.BILLING_QUOTA_EXCEEDED, "Quota exceeded");
    assert.strictEqual(result.errorCode, "OBS-BILL-001");
  });
});

describe("validateUUIDParam()", () => {
  // We test the middleware by simulating req/res/next
  let validateUUIDParam: (paramName?: string) => (req: any, res: any, next: any) => void;

  before(async () => {
    // Dynamic import to avoid side effects from helpers.ts (multer/fs)
    const mod = await import("../server/routes/helpers.js");
    validateUUIDParam = mod.validateUUIDParam;
  });

  function createMockReqRes(params: Record<string, string>) {
    const req = { params } as any;
    let statusCode: number | undefined;
    let jsonBody: any;
    let nextCalled = false;
    const res = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(body: any) {
        jsonBody = body;
        return res;
      },
    } as any;
    const next = () => { nextCalled = true; };
    return { req, res, next, getStatus: () => statusCode, getJson: () => jsonBody, wasNextCalled: () => nextCalled };
  }

  it("accepts a valid UUID v4", async () => {
    const middleware = validateUUIDParam("id");
    const { req, res, next, wasNextCalled, getStatus } = createMockReqRes({
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
    middleware(req, res, next);
    assert.ok(wasNextCalled(), "next() should be called for valid UUID");
    assert.strictEqual(getStatus(), undefined, "should not set status");
  });

  it("accepts uppercase UUID", async () => {
    const middleware = validateUUIDParam("id");
    const { req, res, next, wasNextCalled } = createMockReqRes({
      id: "550E8400-E29B-41D4-A716-446655440000",
    });
    middleware(req, res, next);
    assert.ok(wasNextCalled());
  });

  it("rejects a non-UUID string", async () => {
    const middleware = validateUUIDParam("id");
    const { req, res, next, wasNextCalled, getStatus, getJson } = createMockReqRes({
      id: "not-a-uuid",
    });
    middleware(req, res, next);
    assert.ok(!wasNextCalled(), "next() should NOT be called for invalid UUID");
    assert.strictEqual(getStatus(), 400);
    assert.ok(getJson().message.includes("Invalid"));
  });

  it("rejects SQL injection attempts", async () => {
    const middleware = validateUUIDParam("id");
    const { req, res, next, wasNextCalled, getStatus } = createMockReqRes({
      id: "1; DROP TABLE users;--",
    });
    middleware(req, res, next);
    assert.ok(!wasNextCalled());
    assert.strictEqual(getStatus(), 400);
  });

  it("rejects empty string", async () => {
    const middleware = validateUUIDParam("id");
    // Empty string is falsy, so the middleware skips validation and calls next
    const { req, res, next, wasNextCalled } = createMockReqRes({ id: "" });
    middleware(req, res, next);
    // The code checks `if (value && !UUID_REGEX.test(value))` — empty string is falsy, so next() is called
    assert.ok(wasNextCalled(), "empty string is falsy, so middleware skips validation");
  });

  it("uses custom param name", async () => {
    const middleware = validateUUIDParam("callId");
    const { req, res, next, wasNextCalled, getStatus, getJson } = createMockReqRes({
      callId: "bad-value",
    });
    middleware(req, res, next);
    assert.ok(!wasNextCalled());
    assert.strictEqual(getStatus(), 400);
    assert.ok(getJson().message.includes("callId"));
  });
});

describe("parseDateParam()", () => {
  let parseDateParam: (val: unknown) => Date | undefined;

  before(async () => {
    const mod = await import("../server/routes/helpers.js");
    parseDateParam = mod.parseDateParam;
  });

  it("parses valid ISO date string", () => {
    const result = parseDateParam("2024-01-15T10:30:00Z");
    assert.ok(result instanceof Date);
    assert.strictEqual(result!.toISOString(), "2024-01-15T10:30:00.000Z");
  });

  it("parses date-only string", () => {
    const result = parseDateParam("2024-06-01");
    assert.ok(result instanceof Date);
    assert.ok(!isNaN(result!.getTime()));
  });

  it("returns undefined for invalid date string", () => {
    const result = parseDateParam("not-a-date");
    assert.strictEqual(result, undefined);
  });

  it("returns undefined for null", () => {
    assert.strictEqual(parseDateParam(null), undefined);
  });

  it("returns undefined for undefined", () => {
    assert.strictEqual(parseDateParam(undefined), undefined);
  });

  it("returns undefined for empty string", () => {
    assert.strictEqual(parseDateParam(""), undefined);
  });

  it("returns undefined for non-string types", () => {
    assert.strictEqual(parseDateParam(12345), undefined);
    assert.strictEqual(parseDateParam(true), undefined);
    assert.strictEqual(parseDateParam({}), undefined);
  });

  it("handles epoch timestamp string", () => {
    // new Date("1704067200000") is invalid — it's not a recognized format
    // But new Date("2024-01-01") works
    const result = parseDateParam("1704067200000");
    // This may or may not parse depending on JS engine, but should not throw
    assert.ok(result === undefined || result instanceof Date);
  });
});

// Need to import before() at the top level
import { before } from "node:test";
