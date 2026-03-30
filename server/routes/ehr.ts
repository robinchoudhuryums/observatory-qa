/**
 * EHR Integration API Routes
 *
 * Provides endpoints for connecting dental/medical EHR systems to Observatory QA.
 * Supports: Open Dental, Eaglesoft (Patterson), Dentrix, FHIR R4.
 *
 * All endpoints are org-scoped and require admin role for configuration,
 * authenticated access for data retrieval.
 *
 * Credentials security:
 *   - API keys are encrypted with AES-256-GCM before storage in org settings JSONB.
 *   - Optionally: set `secretArn` in EHR config to fetch credentials from AWS
 *     Secrets Manager instead, which keeps keys completely out of the database.
 */

import type { Express } from "express";
import { requireAuth, requireRole, injectOrgContext, getCachedOrganization, invalidateOrgCache } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { getEhrAdapter, getSupportedEhrSystems, type EhrConnectionConfig } from "../services/ehr/index";
import { encryptField, decryptField } from "../services/phi-encryption";
import { resolveEhrCredentials, invalidateSecretCache } from "../services/ehr/secrets-manager";
import { matchCallToAppointment } from "../services/ehr/appointment-matcher";
import { enqueueEhrNotePush } from "../services/queue";

/** Validates EHR baseUrl to prevent SSRF attacks */
function isValidEhrBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Must be HTTPS in production
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return false;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    // Block internal/metadata IPs
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") return false;
    if (hostname.startsWith("169.254.")) return false; // AWS metadata
    if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    return true;
  } catch (err) {
    logger.debug({ err }, "Failed to parse EHR base URL for validation");
    return false;
  }
}

/**
 * Resolve EHR credentials: Secrets Manager (if secretArn configured) → PHI-encrypted key.
 * Always use this instead of calling decryptField directly on ehrConfig.
 */
async function resolveConfig(ehrConfig: any): Promise<EhrConnectionConfig> {
  const decryptedKey = ehrConfig.apiKey ? decryptField(ehrConfig.apiKey) : undefined;
  return resolveEhrCredentials(ehrConfig, decryptedKey);
}

export function registerEhrRoutes(app: Express): void {

  // List supported EHR systems
  app.get("/api/ehr/systems", requireAuth, injectOrgContext, (_req, res) => {
    res.json(getSupportedEhrSystems());
  });

  // Get current EHR configuration (redacts sensitive fields)
  app.get("/api/ehr/config", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig;

      if (!ehrConfig) {
        res.json({ configured: false });
        return;
      }

      // Decrypt API key for admin display, redact for non-admins
      const isAdmin = req.user?.role === "admin";
      const decryptedKey = ehrConfig.apiKey ? decryptField(ehrConfig.apiKey) : undefined;
      res.json({
        configured: true,
        system: ehrConfig.system,
        baseUrl: ehrConfig.baseUrl,
        apiKey: isAdmin ? decryptedKey : (ehrConfig.apiKey ? "••••••••" : undefined),
        options: ehrConfig.options,
        enabled: ehrConfig.enabled,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get EHR config");
      res.status(500).json({ message: "Failed to get EHR configuration" });
    }
  });

  // Configure EHR connection (admin only)
  app.put("/api/ehr/config", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const { system, baseUrl, apiKey, options } = req.body;

      if (!system || !baseUrl) {
        res.status(400).json({ message: "system and baseUrl are required" });
        return;
      }

      if (!isValidEhrBaseUrl(baseUrl)) {
        res.status(400).json({ message: "Invalid baseUrl. Must be a valid HTTPS URL pointing to an external EHR server." });
        return;
      }

      const adapter = getEhrAdapter(system);
      if (!adapter) {
        res.status(400).json({ message: `Unsupported EHR system: ${system}. Supported: ${getSupportedEhrSystems().map(s => s.system).join(", ")}` });
        return;
      }

      const org = await getCachedOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      // Encrypt API key before storage (HIPAA: credentials at rest)
      const ehrConfig: EhrConnectionConfig & { enabled: boolean } = {
        system,
        baseUrl,
        apiKey: apiKey ? encryptField(apiKey) : undefined,
        options: options || undefined,
        enabled: true,
      };

      await storage.updateOrganization(req.orgId!, {
        settings: { ...org.settings, ehrConfig } as any,
      });
      invalidateOrgCache(req.orgId!);

      logPhiAccess({
        ...auditContext(req),
        event: "org_settings_update",
        resourceType: "organization",
        resourceId: req.orgId!,
        detail: `EHR configuration updated: system=${system}`,
      });

      logger.info({ orgId: req.orgId, system }, "EHR configuration updated");
      res.json({ success: true, system, baseUrl });
    } catch (error) {
      logger.error({ err: error }, "Failed to update EHR config");
      res.status(500).json({ message: "Failed to update EHR configuration" });
    }
  });

  // Test EHR connection
  app.post("/api/ehr/test-connection", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig) {
        res.status(400).json({ message: "No EHR configuration found. Configure your EHR first." });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const result = await adapter.testConnection(await resolveConfig(ehrConfig));
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "EHR connection test failed");
      res.status(500).json({ connected: false, error: "Connection test failed" });
    }
  });

  // Search patients in EHR
  app.get("/api/ehr/patients", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const { name, dob, phone } = req.query;
      if (!name && !dob && !phone) {
        res.status(400).json({ message: "At least one search parameter required: name, dob, or phone" });
        return;
      }

      const patients = await adapter.searchPatients(await resolveConfig(ehrConfig), {
        name: name as string,
        dob: dob as string,
        phone: phone as string,
      });

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_patient_search",
        resourceType: "ehr_patient",
        detail: `Searched: ${name || dob || phone}`,
      });

      res.json(patients);
    } catch (error) {
      logger.error({ err: error }, "EHR patient search failed");
      res.status(500).json({ message: "Patient search failed" });
    }
  });

  // Get specific patient from EHR
  app.get("/api/ehr/patients/:ehrPatientId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const patient = await adapter.getPatient(await resolveConfig(ehrConfig), req.params.ehrPatientId);
      if (!patient) {
        res.status(404).json({ message: "Patient not found" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_patient_view",
        resourceType: "ehr_patient",
        resourceId: req.params.ehrPatientId,
      });

      res.json(patient);
    } catch (error) {
      logger.error({ err: error }, "Failed to get EHR patient");
      res.status(500).json({ message: "Failed to get patient" });
    }
  });

  // Get today's appointments from EHR
  app.get("/api/ehr/appointments/today", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const providerId = req.query.providerId as string | undefined;
      const appointments = await adapter.getTodayAppointments(await resolveConfig(ehrConfig), providerId);
      logPhiAccess({
        ...auditContext(req),
        event: "view_ehr_appointments",
        resourceType: "ehr_appointment",
        detail: `today's appointments${providerId ? ` for provider ${providerId}` : ""}`,
      });
      res.json(appointments);
    } catch (error) {
      logger.error({ err: error }, "Failed to get today's appointments");
      res.status(500).json({ message: "Failed to get appointments" });
    }
  });

  // Get appointments for a date range from EHR
  app.get("/api/ehr/appointments", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const { startDate, endDate, providerId } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ message: "startDate and endDate query parameters required" });
        return;
      }

      const appointments = await adapter.getAppointments(await resolveConfig(ehrConfig), {
        startDate: startDate as string,
        endDate: endDate as string,
        providerId: providerId as string | undefined,
      });
      logPhiAccess({
        ...auditContext(req),
        event: "view_ehr_appointments",
        resourceType: "ehr_appointment",
        detail: `date range ${startDate}–${endDate}${providerId ? ` provider ${providerId}` : ""}`,
      });
      res.json(appointments);
    } catch (error) {
      logger.error({ err: error }, "Failed to get appointments");
      res.status(500).json({ message: "Failed to get appointments" });
    }
  });

  // Push clinical note to EHR
  app.post("/api/ehr/push-note/:callId", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      // Get the clinical note
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      // Require attestation before pushing to EHR
      if (!analysis.clinicalNote.providerAttested) {
        res.status(400).json({ message: "Clinical note must be attested before pushing to EHR" });
        return;
      }

      // Require patient consent before sharing clinical data externally (HIPAA)
      if (!analysis.clinicalNote.consentObtained) {
        res.status(400).json({
          message: "Patient consent must be recorded before pushing notes to EHR",
          code: "OBS-CLINICAL-020",
        });
        return;
      }

      const { ehrPatientId, ehrProviderId } = req.body;
      if (!ehrPatientId) {
        res.status(400).json({ message: "ehrPatientId is required to push note to EHR" });
        return;
      }

      // Decrypt PHI fields before formatting for EHR (stored encrypted at rest)
      const cn = { ...analysis.clinicalNote };
      const phiFields = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint"];
      for (const f of phiFields) {
        if (typeof cn[f] === "string") cn[f] = decryptField(cn[f]);
      }
      const noteContent = formatClinicalNoteForEhr(cn);

      const pushPayload = {
        patientId: ehrPatientId,
        providerId: ehrProviderId || "",
        date: new Date().toISOString().split("T")[0]!,
        noteType: cn.format || "soap",
        content: noteContent,
        procedureCodes: cn.cdtCodes || cn.cptCodes,
        diagnosisCodes: cn.icd10Codes,
      };

      const result = await adapter.pushClinicalNote(await resolveConfig(ehrConfig), pushPayload);

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_note_push",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Pushed to ${ehrConfig.system}, patient: ${ehrPatientId}`,
      });

      if (result.success) {
        logger.info({ callId: req.params.callId, ehrRecordId: result.ehrRecordId }, "Clinical note pushed to EHR");
      } else {
        // Push failed — enqueue for background retry with exponential backoff
        const queued = await enqueueEhrNotePush({
          orgId: req.orgId!,
          callId: req.params.callId,
          ehrPatientId,
          ehrProviderId: ehrProviderId || undefined,
          noteContent,
          noteType: cn.format || "soap",
          procedureCodes: cn.cdtCodes || cn.cptCodes,
          diagnosisCodes: cn.icd10Codes,
          queuedAt: new Date().toISOString(),
        });

        if (queued) {
          logger.info({ callId: req.params.callId }, "EHR note push failed — queued for background retry");
        }

        // Return the failure result plus queued info — let the client show a warning
        res.json({ ...result, retryQueued: queued });
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to push clinical note to EHR");
      res.status(500).json({ success: false, error: "Failed to push note to EHR" });
    }
  });

  // Get patient treatment plans from EHR
  app.get("/api/ehr/patients/:ehrPatientId/treatment-plans", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const plans = await adapter.getPatientTreatmentPlans(await resolveConfig(ehrConfig), req.params.ehrPatientId);

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_treatment_plan_view",
        resourceType: "ehr_treatment_plan",
        resourceId: req.params.ehrPatientId,
      });

      res.json(plans);
    } catch (error) {
      logger.error({ err: error }, "Failed to get treatment plans");
      res.status(500).json({ message: "Failed to get treatment plans" });
    }
  });

  // Disable EHR integration
  app.delete("/api/ehr/config", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      const settings = { ...org.settings } as any;
      if (settings.ehrConfig) {
        settings.ehrConfig.enabled = false;
      }

      await storage.updateOrganization(req.orgId!, { settings });
      invalidateOrgCache(req.orgId!);

      logPhiAccess({
        ...auditContext(req),
        event: "org_settings_update",
        resourceType: "organization",
        resourceId: req.orgId!,
        detail: "EHR integration disabled",
      });

      logger.info({ orgId: req.orgId }, "EHR integration disabled");
      res.json({ success: true, message: "EHR integration disabled" });
    } catch (error) {
      logger.error({ err: error }, "Failed to disable EHR integration");
      res.status(500).json({ message: "Failed to disable EHR integration" });
    }
  });

  // Get EHR prefill data for a patient (medications, allergies, recent visit history)
  // Used to pre-populate clinical note fields from EHR prior visit data
  app.get("/api/ehr/patients/:ehrPatientId/prefill-data", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig;

      if (!ehrConfig?.enabled || !ehrConfig?.system) {
        res.status(400).json({ message: "EHR integration is not configured or enabled for this organization" });
        return;
      }

      const decryptedConfig = await resolveConfig(ehrConfig);
      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `EHR adapter not available for: ${ehrConfig.system}` });
        return;
      }

      const { ehrPatientId } = req.params;

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_patient_prefill",
        resourceType: "ehr_patient",
        resourceId: ehrPatientId,
        detail: `Prefill data requested for EHR patient ${ehrPatientId}`,
      });

      // Get patient demographics and allergies from EHR
      const medications: Array<{ name: string; dose?: string; frequency?: string }> = [];
      let allergies: Array<{ substance: string; reaction?: string }> = [];
      let lastChiefComplaint: string | undefined;
      let demographicsNote: string | undefined;

      try {
        const patient = await adapter.getPatient(decryptedConfig, ehrPatientId);
        if (patient) {
          demographicsNote = [
            patient.dateOfBirth ? `DOB: ${patient.dateOfBirth}` : null,
            patient.phone ? `Phone: ${patient.phone}` : null,
          ].filter(Boolean).join(", ") || undefined;

          // Extract allergies from patient data if available
          if (patient.allergies && Array.isArray(patient.allergies)) {
            allergies = (patient.allergies as any[]).map(a => ({
              substance: typeof a === "string" ? a : (a.substance || a.name || String(a)),
              reaction: typeof a === "object" ? a.reaction || undefined : undefined,
            }));
          }
        }
      } catch (ehrErr) {
        logger.warn({ err: ehrErr, ehrPatientId }, "EHR patient lookup failed for prefill");
      }

      res.json({
        medications,
        allergies,
        chiefComplaintHistory: lastChiefComplaint ? [lastChiefComplaint] : [],
        demographicsNote,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get EHR prefill data");
      res.status(500).json({ message: "Failed to get EHR prefill data" });
    }
  });

  // Get EHR note push status for a call (pending retries, success/failure)
  app.get("/api/ehr/push-status/:callId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }

      const pushStatus = analysis.ehrPushStatus || null;
      res.json({ callId: req.params.callId, pushStatus });
    } catch (error) {
      logger.error({ err: error }, "Failed to get EHR push status");
      res.status(500).json({ message: "Failed to get push status" });
    }
  });

  // Manually trigger a retry for a failed EHR note push
  app.post("/api/ehr/push-note/:callId/retry", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      if (!analysis.clinicalNote.providerAttested || !analysis.clinicalNote.consentObtained) {
        res.status(400).json({ message: "Note must be attested and patient consent obtained before pushing to EHR" });
        return;
      }

      const { ehrPatientId, ehrProviderId } = req.body;
      if (!ehrPatientId) {
        res.status(400).json({ message: "ehrPatientId is required" });
        return;
      }

      // Decrypt and format note content
      const cn = { ...analysis.clinicalNote };
      const phiFields = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint"];
      for (const f of phiFields) {
        if (typeof cn[f] === "string") cn[f] = decryptField(cn[f]);
      }
      const noteContent = formatClinicalNoteForEhr(cn);

      const queued = await enqueueEhrNotePush({
        orgId: req.orgId!,
        callId: req.params.callId,
        ehrPatientId,
        ehrProviderId: ehrProviderId || undefined,
        noteContent,
        noteType: cn.format || "soap",
        procedureCodes: cn.cdtCodes || cn.cptCodes,
        diagnosisCodes: cn.icd10Codes,
        queuedAt: new Date().toISOString(),
      });

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_note_push",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Manual retry queued for ${ehrConfig.system}, patient: ${ehrPatientId}`,
      });

      if (queued) {
        res.json({ success: true, message: "Note push queued for retry" });
      } else {
        // Queue unavailable — try synchronously
        const adapter = getEhrAdapter(ehrConfig.system)!;
        const result = await adapter.pushClinicalNote(await resolveConfig(ehrConfig), {
          patientId: ehrPatientId,
          providerId: ehrProviderId || "",
          date: new Date().toISOString().split("T")[0]!,
          noteType: cn.format || "soap",
          content: noteContent,
          procedureCodes: cn.cdtCodes || cn.cptCodes,
          diagnosisCodes: cn.icd10Codes,
        });
        res.json(result);
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to retry EHR note push");
      res.status(500).json({ success: false, error: "Failed to retry note push" });
    }
  });

  // Match a call to an EHR appointment by time and provider
  app.get("/api/ehr/match-appointment/:callId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const call = await storage.getCall(req.orgId!, req.params.callId);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      const detectedProviderName = analysis?.detectedAgentName as string | undefined;

      const match = await matchCallToAppointment({
        orgId: req.orgId!,
        callTimestamp: (call as any).uploadedAt || (call as any).createdAt || new Date().toISOString(),
        detectedProviderName,
      });

      if (!match) {
        res.json({ matched: false, matchReason: "EHR integration not configured" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_appointment_view",
        resourceType: "ehr_appointment",
        resourceId: req.params.callId,
        detail: `Appointment match attempt for call ${req.params.callId}`,
      });

      res.json(match);
    } catch (error) {
      logger.error({ err: error }, "Appointment matching failed");
      res.status(500).json({ message: "Appointment matching failed" });
    }
  });

  // Create appointment in EHR (bidirectional sync)
  app.post("/api/ehr/appointments", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      if (!adapter.createAppointment) {
        res.status(400).json({ message: `${ehrConfig.system} adapter does not support appointment creation` });
        return;
      }

      const { patientId, providerId, date, startTime, duration, procedures, notes } = req.body;
      if (!patientId || !providerId || !date || !startTime) {
        res.status(400).json({ message: "patientId, providerId, date, and startTime are required" });
        return;
      }

      const result = await adapter.createAppointment(await resolveConfig(ehrConfig), {
        patientId, providerId, date, startTime,
        duration: duration || 30,
        procedures,
        notes,
      });

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_appointment_view",
        resourceType: "ehr_appointment",
        detail: `Appointment created for patient ${patientId}`,
      });

      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to create EHR appointment");
      res.status(500).json({ success: false, error: "Failed to create appointment" });
    }
  });

  // Update treatment plan in EHR (bidirectional sync)
  app.patch("/api/ehr/treatment-plans/:planId", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      if (!adapter.updateTreatmentPlan) {
        res.status(400).json({ message: `${ehrConfig.system} adapter does not support treatment plan updates` });
        return;
      }

      const { status, notes, phaseUpdates } = req.body;
      const result = await adapter.updateTreatmentPlan(await resolveConfig(ehrConfig), req.params.planId, {
        status,
        notes,
        phaseUpdates,
      });

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_treatment_plan_view",
        resourceType: "ehr_treatment_plan",
        resourceId: req.params.planId,
        detail: `Treatment plan ${req.params.planId} updated`,
      });

      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to update treatment plan");
      res.status(500).json({ success: false, error: "Failed to update treatment plan" });
    }
  });

  // Get current EHR health status (from cached org settings, no live check)
  app.get("/api/ehr/health", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await getCachedOrganization(req.orgId!);
      const settings = org?.settings as any;
      const healthStatus = settings?.ehrHealthStatus || null;
      const ehrConfig = settings?.ehrConfig;

      res.json({
        configured: !!ehrConfig?.enabled,
        system: ehrConfig?.system || null,
        health: healthStatus,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get EHR health status");
      res.status(500).json({ message: "Failed to get health status" });
    }
  });

  // Configure EHR credentials via AWS Secrets Manager ARN (admin only)
  app.put("/api/ehr/config/secret-arn", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const { secretArn } = req.body;

      if (!secretArn) {
        res.status(400).json({ message: "secretArn is required" });
        return;
      }

      // Validate ARN format: arn:aws:secretsmanager:{region}:{account}:secret:{name}
      if (!secretArn.startsWith("arn:aws:secretsmanager:")) {
        res.status(400).json({ message: "Invalid Secrets Manager ARN format. Expected: arn:aws:secretsmanager:{region}:{account}:secret:{name}" });
        return;
      }

      const org = await getCachedOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      const settings = org.settings as any;
      if (!settings?.ehrConfig?.system) {
        res.status(400).json({ message: "Configure EHR system first before setting Secret ARN" });
        return;
      }

      // Store the ARN; remove local encrypted key (credentials now live in Secrets Manager)
      const updatedEhrConfig = {
        ...settings.ehrConfig,
        secretArn,
        apiKey: undefined, // Remove local key — Secrets Manager is the source of truth
      };

      // Invalidate the secret cache in case the ARN is being rotated
      invalidateSecretCache(secretArn);

      await storage.updateOrganization(req.orgId!, {
        settings: { ...settings, ehrConfig: updatedEhrConfig } as any,
      });
      invalidateOrgCache(req.orgId!);

      logPhiAccess({
        ...auditContext(req),
        event: "org_settings_update",
        resourceType: "organization",
        resourceId: req.orgId!,
        detail: "EHR credentials moved to AWS Secrets Manager",
      });

      logger.info({ orgId: req.orgId }, "EHR credentials moved to Secrets Manager");
      res.json({ success: true, message: "EHR credentials will now be fetched from AWS Secrets Manager" });
    } catch (error) {
      logger.error({ err: error }, "Failed to set Secrets Manager ARN for EHR");
      res.status(500).json({ message: "Failed to update EHR Secrets Manager configuration" });
    }
  });
}

/**
 * Format a clinical note object into readable text for EHR insertion.
 */
function formatClinicalNoteForEhr(cn: any): string {
  const sections: string[] = [];

  if (cn.chiefComplaint) sections.push(`CHIEF COMPLAINT: ${cn.chiefComplaint}`);
  if (cn.subjective) sections.push(`SUBJECTIVE:\n${cn.subjective}`);
  if (cn.objective) sections.push(`OBJECTIVE:\n${cn.objective}`);
  if (cn.assessment) sections.push(`ASSESSMENT:\n${cn.assessment}`);
  if (cn.plan?.length) sections.push(`PLAN:\n${cn.plan.map((p: string, i: number) => `${i + 1}. ${p}`).join("\n")}`);
  if (cn.hpiNarrative) sections.push(`HPI:\n${cn.hpiNarrative}`);

  if (cn.icd10Codes?.length) {
    sections.push(`DIAGNOSES:\n${cn.icd10Codes.map((c: any) => `${c.code} — ${c.description}`).join("\n")}`);
  }
  if (cn.cdtCodes?.length) {
    sections.push(`PROCEDURES (CDT):\n${cn.cdtCodes.map((c: any) => `${c.code} — ${c.description}`).join("\n")}`);
  }
  if (cn.cptCodes?.length) {
    sections.push(`PROCEDURES (CPT):\n${cn.cptCodes.map((c: any) => `${c.code} — ${c.description}`).join("\n")}`);
  }
  if (cn.prescriptions?.length) {
    sections.push(`PRESCRIPTIONS:\n${cn.prescriptions.map((rx: any) => `${rx.medication} ${rx.dosage || ""} — ${rx.instructions || ""}`).join("\n")}`);
  }
  if (cn.toothNumbers?.length) {
    sections.push(`TEETH INVOLVED: ${cn.toothNumbers.join(", ")}`);
  }
  if (cn.followUp) sections.push(`FOLLOW-UP: ${cn.followUp}`);

  sections.push(`\n--- Generated by Observatory QA (AI Draft — Provider Attested) ---`);

  return sections.join("\n\n");
}
