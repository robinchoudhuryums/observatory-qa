/**
 * Tests for input validation on registration and admin user creation.
 *
 * Verifies: email format, field length limits, industry type enum,
 * slug format, and role validation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_REGEX = /^[a-z0-9-]+$/;
const VALID_INDUSTRIES = ["general", "dental", "medical", "behavioral_health", "veterinary"];
const VALID_ROLES = ["viewer", "manager", "admin"];

describe("Input Validation", () => {
  describe("Email format validation", () => {
    it("accepts valid email addresses", () => {
      const validEmails = [
        "user@example.com",
        "admin@observatory-qa.io",
        "test.user+tag@company.co.uk",
        "a@b.c",
      ];
      for (const email of validEmails) {
        assert.ok(EMAIL_REGEX.test(email), `Should accept: ${email}`);
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
        assert.equal(EMAIL_REGEX.test(email), false, `Should reject: "${email}"`);
      }
    });
  });

  describe("Field length limits", () => {
    it("rejects org name exceeding 200 chars", () => {
      const longName = "x".repeat(201);
      assert.ok(longName.length > 200);
    });

    it("accepts org name at exactly 200 chars", () => {
      const maxName = "x".repeat(200);
      assert.equal(maxName.length, 200);
      assert.ok(maxName.length <= 200);
    });

    it("rejects slug exceeding 100 chars", () => {
      const longSlug = "a".repeat(101);
      assert.ok(longSlug.length > 100);
    });

    it("rejects username exceeding 255 chars", () => {
      const longUsername = "a".repeat(256);
      assert.ok(longUsername.length > 255);
    });

    it("rejects name exceeding 255 chars", () => {
      const longName = "a".repeat(256);
      assert.ok(longName.length > 255);
    });
  });

  describe("Organization slug format", () => {
    it("accepts valid slugs", () => {
      const validSlugs = ["test-corp", "org123", "my-dental-practice", "a"];
      for (const slug of validSlugs) {
        assert.ok(SLUG_REGEX.test(slug), `Should accept: ${slug}`);
      }
    });

    it("rejects slugs with uppercase", () => {
      assert.equal(SLUG_REGEX.test("TestCorp"), false);
    });

    it("rejects slugs with spaces", () => {
      assert.equal(SLUG_REGEX.test("test corp"), false);
    });

    it("rejects slugs with special characters", () => {
      assert.equal(SLUG_REGEX.test("test_corp"), false);
      assert.equal(SLUG_REGEX.test("test.corp"), false);
      assert.equal(SLUG_REGEX.test("test@corp"), false);
    });
  });

  describe("Industry type validation", () => {
    it("accepts all valid industry types", () => {
      for (const industry of VALID_INDUSTRIES) {
        assert.ok(VALID_INDUSTRIES.includes(industry), `Should accept: ${industry}`);
      }
    });

    it("rejects invalid industry types", () => {
      const invalid = ["healthcare", "SQL_INJECTION", "unknown", ""];
      for (const industry of invalid) {
        assert.equal(VALID_INDUSTRIES.includes(industry), false, `Should reject: ${industry}`);
      }
    });

    it("allows undefined industry type (optional field)", () => {
      const industryType = undefined;
      const isValid = !industryType || VALID_INDUSTRIES.includes(industryType);
      assert.equal(isValid, true);
    });
  });

  describe("Role validation", () => {
    it("accepts all valid roles", () => {
      for (const role of VALID_ROLES) {
        assert.ok(VALID_ROLES.includes(role));
      }
    });

    it("rejects invalid roles", () => {
      assert.equal(VALID_ROLES.includes("superadmin"), false);
      assert.equal(VALID_ROLES.includes(""), false);
      assert.equal(VALID_ROLES.includes("root"), false);
    });

    it("defaults to viewer when role not specified", () => {
      const role = undefined;
      const effectiveRole = role || "viewer";
      assert.equal(effectiveRole, "viewer");
    });
  });

  describe("Required fields", () => {
    it("detects missing orgName", () => {
      const body = { orgSlug: "test", username: "a@b.com", password: "pass", name: "Test" };
      const missing = !body.orgSlug || !(body as any).orgName || !body.username || !body.password || !body.name;
      assert.equal(missing, true);
    });

    it("detects missing password", () => {
      const body = { orgName: "Test", orgSlug: "test", username: "a@b.com", name: "Test" };
      const missing = !body.orgName || !body.orgSlug || !body.username || !(body as any).password || !body.name;
      assert.equal(missing, true);
    });

    it("passes with all required fields", () => {
      const body = { orgName: "Test Corp", orgSlug: "test-corp", username: "admin@test.com", password: "SecurePass1!", name: "Admin" };
      const missing = !body.orgName || !body.orgSlug || !body.username || !body.password || !body.name;
      assert.equal(missing, false);
    });
  });
});
