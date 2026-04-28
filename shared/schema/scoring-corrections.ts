/**
 * Scoring corrections schema.
 *
 * Tier 2A of the CallAnalyzer adaptation plan. Multi-tenant adaptation of
 * CA's in-memory + S3-backed scoring-feedback module.
 *
 * Captures every manager edit of an AI-generated performance score so the
 * corrections can be:
 *   1. Surfaced back to the manager ("my corrections" widget) — Tier 2A/E
 *   2. Injected into future Bedrock prompts as ground-truth feedback — Tier 2B
 *   3. Aggregated into scoring-quality alerts (high correction rate, bias) — Tier 2C
 *   4. Compared week-over-week for scoring regression — Tier 2D
 *   5. Used to suggest "similar uncorrected calls" for review — Tier 2E
 *
 * Per-org isolation: all queries are scoped by org_id. The corrections from
 * one org never influence another's AI prompts or alerts.
 *
 * PHI: callSummary may contain transcribed patient information. The capture
 * function in `server/services/scoring-feedback.ts` PHI-redacts it before
 * persistence; this column should never be assumed to contain PHI at read time.
 */
import { pgTable, text, timestamp, real, jsonb, index } from "drizzle-orm/pg-core";

export const scoringCorrections = pgTable(
  "scoring_corrections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    callId: text("call_id").notNull(),
    /** The call's category at the time of correction (e.g. "inbound", "telemedicine"). */
    callCategory: text("call_category"),
    /** User ID of the manager who made the correction (canonical owner reference). */
    correctedBy: text("corrected_by").notNull(),
    /** Snapshot of the corrector's display name at capture time, for audit / UI. */
    correctedByName: text("corrected_by_name"),
    correctedAt: timestamp("corrected_at", { withTimezone: true }).notNull().defaultNow(),
    /** Sanitized free-form reason — sanitizeReasonForPrompt() is applied at capture. */
    reason: text("reason").notNull(),
    /** AI-generated score before correction. */
    originalScore: real("original_score").notNull(),
    /** Manager-supplied corrected score. */
    correctedScore: real("corrected_score").notNull(),
    /** Direction of the correction: 'upgraded' (manager scored higher) or 'downgraded'. */
    direction: text("direction").notNull(),
    /** Per-sub-score deltas: { compliance: { original, corrected }, ... } */
    subScoreChanges: jsonb("sub_score_changes"),
    /** PHI-redacted snapshot of the call summary at correction time, for context. */
    callSummary: text("call_summary"),
    /** Topic tags from the call analysis (string[]). */
    topics: jsonb("topics"),
  },
  (t) => ({
    /** Primary list query: recent corrections in an org, newest first. */
    byOrgRecent: index("idx_scoring_corr_org_corrected_at").on(t.orgId, t.correctedAt),
    /** "Show me corrections for this call" — drives the call-detail UI. */
    byCall: index("idx_scoring_corr_org_call").on(t.orgId, t.callId),
    /** "My corrections" widget — per-user list ordered by recency. */
    byUser: index("idx_scoring_corr_org_user_corrected_at").on(t.orgId, t.correctedBy, t.correctedAt),
    /** Grouping for prompt context + similar-uncorrected — by category + direction. */
    byCategoryDirection: index("idx_scoring_corr_org_category_direction").on(
      t.orgId,
      t.callCategory,
      t.direction,
    ),
  }),
);

export type ScoringCorrectionRow = typeof scoringCorrections.$inferSelect;
export type InsertScoringCorrection = typeof scoringCorrections.$inferInsert;
