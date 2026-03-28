import type { Express } from "express";
import { randomUUID } from "crypto";
import { requireAuth, requireRole, injectOrgContext, getCachedOrganization, invalidateOrgCache } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { decryptField, encryptField, decryptClinicalNotePhi } from "../services/phi-encryption";
import { getOrgAIProvider } from "../services/ai-factory";
import { parseJsonResponse, type PromptTemplateConfig } from "../services/ai-provider";
import { sanitizeStylePreferences } from "../services/clinical-validation";
import { PLAN_DEFINITIONS, type PlanTier, type OrgSettings, type ClinicalNote } from "@shared/schema";
import { analyzeProviderStyle, type ClinicalNote as StyleClinicalNote } from "../services/style-learning";
import {
  getTemplatesBySpecialty, getTemplatesByFormat, getTemplatesByCategory,
  getTemplateById, searchTemplates, CLINICAL_NOTE_TEMPLATES,
} from "../services/clinical-templates";
import {
  validateClinicalNote, getRecommendedFormat, getRequiredSections,
  validateClinicalEditFields, VALID_NOTE_FORMATS, computeQualityScores,
} from "../services/clinical-validation";
import { buildFhirBundle } from "../services/fhir";
import { extractStructuredDataFromSections } from "../services/clinical-extraction";

/**
 * Middleware to ensure the org has clinical documentation enabled.
 */
function requireClinicalPlan() {
  return async (req: any, res: any, next: any) => {
    const orgId = req.orgId;
    if (!orgId) {
      res.status(403).json({ message: "Organization context required", code: "OBS-AUTH-001" });
      return;
    }

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
    } catch (err) {
      logger.error({ err }, "Clinical plan check failed, denying access");
      res.status(500).json({ message: "Unable to verify clinical plan", code: "OBS-BILLING-011" });
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

      const cn = analysis.clinicalNote;
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

      // Decrypt PHI fields before sending to client.
      // decryptClinicalNotePhi() calls decryptField() which throws on failure —
      // catch here to return a clear HIPAA error rather than a generic 500.
      try {
        decryptClinicalNotePhi(analysis as Record<string, unknown>, {
          userId: req.user?.id, orgId: req.orgId, resourceId: req.params.callId, resourceType: "clinical_note",
        });
      } catch (decryptErr) {
        logger.error({ err: decryptErr, callId: req.params.callId }, "PHI decryption failed for clinical note");
        logPhiAccess({
          ...auditContext(req),
          event: "phi_decryption_failure",
          resourceType: "clinical_note",
          resourceId: req.params.callId,
          detail: "Decryption failed — key mismatch or data corruption",
        });
        res.status(500).json({
          message: "Unable to decrypt clinical note. PHI encryption key may be misconfigured.",
          code: "OBS-PHI-DECRYPT-001",
        });
        return;
      }

      // Run validation and attach warnings + weighted completeness
      const validation = validateClinicalNote(cn as Record<string, unknown>);

      // Compute quality score breakdown
      const qualityScores = computeQualityScores(cn as Record<string, unknown>);

      // Extract structured data from decrypted note sections for display
      const structuredDataExtracted = extractStructuredDataFromSections({
        objective: typeof (cn as any).objective === "string" ? (cn as any).objective : undefined,
        subjective: typeof (cn as any).subjective === "string" ? (cn as any).subjective : undefined,
        plan: (cn as any).plan,
      });

      const enriched = {
        ...cn,
        validationWarnings: validation.warnings.length > 0 ? validation.warnings : undefined,
        weightedCompleteness: validation.weightedCompleteness,
        sectionDepth: validation.sectionDepth,
        qualityScoreBreakdown: qualityScores,
        // Merge server-extracted structured data with any stored structuredData
        structuredData: (cn as any).structuredData || (Object.keys(structuredDataExtracted).length > 0 ? structuredDataExtracted : undefined),
      };

      res.json(enriched);
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical note");
      res.status(500).json({ message: "Failed to get clinical note" });
    }
  });

  // Provider attestation — mark clinical note as reviewed and attested
  app.post("/api/clinical/notes/:callId/attest", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      // Verify the attesting user is the provider who should attest this note.
      // Admins can attest on behalf of others (override); managers must be the
      // provider associated with the encounter or the one who last edited it.
      const currentUserName = req.user?.name || req.user?.username;
      const currentUserRole = req.user?.role;
      const noteCreator = analysis.clinicalNote.attestedBy // previously attested by
        || analysis.clinicalNote.editHistory?.at(-1)?.editedBy; // or last editor

      if (currentUserRole !== "admin" && noteCreator && noteCreator !== currentUserName) {
        res.status(403).json({
          message: "Only the treating provider or an admin can attest this clinical note",
          attestedBy: noteCreator,
        });
        return;
      }

      analysis.clinicalNote.providerAttested = true;
      analysis.clinicalNote.attestedBy = currentUserName;
      analysis.clinicalNote.attestedById = req.user?.id;
      analysis.clinicalNote.attestedAt = new Date().toISOString();
      // Record NPI if provided in the request — encrypted as PHI
      if (req.body.npiNumber) {
        analysis.clinicalNote.attestedNpi = encryptField(req.body.npiNumber);
      }

      // Check if org requires co-signature after attestation
      const orgForAttest = await getCachedOrganization(req.orgId!);
      const requiresCosig = (orgForAttest?.settings as OrgSettings)?.requiresCosignature === true;
      if (requiresCosig) {
        analysis.clinicalNote.cosignatureRequired = true;
      }

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "attest_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Provider ${currentUserName} attested clinical note`,
      });

      logger.info({ callId: req.params.callId }, "Clinical note attested by provider");
      res.json({
        success: true,
        attestedAt: analysis.clinicalNote.attestedAt,
        cosignatureRequired: requiresCosig,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to attest clinical note");
      res.status(500).json({ message: "Failed to attest clinical note" });
    }
  });

  // Record patient consent
  app.post("/api/clinical/notes/:callId/consent", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const { consentObtained } = req.body;
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      const previousConsent = analysis.clinicalNote.patientConsentObtained;
      analysis.clinicalNote.patientConsentObtained = !!consentObtained;
      analysis.clinicalNote.consentRecordedBy = req.user?.name || req.user?.username;
      analysis.clinicalNote.consentRecordedAt = new Date().toISOString();

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "record_patient_consent",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Consent: ${previousConsent} → ${!!consentObtained}, recorded by ${analysis.clinicalNote.consentRecordedBy} (${req.user?.id})`,
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
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      // Optimistic locking: version is REQUIRED when editing attested notes
      const currentVersion = analysis.clinicalNote.version || 0;
      if (analysis.clinicalNote.providerAttested && req.body.version === undefined) {
        res.status(400).json({
          message: "Version field is required when editing an attested note. Fetch the note first to get the current version.",
          code: "OBS-CLINICAL-VERSION-REQUIRED",
          currentVersion,
        });
        return;
      }
      if (req.body.version !== undefined && req.body.version !== currentVersion) {
        res.status(409).json({
          message: "Clinical note has been modified by another user. Please refresh and try again.",
          code: "OBS-CLINICAL-CONFLICT",
          currentVersion,
          lastEditedBy: analysis.clinicalNote.editHistory?.at(-1)?.editedBy,
          lastEditedAt: analysis.clinicalNote.editHistory?.at(-1)?.editedAt,
        });
        return;
      }

      // Increment version on every edit
      analysis.clinicalNote.version = currentVersion + 1;

      // Editing an attested note requires explicit acknowledgment and triggers re-attestation
      const wasAttested = !!analysis.clinicalNote.providerAttested;
      if (wasAttested) {
        if (!req.body.acknowledgeReAttestation) {
          res.status(400).json({
            message: "This note has been attested. Editing will require re-attestation. Set acknowledgeReAttestation: true to proceed.",
            code: "OBS-CLINICAL-REATTESTATION-REQUIRED",
            attestedBy: analysis.clinicalNote.attestedBy,
            attestedAt: analysis.clinicalNote.attestedAt,
          });
          return;
        }

        // Require a reason when editing an attested note (compliance)
        if (!req.body.reason || typeof req.body.reason !== "string" || !req.body.reason.trim()) {
          res.status(400).json({
            message: "A reason is required when editing an attested clinical note (medical records compliance).",
            code: "OBS-CLINICAL-AMENDMENT-REASON-REQUIRED",
          });
          return;
        }

        // --- Amendment/addendum workflow (HIPAA medical records compliance) ---
        // Capture a snapshot of non-PHI fields before clearing attestation.
        const nonPhiSnapshot: Record<string, unknown> = {};
        const nonPhiSnapshotKeys = [
          "format", "specialty", "plan", "icd10Codes", "cptCodes", "cdtCodes",
          "toothNumbers", "quadrants", "treatmentPhases", "prescriptions",
          "followUp", "differentialDiagnoses", "documentationCompleteness",
          "clinicalAccuracy", "attestedBy", "attestedAt", "version",
          // NPI excluded from snapshot — it's now encrypted PHI
        ];
        const cn = analysis.clinicalNote as Record<string, unknown>;
        for (const key of nonPhiSnapshotKeys) {
          if (cn[key] !== undefined) nonPhiSnapshot[key] = cn[key];
        }

        // Determine which fields are being changed (including PHI fields by name only)
        const editableFields = [
          "chiefComplaint", "subjective", "objective", "assessment", "plan",
          "hpiNarrative", "reviewOfSystems", "differentialDiagnoses",
          "icd10Codes", "cptCodes", "cdtCodes", "prescriptions", "followUp",
          "toothNumbers", "quadrants", "periodontalFindings", "treatmentPhases",
          "format", "specialty",
        ];
        const fieldsChanged = Object.keys(req.body).filter(k => editableFields.includes(k));

        const amendment = {
          type: "amendment" as const,
          reason: req.body.reason.trim(),
          amendedBy: req.user?.name || req.user?.username || "unknown",
          amendedById: req.user?.id,
          amendedAt: new Date().toISOString(),
          fieldsChanged,
          noteSnapshot: nonPhiSnapshot,
        };

        if (!analysis.clinicalNote.amendments) {
          analysis.clinicalNote.amendments = [];
        }
        analysis.clinicalNote.amendments.push(amendment);

        // Clear attestation — provider must re-attest after edits
        const previousAttester = analysis.clinicalNote.attestedBy;
        analysis.clinicalNote.providerAttested = false;
        analysis.clinicalNote.attestedBy = undefined;
        analysis.clinicalNote.attestedAt = undefined;
        analysis.clinicalNote.cosignatureRequired = undefined;
        logger.info({
          callId: req.params.callId,
          previousAttester,
          editedBy: req.user?.name || req.user?.username,
        }, "Attested clinical note edited — amendment recorded, re-attestation required");
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

      // Validate edit field values (codes, formats, sizes)
      const validationErrors = validateClinicalEditFields(edits);
      if (validationErrors.length > 0) {
        res.status(400).json({
          message: "Invalid clinical note data",
          errors: validationErrors,
        });
        return;
      }

      // Prevent format change from silently discarding non-empty required sections
      if (edits.format && edits.format !== analysis.clinicalNote.format) {
        const newRequired = getRequiredSections(edits.format as string);
        const oldRequired = getRequiredSections(analysis.clinicalNote.format || "soap");
        const lostSections = oldRequired.filter(s => !newRequired.includes(s));

        // Check which lost sections have actual content
        const nonEmptyLostSections = lostSections.filter(s => {
          const value = (analysis.clinicalNote as Record<string, unknown>)[s];
          if (typeof value === "string" && value.trim().length > 0 && !value.startsWith("enc_v1:")) return true;
          if (Array.isArray(value) && value.length > 0) return true;
          return false;
        });

        if (nonEmptyLostSections.length > 0 && !req.body.forceFormatChange) {
          res.status(400).json({
            message: `Changing format from ${analysis.clinicalNote.format} to ${edits.format} would discard content in: ${nonEmptyLostSections.join(", ")}. Set forceFormatChange: true to proceed.`,
            code: "OBS-CLINICAL-FORMAT-LOSS",
            lostSections: nonEmptyLostSections,
            oldFormat: analysis.clinicalNote.format,
            newFormat: edits.format,
          });
          return;
        }

        if (lostSections.length > 0) {
          logger.info({
            callId: req.params.callId,
            oldFormat: analysis.clinicalNote.format,
            newFormat: edits.format,
            lostSections,
            forced: !!req.body.forceFormatChange,
          }, "Clinical note format change — sections may be lost");
        }
      }

      // Track all edited field names before PHI fields are separated
      const allEditedFields = Object.keys(req.body).filter(k => allowedFields.includes(k));

      // Encrypt PHI fields before storage (must match PHI_FIELDS in phi-encryption.ts)
      const phiFields = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint",
        "reviewOfSystems", "differentialDiagnoses", "periodontalFindings"];
      for (const field of phiFields) {
        if (typeof edits[field] === "string") {
          (analysis.clinicalNote as Record<string, unknown>)[field] = encryptField(edits[field] as string);
          delete edits[field]; // Already handled via encryption
        }
      }

      // Apply non-PHI edits directly
      Object.assign(analysis.clinicalNote, edits);

      // Track edit history (includes both PHI and non-PHI field names, never PHI values)
      if (!analysis.clinicalNote.editHistory) {
        analysis.clinicalNote.editHistory = [];
      }
      analysis.clinicalNote.editHistory.push({
        editedBy: req.user?.name || req.user?.username || "unknown",
        editedAt: new Date().toISOString(),
        fieldsChanged: allEditedFields,
      });

      // Recompute quality score breakdown after edit
      analysis.clinicalNote.qualityScoreBreakdown = computeQualityScores(
        analysis.clinicalNote as Record<string, unknown>,
      );

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "edit_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Edited fields: ${allEditedFields.join(", ")}`,
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
      const org = await getCachedOrganization(req.orgId!);
      const userId = req.user?.id || "unknown";
      const prefs = org?.settings?.providerStylePreferences?.[userId] || {};
      logPhiAccess({
        ...auditContext(req),
        event: "view_provider_preferences",
        resourceType: "clinical_preferences",
        detail: `Provider ${userId} viewed style preferences`,
      });
      res.json(prefs);
    } catch (error) {
      logger.error({ err: error }, "Failed to get provider preferences");
      res.status(500).json({ message: "Failed to get provider preferences" });
    }
  });

  app.patch("/api/clinical/provider-preferences", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      const userId = req.user?.id || "unknown";
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

      const settings: Partial<OrgSettings> = org.settings || {};
      const allPrefs: Record<string, Record<string, unknown>> = (settings.providerStylePreferences as Record<string, Record<string, unknown>>) || {};
      allPrefs[userId] = { ...allPrefs[userId], ...updates };

      await storage.updateOrganization(req.orgId!, {
        settings: { ...settings, providerStylePreferences: allPrefs } as OrgSettings,
      });
      invalidateOrgCache(req.orgId!);

      logPhiAccess({
        ...auditContext(req),
        event: "org_settings_update",
        resourceType: "organization",
        resourceId: req.orgId!,
        detail: `Provider style preferences updated: ${Object.keys(updates).join(", ")}`,
      });

      logger.info({ orgId: req.orgId, userId, fields: Object.keys(updates) }, "Provider style preferences updated");
      res.json({ success: true, preferences: allPrefs[userId] });
    } catch (error) {
      logger.error({ err: error }, "Failed to update provider preferences");
      res.status(500).json({ message: "Failed to update provider preferences" });
    }
  });

  // Get clinical dashboard metrics (enhanced)
  app.get("/api/clinical/metrics", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const orgId = req.orgId!;
      const clinicalCategories = [
        "clinical_encounter", "telemedicine",
        "dental_encounter", "dental_consultation",
      ];

      // Query only clinical calls with their analyses (not all calls + all related data)
      const clinicalRows = await storage.getClinicalCallMetrics?.(orgId, clinicalCategories);

      // Fallback for non-postgres storage backends
      if (!clinicalRows) {
        res.json({
          totalEncounters: 0, completedEncounters: 0, notesGenerated: 0,
          notesAttested: 0, pendingAttestation: 0, avgDocumentationCompleteness: 0,
          avgClinicalAccuracy: 0, attestationRate: 0, avgAttestationTimeMinutes: null,
          formatDistribution: {}, specialtyDistribution: {},
          attestationTrend: [], completenessDistribution: [],
        });
        return;
      }

      const { totalEncounters, completed, notesWithData } = clinicalRows;

      const withNotes = notesWithData.filter(n => n.clinicalNote);
      const attested = withNotes.filter(n => n.clinicalNote?.providerAttested);

      const avgCompleteness = withNotes.length > 0
        ? withNotes.reduce((sum: number, n) => sum + (n.clinicalNote?.documentationCompleteness || 0), 0) / withNotes.length
        : 0;

      const avgAccuracy = withNotes.length > 0
        ? withNotes.reduce((sum: number, n) => sum + (n.clinicalNote?.clinicalAccuracy || 0), 0) / withNotes.length
        : 0;

      const formatDist: Record<string, number> = {};
      for (const n of withNotes) {
        const fmt = n.clinicalNote?.format || "soap";
        formatDist[fmt] = (formatDist[fmt] || 0) + 1;
      }

      const specialtyDist: Record<string, number> = {};
      for (const n of withNotes) {
        const sp = n.clinicalNote?.specialty || "unspecified";
        specialtyDist[sp] = (specialtyDist[sp] || 0) + 1;
      }

      // Attestation trend (last 7 days)
      const now = new Date();
      const attestationTrend: Array<{ date: string; attested: number; total: number }> = [];
      for (let d = 6; d >= 0; d--) {
        const day = new Date(now);
        day.setDate(day.getDate() - d);
        const dayStr = day.toISOString().split("T")[0];
        const dayNotes = withNotes.filter(n => {
          const uploaded = n.uploadedAt ? new Date(n.uploadedAt).toISOString().split("T")[0] : "";
          return uploaded === dayStr;
        });
        const dayAttested = dayNotes.filter(n => n.clinicalNote?.providerAttested);
        attestationTrend.push({ date: dayStr, attested: dayAttested.length, total: dayNotes.length });
      }

      const completenessDist = [0, 0, 0, 0, 0];
      for (const n of withNotes) {
        const score = n.clinicalNote?.documentationCompleteness || 0;
        const bucket = Math.min(4, Math.floor(score / 2));
        completenessDist[bucket]++;
      }

      let totalAttestTime = 0;
      let attestTimeCount = 0;
      for (const n of attested) {
        const cn = n.clinicalNote;
        if (cn?.attestedAt && n.uploadedAt) {
          const diff = new Date(cn.attestedAt).getTime() - new Date(n.uploadedAt).getTime();
          if (diff > 0) { totalAttestTime += diff; attestTimeCount++; }
        }
      }
      const avgAttestationTimeMinutes = attestTimeCount > 0
        ? Math.round(totalAttestTime / attestTimeCount / 60000) : null;

      logPhiAccess({
        ...auditContext(req),
        event: "view_clinical_metrics",
        resourceType: "clinical_metrics",
        detail: `${withNotes.length} notes, ${attested.length} attested`,
      });

      res.json({
        totalEncounters,
        completedEncounters: completed,
        notesGenerated: withNotes.length,
        notesAttested: attested.length,
        pendingAttestation: withNotes.length - attested.length,
        avgDocumentationCompleteness: Math.round(avgCompleteness * 10) / 10,
        avgClinicalAccuracy: Math.round(avgAccuracy * 10) / 10,
        attestationRate: withNotes.length > 0 ? Math.round((attested.length / withNotes.length) * 100) : 0,
        avgAttestationTimeMinutes,
        formatDistribution: formatDist,
        specialtyDistribution: specialtyDist,
        attestationTrend,
        completenessDistribution: completenessDist.map((count, i) => ({
          range: `${i * 2}-${i * 2 + 2}`, count,
        })),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical metrics");
      res.status(500).json({ message: "Failed to get clinical metrics" });
    }
  });

  // ==================== STYLE LEARNING ====================

  // Analyze provider's past notes and suggest style preferences
  app.post("/api/clinical/style-learning/analyze", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const userId = req.user?.id || "unknown";
      const clinicalCategories = [
        "clinical_encounter", "telemedicine",
        "dental_encounter", "dental_consultation",
      ];

      // Query only attested clinical notes (not all calls)
      const noteRows = await storage.getAttestedClinicalNotes?.(req.orgId!, clinicalCategories);

      // Gather attested notes for this provider
      const attestedNotes: StyleClinicalNote[] = [];
      const userName = req.user?.name || req.user?.username;

      for (const row of noteRows || []) {
        const cn = row.clinicalNote;
        if (!cn?.providerAttested) continue;

        // Only include notes attested by this user (if tracked)
        if (cn.attestedBy && cn.attestedBy !== userName) continue;

        // Decrypt PHI fields — skip this note if any field fails rather than
        // aborting the entire style analysis for one bad record.
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

      const result = analyzeProviderStyle(req.orgId!, userId, attestedNotes);

      if (!result) {
        res.json({
          success: false,
          message: `Need at least 3 attested notes for style analysis (found ${attestedNotes.length})`,
          noteCount: attestedNotes.length,
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
  });

  // Apply learned style preferences
  app.post("/api/clinical/style-learning/apply", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
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
  });

  // ==================== CLINICAL NOTE TEMPLATES ====================

  // List all templates (with optional filtering)
  app.get("/api/clinical/templates", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const { specialty, format, category, search } = req.query;

      let templates;
      if (search && typeof search === "string") {
        templates = searchTemplates(search);
      } else if (specialty && typeof specialty === "string") {
        templates = getTemplatesBySpecialty(specialty);
      } else if (format && typeof format === "string") {
        templates = getTemplatesByFormat(format);
      } else if (category && typeof category === "string") {
        templates = getTemplatesByCategory(category);
      } else {
        templates = CLINICAL_NOTE_TEMPLATES;
      }

      res.json(templates);
    } catch (error) {
      logger.error({ err: error }, "Failed to list clinical templates");
      res.status(500).json({ message: "Failed to list clinical templates" });
    }
  });

  // Get recommended format for a specialty
  app.get("/api/clinical/recommended-format", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    const { specialty } = req.query;
    if (!specialty || typeof specialty !== "string") {
      res.status(400).json({ message: "specialty query parameter is required" });
      return;
    }
    const format = getRecommendedFormat(specialty);
    const requiredSections = getRequiredSections(format);
    res.json({ specialty, recommendedFormat: format, requiredSections });
  });

  // Validate an existing clinical note
  app.get("/api/clinical/notes/:callId/validate", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis) {
        res.status(404).json({ message: "Analysis not found" });
        return;
      }
      const cn = analysis.clinicalNote;
      if (!cn) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      // Decrypt PHI fields for validation
      const decrypted = { ...cn };
      const wrapper = { clinicalNote: decrypted } as Record<string, unknown>;
      decryptClinicalNotePhi(wrapper, {
        userId: req.user?.id, orgId: req.orgId, resourceId: req.params.callId, resourceType: "clinical_note_validation",
      });

      const result = validateClinicalNote(decrypted);
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to validate clinical note");
      res.status(500).json({ message: "Failed to validate clinical note" });
    }
  });

  // Get a single template by ID (checks custom provider templates first, then system templates)
  app.get("/api/clinical/templates/:id", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      // Check custom provider templates first (for calling user's org + user)
      const userId = req.user?.id;
      if (userId) {
        const customTemplates = await storage.getProviderTemplates(req.orgId!, userId);
        const customTemplate = customTemplates.find(t => t.id === req.params.id);
        if (customTemplate) {
          res.json(customTemplate);
          return;
        }
        // Also check all org templates (admin can view all)
        if (req.user?.role === "admin") {
          const allTemplates = await storage.getAllProviderTemplates(req.orgId!);
          const orgTemplate = allTemplates.find(t => t.id === req.params.id);
          if (orgTemplate) {
            res.json(orgTemplate);
            return;
          }
        }
      }

      // Fall back to system templates
      const template = getTemplateById(req.params.id);
      if (!template) {
        res.status(404).json({ message: "Template not found" });
        return;
      }
      logPhiAccess({
        ...auditContext(req),
        event: "view_clinical_template",
        resourceType: "clinical_template",
        resourceId: req.params.id,
        detail: `Viewed template: ${template.name}`,
      });
      res.json(template);
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical template");
      res.status(500).json({ message: "Failed to get clinical template" });
    }
  });

  // --- Transcript Editing ---

  // Edit transcript text and optionally re-run AI analysis to regenerate the clinical note
  app.patch("/api/clinical/transcript/:callId",
    requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"),
    async (req, res) => {
      const orgId = req.orgId!;
      const user = req.user!;
      const { callId } = req.params;
      const { text, reanalyze } = req.body;

      if (!text || typeof text !== "string" || text.trim().length < 10) {
        res.status(400).json({ message: "Transcript text must be at least 10 characters" });
        return;
      }

      try {
        // Verify call exists and belongs to org
        const call = await storage.getCall(orgId, callId);
        if (!call) {
          res.status(404).json({ message: "Call not found" });
          return;
        }

        // Verify transcript exists
        const existingTranscript = await storage.getTranscript(orgId, callId);
        if (!existingTranscript) {
          res.status(404).json({ message: "No transcript found for this call" });
          return;
        }

        // Update transcript text
        const updated = await storage.updateTranscript(orgId, callId, { text: text.trim() });
        if (!updated) {
          res.status(500).json({ message: "Failed to update transcript" });
          return;
        }

        // Tag the call as transcript_edited
        const existingTags: string[] = Array.isArray(call.tags) ? [...call.tags] : [];
        if (!existingTags.includes("transcript_edited")) {
          existingTags.push("transcript_edited");
          await storage.updateCall(orgId, callId, { tags: existingTags });
        }

        logPhiAccess({
          ...auditContext(req),
          event: "edit_transcript",
          resourceType: "transcript",
          resourceId: callId,
          detail: `Transcript edited by ${user.name || user.username}. Length: ${existingTranscript.text?.length || 0} -> ${text.trim().length}`,
        });

        logger.info({ callId, editedBy: user.name || user.username }, "Transcript edited");

        // If reanalyze requested, regenerate clinical note from edited transcript
        let reanalysisResult: { success: boolean; message: string } | undefined;
        if (reanalyze) {
          try {
            const org = await storage.getOrganization(orgId);
            const orgSettings = (org?.settings || null) as OrgSettings | null;
            const callCategory = call.callCategory || "clinical_encounter";

            // Load prompt template
            const template = await storage.getPromptTemplateByCategory(orgId, callCategory).catch(() => undefined);
            let templateConfig: PromptTemplateConfig | undefined = template ? {
              evaluationCriteria: template.evaluationCriteria,
              requiredPhrases: template.requiredPhrases as PromptTemplateConfig["requiredPhrases"],
              scoringWeights: template.scoringWeights as PromptTemplateConfig["scoringWeights"],
              additionalInstructions: template.additionalInstructions || undefined,
            } : undefined;

            // Load provider style preferences
            const providerPrefs = user.id && org?.settings?.providerStylePreferences?.[user.id];
            if (providerPrefs) {
              if (!templateConfig) templateConfig = {} as PromptTemplateConfig;
              const sanitizedPrefs = sanitizeStylePreferences(providerPrefs);
              templateConfig.providerStylePreferences = sanitizedPrefs as PromptTemplateConfig["providerStylePreferences"];
            }

            // Run AI analysis on edited transcript
            const provider = getOrgAIProvider(orgId, orgSettings);
            const result = await provider.analyzeCallTranscript(
              text.trim(),
              callId,
              callCategory,
              templateConfig,
            );
            const parsed = parseJsonResponse(JSON.stringify(result), callId);

            // Build updated clinical note
            const clinicalNoteRaw = parsed.clinical_note;
            let cnForStorage: ClinicalNote | undefined;
            if (clinicalNoteRaw) {
              const raw = clinicalNoteRaw as Record<string, unknown>;
              // Encrypt PHI fields
              const phiFields = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint",
                "chief_complaint", "hpi_narrative"] as const;
              const encrypted = { ...raw };
              for (const field of phiFields) {
                const val = encrypted[field];
                if (val && typeof val === "string") {
                  try { encrypted[field] = encryptField(val); } catch { /* encryption not configured */ }
                }
              }

              cnForStorage = {
                format: (encrypted.format as string) || "soap",
                providerAttested: false, // Requires re-attestation
                specialty: encrypted.specialty as string | undefined,
                chiefComplaint: (encrypted.chief_complaint || encrypted.chiefComplaint) as string | undefined,
                subjective: encrypted.subjective as string | undefined,
                objective: encrypted.objective as string | undefined,
                assessment: encrypted.assessment as string | undefined,
                plan: encrypted.plan as string[] | undefined,
                hpiNarrative: (encrypted.hpi_narrative || encrypted.hpiNarrative) as string | undefined,
                followUp: (encrypted.follow_up || encrypted.followUp) as string | undefined,
                icd10Codes: (encrypted.icd10_codes || encrypted.icd10Codes) as ClinicalNote["icd10Codes"],
                cptCodes: (encrypted.cpt_codes || encrypted.cptCodes) as ClinicalNote["cptCodes"],
                cdtCodes: (encrypted.cdt_codes || encrypted.cdtCodes) as ClinicalNote["cdtCodes"],
                documentationCompleteness: (encrypted.documentation_completeness || encrypted.documentationCompleteness) as number | undefined,
                clinicalAccuracy: (encrypted.clinical_accuracy || encrypted.clinicalAccuracy) as number | undefined,
                missingSections: (encrypted.missing_sections || encrypted.missingSections) as string[] | undefined,
                editHistory: [{
                  editedBy: user.name || user.username || "unknown",
                  editedAt: new Date().toISOString(),
                  fieldsChanged: ["transcript_reanalysis"],
                }],
              };
            }

            // Update call analysis with new results
            const existingAnalysis = await storage.getCallAnalysis(orgId, callId);
            await storage.createCallAnalysis(orgId, {
              ...(existingAnalysis || {}),
              orgId,
              callId,
              performanceScore: parsed.performance_score?.toString(),
              summary: parsed.summary,
              topics: parsed.topics,
              feedback: parsed.feedback,
              flags: parsed.flags,
              subScores: {
                compliance: parsed.sub_scores?.compliance,
                customerExperience: parsed.sub_scores?.customer_experience,
                communication: parsed.sub_scores?.communication,
                resolution: parsed.sub_scores?.resolution,
              },
              clinicalNote: cnForStorage || (existingAnalysis?.clinicalNote as ClinicalNote | undefined),
              confidenceScore: "0.85",
              confidenceFactors: {
                transcriptConfidence: 0.90,
                wordCount: text.trim().split(/\s+/).length,
                callDurationSeconds: call.duration || 0,
                transcriptLength: text.trim().length,
                aiAnalysisCompleted: true,
                overallScore: 0.85,
              },
            });

            // Track usage for billing
            try {
              await storage.recordUsageEvent({
                orgId,
                eventType: "ai_analysis",
                quantity: 1,
                metadata: { callId, source: "transcript_reanalysis" },
              });
            } catch { /* non-blocking */ }

            logPhiAccess({
              ...auditContext(req),
              event: "transcript_reanalysis",
              resourceType: "clinical_note",
              resourceId: callId,
              detail: "Clinical note regenerated from edited transcript",
            });

            reanalysisResult = { success: true, message: "Clinical note regenerated from edited transcript. Re-attestation required." };
          } catch (err) {
            logger.error({ callId, err }, "Failed to reanalyze transcript");
            reanalysisResult = { success: false, message: "Transcript saved but AI re-analysis failed. You can retry or edit the clinical note manually." };
          }
        }

        res.json({
          transcript: updated,
          reanalysis: reanalysisResult,
        });
      } catch (error) {
        logger.error({ err: error, callId }, "Failed to edit transcript");
        res.status(500).json({ message: "Failed to edit transcript" });
      }
    },
  );

  // Post-attestation quality feedback — providers rate AI note quality
  app.post("/api/clinical/notes/:callId/feedback", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const { rating, comment, improvementAreas } = req.body;

      if (typeof rating !== "number" || rating < 1 || rating > 5) {
        res.status(400).json({ message: "Rating must be 1-5" });
        return;
      }

      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      const feedback = {
        rating,
        comment: typeof comment === "string" ? comment.slice(0, 1000) : undefined,
        improvementAreas: Array.isArray(improvementAreas)
          ? improvementAreas.filter((a: unknown) => typeof a === "string").slice(0, 10) as string[]
          : undefined,
        ratedBy: req.user?.name || req.user?.username,
        ratedById: req.user?.id,
        ratedAt: new Date().toISOString(),
      };

      // Store feedback on the clinical note
      const existingFeedback = Array.isArray(analysis.clinicalNote?.qualityFeedback)
        ? analysis.clinicalNote!.qualityFeedback!
        : [];
      analysis.clinicalNote!.qualityFeedback = [...existingFeedback, feedback];

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "clinical_note_feedback",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Rating: ${rating}/5${improvementAreas?.length ? `, Areas: ${improvementAreas.join(", ")}` : ""}`,
      });

      res.json({ success: true, feedback });
    } catch (error) {
      logger.error({ err: error }, "Failed to save clinical note feedback");
      res.status(500).json({ message: "Failed to save feedback" });
    }
  });

  // ==================== AMENDMENT / ADDENDUM WORKFLOW ====================

  // Get amendments/addenda for a clinical note
  app.get("/api/clinical/notes/:callId/amendments", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }
      // Amendments snapshot contains no PHI — no decryption needed
      res.json({
        amendments: analysis.clinicalNote.amendments || [],
        count: analysis.clinicalNote.amendments?.length || 0,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical note amendments");
      res.status(500).json({ message: "Failed to get amendments" });
    }
  });

  // Add a pure addendum (doesn't re-open note for editing, preserves attestation)
  app.post("/api/clinical/notes/:callId/addendum", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const { content, reason } = req.body;

      if (!content || typeof content !== "string" || !content.trim()) {
        res.status(400).json({ message: "content is required for an addendum" });
        return;
      }
      if (!reason || typeof reason !== "string" || !reason.trim()) {
        res.status(400).json({ message: "reason is required for an addendum" });
        return;
      }
      if (content.length > 5000) {
        res.status(400).json({ message: "Addendum content must be under 5000 characters" });
        return;
      }

      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      const addendum = {
        type: "addendum" as const,
        reason: reason.trim(),
        amendedBy: req.user?.name || req.user?.username || "unknown",
        amendedById: req.user?.id,
        amendedAt: new Date().toISOString(),
        fieldsChanged: [] as string[],
        // Encrypt addendum content — it may contain clinical details (PHI)
        content: encryptField(content.trim()),
      };

      // Conflict detection: if client provides version, verify it matches
      const currentVersion = analysis.clinicalNote.version || 0;
      if (req.body.version !== undefined && req.body.version !== currentVersion) {
        res.status(409).json({
          message: "Clinical note has been modified. Please refresh and try again.",
          code: "OBS-CLINICAL-CONFLICT",
          currentVersion,
        });
        return;
      }

      if (!analysis.clinicalNote.amendments) {
        analysis.clinicalNote.amendments = [];
      }
      analysis.clinicalNote.amendments.push(addendum);
      analysis.clinicalNote.version = currentVersion + 1;

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "add_clinical_addendum",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Addendum added by ${req.user?.name || req.user?.username}`,
      });

      logger.info({ callId: req.params.callId }, "Clinical note addendum added");
      res.json({ success: true, addendum });
    } catch (error) {
      logger.error({ err: error }, "Failed to add clinical note addendum");
      res.status(500).json({ message: "Failed to add addendum" });
    }
  });

  // ==================== FHIR R4 EXPORT ====================

  // Export clinical note as FHIR R4 Bundle
  app.get("/api/clinical/notes/:callId/fhir", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      const cn = analysis.clinicalNote;

      // FHIR export requires attestation (medical records compliance)
      if (!cn.providerAttested) {
        res.status(403).json({
          message: "Clinical note must be attested before FHIR export. Please have the provider attest the note first.",
          code: "OBS-CLINICAL-FHIR-UNATTESTED",
          attestedBy: cn.attestedBy,
        });
        return;
      }

      // Decrypt PHI fields before building FHIR resource
      try {
        decryptClinicalNotePhi(analysis as Record<string, unknown>, {
          userId: req.user?.id, orgId: req.orgId, resourceId: req.params.callId, resourceType: "clinical_note_fhir",
        });
      } catch (decryptErr) {
        logger.error({ err: decryptErr, callId: req.params.callId }, "PHI decryption failed for FHIR export");
        res.status(500).json({
          message: "Unable to decrypt clinical note for FHIR export.",
          code: "OBS-PHI-DECRYPT-001",
        });
        return;
      }

      const org = await getCachedOrganization(req.orgId!);
      const orgName = org?.name || "Unknown Organization";
      const providerName = cn.attestedBy || req.user?.name || req.user?.username || "Unknown Provider";
      const npi = cn.attestedNpi;

      const fhirBundle = buildFhirBundle({
        note: cn as Record<string, unknown>,
        callId: req.params.callId,
        orgName,
        providerName,
        npi,
      });

      logPhiAccess({
        ...auditContext(req),
        event: "fhir_export",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `FHIR R4 Bundle exported for call ${req.params.callId}`,
      });

      res.setHeader("Content-Type", "application/fhir+json");
      res.json(fhirBundle);
    } catch (error) {
      logger.error({ err: error }, "Failed to export FHIR bundle");
      res.status(500).json({ message: "Failed to export FHIR bundle" });
    }
  });

  // ==================== CO-SIGNATURE WORKFLOW ====================

  // Provider co-signature (supervising provider signs after treating provider attests)
  app.post("/api/clinical/notes/:callId/cosign", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const { npiNumber, role } = req.body;

      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      if (!analysis.clinicalNote.providerAttested) {
        res.status(400).json({
          message: "The treating provider must attest the note before a co-signature can be added.",
          code: "OBS-CLINICAL-COSIGN-NOT-ATTESTED",
        });
        return;
      }

      // Check if user's role is allowed to co-sign
      const orgForCosign = await getCachedOrganization(req.orgId!);
      const cosignatureRoles = (orgForCosign?.settings as OrgSettings)?.cosignatureRoles;
      const currentUserRole = req.user?.role;

      if (cosignatureRoles && cosignatureRoles.length > 0) {
        if (!currentUserRole || (!cosignatureRoles.includes(currentUserRole) && currentUserRole !== "admin")) {
          res.status(403).json({
            message: `Your role (${currentUserRole}) is not authorized to co-sign notes. Authorized roles: ${cosignatureRoles.join(", ")}`,
            code: "OBS-CLINICAL-COSIGN-UNAUTHORIZED",
          });
          return;
        }
      }

      // Increment version to track co-signature as a state change
      const currentVersion = analysis.clinicalNote.version || 0;
      analysis.clinicalNote.version = currentVersion + 1;

      const cosignedAt = new Date().toISOString();
      analysis.clinicalNote.cosignature = {
        cosignedBy: req.user?.name || req.user?.username || "unknown",
        cosignedById: req.user?.id,
        cosignedNpi: npiNumber ? encryptField(npiNumber) : undefined,
        cosignedAt,
        role: role || undefined,
      };
      analysis.clinicalNote.cosignatureRequired = false;

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "cosign_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Co-signed by ${req.user?.name || req.user?.username}${role ? ` (${role})` : ""}`,
      });

      logger.info({ callId: req.params.callId }, "Clinical note co-signed");
      res.json({ success: true, cosignedAt });
    } catch (error) {
      logger.error({ err: error }, "Failed to co-sign clinical note");
      res.status(500).json({ message: "Failed to co-sign clinical note" });
    }
  });

  // ==================== POPULATION ANALYTICS ====================

  // Aggregate population health stats (admin only, aggregate — no individual patient data)
  app.get("/api/clinical/analytics/population", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("admin"), async (req, res) => {
    try {
      const orgId = req.orgId!;
      const clinicalCategories = [
        "clinical_encounter", "telemedicine",
        "dental_encounter", "dental_consultation",
      ];

      const clinicalRows = await storage.getClinicalCallMetrics?.(orgId, clinicalCategories);
      if (!clinicalRows) {
        res.json({
          totalNotes: 0, avgPainScale: null, avgBmi: null, avgBloodPressureSystolic: null,
          avgBloodPressureDiastolic: null, topIcd10Codes: [], topMedications: [],
          vitalsPresent: 0, medicationsPresent: 0,
        });
        return;
      }

      const notesWithData = clinicalRows.notesWithData.filter(n => n.clinicalNote);

      // Aggregate vitals across all notes (from structuredData field)
      let painScaleTotal = 0; let painScaleCount = 0;
      let bmiTotal = 0; let bmiCount = 0;
      let bpSysTotal = 0; let bpSysCount = 0;
      let bpDiaTotal = 0; let bpDiaCount = 0;
      let vitalsPresent = 0;
      let medicationsPresent = 0;

      const icd10Freq: Record<string, number> = {};
      const medFreq: Record<string, number> = {};

      for (const n of notesWithData) {
        const cn = n.clinicalNote as any;
        if (!cn) continue;

        // Aggregate from stored structuredData
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
          for (const med of sd.medications) {
            if (med.name) medFreq[med.name] = (medFreq[med.name] || 0) + 1;
          }
        }

        // Aggregate ICD-10 codes
        const codes = cn.icd10Codes || [];
        for (const code of codes) {
          if (code?.code) icd10Freq[code.code] = (icd10Freq[code.code] || 0) + 1;
        }
      }

      const topIcd10Codes = Object.entries(icd10Freq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([code, count]) => ({ code, count }));

      const topMedications = Object.entries(medFreq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));

      logPhiAccess({
        ...auditContext(req),
        event: "view_population_analytics",
        resourceType: "clinical_metrics",
        detail: `Population analytics: ${notesWithData.length} notes aggregated`,
      });

      res.json({
        totalNotes: notesWithData.length,
        avgPainScale: painScaleCount > 0 ? Math.round((painScaleTotal / painScaleCount) * 10) / 10 : null,
        avgBmi: bmiCount > 0 ? Math.round((bmiTotal / bmiCount) * 10) / 10 : null,
        avgBloodPressureSystolic: bpSysCount > 0 ? Math.round(bpSysTotal / bpSysCount) : null,
        avgBloodPressureDiastolic: bpDiaCount > 0 ? Math.round(bpDiaTotal / bpDiaCount) : null,
        topIcd10Codes,
        topMedications,
        vitalsPresent,
        medicationsPresent,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get population analytics");
      res.status(500).json({ message: "Failed to get population analytics" });
    }
  });

  // ==================== EHR PREFILL SUGGESTIONS ====================

  // Get prefill suggestions for a clinical note from EHR prior visit data
  app.get("/api/clinical/notes/:callId/prefill-suggestions", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as OrgSettings)?.ehrConfig;

      if (!ehrConfig?.enabled || !ehrConfig?.system) {
        res.json({ medications: [], allergies: [], chiefComplaintHistory: [], ehrConnected: false });
        return;
      }

      // Check if call has an EHR patient association
      const call = await storage.getCall(req.orgId!, req.params.callId);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      // Return empty suggestions if no patient is linked
      res.json({
        medications: [],
        allergies: [],
        chiefComplaintHistory: [],
        ehrConnected: true,
        note: "Patient lookup from EHR requires patient ID association. Use /api/ehr/patients to search by name.",
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get prefill suggestions");
      res.status(500).json({ message: "Failed to get prefill suggestions" });
    }
  });

  // ==================== PROVIDER TEMPLATES (CUSTOM) ====================

  // List provider's own custom templates
  app.get("/api/clinical/templates/my", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: "User ID required" });
        return;
      }
      const templates = await storage.getProviderTemplates(req.orgId!, userId);
      res.json(templates);
    } catch (error) {
      logger.error({ err: error }, "Failed to list provider templates");
      res.status(500).json({ message: "Failed to list provider templates" });
    }
  });

  // Create a custom provider template
  app.post("/api/clinical/templates/custom", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const { name, specialty, format, category, description, sections, defaultCodes, tags, isDefault } = req.body;

      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ message: "Template name is required" });
        return;
      }
      if (name.length > 255) {
        res.status(400).json({ message: "Template name must be under 255 characters" });
        return;
      }

      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: "User ID required" });
        return;
      }

      const template = await storage.createProviderTemplate(req.orgId!, {
        userId,
        name: name.trim(),
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
  });

  // Update own provider template
  app.patch("/api/clinical/templates/custom/:id", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: "User ID required" });
        return;
      }

      const allowed = ["name", "specialty", "format", "category", "description", "sections", "defaultCodes", "tags", "isDefault"];
      const updates: Record<string, unknown> = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }

      if (updates.name && (typeof updates.name !== "string" || !updates.name.trim())) {
        res.status(400).json({ message: "Template name must be a non-empty string" });
        return;
      }

      const updated = await storage.updateProviderTemplate(req.orgId!, req.params.id, userId, updates);
      if (!updated) {
        res.status(404).json({ message: "Template not found or you do not have permission to edit it" });
        return;
      }
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update provider template");
      res.status(500).json({ message: "Failed to update provider template" });
    }
  });

  // Delete own provider template
  app.delete("/api/clinical/templates/custom/:id", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: "User ID required" });
        return;
      }
      const deleted = await storage.deleteProviderTemplate(req.orgId!, req.params.id, userId);
      if (!deleted) {
        res.status(404).json({ message: "Template not found or you do not have permission to delete it" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, "Failed to delete provider template");
      res.status(500).json({ message: "Failed to delete provider template" });
    }
  });
}
