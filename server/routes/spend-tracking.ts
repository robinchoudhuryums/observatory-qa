import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import type { UsageRecord } from "@shared/schema";

// ==================== HELPERS ====================

function filterRecords(records: UsageRecord[], query: Record<string, any>): UsageRecord[] {
  let filtered = records;
  if (query.from && typeof query.from === "string") {
    const fromDate = new Date(query.from);
    if (!isNaN(fromDate.getTime())) {
      filtered = filtered.filter(r => new Date(r.timestamp) >= fromDate);
    }
  }
  if (query.to && typeof query.to === "string") {
    const toDate = new Date(query.to);
    if (!isNaN(toDate.getTime())) {
      filtered = filtered.filter(r => new Date(r.timestamp) <= toDate);
    }
  }
  if (query.type && typeof query.type === "string") {
    filtered = filtered.filter(r => r.type === query.type);
  }
  return filtered;
}

function getCurrentMonthRecords(records: UsageRecord[]): UsageRecord[] {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return records.filter(r => new Date(r.timestamp) >= monthStart);
}

export function registerSpendTrackingRoutes(app: Express): void {

  // Get usage/spend records with optional date filtering and pagination
  app.get("/api/usage", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const records = await storage.getUsageRecords(req.orgId!);
      const filtered = filterRecords(records, req.query);

      // Summary stats
      const totalCost = filtered.reduce((sum, r) => sum + (r.totalEstimatedCost || 0), 0);
      const totalRecords = filtered.length;

      // Pagination
      const pageLimit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const pageOffset = parseInt(req.query.offset as string) || 0;
      const paginated = filtered.slice(pageOffset, pageOffset + pageLimit);

      res.json({
        records: paginated,
        pagination: {
          total: totalRecords,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: pageOffset + pageLimit < totalRecords,
        },
        summary: {
          totalEstimatedCost: Math.round(totalCost * 100) / 100,
          recordCount: totalRecords,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching usage records");
      res.status(500).json({ message: "Failed to fetch usage records" });
    }
  });

  // --- Cost forecasting ---
  app.get("/api/usage/forecast", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const records = await storage.getUsageRecords(req.orgId!);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthRecords = records.filter(r => new Date(r.timestamp) >= monthStart);

      const currentMonthSpend = currentMonthRecords.reduce((sum, r) => sum + (r.totalEstimatedCost || 0), 0);
      const dayOfMonth = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dailyRate = dayOfMonth > 0 ? currentMonthSpend / dayOfMonth : 0;
      const projectedMonthlySpend = Math.round(dailyRate * daysInMonth * 100) / 100;

      // Last 7 days trend
      const last7Days: Array<{ date: string; cost: number; count: number }> = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];
        const dayRecords = records.filter(r => r.timestamp.startsWith(dateStr));
        last7Days.push({
          date: dateStr,
          cost: Math.round(dayRecords.reduce((s, r) => s + (r.totalEstimatedCost || 0), 0) * 100) / 100,
          count: dayRecords.length,
        });
      }

      // Previous month comparison
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const prevMonthRecords = records.filter(r => {
        const d = new Date(r.timestamp);
        return d >= prevMonthStart && d <= prevMonthEnd;
      });
      const prevMonthSpend = prevMonthRecords.reduce((sum, r) => sum + (r.totalEstimatedCost || 0), 0);

      // Budget alert status
      const org = await storage.getOrganization(req.orgId!);
      const budgetConfig = (org?.settings as any)?.budgetAlerts;
      let budgetStatus: { monthlyBudgetUsd: number; percentUsed: number; isOverBudget: boolean; projectedOverBudget: boolean } | null = null;
      if (budgetConfig?.enabled && budgetConfig.monthlyBudgetUsd) {
        const pctUsed = Math.round((currentMonthSpend / budgetConfig.monthlyBudgetUsd) * 10000) / 100;
        budgetStatus = {
          monthlyBudgetUsd: budgetConfig.monthlyBudgetUsd,
          percentUsed: pctUsed,
          isOverBudget: currentMonthSpend >= budgetConfig.monthlyBudgetUsd,
          projectedOverBudget: projectedMonthlySpend >= budgetConfig.monthlyBudgetUsd,
        };
      }

      res.json({
        currentMonthSpend: Math.round(currentMonthSpend * 100) / 100,
        projectedMonthlySpend,
        dailyRate: Math.round(dailyRate * 100) / 100,
        dayOfMonth,
        daysInMonth,
        daysRemaining: daysInMonth - dayOfMonth,
        previousMonthSpend: Math.round(prevMonthSpend * 100) / 100,
        monthOverMonthChange: prevMonthSpend > 0
          ? Math.round(((projectedMonthlySpend - prevMonthSpend) / prevMonthSpend) * 10000) / 100
          : null,
        last7Days,
        budgetStatus,
        currentMonthCallCount: currentMonthRecords.filter(r => r.type === "call").length,
        currentMonthABTestCount: currentMonthRecords.filter(r => r.type === "ab-test").length,
      });
    } catch (error) {
      logger.error({ err: error }, "Error computing spend forecast");
      res.status(500).json({ message: "Failed to compute forecast" });
    }
  });

  // --- Cost per outcome ---
  app.get("/api/usage/cost-per-outcome", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;
      const records = await storage.getUsageRecords(orgId);
      const filtered = filterRecords(records, req.query);

      const callRecords = filtered.filter(r => r.type === "call");
      const totalCallCost = callRecords.reduce((s, r) => s + (r.totalEstimatedCost || 0), 0);
      const scoredCallCount = callRecords.length;

      // Cost per scored call
      const costPerScoredCall = scoredCallCount > 0 ? Math.round((totalCallCost / scoredCallCount) * 10000) / 10000 : 0;

      // Cost per coaching session triggered (get coaching sessions for org)
      let coachingSessions = 0;
      try {
        const sessions = await storage.getAllCoachingSessions(orgId);
        coachingSessions = sessions.length;
      } catch { /* non-critical */ }
      const costPerCoachingSession = coachingSessions > 0 ? Math.round((totalCallCost / coachingSessions) * 100) / 100 : null;

      // Cost per converted call (revenue tracking)
      let convertedCalls = 0;
      try {
        const revenues = await storage.listCallRevenues(orgId, { conversionStatus: "converted" });
        convertedCalls = revenues.length;
      } catch { /* non-critical */ }
      const costPerConvertedCall = convertedCalls > 0 ? Math.round((totalCallCost / convertedCalls) * 100) / 100 : null;

      // Service breakdown
      let assemblyaiTotal = 0;
      let bedrockTotal = 0;
      for (const r of callRecords) {
        assemblyaiTotal += r.services?.assemblyai?.estimatedCost || 0;
        bedrockTotal += (r.services?.bedrock?.estimatedCost || 0) + (r.services?.bedrockSecondary?.estimatedCost || 0);
      }

      res.json({
        costPerScoredCall,
        totalCallCost: Math.round(totalCallCost * 100) / 100,
        scoredCallCount,
        costPerCoachingSession,
        coachingSessionCount: coachingSessions,
        costPerConvertedCall,
        convertedCallCount: convertedCalls,
        serviceBreakdown: {
          assemblyai: Math.round(assemblyaiTotal * 100) / 100,
          bedrock: Math.round(bedrockTotal * 100) / 100,
          assemblyaiPct: totalCallCost > 0 ? Math.round((assemblyaiTotal / totalCallCost) * 10000) / 100 : 0,
          bedrockPct: totalCallCost > 0 ? Math.round((bedrockTotal / totalCallCost) * 10000) / 100 : 0,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error computing cost per outcome");
      res.status(500).json({ message: "Failed to compute cost per outcome" });
    }
  });

  // --- Department allocation ---
  app.get("/api/usage/by-department", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;
      const records = await storage.getUsageRecords(orgId);
      const filtered = filterRecords(records, req.query);
      const callRecords = filtered.filter(r => r.type === "call");

      // Get all calls and employees to map callId → employee → subTeam
      const calls = await storage.getAllCalls(orgId);
      const callMap = new Map(calls.map(c => [c.id, c]));
      const employees = await storage.getAllEmployees(orgId);
      const employeeMap = new Map(employees.map(e => [e.id, e]));

      const departments: Record<string, { cost: number; callCount: number; avgCostPerCall: number; employees: Set<string> }> = {};

      for (const record of callRecords) {
        const call = callMap.get(record.callId);
        const employee = call?.employeeId ? employeeMap.get(call.employeeId) : undefined;
        const dept = (employee as any)?.subTeam || "Unassigned";

        if (!departments[dept]) {
          departments[dept] = { cost: 0, callCount: 0, avgCostPerCall: 0, employees: new Set() };
        }
        departments[dept].cost += record.totalEstimatedCost || 0;
        departments[dept].callCount++;
        if (employee) departments[dept].employees.add(employee.id);
      }

      // Compute averages and convert Sets to counts
      const result: Array<{
        department: string;
        totalCost: number;
        callCount: number;
        avgCostPerCall: number;
        employeeCount: number;
        percentOfTotal: number;
      }> = [];

      const grandTotal = Object.values(departments).reduce((s, d) => s + d.cost, 0);

      for (const [dept, data] of Object.entries(departments)) {
        result.push({
          department: dept,
          totalCost: Math.round(data.cost * 100) / 100,
          callCount: data.callCount,
          avgCostPerCall: data.callCount > 0 ? Math.round((data.cost / data.callCount) * 10000) / 10000 : 0,
          employeeCount: data.employees.size,
          percentOfTotal: grandTotal > 0 ? Math.round((data.cost / grandTotal) * 10000) / 100 : 0,
        });
      }

      // Sort by cost descending
      result.sort((a, b) => b.totalCost - a.totalCost);

      res.json({
        departments: result,
        grandTotal: Math.round(grandTotal * 100) / 100,
        totalCallsAnalyzed: callRecords.length,
      });
    } catch (error) {
      logger.error({ err: error }, "Error computing department allocation");
      res.status(500).json({ message: "Failed to compute department allocation" });
    }
  });

  // --- Cost anomaly detection ---
  app.get("/api/usage/anomalies", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const records = await storage.getUsageRecords(req.orgId!);
      const filtered = filterRecords(records, req.query);

      if (filtered.length < 5) {
        return res.json({ anomalies: [], message: "Need at least 5 records for anomaly detection" });
      }

      const costs = filtered.map(r => r.totalEstimatedCost || 0);
      const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
      const stdDev = Math.sqrt(costs.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / costs.length);

      // Flag records > 3 standard deviations above mean (or > 5x average)
      const threshold = Math.max(mean + 3 * stdDev, mean * 5);
      const anomalies: Array<{
        recordId: string;
        callId: string;
        type: string;
        timestamp: string;
        cost: number;
        avgCost: number;
        multiplier: number;
        reason: string;
      }> = [];

      for (const record of filtered) {
        const cost = record.totalEstimatedCost || 0;
        if (cost <= 0) continue;

        const multiplier = mean > 0 ? Math.round((cost / mean) * 10) / 10 : 0;
        const reasons: string[] = [];

        if (cost > threshold) {
          reasons.push(`Cost $${cost.toFixed(4)} is ${multiplier}× the average ($${mean.toFixed(4)})`);
        }

        // Check for unusually long transcription
        const duration = record.services?.assemblyai?.durationSeconds || 0;
        const avgDuration = filtered.reduce((s, r) => s + (r.services?.assemblyai?.durationSeconds || 0), 0) / filtered.length;
        if (duration > avgDuration * 3 && duration > 300) {
          reasons.push(`Audio duration ${Math.round(duration)}s is ${Math.round(duration / avgDuration)}× average`);
        }

        // Check for multiple bedrock invocations (reanalysis indicator)
        if (record.services?.bedrock && record.services?.bedrockSecondary && record.type === "call") {
          reasons.push("Multiple AI model invocations on a single call");
        }

        if (reasons.length > 0) {
          anomalies.push({
            recordId: record.id,
            callId: record.callId,
            type: record.type,
            timestamp: record.timestamp,
            cost,
            avgCost: Math.round(mean * 10000) / 10000,
            multiplier,
            reason: reasons.join("; "),
          });
        }
      }

      // Sort by cost descending
      anomalies.sort((a, b) => b.cost - a.cost);

      res.json({
        anomalies: anomalies.slice(0, 50),
        stats: {
          meanCost: Math.round(mean * 10000) / 10000,
          stdDev: Math.round(stdDev * 10000) / 10000,
          threshold: Math.round(threshold * 10000) / 10000,
          totalRecordsAnalyzed: filtered.length,
          anomalyCount: anomalies.length,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error detecting cost anomalies");
      res.status(500).json({ message: "Failed to detect anomalies" });
    }
  });

  // --- Budget alert configuration ---
  app.get("/api/usage/budget", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const budgetAlerts = (org?.settings as any)?.budgetAlerts || { enabled: false };
      res.json(budgetAlerts);
    } catch (error) {
      res.status(500).json({ message: "Failed to get budget configuration" });
    }
  });

  app.put("/api/usage/budget", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId!;
      const { enabled, monthlyBudgetUsd, alertEmail } = req.body;

      if (enabled && (!monthlyBudgetUsd || monthlyBudgetUsd <= 0)) {
        return res.status(400).json({ message: "monthlyBudgetUsd must be a positive number when budget alerts are enabled" });
      }

      const org = await storage.getOrganization(orgId);
      const currentSettings = (org?.settings || {}) as Record<string, any>;

      const budgetAlerts = {
        enabled: enabled === true,
        monthlyBudgetUsd: enabled ? monthlyBudgetUsd : undefined,
        alertEmail: alertEmail || undefined,
        lastBudgetAlertSentAt: currentSettings.budgetAlerts?.lastBudgetAlertSentAt,
      };

      await storage.updateOrganization(orgId, {
        settings: { ...currentSettings, budgetAlerts } as any,
      });

      logger.info({ orgId, budgetAlerts: { enabled, monthlyBudgetUsd } }, "Budget alerts updated");
      res.json(budgetAlerts);
    } catch (error) {
      logger.error({ err: error }, "Error updating budget configuration");
      res.status(500).json({ message: "Failed to update budget configuration" });
    }
  });
}
