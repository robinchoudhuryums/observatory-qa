/**
 * Scoring Feedback Loop — multi-tenant scoring correction capture.
 *
 * Tier 2A of the CallAnalyzer adaptation plan. Captures every manager edit
 * of an AI-generated performance score, sanitizes the reason text against
 * prompt injection, and persists to PostgreSQL via
 * server/storage/scoring-corrections.ts.
 *
 * Adapted from CA's `server/services/scoring-feedback.ts` (in-memory + S3
 * JSON files). Multi-tenant scoping (orgId) is the major difference;
 * per-org statistics, per-org prompt enrichment, per-org alerts.
 *
 * Tier 2 sub-tier breakdown:
 *   2A (this module) — capture + per-user views + pure grouping helpers
 *   2B — prompt context injection (server/services/scoring-feedback-context.ts)
 *   2C — quality alerts (server/services/scoring-feedback-alerts.ts)
 *   2D — regression detection (server/services/scoring-feedback-regression.ts)
 *   2E — admin/UI routes (server/routes/scoring-corrections.ts)
 *
 * Wire-up to PATCH /api/calls/:id/analysis route is documented in
 * TIER_0_5_PENDING.md (small hand-edit at the analysis-edit capture point).
 */
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { logger } from "./logger";
import { getDatabase } from "../db/index";
import { redactPhi } from "../utils/phi-redactor";
import {
  insertCorrection,
  listRecentByUser,
  listCorrectionsSince,
  getOrgCorrectionStats,
  type ScoringCorrectionRow,
} from "../storage/scoring-corrections";

// --- Sanitization ---

/** Maximum length of a sanitized reason after embedding into a prompt. */
const MAX_REASON_LEN = 500;

/**
 * Sanitize the manager-supplied `reason` field before persistence and
 * before embedding into any AI prompt.
 *
 * Defense-in-depth against prompt injection:
 *  - Collapse CR/LF and all other control characters so a manager cannot
 *    craft a multi-line payload that breaks out of the surrounding
 *    delimited block.
 *  - Strip backtick / brace / bracket / angle-bracket characters commonly
 *    used by models to signal "this is code / structured data / instructions".
 *  - Collapse repeated whitespace and trim to a bounded length. Anything
 *    longer than MAX_REASON_LEN is truncated with a trailing ellipsis.
 *
 * The sanitized string is still useful human feedback — words, numbers, basic
 * punctuation — but cannot escape the delimiter block used by the prompt-
 * enrichment module (Tier 2B).
 */
export function sanitizeReasonForPrompt(raw: string | undefined | null): string {
  if (!raw) return "";
  let text = String(raw);
  // Replace control characters (incl. CR/LF/tab) with a single space.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[ -]/g, " ");
  // Strip characters that can signal code fences or delimiter manipulation.
  text = text.replace(/[`{}<>[\]\\]/g, " ");
  // Collapse repeated whitespace.
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > MAX_REASON_LEN) {
    text = text.slice(0, MAX_REASON_LEN - 1).trimEnd() + "…";
  }
  return text;
}

// --- Capture ---

export interface RecordCorrectionParams {
  orgId: string;
  callId: string;
  /** Canonical user ID of the manager (not username — OQ has per-org username uniqueness). */
  correctedBy: string;
  /** Display name snapshot for audit/UI; falls back to correctedBy if not provided. */
  correctedByName?: string;
  /** Free-form reason. Will be sanitized + truncated. */
  reason: string;
  /** AI's original score. */
  originalScore: number;
  /** Manager's corrected score. */
  correctedScore: number;
  /** Optional per-sub-score deltas. */
  subScoreChanges?: Record<string, { original: number; corrected: number }>;
}

/**
 * Record a scoring correction when a manager edits a call's analysis.
 *
 * Called from the PATCH /api/calls/:id/analysis route (wire-up documented
 * in TIER_0_5_PENDING.md). Non-throwing — failures are logged but never
 * propagate; the analysis edit succeeds even if correction capture fails.
 *
 * Returns the persisted row, or null if the DB is unavailable or the call
 * doesn't belong to the org.
 */
export async function recordScoringCorrection(params: RecordCorrectionParams): Promise<ScoringCorrectionRow | null> {
  const { orgId, callId, correctedBy, correctedByName, reason, originalScore, correctedScore, subScoreChanges } =
    params;

  const db = getDatabase();
  if (!db) {
    logger.debug({ orgId, callId }, "Scoring correction skipped — no DB available");
    return null;
  }

  // Sanitize at capture time so the stored correction can never carry raw
  // prompt-injection payloads forward, even if a downstream caller forgets
  // to sanitize at render time.
  const safeReason = sanitizeReasonForPrompt(reason);

  // Pull call context for retrieval/grouping. PHI-redact the summary
  // because it may contain transcribed patient information.
  let callCategory: string | null = null;
  let callSummary: string | null = null;
  let topics: string[] | null = null;
  try {
    const call = await storage.getCall(orgId, callId);
    callCategory = call?.callCategory ?? null;
    const analysis = await storage.getCallAnalysis(orgId, callId);
    if (analysis) {
      const rawSummary = (analysis as { summary?: unknown }).summary;
      callSummary = typeof rawSummary === "string" ? redactPhi(rawSummary) : null;
      const rawTopics = (analysis as { topics?: unknown }).topics;
      topics = Array.isArray(rawTopics) ? rawTopics.map((t) => (typeof t === "string" ? t : String(t))) : null;
    }
  } catch (err) {
    logger.debug({ err, orgId, callId }, "Failed to fetch call context for correction");
  }

  const direction: "upgraded" | "downgraded" = correctedScore > originalScore ? "upgraded" : "downgraded";

  try {
    const row = await insertCorrection(db, {
      id: `corr-${randomUUID()}`,
      orgId,
      callId,
      callCategory,
      correctedBy,
      correctedByName: correctedByName ?? correctedBy,
      correctedAt: new Date(),
      reason: safeReason,
      originalScore,
      correctedScore,
      direction,
      subScoreChanges: subScoreChanges ?? null,
      callSummary,
      topics,
    });
    logger.info(
      {
        orgId,
        callId,
        correctionId: row.id,
        originalScore,
        correctedScore,
        direction,
        category: callCategory,
      },
      "Scoring correction recorded",
    );
    return row;
  } catch (err) {
    logger.error({ err, orgId, callId, correctedBy }, "Failed to persist scoring correction");
    return null;
  }
}

// --- User-scoped read helpers ---

/**
 * Most recent corrections by a specific user in an org, newest first.
 * Drives the "my corrections" dashboard widget (Tier 2E).
 */
export async function getRecentCorrectionsByUser(
  orgId: string,
  userId: string,
  limit = 20,
): Promise<ScoringCorrectionRow[]> {
  const db = getDatabase();
  if (!db) return [];
  const bounded = Math.max(1, Math.min(100, limit));
  return listRecentByUser(db, orgId, userId, bounded);
}

/**
 * Summary stats for a user's corrections over a rolling window.
 * Drives the manager-facing feedback dashboard.
 */
export async function getUserCorrectionStats(
  orgId: string,
  userId: string,
  sinceDays = 30,
): Promise<{
  total: number;
  upgrades: number;
  downgrades: number;
  avgDelta: number;
  windowDays: number;
}> {
  const db = getDatabase();
  if (!db) return { total: 0, upgrades: 0, downgrades: 0, avgDelta: 0, windowDays: sinceDays };

  const since = new Date(Date.now() - sinceDays * 86_400_000);
  // Pull all corrections in the window then filter by user. For very high-
  // volume orgs we'd add a per-user-since DAL helper, but this is fine for
  // typical usage (single-user windows are small).
  const all = await listCorrectionsSince(db, orgId, since);
  const recent = all.filter((c) => c.correctedBy === userId);

  const upgrades = recent.filter((c) => c.direction === "upgraded").length;
  const downgrades = recent.filter((c) => c.direction === "downgraded").length;
  const avgDelta =
    recent.length > 0
      ? recent.reduce((sum, c) => sum + Math.abs(c.correctedScore - c.originalScore), 0) / recent.length
      : 0;

  return {
    total: recent.length,
    upgrades,
    downgrades,
    avgDelta: Math.round(avgDelta * 10) / 10,
    windowDays: sinceDays,
  };
}

/**
 * Org-wide correction stats. Drives admin dashboards.
 * If `sinceDays` is provided, only counts corrections within that window.
 */
export async function getCorrectionStats(
  orgId: string,
  sinceDays?: number,
): Promise<{
  total: number;
  upgrades: number;
  downgrades: number;
  avgDelta: number;
  byCategory: Record<string, number>;
}> {
  const db = getDatabase();
  if (!db) return { total: 0, upgrades: 0, downgrades: 0, avgDelta: 0, byCategory: {} };

  const stats = await getOrgCorrectionStats(db, orgId, sinceDays);

  // avgDelta requires the actual correction rows; pull them once for the window.
  const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000) : new Date(0);
  const rows = await listCorrectionsSince(db, orgId, since);
  const avgDelta =
    rows.length > 0 ? rows.reduce((sum, c) => sum + Math.abs(c.correctedScore - c.originalScore), 0) / rows.length : 0;

  return {
    ...stats,
    avgDelta: Math.round(avgDelta * 10) / 10,
  };
}

// --- Pure helpers for "similar uncorrected calls" (Tier 2E read-side) ---

export interface CorrectionGroup {
  /** "general" matches any call category; any other value requires exact match. */
  category: string;
  direction: "upgraded" | "downgraded";
  /** Mean of `originalScore` across corrections in this group. */
  centroid: number;
  count: number;
}

/**
 * Group corrections by `(category || "general", direction)`.
 * Keeps running-mean of `originalScore` as the centroid — the "this is what
 * AI tends to mis-score" signal. Groups with fewer than `minCount` corrections
 * (default 2) are dropped to suppress single-outlier false positives.
 *
 * Pure function — exposed so the route handler can test it without DB access.
 */
export function groupCorrectionsByCategoryDirection(
  corrections: Array<{ callCategory: string | null; direction: string; originalScore: number }>,
  minCount = 2,
): CorrectionGroup[] {
  const groups = new Map<string, CorrectionGroup>();
  for (const c of corrections) {
    if (c.direction !== "upgraded" && c.direction !== "downgraded") continue;
    const category = c.callCategory || "general";
    const key = `${category}::${c.direction}`;
    const existing = groups.get(key);
    if (existing) {
      existing.centroid = (existing.centroid * existing.count + c.originalScore) / (existing.count + 1);
      existing.count += 1;
    } else {
      groups.set(key, {
        category,
        direction: c.direction,
        centroid: c.originalScore,
        count: 1,
      });
    }
  }
  // Array.from(): downlevelIteration-safe; same semantics as `[...groups.values()]`.
  return Array.from(groups.values())
    .filter((g) => g.count >= minCount)
    .sort((a, b) => b.count - a.count);
}

export interface SimilarCallCandidate {
  id: string;
  callCategory?: string | null;
  uploadedAt?: string;
  analysis?: {
    performanceScore?: string | number | null;
    manualEdits?: Array<{ editedBy?: string } | unknown>;
  };
  employee?: { name?: string };
}

export interface SimilarCallSuggestion {
  callId: string;
  aiScore: number;
  callCategory?: string | null;
  direction: "upgraded" | "downgraded";
  centroid: number;
  uploadedAt?: string;
  employeeName?: string;
}

/**
 * Walk qualifying groups and find candidate calls whose AI score is within
 * `windowScore` of the group's centroid. Skips calls already corrected by
 * this user (via `alreadyCorrectedCallIds`) and calls whose `manualEdits`
 * already includes an entry by this user.
 *
 * Pure function — no I/O. The route handler is responsible for loading
 * corrections and call summaries from storage.
 */
export function findSimilarUncorrectedCalls(params: {
  groups: CorrectionGroup[];
  calls: SimilarCallCandidate[];
  userId: string;
  alreadyCorrectedCallIds: ReadonlySet<string>;
  windowScore?: number;
  perGroupLimit?: number;
  totalCap?: number;
}): SimilarCallSuggestion[] {
  const {
    groups,
    calls,
    userId,
    alreadyCorrectedCallIds,
    windowScore = 0.5,
    perGroupLimit = 5,
    totalCap = 20,
  } = params;

  const suggestions: SimilarCallSuggestion[] = [];

  for (const group of groups) {
    const perGroup: SimilarCallSuggestion[] = [];
    for (const call of calls) {
      if (alreadyCorrectedCallIds.has(call.id)) continue;
      const rawScore = call.analysis?.performanceScore;
      if (rawScore === undefined || rawScore === null || String(rawScore) === "") continue;
      const aiScore = parseFloat(String(rawScore));
      if (!Number.isFinite(aiScore)) continue;

      const callCat = call.callCategory || "general";
      // "general" centroid matches any category; otherwise require exact match.
      if (group.category !== "general" && callCat !== group.category) continue;

      // Score proximity to the group's centroid.
      if (Math.abs(aiScore - group.centroid) > windowScore) continue;

      // Exclude calls already manually edited by this user.
      const edits = Array.isArray(call.analysis?.manualEdits) ? call.analysis!.manualEdits : [];
      const userAlreadyEdited = edits.some(
        (e: unknown) =>
          typeof (e as { editedBy?: unknown })?.editedBy === "string" &&
          (e as { editedBy: string }).editedBy === userId,
      );
      if (userAlreadyEdited) continue;

      perGroup.push({
        callId: call.id,
        aiScore,
        callCategory: call.callCategory ?? undefined,
        direction: group.direction,
        centroid: Math.round(group.centroid * 10) / 10,
        uploadedAt: call.uploadedAt,
        employeeName: call.employee?.name,
      });
      if (perGroup.length >= perGroupLimit) break;
    }
    suggestions.push(...perGroup);
    if (suggestions.length >= totalCap) break;
  }

  return suggestions.slice(0, totalCap);
}
