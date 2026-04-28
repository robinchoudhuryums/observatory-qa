/**
 * Scoring feedback — quality alerts.
 *
 * Tier 2C of the CallAnalyzer adaptation plan. Detects two scoring quality
 * issues from the recent correction stream:
 *
 *   1. High correction rate — too many calls are being manually corrected,
 *      suggesting the AI's scoring is consistently off and the prompt
 *      template / model needs revisiting. Warning at >=15%, critical at >=25%.
 *
 *   2. Systematic bias — when >=75% of corrections in the same direction,
 *      the AI is systematically scoring too high or too low. Suggests a
 *      calibration adjustment.
 *
 * Multi-tenant: each org's corrections are evaluated independently.
 *
 * Designed to be called from the daily scheduled task orchestrator
 * (server/scheduled/) per-org. The returned alerts can be:
 *   - Logged to Pino (always)
 *   - Sent to Slack/Teams via the existing notifications service
 *   - Stored in the proactive-alerts feed for the manager review queue
 */
import { logger } from "./logger";
import { getDatabase } from "../db/index";
import { storage } from "../storage";
import { listCorrectionsSince } from "../storage/scoring-corrections";

// --- Configuration thresholds ---

/** Window over which correction rate is computed (days). */
const QUALITY_CHECK_WINDOW_DAYS = 7;

/** Correction rate (corrected / total completed) that triggers a warning. */
const CORRECTION_RATE_WARNING = 0.15;

/** Correction rate that escalates to critical. */
const CORRECTION_RATE_CRITICAL = 0.25;

/** Direction-share that triggers a systematic-bias alert. */
const BIAS_THRESHOLD = 0.75;

/** Minimum corrections in window before bias detection runs. */
const MIN_CORRECTIONS_FOR_BIAS = 5;

/** Minimum corrections in window before any quality check runs. */
const MIN_CORRECTIONS_FOR_RATE = 3;

// --- Alert shape ---

export interface ScoringQualityAlert {
  orgId: string;
  type: "high_correction_rate" | "systematic_bias";
  severity: "warning" | "critical";
  message: string;
  details: {
    correctionRate?: number;
    windowDays: number;
    totalCalls?: number;
    totalCorrections?: number;
    avgDelta?: number;
    biasDirection?: "upgrades" | "downgrades";
  };
  timestamp: string;
}

/**
 * Check scoring quality for a single org. Pure-ish — no notification side
 * effects; the caller decides what to do with the returned alerts.
 *
 * Returns an empty array when there's insufficient data or no issues.
 */
export async function checkScoringQuality(orgId: string): Promise<ScoringQualityAlert[]> {
  const db = getDatabase();
  if (!db) return [];

  const windowMs = QUALITY_CHECK_WINDOW_DAYS * 86_400_000;
  const since = new Date(Date.now() - windowMs);

  const recentCorrections = await listCorrectionsSince(db, orgId, since);

  if (recentCorrections.length < MIN_CORRECTIONS_FOR_RATE) {
    // Not enough data — return nothing rather than misleading "0% rate" alerts
    return [];
  }

  const alerts: ScoringQualityAlert[] = [];

  // --- 1. High correction rate ---
  // Need total completed call count to compute the ratio.
  let totalCallsInWindow = 0;
  try {
    const recentCalls = await storage.getCallSummaries(orgId, { status: "completed" });
    totalCallsInWindow = recentCalls.filter((c) => {
      const t = c.uploadedAt ? new Date(c.uploadedAt).getTime() : 0;
      return t >= since.getTime();
    }).length;
  } catch (err) {
    logger.warn({ err, orgId }, "Could not load call count for correction-rate check");
  }

  if (totalCallsInWindow > 0) {
    const correctionRate = recentCorrections.length / totalCallsInWindow;
    if (correctionRate >= CORRECTION_RATE_CRITICAL) {
      alerts.push({
        orgId,
        type: "high_correction_rate",
        severity: "critical",
        message:
          `Critical: ${Math.round(correctionRate * 100)}% of calls in the last ` +
          `${QUALITY_CHECK_WINDOW_DAYS} days were manually corrected ` +
          `(${recentCorrections.length}/${totalCallsInWindow}). ` +
          `AI scoring may need recalibration or prompt template review.`,
        details: {
          correctionRate: Math.round(correctionRate * 100) / 100,
          windowDays: QUALITY_CHECK_WINDOW_DAYS,
          totalCalls: totalCallsInWindow,
          totalCorrections: recentCorrections.length,
        },
        timestamp: new Date().toISOString(),
      });
    } else if (correctionRate >= CORRECTION_RATE_WARNING) {
      alerts.push({
        orgId,
        type: "high_correction_rate",
        severity: "warning",
        message:
          `Warning: ${Math.round(correctionRate * 100)}% of calls in the last ` +
          `${QUALITY_CHECK_WINDOW_DAYS} days were manually corrected ` +
          `(${recentCorrections.length}/${totalCallsInWindow}).`,
        details: {
          correctionRate: Math.round(correctionRate * 100) / 100,
          windowDays: QUALITY_CHECK_WINDOW_DAYS,
          totalCalls: totalCallsInWindow,
          totalCorrections: recentCorrections.length,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // --- 2. Systematic bias detection ---
  const upgrades = recentCorrections.filter((c) => c.direction === "upgraded").length;
  const downgrades = recentCorrections.filter((c) => c.direction === "downgraded").length;
  const directional = upgrades + downgrades;

  if (directional >= MIN_CORRECTIONS_FOR_BIAS) {
    const upgradeRate = upgrades / directional;
    const downgradeRate = downgrades / directional;

    if (upgradeRate >= BIAS_THRESHOLD) {
      const avgDelta =
        recentCorrections.reduce((s, c) => s + (c.correctedScore - c.originalScore), 0) / directional;
      alerts.push({
        orgId,
        type: "systematic_bias",
        severity: "warning",
        message:
          `AI consistently scores too low: ${Math.round(upgradeRate * 100)}% of ` +
          `corrections are upgrades (avg +${avgDelta.toFixed(1)} points over ` +
          `${QUALITY_CHECK_WINDOW_DAYS} days). Consider prompt template revision ` +
          `or BEDROCK_MODEL adjustment.`,
        details: {
          windowDays: QUALITY_CHECK_WINDOW_DAYS,
          totalCorrections: directional,
          avgDelta: Math.round(avgDelta * 10) / 10,
          biasDirection: "upgrades",
        },
        timestamp: new Date().toISOString(),
      });
    } else if (downgradeRate >= BIAS_THRESHOLD) {
      const avgDelta =
        recentCorrections.reduce((s, c) => s + (c.originalScore - c.correctedScore), 0) / directional;
      alerts.push({
        orgId,
        type: "systematic_bias",
        severity: "warning",
        message:
          `AI consistently scores too high: ${Math.round(downgradeRate * 100)}% of ` +
          `corrections are downgrades (avg -${avgDelta.toFixed(1)} points over ` +
          `${QUALITY_CHECK_WINDOW_DAYS} days). Consider prompt template revision ` +
          `or BEDROCK_MODEL adjustment.`,
        details: {
          windowDays: QUALITY_CHECK_WINDOW_DAYS,
          totalCorrections: directional,
          avgDelta: Math.round(avgDelta * 10) / 10,
          biasDirection: "downgrades",
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (alerts.length > 0) {
    logger.warn(
      { orgId, alertCount: alerts.length, types: alerts.map((a) => a.type) },
      "Scoring quality issues detected",
    );
  }

  return alerts;
}

/**
 * Run the quality check across all orgs and return a flat array of alerts.
 * Designed for the daily scheduled task orchestrator.
 *
 * Sequenced (not parallel) to avoid thundering-herd on the call-summaries
 * lookups; per-org cost is bounded by the 7-day window.
 */
export async function runScoringQualityChecks(): Promise<ScoringQualityAlert[]> {
  const allAlerts: ScoringQualityAlert[] = [];
  let orgs: Array<{ id: string }> = [];
  try {
    orgs = await storage.listOrganizations();
  } catch (err) {
    logger.warn({ err }, "Failed to list orgs for scoring quality checks");
    return [];
  }

  for (const org of orgs) {
    try {
      const orgAlerts = await checkScoringQuality(org.id);
      allAlerts.push(...orgAlerts);
    } catch (err) {
      logger.warn({ err, orgId: org.id }, "Scoring quality check failed for org");
    }
  }

  return allAlerts;
}
