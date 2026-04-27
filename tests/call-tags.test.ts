/**
 * Tests for the Tier 1A call-tags + annotations module.
 *
 * Coverage:
 *   - Tag validation regex + normalization (lowercase, trim)
 *   - Tag length boundary
 *   - Annotation timestampMs + text validation
 *   - Schema-level multi-tenancy invariants
 *
 * Storage CRUD integration tests require a test DB harness and are
 * deliberately out of scope here — the storage module's behavior is
 * straightforward Drizzle SQL with org-scoped predicates.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { callTags, annotations } from "@shared/schema";

// --- Validation rules — kept in sync with server/routes/call-tags.ts ---
// If the inline regex/limits in the routes file change, update these too
// (or extract to a shared util module).
const TAG_PATTERN = /^[a-z0-9][a-z0-9 _./-]*$/;
const MAX_TAG_LEN = 100;
const MAX_ANNOTATION_LEN = 2000;

/**
 * Normalize a tag the same way the route handler does: trim + lowercase.
 * Pure function so we can test the contract directly.
 */
function normalizeTag(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Check whether a normalized tag string passes validation.
 */
function isValidNormalizedTag(tag: string): boolean {
  if (tag.length === 0 || tag.length > MAX_TAG_LEN) return false;
  return TAG_PATTERN.test(tag);
}

/**
 * Validate annotation input shape, mirroring the route handler.
 */
function isValidAnnotationInput(timestampMs: unknown, text: unknown): boolean {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs < 0) return false;
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ANNOTATION_LEN) return false;
  return true;
}

describe("call-tags — tag validation", () => {
  it("normalizes whitespace and case", () => {
    assert.equal(normalizeTag("  Compliance  "), "compliance");
    assert.equal(normalizeTag("Customer.Service"), "customer.service");
  });

  it("accepts simple alphanumeric tags", () => {
    assert.ok(isValidNormalizedTag("compliance"));
    assert.ok(isValidNormalizedTag("priority1"));
    assert.ok(isValidNormalizedTag("2024audit"));
  });

  it("accepts tags with allowed punctuation", () => {
    assert.ok(isValidNormalizedTag("customer-service"));
    assert.ok(isValidNormalizedTag("hipaa.compliance"));
    assert.ok(isValidNormalizedTag("training/module-1"));
    assert.ok(isValidNormalizedTag("priority_high"));
    assert.ok(isValidNormalizedTag("multi word tag"));
  });

  it("rejects empty tags", () => {
    assert.equal(isValidNormalizedTag(""), false);
  });

  it("rejects tags that start with a non-alphanumeric character", () => {
    assert.equal(isValidNormalizedTag("-leading-dash"), false);
    assert.equal(isValidNormalizedTag(".leading-dot"), false);
    assert.equal(isValidNormalizedTag(" leading-space"), false);
    assert.equal(isValidNormalizedTag("/leading-slash"), false);
  });

  it("rejects tags with disallowed characters", () => {
    assert.equal(isValidNormalizedTag("with@symbol"), false);
    assert.equal(isValidNormalizedTag("with!exclamation"), false);
    assert.equal(isValidNormalizedTag("with(paren)"), false);
    assert.equal(isValidNormalizedTag("with;semicolon"), false);
    assert.equal(isValidNormalizedTag("with#hash"), false);
  });

  it("rejects tags exceeding 100 characters", () => {
    const justOk = "a".repeat(MAX_TAG_LEN);
    const tooLong = "a".repeat(MAX_TAG_LEN + 1);
    assert.ok(isValidNormalizedTag(justOk));
    assert.equal(isValidNormalizedTag(tooLong), false);
  });

  it("treats uppercase as invalid post-normalization (callers must normalize first)", () => {
    // Defensive: even though the route normalizes via .toLowerCase() before
    // validation, this test pins the contract so a future caller that
    // bypasses normalization fails loudly.
    assert.equal(isValidNormalizedTag("Compliance"), false);
  });
});

describe("call-tags — annotation validation", () => {
  it("accepts a valid annotation", () => {
    assert.ok(isValidAnnotationInput(0, "First moment"));
    assert.ok(isValidAnnotationInput(125_000, "Customer asks about pricing"));
    assert.ok(isValidAnnotationInput(60_000, "  trimmed  "));
  });

  it("rejects negative timestampMs", () => {
    assert.equal(isValidAnnotationInput(-1, "any"), false);
  });

  it("rejects non-finite timestampMs", () => {
    assert.equal(isValidAnnotationInput(Infinity, "x"), false);
    assert.equal(isValidAnnotationInput(NaN, "x"), false);
  });

  it("rejects non-numeric timestampMs", () => {
    assert.equal(isValidAnnotationInput("100", "x"), false);
    assert.equal(isValidAnnotationInput(null, "x"), false);
    assert.equal(isValidAnnotationInput(undefined, "x"), false);
  });

  it("rejects empty / whitespace-only text", () => {
    assert.equal(isValidAnnotationInput(0, ""), false);
    assert.equal(isValidAnnotationInput(0, "   "), false);
  });

  it("rejects text longer than 2000 chars", () => {
    const justOk = "x".repeat(MAX_ANNOTATION_LEN);
    const tooLong = "x".repeat(MAX_ANNOTATION_LEN + 1);
    assert.ok(isValidAnnotationInput(0, justOk));
    assert.equal(isValidAnnotationInput(0, tooLong), false);
  });

  it("rejects non-string text", () => {
    assert.equal(isValidAnnotationInput(0, 12345 as unknown), false);
    assert.equal(isValidAnnotationInput(0, { text: "wrong shape" } as unknown), false);
  });
});

describe("call-tags — schema invariants", () => {
  it("call_tags table includes orgId column for multi-tenant scoping", () => {
    // Drizzle's $inferSelect / column metadata makes this introspectable.
    // Touch the column to fail loudly if it ever gets removed.
    assert.ok(callTags.orgId, "callTags.orgId must exist for multi-tenant isolation");
    assert.ok(callTags.callId, "callTags.callId must exist");
    assert.ok(callTags.tag, "callTags.tag must exist");
    assert.ok(callTags.createdBy, "callTags.createdBy must exist for author-or-manager delete check");
  });

  it("annotations table includes orgId column for multi-tenant scoping", () => {
    assert.ok(annotations.orgId, "annotations.orgId must exist for multi-tenant isolation");
    assert.ok(annotations.callId, "annotations.callId must exist");
    assert.ok(annotations.timestampMs, "annotations.timestampMs must exist");
    assert.ok(annotations.text, "annotations.text must exist");
    assert.ok(annotations.author, "annotations.author must exist for author-or-manager delete check");
  });
});
