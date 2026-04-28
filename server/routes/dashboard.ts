import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, injectOrgContext } from "../auth";
import { safeInt } from "./helpers";
import { getRedis } from "../services/redis";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { asyncHandler } from "../middleware/error-handler";

// Re-export for any remaining consumers that import from routes/dashboard
export { invalidateDashboardCache } from "../services/dashboard-cache";

const DASHBOARD_CACHE_TTL = 300; // 5 minutes — dashboard data changes infrequently

/** Cache-through helper: returns cached JSON if available, otherwise calls fn and caches result */
async function withCache<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch {
      /* Redis unavailable — fall through */
    }
  }

  const result = await fn();

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(result), "EX", ttlSeconds);
    } catch {
      /* Redis unavailable — skip caching */
    }
  }

  return result;
}

export function registerDashboardRoutes(app: Express): void {
  // Usage analytics (admin only)
  app.get(
    "/api/dashboard/usage",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const { start, end } = req.query;
      const startDate = start ? new Date(start as string) : undefined;
      const endDate = end ? new Date(end as string) : undefined;
      const summary = await storage.getUsageSummary(req.orgId!, startDate, endDate);
      logPhiAccess({ ...auditContext(req), event: "view_usage_analytics", resourceType: "usage" });
      res.json(summary);
    }),
  );

  // Dashboard metrics (cached 60s per org)
  app.get(
    "/api/dashboard/metrics",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const metrics = await withCache(`dashboard:metrics:${req.orgId}`, DASHBOARD_CACHE_TTL, () =>
        storage.getDashboardMetrics(req.orgId!),
      );
      logPhiAccess({ ...auditContext(req), event: "view_dashboard_metrics", resourceType: "metrics" });
      res.json(metrics);
    }),
  );

  // Sentiment distribution (cached 60s per org)
  app.get(
    "/api/dashboard/sentiment",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const distribution = await withCache(`dashboard:sentiment:${req.orgId}`, DASHBOARD_CACHE_TTL, () =>
        storage.getSentimentDistribution(req.orgId!),
      );
      logPhiAccess({ ...auditContext(req), event: "view_sentiment_distribution", resourceType: "sentiment" });
      res.json(distribution);
    }),
  );

  // Low-confidence calls (most recent calls with confidence below threshold)
  app.get(
    "/api/dashboard/low-confidence",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const org = await storage.getOrganization(orgId);
      const threshold = (org?.settings as any)?.confidenceThreshold ?? 0.5;
      const limitParam = Math.min(safeInt(req.query.limit, 10), 50);

      const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
      const lowConfidence = allCalls
        .filter((c) => {
          const conf = parseFloat(c.analysis?.confidenceScore || "");
          return !isNaN(conf) && conf > 0 && conf < threshold;
        })
        .sort((a, b) => {
          const confA = parseFloat(a.analysis?.confidenceScore || "1");
          const confB = parseFloat(b.analysis?.confidenceScore || "1");
          return confA - confB; // lowest confidence first
        })
        .slice(0, limitParam)
        .map((c) => ({
          callId: c.id,
          fileName: c.fileName,
          uploadedAt: c.uploadedAt,
          confidenceScore: parseFloat(c.analysis?.confidenceScore || "0"),
          performanceScore: parseFloat(c.analysis?.performanceScore || "0"),
          employeeId: c.employeeId,
        }));

      logPhiAccess({ ...auditContext(req), event: "view_low_confidence_calls", resourceType: "calls" });
      res.json({ threshold, calls: lowConfidence, count: lowConfidence.length });
    }),
  );

  // Top performers (cached 60s per org)
  app.get(
    "/api/dashboard/performers",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const limit = Math.min(safeInt(req.query.limit, 3), 100);
      const performers = await withCache(`dashboard:performers:${req.orgId}:${limit}`, DASHBOARD_CACHE_TTL, () =>
        storage.getTopPerformers(req.orgId!, limit),
      );
      logPhiAccess({ ...auditContext(req), event: "view_top_performers", resourceType: "performance" });
      res.json(performers);
    }),
  );
}
