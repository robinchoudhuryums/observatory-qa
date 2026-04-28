/**
 * Sub-score excellence badges.
 *
 * Tier 1D of the CallAnalyzer adaptation plan. Adds three new badge types
 * adapted from CA's gamification.ts:
 *
 *   - compliance_star    — 5 consecutive calls with compliance ≥ 9.0
 *   - empathy_champion   — 5 consecutive calls with customerExperience ≥ 9.0
 *   - resolution_ace     — 5 consecutive calls with resolution ≥ 9.0
 *
 * Observatory's existing gamification badges are score-aggregate or
 * milestone-based (first_call, ten_calls, perfect_score, etc.). These three
 * are the missing "excellence in a specific dimension" tier — they
 * recognize sustained sub-score quality rather than aggregate score.
 *
 * Wire-up: call `evaluateSubScoreBadges(orgId, employeeId)` at the end of
 * `checkAndAwardBadges` in `server/routes/gamification.ts`. See
 * TIER_0_5_PENDING.md for the small hand-edit.
 *
 * Type-safety note: the new badge IDs are not yet in `BADGE_DEFINITIONS`
 * in `shared/schema/features.ts`. The `as never` casts below let this
 * module compile against the existing union type. Adding the three
 * definitions to features.ts (also in TIER_0_5_PENDING.md) tightens type
 * safety; until then the runtime path works because storage stores
 * badge_id as a plain text column.
 */
import { storage } from "../storage";
import { logger } from "./logger";

export interface SubScoreBadgeDef {
  /** Stable badge ID — also used as the key in storage. */
  id: "compliance_star" | "empathy_champion" | "resolution_ace";
  /** Display name. */
  name: string;
  /** Brief description for UI tooltip / badge list. */
  description: string;
  /** Lucide icon hint (UI maps to its icon library). */
  icon: string;
  /** Sub-score field name on call.analysis.subScores. */
  dimension: "compliance" | "customerExperience" | "resolution";
  /** Snake_case fallback dimension key (some analyses use customer_experience). */
  dimensionFallback?: string;
  /** Minimum sub-score to count toward the streak. */
  threshold: number;
  /** Number of consecutive qualifying calls required. */
  consecutiveRequired: number;
}

export const SUB_SCORE_EXCELLENCE_BADGES: readonly SubScoreBadgeDef[] = [
  {
    id: "compliance_star",
    name: "Compliance Star",
    description: "5 consecutive calls with compliance sub-score 9.0 or higher",
    icon: "shield-check",
    dimension: "compliance",
    threshold: 9.0,
    consecutiveRequired: 5,
  },
  {
    id: "empathy_champion",
    name: "Empathy Champion",
    description: "5 consecutive calls with customer experience sub-score 9.0 or higher",
    icon: "heart",
    dimension: "customerExperience",
    dimensionFallback: "customer_experience",
    threshold: 9.0,
    consecutiveRequired: 5,
  },
  {
    id: "resolution_ace",
    name: "Resolution Ace",
    description: "5 consecutive calls with resolution sub-score 9.0 or higher",
    icon: "target",
    dimension: "resolution",
    threshold: 9.0,
    consecutiveRequired: 5,
  },
] as const;

/**
 * Pluck a sub-score for a given dimension from a call's analysis, supporting
 * both camelCase (customerExperience) and snake_case (customer_experience) keys.
 * Returns null if the value is missing or non-numeric.
 */
function pluckSubScore(analysis: unknown, dim: string, fallback?: string): number | null {
  if (!analysis || typeof analysis !== "object") return null;
  const subs = (analysis as { subScores?: Record<string, unknown> }).subScores;
  if (!subs || typeof subs !== "object") return null;
  const candidate = subs[dim] ?? (fallback ? subs[fallback] : undefined);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

/**
 * Check whether the most recent N calls all meet the threshold for a given
 * dimension. The N most-recent calls are taken from the END of the input
 * array (which is assumed to be in chronological order, oldest-first — matching
 * the order returned by storage.getCallSummaries with no explicit sort flag).
 *
 * Pure function — exposed for unit tests so the awarding logic can be
 * tested without mocking storage.
 */
export function qualifiesForBadge(recentCallsAnalyses: Array<{ analysis?: unknown }>, def: SubScoreBadgeDef): boolean {
  const lastN = recentCallsAnalyses.slice(-def.consecutiveRequired);
  if (lastN.length < def.consecutiveRequired) return false;
  const scores = lastN.map((c) => pluckSubScore(c.analysis, def.dimension, def.dimensionFallback));
  if (scores.some((s) => s === null)) return false;
  return scores.every((s) => (s as number) >= def.threshold);
}

/**
 * Check and award sub-score excellence badges for an employee.
 *
 * Idempotent — already-held badges are skipped. Returns the array of
 * newly-awarded badge IDs (empty if none).
 *
 * Designed to be called from `checkAndAwardBadges` in routes/gamification.ts
 * after the existing badge checks. Non-throwing — failures are logged and
 * the function returns an empty array so it can be safely called as a
 * fire-and-forget step at the end of the pipeline.
 */
export async function evaluateSubScoreBadges(orgId: string, employeeId: string): Promise<string[]> {
  try {
    // Same lookback strategy as existing gamification badges — last N completed calls.
    // We need at least `consecutiveRequired` (5) calls; 20 gives generous headroom
    // and matches the recentCalls.slice(-20) pattern in checkAndAwardBadges.
    const recentCalls = await storage.getCallSummaries(orgId, {
      employee: employeeId,
      status: "completed",
      limit: 20,
    });

    const existingBadges = await storage.getEmployeeBadges(orgId, employeeId);
    const heldBadgeIds = new Set(existingBadges.map((b) => b.badgeId));

    const newlyAwarded: string[] = [];
    const now = new Date().toISOString();

    for (const def of SUB_SCORE_EXCELLENCE_BADGES) {
      if (heldBadgeIds.has(def.id)) continue;
      if (!qualifiesForBadge(recentCalls, def)) continue;

      try {
        await storage.awardBadge(orgId, {
          orgId,
          employeeId,
          // Cast: the new IDs aren't in BADGE_DEFINITIONS' union yet.
          // See TIER_0_5_PENDING.md for the schema-level addition.
          badgeId: def.id as never,
          awardedAt: now,
        });
        newlyAwarded.push(def.id);
        logger.info(
          { orgId, employeeId, badgeId: def.id, dimension: def.dimension },
          "Sub-score excellence badge awarded",
        );
      } catch (err) {
        logger.warn({ err, orgId, employeeId, badgeId: def.id }, "Failed to award sub-score excellence badge");
      }
    }

    return newlyAwarded;
  } catch (err) {
    logger.error({ err, orgId, employeeId }, "Sub-score excellence badge evaluation failed");
    return [];
  }
}
