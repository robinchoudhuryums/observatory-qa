/**
 * Competitor QA Benchmarking Routes
 *
 * Provides anonymized cross-org performance percentiles so organizations
 * can see how their call quality, sentiment, and compliance scores compare
 * to peers in their industry. All data is aggregated — no org-identifiable
 * information is ever exposed.
 *
 * Benchmarks are computed from completed calls across all active orgs,
 * segmented by industry type (dental, medical, behavioral_health, etc.).
 */
import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { asyncHandler, AppError } from "../middleware/error-handler";

// Cache benchmarks for 1 hour (expensive cross-org computation)
let benchmarkCache: { data: Map<string, IndustryBenchmark>; computedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

interface IndustryBenchmark {
  industryType: string;
  orgCount: number;
  callCount: number;
  performanceScore: { p25: number; p50: number; p75: number; p90: number; mean: number };
  sentimentPositiveRate: { p25: number; p50: number; p75: number; mean: number };
  subScores: {
    compliance: { p25: number; p50: number; p75: number; mean: number };
    customerExperience: { p25: number; p50: number; p75: number; mean: number };
    communication: { p25: number; p50: number; p75: number; mean: number };
    resolution: { p25: number; p50: number; p75: number; mean: number };
  };
  avgCallsPerOrg: number;
  flagRate: number; // % of calls flagged
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((sorted.length * p) / 100) - 1;
  return Math.round(sorted[Math.max(0, idx)] * 100) / 100;
}

function avg(arr: number[]): number {
  return arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : 0;
}

async function computeBenchmarks(): Promise<Map<string, IndustryBenchmark>> {
  // Check cache
  if (benchmarkCache && Date.now() - benchmarkCache.computedAt < CACHE_TTL_MS) {
    return benchmarkCache.data;
  }

  logger.info("Computing cross-org QA benchmarks");
  const orgs = await storage.listOrganizations();
  const activeOrgs = orgs.filter((o) => o.status === "active");

  // Per-industry aggregation
  const industryData: Record<
    string,
    {
      orgScores: number[];
      allScores: number[];
      sentimentPositiveRates: number[];
      compliance: number[];
      customerExperience: number[];
      communication: number[];
      resolution: number[];
      callCounts: number[];
      flagCounts: number[];
      totalCalls: number;
    }
  > = {};

  for (const org of activeOrgs) {
    const industry = (org.settings as any)?.industryType || "general";
    if (!industryData[industry]) {
      industryData[industry] = {
        orgScores: [],
        allScores: [],
        sentimentPositiveRates: [],
        compliance: [],
        customerExperience: [],
        communication: [],
        resolution: [],
        callCounts: [],
        flagCounts: [],
        totalCalls: 0,
      };
    }
    const data = industryData[industry];

    try {
      const calls = await storage.getCallSummaries(org.id, { status: "completed", limit: 200 });
      if (calls.length === 0) continue;

      let orgScoreSum = 0;
      let orgScoreCount = 0;
      let positiveCount = 0;
      let flaggedCount = 0;

      for (const call of calls) {
        const score = call.analysis?.performanceScore ? parseFloat(String(call.analysis.performanceScore)) : null;
        if (score !== null && !isNaN(score)) {
          data.allScores.push(score);
          orgScoreSum += score;
          orgScoreCount++;
        }

        if (call.sentiment?.overallSentiment === "positive") positiveCount++;

        const sub = call.analysis?.subScores as any;
        if (sub) {
          if (typeof sub.compliance === "number") data.compliance.push(sub.compliance);
          if (typeof sub.customerExperience === "number") data.customerExperience.push(sub.customerExperience);
          if (typeof sub.communication === "number") data.communication.push(sub.communication);
          if (typeof sub.resolution === "number") data.resolution.push(sub.resolution);
        }

        const flags = call.analysis?.flags as string[];
        if (flags && flags.length > 0) flaggedCount++;
      }

      if (orgScoreCount > 0) {
        data.orgScores.push(orgScoreSum / orgScoreCount);
      }
      data.sentimentPositiveRates.push(calls.length > 0 ? positiveCount / calls.length : 0);
      data.callCounts.push(calls.length);
      data.flagCounts.push(flaggedCount);
      data.totalCalls += calls.length;
    } catch (err) {
      // Skip orgs with errors (non-blocking)
      logger.debug({ orgId: org.id, err }, "Skipping org in benchmark computation");
    }
  }

  // Also compute "all" industry aggregate
  const allIndustryData = {
    orgScores: [] as number[],
    allScores: [] as number[],
    sentimentPositiveRates: [] as number[],
    compliance: [] as number[],
    customerExperience: [] as number[],
    communication: [] as number[],
    resolution: [] as number[],
    callCounts: [] as number[],
    flagCounts: [] as number[],
    totalCalls: 0,
  };
  for (const data of Object.values(industryData)) {
    allIndustryData.orgScores.push(...data.orgScores);
    allIndustryData.allScores.push(...data.allScores);
    allIndustryData.sentimentPositiveRates.push(...data.sentimentPositiveRates);
    allIndustryData.compliance.push(...data.compliance);
    allIndustryData.customerExperience.push(...data.customerExperience);
    allIndustryData.communication.push(...data.communication);
    allIndustryData.resolution.push(...data.resolution);
    allIndustryData.callCounts.push(...data.callCounts);
    allIndustryData.flagCounts.push(...data.flagCounts);
    allIndustryData.totalCalls += data.totalCalls;
  }

  const result = new Map<string, IndustryBenchmark>();

  function buildBenchmark(key: string, data: typeof allIndustryData): IndustryBenchmark {
    const sortedScores = data.allScores.slice().sort((a, b) => a - b);
    const _sortedOrgScores = data.orgScores.slice().sort((a, b) => a - b);
    const sortedSentiment = data.sentimentPositiveRates.slice().sort((a, b) => a - b);
    const sortedCompliance = data.compliance.slice().sort((a, b) => a - b);
    const sortedCX = data.customerExperience.slice().sort((a, b) => a - b);
    const sortedComm = data.communication.slice().sort((a, b) => a - b);
    const sortedRes = data.resolution.slice().sort((a, b) => a - b);
    const totalFlags = data.flagCounts.reduce((a, b) => a + b, 0);

    return {
      industryType: key,
      orgCount: data.orgScores.length,
      callCount: data.totalCalls,
      performanceScore: {
        p25: percentile(sortedScores, 25),
        p50: percentile(sortedScores, 50),
        p75: percentile(sortedScores, 75),
        p90: percentile(sortedScores, 90),
        mean: avg(sortedScores),
      },
      sentimentPositiveRate: {
        p25: percentile(sortedSentiment, 25),
        p50: percentile(sortedSentiment, 50),
        p75: percentile(sortedSentiment, 75),
        mean: avg(sortedSentiment),
      },
      subScores: {
        compliance: {
          p25: percentile(sortedCompliance, 25),
          p50: percentile(sortedCompliance, 50),
          p75: percentile(sortedCompliance, 75),
          mean: avg(sortedCompliance),
        },
        customerExperience: {
          p25: percentile(sortedCX, 25),
          p50: percentile(sortedCX, 50),
          p75: percentile(sortedCX, 75),
          mean: avg(sortedCX),
        },
        communication: {
          p25: percentile(sortedComm, 25),
          p50: percentile(sortedComm, 50),
          p75: percentile(sortedComm, 75),
          mean: avg(sortedComm),
        },
        resolution: {
          p25: percentile(sortedRes, 25),
          p50: percentile(sortedRes, 50),
          p75: percentile(sortedRes, 75),
          mean: avg(sortedRes),
        },
      },
      avgCallsPerOrg: data.orgScores.length > 0 ? Math.round(data.totalCalls / data.orgScores.length) : 0,
      flagRate: data.totalCalls > 0 ? Math.round((totalFlags / data.totalCalls) * 10000) / 100 : 0,
    };
  }

  for (const [industry, data] of Object.entries(industryData)) {
    if (data.orgScores.length >= 3) {
      // Need 3+ orgs for meaningful benchmarks
      result.set(industry, buildBenchmark(industry, data));
    }
  }
  result.set("all", buildBenchmark("all", allIndustryData));

  benchmarkCache = { data: result, computedAt: Date.now() };
  logger.info({ industries: result.size, totalOrgs: activeOrgs.length }, "QA benchmarks computed");
  return result;
}

export function registerBenchmarkRoutes(app: Express) {
  /**
   * GET /api/benchmarks — Get QA benchmarks for the authenticated org.
   * Returns the org's scores alongside anonymized industry percentiles.
   * No org-identifiable data is exposed — only aggregated statistics.
   */
  app.get("/api/benchmarks", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");

      const org = await storage.getOrganization(orgId);
      const industry = (org?.settings as any)?.industryType || "general";

      // Compute this org's own scores
      const calls = await storage.getCallSummaries(orgId, { status: "completed", limit: 500 });
      const scores = calls
        .map((c) => (c.analysis?.performanceScore ? parseFloat(String(c.analysis.performanceScore)) : null))
        .filter((s): s is number => s !== null && !isNaN(s));

      const orgAvgScore = avg(scores);
      const positiveCount = calls.filter((c) => c.sentiment?.overallSentiment === "positive").length;
      const orgPositiveRate = calls.length > 0 ? Math.round((positiveCount / calls.length) * 100) / 100 : 0;

      const subScoreArrays: Record<string, number[]> = {
        compliance: [],
        customerExperience: [],
        communication: [],
        resolution: [],
      };
      for (const call of calls) {
        const sub = call.analysis?.subScores as any;
        if (!sub) continue;
        for (const [key, arr] of Object.entries(subScoreArrays)) {
          if (typeof sub[key] === "number") arr.push(sub[key]);
        }
      }

      const orgSubScores: Record<string, number> = {};
      for (const [key, arr] of Object.entries(subScoreArrays)) {
        orgSubScores[key] = avg(arr);
      }

      // Get benchmarks
      const benchmarks = await computeBenchmarks();
      const industryBench = benchmarks.get(industry);
      const allBench = benchmarks.get("all");

      // Compute percentile rank for this org
      const computePercentileRank = (orgValue: number, bench: IndustryBenchmark | undefined): number | null => {
        if (!bench || bench.orgCount < 3) return null;
        const { p25, p50, p75 } = bench.performanceScore;
        if (orgValue <= p25) return Math.round((orgValue / p25) * 25);
        if (orgValue <= p50) return 25 + Math.round(((orgValue - p25) / (p50 - p25)) * 25);
        if (orgValue <= p75) return 50 + Math.round(((orgValue - p50) / (p75 - p50)) * 25);
        return Math.min(99, 75 + Math.round(((orgValue - p75) / (10 - p75)) * 25));
      };

      res.json({
        orgMetrics: {
          avgPerformanceScore: orgAvgScore,
          positiveRate: orgPositiveRate,
          subScores: orgSubScores,
          totalCalls: calls.length,
        },
        percentileRank: computePercentileRank(orgAvgScore, industryBench || allBench),
        industryBenchmark: industryBench || null,
        allIndustryBenchmark: allBench || null,
        industry,
        dataAvailable: (industryBench?.orgCount ?? 0) >= 3,
        message:
          (industryBench?.orgCount ?? 0) < 3
            ? `Need 3+ ${industry} organizations for industry-specific benchmarks. Showing all-industry data.`
            : undefined,
      });
  }));

  /**
   * GET /api/benchmarks/trends — Monthly percentile rank trend for this org.
   */
  app.get("/api/benchmarks/trends", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) throw new AppError(403, "Organization context required");

      const calls = await storage.getCallSummaries(orgId, { status: "completed", limit: 1000 });

      // Group by month
      const months: Record<string, number[]> = {};
      for (const call of calls) {
        if (!call.uploadedAt) continue;
        const month = call.uploadedAt.slice(0, 7); // YYYY-MM
        if (!months[month]) months[month] = [];
        const score = call.analysis?.performanceScore ? parseFloat(String(call.analysis.performanceScore)) : null;
        if (score !== null && !isNaN(score)) months[month].push(score);
      }

      const trend = Object.entries(months)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12) // Last 12 months
        .map(([month, scores]) => ({
          month,
          avgScore: avg(scores),
          callCount: scores.length,
        }));

      res.json({ trend });
  }));
}
