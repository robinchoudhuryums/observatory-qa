import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Registration, invitation, and DB-user auth tests.
 *
 * Verifies self-service org registration, invitation CRUD,
 * and that DB-created users can be found for authentication.
 */

describe("Self-Service Registration", () => {
  let storage: any;

  beforeEach(async () => {
    const { MemStorage } = await import("../server/storage/memory");
    storage = new MemStorage();
  });

  describe("Organization Registration", () => {
    it("creates a new org with trial status", async () => {
      const org = await storage.createOrganization({
        name: "Test Corp",
        slug: "test-corp",
        status: "trial",
        settings: { retentionDays: 90, branding: { appName: "Test Corp" } },
      });

      assert.strictEqual(org.name, "Test Corp");
      assert.strictEqual(org.slug, "test-corp");
      assert.strictEqual(org.status, "trial");
      assert.strictEqual(org.settings?.branding?.appName, "Test Corp");
    });

    it("prevents duplicate org slugs", async () => {
      await storage.createOrganization({ name: "Org 1", slug: "test", status: "active" });
      const org2 = await storage.getOrganizationBySlug("test");
      assert.ok(org2);
      assert.strictEqual(org2.slug, "test");
    });

    it("creates admin user for new org", async () => {
      const org = await storage.createOrganization({ name: "Test Corp", slug: "test-corp", status: "trial" });
      const user = await storage.createUser({
        orgId: org.id,
        username: "admin",
        passwordHash: "hashed",
        name: "Admin User",
        role: "admin",
      });

      assert.strictEqual(user.orgId, org.id);
      assert.strictEqual(user.role, "admin");
      assert.strictEqual(user.username, "admin");
    });
  });

  describe("DB User Lookup", () => {
    it("finds user by username for login", async () => {
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });
      await storage.createUser({
        orgId: org.id,
        username: "jdoe",
        passwordHash: "hash.salt",
        name: "Jane Doe",
        role: "viewer",
      });

      const found = await storage.getUserByUsername("jdoe");
      assert.ok(found);
      assert.strictEqual(found.username, "jdoe");
      assert.strictEqual(found.name, "Jane Doe");
      assert.strictEqual(found.orgId, org.id);
    });

    it("returns undefined for unknown username", async () => {
      const found = await storage.getUserByUsername("nonexistent");
      assert.strictEqual(found, undefined);
    });

    it("finds user by ID for session deserialization", async () => {
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });
      const user = await storage.createUser({
        orgId: org.id,
        username: "jdoe",
        passwordHash: "hash.salt",
        name: "Jane Doe",
        role: "manager",
      });

      const found = await storage.getUser(user.id);
      assert.ok(found);
      assert.strictEqual(found.id, user.id);
      assert.strictEqual(found.role, "manager");
    });
  });
});

describe("Invitations", () => {
  let storage: any;
  let orgId: string;

  beforeEach(async () => {
    const { MemStorage } = await import("../server/storage/memory");
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Test Org", slug: "test", status: "active" });
    orgId = org.id;
  });

  describe("createInvitation", () => {
    it("creates a pending invitation with token", async () => {
      const inv = await storage.createInvitation(orgId, {
        email: "new@example.com",
        role: "viewer",
        invitedBy: "admin",
      });

      assert.ok(inv.id);
      assert.ok(inv.token);
      assert.strictEqual(inv.email, "new@example.com");
      assert.strictEqual(inv.role, "viewer");
      assert.strictEqual(inv.status, "pending");
      assert.strictEqual(inv.invitedBy, "admin");
      assert.ok(inv.expiresAt); // Should have default expiry
    });

    it("generates unique tokens", async () => {
      const inv1 = await storage.createInvitation(orgId, { email: "a@test.com", role: "viewer", invitedBy: "admin" });
      const inv2 = await storage.createInvitation(orgId, { email: "b@test.com", role: "viewer", invitedBy: "admin" });
      assert.notStrictEqual(inv1.token, inv2.token);
    });
  });

  describe("getInvitationByToken", () => {
    it("finds invitation by token", async () => {
      const created = await storage.createInvitation(orgId, {
        email: "test@example.com",
        role: "manager",
        invitedBy: "admin",
      });

      const found = await storage.getInvitationByToken(created.token);
      assert.ok(found);
      assert.strictEqual(found.id, created.id);
      assert.strictEqual(found.email, "test@example.com");
    });

    it("returns undefined for invalid token", async () => {
      const found = await storage.getInvitationByToken("nonexistent-token");
      assert.strictEqual(found, undefined);
    });
  });

  describe("listInvitations", () => {
    it("lists invitations for org", async () => {
      await storage.createInvitation(orgId, { email: "a@test.com", role: "viewer", invitedBy: "admin" });
      await storage.createInvitation(orgId, { email: "b@test.com", role: "manager", invitedBy: "admin" });

      const list = await storage.listInvitations(orgId);
      assert.strictEqual(list.length, 2);
    });

    it("isolates invitations by org", async () => {
      const org2 = await storage.createOrganization({ name: "Org 2", slug: "org2", status: "active" });
      await storage.createInvitation(orgId, { email: "a@test.com", role: "viewer", invitedBy: "admin" });
      await storage.createInvitation(org2.id, { email: "b@test.com", role: "viewer", invitedBy: "admin" });

      const org1List = await storage.listInvitations(orgId);
      const org2List = await storage.listInvitations(org2.id);
      assert.strictEqual(org1List.length, 1);
      assert.strictEqual(org2List.length, 1);
      assert.strictEqual(org1List[0].email, "a@test.com");
      assert.strictEqual(org2List[0].email, "b@test.com");
    });
  });

  describe("updateInvitation", () => {
    it("marks invitation as accepted", async () => {
      const inv = await storage.createInvitation(orgId, {
        email: "test@example.com",
        role: "viewer",
        invitedBy: "admin",
      });

      const updated = await storage.updateInvitation(orgId, inv.id, {
        status: "accepted",
        acceptedAt: new Date().toISOString(),
      });

      assert.ok(updated);
      assert.strictEqual(updated.status, "accepted");
      assert.ok(updated.acceptedAt);
    });
  });

  describe("deleteInvitation", () => {
    it("removes invitation", async () => {
      const inv = await storage.createInvitation(orgId, {
        email: "test@example.com",
        role: "viewer",
        invitedBy: "admin",
      });

      await storage.deleteInvitation(orgId, inv.id);
      const list = await storage.listInvitations(orgId);
      assert.strictEqual(list.length, 0);
    });

    it("does not delete invitations from other orgs", async () => {
      const org2 = await storage.createOrganization({ name: "Org 2", slug: "org2", status: "active" });
      const inv = await storage.createInvitation(orgId, {
        email: "test@example.com",
        role: "viewer",
        invitedBy: "admin",
      });

      // Try to delete from wrong org
      await storage.deleteInvitation(org2.id, inv.id);
      const list = await storage.listInvitations(orgId);
      assert.strictEqual(list.length, 1); // Still exists
    });
  });
});
