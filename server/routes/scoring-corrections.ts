/**
 * Scoring corrections routes.
 *
 * Tier 2E of the CallAnalyzer adaptation plan. Read-side endpoints for the
 * scoring-feedback loop:
 *
 *   GET  /api/scoring-corrections/my              — caller's recent corrections
 *   GET  /api/scoring-corrections/my/stats        — caller's correction stats
 *   GET  /api/scoring-corrections/stats           — org-wide stats (admin)
 *   GET  /api/scoring-corrections/similar-uncorrected — suggest calls to review
 *   GET  /api/scoring-corrections/quality-alerts  — current scoring-quality alerts (admin)
 *
 * All endpoints scoped to req.orgId via injectOrgContext.
 *
 * Capture is at PATCH /api/calls/:id/analysis (see TIER_0_5_PENDING.md
 * for the small wire-up that calls recordScoringCorrection from there).
 */
import type { Express, Request } from "express";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { asyncHandler } from "../middleware/error-handler";
import { getDatabase } from "../db/index";
import {
  getRecentCorrectionsByUser,
  getUserCorrectionStats,
  getCorrectionStats,
  groupCorrectionsByCategoryDirection,
  findSimilarUncorrectedCalls,
  type SimilarCallCandidate,
} from "../services/scoring-feedback";
import { checkScoringQuality } from "../services/scoring-feedback-alerts";
import { listRecentByUser } from "../storage/scoring-corrections";

/** Bound a numeric query param to a [min, max] range with a default. */
function boundedInt(value: unknown, def: number, min: number, max: number): number {
  const n = parseInt(String(value ?? def), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

/** Resolve the canonical user ID from the authenticated request. */
function userIdFrom(req: Request): string | null {
  return req.user?.id ?? null;
}

export function registerScoringCorrectionRoutes(app: Express) {
  // -----------------------------------------------------------------------
  // GET /api/scoring-corrections/my
  // -----------------------------------------------------------------------
  app.get(
    "/api/scoring-corrections/my",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const userId = userIdFrom(req);
      if (!userId) return res.status(401).json({ message: "Authenticated user required" });

      const limit = boundedInt(req.query.limit, 20, 1, 100);
      const corrections = await getRecentCorrectionsByUser(orgId, userId, limit);
      return res.json(corrections);
    }),
  );

  // -----------------------------------------------------------------------
  // GET /api/scoring-corrections/my/stats
  // -----------------------------------------------------------------------
  app.get(
    "/api/scoring-corrections/my/stats",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const userId = userIdFrom(req);
      if (!userId) return res.status(401).json({ message: "Authenticated user required" });

      const sinceDays = boundedInt(req.query.sinceDays, 30, 1, 365);
      const stats = await getUserCorrectionStats(orgId, userId, sinceDays);
      return res.json(stats);
    }),
  );

  // -----------------------------------------------------------------------
  // GET /api/scoring-corrections/stats (admin)
  // -----------------------------------------------------------------------
  app.get(
    "/api/scoring-corrections/stats",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const sinceDaysRaw = req.query.sinceDays;
      const sinceDays = sinceDaysRaw === undefined ? undefined : boundedInt(sinceDaysRaw, 30, 1, 365);
      const stats = await getCorrectionStats(orgId, sinceDays);
      return res.json(stats);
    }),
  );

  // -----------------------------------------------------------------------
  // GET /api/scoring-corrections/similar-uncorrected
  // -----------------------------------------------------------------------
  // For the calling user, find groups of (category, direction) where they've
  // made multiple corrections, then suggest other calls with AI scores in
  // that group's centroid window that they HAVEN'T corrected yet. This is
  // the "find calls the AI is likely to mis-score the same way" feature.
  app.get(
    "/api/scoring-corrections/similar-uncorrected",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const userId = userIdFrom(req);
      if (!userId) return res.status(401).json({ message: "Authenticated user required" });

      const totalCap = boundedInt(req.query.limit, 20, 1, 100);
      const windowScore = (() => {
        const raw = req.query.windowScore;
        const n = parseFloat(String(raw ?? "0.5"));
        if (!Number.isFinite(n)) return 0.5;
        return Math.max(0.1, Math.min(2.0, n));
      })();

      const db = getDatabase();
      if (!db) return res.json([]);

      // 1. Pull this user's recent corrections (up to 100 for grouping).
      const userCorrections = await listRecentByUser(db, orgId, userId, 100);
      if (userCorrections.length < 2) {
        // Not enough data to form a useful group
        return res.json([]);
      }

      // 2. Build (category, direction) groups + centroids.
      const groups = groupCorrectionsByCategoryDirection(
        userCorrections.map((c) => ({
          callCategory: c.callCategory,
          direction: c.direction,
          originalScore: c.originalScore,
        })),
      );
      if (groups.length === 0) return res.json([]);

      // 3. Pull recent completed calls in the org for matching against centroids.
      // Bounded to 500 most-recent — sufficient for typical org volumes; for
      // very high-volume orgs add per-category storage filtering as a follow-up.
      let calls: SimilarCallCandidate[] = [];
      try {
        const summaries = await storage.getCallSummaries(orgId, { status: "completed" });
        calls = summaries.slice(-500).map((c: any) => ({
          id: c.id,
          callCategory: c.callCategory,
          uploadedAt: c.uploadedAt,
          analysis: c.analysis
            ? {
                performanceScore: c.analysis.performanceScore,
                manualEdits: Array.isArray(c.analysis.manualEdits) ? c.analysis.manualEdits : [],
              }
            : undefined,
          employee: c.employee ? { name: c.employee.name } : undefined,
        }));
      } catch (err) {
        logger.warn({ err, orgId }, "Could not load call candidates for similar-uncorrected");
      }

      const alreadyCorrectedCallIds = new Set(userCorrections.map((c) => c.callId));

      const suggestions = findSimilarUncorrectedCalls({
        groups,
        calls,
        userId,
        alreadyCorrectedCallIds,
        windowScore,
        perGroupLimit: 5,
        totalCap,
      });

      return res.json(suggestions);
    }),
  );

  // -----------------------------------------------------------------------
  // GET /api/scoring-corrections/quality-alerts (admin)
  // -----------------------------------------------------------------------
  // Runs the scoring-quality check on demand for the org and returns any
  // current alerts. Same logic as the daily scheduled run, but available
  // for ad-hoc admin inspection.
  app.get(
    "/api/scoring-corrections/quality-alerts",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const alerts = await checkScoringQuality(orgId);
      return res.json(alerts);
    }),
  );
}
