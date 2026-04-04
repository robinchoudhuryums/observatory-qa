import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, injectOrgContext } from "../auth";
import { safeFloat } from "./helpers";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { asyncHandler } from "../middleware/error-handler";
import { getCallClusters } from "../services/call-clustering";

/** Maximum calls to process for analytics to prevent memory exhaustion. */
const MAX_ANALYTICS_CALLS = 10_000;

export function registerInsightRoutes(app: Express): void {
  // ==================== COMPANY INSIGHTS API ====================

  app.get("/api/insights", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
    const allCalls = await storage.getCallSummaries(req.orgId!);
    const completed = allCalls.filter((c) => c.status === "completed" && c.analysis).slice(-MAX_ANALYTICS_CALLS); // Limit to most recent N calls for analytics

    // Aggregate topic frequency across all calls
    const topicCounts = new Map<string, number>();
    const complaintsAndFrustrations: Array<{ topic: string; callId: string; date: string; sentiment: string }> = [];
    const escalationPatterns: Array<{ summary: string; callId: string; date: string; score: number }> = [];
    const sentimentByWeek = new Map<string, { positive: number; neutral: number; negative: number; total: number }>();

    for (const call of completed) {
      const topics = (call.analysis?.topics as string[]) || [];
      for (const t of topics) {
        topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
      }

      // Track negative/frustration calls
      const sentiment = call.sentiment?.overallSentiment;
      if (sentiment === "negative") {
        for (const t of topics) {
          complaintsAndFrustrations.push({
            topic: t,
            callId: call.id,
            date: call.uploadedAt || "",
            sentiment: sentiment,
          });
        }
      }

      // Track low-score calls as escalation patterns
      const score = safeFloat(call.analysis?.performanceScore, 10);
      if (score <= 4) {
        escalationPatterns.push({
          summary: call.analysis?.summary || "",
          callId: call.id,
          date: call.uploadedAt || "",
          score,
        });
      }

      // Weekly sentiment trend
      if (call.uploadedAt) {
        const d = new Date(call.uploadedAt);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const weekKey = weekStart.toISOString().slice(0, 10);
        const entry = sentimentByWeek.get(weekKey) || { positive: 0, neutral: 0, negative: 0, total: 0 };
        entry.total++;
        if (sentiment === "positive") entry.positive++;
        else if (sentiment === "negative") entry.negative++;
        else entry.neutral++;
        sentimentByWeek.set(weekKey, entry);
      }
    }

    // Aggregate complaint topics (topics that appear in negative calls)
    const complaintTopicCounts = new Map<string, number>();
    for (const c of complaintsAndFrustrations) {
      complaintTopicCounts.set(c.topic, (complaintTopicCounts.get(c.topic) || 0) + 1);
    }

    // Sort topics by frequency
    const topTopics = Array.from(topicCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const topComplaints = Array.from(complaintTopicCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Weekly trend sorted chronologically
    const weeklyTrend = Array.from(sentimentByWeek.entries())
      .map(([week, data]) => ({ week, ...data }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // Low-confidence calls
    const lowConfidenceCalls = completed
      .filter((c) => {
        const conf = safeFloat(c.analysis?.confidenceScore, 1);
        return conf < 0.7;
      })
      .map((c) => ({
        callId: c.id,
        date: c.uploadedAt || "",
        confidence: safeFloat(c.analysis?.confidenceScore),
        employee: c.employee?.name || "Unassigned",
      }));

    logPhiAccess({
      ...auditContext(req),
      event: "view_insights",
      resourceType: "insights",
      detail: `${completed.length} calls analyzed`,
    });

    res.json({
      totalAnalyzed: completed.length,
      topTopics,
      topComplaints,
      escalationPatterns: escalationPatterns.sort((a, b) => a.score - b.score).slice(0, 20),
      weeklyTrend,
      lowConfidenceCalls: lowConfidenceCalls.slice(0, 20),
      summary: {
        avgScore:
          completed.length > 0
            ? completed.reduce((sum, c) => sum + safeFloat(c.analysis?.performanceScore), 0) / completed.length
            : 0,
        negativeCallRate:
          completed.length > 0
            ? completed.filter((c) => c.sentiment?.overallSentiment === "negative").length / completed.length
            : 0,
        escalationRate: completed.length > 0 ? escalationPatterns.length / completed.length : 0,
        /** Average confidence across all analyzed calls (0-1). */
        avgConfidence:
          completed.length > 0
            ? Math.round(
                (completed.reduce((sum, c) => sum + safeFloat(c.analysis?.confidenceScore, 0), 0) / completed.length) *
                  100,
              ) / 100
            : 0,
        lowConfidenceRate:
          completed.length > 0 ? Math.round((lowConfidenceCalls.length / completed.length) * 100) / 100 : 0,
      },
    });
  }));

  // ==================== CALL PATTERN CLUSTERS ====================

  /**
   * Discover recurring call patterns via TF-IDF topic clustering.
   * Groups calls by topic similarity and surfaces trends.
   */
  app.get("/api/insights/clusters", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const days = Math.min(Math.max(parseInt(String(req.query.days)) || 30, 1), 90);
    const minSize = Math.min(Math.max(parseInt(String(req.query.minSize)) || 2, 2), 50);
    const maxClusters = Math.min(Math.max(parseInt(String(req.query.maxClusters)) || 10, 1), 50);
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;

    const clusters = await getCallClusters(orgId, { days, employeeId, minClusterSize: minSize, maxClusters });

    logPhiAccess({
      ...auditContext(req),
      event: "view_call_clusters",
      resourceType: "insights",
      detail: `${clusters.length} clusters found (${days} days, minSize=${minSize})`,
    });

    res.json({
      clusters,
      totalClusters: clusters.length,
      params: { days, minSize, maxClusters, employeeId },
    });
  }));

  // ==================== TEAM & DEPARTMENT ANALYTICS ====================

  /**
   * Team breakdown: per-employee and per-department aggregated performance.
   * Includes peer comparison (agent avg vs team avg).
   */
  app.get("/api/insights/team", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
    const [allCalls, employees] = await Promise.all([
      storage.getCallSummaries(req.orgId!, { status: "completed" }),
      storage.getAllEmployees(req.orgId!),
    ]);
    // Limit to most recent N calls for analytics
    const calls = allCalls.slice(-MAX_ANALYTICS_CALLS);

    const empMap = new Map(employees.map((e) => [e.id, e]));

    // Per-employee stats
    const empStats = new Map<
      string,
      {
        scores: number[];
        sentiments: { positive: number; neutral: number; negative: number };
        flaggedCount: number;
        callCount: number;
        complianceScores: number[];
      }
    >();

    for (const call of calls) {
      if (!call.employeeId || !call.analysis) continue;
      const stats = empStats.get(call.employeeId) || {
        scores: [],
        sentiments: { positive: 0, neutral: 0, negative: 0 },
        flaggedCount: 0,
        callCount: 0,
        complianceScores: [],
      };
      stats.callCount++;

      if (call.analysis.performanceScore) {
        stats.scores.push(safeFloat(call.analysis.performanceScore));
      }
      const subScores = (call.analysis as any)?.subScores;
      if (subScores?.compliance != null) {
        stats.complianceScores.push(subScores.compliance);
      }
      if (Array.isArray(call.analysis.flags) && call.analysis.flags.length > 0) {
        stats.flaggedCount++;
      }
      const sent = call.sentiment?.overallSentiment as "positive" | "neutral" | "negative";
      if (sent && sent in stats.sentiments) stats.sentiments[sent]++;

      empStats.set(call.employeeId, stats);
    }

    // Build per-employee summary
    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

    const teamScores = Array.from(empStats.values()).flatMap((s) => s.scores);
    const teamAvg = avg(teamScores);

    const agentBreakdown = Array.from(empStats.entries())
      .map(([empId, stats]) => {
        const emp = empMap.get(empId);
        const agentAvg = avg(stats.scores);
        return {
          employeeId: empId,
          name: emp?.name || "Unknown",
          role: emp?.role || "",
          subTeam: emp?.subTeam || "",
          callCount: stats.callCount,
          avgScore: agentAvg,
          avgCompliance: avg(stats.complianceScores),
          sentiments: stats.sentiments,
          flaggedCount: stats.flaggedCount,
          vsTeamAvg: agentAvg != null && teamAvg != null ? Math.round((agentAvg - teamAvg) * 100) / 100 : null,
        };
      })
      .sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));

    // Per-department/subTeam aggregation
    const deptStats = new Map<string, { scores: number[]; callCount: number; flagged: number }>();
    for (const agent of agentBreakdown) {
      const dept = agent.subTeam || agent.role || "Unassigned";
      const stats = deptStats.get(dept) || { scores: [], callCount: 0, flagged: 0 };
      stats.callCount += agent.callCount;
      stats.flagged += agent.flaggedCount;
      if (agent.avgScore != null) stats.scores.push(agent.avgScore);
      deptStats.set(dept, stats);
    }

    const departmentBreakdown = Array.from(deptStats.entries())
      .map(([dept, stats]) => ({
        department: dept,
        agentCount: stats.scores.length,
        callCount: stats.callCount,
        avgScore: avg(stats.scores),
        flaggedCount: stats.flagged,
      }))
      .sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));

    res.json({
      teamAvg,
      totalAgents: empStats.size,
      totalCalls: calls.length,
      agentBreakdown,
      departmentBreakdown,
    });

    logPhiAccess({
      ...auditContext(req),
      event: "view_team_insights",
      resourceType: "insights",
      detail: `${calls.length} calls, ${empStats.size} agents analyzed`,
    });
  }));

  // ==================== TIME-SERIES PERFORMANCE TRENDS ====================

  /**
   * Daily performance time-series for charting.
   * Returns daily aggregates: avg score, call count, sentiment split, compliance avg.
   */
  app.get("/api/insights/trends", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
    const { from, to, granularity } = req.query;
    const calls = await storage.getCallSummaries(req.orgId!, { status: "completed" });

    // Date filtering
    let filtered = calls;
    if (from) {
      const fromDate = new Date(from as string);
      filtered = filtered.filter((c) => new Date(c.uploadedAt || 0) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to as string);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter((c) => new Date(c.uploadedAt || 0) <= toDate);
    }

    // Group by time bucket (day or week)
    const useWeekly = granularity === "week";
    const buckets = new Map<
      string,
      {
        calls: number;
        totalScore: number;
        scored: number;
        compliance: number;
        complianceCount: number;
        positive: number;
        neutral: number;
        negative: number;
        flagged: number;
      }
    >();

    for (const call of filtered) {
      if (!call.uploadedAt) continue;
      const d = new Date(call.uploadedAt);
      let bucketKey: string;
      if (useWeekly) {
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        bucketKey = weekStart.toISOString().slice(0, 10);
      } else {
        bucketKey = d.toISOString().slice(0, 10);
      }

      const entry = buckets.get(bucketKey) || {
        calls: 0,
        totalScore: 0,
        scored: 0,
        compliance: 0,
        complianceCount: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        flagged: 0,
      };
      entry.calls++;

      if (call.analysis?.performanceScore) {
        entry.totalScore += safeFloat(call.analysis.performanceScore);
        entry.scored++;
      }
      const subScores = (call.analysis as any)?.subScores;
      if (subScores?.compliance != null) {
        entry.compliance += subScores.compliance;
        entry.complianceCount++;
      }
      const sent = call.sentiment?.overallSentiment as "positive" | "neutral" | "negative";
      if (sent && sent in entry) entry[sent]++;
      if (Array.isArray(call.analysis?.flags) && call.analysis!.flags.length > 0) {
        entry.flagged++;
      }

      buckets.set(bucketKey, entry);
    }

    const trends = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        calls: d.calls,
        avgScore: d.scored > 0 ? Math.round((d.totalScore / d.scored) * 100) / 100 : null,
        avgCompliance: d.complianceCount > 0 ? Math.round((d.compliance / d.complianceCount) * 100) / 100 : null,
        positive: d.positive,
        neutral: d.neutral,
        negative: d.negative,
        flaggedCount: d.flagged,
      }));

    logPhiAccess({ ...auditContext(req), event: "view_trend_insights", resourceType: "insights" });
    res.json({ granularity: useWeekly ? "week" : "day", trends });
  }));

  // ==================== COMPLIANCE SCORECARD ====================

  /**
   * Compliance-focused analytics: sub-score breakdowns by category,
   * flagged call patterns, and category-level compliance rates.
   */
  app.get("/api/insights/compliance", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
    const calls = await storage.getCallSummaries(req.orgId!, { status: "completed" });

    // Per-category sub-score aggregation
    const categoryStats = new Map<
      string,
      {
        callCount: number;
        compliance: number[];
        customerExperience: number[];
        communication: number[];
        resolution: number[];
        flaggedCount: number;
        flags: Map<string, number>;
      }
    >();

    for (const call of calls) {
      if (!call.analysis) continue;
      const category = call.callCategory || "uncategorized";
      const stats = categoryStats.get(category) || {
        callCount: 0,
        compliance: [] as number[],
        customerExperience: [] as number[],
        communication: [] as number[],
        resolution: [] as number[],
        flaggedCount: 0,
        flags: new Map<string, number>(),
      };
      stats.callCount++;

      const ss = (call.analysis as any)?.subScores;
      if (ss) {
        if (ss.compliance != null) stats.compliance.push(ss.compliance);
        if (ss.customerExperience != null) stats.customerExperience.push(ss.customerExperience);
        if (ss.communication != null) stats.communication.push(ss.communication);
        if (ss.resolution != null) stats.resolution.push(ss.resolution);
      }

      const callFlags = Array.isArray(call.analysis.flags) ? (call.analysis.flags as string[]) : [];
      if (callFlags.length > 0) {
        stats.flaggedCount++;
        for (const f of callFlags) {
          stats.flags.set(f, (stats.flags.get(f) || 0) + 1);
        }
      }

      categoryStats.set(category, stats);
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

    const categories = Array.from(categoryStats.entries())
      .map(([cat, stats]) => ({
        category: cat,
        callCount: stats.callCount,
        avgSubScores: {
          compliance: avg(stats.compliance),
          customerExperience: avg(stats.customerExperience),
          communication: avg(stats.communication),
          resolution: avg(stats.resolution),
        },
        flaggedRate: stats.callCount > 0 ? Math.round((stats.flaggedCount / stats.callCount) * 100) / 100 : 0,
        topFlags: Array.from(stats.flags.entries())
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([flag, count]) => ({ flag, count })),
      }))
      .sort((a, b) => b.callCount - a.callCount);

    // Overall compliance score
    const allCompliance = calls
      .map((c) => (c.analysis as any)?.subScores?.compliance)
      .filter((v): v is number => v != null);

    logPhiAccess({
      ...auditContext(req),
      event: "view_compliance_insights",
      resourceType: "insights",
      detail: `${calls.length} calls analyzed`,
    });
    res.json({
      overallCompliance: avg(allCompliance),
      totalAnalyzed: calls.length,
      categories,
    });
  }));

  // ==================== AGENT COMPARISON ====================

  /**
   * Side-by-side comparison of up to 5 agents.
   * Returns sub-score radar data, sentiment breakdown, and call stats per agent.
   */
  app.get("/api/insights/compare", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const employeeIdsParam = typeof req.query.employeeIds === "string" ? req.query.employeeIds : "";
    const employeeIds = employeeIdsParam.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 5);

    if (employeeIds.length < 2) {
      return res.status(400).json({ message: "Provide at least 2 employee IDs (comma-separated)" });
    }

    const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
    const employees = await storage.getAllEmployees(orgId);
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const comparison = employeeIds.map((empId) => {
      const emp = empMap.get(empId);
      const empCalls = allCalls.filter((c) => c.employeeId === empId && c.analysis);

      const scores = empCalls.map((c) => parseFloat(String(c.analysis?.performanceScore || "0"))).filter((s) => s > 0);
      const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null;

      // Sub-score averages for radar chart
      const subScoreSums = { compliance: 0, customerExperience: 0, communication: 0, resolution: 0 };
      let subCount = 0;
      for (const c of empCalls) {
        const ss = (c.analysis as any)?.subScores;
        if (ss && typeof ss === "object") {
          subScoreSums.compliance += Number(ss.compliance) || 0;
          subScoreSums.customerExperience += Number(ss.customerExperience || ss.customer_experience) || 0;
          subScoreSums.communication += Number(ss.communication) || 0;
          subScoreSums.resolution += Number(ss.resolution) || 0;
          subCount++;
        }
      }

      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
      for (const c of empCalls) {
        const s = c.sentiment?.overallSentiment;
        if (s === "positive") sentimentCounts.positive++;
        else if (s === "negative") sentimentCounts.negative++;
        else sentimentCounts.neutral++;
      }

      return {
        employeeId: empId,
        name: emp?.name || "Unknown",
        role: emp?.role || "",
        callCount: empCalls.length,
        avgScore,
        subScores: subCount > 0 ? {
          compliance: Math.round((subScoreSums.compliance / subCount) * 100) / 100,
          customerExperience: Math.round((subScoreSums.customerExperience / subCount) * 100) / 100,
          communication: Math.round((subScoreSums.communication / subCount) * 100) / 100,
          resolution: Math.round((subScoreSums.resolution / subCount) * 100) / 100,
        } : null,
        sentiment: sentimentCounts,
      };
    });

    logPhiAccess({ ...auditContext(req), event: "view_agent_comparison", resourceType: "insights" });
    res.json({ agents: comparison });
  }));

  // ==================== ACTIVITY HEATMAP ====================

  /**
   * 24-hour x 7-day heatmap data for call volume or performance.
   * Returns a grid of { dayOfWeek, hour, value } entries.
   */
  app.get("/api/insights/heatmap", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const mode = req.query.mode === "performance" ? "performance" : "volume";
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const days = Math.min(Math.max(parseInt(String(req.query.days)) || 30, 7), 90);

    const cutoff = new Date(Date.now() - days * 86400000);
    let calls = await storage.getCallSummaries(orgId, { status: "completed" });
    calls = calls.filter((c) => c.uploadedAt && new Date(c.uploadedAt) >= cutoff);
    if (employeeId) calls = calls.filter((c) => c.employeeId === employeeId);

    // Build 7x24 grid
    const grid: Array<{ dayOfWeek: number; hour: number; callCount: number; avgScore: number | null }> = [];

    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const slotCalls = calls.filter((c) => {
          const d = new Date(c.uploadedAt!);
          return d.getDay() === day && d.getHours() === hour;
        });

        const scores = slotCalls
          .map((c) => parseFloat(String(c.analysis?.performanceScore || "")))
          .filter((s) => !isNaN(s) && s > 0);

        grid.push({
          dayOfWeek: day,
          hour,
          callCount: slotCalls.length,
          avgScore: scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
        });
      }
    }

    logPhiAccess({ ...auditContext(req), event: "view_activity_heatmap", resourceType: "insights" });
    res.json({ mode, days, grid });
  }));

  // ==================== PERFORMANCE SNAPSHOTS ====================

  /**
   * Generate a performance snapshot for an employee or company.
   */
  app.post("/api/insights/snapshots", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { level, targetId, periodDays } = req.body;

    if (!level || !["employee", "company"].includes(level)) {
      return res.status(400).json({ message: "level must be 'employee' or 'company'" });
    }

    const days = Math.min(Math.max(parseInt(periodDays) || 30, 7), 90);
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - days * 86400000);

    const { generateEmployeeSnapshot, generateCompanySnapshot } = await import("../services/performance-snapshots");

    let snapshot;
    if (level === "employee") {
      if (!targetId) return res.status(400).json({ message: "targetId required for employee snapshots" });
      snapshot = await generateEmployeeSnapshot(orgId, targetId, periodStart, periodEnd);
    } else {
      snapshot = await generateCompanySnapshot(orgId, periodStart, periodEnd);
    }

    logPhiAccess({
      ...auditContext(req),
      event: "generate_performance_snapshot",
      resourceType: "performance_snapshot",
      resourceId: snapshot.id,
    });
    res.status(201).json(snapshot);
  }));

  /**
   * Get historical snapshots for a target.
   */
  app.get("/api/insights/snapshots", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const level = (req.query.level as string) || "company";
    const targetId = (req.query.targetId as string) || orgId;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 10, 1), 50);

    const { getSnapshots: getSnaps } = await import("../services/performance-snapshots");
    const snapshots = getSnaps(orgId, level as any, targetId, limit);

    res.json({ snapshots, count: snapshots.length });
  }));
}
