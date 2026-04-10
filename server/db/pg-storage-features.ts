/**
 * PostgresStorage feature methods — Part 2.
 *
 * This file extends PostgresStorage with methods for:
 * A/B tests, usage records, live sessions, feedback, gamification,
 * insurance narratives, revenue, calibration, LMS, marketing,
 * provider templates, org data deletion, and usage summary.
 *
 * Import as a side-effect: `import "./pg-storage-features";`
 * The import attaches all methods to PostgresStorage.prototype.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { eq, and, desc, sql, inArray, gte, lte } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as tables from "./schema";
import { PostgresStorage, toISOString, QUERY_HARD_CAP } from "./pg-storage";
import { normalizeAnalysis } from "../storage";
import { logger } from "../services/logger";
import type { Database } from "./index";
import type {
  ABTest, InsertABTest, UsageRecord, LiveSession, InsertLiveSession,
  Feedback, InsertFeedback, EmployeeBadge,
  InsuranceNarrative, InsertInsuranceNarrative,
  CallRevenue, InsertCallRevenue,
  CalibrationSession, InsertCalibrationSession,
  CalibrationEvaluation, InsertCalibrationEvaluation,
  LearningModule, InsertLearningModule,
  LearningPath, InsertLearningPath,
  LearningProgress, InsertLearningProgress,
  MarketingCampaign, InsertMarketingCampaign,
  CallAttribution, InsertCallAttribution,
  CallWithDetails,
} from "@shared/schema";

// Row types inferred from Drizzle schema — used to type mapper function parameters
type ABTestRow = typeof tables.abTests.$inferSelect;
type LearningModuleRow = typeof tables.learningModules.$inferSelect;
type LearningPathRow = typeof tables.learningPaths.$inferSelect;
type LearningProgressRow = typeof tables.learningProgress.$inferSelect;
type MarketingCampaignRow = typeof tables.marketingCampaigns.$inferSelect;
type CallAttributionRow = typeof tables.callAttributions.$inferSelect;
type ProviderTemplateRow = typeof tables.providerTemplates.$inferSelect;
type BaaRow = typeof tables.businessAssociateAgreements.$inferSelect;

// toISOString and QUERY_HARD_CAP imported from pg-storage.ts (single source of truth)

/** Type-safe access to the protected db field. */
function db(self: PostgresStorage): Database {
  return self["db"];
}

/** Type-safe access to the protected blobClient field. */
function blob(self: PostgresStorage): PostgresStorage["blobClient"] {
  return self["blobClient"];
}

// We use `const P = PostgresStorage.prototype` as a shorthand for
// assigning methods. TypeScript sees the assignments and infers types
// from the IStorage interface already declared on the class.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- prototype extension pattern requires any
const P = PostgresStorage.prototype as any;

// ==================== Mappers (local to this file) ====================
// These are pure row→domain transformers used by the methods below.

  // --- A/B test operations (stored in ab_tests table) ---
P.createABTest = async function(orgId: string, test: InsertABTest): Promise<ABTest> {
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
  }

P.getABTest = async function(orgId: string, id: string): Promise<ABTest | undefined> {
    const [row] = await db(this)
      .select()
      .from(tables.abTests)
      .where(and(eq(tables.abTests.orgId, orgId), eq(tables.abTests.id, id)));
    return row ? mapABTest(row) : undefined;
  }

P.getAllABTests = async function(orgId: string): Promise<ABTest[]> {
    const rows = await db(this)
      .select()
      .from(tables.abTests)
      .where(eq(tables.abTests.orgId, orgId))
      .orderBy(desc(tables.abTests.createdAt))
      .limit(QUERY_HARD_CAP);
    return rows.map((r) => mapABTest(r));
  }

P.updateABTest = async function(orgId: string, id: string, updates: Partial<ABTest>): Promise<ABTest | undefined> {
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
  }

P.deleteABTest = async function(orgId: string, id: string): Promise<void> {
    await db(this).delete(tables.abTests).where(and(eq(tables.abTests.orgId, orgId), eq(tables.abTests.id, id)));
  }

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

  // --- Spend tracking / usage records (stored in spend_records table) ---
P.createUsageRecord = async function(orgId: string, record: UsageRecord): Promise<void> {
    await db(this).insert(tables.spendRecords).values({
      id: record.id,
      orgId,
      callId: record.callId,
      type: record.type,
      timestamp: new Date(record.timestamp),
      userName: record.user,
      services: record.services,
      totalEstimatedCost: record.totalEstimatedCost,
    });
  }

P.getUsageRecords = async function(orgId: string): Promise<UsageRecord[]> {
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
  }

  // --- Live sessions (real-time clinical recording) ---

P.createLiveSession = async function(orgId: string, session: InsertLiveSession): Promise<LiveSession> {
    const id = randomUUID();
    const now = new Date();
    await db(this).insert(tables.liveSessions).values({
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
      startedAt: now.toISOString(),
    };
  }

P.getLiveSession = async function(orgId: string, id: string): Promise<LiveSession | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.liveSessions)
      .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.id, id)));
    if (!rows[0]) return undefined;
    return mapLiveSessionRow(rows[0]);
  }

P.updateLiveSession = async function(orgId: string, id: string, updates: Partial<LiveSession>): Promise<LiveSession | undefined> {
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
  }

P.getActiveLiveSessions = async function(orgId: string): Promise<LiveSession[]> {
    const rows = await db(this)
      .select()
      .from(tables.liveSessions)
      .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.status, "active")));
    return rows.map((r) => mapLiveSessionRow(r));
  }

P.getLiveSessionsByUser = async function(orgId: string, userId: string): Promise<LiveSession[]> {
    const rows = await db(this)
      .select()
      .from(tables.liveSessions)
      .where(and(eq(tables.liveSessions.orgId, orgId), eq(tables.liveSessions.createdBy, userId)))
      .orderBy(desc(tables.liveSessions.startedAt));
    return rows.map((r) => mapLiveSessionRow(r));
  }

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
      callId: r.callId || undefined,
      startedAt: toISOString(r.startedAt),
      endedAt: toISOString(r.endedAt),
    };
  }

  // ===================== FEEDBACK =====================

P.createFeedback = async function(orgId: string, feedback: InsertFeedback): Promise<Feedback> {
    const id = randomUUID();
    await db(this).insert(tables.feedbacks).values({
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
  }

P.getFeedback = async function(orgId: string, id: string): Promise<Feedback | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.feedbacks)
      .where(and(eq(tables.feedbacks.orgId, orgId), eq(tables.feedbacks.id, id)));
    return rows[0] ? mapFeedbackRow(rows[0]) : undefined;
  }

P.listFeedback = async function(orgId: string, filters?: { type?: string; status?: string }): Promise<Feedback[]> {
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
  }

P.updateFeedback = async function(orgId: string, id: string, updates: Partial<Feedback>): Promise<Feedback | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.adminResponse !== undefined) dbUpdates.adminResponse = updates.adminResponse;
    const rows = await db(this)
      .update(tables.feedbacks)
      .set(dbUpdates)
      .where(and(eq(tables.feedbacks.orgId, orgId), eq(tables.feedbacks.id, id)))
      .returning();
    return rows[0] ? mapFeedbackRow(rows[0]) : undefined;
  }

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

P.getEmployeeBadges = async function(orgId: string, employeeId: string): Promise<EmployeeBadge[]> {
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
  }

P.awardBadge = async function(orgId: string, badge: Omit<EmployeeBadge, "id">): Promise<EmployeeBadge> {
    const id = randomUUID();
    try {
      await db(this).insert(tables.employeeBadges).values({
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
  }

P.getGamificationProfile = async function(orgId: string, employeeId: string) {
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
  }

P.updateGamificationProfile = async function(
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
  }

P.getLeaderboard = async function(orgId: string, limit = 20) {
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
  }

  // ===================== INSURANCE NARRATIVES =====================

P.createInsuranceNarrative = async function(orgId: string, narrative: InsertInsuranceNarrative): Promise<InsuranceNarrative> {
    const id = randomUUID();
    const now = new Date();
    await db(this).insert(tables.insuranceNarratives).values({
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
  }

P.getInsuranceNarrative = async function(orgId: string, id: string): Promise<InsuranceNarrative | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.insuranceNarratives)
      .where(and(eq(tables.insuranceNarratives.orgId, orgId), eq(tables.insuranceNarratives.id, id)));
    return rows[0] ? mapInsuranceNarrativeRow(rows[0]) : undefined;
  }

P.listInsuranceNarratives = async function(
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
  }

P.updateInsuranceNarrative = async function(
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
  }

P.deleteInsuranceNarrative = async function(orgId: string, id: string): Promise<void> {
    await db(this)
      .delete(tables.insuranceNarratives)
      .where(and(eq(tables.insuranceNarratives.orgId, orgId), eq(tables.insuranceNarratives.id, id)));
  }

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

  // ===================== CALL REVENUE =====================

P.createCallRevenue = async function(orgId: string, revenue: InsertCallRevenue): Promise<CallRevenue> {
    const id = randomUUID();
    const now = new Date();
    await db(this).insert(tables.callRevenues).values({
      id,
      orgId,
      callId: revenue.callId,
      estimatedRevenue: revenue.estimatedRevenue ?? null,
      actualRevenue: revenue.actualRevenue ?? null,
      revenueType: revenue.revenueType || null,
      treatmentValue: revenue.treatmentValue ?? null,
      scheduledProcedures: revenue.scheduledProcedures || null,
      conversionStatus: revenue.conversionStatus || "unknown",
      notes: revenue.notes || null,
      updatedBy: revenue.updatedBy || null,
      createdAt: now,
      updatedAt: now,
      attributionStage: revenue.attributionStage || null,
      appointmentDate: revenue.appointmentDate ? new Date(revenue.appointmentDate) : null,
      appointmentCompleted: revenue.appointmentCompleted ?? null,
      treatmentAccepted: revenue.treatmentAccepted ?? null,
      paymentCollected: revenue.paymentCollected ?? null,
      payerType: revenue.payerType || null,
      insuranceCarrier: revenue.insuranceCarrier || null,
      insuranceAmount: revenue.insuranceAmount ?? null,
      patientAmount: revenue.patientAmount ?? null,
      ehrSyncedAt: null,
    });
    return { ...revenue, id, orgId, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }

P.getCallRevenue = async function(orgId: string, callId: string): Promise<CallRevenue | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.callRevenues)
      .where(and(eq(tables.callRevenues.orgId, orgId), eq(tables.callRevenues.callId, callId)));
    return rows[0] ? mapCallRevenueRow(rows[0]) : undefined;
  }

P.listCallRevenues = async function(orgId: string, filters?: { conversionStatus?: string }): Promise<CallRevenue[]> {
    const conditions = [eq(tables.callRevenues.orgId, orgId)];
    if (filters?.conversionStatus) conditions.push(eq(tables.callRevenues.conversionStatus, filters.conversionStatus));
    const rows = await db(this)
      .select()
      .from(tables.callRevenues)
      .where(and(...conditions))
      .orderBy(desc(tables.callRevenues.createdAt))
      .limit(QUERY_HARD_CAP);
    return rows.map((r) => mapCallRevenueRow(r));
  }

P.updateCallRevenue = async function(
    orgId: string,
    callId: string,
    updates: Partial<CallRevenue>,
  ): Promise<CallRevenue | undefined> {
    const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.estimatedRevenue !== undefined) dbUpdates.estimatedRevenue = updates.estimatedRevenue;
    if (updates.actualRevenue !== undefined) dbUpdates.actualRevenue = updates.actualRevenue;
    if (updates.revenueType !== undefined) dbUpdates.revenueType = updates.revenueType;
    if (updates.treatmentValue !== undefined) dbUpdates.treatmentValue = updates.treatmentValue;
    if (updates.scheduledProcedures !== undefined) dbUpdates.scheduledProcedures = updates.scheduledProcedures;
    if (updates.conversionStatus !== undefined) dbUpdates.conversionStatus = updates.conversionStatus;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    if (updates.updatedBy !== undefined) dbUpdates.updatedBy = updates.updatedBy;
    if (updates.attributionStage !== undefined) dbUpdates.attributionStage = updates.attributionStage;
    if (updates.appointmentDate !== undefined)
      dbUpdates.appointmentDate = updates.appointmentDate ? new Date(updates.appointmentDate) : null;
    if (updates.appointmentCompleted !== undefined) dbUpdates.appointmentCompleted = updates.appointmentCompleted;
    if (updates.treatmentAccepted !== undefined) dbUpdates.treatmentAccepted = updates.treatmentAccepted;
    if (updates.paymentCollected !== undefined) dbUpdates.paymentCollected = updates.paymentCollected;
    if (updates.payerType !== undefined) dbUpdates.payerType = updates.payerType;
    if (updates.insuranceCarrier !== undefined) dbUpdates.insuranceCarrier = updates.insuranceCarrier;
    if (updates.insuranceAmount !== undefined) dbUpdates.insuranceAmount = updates.insuranceAmount;
    if (updates.patientAmount !== undefined) dbUpdates.patientAmount = updates.patientAmount;
    if (updates.ehrSyncedAt !== undefined)
      dbUpdates.ehrSyncedAt = updates.ehrSyncedAt ? new Date(updates.ehrSyncedAt) : null;
    const rows = await db(this)
      .update(tables.callRevenues)
      .set(dbUpdates)
      .where(and(eq(tables.callRevenues.orgId, orgId), eq(tables.callRevenues.callId, callId)))
      .returning();
    return rows[0] ? mapCallRevenueRow(rows[0]) : undefined;
  }

P.getRevenueMetrics = async function(orgId: string) {
    const rows = await db(this).select().from(tables.callRevenues).where(eq(tables.callRevenues.orgId, orgId));
    const totalEstimated = rows.reduce((sum, r) => sum + (r.estimatedRevenue || 0), 0);
    const totalActual = rows.reduce((sum, r) => sum + (r.actualRevenue || 0), 0);
    const tracked = rows.filter((r) => r.conversionStatus !== "unknown");
    const converted = tracked.filter((r) => r.conversionStatus === "converted");
    const conversionRate = tracked.length > 0 ? converted.length / tracked.length : 0;
    // Only sum actualRevenue from converted calls for accurate avg deal value
    const convertedActual = converted.reduce((sum, r) => sum + (r.actualRevenue || 0), 0);
    const avgDealValue = converted.length > 0 ? convertedActual / converted.length : 0;
    return { totalEstimated, totalActual, conversionRate, avgDealValue };
  }

function mapCallRevenueRow(r: typeof tables.callRevenues.$inferSelect): CallRevenue {
    return {
      id: r.id,
      orgId: r.orgId,
      callId: r.callId,
      estimatedRevenue: r.estimatedRevenue ?? undefined,
      actualRevenue: r.actualRevenue ?? undefined,
      revenueType: r.revenueType as CallRevenue["revenueType"],
      treatmentValue: r.treatmentValue ?? undefined,
      scheduledProcedures: r.scheduledProcedures as CallRevenue["scheduledProcedures"],
      conversionStatus: r.conversionStatus as CallRevenue["conversionStatus"],
      notes: r.notes || undefined,
      updatedBy: r.updatedBy || undefined,
      createdAt: toISOString(r.createdAt),
      updatedAt: toISOString(r.updatedAt),
      attributionStage: r.attributionStage as CallRevenue["attributionStage"],
      appointmentDate: toISOString(r.appointmentDate),
      appointmentCompleted: r.appointmentCompleted ?? undefined,
      treatmentAccepted: r.treatmentAccepted ?? undefined,
      paymentCollected: r.paymentCollected ?? undefined,
      payerType: r.payerType as CallRevenue["payerType"],
      insuranceCarrier: r.insuranceCarrier || undefined,
      insuranceAmount: r.insuranceAmount ?? undefined,
      patientAmount: r.patientAmount ?? undefined,
      ehrSyncedAt: toISOString(r.ehrSyncedAt),
    };
  }

  // ===================== CALIBRATION SESSIONS =====================

P.createCalibrationSession = async function(orgId: string, session: InsertCalibrationSession): Promise<CalibrationSession> {
    const id = randomUUID();
    const now = new Date();
    await db(this).insert(tables.calibrationSessions).values({
      id,
      orgId,
      title: session.title,
      callId: session.callId,
      facilitatorId: session.facilitatorId,
      evaluatorIds: session.evaluatorIds,
      scheduledAt: session.scheduledAt ? new Date(session.scheduledAt) : null,
      status: session.status || "scheduled",
      targetScore: session.targetScore ?? null,
      consensusNotes: session.consensusNotes || null,
      createdAt: now,
      blindMode: session.blindMode ?? false,
    });
    return { ...session, id, orgId, blindMode: session.blindMode ?? false, createdAt: now.toISOString() };
  }

P.getCalibrationSession = async function(orgId: string, id: string): Promise<CalibrationSession | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.calibrationSessions)
      .where(and(eq(tables.calibrationSessions.orgId, orgId), eq(tables.calibrationSessions.id, id)));
    return rows[0] ? mapCalibrationSessionRow(rows[0]) : undefined;
  }

P.listCalibrationSessions = async function(orgId: string, filters?: { status?: string }): Promise<CalibrationSession[]> {
    const conditions = [eq(tables.calibrationSessions.orgId, orgId)];
    if (filters?.status) conditions.push(eq(tables.calibrationSessions.status, filters.status));
    const rows = await db(this)
      .select()
      .from(tables.calibrationSessions)
      .where(and(...conditions))
      .orderBy(desc(tables.calibrationSessions.createdAt));
    return rows.map((r) => mapCalibrationSessionRow(r));
  }

P.updateCalibrationSession = async function(
    orgId: string,
    id: string,
    updates: Partial<CalibrationSession>,
  ): Promise<CalibrationSession | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.targetScore !== undefined) dbUpdates.targetScore = updates.targetScore;
    if (updates.consensusNotes !== undefined) dbUpdates.consensusNotes = updates.consensusNotes;
    if (updates.completedAt !== undefined) dbUpdates.completedAt = new Date(updates.completedAt);
    const rows = await db(this)
      .update(tables.calibrationSessions)
      .set(dbUpdates)
      .where(and(eq(tables.calibrationSessions.orgId, orgId), eq(tables.calibrationSessions.id, id)))
      .returning();
    return rows[0] ? mapCalibrationSessionRow(rows[0]) : undefined;
  }

P.deleteCalibrationSession = async function(orgId: string, id: string): Promise<void> {
    // Both deletes run in a single transaction so evaluations are never
    // left orphaned if the session delete fails (or vice versa).
    await db(this).transaction(async (tx) => {
      await tx.delete(tables.calibrationEvaluations).where(eq(tables.calibrationEvaluations.sessionId, id));
      await tx
        .delete(tables.calibrationSessions)
        .where(and(eq(tables.calibrationSessions.orgId, orgId), eq(tables.calibrationSessions.id, id)));
    });
  }

P.createCalibrationEvaluation = async function(
    orgId: string,
    evaluation: InsertCalibrationEvaluation,
  ): Promise<CalibrationEvaluation> {
    const id = randomUUID();
    await db(this).insert(tables.calibrationEvaluations).values({
      id,
      orgId,
      sessionId: evaluation.sessionId,
      evaluatorId: evaluation.evaluatorId,
      performanceScore: evaluation.performanceScore,
      subScores: evaluation.subScores || null,
      notes: evaluation.notes || null,
    });
    return { ...evaluation, id, orgId, createdAt: new Date().toISOString() };
  }

P.getCalibrationEvaluations = async function(orgId: string, sessionId: string): Promise<CalibrationEvaluation[]> {
    const rows = await db(this)
      .select()
      .from(tables.calibrationEvaluations)
      .where(
        and(eq(tables.calibrationEvaluations.orgId, orgId), eq(tables.calibrationEvaluations.sessionId, sessionId)),
      );
    return rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      sessionId: r.sessionId,
      evaluatorId: r.evaluatorId,
      performanceScore: r.performanceScore,
      subScores: r.subScores as CalibrationEvaluation["subScores"],
      notes: r.notes || undefined,
      createdAt: toISOString(r.createdAt),
    }));
  }

P.updateCalibrationEvaluation = async function(
    orgId: string,
    id: string,
    updates: Partial<CalibrationEvaluation>,
  ): Promise<CalibrationEvaluation | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.performanceScore !== undefined) dbUpdates.performanceScore = updates.performanceScore;
    if (updates.subScores !== undefined) dbUpdates.subScores = updates.subScores;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    const rows = await db(this)
      .update(tables.calibrationEvaluations)
      .set(dbUpdates)
      .where(and(eq(tables.calibrationEvaluations.orgId, orgId), eq(tables.calibrationEvaluations.id, id)))
      .returning();
    if (!rows[0]) return undefined;
    const r = rows[0];
    return {
      id: r.id,
      orgId: r.orgId,
      sessionId: r.sessionId,
      evaluatorId: r.evaluatorId,
      performanceScore: r.performanceScore,
      subScores: r.subScores as CalibrationEvaluation["subScores"],
      notes: r.notes || undefined,
      createdAt: toISOString(r.createdAt),
    };
  }

function mapCalibrationSessionRow(r: typeof tables.calibrationSessions.$inferSelect): CalibrationSession {
    return {
      id: r.id,
      orgId: r.orgId,
      title: r.title,
      callId: r.callId,
      facilitatorId: r.facilitatorId,
      evaluatorIds: r.evaluatorIds,
      scheduledAt: toISOString(r.scheduledAt),
      status: r.status as CalibrationSession["status"],
      targetScore: r.targetScore ?? undefined,
      consensusNotes: r.consensusNotes || undefined,
      createdAt: toISOString(r.createdAt),
      completedAt: toISOString(r.completedAt),
      blindMode: r.blindMode ?? false,
    };
  }

  // --- LMS: Learning Modules ---
P.createLearningModule = async function(orgId: string, module: InsertLearningModule): Promise<LearningModule> {
    const id = randomUUID();
    const [row] = await db(this)
      .insert(tables.learningModules)
      .values({
        id,
        orgId,
        title: module.title,
        description: module.description || null,
        contentType: module.contentType,
        category: module.category || null,
        content: module.content || null,
        quizQuestions: module.quizQuestions || null,
        estimatedMinutes: module.estimatedMinutes || null,
        difficulty: module.difficulty || null,
        tags: module.tags || null,
        sourceDocumentId: module.sourceDocumentId || null,
        isPublished: module.isPublished ?? false,
        isPlatformContent: module.isPlatformContent ?? false,
        createdBy: module.createdBy,
        sortOrder: module.sortOrder || null,
        prerequisiteModuleIds: module.prerequisiteModuleIds || null,
        passingScore: module.passingScore || null,
      })
      .returning();
    return mapLearningModule(row);
  }

P.getLearningModule = async function(orgId: string, id: string): Promise<LearningModule | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.learningModules)
      .where(and(eq(tables.learningModules.orgId, orgId), eq(tables.learningModules.id, id)));
    return rows[0] ? mapLearningModule(rows[0]) : undefined;
  }

P.listLearningModules = async function(
    orgId: string,
    filters?: { category?: string; contentType?: string; isPublished?: boolean },
  ): Promise<LearningModule[]> {
    const conditions = [eq(tables.learningModules.orgId, orgId)];
    if (filters?.category) conditions.push(eq(tables.learningModules.category, filters.category));
    if (filters?.contentType) conditions.push(eq(tables.learningModules.contentType, filters.contentType));
    if (filters?.isPublished !== undefined)
      conditions.push(eq(tables.learningModules.isPublished, filters.isPublished));
    const rows = await db(this)
      .select()
      .from(tables.learningModules)
      .where(and(...conditions))
      .limit(QUERY_HARD_CAP);
    return rows.map((r) => mapLearningModule(r));
  }

P.updateLearningModule = async function(
    orgId: string,
    id: string,
    updates: Partial<LearningModule>,
  ): Promise<LearningModule | undefined> {
    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.title !== undefined) setClause.title = updates.title;
    if (updates.description !== undefined) setClause.description = updates.description;
    if (updates.content !== undefined) setClause.content = updates.content;
    if (updates.category !== undefined) setClause.category = updates.category;
    if (updates.quizQuestions !== undefined) setClause.quizQuestions = updates.quizQuestions;
    if (updates.estimatedMinutes !== undefined) setClause.estimatedMinutes = updates.estimatedMinutes;
    if (updates.difficulty !== undefined) setClause.difficulty = updates.difficulty;
    if (updates.tags !== undefined) setClause.tags = updates.tags;
    if (updates.isPublished !== undefined) setClause.isPublished = updates.isPublished;
    if (updates.sortOrder !== undefined) setClause.sortOrder = updates.sortOrder;
    if (updates.prerequisiteModuleIds !== undefined) setClause.prerequisiteModuleIds = updates.prerequisiteModuleIds;
    if (updates.passingScore !== undefined) setClause.passingScore = updates.passingScore;
    const rows = await db(this)
      .update(tables.learningModules)
      .set(setClause)
      .where(and(eq(tables.learningModules.orgId, orgId), eq(tables.learningModules.id, id)))
      .returning();
    return rows[0] ? mapLearningModule(rows[0]) : undefined;
  }

P.deleteLearningModule = async function(orgId: string, id: string): Promise<void> {
    await db(this)
      .delete(tables.learningModules)
      .where(and(eq(tables.learningModules.orgId, orgId), eq(tables.learningModules.id, id)));
  }

  // --- LMS: Learning Paths ---
P.createLearningPath = async function(orgId: string, path: InsertLearningPath): Promise<LearningPath> {
    const id = randomUUID();
    const [row] = await db(this)
      .insert(tables.learningPaths)
      .values({
        id,
        orgId,
        title: path.title,
        description: path.description || null,
        category: path.category || null,
        moduleIds: path.moduleIds,
        isRequired: path.isRequired ?? false,
        assignedTo: path.assignedTo || null,
        estimatedMinutes: path.estimatedMinutes || null,
        createdBy: path.createdBy,
        dueDate: path.dueDate ? new Date(path.dueDate) : null,
        enforceOrder: path.enforceOrder ?? false,
      })
      .returning();
    return mapLearningPath(row);
  }

P.getLearningPath = async function(orgId: string, id: string): Promise<LearningPath | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.learningPaths)
      .where(and(eq(tables.learningPaths.orgId, orgId), eq(tables.learningPaths.id, id)));
    return rows[0] ? mapLearningPath(rows[0]) : undefined;
  }

P.listLearningPaths = async function(orgId: string): Promise<LearningPath[]> {
    const rows = await db(this).select().from(tables.learningPaths).where(eq(tables.learningPaths.orgId, orgId));
    return rows.map((r) => mapLearningPath(r));
  }

P.updateLearningPath = async function(
    orgId: string,
    id: string,
    updates: Partial<LearningPath>,
  ): Promise<LearningPath | undefined> {
    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.title !== undefined) setClause.title = updates.title;
    if (updates.description !== undefined) setClause.description = updates.description;
    if (updates.moduleIds !== undefined) setClause.moduleIds = updates.moduleIds;
    if (updates.isRequired !== undefined) setClause.isRequired = updates.isRequired;
    if (updates.assignedTo !== undefined) setClause.assignedTo = updates.assignedTo;
    if (updates.estimatedMinutes !== undefined) setClause.estimatedMinutes = updates.estimatedMinutes;
    const rows = await db(this)
      .update(tables.learningPaths)
      .set(setClause)
      .where(and(eq(tables.learningPaths.orgId, orgId), eq(tables.learningPaths.id, id)))
      .returning();
    return rows[0] ? mapLearningPath(rows[0]) : undefined;
  }

P.deleteLearningPath = async function(orgId: string, id: string): Promise<void> {
    await db(this)
      .delete(tables.learningPaths)
      .where(and(eq(tables.learningPaths.orgId, orgId), eq(tables.learningPaths.id, id)));
  }

  // --- LMS: Learning Progress ---
P.upsertLearningProgress = async function(orgId: string, progress: InsertLearningProgress): Promise<LearningProgress> {
    // Use INSERT ... ON CONFLICT DO UPDATE to prevent race condition where
    // two concurrent requests both see "no record" and try to insert.
    const id = randomUUID();
    const [row] = await db(this)
      .insert(tables.learningProgress)
      .values({
        id,
        orgId,
        employeeId: progress.employeeId,
        moduleId: progress.moduleId,
        pathId: progress.pathId || null,
        status: progress.status || "not_started",
        quizScore: progress.quizScore ?? null,
        quizAttempts: progress.quizAttempts ?? null,
        timeSpentMinutes: progress.timeSpentMinutes ?? null,
        completedAt: progress.completedAt ? new Date(progress.completedAt) : null,
        notes: progress.notes || null,
      })
      .onConflictDoUpdate({
        target: [tables.learningProgress.orgId, tables.learningProgress.employeeId, tables.learningProgress.moduleId],
        set: {
          ...(progress.status ? { status: progress.status } : {}),
          ...(progress.quizScore !== undefined ? { quizScore: progress.quizScore } : {}),
          ...(progress.quizAttempts !== undefined ? { quizAttempts: progress.quizAttempts } : {}),
          ...(progress.timeSpentMinutes !== undefined ? { timeSpentMinutes: progress.timeSpentMinutes } : {}),
          ...(progress.completedAt ? { completedAt: new Date(progress.completedAt) } : {}),
          ...(progress.notes !== undefined ? { notes: progress.notes } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    return mapLearningProgress(row);
  }

P.getLearningProgress = async function(
    orgId: string,
    employeeId: string,
    moduleId: string,
  ): Promise<LearningProgress | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.learningProgress)
      .where(
        and(
          eq(tables.learningProgress.orgId, orgId),
          eq(tables.learningProgress.employeeId, employeeId),
          eq(tables.learningProgress.moduleId, moduleId),
        ),
      );
    return rows[0] ? mapLearningProgress(rows[0]) : undefined;
  }

P.getEmployeeLearningProgress = async function(orgId: string, employeeId: string): Promise<LearningProgress[]> {
    const rows = await db(this)
      .select()
      .from(tables.learningProgress)
      .where(and(eq(tables.learningProgress.orgId, orgId), eq(tables.learningProgress.employeeId, employeeId)));
    return rows.map((r) => mapLearningProgress(r));
  }

P.getModuleCompletionStats = async function(
    orgId: string,
    moduleId: string,
  ): Promise<{ total: number; completed: number; inProgress: number; avgScore: number }> {
    const rows = await db(this)
      .select()
      .from(tables.learningProgress)
      .where(and(eq(tables.learningProgress.orgId, orgId), eq(tables.learningProgress.moduleId, moduleId)));
    const completed = rows.filter((r) => r.status === "completed");
    const scores = completed.filter((r) => r.quizScore != null).map((r) => r.quizScore!);
    return {
      total: rows.length,
      completed: completed.length,
      inProgress: rows.filter((r) => r.status === "in_progress").length,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    };
  }

function mapLearningModule(r: LearningModuleRow): LearningModule {
    return {
      id: r.id,
      orgId: r.orgId,
      title: r.title,
      description: r.description || undefined,
      contentType: r.contentType,
      category: r.category || undefined,
      content: r.content || undefined,
      quizQuestions: r.quizQuestions as LearningModule["quizQuestions"],
      estimatedMinutes: r.estimatedMinutes || undefined,
      difficulty: (r.difficulty || undefined) as LearningModule["difficulty"],
      tags: (r.tags as string[]) || undefined,
      sourceDocumentId: r.sourceDocumentId || undefined,
      isPublished: r.isPublished,
      isPlatformContent: r.isPlatformContent,
      createdBy: r.createdBy,
      sortOrder: r.sortOrder || undefined,
      prerequisiteModuleIds: (r.prerequisiteModuleIds as string[]) || undefined,
      passingScore: r.passingScore || undefined,
      createdAt: toISOString(r.createdAt),
      updatedAt: toISOString(r.updatedAt),
    };
  }

function mapLearningPath(r: LearningPathRow): LearningPath {
    return {
      id: r.id,
      orgId: r.orgId,
      title: r.title,
      description: r.description || undefined,
      category: r.category || undefined,
      moduleIds: r.moduleIds as string[],
      isRequired: r.isRequired,
      assignedTo: (r.assignedTo as string[]) || undefined,
      estimatedMinutes: r.estimatedMinutes || undefined,
      createdBy: r.createdBy,
      dueDate: toISOString(r.dueDate),
      enforceOrder: r.enforceOrder ?? false,
      createdAt: toISOString(r.createdAt),
      updatedAt: toISOString(r.updatedAt),
    };
  }

function mapLearningProgress(r: LearningProgressRow): LearningProgress {
    return {
      id: r.id,
      orgId: r.orgId,
      employeeId: r.employeeId,
      moduleId: r.moduleId,
      pathId: r.pathId || undefined,
      status: r.status as LearningProgress["status"],
      quizScore: r.quizScore || undefined,
      quizAttempts: r.quizAttempts || undefined,
      timeSpentMinutes: r.timeSpentMinutes || undefined,
      completedAt: toISOString(r.completedAt),
      notes: r.notes || undefined,
      startedAt: toISOString(r.startedAt),
      updatedAt: toISOString(r.updatedAt),
    };
  }

  // --- Marketing Campaigns ---
P.createMarketingCampaign = async function(orgId: string, campaign: InsertMarketingCampaign): Promise<MarketingCampaign> {
    const id = randomUUID();
    const [row] = await db(this)
      .insert(tables.marketingCampaigns)
      .values({
        id,
        orgId,
        name: campaign.name,
        source: campaign.source,
        medium: campaign.medium || null,
        startDate: campaign.startDate ? new Date(campaign.startDate) : null,
        endDate: campaign.endDate ? new Date(campaign.endDate) : null,
        budget: campaign.budget || null,
        trackingCode: campaign.trackingCode || null,
        isActive: campaign.isActive ?? true,
        notes: campaign.notes || null,
        createdBy: campaign.createdBy,
      })
      .returning();
    return mapCampaign(row);
  }

P.getMarketingCampaign = async function(orgId: string, id: string): Promise<MarketingCampaign | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.marketingCampaigns)
      .where(and(eq(tables.marketingCampaigns.orgId, orgId), eq(tables.marketingCampaigns.id, id)));
    return rows[0] ? mapCampaign(rows[0]) : undefined;
  }

P.listMarketingCampaigns = async function(
    orgId: string,
    filters?: { source?: string; isActive?: boolean },
  ): Promise<MarketingCampaign[]> {
    const conditions = [eq(tables.marketingCampaigns.orgId, orgId)];
    if (filters?.source) conditions.push(eq(tables.marketingCampaigns.source, filters.source));
    if (filters?.isActive !== undefined) conditions.push(eq(tables.marketingCampaigns.isActive, filters.isActive));
    const rows = await db(this)
      .select()
      .from(tables.marketingCampaigns)
      .where(and(...conditions));
    return rows.map((r) => mapCampaign(r));
  }

P.updateMarketingCampaign = async function(
    orgId: string,
    id: string,
    updates: Partial<MarketingCampaign>,
  ): Promise<MarketingCampaign | undefined> {
    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) setClause.name = updates.name;
    if (updates.source !== undefined) setClause.source = updates.source;
    if (updates.medium !== undefined) setClause.medium = updates.medium;
    if (updates.budget !== undefined) setClause.budget = updates.budget;
    if (updates.isActive !== undefined) setClause.isActive = updates.isActive;
    if (updates.notes !== undefined) setClause.notes = updates.notes;
    if (updates.trackingCode !== undefined) setClause.trackingCode = updates.trackingCode;
    const rows = await db(this)
      .update(tables.marketingCampaigns)
      .set(setClause)
      .where(and(eq(tables.marketingCampaigns.orgId, orgId), eq(tables.marketingCampaigns.id, id)))
      .returning();
    return rows[0] ? mapCampaign(rows[0]) : undefined;
  }

P.deleteMarketingCampaign = async function(orgId: string, id: string): Promise<void> {
    await db(this)
      .delete(tables.marketingCampaigns)
      .where(and(eq(tables.marketingCampaigns.orgId, orgId), eq(tables.marketingCampaigns.id, id)));
  }

  // --- Call Attribution ---
P.createCallAttribution = async function(orgId: string, attr: InsertCallAttribution): Promise<CallAttribution> {
    const id = randomUUID();
    const [row] = await db(this)
      .insert(tables.callAttributions)
      .values({
        id,
        orgId,
        callId: attr.callId,
        source: attr.source,
        campaignId: attr.campaignId || null,
        medium: attr.medium || null,
        isNewPatient: attr.isNewPatient || null,
        referrerName: attr.referrerName || null,
        detectionMethod: attr.detectionMethod || null,
        confidence: attr.confidence || null,
        notes: attr.notes || null,
        attributedBy: attr.attributedBy || null,
      })
      .returning();
    return mapAttribution(row);
  }

P.getCallAttribution = async function(orgId: string, callId: string): Promise<CallAttribution | undefined> {
    const rows = await db(this)
      .select()
      .from(tables.callAttributions)
      .where(and(eq(tables.callAttributions.orgId, orgId), eq(tables.callAttributions.callId, callId)));
    return rows[0] ? mapAttribution(rows[0]) : undefined;
  }

P.listCallAttributions = async function(
    orgId: string,
    filters?: { source?: string; campaignId?: string },
  ): Promise<CallAttribution[]> {
    const conditions = [eq(tables.callAttributions.orgId, orgId)];
    if (filters?.source) conditions.push(eq(tables.callAttributions.source, filters.source));
    if (filters?.campaignId) conditions.push(eq(tables.callAttributions.campaignId, filters.campaignId));
    const rows = await db(this)
      .select()
      .from(tables.callAttributions)
      .where(and(...conditions));
    return rows.map((r) => mapAttribution(r));
  }

P.updateCallAttribution = async function(
    orgId: string,
    callId: string,
    updates: Partial<CallAttribution>,
  ): Promise<CallAttribution | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.source !== undefined) setClause.source = updates.source;
    if (updates.campaignId !== undefined) setClause.campaignId = updates.campaignId;
    if (updates.isNewPatient !== undefined) setClause.isNewPatient = updates.isNewPatient;
    if (updates.referrerName !== undefined) setClause.referrerName = updates.referrerName;
    if (updates.notes !== undefined) setClause.notes = updates.notes;
    if (updates.detectionMethod !== undefined) setClause.detectionMethod = updates.detectionMethod;
    if (updates.confidence !== undefined) setClause.confidence = updates.confidence;
    if (updates.attributedBy !== undefined) setClause.attributedBy = updates.attributedBy;
    if (updates.utmSource !== undefined) setClause.utmSource = updates.utmSource;
    if (updates.utmMedium !== undefined) setClause.utmMedium = updates.utmMedium;
    if (updates.utmCampaign !== undefined) setClause.utmCampaign = updates.utmCampaign;
    if (updates.utmContent !== undefined) setClause.utmContent = updates.utmContent;
    if (updates.utmTerm !== undefined) setClause.utmTerm = updates.utmTerm;
    const rows = await db(this)
      .update(tables.callAttributions)
      .set(setClause)
      .where(and(eq(tables.callAttributions.orgId, orgId), eq(tables.callAttributions.callId, callId)))
      .returning();
    return rows[0] ? mapAttribution(rows[0]) : undefined;
  }

P.deleteCallAttribution = async function(orgId: string, callId: string): Promise<void> {
    await db(this)
      .delete(tables.callAttributions)
      .where(and(eq(tables.callAttributions.orgId, orgId), eq(tables.callAttributions.callId, callId)));
  }

function mapCampaign(r: MarketingCampaignRow): MarketingCampaign {
    return {
      id: r.id,
      orgId: r.orgId,
      name: r.name,
      source: r.source,
      medium: r.medium || undefined,
      startDate: toISOString(r.startDate),
      endDate: toISOString(r.endDate),
      budget: r.budget || undefined,
      trackingCode: r.trackingCode || undefined,
      isActive: r.isActive,
      notes: r.notes || undefined,
      createdBy: r.createdBy,
      createdAt: toISOString(r.createdAt),
      updatedAt: toISOString(r.updatedAt),
    };
  }

function mapAttribution(r: CallAttributionRow): CallAttribution {
    return {
      id: r.id,
      orgId: r.orgId,
      callId: r.callId,
      source: r.source,
      campaignId: r.campaignId || undefined,
      medium: r.medium || undefined,
      isNewPatient: r.isNewPatient || undefined,
      referrerName: r.referrerName || undefined,
      detectionMethod: (r.detectionMethod || undefined) as CallAttribution["detectionMethod"],
      confidence: r.confidence || undefined,
      notes: r.notes || undefined,
      attributedBy: r.attributedBy || undefined,
      utmSource: r.utmSource || undefined,
      utmMedium: r.utmMedium || undefined,
      utmCampaign: r.utmCampaign || undefined,
      utmContent: r.utmContent || undefined,
      utmTerm: r.utmTerm || undefined,
      createdAt: toISOString(r.createdAt),
    };
  }

  // --- Provider templates (custom clinical note templates per provider) ---

P.getProviderTemplates = async function(orgId: string, userId: string): Promise<any[]> {
    const rows = await db(this)
      .select()
      .from(tables.providerTemplates)
      .where(and(eq(tables.providerTemplates.orgId, orgId), eq(tables.providerTemplates.userId, userId)))
      .orderBy(tables.providerTemplates.createdAt);
    return rows.map((r) => mapProviderTemplate(r));
  }

P.getAllProviderTemplates = async function(orgId: string): Promise<any[]> {
    const rows = await db(this)
      .select()
      .from(tables.providerTemplates)
      .where(eq(tables.providerTemplates.orgId, orgId))
      .orderBy(tables.providerTemplates.createdAt);
    return rows.map((r) => mapProviderTemplate(r));
  }

P.createProviderTemplate = async function(orgId: string, template: any): Promise<any> {
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
  }

P.updateProviderTemplate = async function(orgId: string, id: string, userId: string, updates: any): Promise<any | null> {
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
  }

P.deleteProviderTemplate = async function(orgId: string, id: string, userId: string): Promise<boolean> {
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
  }

  // ─── GDPR/CCPA: bulk org data deletion ───────────────────────────────────────

  /**
   * Delete all org data in FK-safe order.
   * Cascades from calls.ts ON DELETE CASCADE will handle child rows automatically.
   * Returns counts of top-level records deleted.
   */
P.deleteOrgData = async function(
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
      // 9. Delete calls (cascades: transcripts, sentiment_analyses, call_analyses via FK CASCADE)
      const callsResult = await tx.execute(sql`DELETE FROM calls WHERE org_id = ${orgId}`);
      const callsDeleted = ((callsResult as { rowCount?: number }).rowCount ?? 0);
      // 10. Delete gamification data
      await tx.execute(sql`DELETE FROM employee_badges WHERE org_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM gamification_profiles WHERE org_id = ${orgId}`);
      // 11. Delete learning data
      await tx.execute(sql`DELETE FROM learning_progress WHERE org_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM learning_paths WHERE org_id = ${orgId}`);
      await tx.execute(sql`DELETE FROM learning_modules WHERE org_id = ${orgId}`);
      // 12. Delete employees
      const empResult = await tx.execute(sql`DELETE FROM employees WHERE org_id = ${orgId}`);
      const employeesDeleted = ((empResult as { rowCount?: number }).rowCount ?? 0);
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
      await tx.execute(sql`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE org_id = ${orgId})`);
      // 22. Delete users
      const usersResult = await tx.execute(sql`DELETE FROM users WHERE org_id = ${orgId}`);
      const usersDeleted = ((usersResult as { rowCount?: number }).rowCount ?? 0);
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
  }

  // ─── Super-admin usage summary ────────────────────────────────────────────

  /**
   * Aggregate per-org resource consumption using efficient SQL queries.
   * Avoids N+1 by using COUNT/SUM aggregates in a single pass.
   */
P.getOrgUsageSummary = async function(orgId: string): Promise<{
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

    const callRow = ((callStats as { rows: Record<string, unknown>[] }).rows?.[0]) || {} as Record<string, unknown>;
    const costRow = ((costStats as { rows: Record<string, unknown>[] }).rows?.[0]) || {} as Record<string, unknown>;
    const empRow = ((empStats as { rows: Record<string, unknown>[] }).rows?.[0]) || {} as Record<string, unknown>;

    return {
      totalCalls: Number(callRow.total_calls ?? 0),
      completedCalls: Number(callRow.completed_calls ?? 0),
      totalDurationSeconds: Number(callRow.total_duration ?? 0),
      totalEstimatedCostUsd: Number(costRow.total_cost ?? 0),
      employeeCount: Number(empRow.employee_count ?? 0),
    };
  }

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

P.listBusinessAssociateAgreements = async function(orgId: string): Promise<any[]> {
  const rows = await db(this).select().from(tables.businessAssociateAgreements)
    .where(eq(tables.businessAssociateAgreements.orgId, orgId))
    .orderBy(desc(tables.businessAssociateAgreements.createdAt));
  return rows.map(mapBaa);
};

P.getBusinessAssociateAgreement = async function(orgId: string, id: string): Promise<any | undefined> {
  const rows = await db(this).select().from(tables.businessAssociateAgreements)
    .where(and(eq(tables.businessAssociateAgreements.orgId, orgId), eq(tables.businessAssociateAgreements.id, id)))
    .limit(1);
  return rows[0] ? mapBaa(rows[0]) : undefined;
};

P.createBusinessAssociateAgreement = async function(orgId: string, baa: any): Promise<any> {
  const [row] = await db(this).insert(tables.businessAssociateAgreements).values({
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
  }).returning();
  return mapBaa(row);
};

P.updateBusinessAssociateAgreement = async function(orgId: string, id: string, updates: any): Promise<any | undefined> {
  const updateData: Record<string, any> = {};
  const allowedFields = [
    "vendorName", "vendorType", "description", "contactName", "contactEmail",
    "status", "signedAt", "expiresAt", "renewalReminderDays", "signedBy",
    "vendorSignatory", "documentUrl", "notes", "phiCategories",
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

  const [row] = await db(this).update(tables.businessAssociateAgreements)
    .set(updateData)
    .where(and(eq(tables.businessAssociateAgreements.orgId, orgId), eq(tables.businessAssociateAgreements.id, id)))
    .returning();
  return row ? mapBaa(row) : undefined;
};

