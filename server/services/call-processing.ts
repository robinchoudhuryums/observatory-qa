/**
 * Call Processing Service — Core audio processing pipeline.
 *
 * Extracted from server/routes/calls.ts to separate business logic
 * from HTTP handling. This service handles:
 *   - Audio upload to AssemblyAI + cloud archival
 *   - Transcription polling
 *   - AI analysis (with prompt templates, RAG, clinical metadata)
 *   - Confidence scoring and flag enforcement
 *   - Clinical note generation + PHI encryption
 *   - Employee auto-assignment
 *   - Usage tracking and webhook notifications
 */
import path from "path";
import fs from "fs";
import { randomUUID, createHash } from "crypto";
import { storage } from "../storage";
import { assemblyAIService } from "./assemblyai";
import { aiProvider, withBedrockProtection } from "./ai-factory";
import { broadcastCallUpdate } from "./websocket";
import { invalidateDashboardCache } from "./dashboard-cache";
import { notifyFlaggedCall } from "./notifications";
import { onCallAnalysisComplete } from "./proactive-alerts";
import { trackUsage } from "./queue";
import { logger } from "./logger";
import { searchRelevantChunks, formatRetrievedContext, incrementRetrievalCounts, scanAndRedactOutput } from "./rag";
import { encryptField } from "./phi-encryption";
import { calibrateAnalysis } from "./scoring-calibration";
import { validateClinicalNote, sanitizeStylePreferences } from "./clinical-validation";
import { estimateBedrockCost, estimateAssemblyAICost } from "./cost-estimation";
import { safeFloat, withRetry } from "../utils/helpers";
import { PLAN_DEFINITIONS, type PlanTier, type UsageRecord, type OrgSettings } from "@shared/schema";
import type { PromptTemplateConfig } from "./ai-provider";
import type { AssemblyAIResponse, TranscriptionOptions } from "./assemblyai";

// ==================== REFERENCE DOC CACHE (LRU) ====================

import { LruCache } from "../utils/lru-cache";

const REF_DOC_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_REF_DOC_CACHE_ENTRIES = 1_000;

// Prompt template cache — avoids DB lookup on every call for the same org+category
const PROMPT_TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PROMPT_TEMPLATE_CACHE_ENTRIES = 500;
const promptTemplateCache = new LruCache<any>({
  maxSize: MAX_PROMPT_TEMPLATE_CACHE_ENTRIES,
  ttlMs: PROMPT_TEMPLATE_CACHE_TTL_MS,
});

type RefDocList = Array<{ name: string; category: string; extractedText?: string | null; id: string }>;

const refDocCache = new LruCache<RefDocList>({ maxSize: MAX_REF_DOC_CACHE_ENTRIES, ttlMs: REF_DOC_CACHE_TTL_MS });

/** Invalidate cached reference docs for an org (call on doc upload/delete) */
export function invalidateRefDocCache(orgId: string): void {
  // Delete all cache entries for this org: both the base key and category-specific keys
  // (e.g., "orgId", "orgId:appointment", "orgId:complaint", etc.)
  refDocCache.delete(orgId);
  refDocCache.deleteByPrefix(`${orgId}:`);
}

async function getCachedRefDocs(orgId: string, callCategory: string) {
  const cacheKey = `${orgId}:${callCategory}`;
  const cached = refDocCache.get(cacheKey);
  if (cached) return cached;

  const docs = await storage.getReferenceDocumentsForCategory(orgId, callCategory);
  refDocCache.set(cacheKey, docs as RefDocList);
  return docs;
}

// Prune expired cache entries periodically
setInterval(() => refDocCache.prune(), 5 * 60 * 1000).unref();

// ==================== FILE CLEANUP ====================

export async function cleanupFile(filePath: string): Promise<void> {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    logger.error({ err: error }, "Failed to cleanup file");
  }
}

// ==================== CLINICAL CATEGORIES ====================

const CLINICAL_CATEGORIES = ["clinical_encounter", "telemedicine", "dental_encounter", "dental_consultation"];

// ==================== CONFIDENCE SCORING ====================

export interface ConfidenceResult {
  score: number;
  factors: {
    transcriptConfidence: number;
    wordCount: number;
    callDurationSeconds: number;
    transcriptLength: number;
    aiAnalysisCompleted: boolean;
    overallScore: number;
  };
}

export function computeConfidence(
  transcriptConfidence: number,
  wordCount: number,
  callDuration: number,
  hasAiAnalysis: boolean,
): ConfidenceResult {
  // Use words-per-minute density to normalize for call type:
  // A short 30-second procedural call with 40 words is dense and valid,
  // while a 5-minute call with 10 words suggests audio/transcription issues.
  const wpm = callDuration > 0 ? (wordCount / callDuration) * 60 : 0;
  // Normal speech: 100-180 WPM. Below 30 WPM is suspicious.
  const densityConfidence = Math.min(wpm / 80, 1);
  const wordConfidence = Math.min(wordCount / 30, 1); // Lower threshold (30 vs 50) for procedural calls
  const durationConfidence = callDuration > 15 ? 1 : callDuration / 15; // Lower threshold (15s vs 30s)
  // When AI analysis fails, scores are all defaults (5.0) — confidence should
  // reflect that results are unreliable. 0.0 gives a hard 25% penalty.
  const aiConfidence = hasAiAnalysis ? 1 : 0;

  const score =
    transcriptConfidence * 0.35 +
    wordConfidence * 0.15 +
    densityConfidence * 0.1 +
    durationConfidence * 0.15 +
    aiConfidence * 0.25;

  return {
    score,
    factors: {
      transcriptConfidence: Math.round(transcriptConfidence * 100) / 100,
      wordCount,
      callDurationSeconds: callDuration,
      transcriptLength: 0, // Set by caller
      aiAnalysisCompleted: hasAiAnalysis,
      overallScore: Math.round(score * 100) / 100,
    },
  };
}

// ==================== FLAG ENFORCEMENT ====================

/** Configurable thresholds for server-side flag enforcement. Per-org overrides via org.settings.analysisThresholds. */
export interface AnalysisThresholds {
  lowConfidence: number; // Below this confidence → "low_confidence" flag (default: 0.7)
  lowScore: number; // At or below this score → "low_score" flag (default: 2.0)
  exceptionalScore: number; // At or above this score → "exceptional_call" flag (default: 9.0)
}

const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  lowConfidence: 0.7,
  lowScore: 2.0,
  exceptionalScore: 9.0,
};

export function enforceServerFlags(
  existingFlags: string[],
  confidenceScore: number,
  performanceScore: number,
  thresholds?: Partial<AnalysisThresholds>,
): string[] {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const flags = [...existingFlags];
  if (confidenceScore < t.lowConfidence && !flags.includes("low_confidence")) {
    flags.push("low_confidence");
  }
  if (performanceScore > 0 && performanceScore <= t.lowScore && !flags.includes("low_score")) {
    flags.push("low_score");
  }
  if (performanceScore >= t.exceptionalScore && !flags.includes("exceptional_call")) {
    flags.push("exceptional_call");
  }
  return flags;
}

// ==================== EMPLOYEE AUTO-ASSIGNMENT ====================

export interface AssignmentResult {
  employeeId?: string;
  reason: "exact_match" | "single_match" | "ambiguous" | "no_match" | "no_name";
}

export async function autoAssignEmployee(
  orgId: string,
  detectedName: string | null | undefined,
): Promise<AssignmentResult> {
  if (!detectedName) return { reason: "no_name" };

  const normalized = detectedName.toLowerCase().trim();
  if (!normalized) return { reason: "no_name" };

  const allEmployees = await storage.getAllEmployees(orgId);
  // Require explicit "Active" status — don't treat missing/null status as active,
  // which could assign calls to archived or deactivated employees.
  const activeEmployees = allEmployees.filter((emp) => emp.status === "Active");

  // Phase 1: Exact full-name match (highest confidence)
  const exactMatch = activeEmployees.find((emp) => emp.name.toLowerCase().trim() === normalized);
  if (exactMatch) {
    return { employeeId: exactMatch.id, reason: "exact_match" };
  }

  // Phase 2: Multi-part name matching (require at least 2 name parts to match)
  const detectedParts = normalized.split(/\s+/);
  const partialMatches = activeEmployees.filter((emp) => {
    const empName = emp.name.toLowerCase().trim();
    const empParts = empName.split(/\s+/);

    // If detected name has multiple parts, check if each part matches an employee name part
    if (detectedParts.length >= 2) {
      const matchedParts = detectedParts.filter((dp) =>
        empParts.some((ep) => ep === dp || ep.startsWith(dp) || dp.startsWith(ep)),
      );
      return matchedParts.length >= 2;
    }

    // Single-word detected name: only match against full last name (more unique than first name)
    // Skip first-name-only matching to reduce false positives
    if (empParts.length >= 2) {
      return empParts[empParts.length - 1] === normalized;
    }
    return empParts[0] === normalized;
  });

  if (partialMatches.length === 1) {
    return { employeeId: partialMatches[0].id, reason: "single_match" };
  }

  if (partialMatches.length > 1) {
    logger.info(
      { orgId, detectedName, matchCount: partialMatches.length, matchNames: partialMatches.map((m) => m.name) },
      "Ambiguous employee name match — skipping auto-assignment",
    );
    return { reason: "ambiguous" };
  }

  return { reason: "no_match" };
}

// ==================== CLINICAL NOTE MAPPING ====================

export function mapClinicalNote(rawNote: any): any {
  return {
    format: rawNote.format || "soap",
    specialty: rawNote.specialty,
    chiefComplaint: rawNote.chief_complaint,
    subjective: rawNote.subjective,
    objective: rawNote.objective,
    assessment: rawNote.assessment,
    // Normalize plan to array — AI may return a string instead of array
    plan: Array.isArray(rawNote.plan) ? rawNote.plan : rawNote.plan ? [rawNote.plan] : [],
    hpiNarrative: rawNote.hpi_narrative,
    reviewOfSystems: rawNote.review_of_systems,
    differentialDiagnoses: rawNote.differential_diagnoses,
    icd10Codes: rawNote.icd10_codes,
    cptCodes: rawNote.cpt_codes,
    prescriptions: rawNote.prescriptions,
    followUp: rawNote.follow_up,
    documentationCompleteness: rawNote.documentation_completeness,
    clinicalAccuracy: rawNote.clinical_accuracy,
    missingSections: rawNote.missing_sections,
    patientConsentObtained: false,
    providerAttested: false,
    data: rawNote.data,
    behavior: rawNote.behavior,
    intervention: rawNote.intervention,
    response: rawNote.response,
    cdtCodes: rawNote.cdt_codes,
    toothNumbers: rawNote.tooth_numbers,
    quadrants: rawNote.quadrants,
    periodontalFindings: rawNote.periodontal_findings,
    treatmentPhases: rawNote.treatment_phases,
  };
}

// ==================== PROMPT TEMPLATE LOADING ====================

interface PromptTemplateResult {
  template: PromptTemplateConfig | undefined;
  citations: RAGCitation[] | null;
}

async function loadPromptTemplate(
  orgId: string,
  callId: string,
  callCategory: string | undefined,
  userId: string | undefined,
  clinicalSpecialty: string | undefined,
  noteFormat: string | undefined,
  transcriptText: string | undefined,
): Promise<PromptTemplateResult> {
  let template: PromptTemplateConfig | undefined;

  // Load custom prompt template by category (cached to avoid DB hit per call)
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

  // Inject clinical metadata
  if (callCategory && CLINICAL_CATEGORIES.includes(callCategory)) {
    if (!template) template = {};
    if (clinicalSpecialty) template.clinicalSpecialty = clinicalSpecialty;
    if (noteFormat) {
      if (!template.providerStylePreferences) template.providerStylePreferences = {};
      template.providerStylePreferences.noteFormat = noteFormat;
    }

    // Load provider style preferences
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

  // Load reference documents (RAG or full-text)
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

/** RAG citations stored in confidenceFactors */
export interface RAGCitation {
  chunkId: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  score: number;
}

/** Result of loading reference context — includes both documents and RAG citations */
interface ReferenceContextResult {
  documents: Array<{ name: string; category: string; text: string }>;
  citations: RAGCitation[] | null;
}

async function loadReferenceContext(
  orgId: string,
  callId: string,
  docsWithText: Array<{ name: string; category: string; extractedText?: string | null; id: string }>,
  transcriptText: string | undefined,
): Promise<ReferenceContextResult> {
  // Check RAG eligibility
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
      const { getDatabase } = await import("../db/index");
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

          // Increment retrieval counts at document + chunk level (fire-and-forget)
          incrementRetrievalCounts(
            db as any,
            chunks.map((c) => c.documentId),
            chunks.map((c) => c.id),
          ).catch((err) => {
            logger.debug({ err }, "Failed to increment retrieval counts");
          });

          // Scan RAG context for PHI before injecting into prompt
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

  // Fallback to full-text injection
  logger.info({ callId, docCount: docsWithText.length }, "Injecting reference documents (full-text)");
  return {
    documents: docsWithText.map((d) => ({ name: d.name, category: d.category, text: d.extractedText! })),
    citations: null,
  };
}

// ==================== MAIN PROCESSING PIPELINE ====================

export interface ProcessAudioOptions {
  orgId: string;
  callId: string;
  filePath: string;
  audioBuffer: Buffer;
  originalName: string;
  mimeType: string;
  callCategory?: string;
  userId?: string;
  clinicalSpecialty?: string;
  noteFormat?: string;
  /** ISO 639-1 language code (e.g., "en", "es"). When non-English, AssemblyAI
   *  sentiment analysis is skipped to save ~12% on transcription costs. */
  language?: string;
}

export async function processAudioFile(opts: ProcessAudioOptions): Promise<void> {
  const {
    orgId,
    callId,
    filePath,
    audioBuffer,
    originalName,
    mimeType,
    callCategory,
    userId,
    clinicalSpecialty,
    noteFormat,
    language,
  } = opts;

  logger.info({ callId }, "Starting audio processing");
  broadcastCallUpdate(callId, "uploading", { step: 1, totalSteps: 6, label: "Uploading audio..." }, orgId);

  try {
    // Step 1: Upload + archive
    const uploadResult = await uploadAndArchive(orgId, callId, filePath, audioBuffer, originalName, mimeType);

    // Build transcription options from org settings
    const org = await storage.getOrganization(orgId);
    const settings = org?.settings as OrgSettings | undefined;
    const appBaseUrl = process.env.APP_BASE_URL;
    const webhookSecret = process.env.ASSEMBLYAI_WEBHOOK_SECRET || process.env.SESSION_SECRET;
    const transcriptionOptions: TranscriptionOptions = {
      wordBoost: settings?.customVocabulary?.length ? settings.customVocabulary : undefined,
      piiRedaction: settings?.piiRedaction,
      languageDetection: true,
      language: language || (settings as any)?.primaryLanguage || undefined,
      // Only use webhooks when APP_BASE_URL is set (not in dev without tunnel)
      ...(appBaseUrl
        ? {
            webhookUrl: `${appBaseUrl}/api/webhooks/assemblyai`,
            webhookAuthHeaderValue: webhookSecret,
          }
        : {}),
    };

    // Step 2-3: Transcribe
    const transcriptResult = await transcribe(
      orgId,
      callId,
      uploadResult,
      uploadResult.audioArchived,
      filePath,
      transcriptionOptions,
    );
    if (!transcriptResult) return; // Empty transcript handled, or webhook mode (async)

    // In webhook mode, processing continues in the webhook handler
    if (transcriptResult.webhookMode) {
      logger.info({ callId }, "Webhook mode: transcription submitted, waiting for callback");
      return;
    }

    const { transcriptResponse, audioArchived } = transcriptResult;

    await continueAfterTranscription(orgId, callId, transcriptResponse!, {
      callCategory,
      userId,
      clinicalSpecialty,
      noteFormat,
      audioArchived: audioArchived!,
      originalName,
      filePath,
    });
  } catch (error) {
    logger.error({ callId, err: error }, "Critical error during audio processing");
    await storage.updateCall(orgId, callId, { status: "failed" });
    broadcastCallUpdate(callId, "failed", { label: "Processing failed" }, orgId);
    await cleanupFile(filePath);
  }
}

/**
 * Continue pipeline after transcription is complete.
 * Called by both the polling path (in-process) and the webhook handler (async).
 */
export async function continueAfterTranscription(
  orgId: string,
  callId: string,
  transcriptResponse: AssemblyAIResponse,
  opts?: {
    callCategory?: string;
    userId?: string;
    clinicalSpecialty?: string;
    noteFormat?: string;
    audioArchived?: boolean;
    originalName?: string;
    filePath?: string; // for cleanup
  },
): Promise<void> {
  const callCategory = opts?.callCategory;
  const userId = opts?.userId;
  const clinicalSpecialty = opts?.clinicalSpecialty;
  const noteFormat = opts?.noteFormat;
  const audioArchived = opts?.audioArchived ?? true;
  const filePath = opts?.filePath;

  // If opts not provided, look up call record to get category
  let resolvedCallCategory = callCategory;
  let resolvedOriginalName = opts?.originalName;
  if (!resolvedCallCategory || !resolvedOriginalName) {
    try {
      const callRecord = await storage.getCall(orgId, callId);
      if (callRecord) {
        resolvedCallCategory = resolvedCallCategory || callRecord.callCategory || undefined;
        resolvedOriginalName = resolvedOriginalName || callRecord.fileName || callId;
      }
    } catch {
      // Non-critical — continue with whatever we have
    }
  }

  // Guard: empty/too-short transcripts should not proceed to AI analysis.
  // The polling path handles this in processAudioFile, but the webhook path
  // calls continueAfterTranscription directly and may skip it.
  const transcriptText = transcriptResponse.text || "";
  if (transcriptText.trim().length < 10) {
    logger.warn({ callId, textLen: transcriptText.length }, "Empty/too-short transcript in continueAfterTranscription");
    await storage.withTransaction(async () => {
      await storage.updateCall(orgId, callId, {
        status: "completed",
        tags: ["empty_transcript"],
      });
      // Store minimal transcript so the call is queryable
      try {
        await storage.createTranscript(orgId, {
          orgId,
          callId,
          text: transcriptText,
          confidence: 0.1,
          words: [],
        } as any);
      } catch {
        // Transcript may already exist from a prior attempt — non-fatal
      }
    });
    broadcastCallUpdate(callId, "completed", { label: "Empty transcript" }, orgId);
    return;
  }

  try {
    // --- Batch mode check: defer AI analysis if org has batch mode enabled ---
    const { shouldUseBatchMode, savePendingBatchItem, isBatchAvailable } = await import("./bedrock-batch");
    const orgForBatch = await storage.getOrganization(orgId);
    const orgBatchSettings = orgForBatch?.settings as OrgSettings | undefined;
    if (shouldUseBatchMode(orgBatchSettings as any, resolvedCallCategory)) {
      try {
        // Build the prompt that would normally go to Bedrock
        const { buildSystemPrompt, buildUserMessage } = await import("./ai-prompts");
        const batchPrompt = buildSystemPrompt(resolvedCallCategory) + "\n\n" + buildUserMessage(transcriptText, callId);

        await savePendingBatchItem({
          orgId,
          callId,
          prompt: batchPrompt,
          callCategory: resolvedCallCategory,
          uploadedBy: userId,
          timestamp: new Date().toISOString(),
        });

        // Store transcript/sentiment with defaults (analysis will be filled by batch)
        const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(
          transcriptResponse,
          null, // no AI analysis yet
          callId,
          orgId,
          (orgBatchSettings as any)?.defaultSpeakerRoles,
        );

        await storage.withTransaction(async () => {
          await storage.createTranscript(orgId, transcript);
          await storage.createSentimentAnalysis(orgId, sentiment);
          await storage.createCallAnalysis(orgId, analysis);
          await storage.updateCall(orgId, callId, {
            status: "completed",
            tags: ["awaiting_batch_analysis"],
          });
        });

        broadcastCallUpdate(
          callId,
          "completed",
          { step: 4, totalSteps: 6, label: "Queued for batch analysis (results within 24h)" },
          orgId,
        );
        logger.info({ callId, orgId }, "Call deferred to batch analysis (50% cost savings)");
        if (filePath) await cleanupFile(filePath);
        return;
      } catch (batchErr) {
        logger.warn({ callId, err: batchErr }, "Batch mode failed — falling back to real-time analysis");
        // Fall through to synchronous analysis
      }
    }

    // Step 4: AI analysis (real-time)
    const { aiAnalysis, citations: ragCitations } = await runAiAnalysis(
      orgId,
      callId,
      resolvedCallCategory,
      userId,
      clinicalSpecialty,
      noteFormat,
      transcriptText,
      transcriptResponse.confidence,
    );

    // Warn if clinical call didn't produce a clinical note
    if (resolvedCallCategory && CLINICAL_CATEGORIES.includes(resolvedCallCategory) && !aiAnalysis?.clinical_note) {
      const reason = !aiProvider.isAvailable
        ? "AI provider not configured"
        : aiAnalysis === null
          ? "AI analysis failed"
          : "AI response did not include clinical note";
      logger.warn({ callId, callCategory: resolvedCallCategory, reason }, "Clinical encounter without clinical note");
    }

    // Step 5: Process results
    broadcastCallUpdate(callId, "processing", { step: 5, totalSteps: 6, label: "Processing results..." }, orgId);
    // Load org settings for speaker role configuration
    const org = await storage.getOrganization(orgId);
    const orgSettings = org?.settings as OrgSettings | undefined;
    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(
      transcriptResponse,
      aiAnalysis,
      callId,
      orgId,
      orgSettings?.defaultSpeakerRoles,
    );

    // Confidence scoring
    const wordCount = transcriptResponse.words?.length || 0;
    const callDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
    const confidence = computeConfidence(
      transcriptResponse.confidence || 0,
      wordCount,
      callDuration,
      aiAnalysis !== null,
    );
    confidence.factors.transcriptLength = (transcriptResponse.text || "").length;
    analysis.confidenceScore = confidence.score.toFixed(3);
    analysis.confidenceFactors = {
      ...confidence.factors,
      ...(ragCitations ? { ragCitations } : {}),
    };

    // Sub-scores — only include fields the AI actually returned.
    // Missing fields are left undefined rather than defaulted to 0,
    // which would be indistinguishable from a genuine 0/10 score.
    if (aiAnalysis?.sub_scores) {
      const ss = aiAnalysis.sub_scores;
      analysis.subScores = {
        compliance: ss.compliance != null ? Number(ss.compliance) : undefined,
        customerExperience: ss.customer_experience != null ? Number(ss.customer_experience) : undefined,
        communication: ss.communication != null ? Number(ss.communication) : undefined,
        resolution: ss.resolution != null ? Number(ss.resolution) : undefined,
      };
    }

    // Score calibration
    await applyScoreCalibration(orgId, callId, analysis, aiAnalysis);

    if (aiAnalysis?.detected_agent_name) {
      analysis.detectedAgentName = aiAnalysis.detected_agent_name;
    }

    // Score rationale
    if (aiAnalysis?.score_rationale) {
      analysis.scoreRationale = aiAnalysis.score_rationale;
    }

    // Prompt versioning (set by runAiAnalysis via prompt_version_id)
    if (aiAnalysis?.prompt_version_id) {
      analysis.promptVersionId = aiAnalysis.prompt_version_id;
    }

    // Language detection — store detected language and flag non-English calls
    if (transcriptResponse.language_code) {
      analysis.detectedLanguage = transcriptResponse.language_code;
      if (transcriptResponse.language_code !== "en") {
        const flags = Array.isArray(analysis.flags) ? [...(analysis.flags as string[])] : [];
        if (!flags.includes("non_english")) flags.push("non_english");
        analysis.flags = flags;
      }
    }

    // Clinical note processing
    if (aiAnalysis?.clinical_note) {
      const cn = mapClinicalNote(aiAnalysis.clinical_note);
      // Extract structured data (vitals, meds, allergies) from note sections
      // BEFORE encryption — encrypted text can't be parsed for patterns.
      try {
        const { extractStructuredDataFromSections } = await import("./clinical-extraction");
        const structuredData = extractStructuredDataFromSections({
          objective: typeof cn.objective === "string" ? cn.objective : undefined,
          subjective: typeof cn.subjective === "string" ? cn.subjective : undefined,
          plan: Array.isArray(cn.plan) ? cn.plan.join("\n") : undefined,
        });
        if (Object.keys(structuredData).length > 0) {
          cn.structuredData = structuredData;
        }
      } catch (extractErr) {
        logger.debug({ err: extractErr, callId }, "Structured data extraction failed — non-fatal");
      }
      validateAndEncryptClinicalNote(callId, cn);
      analysis.clinicalNote = cn;
    } else if (clinicalSpecialty || noteFormat) {
      // AI was expected to produce a clinical note but didn't — flag for retry
      logger.warn(
        { callId, clinicalSpecialty, noteFormat },
        "AI analysis completed but no clinical_note field returned — flagging for retry",
      );
      const retryFlags = Array.isArray(analysis.flags) ? [...(analysis.flags as string[])] : [];
      if (!retryFlags.includes("requires_clinical_retry")) {
        retryFlags.push("requires_clinical_retry");
      }
      analysis.flags = retryFlags;
    }

    // Server-side flag enforcement
    const rawFlags: string[] = Array.isArray(analysis.flags) ? [...(analysis.flags as string[])] : [];
    analysis.flags = enforceServerFlags(rawFlags, confidence.score, safeFloat(analysis.performanceScore));

    // Step 6: Store results atomically — transcript, sentiment, analysis, and
    // status update all commit together or all roll back. This prevents orphaned
    // transcript/sentiment records from partial failures leaving inconsistent state.
    broadcastCallUpdate(callId, "saving", { step: 6, totalSteps: 6, label: "Saving results..." }, orgId);

    // Auto-assign employee (before transaction so we don't hold the tx open during lookup)
    const currentCall = await storage.getCall(orgId, callId);
    let assignedEmployeeId: string | undefined;
    if (!currentCall?.employeeId) {
      const assignment = await autoAssignEmployee(orgId, aiAnalysis?.detected_agent_name);
      if (assignment.employeeId) {
        assignedEmployeeId = assignment.employeeId;
        logger.info(
          { callId, employeeId: assignment.employeeId, reason: assignment.reason },
          "Auto-assigned to employee",
        );
      }
    }

    const callTags: string[] = [];
    if (!audioArchived) callTags.push("audio_missing");

    await storage.withTransaction(async () => {
      await storage.createTranscript(orgId, transcript);
      await storage.createSentimentAnalysis(orgId, sentiment);
      await storage.createCallAnalysis(orgId, analysis);
      await storage.updateCall(orgId, callId, {
        status: "completed",
        duration: callDuration,
        ...(assignedEmployeeId ? { employeeId: assignedEmployeeId } : {}),
        ...(callTags.length > 0 ? { tags: callTags } : {}),
      });
    });

    if (filePath) await cleanupFile(filePath);
    broadcastCallUpdate(callId, "completed", { step: 6, totalSteps: 6, label: "Complete" }, orgId);

    // Invalidate dashboard cache so next request picks up new data
    invalidateDashboardCache(orgId).catch((err) => {
      logger.debug({ err, orgId }, "Failed to invalidate dashboard cache (non-blocking)");
    });

    // Post-processing: notifications, coaching recommendations, usage tracking.
    // CRITICAL: the main pipeline transaction has already committed successfully
    // at this point. Any failure here must NOT mark the call as failed or trigger
    // a retry — doing so would corrupt a completed call and cause duplicate
    // transcripts/analyses on re-processing. See F-44 in broad-scan audit.
    // Errors are logged but swallowed so the call stays in "completed" state.
    try {
      await postProcessing(
        orgId,
        callId,
        analysis,
        aiAnalysis,
        assignedEmployeeId,
        resolvedOriginalName || callId,
        transcriptResponse,
      );
    } catch (postErr) {
      logger.error(
        { callId, orgId, err: postErr },
        "Post-processing failed after successful call commit — call remains in completed state",
      );
    }
  } catch (error) {
    logger.error({ callId, err: error }, "Critical error during post-transcription processing");
    await storage.updateCall(orgId, callId, { status: "failed" });
    broadcastCallUpdate(callId, "failed", { label: "Processing failed" }, orgId);
    if (filePath) await cleanupFile(filePath);

    // Attempt to enqueue for retry via the job queue (non-blocking).
    // If Redis/queue is unavailable, the call stays in "failed" status
    // and the user can re-upload manually.
    try {
      const { enqueueCallRetry } = await import("./queue");
      await enqueueCallRetry(orgId, callId, opts?.originalName || callId, opts?.callCategory);
    } catch {
      // Queue unavailable — call remains failed, user must re-upload
    }
  }
}

// ==================== PIPELINE SUB-STEPS ====================

async function uploadAndArchive(
  orgId: string,
  callId: string,
  filePath: string,
  audioBuffer: Buffer,
  originalName: string,
  mimeType: string,
) {
  logger.info({ callId, step: "1/7" }, "Uploading audio file to AssemblyAI");
  const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));

  let audioArchived = true;
  try {
    await storage.uploadAudio(orgId, callId, originalName, audioBuffer, mimeType);
  } catch (err) {
    audioArchived = false;
    logger.warn({ callId, err }, "Failed to archive audio (continuing without playback)");
  }

  return { audioUrl, audioArchived };
}

async function transcribe(
  orgId: string,
  callId: string,
  uploadResult: { audioUrl: string; audioArchived: boolean },
  audioArchived: boolean,
  filePath: string,
  transcriptionOptions?: TranscriptionOptions,
): Promise<{ transcriptResponse?: AssemblyAIResponse; audioArchived?: boolean; webhookMode?: boolean } | null> {
  broadcastCallUpdate(callId, "transcribing", { step: 2, totalSteps: 6, label: "Transcribing audio..." }, orgId);
  const transcriptId = await assemblyAIService.transcribeAudio(uploadResult.audioUrl, transcriptionOptions);
  await storage.updateCall(orgId, callId, { assemblyAiId: transcriptId });

  // Webhook mode: return early — AssemblyAI will POST results asynchronously
  if (transcriptionOptions?.webhookUrl) {
    logger.info({ callId, transcriptId }, "Webhook mode: transcription submitted, waiting for webhook callback");
    broadcastCallUpdate(
      callId,
      "transcribing",
      { step: 3, totalSteps: 6, label: "Waiting for transcript (webhook)..." },
      orgId,
    );
    return { webhookMode: true };
  }

  broadcastCallUpdate(callId, "transcribing", { step: 3, totalSteps: 6, label: "Waiting for transcript..." }, orgId);
  const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId, 60, (attempt, max, status) => {
    const pct = Math.round((attempt / max) * 100);
    broadcastCallUpdate(
      callId,
      "transcribing",
      { step: 3, totalSteps: 6, label: `Transcribing... (${status})`, progress: pct },
      orgId,
    );
  });

  if (!transcriptResponse || transcriptResponse.status !== "completed") {
    throw new Error(`Transcription failed. Final status: ${transcriptResponse?.status}`);
  }

  // Empty transcript guard
  if (!transcriptResponse.text || transcriptResponse.text.trim().length < 10) {
    logger.warn({ callId, textLen: transcriptResponse.text?.length || 0 }, "Empty or too-short transcript");
    await handleEmptyTranscript(orgId, callId, transcriptResponse, audioArchived, filePath);
    return null;
  }

  return { transcriptResponse, audioArchived };
}

async function handleEmptyTranscript(
  orgId: string,
  callId: string,
  transcriptResponse: any,
  audioArchived: boolean,
  filePath: string,
) {
  broadcastCallUpdate(
    callId,
    "completed",
    {
      step: 6,
      totalSteps: 6,
      label: "Complete (no speech detected)",
      warning: "Transcript was empty — audio may be silent, corrupted, or too short",
    },
    orgId,
  );

  const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(
    transcriptResponse,
    null,
    callId,
    orgId,
  );
  analysis.confidenceScore = "0.10";
  analysis.confidenceFactors = {
    transcriptConfidence: 0,
    wordCount: 0,
    callDurationSeconds: 0,
    transcriptLength: 0,
    aiAnalysisCompleted: false,
    overallScore: 0.1,
  };
  (analysis.flags as string[]) = ["empty_transcript", "low_confidence"];

  const tags: string[] = ["empty_transcript"];
  if (!audioArchived) tags.push("audio_missing");

  await storage.withTransaction(async () => {
    await storage.createTranscript(orgId, transcript);
    await storage.createSentimentAnalysis(orgId, sentiment);
    await storage.createCallAnalysis(orgId, analysis);
    await storage.updateCall(orgId, callId, { status: "completed", duration: 0, tags });
  });

  await cleanupFile(filePath);
}

async function runAiAnalysis(
  orgId: string,
  callId: string,
  callCategory: string | undefined,
  userId: string | undefined,
  clinicalSpecialty: string | undefined,
  noteFormat: string | undefined,
  transcriptText: string | undefined,
  transcriptConfidence?: number,
) {
  broadcastCallUpdate(callId, "analyzing", { step: 4, totalSteps: 6, label: "Running AI analysis..." }, orgId);

  const { template: promptTemplate, citations } = await loadPromptTemplate(
    orgId,
    callId,
    callCategory,
    userId,
    clinicalSpecialty,
    noteFormat,
    transcriptText,
  );

  if (!aiProvider.isAvailable || !transcriptText) {
    logger.info({ callId }, "AI provider not available or no transcript text");
    return { aiAnalysis: null, citations };
  }

  try {
    const result = await withBedrockProtection(orgId, () =>
      withRetry(
        () =>
          aiProvider.analyzeCallTranscript(transcriptText, callId, callCategory, promptTemplate, {
            transcriptConfidence,
          }),
        {
          retries: 2,
          baseDelay: 2000,
          label: `AI analysis for ${callId}`,
        },
      ),
    );
    // Attach prompt version ID for audit trail (12-char SHA-256 prefix of rendered system prompt)
    try {
      const { buildSystemPrompt } = await import("./ai-prompts");
      const sysPrompt = buildSystemPrompt(callCategory, promptTemplate);
      result.prompt_version_id = createHash("sha256").update(sysPrompt).digest("hex").slice(0, 12);
    } catch {
      // Non-critical
    }
    logger.info({ callId }, "AI analysis complete");
    return { aiAnalysis: result, citations };
  } catch (err) {
    logger.warn({ callId, err }, "AI analysis failed after retries (continuing with defaults)");
    return { aiAnalysis: null, citations };
  }
}

async function applyScoreCalibration(orgId: string, callId: string, analysis: any, aiAnalysis: any) {
  if (!aiAnalysis?.sub_scores || !analysis.performanceScore) return;

  try {
    const org = await storage.getOrganization(orgId);
    // Only calibrate sub-scores that the AI actually returned (not undefined)
    const sub = analysis.subScores || {};
    const calibrated = calibrateAnalysis(
      {
        performance_score: safeFloat(analysis.performanceScore),
        sub_scores: {
          compliance: sub.compliance ?? 0,
          customer_experience: sub.customerExperience ?? 0,
          communication: sub.communication ?? 0,
          resolution: sub.resolution ?? 0,
        },
      },
      org?.settings,
    );
    if (calibrated.calibration_applied) {
      analysis.performanceScore = calibrated.performance_score as any;
      // Preserve undefined for fields the AI didn't return
      analysis.subScores = {
        compliance: sub.compliance != null ? calibrated.sub_scores.compliance : undefined,
        customerExperience: sub.customerExperience != null ? calibrated.sub_scores.customer_experience : undefined,
        communication: sub.communication != null ? calibrated.sub_scores.communication : undefined,
        resolution: sub.resolution != null ? calibrated.sub_scores.resolution : undefined,
      };
    }
  } catch (err) {
    logger.warn({ callId, err }, "Score calibration failed — using raw scores");
  }
}

function validateAndEncryptClinicalNote(callId: string, cn: any) {
  const validation = validateClinicalNote(cn);
  if (!validation.valid) {
    logger.warn(
      { callId, format: validation.format, missingSections: validation.missingSections },
      "Clinical note has missing sections",
    );
    const aiMissing = cn.missingSections || [];
    cn.missingSections = Array.from(
      new Set([...aiMissing, ...validation.missingSections, ...validation.emptySections]),
    );
  }

  const aiCompleteness = cn.documentationCompleteness || 0;
  const serverCompleteness = validation.computedCompleteness;
  cn.documentationCompleteness =
    Math.min(aiCompleteness || serverCompleteness, serverCompleteness || aiCompleteness) || serverCompleteness;

  // Flag notes with low completeness (below 60% / score 6.0)
  if (cn.documentationCompleteness < 6.0) {
    cn.lowCompleteness = true;
    logger.warn(
      { callId, completeness: cn.documentationCompleteness },
      "Clinical note has low completeness — review required before attestation",
    );
  }

  if (validation.warnings.length > 0) {
    cn.validationWarnings = validation.warnings;
    logger.info({ callId, warnings: validation.warnings }, "Clinical note validation warnings");
  }

  // Encrypt PHI fields (must match PHI_FIELDS in phi-encryption.ts)
  const phiFields = [
    "subjective",
    "objective",
    "assessment",
    "hpiNarrative",
    "chiefComplaint",
    "reviewOfSystems",
    "differentialDiagnoses",
    "periodontalFindings",
  ];
  for (const field of phiFields) {
    if (typeof cn[field] === "string") cn[field] = encryptField(cn[field]);
  }
}

async function postProcessing(
  orgId: string,
  callId: string,
  analysis: any,
  aiAnalysis: any,
  assignedEmployeeId: string | undefined,
  originalName: string,
  transcriptResponse: any,
) {
  // Webhook notification for flagged calls
  const flags = (analysis.flags as string[]) || [];
  if (flags.length > 0) {
    withRetry(
      () =>
        notifyFlaggedCall({
          event: "call_flagged",
          callId,
          orgId,
          flags,
          performanceScore: analysis.performanceScore ? safeFloat(analysis.performanceScore) : undefined,
          agentName: analysis.detectedAgentName || undefined,
          fileName: originalName,
          summary: typeof analysis.summary === "string" ? analysis.summary : undefined,
          timestamp: new Date().toISOString(),
        }),
      { retries: 2, baseDelay: 1000, label: "flagged-call-notification" },
    ).catch((err) => logger.warn({ callId, err }, "Failed to send flagged call notification after retries"));
  }

  // Coaching recommendations
  withRetry(() => onCallAnalysisComplete(orgId, callId, assignedEmployeeId), {
    retries: 2,
    baseDelay: 1000,
    label: "coaching-recommendations",
  }).catch((err) => logger.warn({ callId, err }, "Failed to generate coaching recommendations after retries"));

  // Gamification: record activity and check for badge awards
  if (assignedEmployeeId) {
    try {
      const { recordActivity } = await import("../routes/gamification");
      await recordActivity(orgId, assignedEmployeeId, "call_processed");
      // Award bonus points for high/perfect scores
      const perfScore = analysis.performanceScore ? safeFloat(analysis.performanceScore) : 0;
      if (perfScore === 10.0) {
        await recordActivity(orgId, assignedEmployeeId, "perfect_score");
      } else if (perfScore >= 9.0) {
        await recordActivity(orgId, assignedEmployeeId, "high_score");
      }
    } catch (err) {
      logger.warn({ callId, employeeId: assignedEmployeeId, err }, "Failed to update gamification (non-blocking)");
    }
  }

  // Usage tracking — with rollback if downstream cost recording fails
  trackUsage({ orgId, eventType: "transcription", quantity: 1, metadata: { callId } });
  if (aiAnalysis) {
    trackUsage({ orgId, eventType: "ai_analysis", quantity: 1, metadata: { callId, model: aiProvider.name } });
  }

  // If the call was marked as failed (e.g., storage error after analysis),
  // roll back usage so the org isn't charged for a failed call.
  try {
    const callStatus = await storage.getCall(orgId, callId);
    if (callStatus?.status === "failed") {
      logger.warn({ callId, orgId }, "Call marked as failed — rolling back usage tracking");
      trackUsage({
        orgId,
        eventType: "transcription",
        quantity: -1,
        metadata: { callId, reason: "rollback_failed_call" },
      });
      if (aiAnalysis) {
        trackUsage({
          orgId,
          eventType: "ai_analysis",
          quantity: -1,
          metadata: { callId, reason: "rollback_failed_call" },
        });
      }
    }
  } catch (err) {
    logger.warn({ callId, err }, "Failed to check call status for usage rollback (non-blocking)");
  }

  // Cost estimation
  try {
    const audioDuration = Math.floor(
      (transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000,
    );
    const assemblyaiCost = estimateAssemblyAICost(audioDuration);
    // Use actual Bedrock token counts when available (from _tokenUsage attached by provider),
    // fall back to text-length estimation when actual counts aren't available.
    const actualTokens = (aiAnalysis as any)?._tokenUsage;
    const inputTokens = actualTokens?.inputTokens || Math.ceil((transcriptResponse.text || "").length / 4) + 500;
    const outputTokens = actualTokens?.outputTokens || 800;
    const tokenSource = actualTokens ? "actual" : "estimated";
    const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
    const bedrockCost = aiAnalysis ? estimateBedrockCost(bedrockModel, inputTokens, outputTokens) : 0;

    const spendRecord: UsageRecord = {
      id: randomUUID(),
      orgId,
      callId,
      type: "call",
      timestamp: new Date().toISOString(),
      user: "system",
      services: {
        assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
        ...(aiAnalysis
          ? {
              bedrock: {
                model: bedrockModel,
                estimatedInputTokens: inputTokens,
                estimatedOutputTokens: outputTokens,
                estimatedCost: Math.round(bedrockCost * 10000) / 10000,
              },
            }
          : {}),
      },
      totalEstimatedCost: Math.round((assemblyaiCost + bedrockCost) * 10000) / 10000,
    };
    await storage.createUsageRecord(orgId, spendRecord);
  } catch (err) {
    logger.warn({ callId, err }, "Failed to record spend (non-blocking)");
  }
}
