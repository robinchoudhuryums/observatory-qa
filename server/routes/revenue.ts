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
  attributionStage: z.enum(["call_identified", "appointment_scheduled", "appointment_completed", "treatment_accepted", "payment_collected"]).optional(),
  appointmentDate: z.string().optional(),
  appointmentCompleted: z.boolean().optional(),
  treatmentAccepted: z.boolean().optional(),
  paymentCollected: z.number().min(0).optional(),
  payerType: z.enum(["insurance", "cash", "mixed", "unknown"]).optional(),
  insuranceCarrier: z.string().optional(),
  insuranceAmount: z.number().min(0).optional(),
  patientAmount: z.number().min(0).optional(),
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

  // --- Revenue forecasting ---
  app.get("/api/revenue/forecast", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const revenues = await storage.listCallRevenues(orgId);
      const calls = await storage.getAllCalls(orgId);
      const callDateMap = new Map(calls.map(c => [c.id, c.uploadedAt]));

      // Current month data
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthRevs = revenues.filter(r => {
        const date = callDateMap.get(r.callId);
        return date && new Date(date) >= monthStart;
      });

      const currentMonthEstimated = currentMonthRevs.reduce((s, r) => s + (r.estimatedRevenue || 0), 0);
      const currentMonthActual = currentMonthRevs.reduce((s, r) => s + (r.actualRevenue || 0), 0);

      // Historical conversion rate (last 90 days)
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const recentRevs = revenues.filter(r => {
        const date = callDateMap.get(r.callId);
        return date && new Date(date) >= ninetyDaysAgo;
      });
      const tracked = recentRevs.filter(r => r.conversionStatus !== "unknown");
      const converted = tracked.filter(r => r.conversionStatus === "converted");
      const conversionRate = tracked.length > 0 ? converted.length / tracked.length : 0;

      // Pending pipeline: pending calls * conversion rate * avg deal value
      const pendingRevs = revenues.filter(r => r.conversionStatus === "pending");
      const convertedAvgValue = converted.length > 0
        ? converted.reduce((s, r) => s + (r.actualRevenue || r.estimatedRevenue || 0), 0) / converted.length
        : 0;
      const pipelineValue = pendingRevs.reduce((s, r) => s + (r.estimatedRevenue || 0), 0);
      const projectedFromPipeline = Math.round(pipelineValue * conversionRate * 100) / 100;

      // Monthly run rate based on current month progress
      const dayOfMonth = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dailyRate = dayOfMonth > 0 ? currentMonthActual / dayOfMonth : 0;
      const projectedMonthlyActual = Math.round(dailyRate * daysInMonth * 100) / 100;

      // Forecast confidence: low before day 7 (insufficient data for reliable extrapolation)
      const forecastConfidence = dayOfMonth < 7 ? "low" : dayOfMonth < 15 ? "moderate" : "high";

      res.json({
        currentMonth: {
          estimated: Math.round(currentMonthEstimated * 100) / 100,
          actual: Math.round(currentMonthActual * 100) / 100,
          callCount: currentMonthRevs.length,
          projectedTotal: projectedMonthlyActual,
          forecastConfidence,
          daysElapsed: dayOfMonth,
          daysRemaining: daysInMonth - dayOfMonth,
        },
        pipeline: {
          pendingCount: pendingRevs.length,
          pendingValue: Math.round(pipelineValue * 100) / 100,
          projectedConversion: projectedFromPipeline,
          conversionRate: Math.round(conversionRate * 10000) / 100,
          avgDealValue: Math.round(convertedAvgValue * 100) / 100,
        },
        historicalConversionRate: Math.round(conversionRate * 10000) / 100,
        trackedCallCount: tracked.length,
        convertedCallCount: converted.length,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to compute revenue forecast");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to compute forecast"));
    }
  });

  // --- Attribution funnel: call → appointment → treatment → payment ---
  app.get("/api/revenue/attribution", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const revenues = await storage.listCallRevenues(orgId);

      // Stage ordering: each stage implies all prior stages are completed.
      // Use attributionStage as primary source of truth, with legacy field fallbacks.
      const STAGE_ORDER = ["call_identified", "appointment_scheduled", "appointment_completed", "treatment_accepted", "payment_collected"];

      const stageIndex = (r: typeof revenues[0]): number => {
        if (r.attributionStage) {
          const idx = STAGE_ORDER.indexOf(r.attributionStage);
          if (idx >= 0) return idx;
        }
        // Legacy fallback for records without attributionStage
        if (r.paymentCollected && r.paymentCollected > 0) return 4;
        if (r.treatmentAccepted === true) return 3;
        if (r.appointmentCompleted === true) return 2;
        if (r.appointmentDate) return 1;
        return 0; // call_identified
      };

      // A record at stage N is counted for all stages 0..N (funnel monotonicity)
      const funnel = {
        callIdentified: revenues.length,
        appointmentScheduled: revenues.filter(r => stageIndex(r) >= 1).length,
        appointmentCompleted: revenues.filter(r => stageIndex(r) >= 2).length,
        treatmentAccepted: revenues.filter(r => stageIndex(r) >= 3).length,
        paymentCollected: revenues.filter(r => stageIndex(r) >= 4).length,
      };

      // Conversion rates between stages
      const rates = {
        callToAppointment: funnel.callIdentified > 0 ? Math.round((funnel.appointmentScheduled / funnel.callIdentified) * 10000) / 100 : 0,
        appointmentToCompletion: funnel.appointmentScheduled > 0 ? Math.round((funnel.appointmentCompleted / funnel.appointmentScheduled) * 10000) / 100 : 0,
        completionToTreatment: funnel.appointmentCompleted > 0 ? Math.round((funnel.treatmentAccepted / funnel.appointmentCompleted) * 10000) / 100 : 0,
        treatmentToPayment: funnel.treatmentAccepted > 0 ? Math.round((funnel.paymentCollected / funnel.treatmentAccepted) * 10000) / 100 : 0,
        overallConversion: funnel.callIdentified > 0 ? Math.round((funnel.paymentCollected / funnel.callIdentified) * 10000) / 100 : 0,
      };

      // Revenue at each stage
      const revenueByStage = {
        estimated: Math.round(revenues.reduce((s, r) => s + (r.estimatedRevenue || 0), 0) * 100) / 100,
        scheduled: Math.round(revenues.filter(r => r.appointmentDate).reduce((s, r) => s + (r.treatmentValue || r.estimatedRevenue || 0), 0) * 100) / 100,
        collected: Math.round(revenues.reduce((s, r) => s + (r.paymentCollected || r.actualRevenue || 0), 0) * 100) / 100,
      };

      res.json({ funnel, conversionRates: rates, revenueByStage });
    } catch (error) {
      logger.error({ err: error }, "Failed to get attribution funnel");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get attribution data"));
    }
  });

  // --- Payer mix analysis ---
  app.get("/api/revenue/payer-mix", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const revenues = await storage.listCallRevenues(orgId);
      const calls = await storage.getAllCalls(orgId);
      const employees = await storage.getAllEmployees(orgId);
      const callMap = new Map(calls.map(c => [c.id, c]));
      const employeeMap = new Map(employees.map(e => [e.id, e]));

      // Overall payer mix
      const payerCounts: Record<string, { count: number; totalRevenue: number; insuranceRevenue: number; patientRevenue: number }> = {};
      for (const rev of revenues) {
        const payer = rev.payerType || "unknown";
        if (!payerCounts[payer]) payerCounts[payer] = { count: 0, totalRevenue: 0, insuranceRevenue: 0, patientRevenue: 0 };
        payerCounts[payer].count++;
        payerCounts[payer].totalRevenue += rev.actualRevenue || rev.estimatedRevenue || 0;
        payerCounts[payer].insuranceRevenue += rev.insuranceAmount || 0;
        payerCounts[payer].patientRevenue += rev.patientAmount || 0;
      }

      // Insurance carrier breakdown — normalize names for consistent aggregation
      const carriers: Record<string, { count: number; totalRevenue: number }> = {};
      for (const rev of revenues) {
        if (!rev.insuranceCarrier) continue;
        // Normalize carrier name: trim, title-case to prevent fragmentation
        // "delta dental" / "DELTA DENTAL" / "Delta Dental" → "Delta Dental"
        const normalized = rev.insuranceCarrier.trim().replace(/\w\S*/g, w =>
          w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        );
        if (!carriers[normalized]) carriers[normalized] = { count: 0, totalRevenue: 0 };
        carriers[normalized].count++;
        // Use insuranceAmount for carrier breakdown (not total revenue, which includes patient portion)
        carriers[normalized].totalRevenue += rev.insuranceAmount || 0;
      }

      // By employee
      const byEmployee: Record<string, { employeeName: string; insurance: number; cash: number; mixed: number; unknown: number; total: number }> = {};
      for (const rev of revenues) {
        const call = callMap.get(rev.callId);
        if (!call?.employeeId) continue;
        const emp = employeeMap.get(call.employeeId);
        if (!emp) continue;
        if (!byEmployee[emp.id]) {
          byEmployee[emp.id] = { employeeName: emp.name, insurance: 0, cash: 0, mixed: 0, unknown: 0, total: 0 };
        }
        const payer = rev.payerType || "unknown";
        const amount = rev.actualRevenue || rev.estimatedRevenue || 0;
        byEmployee[emp.id][payer as "insurance" | "cash" | "mixed" | "unknown"] += amount;
        byEmployee[emp.id].total += amount;
      }

      const totalRevenue = revenues.reduce((s, r) => s + (r.actualRevenue || r.estimatedRevenue || 0), 0);

      res.json({
        overall: Object.entries(payerCounts).map(([type, data]) => ({
          payerType: type,
          count: data.count,
          totalRevenue: Math.round(data.totalRevenue * 100) / 100,
          insuranceRevenue: Math.round(data.insuranceRevenue * 100) / 100,
          patientRevenue: Math.round(data.patientRevenue * 100) / 100,
          percentOfTotal: totalRevenue > 0 ? Math.round((data.totalRevenue / totalRevenue) * 10000) / 100 : 0,
        })),
        carriers: Object.entries(carriers)
          .map(([name, data]) => ({ carrier: name, ...data, totalRevenue: Math.round(data.totalRevenue * 100) / 100 }))
          .sort((a, b) => b.totalRevenue - a.totalRevenue),
        byEmployee: Object.values(byEmployee)
          .map(e => ({ ...e, insurance: Math.round(e.insurance * 100) / 100, cash: Math.round(e.cash * 100) / 100, total: Math.round(e.total * 100) / 100 }))
          .sort((a, b) => b.total - a.total),
        totalRecords: revenues.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to compute payer mix");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to compute payer mix"));
    }
  });

  // --- EHR revenue sync: pull treatment/payment data from EHR ---
  app.post("/api/revenue/ehr-sync/:callId", requireAuth, requireRole("manager"), injectOrgContext, validateUUIDParam("callId"), async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { callId } = req.params;
      const call = await storage.getCall(orgId, callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      // Check EHR configuration
      const org = await storage.getOrganization(orgId);
      const ehrConfig = (org?.settings as any)?.ehrConfig;
      if (!ehrConfig?.enabled || !ehrConfig?.system) {
        return res.status(400).json({ message: "EHR integration not configured. Set up EHR in org settings first." });
      }

      // Get or create revenue record
      let revenue = await storage.getCallRevenue(orgId, callId);
      if (!revenue) {
        revenue = await storage.createCallRevenue(orgId, {
          orgId, callId, conversionStatus: "unknown",
        });
      }

      // Try to find matching patient/appointment from the request body or existing data
      const { ehrPatientId } = req.body;

      if (!ehrPatientId) {
        return res.status(400).json({
          message: "ehrPatientId is required to sync revenue data from EHR",
          hint: "Use GET /api/ehr/patients to search for the patient first",
        });
      }

      // Attempt to pull treatment plans from EHR
      let treatmentPlans: any[] = [];
      try {
        const { getEhrAdapter } = await import("../services/ehr/index");
        const { decryptField } = await import("../services/phi-encryption");
        const adapter = getEhrAdapter(ehrConfig.system);
        if (!adapter) {
          return res.status(400).json({ message: `Unsupported EHR system: ${ehrConfig.system}` });
        }
        const config = {
          ...ehrConfig,
          apiKey: ehrConfig.apiKey ? decryptField(ehrConfig.apiKey) : undefined,
        };
        treatmentPlans = await adapter.getPatientTreatmentPlans(config, ehrPatientId);
      } catch (ehrErr) {
        logger.warn({ err: ehrErr, callId }, "EHR treatment plan fetch failed");
        return res.status(502).json({ message: "Failed to fetch data from EHR. Check connection settings." });
      }

      // Find relevant treatment plan (most recent accepted or in-progress)
      const relevantPlan = treatmentPlans.find(p =>
        p.status === "accepted" || p.status === "in_progress" || p.status === "completed"
      ) || treatmentPlans[0];

      if (!relevantPlan) {
        return res.json({
          message: "No treatment plans found for this patient in EHR",
          revenue,
          ehrSynced: false,
        });
      }

      // Map EHR data to revenue fields — validate numeric values from external source
      const safeNum = (v: unknown): number | undefined =>
        typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

      const updates: Record<string, any> = {
        ehrSyncedAt: new Date().toISOString(),
        updatedBy: `ehr-sync:${req.user!.username}`,
      };

      const totalFee = safeNum(relevantPlan.totalFee);
      const totalInsurance = safeNum(relevantPlan.totalInsurance);
      const totalPatient = safeNum(relevantPlan.totalPatient);

      if (totalFee) {
        updates.treatmentValue = totalFee;
        updates.estimatedRevenue = totalFee;
      }
      if (totalInsurance !== undefined) updates.insuranceAmount = totalInsurance;
      if (totalPatient !== undefined) updates.patientAmount = totalPatient;

      // Determine payer type from validated amounts
      if (totalInsurance && totalInsurance > 0 && totalPatient && totalPatient > 0) {
        updates.payerType = "mixed";
      } else if (totalInsurance && totalInsurance > 0) {
        updates.payerType = "insurance";
      } else if (totalPatient && totalPatient > 0) {
        updates.payerType = "cash";
      }

      // Map treatment plan status to attribution stage
      if (relevantPlan.status === "completed") {
        updates.treatmentAccepted = true;
        updates.attributionStage = "treatment_accepted";
        updates.conversionStatus = "converted";
        updates.actualRevenue = relevantPlan.totalFee || updates.treatmentValue;
      } else if (relevantPlan.status === "accepted" || relevantPlan.status === "in_progress") {
        updates.treatmentAccepted = true;
        updates.attributionStage = "treatment_accepted";
        updates.conversionStatus = "pending";
      } else if (relevantPlan.status === "proposed") {
        updates.attributionStage = "appointment_completed";
        updates.conversionStatus = "pending";
      }

      // Map scheduled procedures
      if (relevantPlan.phases?.length > 0) {
        const procedures: Array<{ code: string; description: string; estimatedValue: number }> = [];
        for (const phase of relevantPlan.phases) {
          if (phase.procedures) {
            for (const proc of phase.procedures) {
              procedures.push({
                code: proc.code || "",
                description: proc.description || "",
                estimatedValue: proc.fee || 0,
              });
            }
          }
        }
        if (procedures.length > 0) updates.scheduledProcedures = procedures;
      }

      const updated = await storage.updateCallRevenue(orgId, callId, updates);

      logPhiAccess({ ...auditContext(req), event: "ehr_revenue_sync", resourceType: "revenue", resourceId: callId });
      logger.info({ orgId, callId, ehrPatientId }, "Revenue synced from EHR");

      res.json({
        revenue: updated,
        ehrSynced: true,
        treatmentPlanStatus: relevantPlan.status,
        treatmentPlansFound: treatmentPlans.length,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to sync revenue from EHR");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to sync from EHR"));
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

      // Build weekly buckets for the last 12 weeks (Monday-aligned)
      const now = new Date();
      const weeks: Array<{ weekStart: string; estimated: number; actual: number; count: number; converted: number }> = [];
      // Normalize to most recent Monday: dayOfWeek 0=Sun(→-6), 1=Mon(→0), ..., 6=Sat(→-5)
      const dayOfWeek = now.getDay();
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      for (let i = 11; i >= 0; i--) {
        const start = new Date(now);
        start.setDate(start.getDate() - daysSinceMonday - (i * 7));
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
