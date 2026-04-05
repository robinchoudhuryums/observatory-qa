/**
 * PostgreSQL storage backend implementing IStorage.
 *
 * Replaces S3 JSON files with proper relational queries for all
 * structured data. Audio files remain in S3 via a separate ObjectStorageClient.
 *
 * Benefits over CloudStorage:
 * - O(1) lookups instead of downloading JSON files
 * - SQL-level filtering, sorting, pagination
 * - Transactional integrity
 * - Full-text search via PostgreSQL (no need to load all transcripts into memory)
 * - Proper indexing for dashboard metrics
 */
import { eq, and, or, desc, sql, ilike, lt, gte, lte, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Database } from "./index";
import type { ObjectStorageClient } from "../storage";
import type { IStorage } from "../storage";
import type {
  User,
  InsertUser,
  Employee,
  InsertEmployee,
  Call,
  InsertCall,
  Transcript,
  InsertTranscript,
  SentimentAnalysis,
  InsertSentimentAnalysis,
  CallAnalysis,
  InsertCallAnalysis,
  CallWithDetails,
  CallSummary,
  DashboardMetrics,
  SentimentDistribution,
  TopPerformer,
  AccessRequest,
  InsertAccessRequest,
  PromptTemplate,
  InsertPromptTemplate,
  CoachingSession,
  InsertCoachingSession,
  Organization,
  InsertOrganization,
  Invitation,
  InsertInvitation,
  ApiKey,
  InsertApiKey,
  Subscription,
  InsertSubscription,
  ReferenceDocument,
  InsertReferenceDocument,
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
  CallShare,
  InsertCallShare,
} from "@shared/schema";
import * as tables from "./schema";
import { normalizeAnalysis } from "../storage";

// JSONB field types — typed casts in mappers (replaces `as any` with documented types)
// These mirror the Zod schemas in shared/schema but are plain TS for the DB layer.
type AnalysisFeedback = { strengths?: Array<string | { text: string; timestamp?: string }>; suggestions?: Array<string | { text: string; timestamp?: string }> };
type ManualEdit = { editedBy: string; editedAt: string; reason: string; fieldsChanged: string[]; previousValues: Record<string, unknown> };
type ConfidenceFactors = { transcriptConfidence: number; wordCount: number; callDurationSeconds: number; transcriptLength: number; aiAnalysisCompleted: boolean; overallScore: number; [key: string]: unknown };
type SubScores = { compliance?: number; customerExperience?: number; communication?: number; resolution?: number };
type SpeechMetrics = { talkSpeedWpm?: number; deadAirSeconds?: number; deadAirCount?: number; longestDeadAirSeconds?: number; interruptionCount?: number; fillerWordCount?: number; fillerWords?: Record<string, number>; avgResponseTimeMs?: number; talkListenRatio?: number; speakerATalkPercent?: number; speakerBTalkPercent?: number };
type SelfReview = { score?: number; notes?: string; reviewedAt?: string; reviewedBy?: string };
type ScoreDispute = { status: "open" | "under_review" | "accepted" | "rejected"; reason: string; disputedBy: string; disputedAt: string; resolvedBy?: string; resolvedAt?: string; resolution?: string; originalScore?: number; adjustedScore?: number };
type SuggestedBillingCodes = { cptCodes?: Array<{ code: string; description: string; confidence: number }>; icd10Codes?: Array<{ code: string; description: string; confidence: number }>; cdtCodes?: Array<{ code: string; description: string; confidence: number }> };
type EhrPushStatus = { success: boolean; ehrRecordId?: string; error?: string; timestamp: string; retriedViaQueue?: boolean; requiresManualRetry?: boolean };
type SentimentSegment = { text: string; sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE"; confidence: number; start: number; end: number };
type TranscriptWord = { text: string; start: number; end: number; confidence: number; speaker?: string };
type TranscriptCorrection = { wordIndex: number; original: string; corrected: string; correctedBy: string; correctedAt: string };
type RequiredPhrase = { severity: "required" | "recommended"; phrase: string; label: string };
type ScoringWeights = { compliance: number; customerExperience: number; communication: number; resolution: number };
type CoachingActionItem = { task: string; completed: boolean };
type EffectivenessSnap = { preCoaching?: { avgScore?: number }; postCoaching?: { avgScore?: number }; [key: string]: unknown };

// Raw SQL execute result — Drizzle returns rows directly or wrapped in { rows: [...] }
// depending on the driver. This helper normalizes both formats.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawRows(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

// Row types inferred from Drizzle schema — used to type mapper function parameters
type OrgRow = typeof tables.organizations.$inferSelect;
type UserRow = typeof tables.users.$inferSelect;
type EmployeeRow = typeof tables.employees.$inferSelect;
type CallRow = typeof tables.calls.$inferSelect;
type TranscriptRow = typeof tables.transcripts.$inferSelect;
type SentimentRow = typeof tables.sentimentAnalyses.$inferSelect;
type AnalysisRow = typeof tables.callAnalyses.$inferSelect;
type AccessRequestRow = typeof tables.accessRequests.$inferSelect;
type PromptTemplateRow = typeof tables.promptTemplates.$inferSelect;
type CoachingSessionRow = typeof tables.coachingSessions.$inferSelect;
type ApiKeyRow = typeof tables.apiKeys.$inferSelect;
type SubscriptionRow = typeof tables.subscriptions.$inferSelect;
type ReferenceDocumentRow = typeof tables.referenceDocuments.$inferSelect;
type InvitationRow = typeof tables.invitations.$inferSelect;
import { logger } from "../services/logger";
import { encryptField, decryptField, isPhiEncryptionEnabled } from "../services/phi-encryption";

/**
 * Convert a Drizzle row (with Date objects for timestamps)
 * to the app's format (ISO strings for timestamps).
 */
function toISOString(date: Date | null | undefined): string | undefined {
  return date ? date.toISOString() : undefined;
}

/**
 * Hard cap applied to unbounded list queries that accumulate over time.
 * Prevents runaway memory usage when fetching all records for large orgs.
 * Routes that need to serve more records should use cursor- or offset-based pagination.
 */
const QUERY_HARD_CAP = 5000;

/**
 * Execute an inArray query in chunks to avoid exceeding PostgreSQL's parameter limit.
 * When arrays exceed ~5000 elements, some drivers hit issues with parameter binding.
 */
const IN_ARRAY_CHUNK_SIZE = 3000;

async function chunkedInArray<T>(
  db: Database,
  queryFn: (chunk: string[]) => Promise<T[]>,
  ids: string[],
): Promise<T[]> {
  if (ids.length <= IN_ARRAY_CHUNK_SIZE) {
    return queryFn(ids);
  }
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += IN_ARRAY_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_ARRAY_CHUNK_SIZE);
    const chunkResults = await queryFn(chunk);
    results.push(...chunkResults);
  }
  return results;
}

// Note: IStorage conformance is enforced at the storage factory level
// (server/storage/index.ts). The `implements` clause is removed here because
// feature methods are attached via prototype in pg-storage-features.ts —
// TypeScript can't see prototype assignments as satisfying the interface.
export class PostgresStorage {
  private db: Database;
  private blobClient: ObjectStorageClient | null;

  /**
   * @param db - Drizzle database instance
   * @param blobClient - Optional S3/GCS client for audio file storage
   */
  constructor(db: Database, blobClient: ObjectStorageClient | null = null) {
    this.db = db;
    this.blobClient = blobClient;
  }

  /**
   * Execute a set of database operations within a single transaction.
   * All operations either commit together or roll back together.
   *
   * The callback receives no arguments — during the transaction, all
   * storage methods on this instance automatically use the transaction
   * handle (this.db is temporarily swapped to the tx handle).
   *
   * This matches the IStorage interface so callers can use
   * `storage.withTransaction(() => { ... })` regardless of backend.
   *
   * @example
   * await storage.withTransaction(async () => {
   *   await storage.createTranscript(orgId, transcript);
   *   await storage.createCallAnalysis(orgId, analysis);
   *   // Both commit together or both roll back
   * });
   */
  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const originalDb = this.db;
    try {
      return await originalDb.transaction(async (tx) => {
        // Temporarily replace the DB handle so all methods called within
        // the callback use the transaction automatically.
        this.db = tx as unknown as Database;
        try {
          return await fn();
        } finally {
          this.db = originalDb;
        }
      });
    } catch (err) {
      // Ensure db is restored even if transaction setup itself fails
      this.db = originalDb;
      throw err;
    }
  }

  // --- Organization operations ---
  async getOrganization(orgId: string): Promise<Organization | undefined> {
    const rows = await this.db.select().from(tables.organizations).where(eq(tables.organizations.id, orgId)).limit(1);
    return rows[0] ? this.mapOrg(rows[0]) : undefined;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    const rows = await this.db.select().from(tables.organizations).where(eq(tables.organizations.slug, slug)).limit(1);
    return rows[0] ? this.mapOrg(rows[0]) : undefined;
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.organizations)
      .values({
        id,
        name: org.name,
        slug: org.slug,
        status: org.status || "active",
        settings: org.settings || null,
      })
      .returning();
    return this.mapOrg(row);
  }

  async updateOrganization(orgId: string, updates: Partial<Organization>): Promise<Organization | undefined> {
    const [row] = await this.db
      .update(tables.organizations)
      .set({
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.slug !== undefined ? { slug: updates.slug } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.settings !== undefined ? { settings: updates.settings } : {}),
      })
      .where(eq(tables.organizations.id, orgId))
      .returning();
    return row ? this.mapOrg(row) : undefined;
  }

  async listOrganizations(): Promise<Organization[]> {
    const rows = await this.db.select().from(tables.organizations).limit(QUERY_HARD_CAP);
    return rows.map((r) => this.mapOrg(r));
  }

  // --- User operations ---
  async getUser(id: string): Promise<User | undefined> {
    const rows = await this.db.select().from(tables.users).where(eq(tables.users.id, id)).limit(1);
    return rows[0] ? this.mapUser(rows[0]) : undefined;
  }

  async getUserByUsername(username: string, orgId?: string): Promise<User | undefined> {
    const conditions = [eq(tables.users.username, username)];
    if (orgId) conditions.push(eq(tables.users.orgId, orgId));
    const rows = await this.db
      .select()
      .from(tables.users)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ? this.mapUser(rows[0]) : undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.users)
      .values({
        id,
        orgId: user.orgId || "",
        username: user.username,
        passwordHash: user.passwordHash,
        name: user.name,
        role: user.role || "viewer",
      })
      .returning();
    return this.mapUser(row);
  }

  async listUsersByOrg(orgId: string): Promise<User[]> {
    const rows = await this.db.select().from(tables.users).where(eq(tables.users.orgId, orgId));
    return rows.map((r) => this.mapUser(r));
  }

  async updateUser(orgId: string, id: string, updates: Partial<User>): Promise<User | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.name !== undefined) setClause.name = updates.name;
    if (updates.role !== undefined) setClause.role = updates.role;
    if (updates.passwordHash !== undefined) setClause.passwordHash = updates.passwordHash;
    if (updates.mfaEnabled !== undefined) setClause.mfaEnabled = updates.mfaEnabled;
    if (updates.mfaSecret !== undefined) setClause.mfaSecret = updates.mfaSecret;
    if (updates.mfaBackupCodes !== undefined) setClause.mfaBackupCodes = updates.mfaBackupCodes;
    if (updates.subTeam !== undefined) setClause.subTeam = updates.subTeam;
    if (updates.webauthnCredentials !== undefined) setClause.webauthnCredentials = updates.webauthnCredentials;
    if (updates.mfaTrustedDevices !== undefined) setClause.mfaTrustedDevices = updates.mfaTrustedDevices;
    if (updates.mfaEnrollmentDeadline !== undefined) setClause.mfaEnrollmentDeadline = updates.mfaEnrollmentDeadline;

    if (Object.keys(setClause).length === 0) return this.getUser(id);

    const [row] = await this.db
      .update(tables.users)
      .set(setClause)
      .where(and(eq(tables.users.id, id), eq(tables.users.orgId, orgId)))
      .returning();
    return row ? this.mapUser(row) : undefined;
  }

  async deleteUser(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.users).where(and(eq(tables.users.id, id), eq(tables.users.orgId, orgId)));
  }

  // --- Employee operations ---
  async getEmployee(orgId: string, id: string): Promise<Employee | undefined> {
    const rows = await this.db
      .select()
      .from(tables.employees)
      .where(and(eq(tables.employees.id, id), eq(tables.employees.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapEmployee(rows[0]) : undefined;
  }

  async getEmployeeByEmail(orgId: string, email: string): Promise<Employee | undefined> {
    const rows = await this.db
      .select()
      .from(tables.employees)
      .where(and(eq(tables.employees.orgId, orgId), eq(tables.employees.email, email)))
      .limit(1);
    return rows[0] ? this.mapEmployee(rows[0]) : undefined;
  }

  async createEmployee(orgId: string, employee: InsertEmployee): Promise<Employee> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.employees)
      .values({
        id,
        orgId,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        initials: employee.initials,
        status: employee.status || "Active",
        subTeam: employee.subTeam,
      })
      .returning();
    return this.mapEmployee(row);
  }

  async updateEmployee(orgId: string, id: string, updates: Partial<Employee>): Promise<Employee | undefined> {
    const [row] = await this.db
      .update(tables.employees)
      .set({
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.email !== undefined ? { email: updates.email } : {}),
        ...(updates.role !== undefined ? { role: updates.role } : {}),
        ...(updates.initials !== undefined ? { initials: updates.initials } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.subTeam !== undefined ? { subTeam: updates.subTeam } : {}),
      })
      .where(and(eq(tables.employees.id, id), eq(tables.employees.orgId, orgId)))
      .returning();
    return row ? this.mapEmployee(row) : undefined;
  }

  async getAllEmployees(orgId: string): Promise<Employee[]> {
    const rows = await this.db
      .select()
      .from(tables.employees)
      .where(eq(tables.employees.orgId, orgId))
      .limit(QUERY_HARD_CAP);
    return rows.map((r) => this.mapEmployee(r));
  }

  // --- Count operations (SQL COUNT for efficiency) ---
  async countUsersByOrg(orgId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(tables.users)
      .where(eq(tables.users.orgId, orgId));
    return result?.count || 0;
  }

  async countCallsByOrg(orgId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(tables.calls)
      .where(eq(tables.calls.orgId, orgId));
    return result?.count || 0;
  }

  async countCallsByOrgAndStatus(
    orgId: string,
  ): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
    const rows = await this.db
      .select({
        status: tables.calls.status,
        count: sql<number>`count(*)::int`,
      })
      .from(tables.calls)
      .where(eq(tables.calls.orgId, orgId))
      .groupBy(tables.calls.status);

    const result = { pending: 0, processing: 0, completed: 0, failed: 0 } as Record<string, number>;
    for (const row of rows) {
      if (row.status in result) result[row.status] = row.count;
    }
    return result as { pending: number; processing: number; completed: number; failed: number };
  }

  // --- Call operations ---
  async getCall(orgId: string, id: string): Promise<Call | undefined> {
    const rows = await this.db
      .select()
      .from(tables.calls)
      .where(and(eq(tables.calls.id, id), eq(tables.calls.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapCall(rows[0]) : undefined;
  }

  async createCall(orgId: string, call: InsertCall): Promise<Call> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.calls)
      .values({
        id,
        orgId,
        employeeId: call.employeeId,
        fileName: call.fileName,
        filePath: call.filePath,
        status: call.status || "pending",
        duration: call.duration,
        assemblyAiId: call.assemblyAiId,
        callCategory: call.callCategory,
        tags: call.tags || null,
        channel: call.channel || "voice",
        emailSubject: call.emailSubject,
        emailFrom: call.emailFrom,
        emailTo: call.emailTo,
        emailCc: call.emailCc,
        emailBody: call.emailBody,
        emailBodyHtml: call.emailBodyHtml,
        emailMessageId: call.emailMessageId,
        emailThreadId: call.emailThreadId,
        emailReceivedAt: call.emailReceivedAt ? new Date(call.emailReceivedAt) : undefined,
        chatPlatform: call.chatPlatform,
        messageCount: call.messageCount,
        fileHash: call.fileHash,
      })
      .returning();
    return this.mapCall(row);
  }

  async updateCall(orgId: string, id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.employeeId !== undefined) setClause.employeeId = updates.employeeId;
    if (updates.fileName !== undefined) setClause.fileName = updates.fileName;
    if (updates.filePath !== undefined) setClause.filePath = updates.filePath;
    if (updates.status !== undefined) setClause.status = updates.status;
    if (updates.duration !== undefined) setClause.duration = updates.duration;
    if (updates.assemblyAiId !== undefined) setClause.assemblyAiId = updates.assemblyAiId;
    if (updates.callCategory !== undefined) setClause.callCategory = updates.callCategory;
    if (updates.tags !== undefined) setClause.tags = updates.tags;
    if (updates.channel !== undefined) setClause.channel = updates.channel;
    if (updates.emailSubject !== undefined) setClause.emailSubject = updates.emailSubject;
    if (updates.emailFrom !== undefined) setClause.emailFrom = updates.emailFrom;
    if (updates.emailTo !== undefined) setClause.emailTo = updates.emailTo;
    if (updates.emailBody !== undefined) setClause.emailBody = updates.emailBody;
    if (updates.emailBodyHtml !== undefined) setClause.emailBodyHtml = updates.emailBodyHtml;
    if (updates.emailCc !== undefined) setClause.emailCc = updates.emailCc;
    if (updates.emailMessageId !== undefined) setClause.emailMessageId = updates.emailMessageId;
    if (updates.emailThreadId !== undefined) setClause.emailThreadId = updates.emailThreadId;
    if (updates.emailReceivedAt !== undefined)
      setClause.emailReceivedAt = updates.emailReceivedAt ? new Date(updates.emailReceivedAt) : null;
    if (updates.fileHash !== undefined) setClause.fileHash = updates.fileHash;

    const [row] = await this.db
      .update(tables.calls)
      .set(setClause)
      .where(and(eq(tables.calls.id, id), eq(tables.calls.orgId, orgId)))
      .returning();
    return row ? this.mapCall(row) : undefined;
  }

  async deleteCall(orgId: string, id: string): Promise<void> {
    // Cascading deletes handle transcripts, sentiments, analyses
    await this.db.delete(tables.calls).where(and(eq(tables.calls.id, id), eq(tables.calls.orgId, orgId)));
    // Clean up audio from blob storage
    if (this.blobClient) {
      try {
        await this.blobClient.deleteByPrefix(`orgs/${orgId}/audio/${id}/`);
      } catch (error) {
        logger.error({ err: error, callId: id, orgId }, "Failed to delete audio blobs");
      }
    }
  }

  async getCallByFileHash(orgId: string, fileHash: string): Promise<Call | undefined> {
    const rows = await this.db
      .select()
      .from(tables.calls)
      .where(
        and(
          eq(tables.calls.orgId, orgId),
          eq(tables.calls.fileHash, fileHash),
          sql`${tables.calls.status} != 'failed'`,
        ),
      )
      .limit(1);
    return rows[0] ? this.mapCall(rows[0]) : undefined;
  }

  async getCallByAssemblyAiId(transcriptId: string): Promise<Call | null> {
    const rows = await this.db.select().from(tables.calls).where(eq(tables.calls.assemblyAiId, transcriptId)).limit(1);
    return rows[0] ? this.mapCall(rows[0]) : null;
  }

  async getAllCalls(orgId: string): Promise<Call[]> {
    const rows = await this.db
      .select()
      .from(tables.calls)
      .where(eq(tables.calls.orgId, orgId))
      .orderBy(desc(tables.calls.uploadedAt))
      .limit(QUERY_HARD_CAP);
    return rows.map((r) => this.mapCall(r));
  }

  async getCallsWithDetails(
    orgId: string,
    filters: { status?: string; sentiment?: string; employee?: string; limit?: number; offset?: number } = {},
  ): Promise<CallWithDetails[]> {
    let callRows: any[];

    if (filters.sentiment) {
      // Use SQL-level JOIN to filter by sentiment (avoids loading all calls then filtering in-memory)
      const conditions: any[] = [
        eq(tables.calls.orgId, orgId),
        eq(tables.sentimentAnalyses.overallSentiment, filters.sentiment),
      ];
      if (filters.status) conditions.push(eq(tables.calls.status, filters.status));
      if (filters.employee) conditions.push(eq(tables.calls.employeeId, filters.employee));

      let query = this.db
        .select({ call: tables.calls })
        .from(tables.calls)
        .innerJoin(tables.sentimentAnalyses, eq(tables.calls.id, tables.sentimentAnalyses.callId))
        .where(and(...conditions))
        .orderBy(desc(tables.calls.uploadedAt))
        .$dynamic();

      if (filters.limit && filters.limit > 0) {
        query = query.limit(filters.limit);
        if (filters.offset) query = query.offset(filters.offset);
      }

      const joinRows = await query;
      callRows = joinRows.map((r: any) => r.call);
    } else {
      // Standard query without sentiment filter
      const conditions: any[] = [eq(tables.calls.orgId, orgId)];
      if (filters.status) conditions.push(eq(tables.calls.status, filters.status));
      if (filters.employee) conditions.push(eq(tables.calls.employeeId, filters.employee));

      let query = this.db
        .select()
        .from(tables.calls)
        .where(and(...conditions))
        .orderBy(desc(tables.calls.uploadedAt))
        .$dynamic();

      if (filters.limit && filters.limit > 0) {
        query = query.limit(filters.limit);
        if (filters.offset) query = query.offset(filters.offset);
      }

      callRows = await query;
    }

    if (callRows.length === 0) return [];

    const callIds = callRows.map((c: any) => c.id);

    // Collect unique employee IDs to fetch only needed employees
    const empIdsNeeded = Array.from(new Set(callRows.map((c: any) => c.employeeId).filter(Boolean))) as string[];

    // Batch-load related data scoped to matched call IDs (chunked to avoid parameter limits)
    const [empRows, txRows, sentRows, analysisRows] = await Promise.all([
      empIdsNeeded.length > 0
        ? chunkedInArray(
            this.db,
            (ids) => this.db.select().from(tables.employees).where(inArray(tables.employees.id, ids)),
            empIdsNeeded,
          )
        : Promise.resolve([]),
      chunkedInArray(
        this.db,
        (ids) => this.db.select().from(tables.transcripts).where(inArray(tables.transcripts.callId, ids)),
        callIds,
      ),
      chunkedInArray(
        this.db,
        (ids) => this.db.select().from(tables.sentimentAnalyses).where(inArray(tables.sentimentAnalyses.callId, ids)),
        callIds,
      ),
      chunkedInArray(
        this.db,
        (ids) => this.db.select().from(tables.callAnalyses).where(inArray(tables.callAnalyses.callId, ids)),
        callIds,
      ),
    ]);

    const empMap = new Map(empRows.map((e) => [e.id, this.mapEmployee(e)]));
    const txMap = new Map(txRows.map((t) => [t.callId, this.mapTranscript(t)]));
    const sentMap = new Map(sentRows.map((s) => [s.callId, this.mapSentiment(s)]));
    const analysisMap = new Map(analysisRows.map((a) => [a.callId, this.mapAnalysis(a)]));

    return callRows.map((row: any) => {
      const call = this.mapCall(row);
      return {
        ...call,
        employee: call.employeeId ? empMap.get(call.employeeId) : undefined,
        transcript: txMap.get(call.id),
        sentiment: sentMap.get(call.id),
        analysis: normalizeAnalysis(analysisMap.get(call.id)),
      };
    });
  }

  async getCallSummaries(
    orgId: string,
    filters: { status?: string; sentiment?: string; employee?: string; limit?: number; offset?: number } = {},
  ): Promise<CallSummary[]> {
    // Same as getCallsWithDetails but skips transcript table entirely
    const conditions = [eq(tables.calls.orgId, orgId)];
    if (filters.status) conditions.push(eq(tables.calls.status, filters.status));
    if (filters.employee) conditions.push(eq(tables.calls.employeeId, filters.employee));

    // Apply query-level limit to prevent OOM on large orgs (export routes can have 100K+ calls)
    const queryLimit = filters.limit ?? 50_000; // Hard cap: never load more than 50K rows
    let query = this.db
      .select()
      .from(tables.calls)
      .where(and(...conditions))
      .orderBy(desc(tables.calls.uploadedAt))
      .limit(queryLimit);
    if (filters.offset) query = query.offset(filters.offset) as typeof query;
    const callRows = await query;

    if (callRows.length === 0) return [];

    const callIds = callRows.map((c) => c.id);
    const empIdsNeeded = Array.from(new Set(callRows.map((c) => c.employeeId).filter(Boolean))) as string[];

    // Batch-load related data scoped to matched calls (NO transcripts)
    const [empRows, sentRows, analysisRows] = await Promise.all([
      empIdsNeeded.length > 0
        ? this.db.select().from(tables.employees).where(inArray(tables.employees.id, empIdsNeeded))
        : Promise.resolve([]),
      this.db.select().from(tables.sentimentAnalyses).where(inArray(tables.sentimentAnalyses.callId, callIds)),
      this.db.select().from(tables.callAnalyses).where(inArray(tables.callAnalyses.callId, callIds)),
    ]);

    const empMap = new Map(empRows.map((e) => [e.id, this.mapEmployee(e)]));
    const sentMap = new Map(sentRows.map((s) => [s.callId, this.mapSentiment(s)]));
    const analysisMap = new Map(analysisRows.map((a) => [a.callId, this.mapAnalysis(a)]));

    let results: CallSummary[] = callRows.map((row) => {
      const call = this.mapCall(row);
      return {
        ...call,
        employee: call.employeeId ? empMap.get(call.employeeId) : undefined,
        sentiment: sentMap.get(call.id),
        analysis: normalizeAnalysis(analysisMap.get(call.id)),
      };
    });

    if (filters.sentiment) {
      results = results.filter((c) => c.sentiment?.overallSentiment === filters.sentiment);
    }

    return results;
  }

  // --- Call share operations ---
  private mapCallShare(r: typeof tables.callShares.$inferSelect): CallShare {
    return {
      id: r.id,
      orgId: r.orgId,
      callId: r.callId,
      tokenHash: r.tokenHash,
      tokenPrefix: r.tokenPrefix,
      viewerLabel: r.viewerLabel ?? undefined,
      expiresAt: toISOString(r.expiresAt)!,
      createdBy: r.createdBy,
      createdAt: toISOString(r.createdAt),
    };
  }

  async createCallShare(orgId: string, share: InsertCallShare): Promise<CallShare> {
    const id = randomUUID();
    const row = await this.db
      .insert(tables.callShares)
      .values({
        id,
        orgId,
        callId: share.callId,
        tokenHash: share.tokenHash,
        tokenPrefix: share.tokenPrefix,
        viewerLabel: share.viewerLabel ?? null,
        expiresAt: new Date(share.expiresAt),
        createdBy: share.createdBy,
      })
      .returning();
    return this.mapCallShare(row[0]);
  }

  async getCallShareByToken(tokenHash: string): Promise<CallShare | undefined> {
    const rows = await this.db
      .select()
      .from(tables.callShares)
      .where(eq(tables.callShares.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ? this.mapCallShare(rows[0]) : undefined;
  }

  async listCallShares(orgId: string, callId: string): Promise<CallShare[]> {
    const rows = await this.db
      .select()
      .from(tables.callShares)
      .where(and(eq(tables.callShares.orgId, orgId), eq(tables.callShares.callId, callId)))
      .orderBy(desc(tables.callShares.createdAt));
    return rows.map((r) => this.mapCallShare(r));
  }

  async deleteCallShare(orgId: string, id: string): Promise<void> {
    await this.db
      .delete(tables.callShares)
      .where(and(eq(tables.callShares.id, id), eq(tables.callShares.orgId, orgId)));
  }

  async deleteExpiredCallShares(orgId: string): Promise<void> {
    await this.db
      .delete(tables.callShares)
      .where(and(eq(tables.callShares.orgId, orgId), lt(tables.callShares.expiresAt, new Date())));
  }

  // --- Transcript operations ---
  async getTranscript(orgId: string, callId: string): Promise<Transcript | undefined> {
    const rows = await this.db
      .select()
      .from(tables.transcripts)
      .where(and(eq(tables.transcripts.callId, callId), eq(tables.transcripts.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapTranscript(rows[0]) : undefined;
  }

  async createTranscript(orgId: string, transcript: InsertTranscript): Promise<Transcript> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.transcripts)
      .values({
        id,
        orgId,
        callId: transcript.callId,
        text: typeof transcript.text === "string" ? encryptField(transcript.text) : transcript.text,
        confidence: transcript.confidence,
        words: transcript.words || null,
        corrections: transcript.corrections || null,
        correctedText: transcript.correctedText || null,
      })
      .returning();
    return this.mapTranscript(row);
  }

  async updateTranscript(
    orgId: string,
    callId: string,
    updates: { text?: string; corrections?: TranscriptCorrection[]; correctedText?: string },
  ): Promise<Transcript | undefined> {
    const setClause: Partial<typeof tables.transcripts.$inferInsert> = {};
    if (updates.text !== undefined) setClause.text = encryptField(updates.text);
    if (updates.corrections !== undefined) setClause.corrections = updates.corrections;
    if (updates.correctedText !== undefined) setClause.correctedText = updates.correctedText;
    if (Object.keys(setClause).length === 0) return this.getTranscript(orgId, callId);
    const rows = await this.db
      .update(tables.transcripts)
      .set(setClause)
      .where(and(eq(tables.transcripts.callId, callId), eq(tables.transcripts.orgId, orgId)))
      .returning();
    return rows[0] ? this.mapTranscript(rows[0]) : undefined;
  }

  // --- Sentiment operations ---
  async getSentimentAnalysis(orgId: string, callId: string): Promise<SentimentAnalysis | undefined> {
    const rows = await this.db
      .select()
      .from(tables.sentimentAnalyses)
      .where(and(eq(tables.sentimentAnalyses.callId, callId), eq(tables.sentimentAnalyses.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapSentiment(rows[0]) : undefined;
  }

  async createSentimentAnalysis(orgId: string, sentiment: InsertSentimentAnalysis): Promise<SentimentAnalysis> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.sentimentAnalyses)
      .values({
        id,
        orgId,
        callId: sentiment.callId,
        overallSentiment: sentiment.overallSentiment,
        overallScore: sentiment.overallScore,
        segments: sentiment.segments || null,
      })
      .returning();
    return this.mapSentiment(row);
  }

  // --- Call analysis operations ---
  async getCallAnalysis(orgId: string, callId: string): Promise<CallAnalysis | undefined> {
    const rows = await this.db
      .select()
      .from(tables.callAnalyses)
      .where(and(eq(tables.callAnalyses.callId, callId), eq(tables.callAnalyses.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapAnalysis(rows[0]) : undefined;
  }

  async createCallAnalysis(orgId: string, analysis: InsertCallAnalysis): Promise<CallAnalysis> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.callAnalyses)
      .values({
        id,
        orgId,
        callId: analysis.callId,
        performanceScore: analysis.performanceScore,
        talkTimeRatio: analysis.talkTimeRatio,
        responseTime: analysis.responseTime,
        keywords: analysis.keywords || null,
        topics: analysis.topics || null,
        summary: typeof analysis.summary === "string" ? encryptField(analysis.summary) : analysis.summary,
        actionItems: analysis.actionItems || null,
        feedback: analysis.feedback || null,
        lemurResponse: analysis.lemurResponse || null,
        callPartyType: analysis.callPartyType,
        flags: analysis.flags || null,
        manualEdits: analysis.manualEdits || null,
        confidenceScore: analysis.confidenceScore,
        confidenceFactors: analysis.confidenceFactors || null,
        subScores: analysis.subScores || null,
        detectedAgentName: analysis.detectedAgentName,
        clinicalNote: analysis.clinicalNote || null,
        speechMetrics: analysis.speechMetrics || null,
        selfReview: analysis.selfReview || null,
        scoreDispute: analysis.scoreDispute || null,
        patientSummary: analysis.patientSummary || null,
        referralLetter: analysis.referralLetter || null,
        suggestedBillingCodes: analysis.suggestedBillingCodes || null,
        scoreRationale: analysis.scoreRationale || null,
        promptVersionId: analysis.promptVersionId || null,
        speakerRoleMap: analysis.speakerRoleMap || null,
        detectedLanguage: analysis.detectedLanguage || null,
        ehrPushStatus: analysis.ehrPushStatus || null,
      })
      .returning();
    return this.mapAnalysis(row);
  }

  async updateCallAnalysis(
    orgId: string,
    callId: string,
    updates: Partial<InsertCallAnalysis>,
  ): Promise<CallAnalysis | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.performanceScore !== undefined) setClause.performanceScore = updates.performanceScore;
    if (updates.summary !== undefined)
      setClause.summary = typeof updates.summary === "string" ? encryptField(updates.summary) : updates.summary;
    if (updates.topics !== undefined) setClause.topics = updates.topics;
    if (updates.actionItems !== undefined) setClause.actionItems = updates.actionItems;
    if (updates.feedback !== undefined) setClause.feedback = updates.feedback;
    if (updates.flags !== undefined) setClause.flags = updates.flags;
    if (updates.manualEdits !== undefined) setClause.manualEdits = updates.manualEdits;
    if (updates.subScores !== undefined) setClause.subScores = updates.subScores;
    if (updates.confidenceScore !== undefined) setClause.confidenceScore = updates.confidenceScore;
    if (updates.confidenceFactors !== undefined) setClause.confidenceFactors = updates.confidenceFactors;
    if (updates.clinicalNote !== undefined) setClause.clinicalNote = updates.clinicalNote;
    if (updates.detectedAgentName !== undefined) setClause.detectedAgentName = updates.detectedAgentName;
    if (updates.keywords !== undefined) setClause.keywords = updates.keywords;
    if (updates.talkTimeRatio !== undefined) setClause.talkTimeRatio = updates.talkTimeRatio;
    if (updates.responseTime !== undefined) setClause.responseTime = updates.responseTime;
    if (updates.lemurResponse !== undefined) setClause.lemurResponse = updates.lemurResponse;
    if (updates.callPartyType !== undefined) setClause.callPartyType = updates.callPartyType;
    if (updates.speechMetrics !== undefined) setClause.speechMetrics = updates.speechMetrics;
    if (updates.selfReview !== undefined) setClause.selfReview = updates.selfReview;
    if (updates.scoreDispute !== undefined) setClause.scoreDispute = updates.scoreDispute;
    if (updates.patientSummary !== undefined) setClause.patientSummary = updates.patientSummary;
    if (updates.referralLetter !== undefined) setClause.referralLetter = updates.referralLetter;
    if (updates.suggestedBillingCodes !== undefined) setClause.suggestedBillingCodes = updates.suggestedBillingCodes;
    if (updates.scoreRationale !== undefined) setClause.scoreRationale = updates.scoreRationale;
    if (updates.promptVersionId !== undefined) setClause.promptVersionId = updates.promptVersionId;
    if (updates.speakerRoleMap !== undefined) setClause.speakerRoleMap = updates.speakerRoleMap;
    if (updates.detectedLanguage !== undefined) setClause.detectedLanguage = updates.detectedLanguage;
    if (updates.ehrPushStatus !== undefined) setClause.ehrPushStatus = updates.ehrPushStatus;

    if (Object.keys(setClause).length === 0) return this.getCallAnalysis(orgId, callId);

    const [row] = await this.db
      .update(tables.callAnalyses)
      .set(setClause)
      .where(and(eq(tables.callAnalyses.callId, callId), eq(tables.callAnalyses.orgId, orgId)))
      .returning();
    return row ? this.mapAnalysis(row) : undefined;
  }

  // --- Dashboard metrics (single consolidated query) ---
  async getDashboardMetrics(orgId: string): Promise<DashboardMetrics> {
    // Single query using LEFT JOINs instead of 3 correlated subqueries.
    // Each subquery scanned its table independently; this touches calls once
    // and aggregates sentiment + analysis via the call_id foreign key.
    const [row] = (await this.db.execute(sql`
      SELECT
        count(c.id)::int AS call_count,
        coalesce(avg(cast(s.overall_score as float)) * 10, 0) AS avg_sentiment,
        coalesce(avg(cast(a.performance_score as float)), 0) AS avg_performance
      FROM calls c
      LEFT JOIN sentiment_analyses s ON s.call_id = c.id
      LEFT JOIN call_analyses a ON a.call_id = c.id
      WHERE c.org_id = ${orgId}
    `)) as unknown as { call_count: number; avg_sentiment: number; avg_performance: number }[];

    return {
      totalCalls: row?.call_count || 0,
      avgSentiment: Math.round((Number(row?.avg_sentiment) || 0) * 100) / 100,
      avgPerformanceScore: Math.round((Number(row?.avg_performance) || 0) * 100) / 100,
      avgTranscriptionTime: 2.3,
    };
  }

  async getSentimentDistribution(orgId: string): Promise<SentimentDistribution> {
    const rows = await this.db
      .select({
        sentiment: tables.sentimentAnalyses.overallSentiment,
        count: sql<number>`count(*)::int`,
      })
      .from(tables.sentimentAnalyses)
      .where(eq(tables.sentimentAnalyses.orgId, orgId))
      .groupBy(tables.sentimentAnalyses.overallSentiment);

    const dist: SentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
    for (const row of rows) {
      const key = row.sentiment as keyof SentimentDistribution;
      if (key in dist) dist[key] = row.count;
    }
    return dist;
  }

  async getTopPerformers(orgId: string, limit = 3): Promise<TopPerformer[]> {
    // Single query: JOIN calls → analyses → employees, aggregate in SQL
    // HAVING count(*) >= 5 prevents employees with 1-2 calls from dominating the leaderboard
    const MIN_CALLS_FOR_RANKING = 5;
    const rows = await this.db
      .select({
        employeeId: tables.calls.employeeId,
        employeeName: tables.employees.name,
        employeeRole: tables.employees.role,
        avgScore: sql<number>`avg(cast(${tables.callAnalyses.performanceScore} as float))`,
        totalCalls: sql<number>`count(*)::int`,
      })
      .from(tables.calls)
      .innerJoin(tables.callAnalyses, eq(tables.calls.id, tables.callAnalyses.callId))
      .innerJoin(tables.employees, eq(tables.calls.employeeId, tables.employees.id))
      .where(and(eq(tables.calls.orgId, orgId), sql`${tables.calls.employeeId} is not null`))
      .groupBy(tables.calls.employeeId, tables.employees.id, tables.employees.name, tables.employees.role)
      .having(sql`count(*) >= ${MIN_CALLS_FOR_RANKING}`)
      .orderBy(sql`avg(cast(${tables.callAnalyses.performanceScore} as float)) desc`)
      .limit(limit);

    return rows.map((r) => ({
      id: r.employeeId!,
      name: r.employeeName,
      role: r.employeeRole || undefined,
      avgPerformanceScore: r.avgScore ? Math.round(r.avgScore * 100) / 100 : null,
      totalCalls: r.totalCalls,
    }));
  }

  /**
   * Get clinical call metrics without loading all calls into memory.
   * Queries only calls matching clinical categories with their analysis JSONB data.
   */
  async getClinicalCallMetrics(
    orgId: string,
    clinicalCategories: string[],
  ): Promise<{
    totalEncounters: number;
    completed: number;
    notesWithData: Array<{
      clinicalNote: any;
      uploadedAt: string | null;
    }>;
  }> {
    // Count total encounters matching clinical categories
    const [totalRow] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(tables.calls)
      .where(and(eq(tables.calls.orgId, orgId), inArray(tables.calls.callCategory!, clinicalCategories)));

    // Count completed encounters
    const [completedRow] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(tables.calls)
      .where(
        and(
          eq(tables.calls.orgId, orgId),
          eq(tables.calls.status, "completed"),
          inArray(tables.calls.callCategory!, clinicalCategories),
        ),
      );

    // Fetch only completed clinical calls that have analyses with clinical notes
    // This is a JOIN on two tables, not loading ALL calls + ALL analyses
    const noteRows = await this.db
      .select({
        clinicalNote: tables.callAnalyses.clinicalNote,
        uploadedAt: tables.calls.uploadedAt,
      })
      .from(tables.calls)
      .innerJoin(tables.callAnalyses, eq(tables.calls.id, tables.callAnalyses.callId))
      .where(
        and(
          eq(tables.calls.orgId, orgId),
          eq(tables.calls.status, "completed"),
          inArray(tables.calls.callCategory!, clinicalCategories),
          sql`${tables.callAnalyses.clinicalNote} is not null`,
        ),
      );

    return {
      totalEncounters: totalRow?.count || 0,
      completed: completedRow?.count || 0,
      notesWithData: noteRows.map((r) => ({
        clinicalNote: r.clinicalNote as CallAnalysis["clinicalNote"],
        uploadedAt: r.uploadedAt?.toISOString() || null,
      })),
    };
  }

  /**
   * Get attested clinical notes without loading all calls.
   * Returns only analyses with providerAttested clinical notes for matching categories.
   */
  async getAttestedClinicalNotes(
    orgId: string,
    clinicalCategories: string[],
  ): Promise<
    Array<{
      clinicalNote: any;
      uploadedAt: string | null;
    }>
  > {
    const rows = await this.db
      .select({
        clinicalNote: tables.callAnalyses.clinicalNote,
        uploadedAt: tables.calls.uploadedAt,
      })
      .from(tables.calls)
      .innerJoin(tables.callAnalyses, eq(tables.calls.id, tables.callAnalyses.callId))
      .where(
        and(
          eq(tables.calls.orgId, orgId),
          eq(tables.calls.status, "completed"),
          inArray(tables.calls.callCategory!, clinicalCategories),
          sql`${tables.callAnalyses.clinicalNote} is not null`,
          sql`(${tables.callAnalyses.clinicalNote}->>'providerAttested')::boolean = true`,
        ),
      )
      .orderBy(desc(tables.calls.uploadedAt));

    return rows.map((r) => ({
      clinicalNote: r.clinicalNote,
      uploadedAt: r.uploadedAt?.toISOString() || null,
    }));
  }

  // --- Search (PostgreSQL text search across transcripts, analysis, and topics) ---
  async searchCalls(orgId: string, query: string): Promise<CallWithDetails[]> {
    // Use PostgreSQL full-text search (tsvector GIN indexes) for ranked results.
    // Falls back to ILIKE for single-character queries where tsvector doesn't work well.
    const useFullText = query.trim().length >= 2;
    const tsQuery = useFullText ? sql`plainto_tsquery('english', ${query})` : null;
    const pattern = `%${query}%`;

    // Search transcripts — uses transcripts_text_search_idx GIN index
    const matchingTranscripts = await this.db
      .select({ callId: tables.transcripts.callId })
      .from(tables.transcripts)
      .where(
        and(
          eq(tables.transcripts.orgId, orgId),
          useFullText
            ? sql`to_tsvector('english', coalesce(${tables.transcripts.text}, '')) @@ ${tsQuery}`
            : ilike(tables.transcripts.text, pattern),
        ),
      );

    // Search analysis summaries and topics — uses GIN tsvector indexes.
    // Topics search: use tsvector on topics::text (GIN-indexed) for queries >=2 chars,
    // ILIKE fallback only for single-char queries. The jsonb_path_ops GIN index
    // does NOT support ILIKE — casting to text bypassed it entirely.
    const matchingAnalyses = await this.db
      .select({ callId: tables.callAnalyses.callId })
      .from(tables.callAnalyses)
      .where(
        and(
          eq(tables.callAnalyses.orgId, orgId),
          or(
            useFullText
              ? sql`to_tsvector('english', coalesce(${tables.callAnalyses.summary}, '')) @@ ${tsQuery}`
              : ilike(tables.callAnalyses.summary, pattern),
            useFullText
              ? sql`to_tsvector('english', coalesce(${tables.callAnalyses.topics}::text, '')) @@ ${tsQuery}`
              : sql`${tables.callAnalyses.topics}::text ILIKE ${pattern}`,
          ),
        ),
      );

    const callIds = new Set([...matchingTranscripts.map((t) => t.callId), ...matchingAnalyses.map((a) => a.callId)]);

    if (callIds.size === 0) return [];

    // Fetch only the matching calls with their details (not all calls)
    const matchedCallIds = Array.from(callIds);
    const callRows = await this.db
      .select()
      .from(tables.calls)
      .where(and(eq(tables.calls.orgId, orgId), inArray(tables.calls.id, matchedCallIds)))
      .orderBy(desc(tables.calls.uploadedAt));

    if (callRows.length === 0) return [];

    const empIdsNeeded = Array.from(new Set(callRows.map((c) => c.employeeId).filter(Boolean))) as string[];

    const [empRows, txRows, sentRows, analysisRows] = await Promise.all([
      empIdsNeeded.length > 0
        ? this.db.select().from(tables.employees).where(inArray(tables.employees.id, empIdsNeeded))
        : Promise.resolve([]),
      this.db.select().from(tables.transcripts).where(inArray(tables.transcripts.callId, matchedCallIds)),
      this.db.select().from(tables.sentimentAnalyses).where(inArray(tables.sentimentAnalyses.callId, matchedCallIds)),
      this.db.select().from(tables.callAnalyses).where(inArray(tables.callAnalyses.callId, matchedCallIds)),
    ]);

    const empMap = new Map(empRows.map((e) => [e.id, this.mapEmployee(e)]));
    const txMap = new Map(txRows.map((t) => [t.callId, this.mapTranscript(t)]));
    const sentMap = new Map(sentRows.map((s) => [s.callId, this.mapSentiment(s)]));
    const analysisMap = new Map(analysisRows.map((a) => [a.callId, this.mapAnalysis(a)]));

    return callRows.map((row) => {
      const call = this.mapCall(row);
      return {
        ...call,
        employee: call.employeeId ? empMap.get(call.employeeId) : undefined,
        transcript: txMap.get(call.id),
        sentiment: sentMap.get(call.id),
        analysis: normalizeAnalysis(analysisMap.get(call.id)),
      };
    });
  }

  // --- Audio operations (delegates to blob storage) ---
  async uploadAudio(
    orgId: string,
    callId: string,
    fileName: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    if (!this.blobClient) throw new Error("No blob storage client configured for audio files");
    await this.blobClient.uploadFile(`orgs/${orgId}/audio/${callId}/${fileName}`, buffer, contentType);
  }

  async getAudioFiles(orgId: string, callId: string): Promise<string[]> {
    if (!this.blobClient) return [];
    return this.blobClient.listObjects(`orgs/${orgId}/audio/${callId}/`);
  }

  async downloadAudio(orgId: string, objectName: string): Promise<Buffer | undefined> {
    if (!this.blobClient) return undefined;
    // Always enforce the org prefix for tenant isolation
    const safePath = objectName.startsWith("orgs/") ? objectName : `orgs/${orgId}/${objectName}`;
    // Validate the path belongs to this org
    if (!safePath.startsWith(`orgs/${orgId}/`)) {
      logger.warn({ orgId, objectName }, "Cross-org audio access blocked");
      return undefined;
    }
    return this.blobClient.downloadFile(safePath);
  }

  // --- Access requests ---
  async createAccessRequest(orgId: string, request: InsertAccessRequest): Promise<AccessRequest> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.accessRequests)
      .values({
        id,
        orgId,
        name: request.name,
        email: request.email,
        reason: request.reason,
        requestedRole: request.requestedRole || "viewer",
      })
      .returning();
    return this.mapAccessRequest(row);
  }

  async getAllAccessRequests(orgId: string): Promise<AccessRequest[]> {
    const rows = await this.db
      .select()
      .from(tables.accessRequests)
      .where(eq(tables.accessRequests.orgId, orgId))
      .orderBy(desc(tables.accessRequests.createdAt));
    return rows.map((r) => this.mapAccessRequest(r));
  }

  async getAccessRequest(orgId: string, id: string): Promise<AccessRequest | undefined> {
    const rows = await this.db
      .select()
      .from(tables.accessRequests)
      .where(and(eq(tables.accessRequests.id, id), eq(tables.accessRequests.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapAccessRequest(rows[0]) : undefined;
  }

  async updateAccessRequest(
    orgId: string,
    id: string,
    updates: Partial<AccessRequest>,
  ): Promise<AccessRequest | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.status !== undefined) setClause.status = updates.status;
    if (updates.reviewedBy !== undefined) setClause.reviewedBy = updates.reviewedBy;
    if (updates.reviewedAt !== undefined) setClause.reviewedAt = new Date(updates.reviewedAt);

    const [row] = await this.db
      .update(tables.accessRequests)
      .set(setClause)
      .where(and(eq(tables.accessRequests.id, id), eq(tables.accessRequests.orgId, orgId)))
      .returning();
    return row ? this.mapAccessRequest(row) : undefined;
  }

  // --- Prompt templates ---
  async getPromptTemplate(orgId: string, id: string): Promise<PromptTemplate | undefined> {
    const rows = await this.db
      .select()
      .from(tables.promptTemplates)
      .where(and(eq(tables.promptTemplates.id, id), eq(tables.promptTemplates.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapPromptTemplate(rows[0]) : undefined;
  }

  async getPromptTemplateByCategory(orgId: string, callCategory: string): Promise<PromptTemplate | undefined> {
    const rows = await this.db
      .select()
      .from(tables.promptTemplates)
      .where(
        and(
          eq(tables.promptTemplates.orgId, orgId),
          eq(tables.promptTemplates.callCategory, callCategory),
          eq(tables.promptTemplates.isActive, true),
        ),
      )
      .limit(1);
    return rows[0] ? this.mapPromptTemplate(rows[0]) : undefined;
  }

  async getAllPromptTemplates(orgId: string): Promise<PromptTemplate[]> {
    const rows = await this.db.select().from(tables.promptTemplates).where(eq(tables.promptTemplates.orgId, orgId));
    return rows.map((r) => this.mapPromptTemplate(r));
  }

  async createPromptTemplate(orgId: string, template: InsertPromptTemplate): Promise<PromptTemplate> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.promptTemplates)
      .values({
        id,
        orgId,
        callCategory: template.callCategory,
        name: template.name,
        evaluationCriteria: template.evaluationCriteria,
        requiredPhrases: template.requiredPhrases || null,
        scoringWeights: template.scoringWeights || null,
        additionalInstructions: template.additionalInstructions,
        isActive: template.isActive ?? true,
        updatedBy: template.updatedBy,
      })
      .returning();
    return this.mapPromptTemplate(row);
  }

  async updatePromptTemplate(
    orgId: string,
    id: string,
    updates: Partial<PromptTemplate>,
  ): Promise<PromptTemplate | undefined> {
    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) setClause.name = updates.name;
    if (updates.callCategory !== undefined) setClause.callCategory = updates.callCategory;
    if (updates.evaluationCriteria !== undefined) setClause.evaluationCriteria = updates.evaluationCriteria;
    if (updates.requiredPhrases !== undefined) setClause.requiredPhrases = updates.requiredPhrases;
    if (updates.scoringWeights !== undefined) setClause.scoringWeights = updates.scoringWeights;
    if (updates.additionalInstructions !== undefined) setClause.additionalInstructions = updates.additionalInstructions;
    if (updates.isActive !== undefined) setClause.isActive = updates.isActive;
    if (updates.updatedBy !== undefined) setClause.updatedBy = updates.updatedBy;

    const [row] = await this.db
      .update(tables.promptTemplates)
      .set(setClause)
      .where(and(eq(tables.promptTemplates.id, id), eq(tables.promptTemplates.orgId, orgId)))
      .returning();
    return row ? this.mapPromptTemplate(row) : undefined;
  }

  async deletePromptTemplate(orgId: string, id: string): Promise<void> {
    await this.db
      .delete(tables.promptTemplates)
      .where(and(eq(tables.promptTemplates.id, id), eq(tables.promptTemplates.orgId, orgId)));
  }

  // --- Coaching sessions ---
  async createCoachingSession(orgId: string, session: InsertCoachingSession): Promise<CoachingSession> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.coachingSessions)
      .values({
        id,
        orgId,
        employeeId: session.employeeId,
        callId: session.callId,
        assignedBy: session.assignedBy,
        category: session.category || "general",
        title: session.title,
        notes: session.notes,
        actionPlan: session.actionPlan || null,
        status: session.status || "pending",
        dueDate: session.dueDate ? new Date(session.dueDate) : null,
      })
      .returning();
    return this.mapCoachingSession(row);
  }

  async getCoachingSession(orgId: string, id: string): Promise<CoachingSession | undefined> {
    const rows = await this.db
      .select()
      .from(tables.coachingSessions)
      .where(and(eq(tables.coachingSessions.id, id), eq(tables.coachingSessions.orgId, orgId)))
      .limit(1);
    return rows[0] ? this.mapCoachingSession(rows[0]) : undefined;
  }

  async getAllCoachingSessions(orgId: string): Promise<CoachingSession[]> {
    const rows = await this.db.select().from(tables.coachingSessions).where(eq(tables.coachingSessions.orgId, orgId));
    return rows.map((r) => this.mapCoachingSession(r));
  }

  async getCoachingSessionsByEmployee(orgId: string, employeeId: string): Promise<CoachingSession[]> {
    const rows = await this.db
      .select()
      .from(tables.coachingSessions)
      .where(and(eq(tables.coachingSessions.orgId, orgId), eq(tables.coachingSessions.employeeId, employeeId)));
    return rows.map((r) => this.mapCoachingSession(r));
  }

  async updateCoachingSession(
    orgId: string,
    id: string,
    updates: Partial<CoachingSession>,
  ): Promise<CoachingSession | undefined> {
    const setClause: Record<string, unknown> = {};
    if (updates.title !== undefined) setClause.title = updates.title;
    if (updates.notes !== undefined) setClause.notes = updates.notes;
    if (updates.category !== undefined) setClause.category = updates.category;
    if (updates.status !== undefined) setClause.status = updates.status;
    if (updates.actionPlan !== undefined) setClause.actionPlan = updates.actionPlan;
    if (updates.dueDate !== undefined) setClause.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
    if (updates.completedAt !== undefined)
      setClause.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
    if (updates.selfAssessmentScore !== undefined)
      setClause.selfAssessmentScore = updates.selfAssessmentScore;
    if (updates.selfAssessmentNotes !== undefined)
      setClause.selfAssessmentNotes = updates.selfAssessmentNotes;
    if (updates.selfAssessedAt !== undefined)
      setClause.selfAssessedAt = updates.selfAssessedAt ? new Date(updates.selfAssessedAt) : null;
    if (updates.effectivenessSnapshot !== undefined)
      setClause.effectivenessSnapshot = updates.effectivenessSnapshot;
    if (updates.effectivenessCalculatedAt !== undefined)
      setClause.effectivenessCalculatedAt = updates.effectivenessCalculatedAt
        ? new Date(updates.effectivenessCalculatedAt)
        : null;
    if (updates.templateId !== undefined) setClause.templateId = updates.templateId;

    const [row] = await this.db
      .update(tables.coachingSessions)
      .set(setClause)
      .where(and(eq(tables.coachingSessions.id, id), eq(tables.coachingSessions.orgId, orgId)))
      .returning();
    return row ? this.mapCoachingSession(row) : undefined;
  }

  async getCoachingAnalytics(
    orgId: string,
    from?: Date,
    to?: Date,
  ): Promise<import("@shared/schema").CoachingAnalytics> {
    const conditions: any[] = [eq(tables.coachingSessions.orgId, orgId)];
    if (from) conditions.push(gte(tables.coachingSessions.createdAt, from));
    if (to) conditions.push(lte(tables.coachingSessions.createdAt, to));

    const sessions = await this.db
      .select()
      .from(tables.coachingSessions)
      .where(and(...conditions));
    const mapped = sessions.map((r) => this.mapCoachingSession(r));

    const completed = mapped.filter((s) => s.status === "completed");
    const dismissed = mapped.filter((s) => s.status === "dismissed");
    const pending = mapped.filter((s) => s.status === "pending" || s.status === "in_progress");
    const now = Date.now();
    const overdue = mapped.filter(
      (s) => s.dueDate && new Date(s.dueDate).getTime() < now && s.status !== "completed" && s.status !== "dismissed",
    );
    const automated = mapped.filter((s) => s.automatedTrigger);

    const avgClose =
      completed.length > 0
        ? completed.reduce((sum, s) => {
            if (!s.completedAt || !s.createdAt) return sum;
            return sum + (new Date(s.completedAt).getTime() - new Date(s.createdAt).getTime()) / 3600000;
          }, 0) / completed.length
        : null;

    const byCategory: Record<string, number> = {};
    const byManager: Record<string, { total: number; completed: number; rate: number }> = {};
    for (const s of mapped) {
      byCategory[s.category] = (byCategory[s.category] || 0) + 1;
      if (s.assignedBy) {
        if (!byManager[s.assignedBy]) byManager[s.assignedBy] = { total: 0, completed: 0, rate: 0 };
        byManager[s.assignedBy].total++;
        if (s.status === "completed") byManager[s.assignedBy].completed++;
      }
    }
    for (const m of Object.values(byManager)) m.rate = m.total > 0 ? m.completed / m.total : 0;

    // Improvement by category: sessions with effectiveness snapshots
    const improvementByCategory: Record<string, { before: number; after: number; delta: number; count: number }> = {};
    for (const s of mapped) {
      const snap = s.effectivenessSnapshot as EffectivenessSnap | null;
      if (!snap?.preCoaching?.avgScore || !snap?.postCoaching?.avgScore) continue;
      const cat = s.category;
      if (!improvementByCategory[cat]) improvementByCategory[cat] = { before: 0, after: 0, delta: 0, count: 0 };
      improvementByCategory[cat].before += snap.preCoaching.avgScore;
      improvementByCategory[cat].after += snap.postCoaching.avgScore;
      improvementByCategory[cat].count++;
    }
    for (const cat of Object.values(improvementByCategory)) {
      if (cat.count > 0) {
        cat.before /= cat.count;
        cat.after /= cat.count;
        cat.delta = cat.after - cat.before;
      }
    }

    return {
      totalSessions: mapped.length,
      completedSessions: completed.length,
      dismissedSessions: dismissed.length,
      pendingSessions: pending.length,
      completionRate: mapped.length > 0 ? completed.length / mapped.length : 0,
      avgTimeToCloseHours: avgClose,
      sessionsByCategory: byCategory,
      sessionsByManager: byManager,
      improvementByCategory,
      topCoachingTopics: Object.entries(byCategory)
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      overdueCount: overdue.length,
      automatedCount: automated.length,
    };
  }

  // --- Coaching templates ---
  async createCoachingTemplate(
    orgId: string,
    template: import("@shared/schema").InsertCoachingTemplate,
  ): Promise<import("@shared/schema").CoachingTemplate> {
    const id = randomUUID();
    const result = await this.db.execute(sql`
      INSERT INTO coaching_templates (id, org_id, name, category, description, action_plan, tags, created_by, usage_count)
      VALUES (${id}, ${orgId}, ${template.name}, ${template.category || "general"}, ${template.description || null},
              ${JSON.stringify(template.actionPlan || [])}, ${JSON.stringify(template.tags || [])},
              ${template.createdBy}, 0)
      RETURNING *
    `);
    const rows = rawRows(result);
    return this.mapCoachingTemplate(rows[0]);
  }

  async getCoachingTemplate(orgId: string, id: string): Promise<import("@shared/schema").CoachingTemplate | undefined> {
    const result = await this.db.execute(
      sql`SELECT * FROM coaching_templates WHERE id = ${id} AND org_id = ${orgId} LIMIT 1`,
    );
    const rows = rawRows(result);
    return rows[0] ? this.mapCoachingTemplate(rows[0]) : undefined;
  }

  async listCoachingTemplates(orgId: string, category?: string): Promise<import("@shared/schema").CoachingTemplate[]> {
    const result = category
      ? await this.db.execute(
          sql`SELECT * FROM coaching_templates WHERE org_id = ${orgId} AND category = ${category} ORDER BY usage_count DESC, created_at DESC`,
        )
      : await this.db.execute(
          sql`SELECT * FROM coaching_templates WHERE org_id = ${orgId} ORDER BY usage_count DESC, created_at DESC`,
        );
    const rows = rawRows(result);
    return rows.map((r: Record<string, unknown>) => this.mapCoachingTemplate(r));
  }

  async updateCoachingTemplate(
    orgId: string,
    id: string,
    updates: Partial<import("@shared/schema").CoachingTemplate>,
  ): Promise<import("@shared/schema").CoachingTemplate | undefined> {
    const result = await this.db.execute(sql`
      UPDATE coaching_templates SET
        name = COALESCE(${updates.name ?? null}, name),
        category = COALESCE(${updates.category ?? null}, category),
        description = COALESCE(${updates.description ?? null}, description),
        action_plan = COALESCE(${updates.actionPlan != null ? JSON.stringify(updates.actionPlan) : null}::jsonb, action_plan),
        tags = COALESCE(${updates.tags != null ? JSON.stringify(updates.tags) : null}::jsonb, tags),
        updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
      RETURNING *
    `);
    const rows = rawRows(result);
    return rows[0] ? this.mapCoachingTemplate(rows[0]) : undefined;
  }

  async deleteCoachingTemplate(orgId: string, id: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM coaching_templates WHERE id = ${id} AND org_id = ${orgId}`);
  }

  async incrementTemplateUsage(orgId: string, id: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE coaching_templates SET usage_count = usage_count + 1 WHERE id = ${id} AND org_id = ${orgId}`,
    );
  }

  private mapCoachingTemplate(row: any): import("@shared/schema").CoachingTemplate {
    return {
      id: row.id,
      orgId: row.org_id || row.orgId,
      name: row.name,
      category: row.category || "general",
      description: row.description,
      actionPlan: row.action_plan || row.actionPlan || [],
      tags: row.tags || [],
      createdBy: row.created_by || row.createdBy,
      usageCount: row.usage_count ?? row.usageCount ?? 0,
      createdAt: toISOString(row.created_at || row.createdAt),
      updatedAt: toISOString(row.updated_at || row.updatedAt),
    };
  }

  // --- Automation rules ---
  async createAutomationRule(
    orgId: string,
    rule: import("@shared/schema").InsertAutomationRule,
  ): Promise<import("@shared/schema").AutomationRule> {
    const id = randomUUID();
    const result = await this.db.execute(sql`
      INSERT INTO automation_rules (id, org_id, name, is_enabled, trigger_type, conditions, actions, created_by, trigger_count)
      VALUES (${id}, ${orgId}, ${rule.name}, ${rule.isEnabled !== false}, ${rule.triggerType},
              ${JSON.stringify(rule.conditions)}, ${JSON.stringify(rule.actions)}, ${rule.createdBy}, 0)
      RETURNING *
    `);
    const rows = rawRows(result);
    return this.mapAutomationRule(rows[0]);
  }

  async getAutomationRule(orgId: string, id: string): Promise<import("@shared/schema").AutomationRule | undefined> {
    const result = await this.db.execute(
      sql`SELECT * FROM automation_rules WHERE id = ${id} AND org_id = ${orgId} LIMIT 1`,
    );
    const rows = rawRows(result);
    return rows[0] ? this.mapAutomationRule(rows[0]) : undefined;
  }

  async listAutomationRules(orgId: string): Promise<import("@shared/schema").AutomationRule[]> {
    const result = await this.db.execute(
      sql`SELECT * FROM automation_rules WHERE org_id = ${orgId} ORDER BY created_at DESC`,
    );
    const rows = rawRows(result);
    return rows.map((r: Record<string, unknown>) => this.mapAutomationRule(r));
  }

  async updateAutomationRule(
    orgId: string,
    id: string,
    updates: Partial<import("@shared/schema").AutomationRule>,
  ): Promise<import("@shared/schema").AutomationRule | undefined> {
    // Raw SQL handles JSONB properly via COALESCE (null = keep existing value)
    const result = await this.db.execute(sql`
      UPDATE automation_rules SET
        is_enabled = COALESCE(${updates.isEnabled ?? null}, is_enabled),
        name = COALESCE(${updates.name ?? null}, name),
        conditions = COALESCE(${updates.conditions ? JSON.stringify(updates.conditions) : null}::jsonb, conditions),
        actions = COALESCE(${updates.actions ? JSON.stringify(updates.actions) : null}::jsonb, actions),
        last_triggered_at = COALESCE(${updates.lastTriggeredAt ? new Date(updates.lastTriggeredAt) : null}, last_triggered_at),
        trigger_count = COALESCE(${updates.triggerCount ?? null}, trigger_count),
        updated_at = NOW()
      WHERE id = ${id} AND org_id = ${orgId}
      RETURNING *
    `);
    const rows = rawRows(result);
    return rows[0] ? this.mapAutomationRule(rows[0]) : undefined;
  }

  async deleteAutomationRule(orgId: string, id: string): Promise<void> {
    await this.db.execute(sql`DELETE FROM automation_rules WHERE id = ${id} AND org_id = ${orgId}`);
  }

  private mapAutomationRule(row: any): import("@shared/schema").AutomationRule {
    return {
      id: row.id,
      orgId: row.org_id || row.orgId,
      name: row.name,
      isEnabled: row.is_enabled ?? row.isEnabled ?? true,
      triggerType: row.trigger_type || row.triggerType,
      conditions: row.conditions || {},
      actions: row.actions || {},
      createdBy: row.created_by || row.createdBy,
      lastTriggeredAt: toISOString(row.last_triggered_at || row.lastTriggeredAt),
      triggerCount: row.trigger_count ?? row.triggerCount ?? 0,
      createdAt: toISOString(row.created_at || row.createdAt),
      updatedAt: toISOString(row.updated_at || row.updatedAt),
    };
  }

  // --- Data retention ---
  async purgeExpiredCalls(orgId: string, retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    // Get IDs of calls to purge (for audio cleanup)
    const expiredCalls = await this.db
      .select({ id: tables.calls.id })
      .from(tables.calls)
      .where(and(eq(tables.calls.orgId, orgId), lt(tables.calls.uploadedAt, cutoff)));

    if (expiredCalls.length === 0) return 0;

    // Delete from DB (cascading deletes handle related tables)
    await this.db.delete(tables.calls).where(and(eq(tables.calls.orgId, orgId), lt(tables.calls.uploadedAt, cutoff)));

    // Clean up audio blobs
    if (this.blobClient) {
      for (const call of expiredCalls) {
        try {
          await this.blobClient.deleteByPrefix(`orgs/${orgId}/audio/${call.id}/`);
        } catch (error) {
          logger.error({ err: error, callId: call.id }, "Failed to purge audio blobs");
        }
      }
    }

    return expiredCalls.length;
  }

  /**
   * HIPAA: Purge audit logs older than retentionDays.
   * Default retention is 7 years (2555 days) per HIPAA requirements.
   * Audit logs are NEVER deleted alongside PHI data.
   */
  async purgeExpiredAuditLogs(orgId: string, retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const result = await this.db
      .delete(tables.auditLogs)
      .where(and(eq(tables.auditLogs.orgId, orgId), lt(tables.auditLogs.createdAt, cutoff)))
      .returning({ id: tables.auditLogs.id });

    return result.length;
  }

  // --- Usage tracking ---
  async recordUsageEvent(event: {
    orgId: string;
    eventType: string;
    quantity: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const id = randomUUID();
    await this.db.insert(tables.usageEvents).values({
      id,
      orgId: event.orgId,
      eventType: event.eventType,
      quantity: event.quantity,
      metadata: event.metadata || null,
    });
  }

  async getUsageSummary(orgId: string, startDate?: Date, endDate?: Date): Promise<import("../storage").UsageSummary[]> {
    const conditions = [eq(tables.usageEvents.orgId, orgId)];
    if (startDate) {
      conditions.push(sql`${tables.usageEvents.createdAt} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${tables.usageEvents.createdAt} <= ${endDate}`);
    }

    const rows = await this.db
      .select({
        eventType: tables.usageEvents.eventType,
        totalQuantity: sql<number>`coalesce(sum(${tables.usageEvents.quantity}), 0)`,
        eventCount: sql<number>`count(*)::int`,
      })
      .from(tables.usageEvents)
      .where(and(...conditions))
      .groupBy(tables.usageEvents.eventType);

    return rows.map((r) => ({
      eventType: r.eventType,
      totalQuantity: Number(r.totalQuantity),
      eventCount: r.eventCount,
    }));
  }

  // --- API Key operations ---
  async createApiKey(orgId: string, apiKey: InsertApiKey): Promise<ApiKey> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.apiKeys)
      .values({
        id,
        orgId,
        name: apiKey.name,
        keyHash: apiKey.keyHash,
        keyPrefix: apiKey.keyPrefix,
        permissions: apiKey.permissions || ["read"],
        createdBy: apiKey.createdBy,
        status: "active",
        expiresAt: apiKey.expiresAt ? new Date(apiKey.expiresAt) : undefined,
      })
      .returning();
    return this.mapApiKey(row);
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
    const rows = await this.db
      .select()
      .from(tables.apiKeys)
      .where(and(eq(tables.apiKeys.keyHash, keyHash), eq(tables.apiKeys.status, "active")))
      .limit(1);
    return rows[0] ? this.mapApiKey(rows[0]) : undefined;
  }

  async listApiKeys(orgId: string): Promise<ApiKey[]> {
    const rows = await this.db
      .select()
      .from(tables.apiKeys)
      .where(eq(tables.apiKeys.orgId, orgId))
      .orderBy(desc(tables.apiKeys.createdAt));
    return rows.map((r) => this.mapApiKey(r));
  }

  async updateApiKey(orgId: string, id: string, updates: Partial<ApiKey>): Promise<ApiKey | undefined> {
    const setValues: Record<string, unknown> = {};
    if (updates.status) setValues.status = updates.status;
    if (updates.lastUsedAt) setValues.lastUsedAt = new Date(updates.lastUsedAt);
    if (updates.name) setValues.name = updates.name;

    const [row] = await this.db
      .update(tables.apiKeys)
      .set(setValues)
      .where(and(eq(tables.apiKeys.id, id), eq(tables.apiKeys.orgId, orgId)))
      .returning();
    return row ? this.mapApiKey(row) : undefined;
  }

  async deleteApiKey(orgId: string, id: string): Promise<void> {
    await this.db.delete(tables.apiKeys).where(and(eq(tables.apiKeys.id, id), eq(tables.apiKeys.orgId, orgId)));
  }

  // --- Invitation operations ---
  async createInvitation(orgId: string, invitation: InsertInvitation): Promise<Invitation> {
    const { randomBytes, createHash } = await import("crypto");
    const id = randomUUID();
    // Generate raw token — returned once (in the API response / email URL), never stored.
    const rawToken = invitation.token || randomBytes(32).toString("hex");
    // Store SHA-256 hash only — matches the pattern used for API keys and password reset tokens.
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const tokenPrefix = rawToken.slice(0, 8);
    const expiresAt = invitation.expiresAt
      ? new Date(invitation.expiresAt)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [row] = await this.db
      .insert(tables.invitations)
      .values({
        id,
        orgId,
        email: invitation.email,
        role: invitation.role || "viewer",
        token: tokenHash,
        tokenPrefix,
        invitedBy: invitation.invitedBy,
        status: "pending",
        expiresAt,
      })
      .returning();

    const result = this.mapInvitation(row);
    // Override token in the returned object with the raw token (one-time return).
    // Subsequent reads from DB will return the hash (which is not usable as a token).
    result.token = rawToken;
    return result;
  }

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    // Hash the submitted token before lookup — DB stores only hashes.
    // Also try plaintext match for backward compatibility with pre-hashing invitations.
    const { createHash } = await import("crypto");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const rows = await this.db
      .select()
      .from(tables.invitations)
      .where(sql`${tables.invitations.token} = ${tokenHash} OR ${tables.invitations.token} = ${token}`)
      .limit(1);
    return rows[0] ? this.mapInvitation(rows[0]) : undefined;
  }

  async listInvitations(orgId: string): Promise<Invitation[]> {
    const rows = await this.db
      .select()
      .from(tables.invitations)
      .where(eq(tables.invitations.orgId, orgId))
      .orderBy(desc(tables.invitations.createdAt));
    return rows.map((r) => this.mapInvitation(r));
  }

  async updateInvitation(orgId: string, id: string, updates: Partial<Invitation>): Promise<Invitation | undefined> {
    const setValues: Record<string, unknown> = {};
    if (updates.status) setValues.status = updates.status;
    if (updates.acceptedAt) setValues.acceptedAt = new Date(updates.acceptedAt);

    const [row] = await this.db
      .update(tables.invitations)
      .set(setValues)
      .where(and(eq(tables.invitations.id, id), eq(tables.invitations.orgId, orgId)))
      .returning();
    return row ? this.mapInvitation(row) : undefined;
  }

  async deleteInvitation(orgId: string, id: string): Promise<void> {
    await this.db
      .delete(tables.invitations)
      .where(and(eq(tables.invitations.id, id), eq(tables.invitations.orgId, orgId)));
  }

  // --- Row mappers (DB row → app type) ---

  private mapOrg(row: OrgRow): Organization {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status as Organization["status"],
      settings: row.settings as Organization["settings"],
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapUser(row: UserRow): User {
    return {
      id: row.id,
      orgId: row.orgId,
      username: row.username,
      passwordHash: row.passwordHash,
      name: row.name,
      role: row.role,
      mfaEnabled: row.mfaEnabled ?? false,
      mfaSecret: row.mfaSecret ?? undefined,
      mfaBackupCodes: row.mfaBackupCodes ?? undefined,
      subTeam: row.subTeam ?? undefined,
      webauthnCredentials: (row.webauthnCredentials ?? undefined) as User["webauthnCredentials"],
      mfaTrustedDevices: (row.mfaTrustedDevices ?? undefined) as User["mfaTrustedDevices"],
      mfaEnrollmentDeadline: row.mfaEnrollmentDeadline ?? undefined,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapEmployee(row: EmployeeRow): Employee {
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      email: row.email ?? undefined,
      role: row.role ?? undefined,
      initials: row.initials ?? undefined,
      status: (row.status ?? undefined) as Employee["status"],
      subTeam: row.subTeam ?? undefined,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapCall(row: CallRow): Call {
    return {
      id: row.id,
      orgId: row.orgId,
      employeeId: row.employeeId ?? undefined,
      fileName: row.fileName ?? undefined,
      filePath: row.filePath ?? undefined,
      status: row.status as Call["status"],
      duration: row.duration ?? undefined,
      assemblyAiId: row.assemblyAiId ?? undefined,
      callCategory: row.callCategory ?? undefined,
      tags: row.tags as string[],
      uploadedAt: toISOString(row.uploadedAt),
      channel: (row.channel || "voice") as Call["channel"],
      emailSubject: row.emailSubject ?? undefined,
      emailFrom: row.emailFrom ?? undefined,
      emailTo: row.emailTo ?? undefined,
      emailCc: row.emailCc ?? undefined,
      emailBody: row.emailBody ?? undefined,
      emailBodyHtml: row.emailBodyHtml ?? undefined,
      emailMessageId: row.emailMessageId ?? undefined,
      emailThreadId: row.emailThreadId ?? undefined,
      emailReceivedAt: toISOString(row.emailReceivedAt),
      chatPlatform: row.chatPlatform ?? undefined,
      messageCount: row.messageCount ?? undefined,
      fileHash: row.fileHash ?? undefined,
    };
  }

  private mapTranscript(row: TranscriptRow): Transcript {
    let text = row.text;
    if (typeof row.text === "string") {
      try {
        text = decryptField(row.text);
      } catch (err) {
        logger.error({ err, callId: row.callId }, "PHI decryption failed for transcript text");
        throw new Error(`PHI decryption failed for transcript ${row.callId}: ${(err as Error).message}`);
      }
    }
    return {
      id: row.id,
      orgId: row.orgId,
      callId: row.callId,
      text: text ?? undefined,
      confidence: row.confidence ?? undefined,
      words: row.words as TranscriptWord[] | undefined,
      corrections: row.corrections as TranscriptCorrection[] | undefined,
      correctedText: row.correctedText ?? undefined,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapSentiment(row: SentimentRow): SentimentAnalysis {
    return {
      id: row.id,
      orgId: row.orgId,
      callId: row.callId,
      overallSentiment: (row.overallSentiment ?? undefined) as SentimentAnalysis["overallSentiment"],
      overallScore: row.overallScore ?? undefined,
      segments: row.segments as SentimentSegment[] | undefined,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapAnalysis(row: AnalysisRow): CallAnalysis {
    return {
      id: row.id,
      orgId: row.orgId,
      callId: row.callId,
      performanceScore: row.performanceScore ?? undefined,
      talkTimeRatio: row.talkTimeRatio ?? undefined,
      responseTime: row.responseTime ?? undefined,
      keywords: row.keywords as string[],
      topics: row.topics as string[],
      summary: (() => {
        if (typeof row.summary !== "string") return row.summary ?? undefined;
        try {
          return decryptField(row.summary);
        } catch (err) {
          logger.error({ err, callId: row.callId }, "PHI decryption failed for analysis summary");
          throw new Error(`PHI decryption failed for analysis ${row.callId}: ${(err as Error).message}`);
        }
      })(),
      actionItems: row.actionItems as string[],
      feedback: row.feedback as AnalysisFeedback | undefined,
      lemurResponse: row.lemurResponse,
      callPartyType: row.callPartyType ?? undefined,
      flags: row.flags as string[],
      manualEdits: row.manualEdits as ManualEdit[] | undefined,
      confidenceScore: row.confidenceScore ?? undefined,
      confidenceFactors: row.confidenceFactors as ConfidenceFactors | undefined,
      subScores: row.subScores as SubScores | undefined,
      detectedAgentName: row.detectedAgentName ?? undefined,
      clinicalNote: row.clinicalNote as CallAnalysis["clinicalNote"],
      speechMetrics: row.speechMetrics as SpeechMetrics | undefined,
      selfReview: row.selfReview as SelfReview | undefined,
      scoreDispute: row.scoreDispute as ScoreDispute | undefined,
      patientSummary: row.patientSummary ?? undefined,
      referralLetter: row.referralLetter ?? undefined,
      suggestedBillingCodes: row.suggestedBillingCodes as SuggestedBillingCodes | undefined,
      scoreRationale: row.scoreRationale as Record<string, string[]> | undefined,
      promptVersionId: row.promptVersionId ?? undefined,
      speakerRoleMap: row.speakerRoleMap as Record<string, string> | undefined,
      detectedLanguage: row.detectedLanguage ?? undefined,
      ehrPushStatus: row.ehrPushStatus as EhrPushStatus | undefined,
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapAccessRequest(row: AccessRequestRow): AccessRequest {
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      email: row.email,
      reason: row.reason ?? undefined,
      requestedRole: row.requestedRole as AccessRequest["requestedRole"],
      status: row.status as AccessRequest["status"],
      reviewedBy: row.reviewedBy ?? undefined,
      reviewedAt: toISOString(row.reviewedAt),
      createdAt: toISOString(row.createdAt),
    };
  }

  private mapPromptTemplate(row: PromptTemplateRow): PromptTemplate {
    return {
      id: row.id,
      orgId: row.orgId,
      callCategory: row.callCategory,
      name: row.name ?? undefined,
      evaluationCriteria: row.evaluationCriteria,
      requiredPhrases: row.requiredPhrases as RequiredPhrase[] | undefined,
      scoringWeights: row.scoringWeights as ScoringWeights | undefined,
      additionalInstructions: row.additionalInstructions ?? undefined,
      isActive: row.isActive,
      isDefault: row.isDefault ?? false,
      updatedAt: toISOString(row.updatedAt),
      updatedBy: row.updatedBy ?? undefined,
    };
  }

  private mapCoachingSession(row: CoachingSessionRow): CoachingSession {
    return {
      id: row.id,
      orgId: row.orgId,
      employeeId: row.employeeId,
      callId: row.callId ?? undefined,
      assignedBy: row.assignedBy ?? undefined,
      category: row.category,
      title: row.title,
      notes: row.notes ?? undefined,
      actionPlan: row.actionPlan as CoachingActionItem[] | undefined,
      status: row.status as CoachingSession["status"],
      dueDate: toISOString(row.dueDate),
      createdAt: toISOString(row.createdAt),
      completedAt: toISOString(row.completedAt),
      automatedTrigger: row.automatedTrigger ?? null,
      automationRuleId: row.automationRuleId ?? null,
      selfAssessmentScore: row.selfAssessmentScore ?? null,
      selfAssessmentNotes: row.selfAssessmentNotes ?? null,
      selfAssessedAt: toISOString(row.selfAssessedAt),
      effectivenessSnapshot: row.effectivenessSnapshot ?? null,
      effectivenessCalculatedAt: toISOString(row.effectivenessCalculatedAt),
      templateId: row.templateId ?? null,
    };
  }

  private mapApiKey(row: ApiKeyRow): ApiKey {
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      keyHash: row.keyHash,
      keyPrefix: row.keyPrefix,
      permissions: row.permissions as string[],
      createdBy: row.createdBy ?? undefined,
      status: row.status as ApiKey["status"],
      expiresAt: toISOString(row.expiresAt),
      lastUsedAt: toISOString(row.lastUsedAt),
      createdAt: toISOString(row.createdAt),
    };
  }

  // --- Subscription operations ---
  async getSubscription(orgId: string): Promise<Subscription | undefined> {
    const rows = await this.db
      .select()
      .from(tables.subscriptions)
      .where(eq(tables.subscriptions.orgId, orgId))
      .limit(1);
    return rows[0] ? this.mapSubscription(rows[0]) : undefined;
  }

  async getSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<Subscription | undefined> {
    const rows = await this.db
      .select()
      .from(tables.subscriptions)
      .where(eq(tables.subscriptions.stripeCustomerId, stripeCustomerId))
      .limit(1);
    return rows[0] ? this.mapSubscription(rows[0]) : undefined;
  }

  async getSubscriptionByStripeSubId(stripeSubscriptionId: string): Promise<Subscription | undefined> {
    const rows = await this.db
      .select()
      .from(tables.subscriptions)
      .where(eq(tables.subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    return rows[0] ? this.mapSubscription(rows[0]) : undefined;
  }

  async upsertSubscription(orgId: string, sub: InsertSubscription): Promise<Subscription> {
    const existing = await this.getSubscription(orgId);
    const id = existing?.id || randomUUID();
    const now = new Date();

    if (existing) {
      const [row] = await this.db
        .update(tables.subscriptions)
        .set({
          planTier: sub.planTier,
          status: sub.status,
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          stripePriceId: sub.stripePriceId,
          stripeSeatsItemId: sub.stripeSeatsItemId,
          stripeOverageItemId: sub.stripeOverageItemId,
          billingInterval: sub.billingInterval,
          currentPeriodStart: sub.currentPeriodStart ? new Date(sub.currentPeriodStart) : undefined,
          currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : undefined,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          pastDueAt: sub.pastDueAt ? new Date(sub.pastDueAt) : undefined,
          updatedAt: now,
        })
        .where(eq(tables.subscriptions.orgId, orgId))
        .returning();
      return this.mapSubscription(row);
    }

    const [row] = await this.db
      .insert(tables.subscriptions)
      .values({
        id,
        orgId,
        planTier: sub.planTier,
        status: sub.status,
        stripeCustomerId: sub.stripeCustomerId || null,
        stripeSubscriptionId: sub.stripeSubscriptionId || null,
        stripePriceId: sub.stripePriceId || null,
        stripeSeatsItemId: sub.stripeSeatsItemId || null,
        stripeOverageItemId: sub.stripeOverageItemId || null,
        billingInterval: sub.billingInterval || "monthly",
        currentPeriodStart: sub.currentPeriodStart ? new Date(sub.currentPeriodStart) : null,
        currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
        pastDueAt: sub.pastDueAt ? new Date(sub.pastDueAt) : null,
      })
      .returning();
    return this.mapSubscription(row);
  }

  async updateSubscription(orgId: string, updates: Partial<Subscription>): Promise<Subscription | undefined> {
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.planTier) setValues.planTier = updates.planTier;
    if (updates.status) setValues.status = updates.status;
    if (updates.stripeCustomerId) setValues.stripeCustomerId = updates.stripeCustomerId;
    if (updates.stripeSubscriptionId) setValues.stripeSubscriptionId = updates.stripeSubscriptionId;
    if (updates.stripePriceId) setValues.stripePriceId = updates.stripePriceId;
    if (updates.stripeSeatsItemId !== undefined) setValues.stripeSeatsItemId = updates.stripeSeatsItemId || null;
    if (updates.stripeOverageItemId !== undefined) setValues.stripeOverageItemId = updates.stripeOverageItemId || null;
    if (updates.billingInterval) setValues.billingInterval = updates.billingInterval;
    if (updates.currentPeriodStart) setValues.currentPeriodStart = new Date(updates.currentPeriodStart);
    if (updates.currentPeriodEnd) setValues.currentPeriodEnd = new Date(updates.currentPeriodEnd);
    if (updates.cancelAtPeriodEnd !== undefined) setValues.cancelAtPeriodEnd = updates.cancelAtPeriodEnd;
    if (updates.pastDueAt !== undefined) setValues.pastDueAt = updates.pastDueAt ? new Date(updates.pastDueAt) : null;

    const [row] = await this.db
      .update(tables.subscriptions)
      .set(setValues)
      .where(eq(tables.subscriptions.orgId, orgId))
      .returning();
    return row ? this.mapSubscription(row) : undefined;
  }

  private mapSubscription(row: SubscriptionRow): Subscription {
    return {
      id: row.id,
      orgId: row.orgId,
      planTier: row.planTier as Subscription["planTier"],
      status: row.status as Subscription["status"],
      stripeCustomerId: row.stripeCustomerId || undefined,
      stripeSubscriptionId: row.stripeSubscriptionId || undefined,
      stripePriceId: row.stripePriceId || undefined,
      stripeSeatsItemId: row.stripeSeatsItemId || undefined,
      stripeOverageItemId: row.stripeOverageItemId || undefined,
      billingInterval: row.billingInterval as Subscription["billingInterval"],
      currentPeriodStart: toISOString(row.currentPeriodStart),
      currentPeriodEnd: toISOString(row.currentPeriodEnd),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd || false,
      pastDueAt: toISOString(row.pastDueAt),
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  // --- Reference document operations ---
  async createReferenceDocument(orgId: string, doc: InsertReferenceDocument): Promise<ReferenceDocument> {
    const id = randomUUID();
    const [row] = await this.db
      .insert(tables.referenceDocuments)
      .values({
        id,
        orgId,
        name: doc.name,
        category: doc.category,
        description: doc.description || null,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        storagePath: doc.storagePath,
        extractedText: doc.extractedText || null,
        appliesTo: doc.appliesTo || null,
        isActive: doc.isActive ?? true,
        uploadedBy: doc.uploadedBy || null,
        version: doc.version ?? 1,
        previousVersionId: doc.previousVersionId || null,
        indexingStatus: doc.indexingStatus || "pending",
        indexingError: null,
        sourceType: doc.sourceType || "upload",
        sourceUrl: doc.sourceUrl || null,
        retrievalCount: 0,
      })
      .returning();
    return this.mapReferenceDocument(row);
  }

  async getReferenceDocument(orgId: string, id: string): Promise<ReferenceDocument | undefined> {
    const rows = await this.db
      .select()
      .from(tables.referenceDocuments)
      .where(and(eq(tables.referenceDocuments.orgId, orgId), eq(tables.referenceDocuments.id, id)))
      .limit(1);
    return rows[0] ? this.mapReferenceDocument(rows[0]) : undefined;
  }

  async listReferenceDocuments(orgId: string): Promise<ReferenceDocument[]> {
    const rows = await this.db
      .select()
      .from(tables.referenceDocuments)
      .where(eq(tables.referenceDocuments.orgId, orgId))
      .orderBy(desc(tables.referenceDocuments.createdAt))
      .limit(QUERY_HARD_CAP);
    return rows.map((r) => this.mapReferenceDocument(r));
  }

  async getReferenceDocumentsForCategory(orgId: string, callCategory: string): Promise<ReferenceDocument[]> {
    // Use SQL-level JSONB filtering with GIN index instead of loading all docs into memory.
    // Matches documents where appliesTo is NULL, empty array, or contains the category.
    const rows = await this.db
      .select()
      .from(tables.referenceDocuments)
      .where(
        and(
          eq(tables.referenceDocuments.orgId, orgId),
          eq(tables.referenceDocuments.isActive, true),
          sql`(${tables.referenceDocuments.appliesTo} IS NULL
               OR jsonb_array_length(${tables.referenceDocuments.appliesTo}) = 0
               OR ${tables.referenceDocuments.appliesTo} @> ${JSON.stringify([callCategory])}::jsonb)`,
        ),
      )
      .limit(QUERY_HARD_CAP);
    return rows.map((r) => this.mapReferenceDocument(r));
  }

  async updateReferenceDocument(
    orgId: string,
    id: string,
    updates: Partial<ReferenceDocument>,
  ): Promise<ReferenceDocument | undefined> {
    const setValues: Record<string, unknown> = {};
    if (updates.name) setValues.name = updates.name;
    if (updates.category) setValues.category = updates.category;
    if (updates.description !== undefined) setValues.description = updates.description;
    if (updates.extractedText !== undefined) setValues.extractedText = updates.extractedText;
    if (updates.appliesTo !== undefined) setValues.appliesTo = updates.appliesTo;
    if (updates.isActive !== undefined) setValues.isActive = updates.isActive;
    if (updates.indexingStatus !== undefined) setValues.indexingStatus = updates.indexingStatus;
    if (updates.indexingError !== undefined) setValues.indexingError = updates.indexingError;
    if (updates.retrievalCount !== undefined) setValues.retrievalCount = updates.retrievalCount;

    const [row] = await this.db
      .update(tables.referenceDocuments)
      .set(setValues)
      .where(and(eq(tables.referenceDocuments.orgId, orgId), eq(tables.referenceDocuments.id, id)))
      .returning();
    return row ? this.mapReferenceDocument(row) : undefined;
  }

  async deleteReferenceDocument(orgId: string, id: string): Promise<void> {
    await this.db
      .delete(tables.referenceDocuments)
      .where(and(eq(tables.referenceDocuments.orgId, orgId), eq(tables.referenceDocuments.id, id)));
  }

  private mapReferenceDocument(row: ReferenceDocumentRow): ReferenceDocument {
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      category: row.category as ReferenceDocument["category"],
      description: row.description || undefined,
      fileName: row.fileName,
      fileSize: row.fileSize,
      mimeType: row.mimeType,
      storagePath: row.storagePath,
      extractedText: row.extractedText || undefined,
      appliesTo: (row.appliesTo as string[]) || undefined,
      isActive: row.isActive,
      uploadedBy: row.uploadedBy || undefined,
      createdAt: toISOString(row.createdAt),
      version: row.version ?? 1,
      previousVersionId: row.previousVersionId || undefined,
      indexingStatus: (row.indexingStatus || "pending") as ReferenceDocument["indexingStatus"],
      indexingError: row.indexingError || undefined,
      sourceType: (row.sourceType || "upload") as ReferenceDocument["sourceType"],
      sourceUrl: row.sourceUrl || undefined,
      retrievalCount: row.retrievalCount ?? 0,
    };
  }

  private mapInvitation(row: InvitationRow): Invitation {
    return {
      id: row.id,
      orgId: row.orgId,
      email: row.email,
      role: row.role as Invitation["role"],
      token: row.token,
      invitedBy: row.invitedBy,
      status: row.status as Invitation["status"],
      expiresAt: toISOString(row.expiresAt),
      acceptedAt: toISOString(row.acceptedAt),
      createdAt: toISOString(row.createdAt),
    };
  }


  // --- Feature methods (A/B tests, LMS, gamification, revenue, etc.) ---
  // Implementations are in pg-storage-features.ts and applied to the
  // prototype at import time. The IStorage interface ensures type safety.

  // ─── RLS helpers ──────────────────────────────────────────────────────────

  /**
   * Execute a function with RLS bypassed — for cross-org super-admin operations.
   */
  async withBypassRls<T>(fn: () => Promise<T>): Promise<T> {
    await this.db.execute(sql`SELECT set_config('app.bypass_rls', 'true', false)`);
    try {
      return await fn();
    } finally {
      await this.db.execute(sql`SELECT set_config('app.bypass_rls', 'false', false)`);
    }
  }

  /**
   * Execute a function with org context set — adds RLS enforcement layer.
   */
  async withOrgContext<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
    await this.db.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
    return fn();
  }
}

// Side-effect import: attaches feature methods to PostgresStorage.prototype
import "./pg-storage-features";
