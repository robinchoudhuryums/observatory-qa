import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, injectOrgContext } from "../auth";
import { safeInt } from "./helpers";

export function registerDashboardRoutes(app: Express): void {
  // Dashboard metrics
  app.get("/api/dashboard/metrics", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics(req.orgId!);
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dashboard metrics" });
    }
  });

  // Sentiment distribution
  app.get("/api/dashboard/sentiment", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const distribution = await storage.getSentimentDistribution(req.orgId!);
      res.json(distribution);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment distribution" });
    }
  });

  // Top performers
  app.get("/api/dashboard/performers", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const limit = Math.min(safeInt(req.query.limit, 3), 100);
      const performers = await storage.getTopPerformers(req.orgId!, limit);
      res.json(performers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get top performers" });
    }
  });
}
