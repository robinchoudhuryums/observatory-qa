/**
 * Scheduled Report Generation Service.
 *
 * Tier 0.3 of the CallAnalyzer adaptation plan. Replaces the in-memory
 * `reportStore: Map` with PostgreSQL persistence via
 * server/storage/scheduled-reports.ts.
 *
 * What's now real:
 *   - generateReport(orgId, type) persists to DB (idempotent per period)
 *   - getReports(orgId) reads from DB
 *   - runScheduledReportsTick() — call hourly to generate due reports for
 *     all orgs with enabled configs
 *   - catchUpReports(orgId) — boot-time backfill of missed periods
 *
 * Still scaffold (follow-ups):
 *   - Email delivery — listPendingDelivery() returns "generated" rows; a
 *     separate function should iterate and call server/services/email.ts.
 *     Marked as TODO in deliverPendingReports() below.
 *   - Scheduler integration — runScheduledReportsTick() needs to be
 *     registered with the project's hourly scheduler (server/scheduled/).
 *   - PDF/CSV artifact format — for v1, the report content is JSON-
 *     stringified into the inlineCsv column. Tier 1.4 will swap this for
 *     real CSV/PDF artifacts in S3 referenced by artifactKey.
 *
 * Multi-tenant: all reports are scoped to orgId.
 */
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { logger } from "./logger";
import { aggregateMetrics, type PerformanceMetrics } from "./performance-snapshots";
import { getDatabase } from "../db/index";
import {
  upsertReport,
  reportExists,
  listReports,
  listPendingDelivery,
  listEnabledConfigs,
  markReportSent,
  markReportFailed,
  type ScheduledReportRow,
  type ScheduledReportConfigRow,
} from "../storage/scheduled-reports";

/**
 * Default report types shipped in v1. New types can be added by inserting
 * a row into scheduled_report_configs with a matching reportType — the
 * generator dispatches by string.
 */
export type ReportType = "weekly_team" | "monthly_executive" | string;

export interface ScheduledReport {
  id: string;
  orgId: string;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  metrics: PerformanceMetrics;
  topPerformers: Array<{ employeeId: string; name: string; avgScore: number; callCount: number }>;
  bottomPerformers: Array<{ employeeId: string; name: string; avgScore: number; callCount: number }>;
  generatedAt: string;
}

// Legacy in-memory fallback (dev mode, MemStorage tests, DB-error degradation)
const reportStore = new Map<string, ScheduledReport[]>();

/**
 * Compute the period covered by a report type as of the given timestamp.
 *
 * Periods are aligned so re-runs land on the same boundaries — the
 * UNIQUE(orgId, reportType, periodStart) index then makes regeneration
 * idempotent.
 */
export function computePeriodForType(
  reportType: ReportType,
  asOf: Date = new Date(),
): { periodStart: Date; periodEnd: Date } {
  const periodEnd = new Date(asOf);
  if (reportType.startsWith("weekly")) {
    // Last 7 days, snapped to UTC midnight
    const periodStart = new Date(periodEnd);
    periodStart.setUTCDate(periodStart.getUTCDate() - 7);
    periodStart.setUTCHours(0, 0, 0, 0);
    periodEnd.setUTCHours(0, 0, 0, 0);
    return { periodStart, periodEnd };
  }
  if (reportType.startsWith("monthly")) {
    // Last calendar month
    const periodStart = new Date(periodEnd);
    periodStart.setUTCMonth(periodStart.getUTCMonth() - 1);
    periodStart.setUTCHours(0, 0, 0, 0);
    periodEnd.setUTCHours(0, 0, 0, 0);
    return { periodStart, periodEnd };
  }
  // Default: last 24h
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - 1);
  return { periodStart, periodEnd };
}

/**
 * Generate a report for an org for a specific period. Persists to DB
 * (idempotent — same period for same org/type produces no duplicates).
 */
export async function generateReport(
  orgId: string,
  reportType: ReportType,
  opts: { period?: { periodStart: Date; periodEnd: Date }; recipientEmails?: string[] } = {},
): Promise<ScheduledReport> {
  const { periodStart, periodEnd } = opts.period ?? computePeriodForType(reportType);

  const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
  const periodCalls = allCalls.filter((c) => {
    const d = c.uploadedAt ? new Date(c.uploadedAt) : null;
    return d && d >= periodStart && d <= periodEnd;
  });

  const metrics = aggregateMetrics(periodCalls);

  // Per-employee aggregation for top/bottom performers
  const employeeStats = new Map<string, { name: string; scores: number[]; callCount: number }>();
  const employees = await storage.getAllEmployees(orgId);
  const empMap = new Map(employees.map((e) => [e.id, e]));

  for (const call of periodCalls) {
    if (!call.employeeId || !call.analysis?.performanceScore) continue;
    const stats = employeeStats.get(call.employeeId) || {
      name: empMap.get(call.employeeId)?.name || "Unknown",
      scores: [],
      callCount: 0,
    };
    stats.scores.push(parseFloat(String(call.analysis.performanceScore)) || 0);
    stats.callCount++;
    employeeStats.set(call.employeeId, stats);
  }

  const ranked = Array.from(employeeStats.entries())
    .map(([id, stats]) => ({
      employeeId: id,
      name: stats.name,
      avgScore:
        stats.scores.length > 0
          ? Math.round((stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length) * 100) / 100
          : 0,
      callCount: stats.callCount,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  const report: ScheduledReport = {
    id: randomUUID(),
    orgId,
    type: reportType,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    metrics,
    topPerformers: ranked.slice(0, 5),
    bottomPerformers: ranked.slice(-5).reverse(),
    generatedAt: new Date().toISOString(),
  };

  // Persist
  const db = getDatabase();
  if (db) {
    try {
      const persisted = await upsertReport(db, {
        id: report.id,
        orgId,
        reportType,
        periodStart,
        periodEnd,
        status: "generated",
        recipientEmails: opts.recipientEmails ?? [],
        // For v1, the report content rides in the inline_csv column as JSON.
        // Tier 1.4 will swap this for real CSV/PDF artifacts in S3.
        inlineCsv: JSON.stringify(report),
        generatedAt: new Date(report.generatedAt),
      });
      // The DB row's id wins for idempotent regeneration (existing row's id
      // is preserved on conflict).
      report.id = persisted.id;
    } catch (err) {
      logger.error(
        { err, orgId, reportType },
        "Scheduled report DB upsert failed — falling back to in-memory store",
      );
      saveReportInMemory(report);
    }
  } else {
    saveReportInMemory(report);
  }

  logger.info(
    { orgId, reportId: report.id, type: reportType, calls: periodCalls.length },
    "Generated scheduled report",
  );
  return report;
}

function saveReportInMemory(report: ScheduledReport): void {
  const existing = reportStore.get(report.orgId) || [];
  const filtered = existing.filter(
    (r) => !(r.type === report.type && r.periodStart === report.periodStart),
  );
  filtered.push(report);
  if (filtered.length > 20) filtered.splice(0, filtered.length - 20);
  reportStore.set(report.orgId, filtered);
}

/**
 * Convert a DB row back into the JSON-friendly ScheduledReport shape.
 */
function rowToReport(row: ScheduledReportRow): ScheduledReport {
  if (row.inlineCsv) {
    try {
      const parsed = JSON.parse(row.inlineCsv) as ScheduledReport;
      // Trust the row's id over the serialized one — they should match,
      // but the row is canonical.
      parsed.id = row.id;
      parsed.orgId = row.orgId;
      parsed.type = row.reportType;
      parsed.periodStart = row.periodStart instanceof Date ? row.periodStart.toISOString() : String(row.periodStart);
      parsed.periodEnd = row.periodEnd instanceof Date ? row.periodEnd.toISOString() : String(row.periodEnd);
      return parsed;
    } catch (err) {
      logger.warn({ err, reportId: row.id }, "Could not parse inline_csv — returning shell");
    }
  }
  // Shell: row exists but inline_csv is empty (e.g., status=pending placeholder)
  return {
    id: row.id,
    orgId: row.orgId,
    type: row.reportType,
    periodStart: row.periodStart instanceof Date ? row.periodStart.toISOString() : String(row.periodStart),
    periodEnd: row.periodEnd instanceof Date ? row.periodEnd.toISOString() : String(row.periodEnd),
    metrics: {
      totalCalls: 0,
      avgScore: null,
      highScore: null,
      lowScore: null,
      subScores: { compliance: null, customerExperience: null, communication: null, resolution: null },
      sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
      topStrengths: [],
      topSuggestions: [],
      flaggedCallCount: 0,
      exceptionalCallCount: 0,
    },
    topPerformers: [],
    bottomPerformers: [],
    generatedAt: row.generatedAt instanceof Date ? row.generatedAt.toISOString() : String(row.generatedAt ?? row.createdAt),
  };
}

/**
 * Get stored reports for an org. PostgreSQL when available, in-memory fallback.
 */
export async function getReports(orgId: string, limit = 10): Promise<ScheduledReport[]> {
  const db = getDatabase();
  if (db) {
    try {
      const rows = await listReports(db, orgId, { limit });
      return rows.map(rowToReport);
    } catch (err) {
      logger.error({ err, orgId }, "getReports DB read failed — falling back to in-memory");
    }
  }
  const reports = reportStore.get(orgId) || [];
  return reports
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Scheduler tick + catch-up
// ---------------------------------------------------------------------------

/**
 * Generate any due reports across all orgs with enabled configs. Designed
 * to be called hourly by the project's scheduler (server/scheduled/).
 *
 * Idempotent: relies on the UNIQUE(orgId, reportType, periodStart) index
 * to skip already-generated periods within the same period boundary.
 */
export async function runScheduledReportsTick(): Promise<{
  checked: number;
  generated: number;
  failed: number;
}> {
  const db = getDatabase();
  if (!db) {
    logger.info("runScheduledReportsTick skipped — no DB available");
    return { checked: 0, generated: 0, failed: 0 };
  }

  let checked = 0;
  let generated = 0;
  let failed = 0;

  const configs = await listEnabledConfigs(db);
  for (const cfg of configs) {
    checked++;
    try {
      const { periodStart, periodEnd } = computePeriodForType(cfg.reportType);
      // Skip if a report for this period already exists
      if (await reportExists(db, cfg.orgId, cfg.reportType, periodStart)) continue;

      await generateReport(cfg.orgId, cfg.reportType, {
        period: { periodStart, periodEnd },
        recipientEmails: (cfg.recipientEmails as string[]) || [],
      });
      generated++;
    } catch (err) {
      failed++;
      logger.error(
        { err, orgId: cfg.orgId, reportType: cfg.reportType },
        "Scheduled report generation failed",
      );
    }
  }

  logger.info({ checked, generated, failed }, "Scheduled reports tick complete");
  return { checked, generated, failed };
}

/**
 * Boot-time catch-up for an org. Generates any missed reports for the most
 * recent N periods of each enabled report type.
 *
 * Bounds: 12 weeks for weekly reports, 12 months for monthly reports.
 * Larger backfills are intentionally not supported — long-deactivated
 * orgs shouldn't generate quarters of historical reports on first boot.
 */
export async function catchUpReports(orgId: string): Promise<{ generated: number; skipped: number }> {
  const db = getDatabase();
  if (!db) return { generated: 0, skipped: 0 };

  const configs = (await listEnabledConfigs(db)).filter((c) => c.orgId === orgId);
  let generated = 0;
  let skipped = 0;

  for (const cfg of configs) {
    const periodCount = cfg.reportType.startsWith("monthly") ? 12 : 12; // 12 weeks or 12 months
    for (let i = 0; i < periodCount; i++) {
      const asOf = new Date();
      if (cfg.reportType.startsWith("monthly")) {
        asOf.setUTCMonth(asOf.getUTCMonth() - i);
      } else {
        asOf.setUTCDate(asOf.getUTCDate() - i * 7);
      }
      const { periodStart, periodEnd } = computePeriodForType(cfg.reportType, asOf);

      if (await reportExists(db, cfg.orgId, cfg.reportType, periodStart)) {
        skipped++;
        continue;
      }
      try {
        await generateReport(cfg.orgId, cfg.reportType, {
          period: { periodStart, periodEnd },
          recipientEmails: (cfg.recipientEmails as string[]) || [],
        });
        generated++;
      } catch (err) {
        logger.error(
          { err, orgId, reportType: cfg.reportType, periodStart },
          "Catch-up report generation failed",
        );
      }
    }
  }

  logger.info({ orgId, generated, skipped }, "catchUpReports complete");
  return { generated, skipped };
}

/**
 * Deliver pending reports via email.
 *
 * SCAFFOLD — the email integration itself isn't wired here yet. The
 * project's email service is at server/services/email.ts; the wire-up
 * looks like:
 *
 *   import { sendEmail } from "./email";
 *   for (const row of pending) {
 *     try {
 *       await sendEmail({ to: row.recipientEmails, subject: ..., ... });
 *       await markReportSent(db, row.orgId, row.id);
 *     } catch (err) {
 *       await markReportFailed(db, row.orgId, row.id, err.message);
 *     }
 *   }
 *
 * Returns the count of pending reports for now so the scheduler can log
 * the delivery backlog even before wire-up completes.
 */
export async function deliverPendingReports(): Promise<{ pending: number; sent: number; failed: number }> {
  const db = getDatabase();
  if (!db) return { pending: 0, sent: 0, failed: 0 };

  const pending = await listPendingDelivery(db);
  if (pending.length === 0) return { pending: 0, sent: 0, failed: 0 };

  logger.warn(
    { backlog: pending.length },
    "deliverPendingReports has reports ready to send but email integration is not yet wired — see TODO in scheduled-reports.ts",
  );

  // Wire-up follow-up: replace this no-op with a real email send loop.
  // Keeping these references here so the linter doesn't strip the unused
  // imports — they'll be live as soon as the email integration lands.
  void markReportSent;
  void markReportFailed;

  return { pending: pending.length, sent: 0, failed: 0 };
}

// Keep type re-exports for downstream consumers
export type { ScheduledReportConfigRow };
