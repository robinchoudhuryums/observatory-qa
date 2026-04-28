import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { parsePagination } from "./helpers";
import { asyncHandler, AppError } from "../middleware/error-handler";

export function registerFeedbackRoutes(app: Express) {
  // Submit feedback (any authenticated user)
  app.post(
    "/api/feedback",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");

      const { type, context, rating, comment, metadata } = req.body;
      if (!type) throw new AppError(400, "Feedback type is required");

      const feedback = await storage.createFeedback(orgId, {
        orgId,
        userId: req.user!.id,
        type,
        context,
        rating,
        comment,
        metadata: { ...metadata, userAgent: req.headers["user-agent"], page: req.body.page },
      });

      logger.info({ orgId, feedbackId: feedback.id, type }, "User feedback submitted");
      res.json(feedback);
    }),
  );

  // List all feedback (admin only)
  app.get(
    "/api/feedback",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");

      const { type, status } = req.query;
      const { limit, offset } = parsePagination(req.query);
      const feedback = await storage.listFeedback(orgId, {
        type: type as string | undefined,
        status: status as string | undefined,
      });
      // Apply pagination
      const paginated = feedback.slice(offset, offset + limit);
      res.json(paginated);
    }),
  );

  // Get feedback summary/analytics (admin only)
  app.get(
    "/api/feedback/summary",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");

      const allFeedback = await storage.listFeedback(orgId);
      const npsScores = allFeedback.filter((f) => f.type === "nps" && f.rating != null);
      const featureRatings = allFeedback.filter((f) => f.type === "feature_rating" && f.rating != null);

      // NPS calculation: (promoters - detractors) / total * 100
      const promoters = npsScores.filter((f) => (f.rating || 0) >= 9).length;
      const detractors = npsScores.filter((f) => (f.rating || 0) <= 6).length;
      const npsScore = npsScores.length > 0 ? Math.round(((promoters - detractors) / npsScores.length) * 100) : null;

      // Average feature rating
      const avgFeatureRating =
        featureRatings.length > 0
          ? featureRatings.reduce((sum, f) => sum + (f.rating || 0), 0) / featureRatings.length
          : null;

      // Breakdown by type
      const byType: Record<string, number> = {};
      for (const f of allFeedback) {
        byType[f.type] = (byType[f.type] || 0) + 1;
      }

      // Breakdown by context (feature)
      const byContext: Record<string, { count: number; avgRating: number | null }> = {};
      for (const f of allFeedback) {
        const ctx = f.context || "general";
        if (!byContext[ctx]) byContext[ctx] = { count: 0, avgRating: null };
        byContext[ctx].count++;
      }
      for (const ctx of Object.keys(byContext)) {
        const ratings = allFeedback.filter((f) => (f.context || "general") === ctx && f.rating != null);
        byContext[ctx].avgRating =
          ratings.length > 0 ? ratings.reduce((sum, f) => sum + (f.rating || 0), 0) / ratings.length : null;
      }

      res.json({
        totalFeedback: allFeedback.length,
        npsScore,
        npsResponses: npsScores.length,
        avgFeatureRating: avgFeatureRating ? Math.round(avgFeatureRating * 10) / 10 : null,
        byType,
        byContext,
        recentFeedback: allFeedback.slice(0, 10),
      });
    }),
  );

  // Update feedback status / add admin response (admin only)
  app.patch(
    "/api/feedback/:id",
    requireAuth,
    requireRole("admin"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");

      const { status, adminResponse } = req.body;
      const updated = await storage.updateFeedback(orgId, req.params.id, { status, adminResponse });
      if (!updated) throw new AppError(404, "Feedback not found");
      res.json(updated);
    }),
  );
}
