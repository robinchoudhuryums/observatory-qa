import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { validateUUIDParam } from "./helpers";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { logPhiAccess, auditContext } from "../services/audit-log";
import type { CalibrationEvaluation } from "@shared/schema";
import { asyncHandler } from "../middleware/error-handler";

// ==================== STATISTICAL HELPERS ====================

/** Compute standard deviation of scores (sample std dev with Bessel's correction) */
function computeStdDev(scores: number[]): number {
  if (scores.length < 2) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  // Use (n-1) denominator (Bessel's correction) for unbiased sample variance,
  // consistent with computeICC() which also uses (k-1).
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / (scores.length - 1);
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

/**
 * Compute Krippendorff's alpha for ordinal/interval data.
 * Simplified for single-item rating: measures inter-rater reliability.
 * alpha = 1 - (Do / De) where Do = observed disagreement, De = expected disagreement.
 * Returns value from -1 to 1 (1 = perfect, 0 = chance, <0 = worse than chance).
 */
function computeKrippendorffAlpha(
  evaluations: Array<{ evaluatorId: string; performanceScore: number }>,
): number | null {
  if (evaluations.length < 2) return null;

  const scores = evaluations.map((e) => e.performanceScore);
  const n = scores.length; // number of raters/ratings

  // Observed disagreement: average squared difference between all pairs
  let observedDisagreement = 0;
  let pairCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      observedDisagreement += Math.pow(scores[i] - scores[j], 2);
      pairCount++;
    }
  }
  if (pairCount === 0) return null;
  observedDisagreement /= pairCount;

  // Expected disagreement: variance of all values
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const expectedDisagreement = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / (n - 1);

  if (expectedDisagreement === 0) return 1; // Perfect agreement
  return Math.round((1 - observedDisagreement / expectedDisagreement) * 1000) / 1000;
}

/**
 * Compute Intraclass Correlation Coefficient (ICC) — two-way mixed, absolute agreement.
 * Measures consistency of ratings across evaluators.
 * Returns value from 0 to 1 (1 = perfect agreement).
 */
/**
 * Compute Intraclass Correlation Coefficient for a single item (one call)
 * rated by k raters. Uses a variance-based agreement measure:
 *
 *   ICC = 1 - (observed_variance / max_possible_variance)
 *
 * where max_possible_variance is based on the 0-10 score range.
 * Returns 0-1 (1 = perfect agreement, 0 = maximum disagreement).
 *
 * For single-item ICC, traditional MSb/MSw formulas don't apply (one subject),
 * so we use normalized variance as a practical agreement measure.
 */
function computeICC(evaluations: Array<{ evaluatorId: string; performanceScore: number }>): number | null {
  if (evaluations.length < 2) return null;

  const scores = evaluations.map((e) => e.performanceScore);
  const k = scores.length;
  const grandMean = scores.reduce((a, b) => a + b, 0) / k;

  // Sample variance (Bessel's correction: k-1 denominator for unbiased estimate)
  const sampleVariance = scores.reduce((sum, s) => sum + Math.pow(s - grandMean, 2), 0) / (k - 1);

  if (sampleVariance === 0) return 1; // Perfect agreement

  // Max possible variance on 0-10 scale: scores at extremes (0 and 10) around midpoint 5
  // Var = n * (10-5)^2 / (n-1) ≈ 25 for large n. Use 25 as theoretical max.
  const maxVariance = 25;
  const icc = Math.max(0, 1 - sampleVariance / maxVariance);
  return Math.round(icc * 1000) / 1000;
}

export function registerCalibrationRoutes(app: Express) {
  // Create a calibration session (manager+ only)
  app.post("/api/calibration", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { title, callId, evaluatorIds, scheduledAt, blindMode } = req.body;
      if (!title || !callId || !evaluatorIds || !Array.isArray(evaluatorIds) || evaluatorIds.length === 0) {
        return res.status(400).json({ message: "title, callId, and evaluatorIds (non-empty array) are required" });
      }
      if (new Set(evaluatorIds).size !== evaluatorIds.length) {
        return res.status(400).json({ message: "evaluatorIds must be unique" });
      }

      // Verify the call exists
      const call = await storage.getCall(orgId, callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      const session = await storage.createCalibrationSession(orgId, {
        orgId,
        title,
        callId,
        facilitatorId: req.user!.id,
        evaluatorIds,
        scheduledAt,
        status: "scheduled",
        blindMode: blindMode === true,
      });

      logger.info(
        { orgId, sessionId: session.id, evaluatorCount: evaluatorIds.length, blindMode: !!blindMode },
        "Calibration session created",
      );
      res.json(session);
    }));

  // List calibration sessions
  app.get("/api/calibration", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { status } = req.query;
      const sessions = await storage.listCalibrationSessions(orgId, {
        status: status as string | undefined,
      });

      // Enrich with call details and evaluation stats
      const enriched = await Promise.all(
        sessions.map(async (session) => {
          const call = await storage.getCall(orgId, session.callId);
          const evaluations = await storage.getCalibrationEvaluations(orgId, session.id);

          // Calculate score variance
          let scoreVariance: number | undefined;
          if (evaluations.length >= 2) {
            const scores = evaluations.map((e) => e.performanceScore);
            const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
            const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
            scoreVariance = Math.round(Math.sqrt(variance) * 100) / 100;
          }

          return {
            ...session,
            callFileName: call?.fileName,
            callCategory: call?.callCategory,
            evaluationCount: evaluations.length,
            expectedEvaluations: session.evaluatorIds.length,
            scoreVariance,
            avgScore:
              evaluations.length > 0
                ? Math.round((evaluations.reduce((s, e) => s + e.performanceScore, 0) / evaluations.length) * 10) / 10
                : null,
          };
        }),
      );

      res.json(enriched);
    }));

  // Get a calibration session with all evaluations
  app.get(
    "/api/calibration/:id",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateUUIDParam(),
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        const session = await storage.getCalibrationSession(orgId, req.params.id);
        if (!session) return res.status(404).json({ message: "Calibration session not found" });

        const evaluations = await storage.getCalibrationEvaluations(orgId, session.id);
        const call = await storage.getCall(orgId, session.callId);
        const analysis = await storage.getCallAnalysis(orgId, session.callId);

        // Enrich evaluator names
        const users = await storage.listUsersByOrg(orgId);
        const userMap = new Map(users.map((u) => [u.id, u]));

        // Blind mode enforcement: hide other evaluators' scores until session is completed
        const isBlind = session.blindMode && session.status !== "completed";
        const userId = req.user!.id;

        let visibleEvaluations = evaluations;
        if (isBlind) {
          // Only show the current user's own evaluation
          visibleEvaluations = evaluations.filter((e) => e.evaluatorId === userId);
        }

        const enrichedEvaluations = visibleEvaluations.map((e) => ({
          ...e,
          evaluatorName: userMap.get(e.evaluatorId)?.name || "Unknown",
        }));

        // Calculate variance and IRR metrics (only meaningful with 2+ evaluations)
        const scores = evaluations.map((e) => e.performanceScore);
        const scoreVariance = scores.length >= 2 ? computeStdDev(scores) : undefined;
        const krippendorffAlpha = computeKrippendorffAlpha(evaluations);
        const icc = computeICC(evaluations);

        // In blind mode, hide aggregate stats until completed
        const showStats = !isBlind;

        res.json({
          ...session,
          evaluations: enrichedEvaluations,
          scoreVariance: showStats ? scoreVariance : undefined,
          call,
          aiScore: analysis?.performanceScore ? parseFloat(String(analysis.performanceScore)) : null,
          facilitatorName: userMap.get(session.facilitatorId)?.name || "Unknown",
          // Evaluator submission status (visible even in blind mode)
          evaluationCount: evaluations.length,
          expectedEvaluations: session.evaluatorIds.length,
          // Statistical reliability metrics (hidden in blind mode)
          krippendorffAlpha: showStats ? krippendorffAlpha : undefined,
          icc: showStats ? icc : undefined,
          isBlindActive: isBlind,
        });
    }),
  );

  // Submit an evaluation for a calibration session
  app.post("/api/calibration/:id/evaluate", requireAuth, injectOrgContext, validateUUIDParam(), asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const session = await storage.getCalibrationSession(orgId, req.params.id);
      if (!session) return res.status(404).json({ message: "Calibration session not found" });

      // Verify user is an evaluator
      if (!session.evaluatorIds.includes(req.user!.id) && session.facilitatorId !== req.user!.id) {
        return res.status(403).json({ message: "You are not an evaluator for this session" });
      }

      const { performanceScore, subScores, notes } = req.body;
      if (performanceScore === undefined || performanceScore < 0 || performanceScore > 10) {
        return res.status(400).json({ message: "performanceScore (0-10) is required" });
      }

      // Check for existing evaluation
      const existing = await storage.getCalibrationEvaluations(orgId, session.id);
      const myEval = existing.find((e) => e.evaluatorId === req.user!.id);

      if (myEval) {
        // Update existing evaluation
        const updated = await storage.updateCalibrationEvaluation(orgId, myEval.id, {
          performanceScore,
          subScores,
          notes,
        });
        res.json(updated);
      } else {
        const evaluation = await storage.createCalibrationEvaluation(orgId, {
          orgId,
          sessionId: session.id,
          evaluatorId: req.user!.id,
          performanceScore,
          subScores,
          notes,
        });

        // Auto-transition to in_progress when first evaluation comes in
        if (session.status === "scheduled") {
          await storage.updateCalibrationSession(orgId, session.id, { status: "in_progress" });
        }

        res.json(evaluation);
      }

      logger.info({ orgId, sessionId: session.id, evaluatorId: req.user!.id }, "Calibration evaluation submitted");
    }));

  // Complete calibration session (set consensus score and notes)
  app.post(
    "/api/calibration/:id/complete",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateUUIDParam(),
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        const session = await storage.getCalibrationSession(orgId, req.params.id);
        if (!session) return res.status(404).json({ message: "Calibration session not found" });

        const { targetScore, consensusNotes } = req.body;

        if (targetScore !== undefined && (typeof targetScore !== "number" || targetScore < 0 || targetScore > 10)) {
          return res.status(400).json({ message: "targetScore must be a number between 0 and 10" });
        }

        const updated = await storage.updateCalibrationSession(orgId, session.id, {
          status: "completed",
          targetScore,
          consensusNotes,
          completedAt: new Date().toISOString(),
        });

        logger.info({ orgId, sessionId: session.id, targetScore }, "Calibration session completed");
        res.json(updated);
      }),
  );

  // Delete calibration session (manager+)
  app.delete(
    "/api/calibration/:id",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateUUIDParam(),
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        await storage.deleteCalibrationSession(orgId, req.params.id);
        res.json({ success: true });
      }),
  );

  // Get calibration analytics (score variance trends, evaluator alignment, IRR metrics)
  app.get("/api/calibration/analytics", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const sessions = await storage.listCalibrationSessions(orgId, { status: "completed" });

      const analytics: {
        totalSessions: number;
        avgVariance: number;
        avgKrippendorffAlpha: number | null;
        avgICC: number | null;
        varianceTrend: Array<{ date: string; variance: number; krippendorffAlpha: number | null }>;
        evaluatorStats: Record<
          string,
          {
            avgDeviation: number;
            sessionsParticipated: number;
            certificationStatus: "certified" | "probationary" | "flagged" | "needs_calibration";
            consistencyScore: number;
          }
        >;
      } = {
        totalSessions: sessions.length,
        avgVariance: 0,
        avgKrippendorffAlpha: null,
        avgICC: null,
        varianceTrend: [],
        evaluatorStats: {},
      };

      const variances: number[] = [];
      const alphas: number[] = [];
      const iccs: number[] = [];

      for (const session of sessions) {
        const evaluations = await storage.getCalibrationEvaluations(orgId, session.id);
        if (evaluations.length < 2) continue;

        const scores = evaluations.map((e) => e.performanceScore);
        const variance = computeStdDev(scores);
        variances.push(variance);

        const alpha = computeKrippendorffAlpha(evaluations);
        if (alpha !== null) alphas.push(alpha);

        const iccVal = computeICC(evaluations);
        if (iccVal !== null) iccs.push(iccVal);

        analytics.varianceTrend.push({
          date: session.completedAt || session.createdAt || "",
          variance,
          krippendorffAlpha: alpha,
        });

        // Per-evaluator stats
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const target = session.targetScore ?? mean;
        for (const ev of evaluations) {
          if (!analytics.evaluatorStats[ev.evaluatorId]) {
            analytics.evaluatorStats[ev.evaluatorId] = {
              avgDeviation: 0,
              sessionsParticipated: 0,
              certificationStatus: "needs_calibration",
              consistencyScore: 0,
            };
          }
          const stat = analytics.evaluatorStats[ev.evaluatorId];
          const deviation = Math.abs(ev.performanceScore - target);
          stat.avgDeviation =
            (stat.avgDeviation * stat.sessionsParticipated + deviation) / (stat.sessionsParticipated + 1);
          stat.sessionsParticipated++;
        }
      }

      analytics.avgVariance =
        variances.length > 0 ? Math.round((variances.reduce((a, b) => a + b, 0) / variances.length) * 100) / 100 : 0;
      analytics.avgKrippendorffAlpha =
        alphas.length > 0 ? Math.round((alphas.reduce((a, b) => a + b, 0) / alphas.length) * 1000) / 1000 : null;
      analytics.avgICC =
        iccs.length > 0 ? Math.round((iccs.reduce((a, b) => a + b, 0) / iccs.length) * 1000) / 1000 : null;

      // Compute certification status and consistency scores
      for (const [, stat] of Object.entries(analytics.evaluatorStats)) {
        // Consistency = 1 - (avgDeviation / 5), clamped to [0, 1]
        stat.consistencyScore = Math.round(Math.max(0, Math.min(1, 1 - stat.avgDeviation / 5)) * 100) / 100;
        // Certification: certified if 5+ sessions and avgDeviation < 1.0
        // Probationary if 3-4 sessions or avgDeviation 1.0-2.0
        // Needs calibration otherwise
        if (stat.sessionsParticipated >= 5 && stat.avgDeviation < 1.0) {
          stat.certificationStatus = "certified";
        } else if (stat.sessionsParticipated >= 3 && stat.avgDeviation < 2.0) {
          stat.certificationStatus = "probationary";
        } else if (stat.sessionsParticipated >= 3 && stat.avgDeviation >= 2.0) {
          stat.certificationStatus = "flagged";
        } else {
          stat.certificationStatus = "needs_calibration";
        }
        stat.avgDeviation = Math.round(stat.avgDeviation * 100) / 100;
      }

      // Enrich evaluator names
      const users = await storage.listUsersByOrg(orgId);
      const userMap = new Map(users.map((u) => [u.id, u]));

      const enrichedEvaluatorStats: Record<
        string,
        (typeof analytics.evaluatorStats)[string] & { evaluatorName: string }
      > = {};
      for (const [id, stat] of Object.entries(analytics.evaluatorStats)) {
        enrichedEvaluatorStats[id] = {
          ...stat,
          evaluatorName: userMap.get(id)?.name || "Unknown",
        };
      }

      res.json({
        ...analytics,
        evaluatorStats: enrichedEvaluatorStats,
      });
    }));

  // Suggest calls for calibration (automated call selection)
  app.get("/api/calibration/suggest-calls", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const limit = Math.min(parseInt(req.query.limit as string) || 10, 25);

      // Get completed calls with analyses
      const calls = await storage.getAllCalls(orgId);
      const completedCalls = calls.filter((c) => c.status === "completed");

      if (completedCalls.length === 0) {
        return res.json({ suggestions: [], criteria: [] });
      }

      // Get existing calibration sessions to avoid re-calibrating the same calls
      const existingSessions = await storage.listCalibrationSessions(orgId);
      const calibratedCallIds = new Set(existingSessions.map((s) => s.callId));

      // Score each call for calibration value
      const scoredCalls: Array<{
        callId: string;
        fileName: string | null;
        callCategory: string | null;
        uploadedAt: string | null;
        score: number;
        reasons: string[];
        performanceScore: number | null;
      }> = [];

      for (const call of completedCalls) {
        if (calibratedCallIds.has(call.id)) continue;

        const reasons: string[] = [];
        let calibrationValue = 0;

        // Recency boost: calls from the last 14 days get higher priority
        const uploadedAt = call.uploadedAt ? new Date(call.uploadedAt).getTime() : 0;
        const daysSinceUpload = (Date.now() - uploadedAt) / (1000 * 60 * 60 * 24);
        if (daysSinceUpload <= 14) {
          calibrationValue += 3;
          reasons.push("Recent call (last 14 days)");
        } else if (daysSinceUpload <= 30) {
          calibrationValue += 1;
          reasons.push("Relatively recent (last 30 days)");
        }

        // Get AI analysis to check for borderline scores
        const analysis = await storage.getCallAnalysis(orgId, call.id);
        const aiScore = analysis?.performanceScore ? parseFloat(String(analysis.performanceScore)) : null;

        if (aiScore !== null) {
          // Borderline scores (4-6) are most valuable for calibration
          if (aiScore >= 4 && aiScore <= 6) {
            calibrationValue += 5;
            reasons.push(`Borderline AI score (${aiScore.toFixed(1)})`);
          }
          // Disagreement indicators: flagged calls or disputed calls
          else if (aiScore <= 3) {
            calibrationValue += 3;
            reasons.push(`Low AI score (${aiScore.toFixed(1)}) — good for baseline alignment`);
          } else if (aiScore >= 8) {
            calibrationValue += 2;
            reasons.push(`High AI score (${aiScore.toFixed(1)}) — verify exceptional rating`);
          }

          // Check for manual edits (indicates prior disagreement)
          if (analysis?.manualEdits) {
            calibrationValue += 4;
            reasons.push("Has manual score edits (prior disagreement)");
          }
        }

        // Flagged calls have higher calibration value
        const flags = (analysis?.flags as string[]) || [];
        if (flags.includes("low_score") || flags.includes("agent_misconduct")) {
          calibrationValue += 3;
          reasons.push("Flagged call — alignment on standards needed");
        }

        if (calibrationValue > 0) {
          scoredCalls.push({
            callId: call.id,
            fileName: call.fileName || null,
            callCategory: call.callCategory || null,
            uploadedAt: call.uploadedAt || null,
            score: calibrationValue,
            reasons,
            performanceScore: aiScore,
          });
        }
      }

      // Sort by calibration value (descending) and take top N
      scoredCalls.sort((a, b) => b.score - a.score);
      const suggestions = scoredCalls.slice(0, limit);

      res.json({
        suggestions,
        criteria: [
          "Borderline AI scores (4.0-6.0) — most ambiguous, highest calibration value",
          "Manual score edits — prior disagreement detected",
          "Flagged calls — alignment on evaluation standards",
          "Recent calls — reflects current team performance",
          "Low/high outlier scores — verify extreme ratings",
        ],
      });
    }));

  // Export calibration report as CSV
  app.get(
    "/api/calibration/:id/export",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateUUIDParam(),
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        const session = await storage.getCalibrationSession(orgId, req.params.id);
        if (!session) return res.status(404).json({ message: "Calibration session not found" });

        const evaluations = await storage.getCalibrationEvaluations(orgId, session.id);
        const call = await storage.getCall(orgId, session.callId);
        const analysis = await storage.getCallAnalysis(orgId, session.callId);
        const users = await storage.listUsersByOrg(orgId);
        const userMap = new Map(users.map((u) => [u.id, u]));

        const scores = evaluations.map((e) => e.performanceScore);
        const mean = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        const stdDev = computeStdDev(scores);
        const alpha = computeKrippendorffAlpha(evaluations);
        const iccVal = computeICC(evaluations);
        const aiScore = analysis?.performanceScore ? parseFloat(String(analysis.performanceScore)) : null;

        // Build CSV
        const lines: string[] = [];
        lines.push("CALIBRATION SESSION REPORT");
        lines.push("");
        lines.push(`Title,"${(session.title || "").replace(/"/g, '""')}"`);
        lines.push(`Session ID,${session.id}`);
        lines.push(`Status,${session.status}`);
        lines.push(`Call,"${(call?.fileName || session.callId).replace(/"/g, '""')}"`);
        lines.push(`Call Category,${call?.callCategory || "N/A"}`);
        lines.push(`Facilitator,"${(userMap.get(session.facilitatorId)?.name || "Unknown").replace(/"/g, '""')}"`);
        lines.push(`Created,${session.createdAt || ""}`);
        lines.push(`Completed,${session.completedAt || "N/A"}`);
        lines.push("");
        lines.push("SCORES SUMMARY");
        lines.push(`AI Score,${aiScore !== null ? aiScore.toFixed(1) : "N/A"}`);
        lines.push(`Consensus Score,${session.targetScore !== undefined ? session.targetScore.toFixed(1) : "N/A"}`);
        lines.push(`Average Evaluator Score,${mean.toFixed(2)}`);
        lines.push(`Standard Deviation,${stdDev.toFixed(2)}`);
        lines.push(`Krippendorff Alpha,${alpha !== null ? alpha.toFixed(3) : "N/A"}`);
        lines.push(`ICC,${iccVal !== null ? iccVal.toFixed(3) : "N/A"}`);
        lines.push(`Evaluators,${evaluations.length} of ${session.evaluatorIds.length}`);
        lines.push(`Blind Mode,${session.blindMode ? "Yes" : "No"}`);
        lines.push("");
        lines.push("EVALUATOR BREAKDOWN");
        lines.push(
          "Evaluator,Score,Deviation from Consensus,Compliance,Customer Experience,Communication,Resolution,Notes",
        );

        for (const ev of evaluations) {
          const name = (userMap.get(ev.evaluatorId)?.name || "Unknown").replace(/"/g, '""');
          const target = session.targetScore ?? mean;
          const deviation = (ev.performanceScore - target).toFixed(2);
          const sub = ev.subScores || {};
          const notes = (ev.notes || "").replace(/"/g, '""').replace(/\n/g, " ");
          lines.push(
            `"${name}",${ev.performanceScore.toFixed(1)},${deviation},${sub.compliance ?? ""},${sub.customerExperience ?? ""},${sub.communication ?? ""},${sub.resolution ?? ""},"${notes}"`,
          );
        }

        if (session.consensusNotes) {
          lines.push("");
          lines.push("CONSENSUS NOTES");
          lines.push(`"${session.consensusNotes.replace(/"/g, '""')}"`);
        }

        const csv = lines.join("\n");
        const safeTitle = (session.title || "calibration").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 50);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="calibration-report-${safeTitle}.csv"`);
        res.send(csv);
      }),
  );

  // Get evaluator certification status for all evaluators in the org
  app.get(
    "/api/calibration/certifications",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        const sessions = await storage.listCalibrationSessions(orgId, { status: "completed" });
        const users = await storage.listUsersByOrg(orgId);
        const userMap = new Map(users.map((u) => [u.id, u]));

        // Aggregate per-evaluator stats
        const stats: Record<
          string,
          {
            evaluatorId: string;
            evaluatorName: string;
            sessionsParticipated: number;
            avgDeviation: number;
            deviations: number[];
            lastSessionDate: string | null;
          }
        > = {};

        for (const session of sessions) {
          const evaluations = await storage.getCalibrationEvaluations(orgId, session.id);
          if (evaluations.length < 2) continue;

          const scores = evaluations.map((e) => e.performanceScore);
          const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
          const target = session.targetScore ?? mean;

          for (const ev of evaluations) {
            if (!stats[ev.evaluatorId]) {
              stats[ev.evaluatorId] = {
                evaluatorId: ev.evaluatorId,
                evaluatorName: userMap.get(ev.evaluatorId)?.name || "Unknown",
                sessionsParticipated: 0,
                avgDeviation: 0,
                deviations: [],
                lastSessionDate: null,
              };
            }
            const s = stats[ev.evaluatorId];
            const deviation = Math.abs(ev.performanceScore - target);
            s.deviations.push(deviation);
            s.sessionsParticipated++;
            s.avgDeviation = s.deviations.reduce((a, b) => a + b, 0) / s.deviations.length;
            const sessionDate = session.completedAt || session.createdAt || null;
            if (sessionDate && (!s.lastSessionDate || sessionDate > s.lastSessionDate)) {
              s.lastSessionDate = sessionDate;
            }
          }
        }

        // Compute certification for each evaluator
        const certifications = Object.values(stats).map((s) => {
          const consistencyScore = Math.round(Math.max(0, Math.min(1, 1 - s.avgDeviation / 5)) * 100) / 100;

          // Recent deviation trend (last 3 vs prior)
          let trendDirection: "improving" | "declining" | "stable" = "stable";
          if (s.deviations.length >= 6) {
            const recent = s.deviations.slice(-3);
            const prior = s.deviations.slice(-6, -3);
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;
            if (recentAvg < priorAvg - 0.3) trendDirection = "improving";
            else if (recentAvg > priorAvg + 0.3) trendDirection = "declining";
          }

          let status: "certified" | "probationary" | "needs_calibration" | "flagged";
          if (s.sessionsParticipated >= 5 && s.avgDeviation < 1.0) {
            status = "certified";
          } else if (s.sessionsParticipated >= 3 && s.avgDeviation < 2.0) {
            status = "probationary";
          } else if (s.sessionsParticipated >= 3 && s.avgDeviation >= 2.0) {
            status = "flagged";
          } else {
            status = "needs_calibration";
          }

          return {
            evaluatorId: s.evaluatorId,
            evaluatorName: s.evaluatorName,
            certificationStatus: status,
            consistencyScore,
            sessionsParticipated: s.sessionsParticipated,
            avgDeviation: Math.round(s.avgDeviation * 100) / 100,
            trendDirection,
            lastSessionDate: s.lastSessionDate,
          };
        });

        // Sort: flagged first, then needs_calibration, probationary, certified
        const statusOrder = { flagged: 0, needs_calibration: 1, probationary: 2, certified: 3 };
        certifications.sort((a, b) => statusOrder[a.certificationStatus] - statusOrder[b.certificationStatus]);

        res.json(certifications);
      }),
  );

  /**
   * QA Audit Packet — comprehensive multi-session report for regulatory/compliance audits.
   *
   * Aggregates all completed calibration sessions in a date range (default: last 90 days),
   * computes org-wide IRR metrics, evaluator certification summary, and consensus deviation trends.
   * Output is a structured JSON document suitable for rendering as a PDF or attaching to audits.
   *
   * Query params:
   *   startDate, endDate — ISO date strings (optional; default: last 90 days)
   *   format — "json" (default) or "csv" for flat export
   */
  app.get(
    "/api/calibration/audit-packet",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const now = new Date();
      const defaultStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const startDate = typeof req.query.startDate === "string" ? new Date(req.query.startDate) : defaultStart;
      const endDate = typeof req.query.endDate === "string" ? new Date(req.query.endDate) : now;
      const format = req.query.format === "csv" ? "csv" : "json";

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ message: "Invalid startDate or endDate" });
      }
      if (endDate < startDate) {
        return res.status(400).json({ message: "endDate must be after startDate" });
      }

      const org = await storage.getOrganization(orgId);
      const users = await storage.listUsersByOrg(orgId);
      const userMap = new Map(users.map((u) => [u.id, u]));

      const allSessions = await storage.listCalibrationSessions(orgId, { status: "completed" });
      // Filter to date range
      const sessionsInRange = allSessions.filter((s) => {
        const ts = s.completedAt || s.createdAt;
        if (!ts) return false;
        const d = new Date(ts);
        return d >= startDate && d <= endDate;
      });

      // Collect evaluations for every session in parallel for audit summary
      const sessionDetails: Array<{
        session: typeof sessionsInRange[number];
        evaluations: CalibrationEvaluation[];
        stdDev: number;
        krippendorff: number | null;
        icc: number | null;
        meanScore: number;
        aiScore: number | null;
        consensusDeviation: number | null;
      }> = [];

      for (const session of sessionsInRange) {
        const evaluations = await storage.getCalibrationEvaluations(orgId, session.id);
        const scores = evaluations.map((e) => e.performanceScore);
        const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        const analysis = await storage.getCallAnalysis(orgId, session.callId);
        const aiScore = analysis?.performanceScore ? parseFloat(String(analysis.performanceScore)) : null;
        const consensusDeviation =
          session.targetScore !== undefined && session.targetScore !== null
            ? Math.round(Math.abs(meanScore - session.targetScore) * 100) / 100
            : null;
        sessionDetails.push({
          session,
          evaluations,
          stdDev: computeStdDev(scores),
          krippendorff: computeKrippendorffAlpha(evaluations),
          icc: computeICC(evaluations),
          meanScore: Math.round(meanScore * 100) / 100,
          aiScore,
          consensusDeviation,
        });
      }

      // Org-wide IRR: average of per-session Krippendorff alpha and ICC (ignoring nulls)
      const alphas = sessionDetails.map((d) => d.krippendorff).filter((a): a is number => a !== null);
      const iccs = sessionDetails.map((d) => d.icc).filter((a): a is number => a !== null);
      const orgAlpha =
        alphas.length > 0 ? Math.round((alphas.reduce((a, b) => a + b, 0) / alphas.length) * 1000) / 1000 : null;
      const orgIcc =
        iccs.length > 0 ? Math.round((iccs.reduce((a, b) => a + b, 0) / iccs.length) * 1000) / 1000 : null;

      // Aggregate evaluator certification stats across all sessions in range
      const evaluatorStats: Record<
        string,
        {
          evaluatorId: string;
          evaluatorName: string;
          sessionsParticipated: number;
          deviations: number[];
        }
      > = {};
      for (const d of sessionDetails) {
        const target = d.session.targetScore ?? d.meanScore;
        for (const ev of d.evaluations) {
          if (!evaluatorStats[ev.evaluatorId]) {
            evaluatorStats[ev.evaluatorId] = {
              evaluatorId: ev.evaluatorId,
              evaluatorName: userMap.get(ev.evaluatorId)?.name || "Unknown",
              sessionsParticipated: 0,
              deviations: [],
            };
          }
          const s = evaluatorStats[ev.evaluatorId]!;
          s.sessionsParticipated++;
          s.deviations.push(Math.abs(ev.performanceScore - target));
        }
      }
      const evaluatorSummary = Object.values(evaluatorStats).map((s) => {
        const avgDeviation = s.deviations.reduce((a, b) => a + b, 0) / (s.deviations.length || 1);
        let certificationStatus: "certified" | "probationary" | "needs_calibration" | "flagged";
        if (s.sessionsParticipated >= 5 && avgDeviation < 1.0) certificationStatus = "certified";
        else if (s.sessionsParticipated >= 3 && avgDeviation < 2.0) certificationStatus = "probationary";
        else if (s.sessionsParticipated >= 3 && avgDeviation >= 2.0) certificationStatus = "flagged";
        else certificationStatus = "needs_calibration";
        return {
          evaluatorId: s.evaluatorId,
          evaluatorName: s.evaluatorName,
          sessionsParticipated: s.sessionsParticipated,
          avgDeviation: Math.round(avgDeviation * 100) / 100,
          certificationStatus,
        };
      });
      evaluatorSummary.sort((a, b) => b.sessionsParticipated - a.sessionsParticipated);

      const certifiedCount = evaluatorSummary.filter((e) => e.certificationStatus === "certified").length;
      const flaggedCount = evaluatorSummary.filter((e) => e.certificationStatus === "flagged").length;

      // Log packet generation to HIPAA audit trail — regulators want proof of QA activity
      logPhiAccess({
        ...auditContext(req),
        event: "calibration_audit_packet_generated",
        resourceType: "calibration_audit_packet",
        detail: `Packet generated for ${sessionDetails.length} session(s) between ${startDate.toISOString().slice(0, 10)} and ${endDate.toISOString().slice(0, 10)}`,
      });

      const packet = {
        packetId: `qa-audit-${orgId}-${Date.now()}`,
        generatedAt: new Date().toISOString(),
        generatedBy: req.user?.name || req.user?.username || "unknown",
        organization: {
          id: orgId,
          name: org?.name || "Unknown",
          slug: org?.slug || "",
        },
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        summary: {
          totalCompletedSessions: sessionDetails.length,
          totalEvaluators: evaluatorSummary.length,
          certifiedEvaluators: certifiedCount,
          flaggedEvaluators: flaggedCount,
          orgKrippendorffAlpha: orgAlpha,
          orgIcc: orgIcc,
          alphaInterpretation:
            orgAlpha === null
              ? "Insufficient data"
              : orgAlpha >= 0.8
                ? "High agreement — QA process is well-calibrated"
                : orgAlpha >= 0.67
                  ? "Acceptable agreement — tentative conclusions can be drawn"
                  : "Low agreement — QA process requires recalibration",
        },
        evaluators: evaluatorSummary,
        sessions: sessionDetails.map((d) => ({
          sessionId: d.session.id,
          title: d.session.title,
          callId: d.session.callId,
          completedAt: d.session.completedAt || d.session.createdAt,
          facilitator: userMap.get(d.session.facilitatorId)?.name || "Unknown",
          aiScore: d.aiScore,
          consensusScore: d.session.targetScore ?? null,
          meanEvaluatorScore: d.meanScore,
          standardDeviation: d.stdDev,
          krippendorffAlpha: d.krippendorff,
          icc: d.icc,
          consensusDeviation: d.consensusDeviation,
          evaluatorCount: d.evaluations.length,
          blindMode: d.session.blindMode || false,
        })),
      };

      if (format === "csv") {
        // Flat CSV for import into Excel/audit tooling
        const lines: string[] = [];
        lines.push("QA CALIBRATION AUDIT PACKET");
        lines.push(`Packet ID,${packet.packetId}`);
        lines.push(`Generated,${packet.generatedAt}`);
        lines.push(`Generated By,"${packet.generatedBy.replace(/"/g, '""')}"`);
        lines.push(`Organization,"${packet.organization.name.replace(/"/g, '""')}"`);
        lines.push(`Period Start,${packet.period.startDate}`);
        lines.push(`Period End,${packet.period.endDate}`);
        lines.push("");
        lines.push("ORG-WIDE SUMMARY");
        lines.push(`Total Completed Sessions,${packet.summary.totalCompletedSessions}`);
        lines.push(`Total Evaluators,${packet.summary.totalEvaluators}`);
        lines.push(`Certified Evaluators,${packet.summary.certifiedEvaluators}`);
        lines.push(`Flagged Evaluators,${packet.summary.flaggedEvaluators}`);
        lines.push(`Org Krippendorff Alpha,${orgAlpha !== null ? orgAlpha.toFixed(3) : "N/A"}`);
        lines.push(`Org ICC,${orgIcc !== null ? orgIcc.toFixed(3) : "N/A"}`);
        lines.push(`Interpretation,"${packet.summary.alphaInterpretation.replace(/"/g, '""')}"`);
        lines.push("");
        lines.push("EVALUATOR SUMMARY");
        lines.push("Evaluator,Sessions,Avg Deviation,Certification Status");
        for (const e of evaluatorSummary) {
          lines.push(
            `"${e.evaluatorName.replace(/"/g, '""')}",${e.sessionsParticipated},${e.avgDeviation.toFixed(2)},${e.certificationStatus}`,
          );
        }
        lines.push("");
        lines.push("SESSIONS");
        lines.push(
          "Session ID,Title,Completed,Facilitator,AI Score,Consensus Score,Mean,StdDev,Alpha,ICC,Evaluators,Blind",
        );
        for (const s of packet.sessions) {
          const title = (s.title || "").replace(/"/g, '""');
          const fac = (s.facilitator || "Unknown").replace(/"/g, '""');
          lines.push(
            `${s.sessionId},"${title}",${s.completedAt || ""},"${fac}",${s.aiScore ?? ""},${s.consensusScore ?? ""},${s.meanEvaluatorScore},${s.standardDeviation},${s.krippendorffAlpha ?? ""},${s.icc ?? ""},${s.evaluatorCount},${s.blindMode ? "Yes" : "No"}`,
          );
        }
        const csv = lines.join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${packet.packetId}.csv"`);
        return res.send(csv);
      }

      res.json(packet);
    }),
  );
}
