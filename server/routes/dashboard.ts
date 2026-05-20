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

  // Galaxy view — day-bucketed call counts for one month.
  //
  // Phase 3 of the Orrery redesign. Powers the spiral galaxy visualization
  // on /galaxy. Returns a raw array per INV-01: one row per day in the
  // requested month, even for days with zero calls (the spiral needs every
  // slot to render correctly).
  //
  // Query: ?month=YYYY-MM (defaults to current month).
  // Cached 5min per (org, month). Cache key includes month so historical
  // months stay warm independently of the current month.
  app.get(
    "/api/dashboard/galaxy",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const rawMonth = typeof req.query.month === "string" ? req.query.month : "";
      const monthMatch = rawMonth.match(/^(\d{4})-(\d{2})$/);
      const now = new Date();
      const year = monthMatch ? parseInt(monthMatch[1], 10) : now.getUTCFullYear();
      const month = monthMatch ? parseInt(monthMatch[2], 10) : now.getUTCMonth() + 1;
      if (year < 2000 || year > 2100 || month < 1 || month > 12) {
        return res.status(400).json({ message: "Invalid month — expected YYYY-MM" });
      }

      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const days = await withCache(`dashboard:galaxy:${orgId}:${monthKey}`, DASHBOARD_CACHE_TTL, async () => {
        return computeGalaxyDays(orgId, year, month);
      });

      logPhiAccess({
        ...auditContext(req),
        event: "view_galaxy_days",
        resourceType: "metrics",
        detail: `month=${monthKey}, days=${days.length}`,
      });

      res.json(days);
    }),
  );
}

/**
 * Build the day-bucketed call data for one calendar month.
 *
 * Loads all completed calls in the date range, buckets by date_trunc('day'),
 * computes call count + close rate per day. Days with zero calls still
 * appear in the result so the spiral has a complete sequence.
 *
 * "Close rate" definition is industry-agnostic: ratio of calls scored ≥7.0
 * to total scored calls. Orgs without performance scoring (e.g. legacy data)
 * get null closeRate — the galaxy adapter handles null gracefully.
 */
async function computeGalaxyDays(
  orgId: string,
  year: number,
  month: number,
): Promise<Array<{ date: string; calls: number; closeRate: number | null }>> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // last day of the month
  const daysInMonth = end.getUTCDate();

  // Use the lightweight CallSummary list (no transcript text) — galaxy
  // needs only uploadedAt + analysis.performanceScore.
  const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });

  const buckets = new Map<string, { calls: number; closed: number; scored: number }>();
  // Initialize all days, including zero-call days.
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    buckets.set(key, { calls: 0, closed: 0, scored: 0 });
  }

  for (const call of allCalls) {
    if (!call.uploadedAt) continue;
    const t = new Date(call.uploadedAt);
    if (t < start || t > end) continue;
    // Date key in the user's UTC view (consistent with date_trunc).
    const key = t.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.calls += 1;
    const raw = call.analysis?.performanceScore;
    const score = typeof raw === "string" ? parseFloat(raw) : (raw ?? NaN);
    if (typeof score === "number" && !Number.isNaN(score)) {
      bucket.scored += 1;
      if (score >= 7.0) bucket.closed += 1;
    }
  }

  return Array.from(buckets.entries())
    .map(([date, b]) => ({
      date,
      calls: b.calls,
      closeRate: b.scored > 0 ? b.closed / b.scored : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
