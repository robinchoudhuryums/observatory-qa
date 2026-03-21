/**
 * Tests for input validation: UUID regex, date parsing, safe numeric conversions.
 * Run with: npx tsx --test tests/validation.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// UUID v4 regex — matches the one in server/routes/helpers.ts
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("UUID validation regex", () => {
  it("accepts valid lowercase UUID", () => {
    assert.ok(UUID_REGEX.test("550e8400-e29b-41d4-a716-446655440000"));
  });

  it("accepts valid uppercase UUID", () => {
    assert.ok(UUID_REGEX.test("550E8400-E29B-41D4-A716-446655440000"));
  });

  it("accepts mixed case UUID", () => {
    assert.ok(UUID_REGEX.test("550e8400-E29B-41d4-A716-446655440000"));
  });

  it("rejects empty string", () => {
    assert.ok(!UUID_REGEX.test(""));
  });

  it("rejects random string", () => {
    assert.ok(!UUID_REGEX.test("hello-world"));
  });

  it("rejects UUID without dashes", () => {
    assert.ok(!UUID_REGEX.test("550e8400e29b41d4a716446655440000"));
  });

  it("rejects UUID with extra characters", () => {
    assert.ok(!UUID_REGEX.test("550e8400-e29b-41d4-a716-446655440000-extra"));
  });

  it("rejects SQL injection attempt", () => {
    assert.ok(!UUID_REGEX.test("'; DROP TABLE users;--"));
  });

  it("rejects UUID with non-hex characters", () => {
    assert.ok(!UUID_REGEX.test("550g8400-e29b-41d4-a716-446655440000"));
  });

  it("rejects too-short UUID", () => {
    assert.ok(!UUID_REGEX.test("550e8400-e29b-41d4-a716"));
  });

  it("rejects path traversal attempt", () => {
    assert.ok(!UUID_REGEX.test("../../etc/passwd"));
  });

  it("rejects numeric string", () => {
    assert.ok(!UUID_REGEX.test("12345"));
  });

  it("rejects UUID with spaces", () => {
    assert.ok(!UUID_REGEX.test(" 550e8400-e29b-41d4-a716-446655440000 "));
  });
});

describe("Date parameter parsing", () => {
  let parseDateParam: (val: unknown) => Date | undefined;

  before(async () => {
    const mod = await import("../server/routes/helpers.js");
    parseDateParam = mod.parseDateParam;
  });

  it("parses ISO 8601 date-time with timezone", () => {
    const result = parseDateParam("2024-01-15T10:30:00Z");
    assert.ok(result instanceof Date);
    assert.strictEqual(result!.getUTCFullYear(), 2024);
    assert.strictEqual(result!.getUTCMonth(), 0); // January
    assert.strictEqual(result!.getUTCDate(), 15);
  });

  it("parses ISO 8601 date-only", () => {
    const result = parseDateParam("2024-06-01");
    assert.ok(result instanceof Date);
    assert.ok(!isNaN(result!.getTime()));
  });

  it("parses date with offset", () => {
    const result = parseDateParam("2024-03-15T12:00:00+05:30");
    assert.ok(result instanceof Date);
    assert.ok(!isNaN(result!.getTime()));
  });

  it("returns undefined for completely invalid string", () => {
    assert.strictEqual(parseDateParam("not-a-date"), undefined);
  });

  it("returns undefined for random words", () => {
    assert.strictEqual(parseDateParam("hello world"), undefined);
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

  it("returns undefined for number type", () => {
    assert.strictEqual(parseDateParam(1704067200000), undefined);
  });

  it("returns undefined for boolean type", () => {
    assert.strictEqual(parseDateParam(true), undefined);
  });

  it("returns undefined for object type", () => {
    assert.strictEqual(parseDateParam({}), undefined);
  });

  it("returns undefined for array type", () => {
    assert.strictEqual(parseDateParam([]), undefined);
  });

  it("handles boundary date: epoch start", () => {
    const result = parseDateParam("1970-01-01T00:00:00Z");
    assert.ok(result instanceof Date);
    assert.strictEqual(result!.getTime(), 0);
  });

  it("handles far-future date", () => {
    const result = parseDateParam("2099-12-31T23:59:59Z");
    assert.ok(result instanceof Date);
    assert.strictEqual(result!.getUTCFullYear(), 2099);
  });
});

describe("safeFloat()", () => {
  let safeFloat: (val: unknown, fallback?: number) => number;

  before(async () => {
    const mod = await import("../server/routes/helpers.js");
    safeFloat = mod.safeFloat;
  });

  it("parses valid float string", () => {
    assert.strictEqual(safeFloat("3.14"), 3.14);
  });

  it("parses integer string", () => {
    assert.strictEqual(safeFloat("42"), 42);
  });

  it("parses actual number", () => {
    assert.strictEqual(safeFloat(7.5), 7.5);
  });

  it("returns fallback for NaN input", () => {
    assert.strictEqual(safeFloat(NaN), 0);
  });

  it("returns fallback for Infinity", () => {
    assert.strictEqual(safeFloat(Infinity), 0);
  });

  it("returns fallback for -Infinity", () => {
    assert.strictEqual(safeFloat(-Infinity), 0);
  });

  it("returns fallback for non-numeric string", () => {
    assert.strictEqual(safeFloat("abc"), 0);
  });

  it("returns custom fallback", () => {
    assert.strictEqual(safeFloat("abc", 5.0), 5.0);
  });

  it("returns fallback for null", () => {
    assert.strictEqual(safeFloat(null), 0);
  });

  it("returns fallback for undefined", () => {
    assert.strictEqual(safeFloat(undefined), 0);
  });

  it("returns fallback for object", () => {
    assert.strictEqual(safeFloat({}), 0);
  });

  it("parses first element from array (String coercion)", () => {
    // String([1,2,3]) = "1,2,3", parseFloat("1,2,3") = 1
    assert.strictEqual(safeFloat([1, 2, 3]), 1);
  });

  it("handles negative numbers", () => {
    assert.strictEqual(safeFloat("-3.5"), -3.5);
  });

  it("handles zero", () => {
    assert.strictEqual(safeFloat("0"), 0);
    assert.strictEqual(safeFloat(0), 0);
  });

  it("handles string with leading/trailing spaces by parsing what it can", () => {
    // parseFloat("  42  ") returns 42
    assert.strictEqual(safeFloat("  42  "), 42);
  });
});

describe("safeInt()", () => {
  let safeInt: (val: unknown, fallback?: number) => number;

  before(async () => {
    const mod = await import("../server/routes/helpers.js");
    safeInt = mod.safeInt;
  });

  it("parses valid integer string", () => {
    assert.strictEqual(safeInt("42"), 42);
  });

  it("truncates float string to integer", () => {
    assert.strictEqual(safeInt("3.14"), 3);
  });

  it("parses actual number", () => {
    assert.strictEqual(safeInt(10), 10);
  });

  it("returns fallback for NaN", () => {
    assert.strictEqual(safeInt(NaN), 0);
  });

  it("returns fallback for Infinity", () => {
    assert.strictEqual(safeInt(Infinity), 0);
  });

  it("returns fallback for -Infinity", () => {
    assert.strictEqual(safeInt(-Infinity), 0);
  });

  it("returns fallback for non-numeric string", () => {
    assert.strictEqual(safeInt("hello"), 0);
  });

  it("returns custom fallback", () => {
    assert.strictEqual(safeInt("hello", 10), 10);
  });

  it("returns fallback for null", () => {
    assert.strictEqual(safeInt(null), 0);
  });

  it("returns fallback for undefined", () => {
    assert.strictEqual(safeInt(undefined), 0);
  });

  it("returns fallback for object", () => {
    assert.strictEqual(safeInt({}), 0);
  });

  it("parses first element from array (String coercion)", () => {
    // String([1,2]) = "1,2", parseInt("1,2") = 1
    assert.strictEqual(safeInt([1, 2]), 1);
  });

  it("handles negative integers", () => {
    assert.strictEqual(safeInt("-7"), -7);
  });

  it("handles zero", () => {
    assert.strictEqual(safeInt("0"), 0);
    assert.strictEqual(safeInt(0), 0);
  });

  it("parses leading digits from mixed string", () => {
    // parseInt("42abc") returns 42
    assert.strictEqual(safeInt("42abc"), 42);
  });
});
