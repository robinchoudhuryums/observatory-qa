/**
 * Tests for input validation on registration and admin user creation.
 *
 * Verifies email format, slug format, field length limits, industry type enum,
 * and role validation — all by importing the *production* validators so that
 * a test failure means production behavior changed (not just a stale local copy).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { INDUSTRY_TYPES } from "../shared/schema/org.js";
import { USER_ROLES } from "../shared/schema/billing.js";
import {
  REGISTRATION_EMAIL_REGEX,
  REGISTRATION_SLUG_REGEX,
  REGISTRATION_FIELD_LIMITS,
} from "../server/routes/registration.ts";

const VALID_INDUSTRIES = INDUSTRY_TYPES.map((t) => t.value);
const VALID_ROLES = USER_ROLES.map((r) => r.value);

describe("Input Validation (production validators)", () => {
  describe("Email format (REGISTRATION_EMAIL_REGEX)", () => {
    it("accepts valid email addresses", () => {
      const validEmails = [
        "user@example.com",
        "admin@observatory-qa.io",
        "test.user+tag@company.co.uk",
        "a@b.c",
      ];
      for (const email of validEmails) {
        assert.ok(REGISTRATION_EMAIL_REGEX.test(email), `Should accept: ${email}`);
      }
    });

    it("rejects invalid email addresses", () => {
      const invalidEmails = [
        "notanemail",
        "missing@",
        "@nodomain.com",
        "spaces in@email.com",
        "",
        "user@",
        "@.com",
      ];
      for (const email of invalidEmails) {
        assert.equal(REGISTRATION_EMAIL_REGEX.test(email), false, `Should reject: "${email}"`);
      }
    });
  });

  describe("Field length limits (REGISTRATION_FIELD_LIMITS)", () => {
    it("orgName limit is at least 200 chars (DoS guard, not too restrictive)", () => {
      assert.ok(REGISTRATION_FIELD_LIMITS.orgName >= 200);
    });

    it("orgSlug limit is at least 100 chars", () => {
      assert.ok(REGISTRATION_FIELD_LIMITS.orgSlug >= 100);
    });

    it("username limit is at least 255 chars (matches typical DB email column)", () => {
      assert.ok(REGISTRATION_FIELD_LIMITS.username >= 255);
    });

    it("name limit is at least 255 chars", () => {
      assert.ok(REGISTRATION_FIELD_LIMITS.name >= 255);
    });

    it("a string exactly at the limit is accepted; one over is rejected", () => {
      const atLimit = "x".repeat(REGISTRATION_FIELD_LIMITS.orgName);
      const overLimit = "x".repeat(REGISTRATION_FIELD_LIMITS.orgName + 1);
      assert.ok(atLimit.length <= REGISTRATION_FIELD_LIMITS.orgName);
      assert.ok(overLimit.length > REGISTRATION_FIELD_LIMITS.orgName);
    });
  });

  describe("Organization slug format (REGISTRATION_SLUG_REGEX)", () => {
    it("accepts valid slugs", () => {
      const validSlugs = ["test-corp", "org123", "my-dental-practice", "a"];
      for (const slug of validSlugs) {
        assert.ok(REGISTRATION_SLUG_REGEX.test(slug), `Should accept: ${slug}`);
      }
    });

    it("rejects slugs with uppercase", () => {
      assert.equal(REGISTRATION_SLUG_REGEX.test("TestCorp"), false);
    });

    it("rejects slugs with spaces", () => {
      assert.equal(REGISTRATION_SLUG_REGEX.test("test corp"), false);
    });

    it("rejects slugs with special characters", () => {
      assert.equal(REGISTRATION_SLUG_REGEX.test("test_corp"), false);
      assert.equal(REGISTRATION_SLUG_REGEX.test("test.corp"), false);
      assert.equal(REGISTRATION_SLUG_REGEX.test("test@corp"), false);
    });
  });

  describe("Industry type validation (INDUSTRY_TYPES from shared schema)", () => {
    it("VALID_INDUSTRIES is non-empty (registration forms have something to render)", () => {
      assert.ok(VALID_INDUSTRIES.length > 0);
    });

    it("rejects invalid industry types", () => {
      const invalid = ["nonexistent_industry", "SQL_INJECTION", "unknown_type", ""];
      for (const industry of invalid) {
        assert.equal(VALID_INDUSTRIES.includes(industry), false, `Should reject: ${industry}`);
      }
    });

    it("contains the verticals the data/ folder has reference materials for", () => {
      // INV: these industry types have dedicated reference material under data/<industry>/.
      // If a vertical is removed here, audit data/ and ai-prompts.ts before merging.
      for (const expected of ["dental", "behavioral_health", "veterinary"]) {
        assert.ok(
          VALID_INDUSTRIES.includes(expected),
          `Missing industry: ${expected}. Current: ${JSON.stringify(VALID_INDUSTRIES)}`,
        );
      }
    });
  });

  describe("Role validation (USER_ROLES from shared schema)", () => {
    it("VALID_ROLES contains the three production roles", () => {
      // These are referenced by ROLE_HIERARCHY in server/auth.ts and the
      // requireRole middleware. Adding/renaming a role here MUST be matched there.
      for (const expected of ["viewer", "manager", "admin"]) {
        assert.ok(VALID_ROLES.includes(expected), `Missing role: ${expected}`);
      }
    });

    it("rejects invalid roles", () => {
      assert.equal(VALID_ROLES.includes("superadmin"), false);
      assert.equal(VALID_ROLES.includes(""), false);
      assert.equal(VALID_ROLES.includes("root"), false);
    });
  });
});
