/**
 * Scoring corrections data-access module.
 *
 * Tier 2A of the CallAnalyzer adaptation plan. Multi-tenant Postgres-backed
 * store for manager edits to AI scores. Same self-contained pattern as
 * server/storage/snapshots.ts and server/storage/scheduled-reports.ts —
 * idempotent CREATE TABLE IF NOT EXISTS DDL on first use.
 *
 * All methods accept `db: Database` (the project's `NodePgDatabase<typeof schema>`
 * alias from server/db/index.ts) and `orgId` for tenancy isolation.
 */
import { sql, eq, and, desc, gte } from "drizzle-orm";
import {
  scoringCorrections,
  type ScoringCorrectionRow,
  type InsertScoringCorrection,
} from "@shared/schema";
import type { Database } from "../db/index";
import { logger } from "../services/logger";

// Re-export types from @shared/schema so consumers can import them from this
// module — keeps the public API self-contained.
export type { ScoringCorrectionRow, InsertScoringCorrection };

let ddlEnsured = false;

export async function ensureScoringCorrectionsTable(db: Database): Promise<void> {
  if (ddlEnsured) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scoring_corrections (
      id                   text PRIMARY KEY,
      org_id               text NOT NULL,
      call_id              text NOT NULL,
      call_category        text,
      corrected_by         text NOT NULL,
      corrected_by_name    text,
      corrected_at         timestamptz NOT NULL DEFAULT now(),
      reason               text NOT NULL,
      original_score       real NOT NULL,
      corrected_score      real NOT NULL,
      direction            text NOT NULL,
      sub_score_changes    jsonb,
      call_summary         text,
      topics               jsonb
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_scoring_corr_org_corrected_at
      ON scoring_corrections (org_id, corrected_at DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_scoring_corr_org_call
      ON scoring_corrections (org_id, call_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_scoring_corr_org_user_corrected_at
      ON scoring_corrections (org_id, corrected_by, corrected_at DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_scoring_corr_org_category_direction
      ON scoring_corrections (org_id, call_category, direction)
  `);

  ddlEnsured = true;
  logger.info("scoring_corrections table + indexes ensured");
}

/**
 * Insert a new scoring correction. Multiple corrections per (call, user) are
 * allowed — managers may edit a call's score multiple times as they review.
 */
export async function insertCorrection(
  db: Database,
  data: InsertScoringCorrection,
): Promise<ScoringCorrectionRow> {
  await ensureScoringCorrectionsTable(db);
  const result = await db.insert(scoringCorrections).values(data).returning();
  return result[0];
}

/**
 * List the N most recent corrections in an org, newest first.
 * Used by buildCorrectionContext (Tier 2B) to enrich Bedrock prompts.
 */
export async function listRecentByOrg(
  db: Database,
  orgId: string,
  limit = 50,
): Promise<ScoringCorrectionRow[]> {
  await ensureScoringCorrectionsTable(db);
  return db
    .select()
    .from(scoringCorrections)
    .where(eq(scoringCorrections.orgId, orgId))
    .orderBy(desc(scoringCorrections.correctedAt))
    .limit(limit);
}

/**
 * List the N most recent corrections in an org, optionally filtered by
 * call category. Used to enrich prompts with category-relevant feedback.
 */
export async function listRecentByCategory(
  db: Database,
  orgId: string,
  category: string | null,
  limit = 10,
): Promise<ScoringCorrectionRow[]> {
  await ensureScoringCorrectionsTable(db);
  const where = category
    ? and(eq(scoringCorrections.orgId, orgId), eq(scoringCorrections.callCategory, category))
    : eq(scoringCorrections.orgId, orgId);
  return db
    .select()
    .from(scoringCorrections)
    .where(where)
    .orderBy(desc(scoringCorrections.correctedAt))
    .limit(limit);
}

/**
 * List a specific user's recent corrections in an org.
 * Drives the "my corrections" dashboard widget (Tier 2E).
 */
export async function listRecentByUser(
  db: Database,
  orgId: string,
  userId: string,
  limit = 20,
): Promise<ScoringCorrectionRow[]> {
  await ensureScoringCorrectionsTable(db);
  return db
    .select()
    .from(scoringCorrections)
    .where(and(eq(scoringCorrections.orgId, orgId), eq(scoringCorrections.correctedBy, userId)))
    .orderBy(desc(scoringCorrections.correctedAt))
    .limit(limit);
}

/**
 * List corrections in an org since a given timestamp.
 * Used by checkScoringQuality (Tier 2C) and detectScoringRegression (Tier 2D).
 */
export async function listCorrectionsSince(
  db: Database,
  orgId: string,
  since: Date,
): Promise<ScoringCorrectionRow[]> {
  await ensureScoringCorrectionsTable(db);
  return db
    .select()
    .from(scoringCorrections)
    .where(and(eq(scoringCorrections.orgId, orgId), gte(scoringCorrections.correctedAt, since)))
    .orderBy(desc(scoringCorrections.correctedAt));
}

/**
 * List all corrections for a specific call in an org. Drives per-call
 * audit-trail UI ("show me every edit to this call's score").
 */
export async function listForCall(
  db: Database,
  orgId: string,
  callId: string,
): Promise<ScoringCorrectionRow[]> {
  await ensureScoringCorrectionsTable(db);
  return db
    .select()
    .from(scoringCorrections)
    .where(and(eq(scoringCorrections.orgId, orgId), eq(scoringCorrections.callId, callId)))
    .orderBy(desc(scoringCorrections.correctedAt));
}

/**
 * Bulk delete all corrections for an org (GDPR purge integration).
 */
export async function deleteCorrectionsByOrg(db: Database, orgId: string): Promise<number> {
  await ensureScoringCorrectionsTable(db);
  const result = await db
    .delete(scoringCorrections)
    .where(eq(scoringCorrections.orgId, orgId))
    .returning({ id: scoringCorrections.id });
  return result.length;
}

/**
 * Org-level correction count + direction breakdown. Used by admin
 * dashboard and quality-alerts evaluation.
 */
export async function getOrgCorrectionStats(
  db: Database,
  orgId: string,
  sinceDays?: number,
): Promise<{
  total: number;
  upgrades: number;
  downgrades: number;
  byCategory: Record<string, number>;
}> {
  await ensureScoringCorrectionsTable(db);
  const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000) : null;
  const where = since
    ? and(eq(scoringCorrections.orgId, orgId), gte(scoringCorrections.correctedAt, since))
    : eq(scoringCorrections.orgId, orgId);

  const rows = await db
    .select({
      direction: scoringCorrections.direction,
      callCategory: scoringCorrections.callCategory,
    })
    .from(scoringCorrections)
    .where(where);

  const byCategory: Record<string, number> = {};
  let upgrades = 0;
  let downgrades = 0;
  for (const r of rows) {
    if (r.direction === "upgraded") upgrades++;
    else if (r.direction === "downgraded") downgrades++;
    const cat = r.callCategory ?? "unknown";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  return { total: rows.length, upgrades, downgrades, byCategory };
}
