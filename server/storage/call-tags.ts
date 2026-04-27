/**
 * Call tags + annotations data-access module.
 *
 * Tier 1A of the CallAnalyzer adaptation plan. Self-contained CRUD module
 * matching the pattern of server/storage/snapshots.ts and
 * server/storage/scheduled-reports.ts:
 *
 *   - Idempotent CREATE TABLE IF NOT EXISTS via ensureCallTagsTables() on
 *     first call (workaround until tables are wired into server/db/schema.ts
 *     for canonical sync-schema discovery — see TIER_0_5_PENDING.md item C).
 *   - All methods take orgId for multi-tenant isolation.
 *   - Author-or-manager delete enforcement is in the route layer (this module
 *     only enforces orgId scoping at the data layer).
 */
import { sql, eq, and, asc, desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  callTags,
  annotations,
  type CallTag,
  type InsertCallTag,
  type Annotation,
  type InsertAnnotation,
} from "@shared/schema";
import { logger } from "../services/logger";

let ddlEnsured = false;

export async function ensureCallTagsTables(db: NodePgDatabase): Promise<void> {
  if (ddlEnsured) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS call_tags (
      id          text PRIMARY KEY,
      org_id      text NOT NULL,
      call_id     text NOT NULL,
      tag         text NOT NULL,
      created_by  text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_call_tags_org_call_tag
      ON call_tags (org_id, call_id, tag)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_call_tags_org_tag ON call_tags (org_id, tag)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_call_tags_call ON call_tags (call_id)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS annotations (
      id            text PRIMARY KEY,
      org_id        text NOT NULL,
      call_id       text NOT NULL,
      timestamp_ms  integer NOT NULL,
      text          text NOT NULL,
      author        text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_annotations_call_ts
      ON annotations (call_id, timestamp_ms)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_annotations_org ON annotations (org_id)
  `);

  ddlEnsured = true;
  logger.info("call_tags + annotations tables ensured");
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * List all tags for a specific call. Org-scoped.
 */
export async function listTagsForCall(
  db: NodePgDatabase,
  orgId: string,
  callId: string,
): Promise<CallTag[]> {
  await ensureCallTagsTables(db);
  return db
    .select()
    .from(callTags)
    .where(and(eq(callTags.orgId, orgId), eq(callTags.callId, callId)))
    .orderBy(asc(callTags.createdAt));
}

/**
 * Add a tag to a call. Returns null if the tag already exists for this
 * (orgId, callId, tag) combination — the caller can return 409 to the user.
 */
export async function addTag(
  db: NodePgDatabase,
  data: InsertCallTag,
): Promise<CallTag | null> {
  await ensureCallTagsTables(db);
  const result = await db
    .insert(callTags)
    .values(data)
    .onConflictDoNothing({
      target: [callTags.orgId, callTags.callId, callTags.tag],
    })
    .returning();
  return result[0] ?? null;
}

/**
 * Look up a single tag by id, scoped to org.
 */
export async function getTagById(
  db: NodePgDatabase,
  orgId: string,
  tagId: string,
): Promise<CallTag | null> {
  await ensureCallTagsTables(db);
  const rows = await db
    .select()
    .from(callTags)
    .where(and(eq(callTags.orgId, orgId), eq(callTags.id, tagId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Delete a tag by id, scoped to org. Author-or-manager check happens in the
 * route layer before this is called.
 */
export async function deleteTag(
  db: NodePgDatabase,
  orgId: string,
  tagId: string,
): Promise<void> {
  await ensureCallTagsTables(db);
  await db
    .delete(callTags)
    .where(and(eq(callTags.orgId, orgId), eq(callTags.id, tagId)));
}

/**
 * Top tags across all calls in an org, ordered by count descending.
 * Drives autocomplete and the "browse by tag" UI.
 */
export async function listTopTags(
  db: NodePgDatabase,
  orgId: string,
  limit = 100,
): Promise<Array<{ tag: string; count: number }>> {
  await ensureCallTagsTables(db);
  const result = await db.execute(sql`
    SELECT tag, COUNT(*)::int AS count
    FROM call_tags
    WHERE org_id = ${orgId}
    GROUP BY tag
    ORDER BY count DESC
    LIMIT ${limit}
  `);
  return (result.rows as Array<{ tag: string; count: number }>).map((r) => ({
    tag: r.tag,
    count: Number(r.count),
  }));
}

/**
 * Find call IDs tagged with a specific tag in an org. Scoped to a single
 * tag value (already normalized lowercase by the caller).
 *
 * Returns just the IDs — the caller layers in additional access control
 * (viewer team scoping, etc.) and looks up call details.
 */
export async function listCallIdsByTag(
  db: NodePgDatabase,
  orgId: string,
  tag: string,
  limit = 100,
): Promise<string[]> {
  await ensureCallTagsTables(db);
  const rows = await db
    .select({ callId: callTags.callId })
    .from(callTags)
    .where(and(eq(callTags.orgId, orgId), eq(callTags.tag, tag)))
    .orderBy(desc(callTags.createdAt))
    .limit(limit);
  return rows.map((r) => r.callId);
}

/**
 * Bulk delete all tags for an org (GDPR purge integration).
 */
export async function deleteTagsByOrg(db: NodePgDatabase, orgId: string): Promise<number> {
  await ensureCallTagsTables(db);
  const result = await db
    .delete(callTags)
    .where(eq(callTags.orgId, orgId))
    .returning({ id: callTags.id });
  return result.length;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/**
 * List all annotations for a call, ordered along the timeline.
 */
export async function listAnnotationsForCall(
  db: NodePgDatabase,
  orgId: string,
  callId: string,
): Promise<Annotation[]> {
  await ensureCallTagsTables(db);
  return db
    .select()
    .from(annotations)
    .where(and(eq(annotations.orgId, orgId), eq(annotations.callId, callId)))
    .orderBy(asc(annotations.timestampMs));
}

/**
 * Add an annotation. Validation (text length, timestampMs ≥0) is enforced
 * at the route layer.
 */
export async function addAnnotation(
  db: NodePgDatabase,
  data: InsertAnnotation,
): Promise<Annotation> {
  await ensureCallTagsTables(db);
  const result = await db.insert(annotations).values(data).returning();
  return result[0];
}

/**
 * Look up a single annotation by id, scoped to org. Used for the
 * author-or-manager delete check before invoking deleteAnnotation.
 */
export async function getAnnotationById(
  db: NodePgDatabase,
  orgId: string,
  annotationId: string,
): Promise<Annotation | null> {
  await ensureCallTagsTables(db);
  const rows = await db
    .select()
    .from(annotations)
    .where(and(eq(annotations.orgId, orgId), eq(annotations.id, annotationId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Delete an annotation by id. Org-scoped. Author-or-manager check is in
 * the route layer.
 */
export async function deleteAnnotation(
  db: NodePgDatabase,
  orgId: string,
  annotationId: string,
): Promise<void> {
  await ensureCallTagsTables(db);
  await db
    .delete(annotations)
    .where(and(eq(annotations.orgId, orgId), eq(annotations.id, annotationId)));
}

/**
 * Bulk delete all annotations for an org (GDPR purge integration).
 */
export async function deleteAnnotationsByOrg(db: NodePgDatabase, orgId: string): Promise<number> {
  await ensureCallTagsTables(db);
  const result = await db
    .delete(annotations)
    .where(eq(annotations.orgId, orgId))
    .returning({ id: annotations.id });
  return result.length;
}
