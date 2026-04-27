/**
 * Call tags + per-moment annotations.
 *
 * Tier 1A of the CallAnalyzer adaptation plan. Adapted from CA's single-tenant
 * `call_tags` + `annotations` tables, scoped per-org for multi-tenant SaaS.
 *
 * Tags: free-form labels (alphanumeric + spaces + `._/-`, max 100 chars,
 * normalized to lowercase). Org-scoped uniqueness — same tag name in
 * different orgs are independent.
 *
 * Annotations: timestamped notes pinned to a specific moment in a call's
 * audio (timestamp_ms, max 2000 chars). Author tracked for audit trail.
 */
import { pgTable, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";

export const callTags = pgTable(
  "call_tags",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    callId: text("call_id").notNull(),
    /** Normalized lowercase, alphanumeric + spaces + `._/-`, max 100 chars. */
    tag: text("tag").notNull(),
    /** Username of the user who created the tag. Used for author-or-manager
     *  delete enforcement and audit trail. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** A call can have any number of tags but never the same tag twice. */
    uniqByCallTag: uniqueIndex("uq_call_tags_org_call_tag").on(t.orgId, t.callId, t.tag),
    /** "Find calls tagged X in this org" — drives the by-tag search route. */
    byOrgTag: index("idx_call_tags_org_tag").on(t.orgId, t.tag),
    /** "Tags on this call" — drives the per-call list route. */
    byCall: index("idx_call_tags_call").on(t.callId),
  }),
);

export const annotations = pgTable(
  "annotations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    callId: text("call_id").notNull(),
    /** Position in the call audio, in milliseconds from start. */
    timestampMs: integer("timestamp_ms").notNull(),
    /** Annotation body; max 2000 chars enforced at the route layer. */
    text: text("text").notNull(),
    /** Display name of the author (user.name fallback to username). Used for
     *  the UI; the canonical owner is implied by the access control path
     *  (only the author or a manager+ may delete). */
    author: text("author").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** "Annotations for this call, ordered along the timeline" — primary list query. */
    byCall: index("idx_annotations_call_ts").on(t.callId, t.timestampMs),
    /** Org-scoped index for purge / cross-call admin queries. */
    byOrg: index("idx_annotations_org").on(t.orgId),
  }),
);

export type CallTag = typeof callTags.$inferSelect;
export type InsertCallTag = typeof callTags.$inferInsert;
export type Annotation = typeof annotations.$inferSelect;
export type InsertAnnotation = typeof annotations.$inferInsert;
