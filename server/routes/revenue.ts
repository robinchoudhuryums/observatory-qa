import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { validateUUIDParam } from "./helpers";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { logPhiAccess, auditContext } from "../services/audit-log";

const updateRevenueSchema = z.object({
  estimatedRevenue: z.number().min(0).optional(),
  actualRevenue: z.number().min(0).optional(),
  revenueType: z.enum(["production", "collection", "scheduled", "lost"]).optional(),
  treatmentValue: z.number().min(0).optional(),
  scheduledProcedures: z.array(z.object({
    code: z.string(),
    description: z.string(),
    estimatedValue: z.number(),
  })).optional(),
  conversionStatus: z.enum(["converted", "pending", "lost", "unknown"]).optional(),
  notes: z.string().max(2000).optional(),
});

export function registerRevenueRoutes(app: Express) {
  // Get revenue metrics summary
  app.get("/api/revenue/metrics", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const metrics = await storage.getRevenueMetrics(orgId);
      res.json(metrics);
    } catch (error) {
      logger.error({ err: error }, "Failed to get revenue metrics");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get revenue metrics"));
    }
  });

  // List all call revenue records
  app.get("/api/revenue", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { conversionStatus } = req.query;
      const revenues = await storage.listCallRevenues(orgId, {
        conversionStatus: conversionStatus as string | undefined,
      });

      // Enrich with call details
      const enriched = await Promise.all(revenues.map(async (rev) => {
        const call = await storage.getCall(orgId, rev.callId);
        const employee = call?.employeeId ? await storage.getEmployee(orgId, call.employeeId) : undefined;
        return {
          ...rev,
          callFileName: call?.fileName,
          callCategory: call?.callCategory,
          employeeName: employee?.name,
          callDate: call?.uploadedAt,
        };
      }));

      res.json(enriched);
    } catch (error) {
      logger.error({ err: error }, "Failed to list revenue records");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to list revenue records"));
    }
  });

  // Get revenue for a specific call
  app.get("/api/revenue/call/:callId", requireAuth, injectOrgContext, validateUUIDParam("callId"), async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const revenue = await storage.getCallRevenue(orgId, req.params.callId);
      if (!revenue) return res.status(404).json({ message: "Revenue record not found" });
      res.json(revenue);
    } catch (error) {
      logger.error({ err: error }, "Failed to get call revenue");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get call revenue"));
    }
  });

  // Create or update revenue for a call
  app.put("/api/revenue/call/:callId", requireAuth, requireRole("manager"), injectOrgContext, validateUUIDParam("callId"), async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { callId } = req.params;

      const parsed = updateRevenueSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid revenue data", errors: parsed.error.flatten().fieldErrors });
      }

      const call = await storage.getCall(orgId, callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      const revenueData = { ...parsed.data, updatedBy: req.user!.name || req.user!.username };
      const existing = await storage.getCallRevenue(orgId, callId);
      if (existing) {
        const updated = await storage.updateCallRevenue(orgId, callId, revenueData);
        res.json(updated);
      } else {
        const revenue = await storage.createCallRevenue(orgId, {
          orgId,
          callId,
          conversionStatus: "unknown",
          ...revenueData,
        });
        res.json(revenue);
      }

      logPhiAccess({ ...auditContext(req), event: "update_call_revenue", resourceType: "revenue", resourceId: callId });
      logger.info({ orgId, callId }, "Call revenue updated");
    } catch (error) {
      logger.error({ err: error }, "Failed to update call revenue");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update call revenue"));
    }
  });

  // Get revenue by employee (aggregated)
  app.get("/api/revenue/by-employee", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const revenues = await storage.listCallRevenues(orgId);
      const calls = await storage.getAllCalls(orgId);
      const employees = await storage.getAllEmployees(orgId);

      const callMap = new Map(calls.map(c => [c.id, c]));
      const employeeMap = new Map(employees.map(e => [e.id, e]));

      const byEmployee: Record<string, {
        employeeId: string;
        employeeName: string;
        totalEstimated: number;
        totalActual: number;
        callCount: number;
        converted: number;
      }> = {};

      for (const rev of revenues) {
        const call = callMap.get(rev.callId);
        if (!call?.employeeId) continue;
        const emp = employeeMap.get(call.employeeId);
        if (!emp) continue;

        if (!byEmployee[emp.id]) {
          byEmployee[emp.id] = {
            employeeId: emp.id,
            employeeName: emp.name,
            totalEstimated: 0,
            totalActual: 0,
            callCount: 0,
            converted: 0,
          };
        }

        byEmployee[emp.id].totalEstimated += rev.estimatedRevenue || 0;
        byEmployee[emp.id].totalActual += rev.actualRevenue || 0;
        byEmployee[emp.id].callCount++;
        if (rev.conversionStatus === "converted") byEmployee[emp.id].converted++;
      }

      const result = Object.values(byEmployee).sort((a, b) => b.totalActual - a.totalActual);
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to get revenue by employee");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get revenue by employee"));
    }
  });

  // Get revenue trend data (weekly buckets for last 12 weeks)
  app.get("/api/revenue/trend", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const revenues = await storage.listCallRevenues(orgId);
      const calls = await storage.getAllCalls(orgId);
      const callDateMap = new Map(calls.map(c => [c.id, c.uploadedAt]));

      // Build weekly buckets for the last 12 weeks
      const now = new Date();
      const weeks: Array<{ weekStart: string; estimated: number; actual: number; count: number; converted: number }> = [];
      for (let i = 11; i >= 0; i--) {
        const start = new Date(now);
        start.setDate(start.getDate() - (i * 7 + now.getDay()));
        start.setHours(0, 0, 0, 0);
        weeks.push({
          weekStart: start.toISOString().slice(0, 10),
          estimated: 0,
          actual: 0,
          count: 0,
          converted: 0,
        });
      }

      for (const rev of revenues) {
        const callDate = callDateMap.get(rev.callId);
        if (!callDate) continue;
        const d = new Date(callDate);
        // Find which week bucket this falls into
        for (let i = weeks.length - 1; i >= 0; i--) {
          if (d >= new Date(weeks[i].weekStart)) {
            weeks[i].estimated += rev.estimatedRevenue || 0;
            weeks[i].actual += rev.actualRevenue || 0;
            weeks[i].count++;
            if (rev.conversionStatus === "converted") weeks[i].converted++;
            break;
          }
        }
      }

      res.json(weeks);
    } catch (error) {
      logger.error({ err: error }, "Failed to get revenue trend");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get revenue trend"));
    }
  });
}
