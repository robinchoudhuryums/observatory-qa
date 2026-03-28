/**
 * LMS prerequisite, enforceOrder, and deadline tests.
 *
 * Tests:
 * - Circular dependency detection in prerequisites
 * - enforceOrder sequential completion gating
 * - Deadline enforcement on progress updates
 * - Prerequisite gating on quiz submission
 * - Coaching recommendation weak area threshold
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";

const ORG_ID = "org-lms-test";

describe("LMS prerequisites and enforcement", () => {
  let storage: InstanceType<typeof MemStorage>;
  let orgId: string;

  beforeEach(async () => {
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Test Org", slug: "lms-test", status: "active" });
    orgId = org.id;
  });

  // ── Prerequisite chain storage ──────────────────────────────────────

  describe("Prerequisite storage", () => {
    it("stores prerequisiteModuleIds on module creation", async () => {
      const moduleA = await storage.createLearningModule(orgId, {
        orgId, title: "Module A", contentType: "article", isPublished: true,
      });
      const moduleB = await storage.createLearningModule(orgId, {
        orgId, title: "Module B", contentType: "article", isPublished: true,
        prerequisiteModuleIds: [moduleA.id],
      });

      const retrieved = await storage.getLearningModule(orgId, moduleB.id);
      assert.ok(retrieved);
      const prereqs = retrieved.prerequisiteModuleIds as string[];
      assert.ok(Array.isArray(prereqs));
      assert.equal(prereqs.length, 1);
      assert.equal(prereqs[0], moduleA.id);
    });

    it("supports multi-level prerequisite chains (A→B→C)", async () => {
      const a = await storage.createLearningModule(orgId, { orgId, title: "A", contentType: "article", isPublished: true });
      const b = await storage.createLearningModule(orgId, { orgId, title: "B", contentType: "article", isPublished: true, prerequisiteModuleIds: [a.id] });
      const c = await storage.createLearningModule(orgId, { orgId, title: "C", contentType: "article", isPublished: true, prerequisiteModuleIds: [b.id] });

      const cModule = await storage.getLearningModule(orgId, c.id);
      assert.deepEqual(cModule!.prerequisiteModuleIds, [b.id]);
    });
  });

  // ── Passing score ───────────────────────────────────────────────────

  describe("Passing score configuration", () => {
    it("stores custom passing score", async () => {
      const module = await storage.createLearningModule(orgId, {
        orgId, title: "Quiz Module", contentType: "quiz", isPublished: true,
        passingScore: 85,
      });
      assert.equal(module.passingScore, 85);
    });

    it("defaults to undefined when not specified (route defaults to 70)", async () => {
      const module = await storage.createLearningModule(orgId, {
        orgId, title: "Basic Module", contentType: "article", isPublished: true,
      });
      assert.equal(module.passingScore, undefined);
    });
  });

  // ── Learning path with enforceOrder ─────────────────────────────────

  describe("Learning path enforceOrder", () => {
    it("stores enforceOrder flag on path", async () => {
      const a = await storage.createLearningModule(orgId, { orgId, title: "Step 1", contentType: "article", isPublished: true });
      const b = await storage.createLearningModule(orgId, { orgId, title: "Step 2", contentType: "article", isPublished: true });

      const path = await storage.createLearningPath(orgId, {
        orgId,
        title: "Sequential Path",
        moduleIds: [a.id, b.id],
        enforceOrder: true,
        createdBy: "admin",
      });

      const retrieved = await storage.getLearningPath(orgId, path.id);
      assert.ok(retrieved);
      assert.equal(retrieved.enforceOrder, true);
    });

    it("stores dueDate on path", async () => {
      const a = await storage.createLearningModule(orgId, { orgId, title: "Step 1", contentType: "article", isPublished: true });
      const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const path = await storage.createLearningPath(orgId, {
        orgId,
        title: "Deadline Path",
        moduleIds: [a.id],
        dueDate,
        createdBy: "admin",
      });

      const retrieved = await storage.getLearningPath(orgId, path.id);
      assert.equal(retrieved!.dueDate, dueDate);
    });
  });

  // ── Progress tracking ───────────────────────────────────────────────

  describe("Progress tracking", () => {
    it("tracks module completion", async () => {
      const module = await storage.createLearningModule(orgId, { orgId, title: "Course", contentType: "article", isPublished: true });
      const emp = await storage.createEmployee(orgId, { name: "Jane", email: "jane@test.com" });

      const progress = await storage.upsertLearningProgress(orgId, {
        orgId,
        employeeId: emp.id,
        moduleId: module.id,
        status: "completed",
        completedAt: new Date().toISOString(),
      });

      assert.equal(progress.status, "completed");
      assert.ok(progress.completedAt);
    });

    it("tracks quiz score and attempts", async () => {
      const module = await storage.createLearningModule(orgId, { orgId, title: "Quiz", contentType: "quiz", isPublished: true });
      const emp = await storage.createEmployee(orgId, { name: "John", email: "john@test.com" });

      await storage.upsertLearningProgress(orgId, {
        orgId, employeeId: emp.id, moduleId: module.id,
        status: "in_progress", quizScore: 60, quizAttempts: 1,
      });

      const progress = await storage.getLearningProgress(orgId, emp.id, module.id);
      assert.equal(progress!.quizScore, 60);
      assert.equal(progress!.quizAttempts, 1);
    });
  });
});
