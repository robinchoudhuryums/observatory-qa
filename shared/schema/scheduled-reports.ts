/**
 * Scheduled report persistence schema.
 *
 * Tier 0.3 of the CallAnalyzer adaptation plan. Replaces the in-memory
 * Map in server/services/scheduled-reports.ts with two PostgreSQL tables:
 *
 *   1. scheduled_report_configs — per-org configuration: which report types
 *      are enabled, who receives them, on what schedule.
 *   2. scheduled_reports — actual generated report runs: status (pending/
 *      generated/sent/failed), period, recipient list, artifact reference,
 *      timestamps. Unique index on (orgId, reportType, periodStart) makes
 *      the hourly scheduler tick idempotent — re-running for an already-
 *      generated period is a no-op.
 */
import { pgTable, text, jsonb, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Per-org subscription to a report type.
 *
 * Example rows:
 *   { orgId: "acme", reportType: "weekly_team", enabled: true,
 *     recipientEmails: ["managers@acme.com"], schedule: "weekly:monday" }
 *   { orgId: "acme", reportType: "monthly_executive", enabled: true,
 *     recipientEmails: ["ceo@acme.com"], schedule: "monthly:1" }
 */
export const scheduledReportConfigs = pgTable(
  "scheduled_report_configs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    reportType: text("report_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    recipientEmails: jsonb("recipient_emails")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Cron-like string interpreted by scheduler:
     *  - "weekly:monday" | "weekly:tuesday" | ...
     *  - "monthly:1" through "monthly:28"  (day-of-month)
     *  - "daily"
     */
    schedule: text("schedule").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One config row per (org, reportType) — the natural key. */
    uniqByType: uniqueIndex("uq_sched_report_cfg_org_type").on(t.orgId, t.reportType),
    /** Enabled-only scan for the scheduler tick. */
    enabledIdx: index("idx_sched_report_cfg_enabled").on(t.enabled, t.reportType),
  }),
);

/**
 * One row per generated report run.
 *
 * Status lifecycle: pending → generated → sent (or failed at any step).
 * Failed rows retain errorMessage for operator triage.
 */
export const scheduledReports = pgTable(
  "scheduled_reports",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    reportType: text("report_type").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** 'pending' | 'generated' | 'sent' | 'failed' */
    status: text("status").notNull().default("pending"),
    recipientEmails: jsonb("recipient_emails")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** S3 key (or other artifact reference) for the rendered CSV/PDF. */
    artifactKey: text("artifact_key"),
    /** Optional inline payload for tiny CSVs (sub-MB). Omit for larger
     *  artifacts which should live in S3 and be referenced via artifactKey. */
    inlineCsv: text("inline_csv"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** IDEMPOTENCY: re-running the scheduler for the same period is a no-op. */
    uniqByPeriod: uniqueIndex("uq_sched_report_org_type_period").on(t.orgId, t.reportType, t.periodStart),
    /** Scheduler tick scan: "what's pending or generated-but-not-sent?" */
    statusIdx: index("idx_sched_report_status").on(t.status, t.createdAt),
    /** "show me my recent reports" UI query. */
    byOrgPeriod: index("idx_sched_report_org_type_end").on(t.orgId, t.reportType, t.periodEnd),
  }),
);

export type ScheduledReportConfigRow = typeof scheduledReportConfigs.$inferSelect;
export type InsertScheduledReportConfig = typeof scheduledReportConfigs.$inferInsert;
export type ScheduledReportRow = typeof scheduledReports.$inferSelect;
export type InsertScheduledReport = typeof scheduledReports.$inferInsert;
