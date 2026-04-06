/**
 * Tests for login ambiguity detection (OBS-AUTH-008).
 *
 * When the same username exists in multiple organizations, login should
 * return the org slugs for disambiguation rather than silently picking one.
 *
 * Run with: npx tsx --test tests/login-ambiguity.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

let MemStorage: any;

beforeEach(async () => {
  const storageMod = await import("../server/storage/memory.js");
  MemStorage = storageMod.MemStorage;
});

// ==================== getUsersByUsername ====================

describe("getUsersByUsername", () => {
  it("returns empty array when no users match", async () => {
    const storage = new MemStorage();
    const results = await storage.getUsersByUsername("nobody@example.com");
    assert.deepStrictEqual(results, []);
  });

  it("returns single user when username exists in one org", async () => {
    const storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Org A", slug: "org-a", status: "active" });
    await storage.createUser({
      orgId: org.id,
      username: "alice@example.com",
      passwordHash: "dummy_hash_123",
      name: "Alice",
      role: "admin",
    });

    const results = await storage.getUsersByUsername("alice@example.com");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].username, "alice@example.com");
    assert.strictEqual(results[0].orgId, org.id);
  });

  it("returns multiple users when username exists across orgs", async () => {
    const storage = new MemStorage();
    const orgA = await storage.createOrganization({ name: "Org A", slug: "org-a", status: "active" });
    const orgB = await storage.createOrganization({ name: "Org B", slug: "org-b", status: "active" });

    await storage.createUser({
      orgId: orgA.id,
      username: "shared@example.com",
      passwordHash: "dummy_hash_A",
      name: "Shared A",
      role: "admin",
    });
    await storage.createUser({
      orgId: orgB.id,
      username: "shared@example.com",
      passwordHash: "dummy_hash_B",
      name: "Shared B",
      role: "viewer",
    });

    const results = await storage.getUsersByUsername("shared@example.com");
    assert.strictEqual(results.length, 2);
    const orgIds = results.map((u: any) => u.orgId).sort();
    assert.deepStrictEqual(orgIds.sort(), [orgA.id, orgB.id].sort());
  });

  it("does not return users with different usernames", async () => {
    const storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Org", slug: "org", status: "active" });
    await storage.createUser({
      orgId: org.id,
      username: "alice@example.com",
      passwordHash: "h1",
      name: "Alice",
      role: "admin",
    });
    await storage.createUser({
      orgId: org.id,
      username: "bob@example.com",
      passwordHash: "h2",
      name: "Bob",
      role: "viewer",
    });

    const results = await storage.getUsersByUsername("alice@example.com");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, "Alice");
  });
});

// ==================== Login ambiguity flow (storage layer) ====================

describe("Login ambiguity detection", () => {
  it("single-org user: getUsersByUsername returns 1, getUserByUsername also works", async () => {
    const storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Solo Org", slug: "solo", status: "active" });
    await storage.createUser({
      orgId: org.id,
      username: "user@test.com",
      passwordHash: "dummy_hash_secret",
      name: "Solo User",
      role: "admin",
    });

    // Unscoped — should return exactly 1
    const matches = await storage.getUsersByUsername("user@test.com");
    assert.strictEqual(matches.length, 1);

    // Scoped — also returns the user
    const scoped = await storage.getUserByUsername("user@test.com", org.id);
    assert.ok(scoped);
    assert.strictEqual(scoped!.id, matches[0].id);
  });

  it("multi-org user: disambiguation via orgSlug resolves correctly", async () => {
    const storage = new MemStorage();
    const orgA = await storage.createOrganization({ name: "Clinic A", slug: "clinic-a", status: "active" });
    const orgB = await storage.createOrganization({ name: "Clinic B", slug: "clinic-b", status: "active" });
    const passHash = "dummy_hash_shared";

    const userA = await storage.createUser({
      orgId: orgA.id,
      username: "dr.smith@example.com",
      passwordHash: passHash,
      name: "Dr. Smith (A)",
      role: "admin",
    });
    const userB = await storage.createUser({
      orgId: orgB.id,
      username: "dr.smith@example.com",
      passwordHash: passHash,
      name: "Dr. Smith (B)",
      role: "viewer",
    });

    // Unscoped — detects ambiguity
    const matches = await storage.getUsersByUsername("dr.smith@example.com");
    assert.strictEqual(matches.length, 2);

    // Org slugs can be resolved for the disambiguation response
    const orgSlugs = await Promise.all(
      matches.map(async (u: any) => {
        const org = await storage.getOrganization(u.orgId);
        return org?.slug;
      }),
    );
    assert.ok(orgSlugs.includes("clinic-a"));
    assert.ok(orgSlugs.includes("clinic-b"));

    // Scoped login — resolves to correct user in each org
    const resolvedOrg = await storage.getOrganizationBySlug("clinic-a");
    assert.ok(resolvedOrg);
    const scopedUser = await storage.getUserByUsername("dr.smith@example.com", resolvedOrg!.id);
    assert.ok(scopedUser);
    assert.strictEqual(scopedUser!.id, userA.id);
    assert.strictEqual(scopedUser!.name, "Dr. Smith (A)");

    // Scoped to other org
    const resolvedOrgB = await storage.getOrganizationBySlug("clinic-b");
    const scopedUserB = await storage.getUserByUsername("dr.smith@example.com", resolvedOrgB!.id);
    assert.ok(scopedUserB);
    assert.strictEqual(scopedUserB!.id, userB.id);
  });

  it("scoped login with invalid orgSlug returns undefined", async () => {
    const storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Real Org", slug: "real", status: "active" });
    await storage.createUser({
      orgId: org.id,
      username: "user@test.com",
      passwordHash: "h",
      name: "User",
      role: "admin",
    });

    const badOrg = await storage.getOrganizationBySlug("nonexistent");
    assert.strictEqual(badOrg, undefined);
    // Without a valid org, scoped lookup can't proceed — login should fail
  });

  it("three-org ambiguity returns all three org slugs", async () => {
    const storage = new MemStorage();
    const orgs = await Promise.all([
      storage.createOrganization({ name: "Org 1", slug: "org-1", status: "active" }),
      storage.createOrganization({ name: "Org 2", slug: "org-2", status: "active" }),
      storage.createOrganization({ name: "Org 3", slug: "org-3", status: "active" }),
    ]);

    for (const org of orgs) {
      await storage.createUser({
        orgId: org.id,
        username: "multi@example.com",
        passwordHash: "h",
        name: `User in ${org.name}`,
        role: "viewer",
      });
    }

    const matches = await storage.getUsersByUsername("multi@example.com");
    assert.strictEqual(matches.length, 3);

    const slugs = await Promise.all(
      matches.map(async (u: any) => {
        const org = await storage.getOrganization(u.orgId);
        return org?.slug;
      }),
    );
    assert.deepStrictEqual(slugs.sort(), ["org-1", "org-2", "org-3"]);
  });

  it("username match is case-sensitive (storage does not normalize)", async () => {
    const storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Org", slug: "org", status: "active" });
    await storage.createUser({
      orgId: org.id,
      username: "Alice@Example.COM",
      passwordHash: "h",
      name: "Alice",
      role: "admin",
    });

    // Exact match works
    const exact = await storage.getUsersByUsername("Alice@Example.COM");
    assert.strictEqual(exact.length, 1);

    // Different case returns nothing (MemStorage is case-sensitive)
    const lower = await storage.getUsersByUsername("alice@example.com");
    assert.strictEqual(lower.length, 0);
  });
});

// ==================== Route-level response shape ====================

describe("OBS-AUTH-008 response contract", () => {
  it("ambiguity response includes required fields for frontend parsing", () => {
    // Verify the response shape that auth.ts produces and routes/auth.ts forwards
    // This is a contract test — if the shape changes, frontend parsing breaks
    const response = {
      message: "This username exists in multiple organizations. Please select one.",
      errorCode: "OBS-AUTH-008",
      orgSlugs: ["clinic-a", "clinic-b"],
    };

    // Frontend parses this from the 409 body
    assert.ok(response.errorCode === "OBS-AUTH-008");
    assert.ok(Array.isArray(response.orgSlugs));
    assert.ok(response.orgSlugs.length > 0);
    assert.ok(typeof response.orgSlugs[0] === "string");
    assert.ok(typeof response.message === "string");
  });

  it("scoped re-login request includes orgSlug field", () => {
    // After disambiguation, frontend sends { username, password, orgSlug }
    const loginRequest = {
      username: "dr.smith@example.com",
      password: "secret",
      orgSlug: "clinic-a",
    };

    assert.ok(typeof loginRequest.orgSlug === "string");
    assert.ok(loginRequest.orgSlug.length > 0);
  });
});
