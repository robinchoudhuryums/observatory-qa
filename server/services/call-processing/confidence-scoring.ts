/**
 * Confidence-score and server-side flag enforcement helpers.
 *
 * Pure functions extracted from `call-processing.ts` so the analysis
 * scoring logic is independently testable without mocking the pipeline.
 *
 * `computeConfidence` blends transcript clarity, speech density (WPM),
 * call duration, and AI-analysis success into a single 0-1 score.
 *
 * `enforceServerFlags` applies hard thresholds the AI cannot override:
 * we always tag low-confidence transcripts, low-performance calls, and
 * exceptional-performance calls regardless of what the model returned.
 */

export interface ConfidenceResult {
  score: number;
  factors: {
    transcriptConfidence: number;
    wordCount: number;
    callDurationSeconds: number;
    transcriptLength: number;
    aiAnalysisCompleted: boolean;
    overallScore: number;
  };
}

export function computeConfidence(
  transcriptConfidence: number,
  wordCount: number,
  callDuration: number,
  hasAiAnalysis: boolean,
): ConfidenceResult {
  // Words-per-minute density normalizes for call type: a 30-second
  // procedural call with 40 words is dense and valid, while a 5-minute
  // call with 10 words suggests audio/transcription issues.
  const wpm = callDuration > 0 ? (wordCount / callDuration) * 60 : 0;
  // Normal speech is 100-180 WPM; below 30 WPM is suspicious.
  const densityConfidence = Math.min(wpm / 80, 1);
  const wordConfidence = Math.min(wordCount / 30, 1); // Lower threshold (30 vs 50) for procedural calls
  const durationConfidence = callDuration > 15 ? 1 : callDuration / 15; // Lower threshold (15s vs 30s)
  // When AI analysis fails, scores are all defaults (5.0) — confidence
  // should reflect that results are unreliable. 0.0 gives a hard 25% penalty.
  const aiConfidence = hasAiAnalysis ? 1 : 0;

  const score =
    transcriptConfidence * 0.35 +
    wordConfidence * 0.15 +
    densityConfidence * 0.1 +
    durationConfidence * 0.15 +
    aiConfidence * 0.25;

  return {
    score,
    factors: {
      transcriptConfidence: Math.round(transcriptConfidence * 100) / 100,
      wordCount,
      callDurationSeconds: callDuration,
      transcriptLength: 0, // Set by caller
      aiAnalysisCompleted: hasAiAnalysis,
      overallScore: Math.round(score * 100) / 100,
    },
  };
}

/** Configurable thresholds for server-side flag enforcement.
 *  Per-org overrides via `org.settings.analysisThresholds`. */
export interface AnalysisThresholds {
  /** Below this confidence → `low_confidence` flag (default 0.7). */
  lowConfidence: number;
  /** At or below this score → `low_score` flag (default 2.0). */
  lowScore: number;
  /** At or above this score → `exceptional_call` flag (default 9.0). */
  exceptionalScore: number;
}

const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  lowConfidence: 0.7,
  lowScore: 2.0,
  exceptionalScore: 9.0,
};

export function enforceServerFlags(
  existingFlags: string[],
  confidenceScore: number,
  performanceScore: number,
  thresholds?: Partial<AnalysisThresholds>,
): string[] {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const flags = [...existingFlags];
  if (confidenceScore < t.lowConfidence && !flags.includes("low_confidence")) {
    flags.push("low_confidence");
  }
  if (performanceScore > 0 && performanceScore <= t.lowScore && !flags.includes("low_score")) {
    flags.push("low_score");
  }
  if (performanceScore >= t.exceptionalScore && !flags.includes("exceptional_call")) {
    flags.push("exceptional_call");
  }
  return flags;
}
