/**
 * Auto-Calibration Drift Detection Service.
 *
 * Adapted from the Call Analyzer for multi-tenant Observatory QA.
 * Monitors per-org AI score distributions over time and detects when the
 * scoring curve has drifted from the configured target (e.g., after a
 * model update that shifts all scores higher).
 *
 * How it works:
 * 1. Collects scored calls from a configurable time window (default 30 days)
 * 2. Computes observed mean, median, stddev, percentiles
 * 3. Compares observed mean vs. calibration config's aiModelMean
 * 4. If drift exceeds threshold, logs a recommendation and stores snapshot
 *
 * Multi-tenant: operates per-org, never mixing data across orgs.
 */
import { storage } from "../storage";
import { logger } from "./logger";
import type { CallSummary } from "@shared/schema";

export interface CalibrationSnapshot {
  orgId: string;
  timestamp: string;
  sampleSize: number;
  windowDays: number;
  observed: {
    mean: number;
    median: number;
    stdDev: number;
    min: number;
    max: number;
    p10: number;
    p90: number;
  };
  driftDetected: boolean;
  driftAmount: number;
}

const DRIFT_THRESHOLD = 0.5;
const DEFAULT_WINDOW_DAYS = 30;
const MIN_SAMPLE_SIZE = 20;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * Analyze score distribution for an org and detect drift.
 */
export async function analyzeOrgScoreDistribution(
  orgId: string,
  windowDays?: number,
): Promise<CalibrationSnapshot | null> {
  const days = windowDays || DEFAULT_WINDOW_DAYS;
  const cutoff = new Date(Date.now() - days * 86400000);

  const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
  const recentCalls = allCalls.filter(
    (c) => c.uploadedAt && new Date(c.uploadedAt) >= cutoff && c.analysis?.performanceScore,
  );

  const rawScores: number[] = [];
  for (const call of recentCalls) {
    const score = parseFloat(String(call.analysis?.performanceScore));
    if (Number.isFinite(score) && score >= 0 && score <= 10) {
      rawScores.push(score);
    }
  }

  if (rawScores.length < MIN_SAMPLE_SIZE) {
    logger.info(
      { orgId, sampleSize: rawScores.length, required: MIN_SAMPLE_SIZE },
      "Insufficient data for calibration analysis",
    );
    return null;
  }

  rawScores.sort((a, b) => a - b);

  const sum = rawScores.reduce((a, b) => a + b, 0);
  const mean = sum / rawScores.length;
  const median = percentile(rawScores, 50);
  const variance = rawScores.reduce((s, x) => s + (x - mean) ** 2, 0) / rawScores.length;
  const stdDev = Math.sqrt(variance);

  // Load org's calibration config (or use platform defaults)
  const org = await storage.getOrganization(orgId);
  const settings = org?.settings as any;
  const configuredMean = settings?.calibrationAiModelMean ?? 7.5; // AI models typically score ~7.5

  const drift = Math.abs(mean - configuredMean);
  const driftDetected = drift > DRIFT_THRESHOLD;

  const snapshot: CalibrationSnapshot = {
    orgId,
    timestamp: new Date().toISOString(),
    sampleSize: rawScores.length,
    windowDays: days,
    observed: {
      mean: Math.round(mean * 100) / 100,
      median: Math.round(median * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      min: rawScores[0],
      max: rawScores[rawScores.length - 1],
      p10: Math.round(percentile(rawScores, 10) * 100) / 100,
      p90: Math.round(percentile(rawScores, 90) * 100) / 100,
    },
    driftDetected,
    driftAmount: Math.round(drift * 100) / 100,
  };

  if (driftDetected) {
    logger.warn(
      { orgId, observedMean: snapshot.observed.mean, configuredMean, drift: snapshot.driftAmount },
      "Score calibration drift detected — AI model mean has shifted",
    );
  } else {
    logger.info(
      {
        orgId,
        mean: snapshot.observed.mean,
        median: snapshot.observed.median,
        stdDev: snapshot.observed.stdDev,
        sampleSize: rawScores.length,
      },
      "Score distribution healthy — no calibration drift",
    );
  }

  return snapshot;
}

/** Export for testing */
export const _testExports = { percentile };
