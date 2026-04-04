/**
 * Clinical analytics routes: style learning, population analytics,
 * EHR prefill suggestions, custom provider templates, quality feedback.
 *
 * Extracted from clinical.ts to keep route files under ~800 lines.
 * All routes require clinical documentation plan.
 */
import type { Express, RequestHandler } from "express";
import { requireAuth, requireRole, injectOrgContext, getCachedOrganization, invalidateOrgCache } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { decryptField } from "../services/phi-encryption";
import { analyzeProviderStyle, type ClinicalNote as StyleClinicalNote } from "../services/style-learning";
import type { OrgSettings } from "@shared/schema";

export function registerClinicalAnalyticsRoutes(app: Express, requireClinicalPlan: () => RequestHandler): void {
  // ==================== STYLE LEARNING ====================

  app.post(
    "/api/clinical/style-learning/analyze",
    requireAuth, injectOrgContext, requireClinicalPlan(),
    async (req, res) => {
      try {
        const userId = req.user?.id || "unknown";
        const clinicalCategories = ["clinical_encounter", "telemedicine", "dental_encounter", "dental_consultation"];

        const noteRows = await storage.getAttestedClinicalNotes?.(req.orgId!, clinicalCategories);

        const attestedNotes: StyleClinicalNote[] = [];
        const userName = req.user?.name || req.user?.username;

        for (const row of noteRows || []) {
          const cn = row.clinicalNote;
          if (!cn?.providerAttested) continue;
          if (cn.attestedBy && cn.attestedBy !== userName) continue;

          const sections: Record<string, string> = {};
          try {
            if (cn.subjective) sections.subjective = decryptField(cn.subjective);
            if (cn.objective) sections.objective = decryptField(cn.objective);
            if (cn.assessment) sections.assessment = decryptField(cn.assessment);
            if (cn.hpiNarrative) sections.hpiNarrative = decryptField(cn.hpiNarrative);
          } catch (decryptErr) {
            logger.warn({ err: decryptErr }, "PHI decryption failed for note in style analysis — skipping note");
            continue;
          }
          if (cn.plan) sections.plan = Array.isArray(cn.plan) ? cn.plan.join("\n") : cn.plan;
          if (cn.data) sections.data = cn.data;
          if (cn.behavior) sections.behavior = cn.behavior;
          if (cn.intervention) sections.intervention = cn.intervention;
          if (cn.response) sections.response = cn.response;

          attestedNotes.push({
            attestedAt: cn.attestedAt || row.uploadedAt || new Date().toISOString(),
            specialty: cn.specialty,
            sections,
          });
        }

        const totalAttempted = (noteRows || []).filter((r: any) => r.clinicalNote?.providerAttested).length;
        const skippedDecryptionFailures = totalAttempted - attestedNotes.length;

        const result = analyzeProviderStyle(req.orgId!, userId, attestedNotes);

        if (!result) {
          const detail = skippedDecryptionFailures > 0
            ? ` (${skippedDecryptionFailures} note(s) skipped due to decryption failures — check PHI encryption key)`
            : "";
          res.json({
            success: false,
            message: `Need at least 3 attested notes for style analysis (found ${attestedNotes.length})${detail}`,
            noteCount: attestedNotes.length,
            skippedDecryptionFailures,
          });
          return;
        }

        logPhiAccess({
          ...auditContext(req),
          event: "clinical_style_analysis",
          resourceType: "clinical_note",
          detail: `Analyzed ${attestedNotes.length} attested notes for style learning`,
        });
        res.json({ success: true, analysis: result, noteCount: attestedNotes.length });
      } catch (error) {
        logger.error({ err: error }, "Failed to analyze provider style");
        res.status(500).json({ message: "Failed to analyze provider style" });
      }
    },
  );

  app.post(
    "/api/clinical/style-learning/apply",
    requireAuth, injectOrgContext, requireClinicalPlan(),
    async (req, res) => {
      try {
        const { preferences } = req.body;
        if (!preferences || typeof preferences !== "object") {
          res.status(400).json({ message: "preferences object is required" });
          return;
        }

        const org = await getCachedOrganization(req.orgId!);
        if (!org) {
          res.status(404).json({ message: "Organization not found" });
          return;
        }

        const userId = req.user?.id || "unknown";
        const settings: Partial<OrgSettings> = org.settings || {};
        const allPrefs: Record<string, Record<string, unknown>> = (settings.providerStylePreferences as Record<string, Record<string, unknown>>) || {};
        allPrefs[userId] = { ...allPrefs[userId], ...preferences, learnedAt: new Date().toISOString() };

        await storage.updateOrganization(req.orgId!, {
          settings: { ...settings, providerStylePreferences: allPrefs } as OrgSettings,
        });
        invalidateOrgCache(req.orgId!);

        logPhiAccess({
          ...auditContext(req),
          event: "org_settings_update",
          resourceType: "organization",
          resourceId: req.orgId!,
          detail: "Applied learned style preferences",
        });

        logger.info({ orgId: req.orgId, userId }, "Applied learned style preferences");
        res.json({ success: true, preferences: allPrefs[userId] });
      } catch (error) {
        logger.error({ err: error }, "Failed to apply learned preferences");
        res.status(500).json({ message: "Failed to apply learned preferences" });
      }
    },
  );

  // ==================== POPULATION ANALYTICS ====================

  app.get(
    "/api/clinical/analytics/population",
    requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("admin"),
    async (req, res) => {
      try {
        const orgId = req.orgId!;
        const clinicalCategories = ["clinical_encounter", "telemedicine", "dental_encounter", "dental_consultation"];

        const clinicalRows = await storage.getClinicalCallMetrics?.(orgId, clinicalCategories);
        if (!clinicalRows) {
          res.json({ totalNotes: 0, avgPainScale: null, avgBmi: null, avgBloodPressureSystolic: null, avgBloodPressureDiastolic: null, topIcd10Codes: [], topMedications: [], vitalsPresent: 0, medicationsPresent: 0 });
          return;
        }

        const notesWithData = clinicalRows.notesWithData.filter((n) => n.clinicalNote);

        let painScaleTotal = 0, painScaleCount = 0, bmiTotal = 0, bmiCount = 0;
        let bpSysTotal = 0, bpSysCount = 0, bpDiaTotal = 0, bpDiaCount = 0;
        let vitalsPresent = 0, medicationsPresent = 0;
        const icd10Freq: Record<string, number> = {};
        const medFreq: Record<string, number> = {};

        for (const n of notesWithData) {
          const cn = n.clinicalNote as any;
          if (!cn) continue;

          const sd = cn.structuredData;
          if (sd?.vitals) {
            vitalsPresent++;
            if (typeof sd.vitals.painScale === "number") { painScaleTotal += sd.vitals.painScale; painScaleCount++; }
            if (typeof sd.vitals.bmi === "number") { bmiTotal += sd.vitals.bmi; bmiCount++; }
            if (typeof sd.vitals.bloodPressureSystolic === "number") { bpSysTotal += sd.vitals.bloodPressureSystolic; bpSysCount++; }
            if (typeof sd.vitals.bloodPressureDiastolic === "number") { bpDiaTotal += sd.vitals.bloodPressureDiastolic; bpDiaCount++; }
          }
          if (sd?.medications?.length) {
            medicationsPresent++;
            for (const med of sd.medications) { if (med.name) medFreq[med.name] = (medFreq[med.name] || 0) + 1; }
          }
          const codes = cn.icd10Codes || [];
          for (const code of codes) { if (code?.code) icd10Freq[code.code] = (icd10Freq[code.code] || 0) + 1; }
        }

        const topIcd10Codes = Object.entries(icd10Freq).sort(([, a], [, b]) => b - a).slice(0, 10).map(([code, count]) => ({ code, count }));
        const topMedications = Object.entries(medFreq).sort(([, a], [, b]) => b - a).slice(0, 10).map(([name, count]) => ({ name, count }));

        logPhiAccess({ ...auditContext(req), event: "view_population_analytics", resourceType: "clinical_metrics", detail: `Population analytics: ${notesWithData.length} notes aggregated` });

        res.json({
          totalNotes: notesWithData.length,
          avgPainScale: painScaleCount > 0 ? Math.round((painScaleTotal / painScaleCount) * 10) / 10 : null,
          avgBmi: bmiCount > 0 ? Math.round((bmiTotal / bmiCount) * 10) / 10 : null,
          avgBloodPressureSystolic: bpSysCount > 0 ? Math.round(bpSysTotal / bpSysCount) : null,
          avgBloodPressureDiastolic: bpDiaCount > 0 ? Math.round(bpDiaTotal / bpDiaCount) : null,
          topIcd10Codes, topMedications, vitalsPresent, medicationsPresent,
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to get population analytics");
        res.status(500).json({ message: "Failed to get population analytics" });
      }
    },
  );

  // ==================== EHR PREFILL SUGGESTIONS ====================

  app.get(
    "/api/clinical/notes/:callId/prefill-suggestions",
    requireAuth, injectOrgContext, requireClinicalPlan(),
    async (req, res) => {
      try {
        const org = await getCachedOrganization(req.orgId!);
        const ehrConfig = (org?.settings as OrgSettings)?.ehrConfig;

        if (!ehrConfig?.enabled || !ehrConfig?.system) {
          res.json({ medications: [], allergies: [], chiefComplaintHistory: [], ehrConnected: false });
          return;
        }

        const call = await storage.getCall(req.orgId!, req.params.callId);
        if (!call) {
          res.status(404).json({ message: "Call not found" });
          return;
        }

        res.json({
          medications: [], allergies: [], chiefComplaintHistory: [],
          ehrConnected: true,
          note: "Patient lookup from EHR requires patient ID association. Use /api/ehr/patients to search by name.",
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to get prefill suggestions");
        res.status(500).json({ message: "Failed to get prefill suggestions" });
      }
    },
  );

  // ==================== PROVIDER TEMPLATES (CUSTOM) ====================

  app.get("/api/clinical/templates/my", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ message: "User ID required" }); return; }
      const templates = await storage.getProviderTemplates(req.orgId!, userId);
      res.json(templates);
    } catch (error) {
      logger.error({ err: error }, "Failed to list provider templates");
      res.status(500).json({ message: "Failed to list provider templates" });
    }
  });

  app.post(
    "/api/clinical/templates/custom",
    requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"),
    async (req, res) => {
      try {
        const { name, specialty, format, category, description, sections, defaultCodes, tags, isDefault } = req.body;
        if (!name || typeof name !== "string" || !name.trim()) { res.status(400).json({ message: "Template name is required" }); return; }
        if (name.length > 255) { res.status(400).json({ message: "Template name must be under 255 characters" }); return; }
        const userId = req.user?.id;
        if (!userId) { res.status(401).json({ message: "User ID required" }); return; }

        const template = await storage.createProviderTemplate(req.orgId!, {
          userId, name: name.trim(),
          specialty: typeof specialty === "string" ? specialty : undefined,
          format: typeof format === "string" ? format : undefined,
          category: typeof category === "string" ? category : undefined,
          description: typeof description === "string" ? description.slice(0, 2000) : undefined,
          sections: sections && typeof sections === "object" ? sections : undefined,
          defaultCodes: defaultCodes && typeof defaultCodes === "object" ? defaultCodes : undefined,
          tags: Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === "string").slice(0, 20) : undefined,
          isDefault: isDefault === true,
        });

        logger.info({ orgId: req.orgId, userId, templateId: template.id }, "Provider template created");
        res.status(201).json(template);
      } catch (error) {
        logger.error({ err: error }, "Failed to create provider template");
        res.status(500).json({ message: "Failed to create provider template" });
      }
    },
  );

  app.patch(
    "/api/clinical/templates/custom/:id",
    requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"),
    async (req, res) => {
      try {
        const userId = req.user?.id;
        if (!userId) { res.status(401).json({ message: "User ID required" }); return; }

        const allowed = ["name", "specialty", "format", "category", "description", "sections", "defaultCodes", "tags", "isDefault"];
        const updates: Record<string, unknown> = {};
        for (const key of allowed) { if (req.body[key] !== undefined) updates[key] = req.body[key]; }
        if (updates.name && (typeof updates.name !== "string" || !updates.name.trim())) { res.status(400).json({ message: "Template name must be a non-empty string" }); return; }

        const updated = await storage.updateProviderTemplate(req.orgId!, req.params.id, userId, updates);
        if (!updated) { res.status(404).json({ message: "Template not found or you do not have permission to edit it" }); return; }
        res.json(updated);
      } catch (error) {
        logger.error({ err: error }, "Failed to update provider template");
        res.status(500).json({ message: "Failed to update provider template" });
      }
    },
  );

  app.delete(
    "/api/clinical/templates/custom/:id",
    requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"),
    async (req, res) => {
      try {
        const userId = req.user?.id;
        if (!userId) { res.status(401).json({ message: "User ID required" }); return; }
        const deleted = await storage.deleteProviderTemplate(req.orgId!, req.params.id, userId);
        if (!deleted) { res.status(404).json({ message: "Template not found or you do not have permission to delete it" }); return; }
        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, "Failed to delete provider template");
        res.status(500).json({ message: "Failed to delete provider template" });
      }
    },
  );
}
