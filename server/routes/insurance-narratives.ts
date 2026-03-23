import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { aiProvider } from "../services/ai-factory";
import { logger } from "../services/logger";
import { validateUUIDParam, withRetry } from "./helpers";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { requirePlanFeature } from "./billing";
import { INSURANCE_LETTER_TYPES } from "@shared/schema";

/**
 * Generate an insurance narrative letter.
 * When AI (Bedrock) is available, generates a professional letter via LLM.
 * Falls back to template-based generation when AI is unavailable.
 */
async function generateNarrative(params: {
  letterType: string;
  patientName: string;
  insurerName: string;
  patientDob?: string;
  memberId?: string;
  diagnosisCodes?: Array<{ code: string; description: string }>;
  procedureCodes?: Array<{ code: string; description: string }>;
  clinicalJustification?: string;
  priorDenialReference?: string;
}): Promise<string> {
  const { letterType, patientName, insurerName, patientDob, memberId, diagnosisCodes, procedureCodes, clinicalJustification, priorDenialReference } = params;
  const letterTypeLabel = INSURANCE_LETTER_TYPES.find(t => t.value === letterType)?.label || letterType;

  // Try AI generation first
  if (aiProvider.isAvailable && aiProvider.generateText) {
    try {
      const diagnosisStr = diagnosisCodes?.map(c => `${c.code}: ${c.description}`).join("\n") || "None provided";
      const procedureStr = procedureCodes?.map(c => `${c.code}: ${c.description}`).join("\n") || "None provided";

      const prompt = `You are a dental/medical insurance specialist writing a "${letterTypeLabel}" letter. Generate a professional, compelling insurance letter.

PATIENT: ${patientName}${patientDob ? ` (DOB: ${patientDob})` : ""}${memberId ? ` (Member ID: ${memberId})` : ""}
INSURANCE COMPANY: ${insurerName}
LETTER TYPE: ${letterTypeLabel}
${priorDenialReference ? `PRIOR DENIAL REFERENCE: ${priorDenialReference}` : ""}

DIAGNOSIS CODES:
${diagnosisStr}

PROCEDURE CODES:
${procedureStr}

CLINICAL JUSTIFICATION:
${clinicalJustification || "Not provided — use the diagnosis and procedure codes to construct justification."}

Write a complete, professionally formatted letter that:
1. Opens with today's date and proper salutation
2. Clearly states the purpose (${letterType === "appeal" ? "appeal of denial" : letterType === "prior_auth" ? "prior authorization request" : letterType === "medical_necessity" ? "medical necessity justification" : letterType === "predetermination" ? "predetermination request" : "peer-to-peer review summary"})
3. Includes patient demographics and insurance details
4. Presents a strong clinical justification citing the diagnosis codes
5. Lists the specific procedures requested with CDT/CPT codes
6. References evidence-based guidelines where applicable
7. Closes with a professional request for approval
8. Ends with signature block placeholders

Output ONLY the letter text (no JSON, no markdown fences).`;

      const response = await withRetry(
        () => aiProvider.generateText!(prompt),
        { retries: 1, baseDelay: 2000, label: "insurance narrative generation" }
      );

      if (response && response.length > 100) {
        return response;
      }
    } catch (err) {
      logger.warn({ err }, "AI narrative generation failed, falling back to template");
    }
  }

  // Fallback: template-based generation
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  let narrative = `${today}\n\nRe: ${letterTypeLabel}\nPatient: ${patientName}`;
  if (patientDob) narrative += `\nDate of Birth: ${patientDob}`;
  if (memberId) narrative += `\nMember ID: ${memberId}`;
  narrative += `\n\nDear ${insurerName} Medical Review Team,\n\n`;

  if (letterType === "prior_auth") {
    narrative += `I am writing to request prior authorization for the following treatment plan for the above-referenced patient.\n\n`;
  } else if (letterType === "appeal") {
    narrative += `I am writing to formally appeal the denial of coverage${priorDenialReference ? ` (Reference: ${priorDenialReference})` : ""} for the above-referenced patient.\n\n`;
  } else if (letterType === "medical_necessity") {
    narrative += `I am writing to establish the medical necessity of the proposed treatment for the above-referenced patient.\n\n`;
  } else if (letterType === "predetermination") {
    narrative += `I am requesting a predetermination of benefits for the following proposed treatment plan.\n\n`;
  } else if (letterType === "peer_to_peer") {
    narrative += `The following summarizes the clinical basis for the proposed treatment, prepared for peer-to-peer review.\n\n`;
  }

  if (clinicalJustification) {
    narrative += `CLINICAL JUSTIFICATION:\n${clinicalJustification}\n\n`;
  }

  if (diagnosisCodes && diagnosisCodes.length > 0) {
    narrative += `DIAGNOSIS CODES:\n`;
    for (const code of diagnosisCodes) {
      narrative += `  - ${code.code}: ${code.description}\n`;
    }
    narrative += `\n`;
  }

  if (procedureCodes && procedureCodes.length > 0) {
    narrative += `PROCEDURE CODES:\n`;
    for (const code of procedureCodes) {
      narrative += `  - ${code.code}: ${code.description}\n`;
    }
    narrative += `\n`;
  }

  narrative += `Based on the clinical findings and established treatment guidelines, the proposed procedures are medically necessary and appropriate for this patient's condition. I respectfully request that coverage be authorized.\n\n`;
  narrative += `Please do not hesitate to contact our office should you require any additional information.\n\nSincerely,\n[Provider Name]\n[Provider Credentials]\n[Practice Name]\n[NPI Number]`;

  return narrative;
}

export function registerInsuranceNarrativeRoutes(app: Express) {
  // List insurance letter types
  app.get("/api/insurance-narratives/types", requireAuth, async (_req, res) => {
    res.json(INSURANCE_LETTER_TYPES);
  });

  // Create a new insurance narrative (optionally linked to a call)
  app.post("/api/insurance-narratives", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { callId, patientName, patientDob, memberId, insurerName, insurerAddress,
              letterType, diagnosisCodes, procedureCodes, clinicalJustification, priorDenialReference } = req.body;

      if (!patientName || !insurerName || !letterType) {
        return res.status(400).json({ message: "patientName, insurerName, and letterType are required" });
      }

      // If linked to a call, pull clinical data
      let enrichedJustification = clinicalJustification;
      let enrichedDiagnosisCodes = diagnosisCodes;
      let enrichedProcedureCodes = procedureCodes;

      if (callId) {
        const analysis = await storage.getCallAnalysis(orgId, callId);
        if (analysis?.clinicalNote) {
          const note = analysis.clinicalNote as Record<string, unknown>;
          if (!enrichedJustification && note.assessment) {
            enrichedJustification = String(note.assessment);
          }
          if (!enrichedDiagnosisCodes && note.icd10Codes) {
            enrichedDiagnosisCodes = note.icd10Codes;
          }
          if (!enrichedProcedureCodes) {
            enrichedProcedureCodes = (note.cptCodes || note.cdtCodes) as typeof procedureCodes;
          }
        }
      }

      // Generate the narrative (passes patient demographics for richer AI output)
      const generatedNarrative = await generateNarrative({
        letterType, patientName, insurerName, patientDob, memberId,
        diagnosisCodes: enrichedDiagnosisCodes, procedureCodes: enrichedProcedureCodes,
        clinicalJustification: enrichedJustification, priorDenialReference,
      });

      const narrative = await storage.createInsuranceNarrative(orgId, {
        orgId, callId, patientName, patientDob, memberId, insurerName, insurerAddress,
        letterType, diagnosisCodes: enrichedDiagnosisCodes, procedureCodes: enrichedProcedureCodes,
        clinicalJustification: enrichedJustification, priorDenialReference,
        generatedNarrative, status: "draft",
        createdBy: req.user!.name || req.user!.username,
      });

      logger.info({ orgId, narrativeId: narrative.id, letterType }, "Insurance narrative created");
      res.json(narrative);
    } catch (error) {
      logger.error({ err: error }, "Failed to create insurance narrative");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to create insurance narrative"));
    }
  });

  // List narratives for the org
  app.get("/api/insurance-narratives", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { callId, status } = req.query;
      const narratives = await storage.listInsuranceNarratives(orgId, {
        callId: callId as string | undefined,
        status: status as string | undefined,
      });
      res.json(narratives);
    } catch (error) {
      logger.error({ err: error }, "Failed to list insurance narratives");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to list insurance narratives"));
    }
  });

  // Get a specific narrative
  app.get("/api/insurance-narratives/:id", requireAuth, injectOrgContext, validateUUIDParam(), async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const narrative = await storage.getInsuranceNarrative(orgId, req.params.id);
      if (!narrative) return res.status(404).json({ message: "Narrative not found" });
      res.json(narrative);
    } catch (error) {
      logger.error({ err: error }, "Failed to get insurance narrative");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get insurance narrative"));
    }
  });

  // Update narrative (edit content, change status)
  app.patch("/api/insurance-narratives/:id", requireAuth, requireRole("manager"), injectOrgContext, validateUUIDParam(), async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const updated = await storage.updateInsuranceNarrative(orgId, req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Narrative not found" });
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update insurance narrative");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update insurance narrative"));
    }
  });

  // Delete a narrative
  app.delete("/api/insurance-narratives/:id", requireAuth, requireRole("manager"), injectOrgContext, validateUUIDParam(), async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      await storage.deleteInsuranceNarrative(orgId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, "Failed to delete insurance narrative");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to delete insurance narrative"));
    }
  });

  // Regenerate narrative text with updated params
  app.post("/api/insurance-narratives/:id/regenerate", requireAuth, requireRole("manager"), injectOrgContext, validateUUIDParam(), async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const narrative = await storage.getInsuranceNarrative(orgId, req.params.id);
      if (!narrative) return res.status(404).json({ message: "Narrative not found" });

      const generatedNarrative = await generateNarrative({
        letterType: narrative.letterType,
        patientName: narrative.patientName,
        insurerName: narrative.insurerName,
        patientDob: narrative.patientDob,
        memberId: narrative.memberId,
        diagnosisCodes: narrative.diagnosisCodes,
        procedureCodes: narrative.procedureCodes,
        clinicalJustification: narrative.clinicalJustification,
        priorDenialReference: narrative.priorDenialReference,
      });

      const updated = await storage.updateInsuranceNarrative(orgId, req.params.id, { generatedNarrative });
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to regenerate insurance narrative");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to regenerate narrative"));
    }
  });
}
