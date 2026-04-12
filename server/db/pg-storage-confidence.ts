/**
 * PostgresStorage confidence metrics mixin.
 *
 * Overrides getDashboardMetrics and getTopPerformers on PostgresStorage
 * to include confidence scoring (avgConfidence, dataQuality breakdown).
 *
 * This is a separate file because pg-storage.ts is too large (~90KB) to
 * push via the GitHub MCP API. The mixin is applied at import time.
 *
 * Phase 3: Confidence as first-class filter.
 */
import { sql, eq, and } from "drizzle-orm";
import * as tables from "./schema";
import type { DashboardMetrics, TopPerformer } from "@shared/schema";
import type { PostgresStorage } from "./pg-storage";

/** Shape returned by the confidence dashboard metrics raw SQL query. */
interface ConfidenceMetricsRow {
  call_count: number;
  avg_sentiment: string | number;
  avg_performance: string | number;
  avg_confidence: string | number | null;
  high_confidence: number;
  medium_confidence: number;
  low_confidence: number;
  no_confidence: number;
}

/** Shape returned by the top performers query with confidence. */
interface TopPerformerRow {
  employeeId: string | null;
  employeeName: string;
  employeeRole: string | null;
  avgScore: number | null;
  totalCalls: number;
  avgConfidence: number | null;
}

/**
 * Apply confidence metrics overrides to a PostgresStorage instance.
 * Call this after constructing the storage instance.
 */
export function applyConfidenceMetricsMixin(storage: PostgresStorage & { getDashboardMetrics: (orgId: string) => Promise<DashboardMetrics>; getTopPerformers: (orgId: string, limit?: number) => Promise<TopPerformer[]> }): void {
  const originalGetDashboardMetrics = storage.getDashboardMetrics.bind(storage);
  const originalGetTopPerformers = storage.getTopPerformers.bind(storage);

  storage.getDashboardMetrics = async function (orgId: string): Promise<DashboardMetrics> {
    const db = (this as unknown as PostgresStorage)["db"];
    const [row] = (await db.execute(sql`
      SELECT
        count(c.id)::int AS call_count,
        coalesce(avg(cast(s.overall_score as float)) * 10, 0) AS avg_sentiment,
        coalesce(avg(cast(a.performance_score as float)), 0) AS avg_performance,
        avg(NULLIF(cast(a.confidence_score as float), 0)) AS avg_confidence,
        count(CASE WHEN cast(a.confidence_score as float) >= 0.7 THEN 1 END)::int AS high_confidence,
        count(CASE WHEN cast(a.confidence_score as float) >= 0.4 AND cast(a.confidence_score as float) < 0.7 THEN 1 END)::int AS medium_confidence,
        count(CASE WHEN cast(a.confidence_score as float) > 0 AND cast(a.confidence_score as float) < 0.4 THEN 1 END)::int AS low_confidence,
        count(CASE WHEN a.confidence_score IS NULL OR a.confidence_score = '' THEN 1 END)::int AS no_confidence
      FROM calls c
      LEFT JOIN sentiment_analyses s ON s.call_id = c.id
      LEFT JOIN call_analyses a ON a.call_id = c.id
      WHERE c.org_id = ${orgId}
    `)) as unknown as ConfidenceMetricsRow[];

    const avgConf = parseFloat(String(row?.avg_confidence ?? ""));

    return {
      totalCalls: row?.call_count || 0,
      avgSentiment: Math.round((parseFloat(String(row?.avg_sentiment ?? 0)) || 0) * 100) / 100,
      avgPerformanceScore: Math.round((parseFloat(String(row?.avg_performance ?? 0)) || 0) * 100) / 100,
      avgConfidence: isNaN(avgConf) ? null : Math.round(avgConf * 100) / 100,
      dataQuality: {
        highConfidence: row?.high_confidence || 0,
        mediumConfidence: row?.medium_confidence || 0,
        lowConfidence: row?.low_confidence || 0,
        noConfidence: row?.no_confidence || 0,
      },
    };
  };

  storage.getTopPerformers = async function (orgId: string, limit = 3): Promise<TopPerformer[]> {
    const db = (this as unknown as PostgresStorage)["db"];
    const MIN_CALLS_FOR_RANKING = 5;
    const rows = await db
      .select({
        employeeId: tables.calls.employeeId,
        employeeName: tables.employees.name,
        employeeRole: tables.employees.role,
        avgScore: sql<number>`avg(cast(${tables.callAnalyses.performanceScore} as float))`,
        totalCalls: sql<number>`count(*)::int`,
        avgConfidence: sql<number>`avg(NULLIF(cast(${tables.callAnalyses.confidenceScore} as float), 0))`,
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
      avgConfidence: r.avgConfidence ? Math.round(r.avgConfidence * 100) / 100 : null,
    }));
  };
}
