/**
 * PostgresStorage feature methods barrel.
 *
 * Each domain (LMS, calibration, revenue, marketing, …) is a side-effect
 * module under server/db/pg-storage/ that attaches methods to
 * PostgresStorage.prototype via the shared `P` reference in
 * server/db/pg-storage/_shared.ts.
 *
 * This file used to be a single ~1.8K-LOC mixin; the four largest domains
 * have been split out into their own files (see imports below). The
 * remaining methods (A/B tests, usage records, live sessions, feedback,
 * gamification, insurance narratives, provider templates, deleteOrgData,
 * getOrgUsageSummary, BAA management) still live here.
 *
 * Import as a side-effect: `import "./pg-storage-features";`
 */

// Domain mixins — side-effect imports register methods on PostgresStorage.prototype
import "./pg-storage/calibration";
import "./pg-storage/lms";
import "./pg-storage/marketing";
import "./pg-storage/revenue";

/* eslint-disable @typescript-eslint/no-unused-vars */
import { eq, and, desc, sql, inArray, gte, lte } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as tables from "./schema";
// Note: we used to import `PostgresStorage` here and synchronously read its
// `.prototype`. That crashes under esbuild's hoisted-import bundle layout —
// the class declaration in pg-storage.ts has not yet executed when this
// module's body runs. The buffered `P` from ./pg-storage/_shared is used
// instead; see _shared.ts for the full rationale.
import { toISOString, QUERY_HARD_CAP } from "./pg-storage";
import { P, db, blob } from "./pg-storage/_shared";
import { normalizeAnalysis } from "../storage";
import { logger } from "../services/logger";
import type {
  ABTest,
  InsertABTest,
  UsageRecord,
  LiveSession,
  InsertLiveSession,
  Feedback,
  InsertFeedback,
  EmployeeBadge,
  InsuranceNarrative,
  InsertInsuranceNarrative,
  CallRevenue,
  InsertCallRevenue,
  CalibrationSession,
  InsertCalibrationSession,
  CalibrationEvaluation,
  InsertCalibrationEvaluation,
  LearningModule,
  InsertLearningModule,
  LearningPath,
  InsertLearningPath,
  LearningProgress,
  InsertLearningProgress,
  MarketingCampaign,
  InsertMarketingCampaign,
  CallAttribution,
  InsertCallAttribution,
  CallWithDetails,
  SimulatedCall,
  InsertSimulatedCall,
} from "@shared/schema";

// Row types inferred from Drizzle schema — used to type mapper function parameters
type ABTestRow = typeof tables.abTests.$inferSelect;
type SimulatedCallRow = typeof tables.simulatedCalls.$inferSelect;
type LearningModuleRow = typeof tables.learningModules.$inferSelect;
type LearningPathRow = typeof tables.learningPaths.$inferSelect;
type LearningProgressRow = typeof tables.learningProgress.$inferSelect;
type MarketingCampaignRow = typeof tables.marketingCampaigns.$inferSelect;
type CallAttributionRow = typeof tables.callAttributions.$inferSelect;
type ProviderTemplateRow = typeof tables.providerTemplates.$inferSelect;
type BaaRow = typeof tables.businessAssociateAgreements.$inferSelect;

// toISOString and QUERY_HARD_CAP imported from pg-storage.ts (single source of truth)
// P, db, blob are imported from ./pg-storage/_shared above (see header comment).

// ==================== Mappers (local to this file) ====================
// These are pure row→domain transformers used by the methods below.

// --- A/B test operations (stored in ab_tests table) ---
P.createABTest = async function (orgId: string, test: InsertABTest): Promise<ABTest> {
  const id = randomUUID();
  const [row] = await db(this)
    .insert(tables.abTests)
    .values({
      id,
      orgId,
      fileName: test.fileName,
      callCategory: test.callCategory || null,
      baselineModel: test.baselineModel,
      testModel: test.testModel,
      status: test.status || "processing",
      transcriptText: test.transcriptText || null,
      baselineAnalysis: test.baselineAnalysis || null,
      testAnalysis: test.testAnalysis || null,
      baselineLatencyMs: test.baselineLatencyMs || null,
      testLatencyMs: test.testLatencyMs || null,
      notes: test.notes || null,
      createdBy: test.createdBy,
      batchId: test.batchId || null,
    })
    .returning();
  return mapABTest(row);
};

P.getABTest = async function (orgId: string, id: string): Promise<ABTest | undefined> {
  const [row] = await db(this)
    .select()
    .from(tables.abTests)
    .where(and(eq(tables.abTests.orgId, orgId), eq(tables.abTests.id, id)));
  return row ? mapABTest(row) : undefined;
};

P.getAllABTests = async function (orgId: string): Promise<ABTest[]> {
  const rows = await db(this)
    .select()
    .from(tables.abTests)
    .where(eq(tables.abTests.orgId, orgId))
    .orderBy(desc(tables.abTests.createdAt))
    .limit(QUERY_HARD_CAP);
  return rows.map((r) => mapABTest(r));
};

P.updateABTest = async function (orgId: string, id: string, updates: Partial<ABTest>): Promise<ABTest | undefined> {
  const values: Record<string, any> = {};
  if (updates.status !== undefined) values.status = updates.status;
  if (updates.transcriptText !== undefined) values.transcriptText = updates.transcriptText;
  if (updates.baselineAnalysis !== undefined) values.baselineAnalysis = updates.baselineAnalysis;
  if (updates.testAnalysis !== undefined) values.testAnalysis = updates.testAnalysis;
  if (updates.baselineLatencyMs !== undefined) values.baselineLatencyMs = updates.baselineLatencyMs;
  if (updates.testLatencyMs !== undefined) values.testLatencyMs = updates.testLatencyMs;
  if (updates.notes !== undefined) values.notes = updates.notes;
  if (Object.keys(values).length === 0) return this.getABTest(orgId, id);

  const [row] = await db(this)
    .update(tables.abTests)
    .set(values)
    .where(and(eq(tables.abTests.orgId, orgId), eq(tables.abTests.id, id)))
    .returning();
  return row ? mapABTest(row) : undefined;
};

P.deleteABTest = async function (orgId: string, id: string): Promise<void> {
  await db(this)
    .delete(tables.abTests)
    .where(and(eq(tables.abTests.orgId, orgId), eq(tables.abTests.id, id)));
};

function mapABTest(row: ABTestRow): ABTest {
  return {
    id: row.id,
    orgId: row.orgId,
    fileName: row.fileName,
    callCategory: row.callCategory || undefined,
    baselineModel: row.baselineModel,
    testModel: row.testModel,
    status: row.status as ABTest["status"],
    transcriptText: row.transcriptText || undefined,
    baselineAnalysis: (row.baselineAnalysis || undefined) as Record<string, unknown> | undefined,
    testAnalysis: (row.testAnalysis || undefined) as Record<string, unknown> | undefined,
    baselineLatencyMs: row.baselineLatencyMs || undefined,
    testLatencyMs: row.testLatencyMs || undefined,
    notes: row.notes || undefined,
    createdBy: row.createdBy,
    createdAt: toISOString(row.createdAt),
    batchId: row.batchId || undefined,
  };
}

// --- Simulated calls (stored in simulated_calls table) ---
P.createSimulatedCall = async function (orgId: string, call: InsertSimulatedCall): Promise<SimulatedCall> {
  const id = randomUUID();
  const [row] = await db(this)
    .insert(tables.simulatedCalls)
    .values({
      id,
      orgId,
      title: call.title,
      scenario: call.scenario || null,
      qualityTier: call.qualityTier || null,
      equipment: call.equipment || null,
      status: "pending",
      script: call.script,
      config: call.config,
      createdBy: call.createdBy,
    })
    .returning();
  return mapSimulatedCall(row);
};

P.getSimulatedCall = async function (orgId: string, id: string): Promise<SimulatedCall | undefined> {
  const [row] = await db(this)
    .select()
    .from(tables.simulatedCalls)
    .where(and(eq(tables.simulatedCalls.orgId, orgId), eq(tables.simulatedCalls.id, id)));
  return row ? mapSimulatedCall(row) : undefined;
};

P.listSimulatedCalls = async function (
  orgId: string,
  filters?: { status?: string; limit?: number },
): Promise<SimulatedCall[]> {
  const conditions = [eq(tables.simulatedCalls.orgId, orgId)];
  if (filters?.status) conditions.push(eq(tables.simulatedCalls.status, filters.status));
  const rows = await db(this)
    .select()
    .from(tables.simulatedCalls)
    .where(and(...conditions))
    .orderBy(desc(tables.simulatedCalls.createdAt))
    .limit(Math.min(filters?.limit ?? QUERY_HARD_CAP, QUERY_HARD_CAP));
  return rows.map((r) => mapSimulatedCall(r));
};

P.updateSimulatedCall = async function (
  orgId: string,
  id: string,
  updates: Partial<SimulatedCall>,
): Promise<SimulatedCall | undefined> {
  const values: Record<string, any> = { updatedAt: new Date() };
  if (updates.status !== undefined) values.status = updates.status;
  if (updates.audioS3Key !== undefined) values.audioS3Key = updates.audioS3Key;
  if (updates.audioFormat !== undefined) values.audioFormat = updates.audioFormat;
  if (updates.durationSeconds !== undefined) values.durationSeconds = updates.durationSeconds;
  if (updates.ttsCharCount !== undefined) values.ttsCharCount = updates.ttsCharCount;
  if (updates.estimatedCost !== undefined) values.estimatedCost = updates.estimatedCost;
  if (updates.error !== undefined) values.error = updates.error;
  if (updates.sentToAnalysisCallId !== undefined) values.sentToAnalysisCallId = updates.sentToAnalysisCallId;
  if (updates.script !== undefined) values.script = updates.script;
  if (updates.config !== undefined) values.config = updates.config;
  if (updates.title !== undefined) values.title = updates.title;
  if (updates.scenario !== undefined) values.scenario = updates.scenario;
  if (updates.qualityTier !== undefined) values.qualityTier = updates.qualityTier;
  if (updates.equipment !== undefined) values.equipment = updates.equipment;

  const [row] = await db(this)
    .update(tables.simulatedCalls)
    .set(values)
    .where(and(eq(tables.simulatedCalls.orgId, orgId), eq(tables.simulatedCalls.id, id)))
    .returning();
  return row ? mapSimulatedCall(row) : undefined;
};

P.deleteSimulatedCall = async function (orgId: string, id: string): Promise<void> {
  await db(this)
    .delete(tables.simulatedCalls)
    .where(and(eq(tables.simulatedCalls.orgId, orgId), eq(tables.simulatedCalls.id, id)));
};

function mapSimulatedCall(row: SimulatedCallRow): SimulatedCall {
  return {
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    scenario: row.scenario,
    qualityTier: row.qualityTier,
    equipment: row.equipment,
    status: row.status as SimulatedCall["status"],
    script: row.script as SimulatedCall["script"],
    config: row.config as SimulatedCall["config"],
    audioS3Key: row.audioS3Key,
    audioFormat: row.audioFormat,
    durationSeconds: row.durationSeconds,
    ttsCharCount: row.ttsCharCount,
    estimatedCost: row.estimatedCost,
    error: row.error,
    createdBy: row.createdBy,
    sentToAnalysisCallId: row.sentToAnalysisCallId,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  };
}

// --- Spend tracking / usage records (stored in spend_records table) ---
P.createUsageRecord = async function (orgId: string, record: UsageRecord): Promise<void> {
  await db(this)
    .insert(tables.spendRecords)
    .values({
      id: record.id,
      orgId,
      callId: record.callId,
      type: record.type,
      timestamp: new Date(record.timestamp),
      userName: record.user,
      services: record.services,
      totalEstimatedCost: record.totalEstimatedCost,
    });
};

P.getUsageRecords = async function (orgId: string): Promise<UsageRecord[]> {
  const rows = await db(this)
    .select()
    .from(tables.spendRecords)
    .where(eq(tables.spendRecords.orgId, orgId))
    .orderBy(desc(tables.spendRecords.timestamp))
    .limit(QUERY_HARD_CAP);
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    callId: r.callId,
    type: r.type as "call" | "ab-test",
    timestamp: r.timestamp ? r.timestamp.toISOString() : new Date().toISOString(),
    user: r.userName,
    services: r.services as UsageRecord["services"],
    totalEstimatedCost: r.totalEstimatedCost,
  }));
};

// --- Live sessions (real-time clinical recording) ---

P.createLiveSession = async function (orgId: string, session: InsertLiveSession): Promise<LiveSession> {
  const id = randomUUID();
  const now = new Date();
  const consentCapturedAt = session.consentCapturedAt ? new Date(session.consentCapturedAt) : null;
  await db(this)
    .insert(tables.liveSessions)
    .values({
      id,
      orgId,
      createdBy: session.createdBy,
      specialty: session.specialty || null,
      noteFormat: session.noteFormat || "soap",
      encounterType: session.encounterType || "clinical_encounter",
      status: "active",
      transcriptText: "",
      draftClinicalNote: null,
      durationSeconds: 0,
      consentObtained: session.consentObtained || false,
      consentMethod: session.consentMethod || null,
      consentCapturedAt,
      consentCapturedBy: session.consentCapturedBy || null,
      startedAt: now,
    });
  return {
    id,
    orgId,
    createdBy: session.createdBy,
    specialty: session.specialty,
    noteFormat: session.noteFormat || "soap",
    encounterType: session.encounterType || "clinical_encounter",
    status: "active",
    transcriptText: "",
    durationSeconds: 0,
    consentObtained: session.consentObtained || false,
    consentMethod: session.consentMethod,
    consentCapturedAt: session.consentCapturedAt,
    consentCapturedBy: session.consentCapturedBy,
    startedAt: now.toISOString(),
  };
};

P.getLiveSession = async function (orgId: string, id: string): Promise<LiveSession | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.liveSessions)
    .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.id, id)));
  if (!rows[0]) return undefined;
  return mapLiveSessionRow(rows[0]);
};

P.updateLiveSession = async function (
  orgId: string,
  id: string,
  updates: Partial<LiveSession>,
): Promise<LiveSession | undefined> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.transcriptText !== undefined) dbUpdates.transcriptText = updates.transcriptText;
  if (updates.draftClinicalNote !== undefined) dbUpdates.draftClinicalNote = updates.draftClinicalNote;
  if (updates.durationSeconds !== undefined) dbUpdates.durationSeconds = updates.durationSeconds;
  if (updates.consentObtained !== undefined) dbUpdates.consentObtained = updates.consentObtained;
  if (updates.callId !== undefined) dbUpdates.callId = updates.callId;
  if (updates.endedAt !== undefined) dbUpdates.endedAt = new Date(updates.endedAt);

  const rows = await db(this)
    .update(tables.liveSessions)
    .set(dbUpdates)
    .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.id, id)))
    .returning();
  if (!rows[0]) return undefined;
  return mapLiveSessionRow(rows[0]);
};

P.getActiveLiveSessions = async function (orgId: string): Promise<LiveSession[]> {
  const rows = await db(this)
    .select()
    .from(tables.liveSessions)
    .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.status, "active")));
  return rows.map((r) => mapLiveSessionRow(r));
};

P.getLiveSessionsByUser = async function (orgId: string, userId: string): Promise<LiveSession[]> {
  const rows = await db(this)
    .select()
    .from(tables.liveSessions)
    .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.createdBy, userId)))
    .orderBy(desc(tables.liveSessions.startedAt));
  return rows.map((r) => mapLiveSessionRow(r));
};

function mapLiveSessionRow(r: typeof tables.liveSessions.$inferSelect): LiveSession {
  return {
    id: r.id,
    orgId: r.orgId,
    createdBy: r.createdBy,
    specialty: r.specialty || undefined,
    noteFormat: r.noteFormat,
    encounterType: r.encounterType,
    status: r.status as LiveSession["status"],
    transcriptText: r.transcriptText || "",
    draftClinicalNote: r.draftClinicalNote as LiveSession["draftClinicalNote"],
    durationSeconds: r.durationSeconds,
    consentObtained: r.consentObtained,
    consentMethod: (r.consentMethod as LiveSession["consentMethod"]) || undefined,
    consentCapturedAt: toISOString(r.consentCapturedAt),
    consentCapturedBy: r.consentCapturedBy || undefined,
    callId: r.callId || undefined,
    startedAt: toISOString(r.startedAt),
    endedAt: toISOString(r.endedAt),
  };
}

// ===================== FEEDBACK =====================

P.createFeedback = async function (orgId: string, feedback: InsertFeedback): Promise<Feedback> {
  const id = randomUUID();
  await db(this)
    .insert(tables.feedbacks)
    .values({
      id,
      orgId,
      userId: feedback.userId,
      type: feedback.type,
      context: feedback.context || null,
      rating: feedback.rating ?? null,
      comment: feedback.comment || null,
      metadata: feedback.metadata || null,
      status: "new",
    });
  return { ...feedback, id, orgId, status: "new", createdAt: new Date().toISOString() };
};

P.getFeedback = async function (orgId: string, id: string): Promise<Feedback | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.feedbacks)
    .where(and(eq(tables.feedbacks.orgId, orgId), eq(tables.feedbacks.id, id)));
  return rows[0] ? mapFeedbackRow(rows[0]) : undefined;
};

P.listFeedback = async function (orgId: string, filters?: { type?: string; status?: string }): Promise<Feedback[]> {
  const conditions = [eq(tables.feedbacks.orgId, orgId)];
  if (filters?.type) conditions.push(eq(tables.feedbacks.type, filters.type));
  if (filters?.status) conditions.push(eq(tables.feedbacks.status, filters.status));
  const rows = await db(this)
    .select()
    .from(tables.feedbacks)
    .where(and(...conditions))
    .orderBy(desc(tables.feedbacks.createdAt))
    .limit(QUERY_HARD_CAP);
  return rows.map((r) => mapFeedbackRow(r));
};

P.updateFeedback = async function (
  orgId: string,
  id: string,
  updates: Partial<Feedback>,
): Promise<Feedback | undefined> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.adminResponse !== undefined) dbUpdates.adminResponse = updates.adminResponse;
  const rows = await db(this)
    .update(tables.feedbacks)
    .set(dbUpdates)
    .where(and(eq(tables.feedbacks.orgId, orgId), eq(tables.feedbacks.id, id)))
    .returning();
  return rows[0] ? mapFeedbackRow(rows[0]) : undefined;
};

function mapFeedbackRow(r: typeof tables.feedbacks.$inferSelect): Feedback {
  return {
    id: r.id,
    orgId: r.orgId,
    userId: r.userId,
    type: r.type as Feedback["type"],
    context: (r.context as Feedback["context"]) ?? undefined,
    rating: r.rating ?? undefined,
    comment: r.comment ?? undefined,
    metadata: (r.metadata as Record<string, unknown>) ?? undefined,
    status: r.status as Feedback["status"],
    adminResponse: r.adminResponse ?? undefined,
    createdAt: toISOString(r.createdAt),
  };
}

// ===================== GAMIFICATION =====================

P.getEmployeeBadges = async function (orgId: string, employeeId: string): Promise<EmployeeBadge[]> {
  const rows = await db(this)
    .select()
    .from(tables.employeeBadges)
    .where(and(eq(tables.employeeBadges.orgId, orgId), eq(tables.employeeBadges.employeeId, employeeId)));
  return rows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    employeeId: r.employeeId,
    badgeId: r.badgeId,
    awardedAt: toISOString(r.awardedAt) || new Date().toISOString(),
    awardedFor: r.awardedFor || undefined,
    awardedBy: r.awardedBy || undefined,
    customMessage: r.customMessage || undefined,
  }));
};

P.awardBadge = async function (orgId: string, badge: Omit<EmployeeBadge, "id">): Promise<EmployeeBadge> {
  const id = randomUUID();
  try {
    await db(this)
      .insert(tables.employeeBadges)
      .values({
        id,
        orgId,
        employeeId: badge.employeeId,
        badgeId: badge.badgeId,
        awardedFor: badge.awardedFor || null,
        awardedBy: badge.awardedBy || null,
        customMessage: badge.customMessage || null,
      });
  } catch (e: unknown) {
    // Unique constraint violation — badge already awarded
    if ((e as { code?: string }).code === "23505") {
      const existing = await db(this)
        .select()
        .from(tables.employeeBadges)
        .where(
          and(
            eq(tables.employeeBadges.orgId, orgId),
            eq(tables.employeeBadges.employeeId, badge.employeeId),
            eq(tables.employeeBadges.badgeId, badge.badgeId),
          ),
        );
      if (existing[0])
        return { ...badge, id: existing[0].id, awardedAt: toISOString(existing[0].awardedAt) || badge.awardedAt };
    }
    throw e;
  }
  return { ...badge, id, awardedAt: badge.awardedAt || new Date().toISOString() };
};

P.getGamificationProfile = async function (orgId: string, employeeId: string) {
  const rows = await db(this)
    .select()
    .from(tables.gamificationProfiles)
    .where(and(eq(tables.gamificationProfiles.orgId, orgId), eq(tables.gamificationProfiles.employeeId, employeeId)));
  if (!rows[0]) return { totalPoints: 0, currentStreak: 0, longestStreak: 0 };
  return {
    totalPoints: rows[0].totalPoints,
    currentStreak: rows[0].currentStreak,
    longestStreak: rows[0].longestStreak,
  };
};

P.updateGamificationProfile = async function (
  orgId: string,
  employeeId: string,
  updates: { totalPoints?: number; currentStreak?: number; longestStreak?: number; lastActivityDate?: string },
) {
  // Use INSERT ... ON CONFLICT DO UPDATE to prevent race condition where
  // two concurrent calls both see "no record" and try to insert.
  await db(this)
    .insert(tables.gamificationProfiles)
    .values({
      orgId,
      employeeId,
      totalPoints: updates.totalPoints ?? 0,
      currentStreak: updates.currentStreak ?? 0,
      longestStreak: updates.longestStreak ?? 0,
      lastActivityDate: updates.lastActivityDate || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [tables.gamificationProfiles.orgId, tables.gamificationProfiles.employeeId],
      set: {
        ...(updates.totalPoints !== undefined ? { totalPoints: updates.totalPoints } : {}),
        ...(updates.currentStreak !== undefined ? { currentStreak: updates.currentStreak } : {}),
        ...(updates.longestStreak !== undefined ? { longestStreak: updates.longestStreak } : {}),
        ...(updates.lastActivityDate !== undefined ? { lastActivityDate: updates.lastActivityDate } : {}),
        updatedAt: new Date(),
      },
    });
};

P.getLeaderboard = async function (orgId: string, limit = 20) {
  const rows = await db(this)
    .select()
    .from(tables.gamificationProfiles)
    .where(eq(tables.gamificationProfiles.orgId, orgId))
    .orderBy(desc(tables.gamificationProfiles.totalPoints))
    .limit(limit);
  if (rows.length === 0) return [];

  // Batch-load badge counts in a single query instead of N+1 (was 1 query per row)
  const employeeIds = rows.map((r) => r.employeeId);
  const badgeCounts = await db(this)
    .select({
      employeeId: tables.employeeBadges.employeeId,
      count: sql<number>`count(*)`,
    })
    .from(tables.employeeBadges)
    .where(and(eq(tables.employeeBadges.orgId, orgId), inArray(tables.employeeBadges.employeeId, employeeIds)))
    .groupBy(tables.employeeBadges.employeeId);
  const badgeMap = new Map(badgeCounts.map((b) => [b.employeeId, Number(b.count)]));

  return rows.map((r) => ({
    employeeId: r.employeeId,
    totalPoints: r.totalPoints,
    currentStreak: r.currentStreak,
    badgeCount: badgeMap.get(r.employeeId) || 0,
  }));
};

// ===================== INSURANCE NARRATIVES =====================

P.createInsuranceNarrative = async function (
  orgId: string,
  narrative: InsertInsuranceNarrative,
): Promise<InsuranceNarrative> {
  const id = randomUUID();
  const now = new Date();
  await db(this)
    .insert(tables.insuranceNarratives)
    .values({
      id,
      orgId,
      callId: narrative.callId || null,
      patientName: narrative.patientName,
      patientDob: narrative.patientDob || null,
      memberId: narrative.memberId || null,
      insurerName: narrative.insurerName,
      insurerAddress: narrative.insurerAddress || null,
      letterType: narrative.letterType,
      diagnosisCodes: narrative.diagnosisCodes || null,
      procedureCodes: narrative.procedureCodes || null,
      clinicalJustification: narrative.clinicalJustification || null,
      priorDenialReference: narrative.priorDenialReference || null,
      generatedNarrative: narrative.generatedNarrative || null,
      status: narrative.status || "draft",
      createdBy: narrative.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  return { ...narrative, id, orgId, createdAt: now.toISOString(), updatedAt: now.toISOString() };
};

P.getInsuranceNarrative = async function (orgId: string, id: string): Promise<InsuranceNarrative | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.insuranceNarratives)
    .where(and(eq(tables.insuranceNarratives.orgId, orgId), eq(tables.insuranceNarratives.id, id)));
  return rows[0] ? mapInsuranceNarrativeRow(rows[0]) : undefined;
};

P.listInsuranceNarratives = async function (
  orgId: string,
  filters?: { callId?: string; status?: string },
): Promise<InsuranceNarrative[]> {
  const conditions = [eq(tables.insuranceNarratives.orgId, orgId)];
  if (filters?.callId) conditions.push(eq(tables.insuranceNarratives.callId, filters.callId));
  if (filters?.status) conditions.push(eq(tables.insuranceNarratives.status, filters.status));
  const rows = await db(this)
    .select()
    .from(tables.insuranceNarratives)
    .where(and(...conditions))
    .orderBy(desc(tables.insuranceNarratives.createdAt))
    .limit(QUERY_HARD_CAP);
  return rows.map((r) => mapInsuranceNarrativeRow(r));
};

P.updateInsuranceNarrative = async function (
  orgId: string,
  id: string,
  updates: Partial<InsuranceNarrative>,
): Promise<InsuranceNarrative | undefined> {
  const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.generatedNarrative !== undefined) dbUpdates.generatedNarrative = updates.generatedNarrative;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.clinicalJustification !== undefined) dbUpdates.clinicalJustification = updates.clinicalJustification;
  if (updates.priorDenialReference !== undefined) dbUpdates.priorDenialReference = updates.priorDenialReference;
  if (updates.diagnosisCodes !== undefined) dbUpdates.diagnosisCodes = updates.diagnosisCodes;
  if (updates.procedureCodes !== undefined) dbUpdates.procedureCodes = updates.procedureCodes;
  if (updates.outcome !== undefined) dbUpdates.outcome = updates.outcome;
  if (updates.outcomeDate !== undefined)
    dbUpdates.outcomeDate = updates.outcomeDate ? new Date(updates.outcomeDate) : null;
  if (updates.outcomeNotes !== undefined) dbUpdates.outcomeNotes = updates.outcomeNotes;
  if (updates.denialCode !== undefined) dbUpdates.denialCode = updates.denialCode;
  if (updates.denialReason !== undefined) dbUpdates.denialReason = updates.denialReason;
  if (updates.submissionDeadline !== undefined)
    dbUpdates.submissionDeadline = updates.submissionDeadline ? new Date(updates.submissionDeadline) : null;
  if (updates.deadlineAcknowledged !== undefined) dbUpdates.deadlineAcknowledged = updates.deadlineAcknowledged;
  if (updates.payerTemplate !== undefined) dbUpdates.payerTemplate = updates.payerTemplate;
  if (updates.supportingDocuments !== undefined) dbUpdates.supportingDocuments = updates.supportingDocuments;
  const rows = await db(this)
    .update(tables.insuranceNarratives)
    .set(dbUpdates)
    .where(and(eq(tables.insuranceNarratives.orgId, orgId), eq(tables.insuranceNarratives.id, id)))
    .returning();
  return rows[0] ? mapInsuranceNarrativeRow(rows[0]) : undefined;
};

P.deleteInsuranceNarrative = async function (orgId: string, id: string): Promise<void> {
  await db(this)
    .delete(tables.insuranceNarratives)
    .where(and(eq(tables.insuranceNarratives.orgId, orgId), eq(tables.insuranceNarratives.id, id)));
};

function mapInsuranceNarrativeRow(r: typeof tables.insuranceNarratives.$inferSelect): InsuranceNarrative {
  return {
    id: r.id,
    orgId: r.orgId,
    callId: r.callId || undefined,
    patientName: r.patientName,
    patientDob: r.patientDob || undefined,
    memberId: r.memberId || undefined,
    insurerName: r.insurerName,
    insurerAddress: r.insurerAddress || undefined,
    letterType: r.letterType,
    diagnosisCodes: r.diagnosisCodes as InsuranceNarrative["diagnosisCodes"],
    procedureCodes: r.procedureCodes as InsuranceNarrative["procedureCodes"],
    clinicalJustification: r.clinicalJustification || undefined,
    priorDenialReference: r.priorDenialReference || undefined,
    generatedNarrative: r.generatedNarrative || undefined,
    status: r.status as InsuranceNarrative["status"],
    createdBy: r.createdBy,
    createdAt: toISOString(r.createdAt),
    updatedAt: toISOString(r.updatedAt),
    outcome: r.outcome as InsuranceNarrative["outcome"],
    outcomeDate: toISOString(r.outcomeDate),
    outcomeNotes: r.outcomeNotes || undefined,
    denialCode: r.denialCode || undefined,
    denialReason: r.denialReason || undefined,
    submissionDeadline: toISOString(r.submissionDeadline),
    deadlineAcknowledged: r.deadlineAcknowledged ?? undefined,
    payerTemplate: r.payerTemplate || undefined,
    supportingDocuments: r.supportingDocuments as InsuranceNarrative["supportingDocuments"],
  };
}

// --- Provider templates (custom clinical note templates per provider) ---

P.getProviderTemplates = async function (orgId: string, userId: string): Promise<any[]> {
  const rows = await db(this)
    .select()
    .from(tables.providerTemplates)
    .where(and(eq(tables.providerTemplates.orgId, orgId), eq(tables.providerTemplates.userId, userId)))
    .orderBy(tables.providerTemplates.createdAt);
  return rows.map((r) => mapProviderTemplate(r));
};

P.getAllProviderTemplates = async function (orgId: string): Promise<any[]> {
  const rows = await db(this)
    .select()
    .from(tables.providerTemplates)
    .where(eq(tables.providerTemplates.orgId, orgId))
    .orderBy(tables.providerTemplates.createdAt);
  return rows.map((r) => mapProviderTemplate(r));
};

P.createProviderTemplate = async function (orgId: string, template: any): Promise<any> {
  const id = randomUUID();
  const now = new Date();
  const row = await db(this)
    .insert(tables.providerTemplates)
    .values({
      id,
      orgId,
      userId: template.userId,
      name: template.name,
      specialty: template.specialty || null,
      format: template.format || null,
      category: template.category || null,
      description: template.description || null,
      sections: template.sections || null,
      defaultCodes: template.defaultCodes || null,
      tags: template.tags || null,
      isDefault: template.isDefault || false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapProviderTemplate(row[0]);
};

P.updateProviderTemplate = async function (
  orgId: string,
  id: string,
  userId: string,
  updates: any,
): Promise<any | null> {
  const setClause: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) setClause.name = updates.name;
  if (updates.specialty !== undefined) setClause.specialty = updates.specialty;
  if (updates.format !== undefined) setClause.format = updates.format;
  if (updates.category !== undefined) setClause.category = updates.category;
  if (updates.description !== undefined) setClause.description = updates.description;
  if (updates.sections !== undefined) setClause.sections = updates.sections;
  if (updates.defaultCodes !== undefined) setClause.defaultCodes = updates.defaultCodes;
  if (updates.tags !== undefined) setClause.tags = updates.tags;
  if (updates.isDefault !== undefined) setClause.isDefault = updates.isDefault;

  const rows = await db(this)
    .update(tables.providerTemplates)
    .set(setClause)
    .where(
      and(
        eq(tables.providerTemplates.orgId, orgId),
        eq(tables.providerTemplates.id, id),
        eq(tables.providerTemplates.userId, userId),
      ),
    )
    .returning();
  return rows[0] ? mapProviderTemplate(rows[0]) : null;
};

P.deleteProviderTemplate = async function (orgId: string, id: string, userId: string): Promise<boolean> {
  const result = await db(this)
    .delete(tables.providerTemplates)
    .where(
      and(
        eq(tables.providerTemplates.orgId, orgId),
        eq(tables.providerTemplates.id, id),
        eq(tables.providerTemplates.userId, userId),
      ),
    )
    .returning();
  return result.length > 0;
};

// ─── GDPR/CCPA: bulk org data deletion ───────────────────────────────────────

/**
 * Delete all org data in FK-safe order.
 * Cascades from calls.ts ON DELETE CASCADE will handle child rows automatically.
 * Returns counts of top-level records deleted.
 */
P.deleteOrgData = async function (
  orgId: string,
): Promise<{ employeesDeleted: number; callsDeleted: number; usersDeleted: number }> {
  return db(this).transaction(async (tx) => {
    // 1. Delete coaching sessions (references employees and calls)
    await tx.execute(sql`DELETE FROM coaching_sessions WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM coaching_recommendations WHERE org_id = ${orgId}`);
    // 2. Delete calibration sessions/evaluations
    await tx.execute(sql`DELETE FROM calibration_sessions WHERE org_id = ${orgId}`);
    // 3. Delete insurance narratives
    await tx.execute(sql`DELETE FROM insurance_narratives WHERE org_id = ${orgId}`);
    // 4. Delete call revenues
    await tx.execute(sql`DELETE FROM call_revenues WHERE org_id = ${orgId}`);
    // 5. Delete call attributions
    await tx.execute(sql`DELETE FROM call_attributions WHERE org_id = ${orgId}`);
    // 6. Delete AB tests
    await tx.execute(sql`DELETE FROM ab_tests WHERE org_id = ${orgId}`);
    // 7. Delete spend records
    await tx.execute(sql`DELETE FROM spend_records WHERE org_id = ${orgId}`);
    // 8. Delete live sessions
    await tx.execute(sql`DELETE FROM live_sessions WHERE org_id = ${orgId}`);
    // 8b. Delete simulated calls (before calls — sent_to_analysis_call_id may reference)
    await tx.execute(sql`DELETE FROM simulated_calls WHERE org_id = ${orgId}`);
    // 9. Delete calls (cascades: transcripts, sentiment_analyses, call_analyses via FK CASCADE)
    const callsResult = await tx.execute(sql`DELETE FROM calls WHERE org_id = ${orgId}`);
    const callsDeleted = (callsResult as { rowCount?: number }).rowCount ?? 0;
    // 10. Delete gamification data
    await tx.execute(sql`DELETE FROM employee_badges WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM gamification_profiles WHERE org_id = ${orgId}`);
    // 11. Delete learning data
    await tx.execute(sql`DELETE FROM learning_progress WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM learning_paths WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM learning_modules WHERE org_id = ${orgId}`);
    // 12. Delete employees
    const empResult = await tx.execute(sql`DELETE FROM employees WHERE org_id = ${orgId}`);
    const employeesDeleted = (empResult as { rowCount?: number }).rowCount ?? 0;
    // 13. Delete reference docs (cascades document_chunks)
    await tx.execute(sql`DELETE FROM reference_documents WHERE org_id = ${orgId}`);
    // 14. Delete feedbacks
    await tx.execute(sql`DELETE FROM feedbacks WHERE org_id = ${orgId}`);
    // 15. Delete invitations
    await tx.execute(sql`DELETE FROM invitations WHERE org_id = ${orgId}`);
    // 16. Delete API keys
    await tx.execute(sql`DELETE FROM api_keys WHERE org_id = ${orgId}`);
    // 17. Delete prompt templates
    await tx.execute(sql`DELETE FROM prompt_templates WHERE org_id = ${orgId}`);
    // 18. Delete access requests
    await tx.execute(sql`DELETE FROM access_requests WHERE org_id = ${orgId}`);
    // 19. Delete provider templates
    await tx.execute(sql`DELETE FROM provider_templates WHERE org_id = ${orgId}`);
    // 20. Delete marketing data
    await tx.execute(sql`DELETE FROM marketing_campaigns WHERE org_id = ${orgId}`);
    // 21. Delete MFA recovery requests and password reset tokens (must precede user deletion — password_reset_tokens references user_id)
    await tx.execute(sql`DELETE FROM mfa_recovery_requests WHERE org_id = ${orgId}`);
    await tx.execute(
      sql`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE org_id = ${orgId})`,
    );
    // 22. Delete users
    const usersResult = await tx.execute(sql`DELETE FROM users WHERE org_id = ${orgId}`);
    const usersDeleted = (usersResult as { rowCount?: number }).rowCount ?? 0;
    // 23. Delete coaching templates and automation rules
    await tx.execute(sql`DELETE FROM coaching_templates WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM automation_rules WHERE org_id = ${orgId}`);
    // 24. Delete subscriptions and usage events
    await tx.execute(sql`DELETE FROM subscriptions WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM usage_events WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM usage_records WHERE org_id = ${orgId}`);
    // 25. Delete call shares
    await tx.execute(sql`DELETE FROM call_shares WHERE org_id = ${orgId}`);
    // 26. Delete BAA records and security incidents
    await tx.execute(sql`DELETE FROM business_associate_agreements WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM security_incidents WHERE org_id = ${orgId}`);
    await tx.execute(sql`DELETE FROM breach_reports WHERE org_id = ${orgId}`);
    // 27. Delete audit logs last (preserve audit trail as long as possible)
    await tx.execute(sql`DELETE FROM audit_logs WHERE org_id = ${orgId}`);

    return { employeesDeleted, callsDeleted, usersDeleted };
  });
};

// ─── Super-admin usage summary ────────────────────────────────────────────

/**
 * Aggregate per-org resource consumption using efficient SQL queries.
 * Avoids N+1 by using COUNT/SUM aggregates in a single pass.
 */
P.getOrgUsageSummary = async function (orgId: string): Promise<{
  totalCalls: number;
  completedCalls: number;
  totalDurationSeconds: number;
  totalEstimatedCostUsd: number;
  employeeCount: number;
}> {
  const [callStats, costStats, empStats] = await Promise.all([
    // Call counts and total duration
    db(this).execute(sql`
        SELECT
          COUNT(*) AS total_calls,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed_calls,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(duration, 0) ELSE 0 END), 0) AS total_duration
        FROM calls
        WHERE org_id = ${orgId}
      `),
    // Total estimated cost from spend_records
    db(this).execute(sql`
        SELECT COALESCE(SUM(total_estimated_cost), 0) AS total_cost
        FROM spend_records
        WHERE org_id = ${orgId}
      `),
    // Employee count
    db(this).execute(sql`
        SELECT COUNT(*) AS employee_count
        FROM employees
        WHERE org_id = ${orgId}
      `),
  ]);

  const callRow = (callStats as { rows: Record<string, unknown>[] }).rows?.[0] || ({} as Record<string, unknown>);
  const costRow = (costStats as { rows: Record<string, unknown>[] }).rows?.[0] || ({} as Record<string, unknown>);
  const empRow = (empStats as { rows: Record<string, unknown>[] }).rows?.[0] || ({} as Record<string, unknown>);

  return {
    totalCalls: Number(callRow.total_calls ?? 0),
    completedCalls: Number(callRow.completed_calls ?? 0),
    totalDurationSeconds: Number(callRow.total_duration ?? 0),
    totalEstimatedCostUsd: Number(costRow.total_cost ?? 0),
    employeeCount: Number(empRow.employee_count ?? 0),
  };
};

function mapProviderTemplate(r: ProviderTemplateRow): any {
  return {
    id: r.id,
    orgId: r.orgId,
    userId: r.userId,
    name: r.name,
    specialty: r.specialty || undefined,
    format: r.format || undefined,
    category: r.category || undefined,
    description: r.description || undefined,
    sections: r.sections || undefined,
    defaultCodes: r.defaultCodes || undefined,
    tags: r.tags || undefined,
    isDefault: r.isDefault || false,
    createdAt: toISOString(r.createdAt),
    updatedAt: toISOString(r.updatedAt),
  };
}

// ==================== BAA Management (HIPAA §164.502(e)) ====================

function mapBaa(r: BaaRow): any {
  return {
    id: r.id,
    orgId: r.orgId,
    vendorName: r.vendorName,
    vendorType: r.vendorType,
    description: r.description,
    contactName: r.contactName,
    contactEmail: r.contactEmail,
    status: r.status,
    signedAt: toISOString(r.signedAt),
    expiresAt: toISOString(r.expiresAt),
    renewalReminderDays: r.renewalReminderDays,
    signedBy: r.signedBy,
    vendorSignatory: r.vendorSignatory,
    documentUrl: r.documentUrl,
    notes: r.notes,
    phiCategories: r.phiCategories,
    createdAt: toISOString(r.createdAt),
    updatedAt: toISOString(r.updatedAt),
  };
}

P.listBusinessAssociateAgreements = async function (orgId: string): Promise<any[]> {
  const rows = await db(this)
    .select()
    .from(tables.businessAssociateAgreements)
    .where(eq(tables.businessAssociateAgreements.orgId, orgId))
    .orderBy(desc(tables.businessAssociateAgreements.createdAt));
  return rows.map(mapBaa);
};

P.getBusinessAssociateAgreement = async function (orgId: string, id: string): Promise<any | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.businessAssociateAgreements)
    .where(and(eq(tables.businessAssociateAgreements.orgId, orgId), eq(tables.businessAssociateAgreements.id, id)))
    .limit(1);
  return rows[0] ? mapBaa(rows[0]) : undefined;
};

P.createBusinessAssociateAgreement = async function (orgId: string, baa: any): Promise<any> {
  const [row] = await db(this)
    .insert(tables.businessAssociateAgreements)
    .values({
      id: baa.id,
      orgId,
      vendorName: baa.vendorName,
      vendorType: baa.vendorType,
      description: baa.description,
      contactName: baa.contactName,
      contactEmail: baa.contactEmail,
      status: baa.status || "active",
      signedAt: baa.signedAt ? new Date(baa.signedAt) : null,
      expiresAt: baa.expiresAt ? new Date(baa.expiresAt) : null,
      renewalReminderDays: baa.renewalReminderDays ?? 30,
      signedBy: baa.signedBy,
      vendorSignatory: baa.vendorSignatory,
      documentUrl: baa.documentUrl,
      notes: baa.notes,
      phiCategories: baa.phiCategories || [],
    })
    .returning();
  return mapBaa(row);
};

P.updateBusinessAssociateAgreement = async function (
  orgId: string,
  id: string,
  updates: any,
): Promise<any | undefined> {
  const updateData: Record<string, any> = {};
  const allowedFields = [
    "vendorName",
    "vendorType",
    "description",
    "contactName",
    "contactEmail",
    "status",
    "signedAt",
    "expiresAt",
    "renewalReminderDays",
    "signedBy",
    "vendorSignatory",
    "documentUrl",
    "notes",
    "phiCategories",
  ];
  for (const key of allowedFields) {
    if (updates[key] !== undefined) {
      if (key === "signedAt" || key === "expiresAt") {
        updateData[key] = updates[key] ? new Date(updates[key]) : null;
      } else {
        updateData[key] = updates[key];
      }
    }
  }
  updateData.updatedAt = new Date();

  const [row] = await db(this)
    .update(tables.businessAssociateAgreements)
    .set(updateData)
    .where(and(eq(tables.businessAssociateAgreements.orgId, orgId), eq(tables.businessAssociateAgreements.id, id)))
    .returning();
  return row ? mapBaa(row) : undefined;
};
