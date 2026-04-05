import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { aiProvider } from "../services/ai-factory";
import { logger } from "../services/logger";
import { validateUUIDParam, withRetry } from "./helpers";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { requirePlanFeature } from "./billing";
import { INSURANCE_LETTER_TYPES, type InsuranceNarrative } from "@shared/schema";
import { asyncHandler } from "../middleware/error-handler";

// --- Payer-specific templates ---
const PAYER_TEMPLATES = [
  {
    key: "bcbs",
    name: "Blue Cross Blue Shield",
    requiredFields: ["memberId", "groupNumber", "providerNPI"],
    preferredFormat:
      "Include medical policy number in subject line. BCBS prefers structured clinical summaries with ADA codes.",
    tips: "Reference specific BCBS medical policy numbers. Include radiographs as attachments.",
  },
  {
    key: "aetna",
    name: "Aetna",
    requiredFields: ["memberId", "preAuthNumber"],
    preferredFormat:
      "Aetna requires specific form numbers. Use CDT codes with tooth numbers. Include periodontal charting for perio claims.",
    tips: "Aetna has a 30-day appeal window. Submit via Availity portal when possible.",
  },
  {
    key: "uhc",
    name: "UnitedHealthcare",
    requiredFields: ["memberId", "claimNumber"],
    preferredFormat: "UHC prefers concise clinical narratives with evidence-based citations. Include ADA D-codes.",
    tips: "UHC accepts electronic prior auth via their provider portal. 60-day appeal deadline.",
  },
  {
    key: "cigna",
    name: "Cigna",
    requiredFields: ["memberId", "referralNumber"],
    preferredFormat:
      "Cigna requires separate narratives per procedure. Include clinical photographs for cosmetic denials.",
    tips: "Cigna peer-to-peer reviews can be scheduled via provider hotline. 45-day appeal window.",
  },
  {
    key: "delta_dental",
    name: "Delta Dental",
    requiredFields: ["memberId", "subscriberId"],
    preferredFormat: "Delta Dental prefers CDT code-specific narratives. Include pre-op and post-op radiographs.",
    tips: "Delta Dental has plan-specific limitations. Verify frequency limitations before submitting.",
  },
  {
    key: "metlife",
    name: "MetLife",
    requiredFields: ["memberId", "groupNumber"],
    preferredFormat: "MetLife requires narrative + claim form together. Use their specific appeal form for denials.",
    tips: "MetLife processes faster with electronic submissions. 90-day filing deadline for appeals.",
  },
  {
    key: "generic",
    name: "Other / Generic",
    requiredFields: ["memberId"],
    preferredFormat: "Standard clinical narrative with diagnosis codes, procedure codes, and clinical justification.",
    tips: "Check the payer's provider manual for specific submission requirements.",
  },
] as const;

// --- Supporting document checklist by letter type ---
function generateChecklist(
  letterType: string,
  narrative: InsuranceNarrative,
): Array<{ name: string; required: boolean; notes?: string }> {
  const common = [
    { name: "Completed claim form (ADA/CMS-1500)", required: true },
    { name: "Clinical narrative letter", required: true, notes: "The generated letter" },
    { name: "Patient consent form", required: true },
  ];

  const byType: Record<string, Array<{ name: string; required: boolean; notes?: string }>> = {
    prior_auth: [
      ...common,
      { name: "Pre-operative radiographs", required: true, notes: "Periapical and/or panoramic" },
      { name: "Periodontal charting", required: false, notes: "Required for perio procedures" },
      { name: "Clinical photographs", required: false, notes: "Intraoral photos of affected area" },
      { name: "Treatment plan with CDT codes", required: true },
      { name: "Medical history relevant to treatment", required: false },
    ],
    appeal: [
      ...common,
      { name: "Original denial letter (EOB)", required: true, notes: "Include denial code and date" },
      { name: "Pre-operative radiographs", required: true },
      { name: "Post-operative radiographs", required: false, notes: "If treatment already completed" },
      { name: "Clinical photographs", required: true, notes: "Before/during/after if available" },
      { name: "Peer-reviewed literature citations", required: false, notes: "Strengthens appeal significantly" },
      { name: "Previous treatment records", required: false },
      { name: "ADA/AAP clinical guidelines reference", required: false },
    ],
    predetermination: [
      ...common,
      { name: "Diagnostic radiographs", required: true },
      { name: "Treatment plan with fee schedule", required: true },
      { name: "Alternative treatment options considered", required: false },
    ],
    medical_necessity: [
      ...common,
      { name: "Diagnostic radiographs", required: true },
      { name: "Clinical photographs", required: true },
      { name: "Periodontal charting", required: false },
      {
        name: "Medical history and comorbidities",
        required: true,
        notes: "Especially systemic conditions affecting oral health",
      },
      { name: "Peer-reviewed literature supporting necessity", required: false },
      {
        name: "Failed conservative treatment documentation",
        required: false,
        notes: "Evidence that less invasive options were attempted",
      },
    ],
    peer_to_peer: [
      { name: "Clinical narrative summary", required: true },
      { name: "All supporting radiographs", required: true },
      { name: "Treatment plan", required: true },
      { name: "Patient history summary", required: true },
      { name: "Peer-reviewed references", required: false },
    ],
  };

  return byType[letterType] || common;
}

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
  const {
    letterType,
    patientName,
    insurerName,
    patientDob,
    memberId,
    diagnosisCodes,
    procedureCodes,
    clinicalJustification,
    priorDenialReference,
  } = params;
  const letterTypeLabel = INSURANCE_LETTER_TYPES.find((t) => t.value === letterType)?.label || letterType;

  // Try AI generation first
  if (aiProvider.isAvailable && aiProvider.generateText) {
    try {
      const diagnosisStr = diagnosisCodes?.map((c) => `${c.code}: ${c.description}`).join("\n") || "None provided";
      const procedureStr = procedureCodes?.map((c) => `${c.code}: ${c.description}`).join("\n") || "None provided";

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

      const response = await withRetry(() => aiProvider.generateText!(prompt), {
        retries: 1,
        baseDelay: 2000,
        label: "insurance narrative generation",
      });

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
  app.post("/api/insurance-narratives", requireAuth, requireRole("manager"), injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const {
        callId,
        patientName,
        patientDob,
        memberId,
        insurerName,
        insurerAddress,
        letterType,
        diagnosisCodes,
        procedureCodes,
        clinicalJustification,
        priorDenialReference,
      } = req.body;

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
        letterType,
        patientName,
        insurerName,
        patientDob,
        memberId,
        diagnosisCodes: enrichedDiagnosisCodes,
        procedureCodes: enrichedProcedureCodes,
        clinicalJustification: enrichedJustification,
        priorDenialReference,
      });

      const narrative = await storage.createInsuranceNarrative(orgId, {
        orgId,
        callId,
        patientName,
        patientDob,
        memberId,
        insurerName,
        insurerAddress,
        letterType,
        diagnosisCodes: enrichedDiagnosisCodes,
        procedureCodes: enrichedProcedureCodes,
        clinicalJustification: enrichedJustification,
        priorDenialReference,
        generatedNarrative,
        status: "draft",
        createdBy: req.user!.name || req.user!.username,
      });

      logger.info({ orgId, narrativeId: narrative.id, letterType }, "Insurance narrative created");
      res.json(narrative);
    }));

  // List narratives for the org
  app.get("/api/insurance-narratives", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { callId, status } = req.query;
      const narratives = await storage.listInsuranceNarratives(orgId, {
        callId: callId as string | undefined,
        status: status as string | undefined,
      });
      res.json(narratives);
    }));

  // Get a specific narrative
  app.get("/api/insurance-narratives/:id", requireAuth, injectOrgContext, validateUUIDParam(), asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const narrative = await storage.getInsuranceNarrative(orgId, req.params.id);
      if (!narrative) return res.status(404).json({ message: "Narrative not found" });
      res.json(narrative);
    }));

  // Update narrative (edit content, change status)
  app.patch(
    "/api/insurance-narratives/:id",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateUUIDParam(),
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        const updated = await storage.updateInsuranceNarrative(orgId, req.params.id, req.body);
        if (!updated) return res.status(404).json({ message: "Narrative not found" });
        res.json(updated);
      }),
  );

  // Delete a narrative
  app.delete(
    "/api/insurance-narratives/:id",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateUUIDParam(),
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        await storage.deleteInsuranceNarrative(orgId, req.params.id);
        res.json({ success: true });
      }),
  );

  // --- Payer-specific templates ---
  app.get("/api/insurance-narratives/payer-templates", requireAuth, injectOrgContext, async (_req, res) => {
    res.json(PAYER_TEMPLATES);
  });

  // --- Record outcome (approved/denied/partial) ---
  app.post(
    "/api/insurance-narratives/:id/outcome",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateUUIDParam(),
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        const narrative = await storage.getInsuranceNarrative(orgId, req.params.id);
        if (!narrative) return res.status(404).json({ message: "Narrative not found" });

        const { outcome, outcomeNotes, denialCode, denialReason } = req.body;
        if (!outcome || !["approved", "denied", "partial_approval", "pending", "withdrawn"].includes(outcome)) {
          return res
            .status(400)
            .json({ message: "Valid outcome required: approved, denied, partial_approval, pending, withdrawn" });
        }

        const updates: Record<string, any> = {
          outcome,
          outcomeDate: new Date().toISOString(),
          outcomeNotes: outcomeNotes || undefined,
        };

        if (outcome === "denied" || outcome === "partial_approval") {
          if (!denialCode) {
            return res
              .status(400)
              .json({ message: "denialCode is required when outcome is denied or partial_approval" });
          }
          updates.denialCode = denialCode;
          if (denialReason) updates.denialReason = denialReason;
        }

        const updated = await storage.updateInsuranceNarrative(orgId, req.params.id, updates);
        logPhiAccess({
          ...auditContext(req),
          event: "narrative_outcome_recorded",
          resourceType: "insurance_narrative",
          resourceId: req.params.id,
        });
        res.json(updated);
      }),
  );

  // --- Denial code analysis ---
  app.get(
    "/api/insurance-narratives/denial-analysis",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        const narratives = await storage.listInsuranceNarratives(orgId);
        const denied = narratives.filter((n) => n.outcome === "denied" || n.outcome === "partial_approval");

        if (denied.length === 0) {
          return res.json({ totalDenials: 0, denialCodes: [], patterns: [], message: "No denials recorded yet" });
        }

        // Group by denial code
        const codeGroups: Record<
          string,
          { count: number; reasons: string[]; letterTypes: string[]; insurers: string[] }
        > = {};
        for (const n of denied) {
          const code = (n as any).denialCode || "unknown";
          if (!codeGroups[code]) codeGroups[code] = { count: 0, reasons: [], letterTypes: [], insurers: [] };
          codeGroups[code].count++;
          if ((n as any).denialReason && !codeGroups[code].reasons.includes((n as any).denialReason)) {
            codeGroups[code].reasons.push((n as any).denialReason);
          }
          if (!codeGroups[code].letterTypes.includes(n.letterType)) codeGroups[code].letterTypes.push(n.letterType);
          if (!codeGroups[code].insurers.includes(n.insurerName)) codeGroups[code].insurers.push(n.insurerName);
        }

        const denialCodes = Object.entries(codeGroups)
          .map(([code, data]) => ({
            code,
            count: data.count,
            percentOfDenials: Math.round((data.count / denied.length) * 10000) / 100,
            commonReasons: data.reasons.slice(0, 3),
            affectedLetterTypes: data.letterTypes,
            affectedInsurers: data.insurers,
          }))
          .sort((a, b) => b.count - a.count);

        // Approval rate by insurer — includes partial_approval tracking
        const insurerStats: Record<
          string,
          { total: number; approved: number; denied: number; partialApproval: number }
        > = {};
        for (const n of narratives) {
          if (!n.outcome || n.outcome === "pending") continue;
          if (!insurerStats[n.insurerName])
            insurerStats[n.insurerName] = { total: 0, approved: 0, denied: 0, partialApproval: 0 };
          insurerStats[n.insurerName].total++;
          if (n.outcome === "approved") insurerStats[n.insurerName].approved++;
          else if (n.outcome === "denied") insurerStats[n.insurerName].denied++;
          else if (n.outcome === "partial_approval") insurerStats[n.insurerName].partialApproval++;
        }

        // Overall approval rate: approved / (all decided outcomes excluding pending)
        const decidedCount = narratives.filter((n) => n.outcome && n.outcome !== "pending").length;
        const approvedCount = narratives.filter((n) => n.outcome === "approved").length;

        res.json({
          totalDenials: denied.length,
          totalSubmitted: narratives.filter((n) => n.outcome).length,
          overallApprovalRate: decidedCount > 0 ? Math.round((approvedCount / decidedCount) * 10000) / 100 : 0,
          denialCodes,
          byInsurer: Object.entries(insurerStats)
            .map(([insurer, stats]) => ({
              insurer,
              ...stats,
              approvalRate: stats.total > 0 ? Math.round((stats.approved / stats.total) * 10000) / 100 : 0,
            }))
            .sort((a, b) => a.approvalRate - b.approvalRate),
        });
      }),
  );

  // --- Deadline tracking: narratives approaching their submission deadline ---
  app.get("/api/insurance-narratives/deadlines", requireAuth, injectOrgContext, asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const narratives = await storage.listInsuranceNarratives(orgId);
      const now = new Date();

      const withDeadlines = narratives
        .filter((n) => (n as any).submissionDeadline && n.status !== "submitted")
        .map((n) => {
          const deadline = new Date((n as any).submissionDeadline);
          // Use floor so partial days don't inflate the count (11 hours remaining = 0 days, not 1)
          const daysRemaining = Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return {
            id: n.id,
            patientName: n.patientName,
            insurerName: n.insurerName,
            letterType: n.letterType,
            status: n.status,
            submissionDeadline: (n as any).submissionDeadline,
            daysRemaining,
            urgency:
              daysRemaining < 0
                ? ("overdue" as const)
                : daysRemaining <= 3
                  ? ("critical" as const)
                  : daysRemaining <= 7
                    ? ("warning" as const)
                    : ("on_track" as const),
            deadlineAcknowledged: (n as any).deadlineAcknowledged || false,
          };
        })
        .sort((a, b) => a.daysRemaining - b.daysRemaining);

      res.json({
        narratives: withDeadlines,
        overdue: withDeadlines.filter((n) => n.urgency === "overdue").length,
        critical: withDeadlines.filter((n) => n.urgency === "critical").length,
        warning: withDeadlines.filter((n) => n.urgency === "warning").length,
      });
  }));

  // --- Generate supporting document checklist for a letter type ---
  app.get(
    "/api/insurance-narratives/:id/checklist",
    requireAuth,
    injectOrgContext,
    validateUUIDParam(),
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        const narrative = await storage.getInsuranceNarrative(orgId, req.params.id);
        if (!narrative) return res.status(404).json({ message: "Narrative not found" });

        // Generate checklist based on letter type
        const checklist = generateChecklist(narrative.letterType, narrative);
        const existing = (narrative as any).supportingDocuments as
          | Array<{ name: string; attached: boolean }>
          | undefined;

        // Merge with any existing attachment tracking
        const merged = checklist.map((item) => {
          const match = existing?.find((e) => e.name === item.name);
          return { ...item, attached: match?.attached || false };
        });

        res.json({
          narrativeId: narrative.id,
          letterType: narrative.letterType,
          checklist: merged,
          completionRate:
            merged.length > 0
              ? Math.round((merged.filter((i) => i.attached || !i.required).length / merged.length) * 100)
              : 100,
        });
      }),
  );

  // Regenerate narrative text with updated params
  app.post(
    "/api/insurance-narratives/:id/regenerate",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateUUIDParam(),
    asyncHandler(async (req, res) => {
        const orgId = req.orgId;
        if (!orgId) return res.status(403).json({ message: "Organization context required" });

        const narrative = await storage.getInsuranceNarrative(orgId, req.params.id);
        if (!narrative) return res.status(404).json({ message: "Narrative not found" });

        // Prevent regeneration of narratives that have outcomes recorded (audit trail integrity)
        if (narrative.outcome && narrative.outcome !== "pending") {
          return res.status(400).json({
            message: "Cannot regenerate a narrative with a recorded outcome. Create a new narrative instead.",
            code: "OBS-NARRATIVE-OUTCOME-LOCKED",
          });
        }

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
      }),
  );
}
