/**
 * Prompt-template + reference-document loader for the call-processing
 * pipeline. Extracted from `call-processing.ts` so the parent stays under
 * the 1KB-LOC bar and the RAG/template logic is independently testable.
 *
 * Two caches live here (call-processing was the only consumer):
 *   - `promptTemplateCache` — per-org × call-category, 5-min TTL
 *   - `refDocCache` — per-org × call-category list of reference docs
 *
 * `invalidateRefDocCache(orgId)` is exported and re-exported by
 * call-processing.ts so existing import sites in `routes/calls.ts` and
 * `routes/onboarding.ts` keep working without churn.
 */
import { storage } from "../../storage";
import { logger } from "../logger";
import { searchRelevantChunks, formatRetrievedContext, incrementRetrievalCounts, scanAndRedactOutput } from "../rag";
import { sanitizeStylePreferences } from "../clinical-validation";
import { LruCache } from "../../utils/lru-cache";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";
import type { PromptTemplateConfig } from "../ai-provider";

// ── Caches ───────────────────────────────────────────────────────────────────

const REF_DOC_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_REF_DOC_CACHE_ENTRIES = 1_000;

const PROMPT_TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PROMPT_TEMPLATE_CACHE_ENTRIES = 500;

const promptTemplateCache = new LruCache<PromptTemplateConfig | null>({
  maxSize: MAX_PROMPT_TEMPLATE_CACHE_ENTRIES,
  ttlMs: PROMPT_TEMPLATE_CACHE_TTL_MS,
});

type RefDocList = Array<{ name: string; category: string; extractedText?: string | null; id: string }>;

const refDocCache = new LruCache<RefDocList>({
  maxSize: MAX_REF_DOC_CACHE_ENTRIES,
  ttlMs: REF_DOC_CACHE_TTL_MS,
});

/** Invalidate the cached reference-document list for an org. Called by
 *  the routes/onboarding flow whenever a doc is uploaded/edited/deleted.
 *  Deletes both the bare org-key cache (legacy) and any category-suffixed
 *  keys (current). */
export function invalidateRefDocCache(orgId: string): void {
  refDocCache.delete(orgId);
  refDocCache.deleteByPrefix(`${orgId}:`);
}

async function getCachedRefDocs(orgId: string, callCategory: string): Promise<RefDocList> {
  const cacheKey = `${orgId}:${callCategory}`;
  const cached = refDocCache.get(cacheKey);
  if (cached) return cached;
  const docs = await storage.getReferenceDocumentsForCategory(orgId, callCategory);
  refDocCache.set(cacheKey, docs as RefDocList);
  return docs as RefDocList;
}

// Prune expired cache entries periodically (matches the prior interval).
setInterval(() => refDocCache.prune(), 5 * 60 * 1000).unref();

// ── Clinical-category list (controls clinical metadata injection) ───────────

const CLINICAL_CATEGORIES = ["clinical_encounter", "telemedicine", "dental_encounter", "dental_consultation"];

// ── Public types ─────────────────────────────────────────────────────────────

/** RAG citations stored in confidenceFactors. */
export interface RAGCitation {
  chunkId: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  score: number;
}

interface PromptTemplateResult {
  template: PromptTemplateConfig | undefined;
  citations: RAGCitation[] | null;
}

interface ReferenceContextResult {
  documents: Array<{ name: string; category: string; text: string }>;
  citations: RAGCitation[] | null;
}

// ── Loader ───────────────────────────────────────────────────────────────────

export async function loadPromptTemplate(
  orgId: string,
  callId: string,
  callCategory: string | undefined,
  userId: string | undefined,
  clinicalSpecialty: string | undefined,
  noteFormat: string | undefined,
  transcriptText: string | undefined,
): Promise<PromptTemplateResult> {
  let template: PromptTemplateConfig | undefined;

  // Custom prompt template by category (cached to avoid DB hit per call).
  if (callCategory) {
    const cacheKey = `${orgId}:${callCategory}`;
    const cached = promptTemplateCache.get(cacheKey);
    if (cached !== undefined) {
      template = cached ? { ...cached } : undefined;
    } else {
      try {
        const tmpl = await storage.getPromptTemplateByCategory(orgId, callCategory);
        if (tmpl) {
          template = {
            evaluationCriteria: tmpl.evaluationCriteria,
            requiredPhrases: tmpl.requiredPhrases,
            scoringWeights: tmpl.scoringWeights,
            additionalInstructions: tmpl.additionalInstructions,
          };
          logger.info({ callId, templateName: tmpl.name }, "Using custom prompt template");
        }
        promptTemplateCache.set(cacheKey, template || null);
      } catch (err) {
        logger.warn({ callId, err }, "Failed to load prompt template (using defaults)");
      }
    }
  }

  // Inject clinical metadata when applicable.
  if (callCategory && CLINICAL_CATEGORIES.includes(callCategory)) {
    if (!template) template = {};
    if (clinicalSpecialty) template.clinicalSpecialty = clinicalSpecialty;
    if (noteFormat) {
      if (!template.providerStylePreferences) template.providerStylePreferences = {};
      template.providerStylePreferences.noteFormat = noteFormat;
    }

    // Provider style preferences (sanitized; PHI-safe).
    try {
      const org = await storage.getOrganization(orgId);
      const providerPrefs = userId && (org?.settings as any)?.providerStylePreferences?.[userId];
      if (providerPrefs) {
        const sanitized = sanitizeStylePreferences(providerPrefs);
        template.providerStylePreferences = sanitized as any;
        if (sanitized.defaultSpecialty) {
          template.clinicalSpecialty = sanitized.defaultSpecialty as string;
        }
        logger.info({ callId, userId }, "Injecting sanitized provider style preferences");
      }
    } catch (err) {
      logger.warn({ callId, err }, "Failed to load provider preferences (continuing without)");
    }
  }

  // Reference documents (RAG when eligible; full-text fallback otherwise).
  let citations: RAGCitation[] | null = null;
  try {
    const refDocs = await getCachedRefDocs(orgId, callCategory || "");
    const docsWithText = refDocs.filter((d) => d.extractedText && d.extractedText.length > 0);

    if (docsWithText.length > 0) {
      if (!template) template = {};
      const refResult = await loadReferenceContext(orgId, callId, docsWithText, transcriptText);
      template.referenceDocuments = refResult.documents;
      citations = refResult.citations;
    }
  } catch (err) {
    logger.warn({ callId, err }, "Failed to load reference documents (continuing without)");
  }

  return { template, citations };
}

async function loadReferenceContext(
  orgId: string,
  callId: string,
  docsWithText: Array<{ name: string; category: string; extractedText?: string | null; id: string }>,
  transcriptText: string | undefined,
): Promise<ReferenceContextResult> {
  // RAG eligibility (plan-tier-gated).
  let useRag = false;
  try {
    const sub = await storage.getSubscription(orgId);
    const tier = (sub?.planTier as PlanTier) || "free";
    const plan = PLAN_DEFINITIONS[tier];
    useRag = plan?.limits?.ragEnabled === true;
  } catch (err) {
    logger.debug({ err, orgId }, "Failed to check RAG eligibility");
  }

  if (useRag && process.env.DATABASE_URL && transcriptText) {
    try {
      const { getDatabase } = await import("../../db/index");
      const db = getDatabase();
      if (db) {
        const docIds = docsWithText.map((d) => d.id);
        const queryText = transcriptText.slice(0, 2000);
        const chunks = await searchRelevantChunks(db as any, orgId, queryText, docIds, { topK: 6 });

        if (chunks.length > 0) {
          const ragContext = formatRetrievedContext(chunks);
          logger.info({ callId, chunkCount: chunks.length }, "RAG: injecting relevant chunks");

          const citations: RAGCitation[] = chunks.map((c) => ({
            chunkId: c.id,
            documentId: c.documentId,
            documentName: c.documentName,
            chunkIndex: c.chunkIndex,
            score: Math.round(c.score * 1000) / 1000,
          }));

          // Increment retrieval counts at document + chunk level (fire-and-forget).
          incrementRetrievalCounts(
            db as any,
            chunks.map((c) => c.documentId),
            chunks.map((c) => c.id),
          ).catch((err) => {
            logger.debug({ err }, "Failed to increment retrieval counts");
          });

          // Scan RAG context for PHI before injecting into prompt.
          const { text: scannedContext, phiDetected } = scanAndRedactOutput(ragContext, { orgId, queryId: callId });
          if (phiDetected) {
            logger.warn({ callId, orgId }, "PHI detected in RAG retrieval context — redacted");
          }
          return {
            documents: [{ name: "Retrieved Knowledge Base Context", category: "rag_retrieval", text: scannedContext }],
            citations,
          };
        }
      }
    } catch (err) {
      logger.warn({ callId, err }, "RAG retrieval failed, falling back to full-text");
    }
  }

  // Fallback: full-text injection.
  logger.info({ callId, docCount: docsWithText.length }, "Injecting reference documents (full-text)");
  return {
    documents: docsWithText.map((d) => ({ name: d.name, category: d.category, text: d.extractedText! })),
    citations: null,
  };
}
