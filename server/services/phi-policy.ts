/**
 * PHI redaction policy for AI inference boundaries.
 *
 * Centralizes the decision of when text should be PHI-redacted before
 * leaving the application for AWS Bedrock (Converse API for analysis,
 * InvokeModel for embeddings).
 *
 * Defense-in-depth on top of the AWS Bedrock BAA: minimizes PHI in Bedrock's
 * prompt cache, in CloudTrail, and in any future log surface (e.g., if a
 * future AI provider doesn't have an equivalent BAA).
 *
 * Adapted from the single-tenant CallAnalyzer pattern (`server/services/phi-redactor.ts`
 * + per-call-site application). Observatory's redactor (`server/utils/phi-redactor.ts`)
 * is reused as-is — it covers MORE patterns than CallAnalyzer's (NPI, FHIR UUIDs,
 * encounter IDs). What this module adds is the *policy* of WHERE to apply it.
 */
import { redactPhi } from "../utils/phi-redactor";

/**
 * Call categories where PHI should be PRESERVED in prompts because the AI's
 * job IS to summarize PHI (writing clinical notes from transcripts).
 *
 * For all other categories — scoring, coaching, sentiment, RAG queries —
 * PHI is redacted before the prompt reaches Bedrock.
 *
 * INVARIANT: must stay in sync with buildSystemPrompt's clinical-note routing
 * in server/services/ai-prompts.ts. Drift between the two is a HIPAA-relevant
 * bug (a clinical category whose system prompt asks for SOAP notes but whose
 * transcript arrives PHI-redacted produces useless notes).
 *
 * tests/phi-prompt-redaction.test.ts pins this invariant.
 */
export const CLINICAL_CATEGORIES: ReadonlySet<string> = new Set([
  "clinical_encounter",
  "telemedicine",
  "dental_encounter",
  "dental_consultation",
]);

/**
 * Should PHI be redacted from a prompt for the given call category?
 *
 * Default (no category): redact. Safest fallback for unknown call types.
 */
export function shouldRedactPhiForCategory(callCategory?: string | null): boolean {
  if (!callCategory) return true;
  return !CLINICAL_CATEGORIES.has(callCategory);
}

/**
 * Conditionally redact PHI from text based on call category.
 *
 * Use this at every Bedrock-bound text site (transcripts, RAG queries,
 * coaching summaries, score-feedback context).
 *
 * @param text - The text that will be sent into a Bedrock prompt.
 * @param callCategory - The call category determining redaction policy.
 * @param override - Explicit override of the category-based decision.
 *                   Pass `false` to force preservation; pass `true` to force redaction.
 */
export function redactTextForCategory(
  text: string,
  callCategory?: string | null,
  override?: boolean,
): string {
  const shouldRedact = override ?? shouldRedactPhiForCategory(callCategory);
  return shouldRedact ? redactPhi(text) : text;
}
