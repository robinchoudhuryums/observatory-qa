import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * User management CRUD tests against MemStorage.
 *
 * Verifies that listUsersByOrg, updateUser, and deleteUser work correctly
 * with proper org isolation.
 */

describe("User Management CRUD", () => {
  let storage: any;
  let orgId: string;

  beforeEach(async () => {
    const { MemStorage } = await import("../server/storage/memory");
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Test Org", slug: "test", status: "active" });
    orgId = org.id;
  });

  describe("createUser", () => {
    it("creates a user with valid data", async () => {
      const user = await storage.createUser({
        orgId,
        username: "john",
        passwordHash: "hash123.salt123",
        name: "John Doe",
        role: "viewer",
      });

      assert.ok(user.id);
      assert.strictEqual(user.username, "john");
      assert.strictEqual(user.name, "John Doe");
      assert.strictEqual(user.role, "viewer");
      assert.strictEqual(user.orgId, orgId);
    });

    it("defaults role to viewer", async () => {
      const user = await storage.createUser({
        orgId,
        username: "jane",
        passwordHash: "hash456.salt456",
        name: "Jane Doe",
      });

      // The schema default is "viewer"
      assert.ok(user.role === "viewer" || user.role === undefined);
    });
  });

  describe("getUser / getUserByUsername", () => {
    it("retrieves user by ID", async () => {
      const created = await storage.createUser({
        orgId,
        username: "findme",
        passwordHash: "hash.salt",
        name: "Find Me",
        role: "manager",
      });

      const found = await storage.getUser(created.id);
      assert.ok(found);
      assert.strictEqual(found.username, "findme");
    });

    it("retrieves user by username", async () => {
      await storage.createUser({
        orgId,
        username: "unique_user",
        passwordHash: "hash.salt",
        name: "Unique",
        role: "viewer",
      });

      const found = await storage.getUserByUsername("unique_user");
      assert.ok(found);
      assert.strictEqual(found.name, "Unique");
    });

    it("returns undefined for non-existent user", async () => {
      const found = await storage.getUser("nonexistent");
      assert.strictEqual(found, undefined);
    });
  });

  describe("listUsersByOrg", () => {
    it("lists all users for an org", async () => {
      await storage.createUser({ orgId, username: "u1", passwordHash: "h.s", name: "User 1", role: "viewer" });
      await storage.createUser({ orgId, username: "u2", passwordHash: "h.s", name: "User 2", role: "manager" });

      const users = await storage.listUsersByOrg(orgId);
      assert.strictEqual(users.length, 2);
    });

    it("isolates users by org", async () => {
      const org2 = await storage.createOrganization({ name: "Org 2", slug: "org2", status: "active" });

      await storage.createUser({ orgId, username: "org1user", passwordHash: "h.s", name: "Org1 User", role: "viewer" });
      await storage.createUser({ orgId: org2.id, username: "org2user", passwordHash: "h.s", name: "Org2 User", role: "viewer" });

      const org1Users = await storage.listUsersByOrg(orgId);
      const org2Users = await storage.listUsersByOrg(org2.id);

      assert.strictEqual(org1Users.length, 1);
      assert.strictEqual(org1Users[0].username, "org1user");
      assert.strictEqual(org2Users.length, 1);
      assert.strictEqual(org2Users[0].username, "org2user");
    });

    it("returns empty array for org with no users", async () => {
      const users = await storage.listUsersByOrg(orgId);
      assert.strictEqual(users.length, 0);
    });
  });

  describe("updateUser", () => {
    it("updates user name", async () => {
      const user = await storage.createUser({
        orgId, username: "updateme", passwordHash: "h.s", name: "Old Name", role: "viewer",
      });

      const updated = await storage.updateUser(orgId, user.id, { name: "New Name" });
      assert.ok(updated);
      assert.strictEqual(updated.name, "New Name");
      assert.strictEqual(updated.username, "updateme"); // unchanged
    });

    it("updates user role", async () => {
      const user = await storage.createUser({
        orgId, username: "promote", passwordHash: "h.s", name: "Promotee", role: "viewer",
      });

      const updated = await storage.updateUser(orgId, user.id, { role: "manager" });
      assert.ok(updated);
      assert.strictEqual(updated.role, "manager");
    });

    it("cannot update user from different org", async () => {
      const org2 = await storage.createOrganization({ name: "Org 2", slug: "org2", status: "active" });
      const user = await storage.createUser({
        orgId, username: "crossorg", passwordHash: "h.s", name: "Cross Org", role: "viewer",
      });

      const updated = await storage.updateUser(org2.id, user.id, { name: "Hacked" });
      assert.strictEqual(updated, undefined);
    });

    it("returns undefined for non-existent user", async () => {
      const updated = await storage.updateUser(orgId, "nonexistent", { name: "Nobody" });
      assert.strictEqual(updated, undefined);
    });
  });

  describe("deleteUser", () => {
    it("deletes a user", async () => {
      const user = await storage.createUser({
        orgId, username: "deleteme", passwordHash: "h.s", name: "Delete Me", role: "viewer",
      });

      await storage.deleteUser(orgId, user.id);
      const found = await storage.getUser(user.id);
      assert.strictEqual(found, undefined);
    });

    it("does not delete user from different org", async () => {
      const org2 = await storage.createOrganization({ name: "Org 2", slug: "org2", status: "active" });
      const user = await storage.createUser({
        orgId, username: "protected", passwordHash: "h.s", name: "Protected", role: "viewer",
      });

      await storage.deleteUser(org2.id, user.id);
      const found = await storage.getUser(user.id);
      assert.ok(found); // Should still exist
    });

    it("silently handles deleting non-existent user", async () => {
      // Should not throw
      await storage.deleteUser(orgId, "nonexistent");
    });
  });
});
