/**
 * Scoring feedback — week-over-week regression detection.
 *
 * Tier 2D of the CallAnalyzer adaptation plan. Compares this week's score
 * distribution against the previous week's. Significant mean shifts indicate
 * a model regression, prompt-template change, or calibration drift.
 *
 * Multi-tenant: each org's score distribution is evaluated independently.
 *
 * Sample-size guard: requires at least MIN_SAMPLE_SIZE scored calls in
 * EACH week before drawing conclusions — otherwise small-N noise dominates.
 *
 * Designed to run alongside checkScoringQuality (Tier 2C) in the daily
 * scheduled task orchestrator.
 */
import { logger } from "./logger";
import { storage } from "../storage";
import type { ScoringQualityAlert } from "./scoring-feedback-alerts";

/** Mean shift (in score points) that triggers a regression alert. */
const REGRESSION_MEAN_SHIFT_THRESHOLD = 0.8;

/** Mean shift that escalates the alert to critical. */
const REGRESSION_CRITICAL_THRESHOLD = 1.5;

/** Minimum scored calls per week before we trust the comparison. */
const MIN_SAMPLE_SIZE = 10;

export interface ScoringRegressionResult {
  orgId: string;
  detected: boolean;
  currentWeek: { mean: number; count: number; stdDev: number };
  previousWeek: { mean: number; count: number; stdDev: number };
  meanShift: number;
  significanceThreshold: number;
  alert: ScoringQualityAlert | null;
}

/**
 * Compute mean / count / stdDev for a list of scores. Returns zeros for
 * an empty list. Pure helper, exposed for testing.
 */
export function computeScoreStats(scores: number[]): { mean: number; count: number; stdDev: number } {
  if (scores.length === 0) return { mean: 0, count: 0, stdDev: 0 };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length;
  return {
    mean: Math.round(mean * 100) / 100,
    count: scores.length,
    stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
  };
}

/**
 * Detect scoring regression for a single org. Returns a result object
 * with the comparison and an optional alert when the threshold is crossed.
 *
 * Non-throwing — failures are logged and the function returns a "no
 * regression" result so the scheduled task can continue with other orgs.
 */
export async function detectScoringRegression(orgId: string): Promise<ScoringRegressionResult> {
  const now = Date.now();
  const oneWeekMs = 7 * 86_400_000;
  const currentWeekStart = new Date(now - oneWeekMs);
  const previousWeekStart = new Date(now - 2 * oneWeekMs);

  const empty = (): ScoringRegressionResult => ({
    orgId,
    detected: false,
    currentWeek: { mean: 0, count: 0, stdDev: 0 },
    previousWeek: { mean: 0, count: 0, stdDev: 0 },
    meanShift: 0,
    significanceThreshold: REGRESSION_MEAN_SHIFT_THRESHOLD,
    alert: null,
  });

  let allCalls: Awaited<ReturnType<typeof storage.getCallSummaries>> = [];
  try {
    allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
  } catch (err) {
    logger.warn({ err, orgId }, "Scoring regression: failed to load call summaries");
    return empty();
  }

  // Filter to calls in the last two weeks and partition by week.
  const currentWeekScores: number[] = [];
  const previousWeekScores: number[] = [];

  for (const call of allCalls) {
    const uploadedAt = call.uploadedAt ? new Date(call.uploadedAt).getTime() : 0;
    if (uploadedAt < previousWeekStart.getTime()) continue;

    const rawScore = call.analysis?.performanceScore;
    if (rawScore === undefined || rawScore === null || String(rawScore) === "") continue;
    const score = parseFloat(String(rawScore));
    if (!Number.isFinite(score) || score < 0 || score > 10) continue;

    if (uploadedAt >= currentWeekStart.getTime()) {
      currentWeekScores.push(score);
    } else {
      previousWeekScores.push(score);
    }
  }

  const current = computeScoreStats(currentWeekScores);
  const previous = computeScoreStats(previousWeekScores);

  const hasSufficientData = current.count >= MIN_SAMPLE_SIZE && previous.count >= MIN_SAMPLE_SIZE;
  const meanShift = Math.round(Math.abs(current.mean - previous.mean) * 100) / 100;
  const detected = hasSufficientData && meanShift >= REGRESSION_MEAN_SHIFT_THRESHOLD;

  let alert: ScoringQualityAlert | null = null;
  if (detected) {
    const direction = current.mean > previous.mean ? "higher" : "lower";
    const severity: "warning" | "critical" = meanShift >= REGRESSION_CRITICAL_THRESHOLD ? "critical" : "warning";
    alert = {
      orgId,
      type: "systematic_bias",
      severity,
      message:
        `Scoring regression detected: this week's mean (${current.mean}) is ` +
        `${meanShift} points ${direction} than last week (${previous.mean}). ` +
        `Investigate model changes, prompt template edits, or calibration drift.`,
      details: {
        windowDays: 7,
        totalCalls: current.count + previous.count,
        avgDelta: meanShift,
        biasDirection: current.mean > previous.mean ? "upgrades" : "downgrades",
      },
      timestamp: new Date().toISOString(),
    };
    logger.warn(
      { orgId, currentMean: current.mean, previousMean: previous.mean, shift: meanShift, severity },
      "Scoring regression detected",
    );
  }

  return {
    orgId,
    detected,
    currentWeek: current,
    previousWeek: previous,
    meanShift,
    significanceThreshold: REGRESSION_MEAN_SHIFT_THRESHOLD,
    alert,
  };
}

/**
 * Run regression detection for every org and return a flat array of
 * detected results (regardless of whether they crossed the threshold).
 * Designed for the daily scheduled task orchestrator.
 */
export async function runScoringRegressionChecks(): Promise<ScoringRegressionResult[]> {
  const results: ScoringRegressionResult[] = [];
  let orgs: Array<{ id: string }> = [];
  try {
    orgs = await storage.listOrganizations();
  } catch (err) {
    logger.warn({ err }, "Failed to list orgs for scoring regression checks");
    return [];
  }

  for (const org of orgs) {
    try {
      const result = await detectScoringRegression(org.id);
      results.push(result);
    } catch (err) {
      logger.warn({ err, orgId: org.id }, "Scoring regression check failed for org");
    }
  }

  return results;
}
