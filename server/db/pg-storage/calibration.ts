/**
 * PostgresStorage calibration domain: sessions and evaluations.
 * Extracted from pg-storage-features.ts.
 */
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as tables from "../schema";
import { toISOString } from "../pg-storage";
import { P, db } from "./_shared";
import type {
  CalibrationSession,
  InsertCalibrationSession,
  CalibrationEvaluation,
  InsertCalibrationEvaluation,
} from "@shared/schema";

// ===================== CALIBRATION SESSIONS =====================

P.createCalibrationSession = async function (
  orgId: string,
  session: InsertCalibrationSession,
): Promise<CalibrationSession> {
  const id = randomUUID();
  const now = new Date();
  await db(this)
    .insert(tables.calibrationSessions)
    .values({
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
};

P.getCalibrationSession = async function (orgId: string, id: string): Promise<CalibrationSession | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.calibrationSessions)
    .where(and(eq(tables.calibrationSessions.orgId, orgId), eq(tables.calibrationSessions.id, id)));
  return rows[0] ? mapCalibrationSessionRow(rows[0]) : undefined;
};

P.listCalibrationSessions = async function (
  orgId: string,
  filters?: { status?: string },
): Promise<CalibrationSession[]> {
  const conditions = [eq(tables.calibrationSessions.orgId, orgId)];
  if (filters?.status) conditions.push(eq(tables.calibrationSessions.status, filters.status));
  const rows = await db(this)
    .select()
    .from(tables.calibrationSessions)
    .where(and(...conditions))
    .orderBy(desc(tables.calibrationSessions.createdAt));
  return rows.map((r) => mapCalibrationSessionRow(r));
};

P.updateCalibrationSession = async function (
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
};

P.deleteCalibrationSession = async function (orgId: string, id: string): Promise<void> {
  // Both deletes run in a single transaction so evaluations are never
  // left orphaned if the session delete fails (or vice versa).
  await db(this).transaction(async (tx) => {
    await tx.delete(tables.calibrationEvaluations).where(eq(tables.calibrationEvaluations.sessionId, id));
    await tx
      .delete(tables.calibrationSessions)
      .where(and(eq(tables.calibrationSessions.orgId, orgId), eq(tables.calibrationSessions.id, id)));
  });
};

P.createCalibrationEvaluation = async function (
  orgId: string,
  evaluation: InsertCalibrationEvaluation,
): Promise<CalibrationEvaluation> {
  const id = randomUUID();
  await db(this)
    .insert(tables.calibrationEvaluations)
    .values({
      id,
      orgId,
      sessionId: evaluation.sessionId,
      evaluatorId: evaluation.evaluatorId,
      performanceScore: evaluation.performanceScore,
      subScores: evaluation.subScores || null,
      notes: evaluation.notes || null,
    });
  return { ...evaluation, id, orgId, createdAt: new Date().toISOString() };
};

P.getCalibrationEvaluations = async function (orgId: string, sessionId: string): Promise<CalibrationEvaluation[]> {
  const rows = await db(this)
    .select()
    .from(tables.calibrationEvaluations)
    .where(and(eq(tables.calibrationEvaluations.orgId, orgId), eq(tables.calibrationEvaluations.sessionId, sessionId)));
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
};

P.updateCalibrationEvaluation = async function (
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
};

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
