/**
 * Performance snapshot persistence schema.
 *
 * Tier 0.2 of the CallAnalyzer adaptation plan. Replaces the in-memory
 * Map in server/services/performance-snapshots.ts so snapshots survive
 * restarts and feed longitudinal narrative continuity.
 *
 * One snapshot per (orgId, level, targetId, periodStart, periodEnd).
 * Repeated regeneration of the same period upserts via the unique index.
 */
import { pgTable, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const performanceSnapshots = pgTable(
  "performance_snapshots",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    /** 'employee' | 'team' | 'company' (extensible: 'department' is planned) */
    level: text("level").notNull(),
    /** employeeId / teamId / orgId (for company-level) */
    targetId: text("target_id").notNull(),
    targetName: text("target_name").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** PerformanceMetrics shape — see server/services/performance-snapshots.ts */
    metrics: jsonb("metrics").notNull(),
    /** AI-generated narrative summary; null until the post-generation Bedrock call lands */
    aiSummary: text("ai_summary"),
    /** IDs of the up-to-3 prior snapshots used as narrative context */
    priorSnapshotIds: jsonb("prior_snapshot_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Hot path: "fetch latest snapshots for this employee/team/company" */
    byTarget: index("idx_perf_snap_org_level_target_end").on(t.orgId, t.level, t.targetId, t.periodEnd),
    /** Cross-target scans for a given period (e.g., dashboard rollups) */
    byOrgPeriod: index("idx_perf_snap_org_period").on(t.orgId, t.periodEnd),
    /** Idempotent regeneration: re-running the snapshot job for the same period
     *  must update the existing row, not create a duplicate. */
    uniqByPeriod: uniqueIndex("uq_perf_snap_target_period").on(
      t.orgId,
      t.level,
      t.targetId,
      t.periodStart,
      t.periodEnd,
    ),
  }),
);

export type PerformanceSnapshotRow = typeof performanceSnapshots.$inferSelect;
export type InsertPerformanceSnapshot = typeof performanceSnapshots.$inferInsert;
