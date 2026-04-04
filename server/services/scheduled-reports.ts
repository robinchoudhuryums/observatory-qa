/**
 * Scheduled Report Generation Service.
 *
 * Adapted from the Call Analyzer. Generates periodic (weekly/monthly)
 * performance reports with aggregated metrics. Reports are stored in memory
 * and can be fetched via API for download or email delivery.
 *
 * Multi-tenant: all reports are scoped to orgId.
 */
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { logger } from "./logger";
import { aggregateMetrics, type PerformanceMetrics } from "./performance-snapshots";
import type { CallSummary } from "@shared/schema";

export interface ScheduledReport {
  id: string;
  orgId: string;
  type: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  metrics: PerformanceMetrics;
  topPerformers: Array<{ employeeId: string; name: string; avgScore: number; callCount: number }>;
  bottomPerformers: Array<{ employeeId: string; name: string; avgScore: number; callCount: number }>;
  generatedAt: string;
}

// In-memory store (keyed by orgId)
const reportStore = new Map<string, ScheduledReport[]>();

/**
 * Generate a weekly or monthly report for an org.
 */
export async function generateReport(
  orgId: string,
  type: "weekly" | "monthly",
): Promise<ScheduledReport> {
  const now = new Date();
  const periodDays = type === "weekly" ? 7 : 30;
  const periodStart = new Date(now.getTime() - periodDays * 86400000);

  const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
  const periodCalls = allCalls.filter((c) => c.uploadedAt && new Date(c.uploadedAt) >= periodStart);

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
      avgScore: stats.scores.length > 0
        ? Math.round((stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length) * 100) / 100
        : 0,
      callCount: stats.callCount,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  const report: ScheduledReport = {
    id: randomUUID(),
    orgId,
    type,
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    metrics,
    topPerformers: ranked.slice(0, 5),
    bottomPerformers: ranked.slice(-5).reverse(),
    generatedAt: now.toISOString(),
  };

  const existing = reportStore.get(orgId) || [];
  existing.push(report);
  // Keep last 20 reports per org
  if (existing.length > 20) existing.splice(0, existing.length - 20);
  reportStore.set(orgId, existing);

  logger.info({ orgId, reportId: report.id, type, calls: periodCalls.length }, "Generated scheduled report");
  return report;
}

/**
 * Get stored reports for an org.
 */
export function getReports(orgId: string, limit = 10): ScheduledReport[] {
  const reports = reportStore.get(orgId) || [];
  return reports
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    .slice(0, limit);
}
