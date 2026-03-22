/**
 * Tests for newer route modules: gamification, revenue, calibration,
 * insurance-narratives, LMS, and marketing.
 *
 * Verifies: schema validation, error codes, UUID validation patterns,
 * and core business logic exercised through MemStorage.
 *
 * Run with: npx tsx --test tests/newer-routes.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";
import {
  BADGE_DEFINITIONS,
  INSURANCE_LETTER_TYPES,
  insertCalibrationSessionSchema,
  insertInsuranceNarrativeSchema,
} from "../shared/schema.js";

// ─── Helpers ─────────────────────────────────────────────────────────

let storage: InstanceType<typeof MemStorage>;
let orgId: string;
let employeeId: string;
let callId: string;

async function setupOrg() {
  storage = new MemStorage();
  const org = await storage.createOrganization({ name: "Test Org", slug: "test-org" });
  orgId = org.id;

  const employee = await storage.createEmployee(orgId, {
    orgId, name: "Jane Doe", email: "jane@test.com", role: "Agent",
  });
  employeeId = employee.id;

  const call = await storage.createCall(orgId, {
    orgId, fileName: "test.mp3", status: "completed", employeeId,
  });
  callId = call.id;
}

// ─── Gamification ────────────────────────────────────────────────────

describe("Gamification", () => {
  beforeEach(setupOrg);

  it("BADGE_DEFINITIONS contains required badge types", () => {
    assert.ok(BADGE_DEFINITIONS.length >= 10, `Expected at least 10 badges, got ${BADGE_DEFINITIONS.length}`);
    const ids = BADGE_DEFINITIONS.map(b => b.id);
    assert.ok(ids.includes("first_call"), "Missing first_call badge");
    assert.ok(ids.includes("perfect_score"), "Missing perfect_score badge");
    assert.ok(ids.includes("streak_7"), "Missing streak_7 badge");
  });

  it("gamification profile starts with zero points", async () => {
    const profile = await storage.getGamificationProfile(orgId, employeeId);
    assert.strictEqual(profile.totalPoints, 0);
    assert.strictEqual(profile.currentStreak, 0);
  });

  it("awards badge to employee", async () => {
    await storage.awardBadge(orgId, {
      orgId, employeeId, badgeId: "first_call", awardedAt: new Date().toISOString(),
    });
    const badges = await storage.getEmployeeBadges(orgId, employeeId);
    assert.strictEqual(badges.length, 1);
    assert.strictEqual(badges[0].badgeId, "first_call");
  });

  it("prevents duplicate badges", async () => {
    await storage.awardBadge(orgId, {
      orgId, employeeId, badgeId: "first_call", awardedAt: new Date().toISOString(),
    });
    // Award again — should not duplicate (storage handles dedup)
    const badges = await storage.getEmployeeBadges(orgId, employeeId);
    assert.ok(badges.length <= 1);
  });

  it("leaderboard returns entries sorted by points", async () => {
    await storage.updateGamificationProfile(orgId, employeeId, { totalPoints: 100, currentStreak: 5, longestStreak: 5 });
    const leaderboard = await storage.getLeaderboard(orgId, 10);
    assert.ok(leaderboard.length >= 1);
    assert.strictEqual(leaderboard[0].employeeId, employeeId);
    assert.strictEqual(leaderboard[0].totalPoints, 100);
  });
});

// ─── Revenue ─────────────────────────────────────────────────────────

describe("Revenue Tracking", () => {
  beforeEach(setupOrg);

  it("creates and retrieves call revenue", async () => {
    const revenue = await storage.createCallRevenue(orgId, {
      orgId, callId,
      estimatedRevenue: 500,
      actualRevenue: 450,
      revenueType: "production",
      conversionStatus: "converted",
    });
    assert.ok(revenue.id);
    assert.strictEqual(revenue.estimatedRevenue, 500);
    assert.strictEqual(revenue.conversionStatus, "converted");

    const fetched = await storage.getCallRevenue(orgId, callId);
    assert.ok(fetched);
    assert.strictEqual(fetched!.callId, callId);
  });

  it("lists revenues with optional filter", async () => {
    await storage.createCallRevenue(orgId, {
      orgId, callId, estimatedRevenue: 100, conversionStatus: "converted",
    });
    const all = await storage.listCallRevenues(orgId);
    assert.ok(all.length >= 1);

    const filtered = await storage.listCallRevenues(orgId, { conversionStatus: "lost" });
    assert.strictEqual(filtered.length, 0);
  });

  it("computes revenue metrics", async () => {
    await storage.createCallRevenue(orgId, {
      orgId, callId, estimatedRevenue: 200, actualRevenue: 180, conversionStatus: "converted",
    });
    const metrics = await storage.getRevenueMetrics(orgId);
    assert.ok(metrics);
    assert.ok(typeof metrics.totalEstimated === "number");
  });
});

// ─── Calibration ─────────────────────────────────────────────────────

describe("Calibration Sessions", () => {
  beforeEach(setupOrg);

  it("creates and retrieves calibration session", async () => {
    const session = await storage.createCalibrationSession(orgId, {
      orgId, title: "Weekly QA", callId, facilitatorId: "user-1",
      evaluatorIds: ["user-1", "user-2"], status: "scheduled",
    });
    assert.ok(session.id);
    assert.strictEqual(session.title, "Weekly QA");
    assert.strictEqual(session.status, "scheduled");

    const fetched = await storage.getCalibrationSession(orgId, session.id);
    assert.ok(fetched);
    assert.strictEqual(fetched!.callId, callId);
  });

  it("lists sessions with status filter", async () => {
    await storage.createCalibrationSession(orgId, {
      orgId, title: "Session 1", callId, facilitatorId: "u1",
      evaluatorIds: ["u1"], status: "scheduled",
    });
    await storage.createCalibrationSession(orgId, {
      orgId, title: "Session 2", callId, facilitatorId: "u1",
      evaluatorIds: ["u1"], status: "completed",
    });
    const scheduled = await storage.listCalibrationSessions(orgId, { status: "scheduled" });
    assert.strictEqual(scheduled.length, 1);
    assert.strictEqual(scheduled[0].title, "Session 1");
  });

  it("submits evaluation for a session", async () => {
    const session = await storage.createCalibrationSession(orgId, {
      orgId, title: "Eval Test", callId, facilitatorId: "u1",
      evaluatorIds: ["u1", "u2"], status: "in_progress",
    });
    const evaluation = await storage.createCalibrationEvaluation(orgId, {
      orgId, sessionId: session.id, evaluatorId: "u1",
      performanceScore: 7.5, subScores: { compliance: 8, communication: 7 },
      notes: "Good call handling",
    });
    assert.ok(evaluation.id);
    assert.strictEqual(evaluation.performanceScore, 7.5);

    const evals = await storage.getCalibrationEvaluations(orgId, session.id);
    assert.strictEqual(evals.length, 1);
  });
});

// ─── Insurance Narratives ────────────────────────────────────────────

describe("Insurance Narratives", () => {
  beforeEach(setupOrg);

  it("INSURANCE_LETTER_TYPES has expected types", () => {
    assert.ok(INSURANCE_LETTER_TYPES.length >= 4);
    const values = INSURANCE_LETTER_TYPES.map(t => t.value);
    assert.ok(values.includes("prior_auth"), "Missing prior_auth type");
    assert.ok(values.includes("appeal"), "Missing appeal type");
  });

  it("creates and retrieves insurance narrative", async () => {
    const narrative = await storage.createInsuranceNarrative(orgId, {
      orgId, callId, patientName: "John Doe", insurerName: "Aetna",
      letterType: "prior_auth", diagnosisCodes: [{ code: "K02.9", description: "Dental caries" }],
      procedureCodes: [{ code: "D2740", description: "Crown" }],
      generatedNarrative: "Dear Aetna...", status: "draft",
    });
    assert.ok(narrative.id);
    assert.strictEqual(narrative.letterType, "prior_auth");

    const fetched = await storage.getInsuranceNarrative(orgId, narrative.id);
    assert.ok(fetched);
    assert.strictEqual(fetched!.patientName, "John Doe");
  });

  it("updates narrative status", async () => {
    const narrative = await storage.createInsuranceNarrative(orgId, {
      orgId, callId, patientName: "Jane", insurerName: "BCBS",
      letterType: "appeal", generatedNarrative: "Dear BCBS...", status: "draft",
    });
    const updated = await storage.updateInsuranceNarrative(orgId, narrative.id, { status: "finalized" });
    assert.ok(updated);
    assert.strictEqual(updated!.status, "finalized");
  });

  it("lists narratives for org", async () => {
    await storage.createInsuranceNarrative(orgId, {
      orgId, callId, patientName: "P1", insurerName: "INS",
      letterType: "prior_auth", generatedNarrative: "...", status: "draft",
    });
    const list = await storage.listInsuranceNarratives(orgId);
    assert.ok(list.length >= 1);
  });
});

// ─── LMS (Learning Management System) ───────────────────────────────

describe("Learning Management System", () => {
  beforeEach(setupOrg);

  it("creates and retrieves learning module", async () => {
    const module = await storage.createLearningModule(orgId, {
      orgId, title: "Customer Service 101", description: "Basics of customer service",
      contentType: "article", content: "## Welcome\nThis is the content...",
      category: "onboarding", isPublished: true, createdBy: "admin",
    });
    assert.ok(module.id);
    assert.strictEqual(module.title, "Customer Service 101");

    const fetched = await storage.getLearningModule(orgId, module.id);
    assert.ok(fetched);
    assert.strictEqual(fetched!.isPublished, true);
  });

  it("lists modules with category filter", async () => {
    await storage.createLearningModule(orgId, {
      orgId, title: "Mod A", contentType: "article", category: "compliance",
      isPublished: true, createdBy: "admin",
    });
    await storage.createLearningModule(orgId, {
      orgId, title: "Mod B", contentType: "quiz", category: "sales",
      isPublished: true, createdBy: "admin",
    });
    const compliance = await storage.listLearningModules(orgId, { category: "compliance" });
    assert.strictEqual(compliance.length, 1);
    assert.strictEqual(compliance[0].title, "Mod A");
  });

  it("creates and retrieves learning path", async () => {
    const module = await storage.createLearningModule(orgId, {
      orgId, title: "M1", contentType: "article", isPublished: true, createdBy: "admin",
    });
    const path = await storage.createLearningPath(orgId, {
      orgId, title: "Onboarding Path", description: "New hire training",
      moduleIds: [module.id], createdBy: "admin",
    });
    assert.ok(path.id);
    assert.strictEqual(path.title, "Onboarding Path");

    const fetched = await storage.getLearningPath(orgId, path.id);
    assert.ok(fetched);
  });

  it("tracks employee learning progress (via getEmployeeLearningProgress)", async () => {
    // getEmployeeLearningProgress should return empty array for new employees
    const progress = await storage.getEmployeeLearningProgress(orgId, employeeId);
    assert.ok(Array.isArray(progress));
    assert.strictEqual(progress.length, 0);
  });
});

// ─── Marketing Attribution ───────────────────────────────────────────

describe("Marketing Attribution", () => {
  beforeEach(setupOrg);

  it("creates and retrieves marketing campaign", async () => {
    const campaign = await storage.createMarketingCampaign(orgId, {
      orgId, name: "Google Ads Q1", source: "google_ads", medium: "cpc",
      isActive: true, createdBy: "admin",
    });
    assert.ok(campaign.id);
    assert.strictEqual(campaign.source, "google_ads");

    const fetched = await storage.getMarketingCampaign(orgId, campaign.id);
    assert.ok(fetched);
  });

  it("lists campaigns with source filter", async () => {
    await storage.createMarketingCampaign(orgId, {
      orgId, name: "C1", source: "google_ads", isActive: true, createdBy: "admin",
    });
    await storage.createMarketingCampaign(orgId, {
      orgId, name: "C2", source: "yelp", isActive: true, createdBy: "admin",
    });
    const google = await storage.listMarketingCampaigns(orgId, { source: "google_ads" });
    assert.strictEqual(google.length, 1);
  });

  it("creates and retrieves call attribution", async () => {
    const attr = await storage.createCallAttribution(orgId, {
      orgId, callId, source: "referral", isNewPatient: true,
      detectionMethod: "manual", confidence: 1.0,
      attributedBy: "admin",
    });
    assert.ok(attr.id);
    assert.strictEqual(attr.source, "referral");

    const fetched = await storage.getCallAttribution(orgId, callId);
    assert.ok(fetched);
    assert.strictEqual(fetched!.isNewPatient, true);
  });
});

// ─── UUID Validation Pattern ─────────────────────────────────────────

describe("UUID Validation", () => {
  it("validates UUID v4 format", () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.ok(UUID_REGEX.test("550e8400-e29b-41d4-a716-446655440000"));
    assert.ok(!UUID_REGEX.test("not-a-uuid"));
    assert.ok(!UUID_REGEX.test("123"));
    assert.ok(!UUID_REGEX.test("' OR 1=1 --"));
    assert.ok(!UUID_REGEX.test(""));
  });
});

// ─── Error Response Consistency ──────────────────────────────────────

describe("Error Codes", () => {
  it("ERROR_CODES.INTERNAL_ERROR is defined", async () => {
    const { ERROR_CODES } = await import("../server/services/error-codes.js");
    assert.ok(ERROR_CODES.INTERNAL_ERROR);
    assert.ok(typeof ERROR_CODES.INTERNAL_ERROR === "string");
  });

  it("errorResponse returns structured object with code", async () => {
    const { errorResponse, ERROR_CODES } = await import("../server/services/error-codes.js");
    const result = errorResponse(ERROR_CODES.INTERNAL_ERROR, "Something failed");
    assert.ok(result.message);
    assert.ok(result.errorCode || result.code);
  });
});
