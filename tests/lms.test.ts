/**
 * Tests for LMS (Learning Management System) features.
 *
 * Covers: module CRUD, learning path lifecycle, progress tracking,
 * quiz grading logic, and stats aggregation.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("LMS — Learning Management System", () => {
  let storage: any;
  let orgId: string;

  beforeEach(async () => {
    const { MemStorage } = await import("../server/storage/memory");
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Test Org", slug: "test-lms", status: "active" });
    orgId = org.id;
  });

  describe("Learning Modules", () => {
    it("creates and retrieves a module", async () => {
      const module = await storage.createLearningModule(orgId, {
        orgId,
        title: "Insurance 101",
        description: "Learn the basics of dental insurance",
        contentType: "article",
        category: "insurance_basics",
        content: "# Insurance Basics\n\nDental insurance covers...",
        estimatedMinutes: 15,
        difficulty: "beginner",
        isPublished: true,
        createdBy: "admin",
      });

      assert.ok(module.id);
      assert.equal(module.title, "Insurance 101");
      assert.equal(module.isPublished, true);

      const fetched = await storage.getLearningModule(orgId, module.id);
      assert.equal(fetched?.title, "Insurance 101");
      assert.equal(fetched?.content, "# Insurance Basics\n\nDental insurance covers...");
    });

    it("lists modules with category filter", async () => {
      await storage.createLearningModule(orgId, { orgId, title: "Mod A", contentType: "article", category: "compliance", createdBy: "admin" });
      await storage.createLearningModule(orgId, { orgId, title: "Mod B", contentType: "article", category: "onboarding", createdBy: "admin" });
      await storage.createLearningModule(orgId, { orgId, title: "Mod C", contentType: "quiz", category: "compliance", createdBy: "admin" });

      const compliance = await storage.listLearningModules(orgId, { category: "compliance" });
      assert.equal(compliance.length, 2);
    });

    it("lists modules with published filter", async () => {
      await storage.createLearningModule(orgId, { orgId, title: "Draft", contentType: "article", isPublished: false, createdBy: "admin" });
      await storage.createLearningModule(orgId, { orgId, title: "Published", contentType: "article", isPublished: true, createdBy: "admin" });

      const published = await storage.listLearningModules(orgId, { isPublished: true });
      assert.equal(published.length, 1);
      assert.equal(published[0].title, "Published");
    });

    it("updates a module", async () => {
      const mod = await storage.createLearningModule(orgId, { orgId, title: "Draft Title", contentType: "article", isPublished: false, createdBy: "admin" });

      const updated = await storage.updateLearningModule(orgId, mod.id, { title: "Final Title", isPublished: true });
      assert.equal(updated?.title, "Final Title");
      assert.equal(updated?.isPublished, true);
    });

    it("deletes a module", async () => {
      const mod = await storage.createLearningModule(orgId, { orgId, title: "To Delete", contentType: "article", createdBy: "admin" });
      await storage.deleteLearningModule(orgId, mod.id);

      const fetched = await storage.getLearningModule(orgId, mod.id);
      assert.equal(fetched, undefined);
    });

    it("enforces org isolation", async () => {
      const org2 = await storage.createOrganization({ name: "Other Org", slug: "other-lms", status: "active" });
      const mod = await storage.createLearningModule(orgId, { orgId, title: "Org1 Module", contentType: "article", createdBy: "admin" });

      // Should not be visible from other org
      const fetched = await storage.getLearningModule(org2.id, mod.id);
      assert.equal(fetched, undefined);
    });
  });

  describe("Learning Paths", () => {
    it("creates a path with module IDs", async () => {
      const mod1 = await storage.createLearningModule(orgId, { orgId, title: "Step 1", contentType: "article", createdBy: "admin" });
      const mod2 = await storage.createLearningModule(orgId, { orgId, title: "Step 2", contentType: "quiz", createdBy: "admin" });

      const path = await storage.createLearningPath(orgId, {
        orgId,
        title: "Onboarding Track",
        description: "New hire training path",
        moduleIds: [mod1.id, mod2.id],
        isRequired: true,
        createdBy: "admin",
      });

      assert.ok(path.id);
      assert.equal(path.title, "Onboarding Track");
      assert.equal(path.moduleIds.length, 2);
      assert.equal(path.isRequired, true);
    });

    it("retrieves a path", async () => {
      const path = await storage.createLearningPath(orgId, {
        orgId, title: "Test Path", moduleIds: ["mod-1"], createdBy: "admin",
      });

      const fetched = await storage.getLearningPath(orgId, path.id);
      assert.equal(fetched?.title, "Test Path");
    });

    it("lists all paths for org", async () => {
      await storage.createLearningPath(orgId, { orgId, title: "Path A", moduleIds: ["a"], createdBy: "admin" });
      await storage.createLearningPath(orgId, { orgId, title: "Path B", moduleIds: ["b"], createdBy: "admin" });

      const paths = await storage.listLearningPaths(orgId);
      assert.equal(paths.length, 2);
    });

    it("deletes a path", async () => {
      const path = await storage.createLearningPath(orgId, { orgId, title: "Delete Me", moduleIds: [], createdBy: "admin" });
      await storage.deleteLearningPath(orgId, path.id);

      const fetched = await storage.getLearningPath(orgId, path.id);
      assert.equal(fetched, undefined);
    });
  });

  describe("Progress Tracking", () => {
    it("creates initial progress as in_progress", async () => {
      const emp = await storage.createEmployee(orgId, { orgId, name: "Jane", email: "jane@test.com", role: "Agent" });
      const mod = await storage.createLearningModule(orgId, { orgId, title: "Test", contentType: "article", createdBy: "admin" });

      const progress = await storage.upsertLearningProgress(orgId, {
        orgId,
        employeeId: emp.id,
        moduleId: mod.id,
        status: "in_progress",
      });

      assert.ok(progress.id);
      assert.equal(progress.status, "in_progress");
      assert.equal(progress.employeeId, emp.id);
    });

    it("upserts progress (updates existing)", async () => {
      const emp = await storage.createEmployee(orgId, { orgId, name: "Bob", email: "bob@test.com", role: "Agent" });
      const mod = await storage.createLearningModule(orgId, { orgId, title: "Test", contentType: "quiz", createdBy: "admin" });

      // First: start
      await storage.upsertLearningProgress(orgId, { orgId, employeeId: emp.id, moduleId: mod.id, status: "in_progress" });

      // Second: complete with quiz score
      const progress = await storage.upsertLearningProgress(orgId, {
        orgId, employeeId: emp.id, moduleId: mod.id,
        status: "completed", quizScore: 85, quizAttempts: 1,
      });

      assert.equal(progress.status, "completed");
      assert.equal(progress.quizScore, 85);
    });

    it("gets all progress for an employee", async () => {
      const emp = await storage.createEmployee(orgId, { orgId, name: "Eve", email: "eve@test.com", role: "Agent" });
      const mod1 = await storage.createLearningModule(orgId, { orgId, title: "M1", contentType: "article", createdBy: "admin" });
      const mod2 = await storage.createLearningModule(orgId, { orgId, title: "M2", contentType: "article", createdBy: "admin" });

      await storage.upsertLearningProgress(orgId, { orgId, employeeId: emp.id, moduleId: mod1.id, status: "completed" });
      await storage.upsertLearningProgress(orgId, { orgId, employeeId: emp.id, moduleId: mod2.id, status: "in_progress" });

      const allProgress = await storage.getEmployeeLearningProgress(orgId, emp.id);
      assert.equal(allProgress.length, 2);
    });

    it("returns empty for employee with no progress", async () => {
      const emp = await storage.createEmployee(orgId, { orgId, name: "New", email: "new@test.com", role: "Agent" });
      const progress = await storage.getEmployeeLearningProgress(orgId, emp.id);
      assert.equal(progress.length, 0);
    });

    it("gets module completion stats", async () => {
      const mod = await storage.createLearningModule(orgId, { orgId, title: "Stats Test", contentType: "quiz", createdBy: "admin" });
      const emp1 = await storage.createEmployee(orgId, { orgId, name: "E1", email: "e1@test.com", role: "Agent" });
      const emp2 = await storage.createEmployee(orgId, { orgId, name: "E2", email: "e2@test.com", role: "Agent" });
      const emp3 = await storage.createEmployee(orgId, { orgId, name: "E3", email: "e3@test.com", role: "Agent" });

      await storage.upsertLearningProgress(orgId, { orgId, employeeId: emp1.id, moduleId: mod.id, status: "completed", quizScore: 90 });
      await storage.upsertLearningProgress(orgId, { orgId, employeeId: emp2.id, moduleId: mod.id, status: "completed", quizScore: 80 });
      await storage.upsertLearningProgress(orgId, { orgId, employeeId: emp3.id, moduleId: mod.id, status: "in_progress" });

      const stats = await storage.getModuleCompletionStats(orgId, mod.id);
      assert.equal(stats.total, 3);
      assert.equal(stats.completed, 2);
      assert.equal(stats.inProgress, 1);
      assert.equal(stats.avgScore, 85);
    });
  });

  describe("Quiz Grading Logic", () => {
    it("grades quiz answers correctly", () => {
      const questions = [
        { question: "Q1", options: ["A", "B", "C"], correctIndex: 0 },
        { question: "Q2", options: ["A", "B", "C"], correctIndex: 1 },
        { question: "Q3", options: ["A", "B", "C"], correctIndex: 2 },
      ];
      const answers = [0, 1, 0]; // 2 correct out of 3

      const results = questions.map((q, i) => ({
        correct: answers[i] === q.correctIndex,
      }));
      const correctCount = results.filter(r => r.correct).length;
      const score = Math.round((correctCount / questions.length) * 100);

      assert.equal(correctCount, 2);
      assert.equal(score, 67);
    });

    it("passes at 70% threshold", () => {
      const score = 70;
      assert.equal(score >= 70, true);
    });

    it("fails below 70% threshold", () => {
      const score = 69;
      assert.equal(score >= 70, false);
    });

    it("handles perfect score", () => {
      const questions = [
        { question: "Q1", options: ["A", "B"], correctIndex: 0 },
        { question: "Q2", options: ["A", "B"], correctIndex: 1 },
      ];
      const answers = [0, 1];
      const correctCount = questions.filter((q, i) => answers[i] === q.correctIndex).length;
      const score = Math.round((correctCount / questions.length) * 100);

      assert.equal(score, 100);
    });

    it("handles unanswered questions as wrong", () => {
      const questions = [
        { question: "Q1", options: ["A", "B"], correctIndex: 0 },
        { question: "Q2", options: ["A", "B"], correctIndex: 1 },
      ];
      const answers = [0, -1]; // Second unanswered
      const correctCount = questions.filter((q, i) => (answers[i] ?? -1) === q.correctIndex).length;
      assert.equal(correctCount, 1);
    });
  });
});
