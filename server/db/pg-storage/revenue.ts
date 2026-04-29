/**
 * PostgresStorage revenue domain: per-call revenue tracking + metrics.
 * Extracted from pg-storage-features.ts.
 */
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as tables from "../schema";
import { toISOString, QUERY_HARD_CAP } from "../pg-storage";
import { P, db } from "./_shared";
import type { CallRevenue, InsertCallRevenue } from "@shared/schema";

// ===================== CALL REVENUE =====================

P.createCallRevenue = async function (orgId: string, revenue: InsertCallRevenue): Promise<CallRevenue> {
  const id = randomUUID();
  const now = new Date();
  await db(this)
    .insert(tables.callRevenues)
    .values({
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
};

P.getCallRevenue = async function (orgId: string, callId: string): Promise<CallRevenue | undefined> {
  const rows = await db(this)
    .select()
    .from(tables.callRevenues)
    .where(and(eq(tables.callRevenues.orgId, orgId), eq(tables.callRevenues.callId, callId)));
  return rows[0] ? mapCallRevenueRow(rows[0]) : undefined;
};

P.listCallRevenues = async function (
  orgId: string,
  filters?: { conversionStatus?: string; startDate?: string; endDate?: string },
): Promise<CallRevenue[]> {
  const conditions = [eq(tables.callRevenues.orgId, orgId)];
  if (filters?.conversionStatus) conditions.push(eq(tables.callRevenues.conversionStatus, filters.conversionStatus));
  if (filters?.startDate) conditions.push(gte(tables.callRevenues.createdAt, new Date(filters.startDate)));
  if (filters?.endDate) conditions.push(lte(tables.callRevenues.createdAt, new Date(filters.endDate)));
  const rows = await db(this)
    .select()
    .from(tables.callRevenues)
    .where(and(...conditions))
    .orderBy(desc(tables.callRevenues.createdAt))
    .limit(QUERY_HARD_CAP);
  return rows.map((r) => mapCallRevenueRow(r));
};

P.updateCallRevenue = async function (
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
};

P.getRevenueMetrics = async function (orgId: string) {
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
};

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
