/**
 * PHI-redacting helper for coaching plan prompt construction.
 *
 * The coaching engine (`server/services/coaching-engine.ts`) builds a Bedrock
 * prompt that embeds JSON of the agent's recent call analyses (summary,
 * feedback strengths/suggestions, flags, sentiment, scores). The AI's job is
 * to produce a coaching action plan — it works from scores, sub-scores,
 * flags, and feedback themes. It does NOT need patient names, MRNs,
 * addresses, etc. that may appear in the `summary` or `feedback` fields.
 *
 * This module pre-processes the call summaries through `redactPhiDeep` so
 * the prompt that reaches Bedrock has minimum PHI surface, even when the
 * underlying call summaries were generated for non-clinical categories
 * (where PHI redaction is already applied at the analyze boundary, but
 * residual PHI in summary text may still slip through).
 *
 * Tier 0.1 of the CallAnalyzer adaptation plan.
 */
import { redactPhiDeep } from "../utils/phi-redactor";
import { shouldRedactPhiForCategory } from "./phi-policy";

/**
 * Shape of the coaching call summary that gets embedded in the Bedrock prompt.
 * Mirrors the shape built in `server/services/coaching-engine.ts:generateCoachingPlan`.
 */
export interface CoachingCallSummary {
  score?: number | string | null;
  subScores?: unknown;
  summary?: string | null;
  feedback?: unknown;
  flags?: unknown;
  sentiment?: string | null;
}

/**
 * Prepare an array of call summaries for inclusion in a coaching plan prompt.
 *
 * Defaults to redacting PHI. If the coaching session is for a clinical
 * category (rare — coaching is usually about agent skills, not clinical
 * documentation), pass that category to opt out via the same routing as
 * the analyze boundary.
 *
 * Returns a deeply-cloned, PHI-redacted copy. The original objects are
 * not mutated.
 */
export function prepareCallSummariesForPrompt(
  summaries: CoachingCallSummary[],
  callCategory?: string | null,
): CoachingCallSummary[] {
  if (!shouldRedactPhiForCategory(callCategory)) {
    // Defensive copy even when not redacting, to keep the contract stable
    // (caller always receives a fresh array they can modify).
    return summaries.map((s) => ({ ...s }));
  }
  return redactPhiDeep(summaries) as CoachingCallSummary[];
}
