import type { Express } from "express";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { decryptField, encryptField } from "../services/phi-encryption";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";

/**
 * Middleware to ensure the org has clinical documentation enabled.
 */
function requireClinicalPlan() {
  return async (req: any, res: any, next: any) => {
    const orgId = req.orgId;
    if (!orgId) return next();

    try {
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];

      if (!plan?.limits?.clinicalDocumentationEnabled) {
        res.status(403).json({
          message: "Clinical documentation requires a Clinical plan",
          code: "OBS-BILLING-010",
          upgrade: true,
        });
        return;
      }
      next();
    } catch {
      next();
    }
  };
}

export function registerClinicalRoutes(app: Express): void {
  // Get clinical notes for a specific call
  app.get("/api/clinical/notes/:callId", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis) {
        res.status(404).json({ message: "Analysis not found" });
        return;
      }

      const cn = (analysis as any).clinicalNote;
      if (!cn) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "view_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
      });

      // Decrypt PHI fields
      if (typeof cn.subjective === "string") cn.subjective = decryptField(cn.subjective);
      if (typeof cn.objective === "string") cn.objective = decryptField(cn.objective);
      if (typeof cn.assessment === "string") cn.assessment = decryptField(cn.assessment);
      if (typeof cn.hpiNarrative === "string") cn.hpiNarrative = decryptField(cn.hpiNarrative);
      if (typeof cn.chiefComplaint === "string") cn.chiefComplaint = decryptField(cn.chiefComplaint);

      res.json(cn);
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical note");
      res.status(500).json({ message: "Failed to get clinical note" });
    }
  });

  // Provider attestation — mark clinical note as reviewed and attested
  app.post("/api/clinical/notes/:callId/attest", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      analysis.clinicalNote.providerAttested = true;
      analysis.clinicalNote.attestedBy = (req as any).user?.name || (req as any).user?.username;
      analysis.clinicalNote.attestedAt = new Date().toISOString();

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "attest_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: "Provider attested clinical note",
      });

      logger.info({ callId: req.params.callId }, "Clinical note attested by provider");
      res.json({ success: true, attestedAt: analysis.clinicalNote.attestedAt });
    } catch (error) {
      logger.error({ err: error }, "Failed to attest clinical note");
      res.status(500).json({ message: "Failed to attest clinical note" });
    }
  });

  // Record patient consent
  app.post("/api/clinical/notes/:callId/consent", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const { consentObtained } = req.body;
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      analysis.clinicalNote.patientConsentObtained = !!consentObtained;
      analysis.clinicalNote.consentRecordedBy = (req as any).user?.name || (req as any).user?.username;
      analysis.clinicalNote.consentRecordedAt = new Date().toISOString();

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "record_patient_consent",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Consent: ${consentObtained}`,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, "Failed to record patient consent");
      res.status(500).json({ message: "Failed to record patient consent" });
    }
  });

  // Edit clinical note fields (provider correction before attestation)
  app.patch("/api/clinical/notes/:callId", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      // Don't allow editing attested notes without re-attestation
      if (analysis.clinicalNote.providerAttested) {
        analysis.clinicalNote.providerAttested = false;
        analysis.clinicalNote.attestedBy = undefined;
        analysis.clinicalNote.attestedAt = undefined;
      }

      const allowedFields = [
        "chiefComplaint", "subjective", "objective", "assessment", "plan",
        "hpiNarrative", "reviewOfSystems", "differentialDiagnoses",
        "icd10Codes", "cptCodes", "cdtCodes", "prescriptions", "followUp",
        "toothNumbers", "quadrants", "periodontalFindings", "treatmentPhases",
        "format", "specialty",
      ];

      const edits: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          edits[field] = req.body[field];
        }
      }

      // Encrypt PHI fields before storage
      const phiFields = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint"];
      for (const field of phiFields) {
        if (typeof edits[field] === "string") {
          analysis.clinicalNote[field] = encryptField(edits[field] as string);
          delete edits[field]; // Already handled
        }
      }

      // Apply non-PHI edits directly
      Object.assign(analysis.clinicalNote, edits);

      // Track edit history
      if (!analysis.clinicalNote.editHistory) {
        analysis.clinicalNote.editHistory = [];
      }
      analysis.clinicalNote.editHistory.push({
        editedBy: (req as any).user?.name || (req as any).user?.username,
        editedAt: new Date().toISOString(),
        fieldsChanged: Object.keys(req.body).filter(k => allowedFields.includes(k)),
      });

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "edit_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Edited fields: ${Object.keys(edits).join(", ")}`,
      });

      logger.info({ callId: req.params.callId, fields: Object.keys(edits) }, "Clinical note edited");
      res.json({ success: true, message: "Clinical note updated. Re-attestation required." });
    } catch (error) {
      logger.error({ err: error }, "Failed to edit clinical note");
      res.status(500).json({ message: "Failed to edit clinical note" });
    }
  });

  // Get/update provider style preferences for clinical note generation
  app.get("/api/clinical/provider-preferences", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const userId = (req as any).user?.id || "unknown";
      const prefs = (org?.settings as any)?.providerStylePreferences?.[userId] || {};
      res.json(prefs);
    } catch (error) {
      logger.error({ err: error }, "Failed to get provider preferences");
      res.status(500).json({ message: "Failed to get provider preferences" });
    }
  });

  app.patch("/api/clinical/provider-preferences", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      const userId = (req as any).user?.id || "unknown";
      const allowedPrefFields = [
        "noteFormat", "sectionOrder", "abbreviationLevel",
        "includeNegativePertinents", "defaultSpecialty",
        "customSections", "templateOverrides",
      ];

      const updates: Record<string, unknown> = {};
      for (const field of allowedPrefFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      const settings = org.settings || {};
      const allPrefs = (settings as any).providerStylePreferences || {};
      allPrefs[userId] = { ...allPrefs[userId], ...updates };

      await storage.updateOrganization(req.orgId!, {
        settings: { ...settings, providerStylePreferences: allPrefs } as any,
      });

      logger.info({ orgId: req.orgId, userId, fields: Object.keys(updates) }, "Provider style preferences updated");
      res.json({ success: true, preferences: allPrefs[userId] });
    } catch (error) {
      logger.error({ err: error }, "Failed to update provider preferences");
      res.status(500).json({ message: "Failed to update provider preferences" });
    }
  });

  // Get clinical dashboard metrics
  app.get("/api/clinical/metrics", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const calls = await storage.getCallsWithDetails(req.orgId!, {});
      const clinicalCategories = [
        "clinical_encounter", "telemedicine",
        "dental_encounter", "dental_consultation",
      ];
      const clinicalCalls = calls.filter((c: any) =>
        clinicalCategories.includes(c.callCategory)
      );

      const completed = clinicalCalls.filter((c: any) => c.status === "completed");
      const withNotes = completed.filter((c: any) => c.analysis?.clinicalNote);
      const attested = withNotes.filter((c: any) => c.analysis?.clinicalNote?.providerAttested);

      const avgCompleteness = withNotes.length > 0
        ? withNotes.reduce((sum: number, c: any) => sum + (c.analysis?.clinicalNote?.documentationCompleteness || 0), 0) / withNotes.length
        : 0;

      const avgAccuracy = withNotes.length > 0
        ? withNotes.reduce((sum: number, c: any) => sum + (c.analysis?.clinicalNote?.clinicalAccuracy || 0), 0) / withNotes.length
        : 0;

      res.json({
        totalEncounters: clinicalCalls.length,
        completedEncounters: completed.length,
        notesGenerated: withNotes.length,
        notesAttested: attested.length,
        pendingAttestation: withNotes.length - attested.length,
        avgDocumentationCompleteness: Math.round(avgCompleteness * 10) / 10,
        avgClinicalAccuracy: Math.round(avgAccuracy * 10) / 10,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical metrics");
      res.status(500).json({ message: "Failed to get clinical metrics" });
    }
  });
}
