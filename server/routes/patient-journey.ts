/**
 * Patient Journey Analytics Routes
 *
 * Connects multiple calls from the same patient across visits to build
 * a longitudinal view. Uses employee assignment + call analysis to detect
 * returning patients and track their journey through the practice.
 *
 * Patient identity is inferred from:
 * 1. AI-detected patient name in call analysis
 * 2. Revenue records with the same patient name
 * 3. Clinical notes with matching patient identifiers
 *
 * All patient data is org-scoped and PHI-protected.
 */
import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { logPhiAccess, auditContext } from "../services/audit-log";

interface PatientJourney {
  patientKey: string; // normalized identifier (name-based)
  patientName: string;
  callCount: number;
  firstCallDate: string;
  lastCallDate: string;
  calls: Array<{
    callId: string;
    fileName: string | null;
    date: string | null;
    category: string | null;
    employeeName: string | null;
    performanceScore: number | null;
    sentiment: string | null;
    hasRevenue: boolean;
    hasClinicalNote: boolean;
  }>;
  totalEstimatedRevenue: number;
  totalActualRevenue: number;
  conversionStatus: string | null;
  touchpointCount: number;
  avgPerformanceScore: number;
  sentimentTrend: Array<{ date: string; sentiment: string }>;
}

function normalizePatientKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

export function registerPatientJourneyRoutes(app: Express) {
  /**
   * GET /api/patient-journeys — List patient journeys for the org.
   * Groups calls by patient identity to build longitudinal views.
   */
  app.get("/api/patient-journeys", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      logPhiAccess({ ...auditContext(req), event: "view_patient_journeys", resourceType: "patient_journey", resourceId: orgId });

      const [calls, employees, revenues] = await Promise.all([
        storage.getCallSummaries(orgId, { status: "completed", limit: 1000 }),
        storage.getAllEmployees(orgId),
        storage.listCallRevenues(orgId),
      ]);

      const employeeMap = new Map(employees.map(e => [e.id, e]));
      const revenueMap = new Map(revenues.map(r => [r.callId, r]));

      // Build patient identity map from multiple sources
      const journeys = new Map<string, PatientJourney>();

      for (const call of calls) {
        // Source 1: Revenue record patient name
        const revenue = revenueMap.get(call.id);
        let patientName: string | null = null;

        if (revenue) {
          // Revenue records from insurance narratives often have patient names
          patientName = (revenue as any).patientName || null;
        }

        // Source 2: Clinical note patient reference
        const clinicalNote = call.analysis?.clinicalNote as Record<string, unknown> | undefined;
        if (!patientName && clinicalNote) {
          patientName = (clinicalNote.patientName as string) || null;
        }

        // Source 3: AI-detected agent/patient from analysis summary
        if (!patientName && call.analysis?.summary) {
          const summary = String(call.analysis.summary);
          // Look for "Patient: Name" or "caller Name" patterns
          const match = summary.match(/(?:patient|caller|customer)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i);
          if (match) patientName = match[1];
        }

        if (!patientName) continue; // Can't identify patient

        const key = normalizePatientKey(patientName);
        if (key.length < 3) continue; // Too short to be a real name

        if (!journeys.has(key)) {
          journeys.set(key, {
            patientKey: key,
            patientName,
            callCount: 0,
            firstCallDate: call.uploadedAt || "",
            lastCallDate: call.uploadedAt || "",
            calls: [],
            totalEstimatedRevenue: 0,
            totalActualRevenue: 0,
            conversionStatus: null,
            touchpointCount: 0,
            avgPerformanceScore: 0,
            sentimentTrend: [],
          });
        }

        const journey = journeys.get(key)!;
        journey.callCount++;
        if (call.uploadedAt && call.uploadedAt < journey.firstCallDate) journey.firstCallDate = call.uploadedAt;
        if (call.uploadedAt && call.uploadedAt > journey.lastCallDate) journey.lastCallDate = call.uploadedAt;

        const score = call.analysis?.performanceScore ? parseFloat(String(call.analysis.performanceScore)) : null;
        const emp = call.employeeId ? employeeMap.get(call.employeeId) : undefined;

        journey.calls.push({
          callId: call.id,
          fileName: call.fileName || null,
          date: call.uploadedAt || null,
          category: call.callCategory || null,
          employeeName: emp?.name || null,
          performanceScore: score,
          sentiment: call.sentiment?.overallSentiment || null,
          hasRevenue: !!revenue,
          hasClinicalNote: !!clinicalNote,
        });

        if (revenue) {
          journey.totalEstimatedRevenue += (revenue.estimatedRevenue || 0);
          journey.totalActualRevenue += (revenue.actualRevenue || 0);
          if (revenue.conversionStatus === "converted") journey.conversionStatus = "converted";
          else if (!journey.conversionStatus && revenue.conversionStatus !== "unknown") {
            journey.conversionStatus = revenue.conversionStatus;
          }
        }

        if (call.sentiment?.overallSentiment && call.uploadedAt) {
          journey.sentimentTrend.push({
            date: call.uploadedAt,
            sentiment: call.sentiment.overallSentiment,
          });
        }

        journey.touchpointCount++;
      }

      // Compute averages and sort
      const result: PatientJourney[] = [];
      for (const journey of Array.from(journeys.values())) {
        if (journey.callCount < 2) continue; // Only show multi-visit patients

        const scores = journey.calls
          .map(c => c.performanceScore)
          .filter((s): s is number => s !== null);
        journey.avgPerformanceScore = scores.length > 0
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
          : 0;

        // Sort calls chronologically
        journey.calls.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
        journey.sentimentTrend.sort((a, b) => a.date.localeCompare(b.date));

        journey.totalEstimatedRevenue = Math.round(journey.totalEstimatedRevenue * 100) / 100;
        journey.totalActualRevenue = Math.round(journey.totalActualRevenue * 100) / 100;

        result.push(journey);
      }

      // Sort by most recent activity
      result.sort((a, b) => b.lastCallDate.localeCompare(a.lastCallDate));

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      res.json({
        journeys: result.slice(offset, offset + limit),
        total: result.length,
        multiVisitPatientCount: result.length,
        totalPatientsIdentified: journeys.size,
        avgTouchpoints: result.length > 0
          ? Math.round((result.reduce((s, j) => s + j.touchpointCount, 0) / result.length) * 10) / 10
          : 0,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get patient journeys");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get patient journeys"));
    }
  });

  /**
   * GET /api/patient-journeys/insights — Aggregate patient journey insights.
   * Shows retention patterns, sentiment trends across repeat visits, and
   * which employees handle the most returning patients.
   */
  app.get("/api/patient-journeys/insights", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const [calls, revenues] = await Promise.all([
        storage.getCallSummaries(orgId, { status: "completed", limit: 1000 }),
        storage.listCallRevenues(orgId),
      ]);

      const revenueMap = new Map(revenues.map(r => [r.callId, r]));

      // Build patient groups
      const patients = new Map<string, { callCount: number; scores: number[]; sentiments: string[]; revenue: number; dates: string[] }>();

      for (const call of calls) {
        const revenue = revenueMap.get(call.id);
        let patientName: string | null = null;
        if (revenue) patientName = (revenue as any).patientName || null;
        const clinicalNote = call.analysis?.clinicalNote as Record<string, unknown> | undefined;
        if (!patientName && clinicalNote) patientName = (clinicalNote.patientName as string) || null;
        if (!patientName) continue;

        const key = normalizePatientKey(patientName);
        if (key.length < 3) continue;

        if (!patients.has(key)) {
          patients.set(key, { callCount: 0, scores: [], sentiments: [], revenue: 0, dates: [] });
        }
        const p = patients.get(key)!;
        p.callCount++;
        const score = call.analysis?.performanceScore ? parseFloat(String(call.analysis.performanceScore)) : null;
        if (score !== null && !isNaN(score)) p.scores.push(score);
        if (call.sentiment?.overallSentiment) p.sentiments.push(call.sentiment.overallSentiment);
        if (revenue) p.revenue += (revenue.actualRevenue || revenue.estimatedRevenue || 0);
        if (call.uploadedAt) p.dates.push(call.uploadedAt);
      }

      const multiVisit = Array.from(patients.values()).filter(p => p.callCount >= 2);
      const singleVisit = Array.from(patients.values()).filter(p => p.callCount === 1);

      // Sentiment improvement on return visits
      let sentimentImproved = 0;
      let sentimentDeclined = 0;
      for (const p of multiVisit) {
        if (p.sentiments.length >= 2) {
          const first = p.sentiments[0];
          const last = p.sentiments[p.sentiments.length - 1];
          if (first !== "positive" && last === "positive") sentimentImproved++;
          if (first === "positive" && last !== "positive") sentimentDeclined++;
        }
      }

      // Revenue comparison: multi-visit vs single-visit
      const multiVisitRevenue = multiVisit.reduce((s, p) => s + p.revenue, 0);
      const singleVisitRevenue = singleVisit.reduce((s, p) => s + p.revenue, 0);
      const avgMultiVisitRevenue = multiVisit.length > 0 ? multiVisitRevenue / multiVisit.length : 0;
      const avgSingleVisitRevenue = singleVisit.length > 0 ? singleVisitRevenue / singleVisit.length : 0;

      // Average days between visits for returning patients
      const visitGaps: number[] = [];
      for (const p of multiVisit) {
        const sorted = p.dates.sort();
        for (let i = 1; i < sorted.length; i++) {
          const gap = (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / (1000 * 60 * 60 * 24);
          if (gap > 0 && gap < 365) visitGaps.push(gap);
        }
      }
      const avgDaysBetweenVisits = visitGaps.length > 0
        ? Math.round(visitGaps.reduce((a, b) => a + b, 0) / visitGaps.length)
        : null;

      res.json({
        totalPatientsIdentified: patients.size,
        multiVisitPatients: multiVisit.length,
        singleVisitPatients: singleVisit.length,
        retentionRate: patients.size > 0 ? Math.round((multiVisit.length / patients.size) * 10000) / 100 : 0,
        avgVisitsPerReturnPatient: multiVisit.length > 0
          ? Math.round((multiVisit.reduce((s, p) => s + p.callCount, 0) / multiVisit.length) * 10) / 10
          : 0,
        avgDaysBetweenVisits,
        sentimentOnReturnVisits: {
          improved: sentimentImproved,
          declined: sentimentDeclined,
          stable: multiVisit.length - sentimentImproved - sentimentDeclined,
        },
        revenueComparison: {
          avgRevenuePerMultiVisitPatient: Math.round(avgMultiVisitRevenue * 100) / 100,
          avgRevenuePerSingleVisitPatient: Math.round(avgSingleVisitRevenue * 100) / 100,
          multiVisitRevenueMultiplier: avgSingleVisitRevenue > 0
            ? Math.round((avgMultiVisitRevenue / avgSingleVisitRevenue) * 10) / 10
            : null,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get patient journey insights");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get insights"));
    }
  });
}
