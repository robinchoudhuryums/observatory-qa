/**
 * Clinical compliance routes: amendments, addenda, FHIR export, co-signatures.
 *
 * Extracted from clinical.ts to keep route files under ~800 lines.
 * All routes require clinical documentation plan.
 */
import type { Express, RequestHandler } from "express";
import { requireAuth, requireRole, injectOrgContext, getCachedOrganization } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { decryptField, encryptField, decryptClinicalNotePhi } from "../services/phi-encryption";
import { buildFhirBundle } from "../services/fhir";
import type { OrgSettings } from "@shared/schema";
import { asyncHandler } from "../middleware/error-handler";

export function registerClinicalComplianceRoutes(app: Express, requireClinicalPlan: () => RequestHandler): void {
  // ==================== AMENDMENT / ADDENDUM WORKFLOW ====================

  app.get(
    "/api/clinical/notes/:callId/amendments",
    requireAuth, injectOrgContext, requireClinicalPlan(),
    asyncHandler(async (req, res) => {
        const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
        if (!analysis?.clinicalNote) {
          res.status(404).json({ message: "No clinical note found for this encounter" });
          return;
        }
        logPhiAccess({
          ...auditContext(req),
          event: "view_clinical_amendments",
          resourceType: "clinical_note",
          resourceId: req.params.callId,
        });

        let decryptionFailures = 0;
        const amendments = (analysis.clinicalNote.amendments || []).map((a: any) => {
          if (a.content && typeof a.content === "string" && a.content.startsWith("enc_v1:")) {
            try {
              return { ...a, content: decryptField(a.content) };
            } catch (decryptErr) {
              decryptionFailures++;
              logger.warn(
                { callId: req.params.callId, amendedAt: a.amendedAt, err: decryptErr },
                "Amendment content decryption failed — possible key mismatch or data corruption",
              );
              return { ...a, content: "[Decryption failed — content unavailable]" };
            }
          }
          return a;
        });
        if (decryptionFailures > 0) {
          logPhiAccess({
            ...auditContext(req),
            event: "phi_decryption_failure",
            resourceType: "clinical_amendment",
            resourceId: req.params.callId,
            detail: `${decryptionFailures} amendment(s) failed to decrypt`,
          });
        }

        res.json({ amendments, count: amendments.length });
      }),
  );

  app.post(
    "/api/clinical/notes/:callId/addendum",
    requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
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
          content: encryptField(content.trim()),
          integrityHash: "",
        };
        // Amendment chain integrity: SHA-256(prevHash + type + reason + amendedBy + amendedAt)
        const { createHash } = await import("crypto");
        const existingAmendments = analysis.clinicalNote.amendments || [];
        const prevHash = existingAmendments.length > 0
          ? (existingAmendments[existingAmendments.length - 1] as any).integrityHash || ""
          : "";
        addendum.integrityHash = createHash("sha256")
          .update(`${prevHash}|${addendum.type}|${addendum.reason}|${addendum.amendedBy}|${addendum.amendedAt}`)
          .digest("hex");

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
      }),
  );

  // ==================== FHIR R4 EXPORT ====================

  app.get(
    "/api/clinical/notes/:callId/fhir",
    requireAuth, injectOrgContext, requireClinicalPlan(),
    asyncHandler(async (req, res) => {
        const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
        if (!analysis?.clinicalNote) {
          res.status(404).json({ message: "No clinical note found for this encounter" });
          return;
        }

        const cn = analysis.clinicalNote;

        if (!cn.providerAttested) {
          res.status(403).json({
            message: "Clinical note must be attested before FHIR export. Please have the provider attest the note first.",
            code: "OBS-CLINICAL-FHIR-UNATTESTED",
            attestedBy: cn.attestedBy,
          });
          return;
        }

        try {
          decryptClinicalNotePhi(analysis as Record<string, unknown>, {
            userId: req.user?.id,
            orgId: req.orgId,
            resourceId: req.params.callId,
            resourceType: "clinical_note_fhir",
          });
        } catch (decryptErr) {
          logger.error({ err: decryptErr, callId: req.params.callId }, "PHI decryption failed for FHIR export");
          res.status(503).json({ message: "Unable to decrypt clinical note for FHIR export.", errorCode: "OBS-PHI-001" });
          return;
        }

        const org = await getCachedOrganization(req.orgId!);
        const orgName = org?.name || "Unknown Organization";
        const providerName = cn.attestedBy || req.user?.name || req.user?.username || "Unknown Provider";
        const npi = cn.attestedNpi;

        let patientData: { id?: string; firstName?: string; lastName?: string; dateOfBirth?: string; phone?: string; email?: string } | undefined;
        const call = await storage.getCall(req.orgId!, req.params.callId);
        const ehrPatientId = (call as any)?.ehrPatientId || req.query.ehrPatientId;
        if (ehrPatientId) {
          try {
            const { getEhrAdapter } = await import("../services/ehr/index");
            const ehrConfig = (org?.settings as any)?.ehrConfig;
            if (ehrConfig?.enabled) {
              const adapter = getEhrAdapter(ehrConfig.system);
              if (!adapter) throw new Error("EHR adapter not available");
              const patient = await adapter.getPatient(ehrConfig, ehrPatientId as string);
              if (patient) {
                patientData = {
                  id: patient.ehrPatientId, firstName: patient.firstName,
                  lastName: patient.lastName, dateOfBirth: patient.dateOfBirth,
                  phone: patient.phone, email: patient.email,
                };
              }
            }
          } catch (ehrErr) {
            logger.debug({ err: ehrErr }, "EHR patient lookup failed for FHIR export — continuing without patient");
          }
        }

        const cosigner = cn.cosignature
          ? { name: (cn.cosignature as any).cosignedBy, npi: (cn.cosignature as any).cosignedNpi, credentials: (cn.cosignature as any).credentials }
          : undefined;

        const fhirBundle = buildFhirBundle({ note: cn as Record<string, unknown>, callId: req.params.callId, orgName, providerName, npi, patient: patientData, cosigner });

        logPhiAccess({
          ...auditContext(req),
          event: "fhir_export",
          resourceType: "clinical_note",
          resourceId: req.params.callId,
          detail: `FHIR R4 Bundle exported for call ${req.params.callId}`,
        });

        res.setHeader("Content-Type", "application/fhir+json");
        res.json(fhirBundle);
      }),
  );

  // ==================== CO-SIGNATURE WORKFLOW ====================

  app.post(
    "/api/clinical/notes/:callId/cosign",
    requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"),
    asyncHandler(async (req, res) => {
        const { npiNumber, role } = req.body;

        // Validate NPI format if provided (same check as attestation endpoint)
        if (npiNumber && !/^\d{10}$/.test(npiNumber)) {
          res.status(400).json({ message: "NPI must be exactly 10 digits" });
          return;
        }

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

        // Verify the note hasn't been edited since attestation.
        // If amendments exist after attestation, the cosigner is signing a modified version
        // which they may not have reviewed. Require re-attestation first.
        //
        // Addenda are legitimate post-attestation additions (not edits), but a cosigner
        // may not have seen them — require explicit acknowledgment before co-signing a
        // note with post-attestation addenda. See F-11 in broad-scan audit.
        const amendments = analysis.clinicalNote.amendments || [];
        const attestedAt = analysis.clinicalNote.attestedAt;
        let acknowledgedAddendaCount = 0;
        if (attestedAt && amendments.length > 0) {
          const attestedAtDate = new Date(attestedAt);
          const postAttestAmendments = amendments.filter(
            (a: any) => a.type === "amendment" && new Date(a.amendedAt) > attestedAtDate,
          );
          if (postAttestAmendments.length > 0) {
            res.status(409).json({
              message: "This note was edited after attestation. The provider must re-attest before co-signature.",
              code: "OBS-CLINICAL-COSIGN-STALE",
              postAttestAmendments: postAttestAmendments.length,
            });
            return;
          }
          const postAttestAddenda = amendments.filter(
            (a: any) => a.type === "addendum" && new Date(a.amendedAt) > attestedAtDate,
          );
          if (postAttestAddenda.length > 0 && req.body.acknowledgedAddenda !== true) {
            res.status(409).json({
              message:
                "This note has addenda added after attestation. Review the addenda and resubmit with acknowledgedAddenda: true to co-sign.",
              code: "OBS-CLINICAL-COSIGN-ADDENDA",
              postAttestAddenda: postAttestAddenda.length,
              addenda: postAttestAddenda.map((a: any) => ({
                amendedAt: a.amendedAt,
                reason: a.reason,
                amendedBy: a.amendedBy,
              })),
            });
            return;
          }
          acknowledgedAddendaCount = postAttestAddenda.length;
        }

        // Optimistic locking: verify version hasn't changed since client loaded the note
        const currentVersion = analysis.clinicalNote.version || 0;
        if (req.body.version !== undefined && req.body.version !== currentVersion) {
          res.status(409).json({
            message: "Clinical note has been modified since you loaded it. Please refresh and try again.",
            code: "OBS-CLINICAL-CONFLICT",
            currentVersion,
          });
          return;
        }
        analysis.clinicalNote.version = currentVersion + 1;

        const cosignedAt = new Date().toISOString();
        analysis.clinicalNote.cosignature = {
          cosignedBy: req.user?.name || req.user?.username || "unknown",
          cosignedById: req.user?.id,
          cosignedNpi: npiNumber ? encryptField(npiNumber) : undefined,
          cosignedAt,
          role: role || undefined,
          ...(acknowledgedAddendaCount > 0 ? { acknowledgedAddendaCount } : {}),
        };
        analysis.clinicalNote.cosignatureRequired = false;

        await storage.createCallAnalysis(req.orgId!, analysis);

        logPhiAccess({
          ...auditContext(req),
          event: "cosign_clinical_note",
          resourceType: "clinical_note",
          resourceId: req.params.callId,
          detail: `Co-signed by ${req.user?.name || req.user?.username}${role ? ` (${role})` : ""}${acknowledgedAddendaCount > 0 ? ` — acknowledged ${acknowledgedAddendaCount} post-attestation addend${acknowledgedAddendaCount === 1 ? "um" : "a"}` : ""}`,
        });

        logger.info({ callId: req.params.callId }, "Clinical note co-signed");
        res.json({ success: true, cosignedAt });
      }),
  );
}
