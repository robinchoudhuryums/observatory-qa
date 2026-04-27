/**
 * Performance snapshot data-access module.
 *
 * Tier 0.2 of the CallAnalyzer adaptation plan. Replaces the in-memory Map
 * in server/services/performance-snapshots.ts with a Postgres-backed store
 * keyed on (orgId, level, targetId, periodStart, periodEnd).
 *
 * Why a self-contained module instead of additions to the IStorage interface
 * and pg-storage.ts:
 *   - Snapshots are a discrete, bounded domain (5 CRUD methods, no joins
 *     beyond orgId scoping). Adding them to the 28KB IStorage interface and
 *     103KB pg-storage.ts is unnecessary surface bloat.
 *   - Keeping them isolated lets the snapshot lifecycle evolve independently
 *     (e.g., add narrative regeneration, snapshot pruning) without touching
 *     the core call/employee/team CRUD path.
 *
 * Idempotent DDL: ensureSnapshotTable() runs CREATE TABLE IF NOT EXISTS on
 * first use. This guarantees the table exists even if sync-schema.ts hasn't
 * picked up the new shared/schema/snapshots.ts definition yet (sync-schema
 * scans server/db/schema.ts; the canonical fix is to wire the table
 * reference there as a follow-up commit).
 */
import { sql, eq, and, desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { performanceSnapshots, type PerformanceSnapshotRow, type InsertPerformanceSnapshot } from "@shared/schema";
import { logger } from "../services/logger";

let ddlEnsured = false;

/**
 * Idempotently create the performance_snapshots table + indexes.
 * Safe to call repeatedly; only does real work on the first invocation
 * after process start.
 */
export async function ensureSnapshotTable(db: NodePgDatabase): Promise<void> {
  if (ddlEnsured) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS performance_snapshots (
      id              text PRIMARY KEY,
      org_id          text NOT NULL,
      level           text NOT NULL,
      target_id       text NOT NULL,
      target_name     text NOT NULL,
      period_start    timestamptz NOT NULL,
      period_end      timestamptz NOT NULL,
      metrics         jsonb NOT NULL,
      ai_summary      text,
      prior_snapshot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      generated_at    timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_perf_snap_org_level_target_end
      ON performance_snapshots (org_id, level, target_id, period_end DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_perf_snap_org_period
      ON performance_snapshots (org_id, period_end)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_perf_snap_target_period
      ON performance_snapshots (org_id, level, target_id, period_start, period_end)
  `);

  ddlEnsured = true;
  logger.info("performance_snapshots table + indexes ensured");
}

/**
 * Upsert a snapshot. Re-running snapshot generation for the same period
 * for the same target replaces the existing row (idempotent regeneration
 * via the unique index uq_perf_snap_target_period).
 */
export async function upsertSnapshot(
  db: NodePgDatabase,
  snapshot: InsertPerformanceSnapshot,
): Promise<PerformanceSnapshotRow> {
  await ensureSnapshotTable(db);
  const result = await db
    .insert(performanceSnapshots)
    .values(snapshot)
    .onConflictDoUpdate({
      target: [
        performanceSnapshots.orgId,
        performanceSnapshots.level,
        performanceSnapshots.targetId,
        performanceSnapshots.periodStart,
        performanceSnapshots.periodEnd,
      ],
      set: {
        metrics: snapshot.metrics,
        aiSummary: snapshot.aiSummary,
        priorSnapshotIds: snapshot.priorSnapshotIds,
        targetName: snapshot.targetName,
        generatedAt: snapshot.generatedAt ?? new Date(),
      },
    })
    .returning();
  return result[0];
}

/**
 * Fetch the most recent N snapshots for a (level, targetId), ordered by
 * periodEnd DESC. Used as narrative continuity context when generating the
 * next snapshot.
 */
export async function listRecentSnapshots(
  db: NodePgDatabase,
  orgId: string,
  level: string,
  targetId: string,
  limit = 10,
): Promise<PerformanceSnapshotRow[]> {
  await ensureSnapshotTable(db);
  return db
    .select()
    .from(performanceSnapshots)
    .where(
      and(
        eq(performanceSnapshots.orgId, orgId),
        eq(performanceSnapshots.level, level),
        eq(performanceSnapshots.targetId, targetId),
      ),
    )
    .orderBy(desc(performanceSnapshots.periodEnd))
    .limit(limit);
}

/**
 * Fetch a single snapshot by id, scoped to org for tenancy isolation.
 */
export async function getSnapshotById(
  db: NodePgDatabase,
  orgId: string,
  id: string,
): Promise<PerformanceSnapshotRow | null> {
  await ensureSnapshotTable(db);
  const rows = await db
    .select()
    .from(performanceSnapshots)
    .where(and(eq(performanceSnapshots.orgId, orgId), eq(performanceSnapshots.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Delete all snapshots for an org. Used by org deletion / GDPR purge.
 */
export async function deleteSnapshotsByOrg(db: NodePgDatabase, orgId: string): Promise<number> {
  await ensureSnapshotTable(db);
  const result = await db
    .delete(performanceSnapshots)
    .where(eq(performanceSnapshots.orgId, orgId))
    .returning({ id: performanceSnapshots.id });
  return result.length;
}

/**
 * Reset narrative context for a target — deletes all snapshots for the
 * target so the next generation starts fresh with no priorSnapshotIds.
 * Admin operation; should be audit-logged by the caller.
 */
export async function resetSnapshotContext(
  db: NodePgDatabase,
  orgId: string,
  level: string,
  targetId: string,
): Promise<number> {
  await ensureSnapshotTable(db);
  const result = await db
    .delete(performanceSnapshots)
    .where(
      and(
        eq(performanceSnapshots.orgId, orgId),
        eq(performanceSnapshots.level, level),
        eq(performanceSnapshots.targetId, targetId),
      ),
    )
    .returning({ id: performanceSnapshots.id });
  return result.length;
}
