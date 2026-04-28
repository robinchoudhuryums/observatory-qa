/**
 * Scheduled-report data-access module.
 *
 * Tier 0.3 of the CallAnalyzer adaptation plan. Backs the scheduled-reports
 * service with PostgreSQL persistence (replacing in-memory `reportStore: Map`).
 *
 * Same self-contained pattern as server/storage/snapshots.ts: idempotent DDL
 * via CREATE TABLE IF NOT EXISTS so the table exists even before
 * sync-schema.ts learns about the new shared/schema/scheduled-reports.ts
 * definition. Long-term cleanup: wire references into server/db/schema.ts.
 */
import { sql, eq, and, desc, asc } from "drizzle-orm";
import {
  scheduledReports,
  scheduledReportConfigs,
  type ScheduledReportRow,
  type InsertScheduledReport,
  type ScheduledReportConfigRow,
  type InsertScheduledReportConfig,
} from "@shared/schema";
import type { Database } from "../db/index";
import { logger } from "../services/logger";

// Re-export types from @shared/schema so consumers can import them from this
// module — keeps the public API self-contained.
export type { ScheduledReportRow, InsertScheduledReport, ScheduledReportConfigRow, InsertScheduledReportConfig };

let ddlEnsured = false;

export async function ensureScheduledReportTables(db: Database): Promise<void> {
  if (ddlEnsured) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scheduled_report_configs (
      id                text PRIMARY KEY,
      org_id            text NOT NULL,
      report_type       text NOT NULL,
      enabled           boolean NOT NULL DEFAULT true,
      recipient_emails  jsonb NOT NULL DEFAULT '[]'::jsonb,
      schedule          text NOT NULL,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sched_report_cfg_org_type
      ON scheduled_report_configs (org_id, report_type)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_sched_report_cfg_enabled
      ON scheduled_report_configs (enabled, report_type)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scheduled_reports (
      id                text PRIMARY KEY,
      org_id            text NOT NULL,
      report_type       text NOT NULL,
      period_start      timestamptz NOT NULL,
      period_end        timestamptz NOT NULL,
      status            text NOT NULL DEFAULT 'pending',
      recipient_emails  jsonb NOT NULL DEFAULT '[]'::jsonb,
      artifact_key      text,
      inline_csv        text,
      generated_at      timestamptz,
      sent_at           timestamptz,
      error_message     text,
      created_at        timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sched_report_org_type_period
      ON scheduled_reports (org_id, report_type, period_start)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_sched_report_status
      ON scheduled_reports (status, created_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_sched_report_org_type_end
      ON scheduled_reports (org_id, report_type, period_end)
  `);

  ddlEnsured = true;
  logger.info("scheduled_reports + scheduled_report_configs tables ensured");
}

// ---------------------------------------------------------------------------
// Report runs
// ---------------------------------------------------------------------------

/**
 * Idempotent insert: re-running for the same (orgId, reportType, periodStart)
 * is a no-op (returns existing row). The hourly scheduler tick relies on this
 * to safely catch up after restarts without producing duplicate reports.
 */
export async function upsertReport(db: Database, report: InsertScheduledReport): Promise<ScheduledReportRow> {
  await ensureScheduledReportTables(db);
  const result = await db
    .insert(scheduledReports)
    .values(report)
    .onConflictDoUpdate({
      target: [scheduledReports.orgId, scheduledReports.reportType, scheduledReports.periodStart],
      set: {
        status: report.status ?? "pending",
        recipientEmails: report.recipientEmails,
        artifactKey: report.artifactKey,
        inlineCsv: report.inlineCsv,
        generatedAt: report.generatedAt ?? new Date(),
        errorMessage: report.errorMessage,
      },
    })
    .returning();
  return result[0];
}

/**
 * Mark a report as sent (post-email-send). Captures sentAt timestamp.
 */
export async function markReportSent(db: Database, orgId: string, reportId: string): Promise<void> {
  await ensureScheduledReportTables(db);
  await db
    .update(scheduledReports)
    .set({ status: "sent", sentAt: new Date(), errorMessage: null })
    .where(and(eq(scheduledReports.orgId, orgId), eq(scheduledReports.id, reportId)));
}

/**
 * Mark a report as failed with an operator-readable error message.
 */
export async function markReportFailed(
  db: Database,
  orgId: string,
  reportId: string,
  errorMessage: string,
): Promise<void> {
  await ensureScheduledReportTables(db);
  await db
    .update(scheduledReports)
    .set({ status: "failed", errorMessage })
    .where(and(eq(scheduledReports.orgId, orgId), eq(scheduledReports.id, reportId)));
}

/**
 * Check if a report already exists for a given (orgId, reportType, periodStart).
 * Used by the catch-up logic to skip already-generated periods.
 */
export async function reportExists(
  db: Database,
  orgId: string,
  reportType: string,
  periodStart: Date,
): Promise<boolean> {
  await ensureScheduledReportTables(db);
  const rows = await db
    .select({ id: scheduledReports.id })
    .from(scheduledReports)
    .where(
      and(
        eq(scheduledReports.orgId, orgId),
        eq(scheduledReports.reportType, reportType),
        eq(scheduledReports.periodStart, periodStart),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * List recent reports for UI listing. Org-scoped.
 */
export async function listReports(
  db: Database,
  orgId: string,
  options: { reportType?: string; limit?: number } = {},
): Promise<ScheduledReportRow[]> {
  await ensureScheduledReportTables(db);
  const limit = options.limit ?? 20;
  const conditions = options.reportType
    ? and(eq(scheduledReports.orgId, orgId), eq(scheduledReports.reportType, options.reportType))
    : eq(scheduledReports.orgId, orgId);
  return db.select().from(scheduledReports).where(conditions).orderBy(desc(scheduledReports.periodEnd)).limit(limit);
}

/**
 * Find reports that need delivery (generated but not yet sent).
 * Used by the email-send tick.
 */
export async function listPendingDelivery(db: Database, limit = 50): Promise<ScheduledReportRow[]> {
  await ensureScheduledReportTables(db);
  return db
    .select()
    .from(scheduledReports)
    .where(eq(scheduledReports.status, "generated"))
    .orderBy(asc(scheduledReports.createdAt))
    .limit(limit);
}

/**
 * Delete all reports + configs for an org. Used by org deletion / GDPR purge.
 */
export async function deleteScheduledReportsByOrg(db: Database, orgId: string): Promise<void> {
  await ensureScheduledReportTables(db);
  await db.delete(scheduledReports).where(eq(scheduledReports.orgId, orgId));
  await db.delete(scheduledReportConfigs).where(eq(scheduledReportConfigs.orgId, orgId));
}

// ---------------------------------------------------------------------------
// Report configs
// ---------------------------------------------------------------------------

/**
 * Upsert a per-org subscription. Re-saving for same (orgId, reportType)
 * updates the recipient list / schedule / enabled flag.
 */
export async function upsertReportConfig(
  db: Database,
  config: InsertScheduledReportConfig,
): Promise<ScheduledReportConfigRow> {
  await ensureScheduledReportTables(db);
  const result = await db
    .insert(scheduledReportConfigs)
    .values(config)
    .onConflictDoUpdate({
      target: [scheduledReportConfigs.orgId, scheduledReportConfigs.reportType],
      set: {
        enabled: config.enabled ?? true,
        recipientEmails: config.recipientEmails,
        schedule: config.schedule,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result[0];
}

/**
 * List all enabled configs across all orgs — driven by the scheduler tick.
 */
export async function listEnabledConfigs(db: Database): Promise<ScheduledReportConfigRow[]> {
  await ensureScheduledReportTables(db);
  return db.select().from(scheduledReportConfigs).where(eq(scheduledReportConfigs.enabled, true));
}

/**
 * List configs for a specific org (admin UI).
 */
export async function listOrgConfigs(db: Database, orgId: string): Promise<ScheduledReportConfigRow[]> {
  await ensureScheduledReportTables(db);
  return db.select().from(scheduledReportConfigs).where(eq(scheduledReportConfigs.orgId, orgId));
}
