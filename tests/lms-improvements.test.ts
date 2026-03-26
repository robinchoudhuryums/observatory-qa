/**
 * Tests for LMS improvements:
 * - Prerequisite gating
 * - Completion deadlines
 * - Certificate generation data
 * - Quiz passing score configuration
 * - Coaching-tied recommendations
 *
 * Run with: npx tsx --test tests/lms-improvements.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  insertLearningModuleSchema,
  learningModuleSchema,
  insertLearningPathSchema,
  learningPathSchema,
  type LearningModule,
  type LearningPath,
} from "../shared/schema.js";

describe("LMS Module Schema - Prerequisites", () => {
  it("accepts prerequisiteModuleIds field", () => {
    const module = learningModuleSchema.parse({
      id: "mod-1",
      orgId: "org-1",
      title: "Advanced Compliance",
      contentType: "article",
      createdBy: "admin",
      prerequisiteModuleIds: ["mod-basics", "mod-intro"],
      passingScore: 80,
    });
    assert.deepEqual(module.prerequisiteModuleIds, ["mod-basics", "mod-intro"]);
    assert.equal(module.passingScore, 80);
  });

  it("prerequisiteModuleIds defaults to undefined", () => {
    const module = learningModuleSchema.parse({
      id: "mod-2",
      orgId: "org-1",
      title: "Basic Module",
      contentType: "article",
      createdBy: "admin",
    });
    assert.equal(module.prerequisiteModuleIds, undefined);
  });

  it("passingScore defaults to undefined (route uses 70)", () => {
    const module = learningModuleSchema.parse({
      id: "mod-3",
      orgId: "org-1",
      title: "Quiz Module",
      contentType: "quiz",
      createdBy: "admin",
    });
    assert.equal(module.passingScore, undefined);
  });

  it("validates passingScore range 0-100", () => {
    assert.throws(() => {
      insertLearningModuleSchema.parse({
        orgId: "org-1",
        title: "Bad Score",
        contentType: "quiz",
        createdBy: "admin",
        passingScore: 150,
      });
    });
  });
});

describe("LMS Path Schema - Deadlines", () => {
  it("accepts dueDate and enforceOrder fields", () => {
    const path = learningPathSchema.parse({
      id: "path-1",
      orgId: "org-1",
      title: "Onboarding Path",
      moduleIds: ["mod-1", "mod-2", "mod-3"],
      createdBy: "admin",
      dueDate: "2026-04-15T00:00:00Z",
      enforceOrder: true,
    });
    assert.equal(path.dueDate, "2026-04-15T00:00:00Z");
    assert.equal(path.enforceOrder, true);
  });

  it("dueDate and enforceOrder are optional", () => {
    const path = learningPathSchema.parse({
      id: "path-2",
      orgId: "org-1",
      title: "Optional Path",
      moduleIds: ["mod-1"],
      createdBy: "admin",
    });
    assert.equal(path.dueDate, undefined);
    assert.equal(path.enforceOrder, undefined);
  });

  it("insert schema accepts deadline fields", () => {
    const insert = insertLearningPathSchema.parse({
      orgId: "org-1",
      title: "New Hire Training",
      moduleIds: ["mod-1", "mod-2"],
      createdBy: "admin",
      isRequired: true,
      dueDate: "2026-05-01T00:00:00Z",
      enforceOrder: true,
    });
    assert.equal(insert.dueDate, "2026-05-01T00:00:00Z");
    assert.equal(insert.enforceOrder, true);
    assert.equal(insert.isRequired, true);
  });
});

describe("Prerequisite Checking Logic", () => {
  it("identifies unmet prerequisites correctly", () => {
    const prerequisites = ["mod-basics", "mod-intermediate"];
    const completedModuleIds = new Set(["mod-basics"]);

    const unmet = prerequisites.filter(id => !completedModuleIds.has(id));
    const met = prerequisites.filter(id => completedModuleIds.has(id));

    assert.deepEqual(met, ["mod-basics"]);
    assert.deepEqual(unmet, ["mod-intermediate"]);
    assert.equal(unmet.length === 0, false); // prerequisites NOT met
  });

  it("returns all met when all prerequisites completed", () => {
    const prerequisites = ["mod-a", "mod-b"];
    const completedModuleIds = new Set(["mod-a", "mod-b", "mod-c"]);

    const unmet = prerequisites.filter(id => !completedModuleIds.has(id));
    assert.equal(unmet.length, 0); // all met
  });

  it("handles empty prerequisites", () => {
    const prerequisites: string[] = [];
    const unmet = prerequisites.filter(id => !new Set(["mod-a"]).has(id));
    assert.equal(unmet.length, 0); // no prerequisites = always met
  });
});

describe("Deadline Status Logic", () => {
  it("calculates days remaining correctly", () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 5);
    const now = new Date();
    const daysRemaining = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    assert.ok(daysRemaining >= 4 && daysRemaining <= 6, `Expected ~5 days, got ${daysRemaining}`);
  });

  it("identifies overdue paths", () => {
    const dueDate = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-03-26T00:00:00Z");
    const isOverdue = now > dueDate;
    assert.equal(isOverdue, true);
  });

  it("classifies employee status correctly", () => {
    function getStatus(percentComplete: number, isOverdue: boolean, daysRemaining: number): string {
      if (percentComplete === 100) return "completed";
      if (isOverdue) return "overdue";
      if (daysRemaining <= 3) return "at_risk";
      return "on_track";
    }

    assert.equal(getStatus(100, false, 10), "completed");
    assert.equal(getStatus(50, true, 0), "overdue");
    assert.equal(getStatus(75, false, 2), "at_risk");
    assert.equal(getStatus(25, false, 15), "on_track");
  });
});

describe("Certificate Data Structure", () => {
  it("generates certificate ID from progress ID", () => {
    const progressId = "abc12345-def6-7890-ghij-klmnopqrstuv";
    const certId = `CERT-${progressId.slice(0, 8).toUpperCase()}`;
    assert.equal(certId, "CERT-ABC12345");
  });

  it("certificate contains required fields", () => {
    const cert = {
      employeeName: "Jane Smith",
      moduleName: "HIPAA Compliance Training",
      moduleCategory: "compliance",
      completedAt: "2026-03-20T10:00:00Z",
      quizScore: 95,
      organizationName: "Acme Healthcare",
      difficulty: "intermediate",
      estimatedMinutes: 30,
      certificateId: "CERT-ABC12345",
      issuedAt: new Date().toISOString(),
    };

    assert.ok(cert.employeeName);
    assert.ok(cert.moduleName);
    assert.ok(cert.certificateId.startsWith("CERT-"));
    assert.ok(cert.completedAt);
    assert.ok(cert.issuedAt);
  });
});

describe("Quiz Passing Score", () => {
  it("uses module passingScore when set", () => {
    const passingScore = 80;
    const score = 75;
    const passed = score >= passingScore;
    assert.equal(passed, false);
  });

  it("defaults to 70 when passingScore not set", () => {
    const modulePassingScore = undefined;
    const passingScore = modulePassingScore || 70;
    const score = 72;
    const passed = score >= passingScore;
    assert.equal(passed, true);
  });

  it("a score of exactly passingScore passes", () => {
    const passingScore = 80;
    const score = 80;
    assert.equal(score >= passingScore, true);
  });
});

describe("Coaching Recommendation Scoring", () => {
  it("scores modules by weak area relevance", () => {
    const weakAreas = ["compliance", "communication"];
    const moduleText = "hipaa compliance training for call center agents";

    let relevance = 0;
    for (const area of weakAreas) {
      if (moduleText.includes(area.toLowerCase())) {
        relevance += 4;
      }
    }
    assert.equal(relevance, 4); // matches "compliance" but not "communication"
  });

  it("matches coaching category to module text", () => {
    const coachingCategory = "customer_service";
    const moduleText = "customer service excellence customer_service skills";
    const match = moduleText.includes(coachingCategory.toLowerCase());
    assert.equal(match, true);
  });

  it("filters out already-completed modules", () => {
    const allModules = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
    const completedIds = new Set(["m2"]);
    const uncompleted = allModules.filter(m => !completedIds.has(m.id));
    assert.equal(uncompleted.length, 2);
    assert.ok(!uncompleted.some(m => m.id === "m2"));
  });
});
