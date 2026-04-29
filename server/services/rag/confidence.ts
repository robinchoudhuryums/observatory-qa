/**
 * Confidence computation + LLM-vs-retrieval reconciliation.
 * Extracted from rag.ts.
 *
 * `computeConfidence()` produces a baseline score from chunk similarity.
 * `reconcileConfidence()` cross-checks LLM-stated confidence (a tag in the
 * response) against retrieval effective score and adjusts when they
 * disagree — downgrading overconfident LLM responses on weak retrieval,
 * upgrading conservative responses when retrieval is strong.
 */
import type { RetrievedChunk } from "../rag";

export function computeConfidence(chunks: RetrievedChunk[]): {
  score: number;
  level: "high" | "partial" | "low" | "none";
} {
  if (chunks.length === 0) return { score: 0, level: "none" };
  const topScore = chunks[0].score;
  const avgScore = chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;

  // Effective score: 65% top + 35% avg (adapted from UMS).
  // A single strong match lifts confidence more than average.
  let effective = topScore * 0.65 + avgScore * 0.35;

  // Penalize thin evidence: only 1 result means low confidence in retrieval
  if (chunks.length <= 1 && effective > 0) {
    effective *= 0.85;
  }

  let level: "high" | "partial" | "low" | "none";
  if (effective >= 0.42) level = "high";
  else if (effective >= 0.3) level = "partial";
  else if (effective >= 0.15) level = "low";
  else level = "none";
  return { score: Math.round(effective * 100) / 100, level };
}

/**
 * Reconcile LLM-stated confidence with retrieval scores.
 * Adapted from UMS's parseConfidence() reconciliation logic.
 *
 * The LLM may be overconfident (hallucinating with weak retrieval) or
 * underconfident (conservative despite strong retrieval). This function
 * cross-checks both signals to produce a more trustworthy result.
 *
 * @param llmConfidence - Confidence tag from LLM output (e.g., "[CONFIDENCE: HIGH]")
 * @param retrievalConfidence - Score from computeConfidence()
 * @returns Reconciled confidence level and cleaned answer text
 */
export function reconcileConfidence(
  llmText: string,
  retrievalConfidence: { score: number; level: "high" | "partial" | "low" | "none" },
): {
  level: "high" | "partial" | "low" | "none";
  score: number;
  cleanedText: string;
  reconciled: boolean;
} {
  // Parse [CONFIDENCE: HIGH/PARTIAL/LOW] tag from LLM output
  const tagMatch = llmText.match(/\[CONFIDENCE:\s*(HIGH|PARTIAL|LOW)\]/i);
  const cleanedText = llmText.replace(/\[CONFIDENCE:\s*(?:HIGH|PARTIAL|LOW)\]/gi, "").trim();

  if (!tagMatch) {
    // No LLM tag — use retrieval confidence directly
    return {
      level: retrievalConfidence.level,
      score: retrievalConfidence.score,
      cleanedText,
      reconciled: false,
    };
  }

  const llmLevel = tagMatch[1].toLowerCase() as "high" | "partial" | "low";
  let finalLevel: "high" | "partial" | "low" | "none" = llmLevel;
  let reconciled = false;
  const rScore = retrievalConfidence.score;

  // Downgrade: LLM says HIGH but retrieval is weak → prevent hallucination trust
  if (llmLevel === "high" && rScore < 0.3) {
    finalLevel = "partial";
    reconciled = true;
  }

  // Hard downgrade: LLM says HIGH/PARTIAL but retrieval is very weak
  if ((llmLevel === "high" || llmLevel === "partial") && rScore < 0.15) {
    finalLevel = "low";
    reconciled = true;
  }

  // Upgrade: LLM says PARTIAL but retrieval is strong → model may be conservative.
  // Use effective score directly (threshold 0.50) — it already blends top + avg scores.
  // Previous code tried to back-derive topScore via score/0.65, which is mathematically
  // invalid because effective = topScore*0.65 + avgScore*0.35 (two unknowns).
  if (llmLevel === "partial" && rScore >= 0.5) {
    finalLevel = "high";
    reconciled = true;
  }

  return {
    level: finalLevel,
    score: rScore,
    cleanedText,
    reconciled,
  };
}
