/**
 * RAG (Retrieval-Augmented Generation) service.
 *
 * Orchestrates document chunking, embedding, storage, and retrieval
 * using pgvector for vector similarity search with BM25 keyword boosting.
 *
 * Flow:
 * 1. On document upload: chunk → embed → store in document_chunks table
 * 2. On call analysis: embed query → pgvector search → inject relevant chunks
 */
import { randomUUID } from "crypto";
import { sql, eq, and } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { chunkDocument } from "./chunker";
import { generateEmbedding, generateEmbeddingsBatch, isEmbeddingAvailable } from "./embeddings";
import { logger } from "./logger";
import { detectPromptInjection } from "../utils/ai-guardrails";
import { redactPhi } from "../utils/phi-redactor";
import { logRagTrace, createRagTimer } from "./rag-trace";
import { recordFaqQuery } from "./faq-analytics";
import * as tables from "../db/schema";

// Tunable RAG configuration via environment variables (with sensible defaults)
/** Clamp a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const RAG_CONFIG = {
  /** Number of top chunks to return from search (clamped to [1, 100]) */
  topK: clamp(parseInt(process.env.RAG_SEARCH_TOP_K || "6", 10) || 6, 1, 100),
  /** Semantic (vector) score weight in hybrid search (0-1) */
  semanticWeight: clamp(parseFloat(process.env.RAG_SEMANTIC_WEIGHT || "0.7") || 0.7, 0, 1),
  /** BM25 keyword score weight in hybrid search (0-1) */
  keywordWeight: clamp(parseFloat(process.env.RAG_KEYWORD_WEIGHT || "0.3") || 0.3, 0, 1),
  /** Minimum combined score to include a chunk in results */
  minRelevanceScore: clamp(parseFloat(process.env.RAG_MIN_RELEVANCE_SCORE || "0.3") || 0.3, 0, 1),
  /** Candidate multiplier: fetch topK * this many candidates, then rerank */
  candidateMultiplier: clamp(parseInt(process.env.RAG_CANDIDATE_MULTIPLIER || "3", 10) || 3, 1, 10),
};

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentName: string;
  documentCategory: string;
  chunkIndex: number;
  text: string;
  sectionHeader: string | null;
  score: number;
}

export interface RAGSearchOptions {
  topK?: number;
  semanticWeight?: number;
  keywordWeight?: number;
  /** Override automatic query type classification */
  queryType?: QueryType;
}

// --- Adaptive query-type classification (adapted from ums-knowledge-reference) ---
// Different query types benefit from different semantic/keyword weight balances.
// Exact-match lookups (codes, template names) need more keyword weight;
// conceptual questions benefit from more semantic weight.

export type QueryType = "template_lookup" | "compliance_question" | "coaching_question" | "general";

/**
 * Classify a RAG query to determine optimal search weights.
 * Adapted from UMS's code_lookup/coverage_question/general classification,
 * re-targeted for Observatory QA's call analysis verticals.
 */
export function classifyQueryType(query: string): QueryType {
  const q = query.toLowerCase();

  // Template/criteria lookups — need exact keyword matching
  const templatePatterns = [
    /\b(?:template|scoring\s+criteria|evaluation\s+criteria|required\s+phrases?)\b/,
    /\b(?:prompt\s+template|call\s+categor(?:y|ies)|scoring\s+weight)\b/,
    /\b(?:what\s+(?:is|are)\s+the\s+(?:criteria|requirements|template))\b/,
  ];
  if (templatePatterns.some((p) => p.test(q))) return "template_lookup";

  // Compliance questions — balanced (need terms + context)
  const compliancePatterns = [
    /\b(?:compliance|hipaa|regulation|policy|guideline|protocol|procedure|standard)\b/,
    /\b(?:required|mandatory|must|shall|prohibited)\b/,
    /\b(?:audit|documentation\s+requirement|retention|consent)\b/,
  ];
  if (compliancePatterns.some((p) => p.test(q))) return "compliance_question";

  // Coaching questions — high semantic weight (conceptual)
  const coachingPatterns = [
    /\b(?:coach(?:ing)?|improv(?:e|ement)|feedback|training|development)\b/,
    /\b(?:best\s+practices?|recommendation|how\s+(?:to|should|can|do))\b/,
    /\b(?:performance|quality|customer\s+(?:service|experience))\b/,
  ];
  if (coachingPatterns.some((p) => p.test(q))) return "coaching_question";

  return "general";
}

/**
 * Get adaptive semantic/keyword weights based on query type.
 * Adapted from UMS's getAdaptiveWeights().
 */
export function getAdaptiveWeights(queryType: QueryType): { semantic: number; keyword: number } {
  switch (queryType) {
    case "template_lookup":
      return { semantic: 0.4, keyword: 0.6 }; // Exact terms matter most
    case "compliance_question":
      return { semantic: 0.55, keyword: 0.45 }; // Balanced — need both terms and context
    case "coaching_question":
      return { semantic: 0.75, keyword: 0.25 }; // Conceptual understanding
    case "general":
    default:
      return { semantic: 0.7, keyword: 0.3 }; // Default: favor semantic
  }
}

// --- Structured reference short-circuit (adapted from ums-knowledge-reference) ---
// Certain queries can be answered directly from structured data (prompt templates,
// document metadata, evaluation criteria) without the full RAG pipeline
// (embed → search → rerank). This saves 2-4 seconds and reduces Bedrock costs.

export type QueryRoute = "structured" | "hybrid" | "rag";

/**
 * Classify whether a query can be short-circuited via structured data lookup.
 * Adapted from UMS's query route classification.
 *
 * - "structured": Pure metadata lookup (skip RAG entirely)
 * - "hybrid": Has structured elements but also needs RAG context
 * - "rag": Full RAG pipeline needed
 */
export function classifyQueryRoute(query: string): QueryRoute {
  const q = query.toLowerCase();

  // Structured patterns — can be answered from DB metadata alone
  const structuredPatterns = [
    /^(?:what|list|show)\s+(?:are|is)\s+(?:the\s+)?(?:evaluation|scoring)\s+(?:criteria|weights?|template)/,
    /^(?:what|list|show)\s+(?:are|is)\s+(?:the\s+)?(?:required\s+phrases?|call\s+categor(?:y|ies))/,
    /^(?:what|list|show)\s+(?:are|is)\s+(?:the\s+)?(?:prompt\s+templates?)\b/,
    /^(?:how\s+many|count)\s+(?:documents?|templates?|categories)/,
  ];

  // Hybrid patterns — structured data + RAG context needed
  const hybridPatterns = [
    /\b(?:scoring\s+criteria|evaluation\s+criteria)\b.*\b(?:about|for|regarding)\b/,
    /\b(?:template|category)\b.*\b(?:and|with|including)\b.*\b(?:document|handbook|policy)\b/,
  ];

  // Check structured first (most restrictive)
  if (structuredPatterns.some((p) => p.test(q))) return "structured";
  if (hybridPatterns.some((p) => p.test(q))) return "hybrid";
  return "rag";
}

/**
 * Answer a query directly from structured data without the RAG pipeline.
 * Returns formatted context from prompt templates and document metadata.
 *
 * This is the "short-circuit" path: no embedding, no vector search, no Bedrock call.
 */
export async function getStructuredAnswer(
  db: NodePgDatabase,
  orgId: string,
  queryText: string,
): Promise<{
  answer: string;
  source: "structured";
  confidence: "high";
} | null> {
  const q = queryText.toLowerCase();

  try {
    // Template/criteria queries → return from prompt_templates table
    if (/(?:criteria|template|scoring|required\s+phrase|call\s+categor)/.test(q)) {
      const templates = await db
        .select({
          callCategory: tables.promptTemplates.callCategory,
          evaluationCriteria: tables.promptTemplates.evaluationCriteria,
          requiredPhrases: tables.promptTemplates.requiredPhrases,
          scoringWeights: tables.promptTemplates.scoringWeights,
        })
        .from(tables.promptTemplates)
        .where(eq(tables.promptTemplates.orgId, orgId))
        .limit(20);

      if (templates.length === 0) return null;

      const lines = templates.map((t) => {
        const parts = [`**${t.callCategory || "General"}**`];
        if (t.evaluationCriteria) parts.push(`Criteria: ${(t.evaluationCriteria as string).slice(0, 300)}`);
        if (t.scoringWeights) {
          const w = t.scoringWeights as Record<string, number>;
          parts.push(`Weights: ${Object.entries(w).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
        if (t.requiredPhrases) {
          const phrases = t.requiredPhrases as Array<{ phrase: string }>;
          if (phrases.length > 0) {
            parts.push(`Required phrases: ${phrases.map((p) => p.phrase).join("; ")}`);
          }
        }
        return parts.join("\n");
      });

      return {
        answer: `Here are the evaluation templates configured for your organization:\n\n${lines.join("\n\n---\n\n")}`,
        source: "structured",
        confidence: "high",
      };
    }

    // Document count/list queries → return from reference_documents table
    if (/(?:document|how\s+many|count)/.test(q)) {
      const docs = await db
        .select({
          name: tables.referenceDocuments.name,
          category: tables.referenceDocuments.category,
          indexingStatus: tables.referenceDocuments.indexingStatus,
          retrievalCount: tables.referenceDocuments.retrievalCount,
        })
        .from(tables.referenceDocuments)
        .where(and(eq(tables.referenceDocuments.orgId, orgId), eq(tables.referenceDocuments.isActive, true)))
        .limit(50);

      if (docs.length === 0) {
        return {
          answer: "No documents are currently in your knowledge base. Upload documents via the admin panel to enable RAG-powered analysis.",
          source: "structured",
          confidence: "high",
        };
      }

      const summary = docs.map((d) => `- **${d.name}** (${d.category || "uncategorized"}) — ${d.indexingStatus}, retrieved ${d.retrievalCount || 0} times`).join("\n");

      return {
        answer: `Your knowledge base contains ${docs.length} active document(s):\n\n${summary}`,
        source: "structured",
        confidence: "high",
      };
    }
  } catch (err) {
    logger.debug({ err }, "Structured answer lookup failed — falling through to RAG");
  }

  return null;
}

/**
 * Update the indexing status of a reference document.
 */
export async function updateIndexingStatus(
  db: NodePgDatabase,
  orgId: string,
  documentId: string,
  status: "pending" | "indexing" | "indexed" | "failed",
  error?: string,
): Promise<void> {
  const setValues: Record<string, unknown> = { indexingStatus: status };
  if (error !== undefined) setValues.indexingError = error;
  else if (status !== "failed") setValues.indexingError = null;

  await db
    .update(tables.referenceDocuments)
    .set(setValues)
    .where(and(eq(tables.referenceDocuments.orgId, orgId), eq(tables.referenceDocuments.id, documentId)));
}

/**
 * Process a reference document: chunk its text and store embeddings.
 * Called after a document is uploaded and text is extracted.
 */
export async function indexDocument(
  db: NodePgDatabase,
  orgId: string,
  documentId: string,
  extractedText: string,
  chunkOptions?: import("./chunker").ChunkOptions,
): Promise<number> {
  // Mark as indexing
  await updateIndexingStatus(db, orgId, documentId, "indexing").catch(() => {});

  if (!isEmbeddingAvailable()) {
    logger.warn("Embedding service unavailable — skipping RAG indexing");
    await updateIndexingStatus(db, orgId, documentId, "failed", "Embedding service unavailable").catch(() => {});
    return 0;
  }

  if (!extractedText || extractedText.trim().length === 0) {
    logger.warn({ documentId }, "No text to index for RAG");
    await updateIndexingStatus(db, orgId, documentId, "failed", "No text content to index").catch(() => {});
    return 0;
  }

  try {
    // Remove old chunks for this document (handles re-indexing)
    await db.delete(tables.documentChunks).where(eq(tables.documentChunks.documentId, documentId));

    // Chunk the document
    const chunks = chunkDocument(documentId, extractedText, chunkOptions);
    if (chunks.length === 0) {
      await updateIndexingStatus(db, orgId, documentId, "failed", "Document produced no chunks");
      return 0;
    }

    logger.info({ documentId, chunkCount: chunks.length }, "Chunking complete, generating embeddings");

    // Check for duplicate chunks by content hash — reuse existing embeddings
    // to avoid redundant Bedrock API calls for identical text across documents.
    const { createHash } = await import("crypto");
    const chunkHashes = chunks.map((c) => createHash("sha256").update(c.text).digest("hex"));

    // Look up existing chunks with same content hash in this org — reuse embeddings
    let existingEmbeddings = new Map<string, number[]>();
    try {
      const hashList = Array.from(new Set(chunkHashes));
      if (hashList.length > 0) {
        const existing = await db
          .select({ contentHash: tables.documentChunks.contentHash, embedding: tables.documentChunks.embedding })
          .from(tables.documentChunks)
          .where(
            and(
              eq(tables.documentChunks.orgId, orgId),
              sql`${tables.documentChunks.contentHash} = ANY(${hashList}::text[])`,
              sql`${tables.documentChunks.embedding} IS NOT NULL`,
            ),
          )
          .limit(hashList.length);
        for (const row of existing) {
          if (row.contentHash && row.embedding) {
            existingEmbeddings.set(row.contentHash, row.embedding as number[]);
          }
        }
        if (existingEmbeddings.size > 0) {
          logger.info({ documentId, reused: existingEmbeddings.size }, "Reusing embeddings for duplicate chunks");
        }
      }
    } catch {
      // Non-fatal — proceed with fresh embeddings for all chunks
    }

    // Generate embeddings only for chunks that don't have a cached embedding
    const textsToEmbed: string[] = [];
    const embedIndexMap: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (!existingEmbeddings.has(chunkHashes[i])) {
        embedIndexMap.push(i);
        textsToEmbed.push(chunks[i].text);
      }
    }

    const freshEmbeddings = textsToEmbed.length > 0 ? await generateEmbeddingsBatch(textsToEmbed) : [];

    // Merge fresh + cached embeddings
    const embeddings: (number[] | null)[] = new Array(chunks.length);
    let freshIdx = 0;
    let failedEmbeddingCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const cached = existingEmbeddings.get(chunkHashes[i]);
      if (cached) {
        embeddings[i] = cached;
      } else {
        const emb = freshEmbeddings[freshIdx++];
        if (!emb || emb.length === 0) {
          embeddings[i] = null;
          failedEmbeddingCount++;
        } else {
          embeddings[i] = emb;
        }
      }
    }
    if (failedEmbeddingCount > 0) {
      logger.warn(
        { documentId, failed: failedEmbeddingCount, total: chunks.length },
        "Some chunk embeddings failed — stored without vectors (excluded from search)",
      );
    }

    // Store chunks with embeddings and content hash
    const rows = chunks.map((chunk, i) => ({
      id: randomUUID(),
      orgId,
      documentId: chunk.documentId,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      sectionHeader: chunk.sectionHeader,
      tokenCount: chunk.tokenCount,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      embedding: embeddings[i],
      contentHash: chunkHashes[i],
    }));

    // Insert in batches of 100 to avoid exceeding query parameter limits
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await db.insert(tables.documentChunks).values(batch);
    }

    // Mark as indexed
    await updateIndexingStatus(db, orgId, documentId, "indexed");

    logger.info({ documentId, chunksStored: rows.length }, "RAG indexing complete");
    return rows.length;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown indexing error";
    await updateIndexingStatus(db, orgId, documentId, "failed", errorMsg).catch(() => {});
    throw err;
  }
}

/**
 * Remove all chunks for a document (called on document deletion).
 */
export async function removeDocumentChunks(db: NodePgDatabase, documentId: string): Promise<void> {
  await db.delete(tables.documentChunks).where(eq(tables.documentChunks.documentId, documentId));
}

/**
 * Search for relevant document chunks using hybrid semantic + keyword search.
 *
 * Uses pgvector's cosine distance operator (<=>), then applies BM25-style
 * keyword boosting for precision.
 */
export async function searchRelevantChunks(
  db: NodePgDatabase,
  orgId: string,
  queryText: string,
  documentIds: string[],
  options: RAGSearchOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = options.topK ?? RAG_CONFIG.topK;
  const timer = createRagTimer();

  // Adaptive weights: classify query type, then use type-specific weights
  // unless the caller explicitly overrides via options.
  const queryType = options.queryType ?? classifyQueryType(queryText);
  const adaptiveDefaults = getAdaptiveWeights(queryType);
  const semanticWeight = options.semanticWeight ?? adaptiveDefaults.semantic;
  const keywordWeight = options.keywordWeight ?? adaptiveDefaults.keyword;

  if (!isEmbeddingAvailable() || documentIds.length === 0) {
    return [];
  }

  // Prompt injection detection
  const injectionCheck = detectPromptInjection(queryText);
  if (injectionCheck.isInjection) {
    logger.warn({ pattern: injectionCheck.pattern, orgId }, "Prompt injection detected in RAG query — blocked");
    // Log trace for blocked queries
    logRagTrace({
      traceId: randomUUID(),
      orgId,
      queryTextRedacted: redactPhi(queryText),
      embeddingTimeMs: 0,
      retrievalTimeMs: 0,
      rerankTimeMs: 0,
      totalTimeMs: timer.total(),
      candidateCount: 0,
      returnedCount: 0,
      topScore: 0,
      avgScore: 0,
      confidenceLevel: "none",
      confidenceScore: 0,
      injectionBlocked: true,
      timestamp: new Date().toISOString(),
    });
    // Throw a typed error so callers can return a proper HTTP 400 instead of
    // silently returning empty results (which is indistinguishable from "no matches").
    const err = new Error("Query blocked: potential prompt injection detected");
    (err as any).code = "RAG_INJECTION_BLOCKED";
    throw err;
  }

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(queryText);
  timer.mark("embedding");
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Fetch top candidates from pgvector (retrieve more than topK for keyword reranking)
  const candidateLimit = Math.min(topK * RAG_CONFIG.candidateMultiplier, 50);

  // Use raw SQL for pgvector cosine distance
  const candidates = await db.execute(sql`
    SELECT
      dc.id,
      dc.document_id,
      dc.chunk_index,
      dc.text,
      dc.section_header,
      rd.name AS document_name,
      rd.category AS document_category,
      1 - (dc.embedding <=> ${embeddingStr}::vector) AS semantic_score
    FROM document_chunks dc
    JOIN reference_documents rd ON rd.id = dc.document_id
    WHERE dc.org_id = ${orgId}
      AND dc.document_id = ANY(${documentIds}::text[])
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> ${embeddingStr}::vector
    LIMIT ${candidateLimit}
  `);
  timer.mark("retrieval");

  if (!candidates.rows || candidates.rows.length === 0) {
    // Distinguish "no relevant chunks" from "all embeddings failed" — the latter
    // means the org's knowledge base is silently degraded and admin should re-index.
    const totalChunks = await db.execute(sql`
      SELECT count(*)::int AS total, count(embedding)::int AS with_embedding
      FROM document_chunks
      WHERE org_id = ${orgId} AND document_id = ANY(${documentIds}::text[])
    `);
    const row = (totalChunks.rows[0] as any) || {};
    const total = parseInt(row.total) || 0;
    const withEmb = parseInt(row.with_embedding) || 0;
    if (total > 0 && withEmb === 0) {
      logger.warn(
        { orgId, totalChunks: total },
        "RAG search returned 0 results — all chunks have NULL embeddings. Re-index documents to fix",
      );
    }
    return [];
  }

  // Compute dynamic average document length from candidates
  const avgDocLen =
    candidates.rows.length > 0
      ? Math.round(
          (candidates.rows as any[]).reduce((sum: number, r: any) => sum + tokenize(r.text).length, 0) /
            candidates.rows.length,
        )
      : 500;

  // Expand query with industry synonyms for BM25 (not for embedding — embedding
  // handles semantic similarity; this handles lexical gaps like "cpap" vs "c-pap")
  const expandedQuery = expandQueryWithSynonyms(queryText);

  // Apply BM25-style keyword boosting with dynamic avgDocLen
  const results: RetrievedChunk[] = (candidates.rows as any[]).map((row) => {
    // Clamp semantic score to [0,1] — pgvector cosine can return negatives
    const rawSemantic = parseFloat(row.semantic_score) || 0;
    const semanticScore = Math.max(0, Math.min(1, rawSemantic));
    const kwScore = Math.max(0, bm25Score(expandedQuery, row.text, { avgDocLen }));
    // Normalize by weight sum so custom configs (e.g., 0.5+0.5 or 0.6+0.6) produce [0,1] scores
    const weightSum = semanticWeight + keywordWeight || 1;
    const combinedScore = (semanticWeight * semanticScore + keywordWeight * kwScore) / weightSum;
    // NaN guard: if score computation fails, fall back to semantic-only
    const safeScore = Number.isFinite(combinedScore) ? Math.max(0, combinedScore) : semanticScore;

    return {
      id: row.id,
      documentId: row.document_id,
      documentName: row.document_name,
      documentCategory: row.document_category,
      chunkIndex: row.chunk_index,
      text: row.text,
      sectionHeader: row.section_header || null,
      score: safeScore,
    };
  });

  // Re-ranking: boost section header matches and penalize noise
  for (const result of results) {
    let boost = 0;
    if (result.sectionHeader) {
      const headerLower = result.sectionHeader.toLowerCase();
      const queryLower = queryText.toLowerCase();
      const queryTerms = queryLower.split(/\s+/);
      if (queryTerms.some((term) => headerLower.includes(term))) {
        boost += 0.15;
      }
    }
    if (result.text.length < 50) {
      boost -= 0.1;
    }
    result.score = Math.max(0, result.score * (1 + boost));
  }
  timer.mark("rerank");

  // Sort by combined score, filter out low-relevance chunks, and return top K
  results.sort((a, b) => b.score - a.score);
  const relevant = results.filter((r) => r.score >= RAG_CONFIG.minRelevanceScore);

  // Semantic deduplication: skip chunks with highly similar text to a higher-scored chunk.
  // Uses simple text overlap check (cheaper than computing pairwise cosine similarity).
  const DEDUP_SIMILARITY_THRESHOLD = 0.85; // 85% character overlap → consider duplicate
  const deduplicated: typeof relevant = [];
  for (const chunk of relevant) {
    const isDuplicate = deduplicated.some((existing) => {
      // Quick length check: if lengths differ by >30%, can't be >85% similar
      const lenRatio = Math.min(chunk.text.length, existing.text.length) / Math.max(chunk.text.length, existing.text.length);
      if (lenRatio < DEDUP_SIMILARITY_THRESHOLD) return false;
      // Check if one text contains most of the other (overlapping chunks)
      const shorter = chunk.text.length < existing.text.length ? chunk.text : existing.text;
      const longer = chunk.text.length >= existing.text.length ? chunk.text : existing.text;
      return longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.8)));
    });
    if (!isDuplicate) deduplicated.push(chunk);
  }
  const finalResults = deduplicated.slice(0, topK);

  // Compute confidence for tracing and FAQ analytics
  const confidence = computeConfidence(finalResults);

  // Record FAQ analytics
  recordFaqQuery(orgId, queryText, confidence.score, confidence.level);

  // Log RAG trace with PHI-redacted query
  const avgScore = finalResults.length > 0 ? finalResults.reduce((sum, c) => sum + c.score, 0) / finalResults.length : 0;
  logRagTrace({
    traceId: randomUUID(),
    orgId,
    queryTextRedacted: redactPhi(queryText),
    queryType,
    semanticWeight,
    keywordWeight,
    embeddingTimeMs: timer.elapsed("embedding"),
    retrievalTimeMs: timer.elapsed("retrieval"),
    rerankTimeMs: timer.elapsed("rerank"),
    totalTimeMs: timer.total(),
    candidateCount: candidates.rows.length,
    returnedCount: finalResults.length,
    retrievedChunkIds: finalResults.map((c) => c.id),
    retrievalScores: finalResults.map((c) => Math.round(c.score * 1000) / 1000),
    topScore: finalResults.length > 0 ? finalResults[0].score : 0,
    avgScore,
    confidenceLevel: confidence.level,
    confidenceScore: confidence.score,
    injectionBlocked: false,
    timestamp: new Date().toISOString(),
  });

  return finalResults;
}

/**
 * Build context string from retrieved chunks for injection into the AI prompt.
 */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";

  // Wrap each chunk in XML tags to clearly delineate knowledge base content
  // from instructions. This prevents prompt injection via malicious document content —
  // the model is trained to treat tagged content as data, not instructions.
  const sections: string[] = [];
  for (const chunk of chunks) {
    const attrs = [
      `doc="${(chunk.documentName || "").replace(/"/g, "&quot;")}"`,
      chunk.documentCategory ? `category="${chunk.documentCategory.replace(/"/g, "&quot;")}"` : "",
      chunk.sectionHeader ? `section="${chunk.sectionHeader.replace(/"/g, "&quot;")}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    sections.push(`<knowledge_source ${attrs}>\n${chunk.text}\n</knowledge_source>`);
  }

  return sections.join("\n\n");
}

/**
 * Scan AI/RAG output for PHI before returning to client.
 * Logs a warning if PHI is detected and returns a redacted version.
 */
export function scanAndRedactOutput(
  text: string,
  context?: { orgId?: string; queryId?: string },
): { text: string; phiDetected: boolean } {
  const redacted = redactPhi(text);
  const phiDetected = redacted !== text;

  if (phiDetected) {
    logger.warn(
      { orgId: context?.orgId, queryId: context?.queryId },
      "PHI detected in RAG/AI output — redacted before returning to client",
    );
  }

  return { text: redacted, phiDetected };
}

/**
 * Check if an org has any indexed document chunks.
 */
export async function hasIndexedChunks(db: NodePgDatabase, orgId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS(
      SELECT 1 FROM document_chunks WHERE org_id = ${orgId} AND embedding IS NOT NULL
    ) AS has_chunks
  `);
  return (result.rows as any[])[0]?.has_chunks === true;
}

/**
 * Increment retrieval counts for documents whose chunks were used.
 * Fire-and-forget — does not block the caller.
 */
/**
 * Increment retrieval counts at both document and chunk level.
 * Document-level: how often any chunk from this doc is retrieved.
 * Chunk-level: how often this specific chunk is retrieved (shows which sections are most useful).
 */
export async function incrementRetrievalCounts(
  db: NodePgDatabase,
  documentIds: string[],
  chunkIds?: string[],
): Promise<void> {
  if (documentIds.length === 0) return;
  const uniqueDocIds = Array.from(new Set(documentIds));
  await db.execute(sql`
    UPDATE reference_documents
    SET retrieval_count = retrieval_count + 1
    WHERE id = ANY(${uniqueDocIds}::text[])
  `);

  // Chunk-level tracking (optional — callers pass chunk IDs when available)
  if (chunkIds && chunkIds.length > 0) {
    const uniqueChunkIds = Array.from(new Set(chunkIds));
    await db.execute(sql`
      UPDATE document_chunks
      SET retrieval_count = COALESCE(retrieval_count, 0) + 1
      WHERE id = ANY(${uniqueChunkIds}::text[])
    `).catch((err) => {
      // Non-fatal — chunk retrieval tracking is analytics, not critical path
      logger.debug({ err }, "Chunk retrieval count increment failed");
    });
  }
}

/**
 * Get paginated chunks for a document (for chunk preview UI).
 */
export async function getDocumentChunks(
  db: NodePgDatabase,
  orgId: string,
  documentId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{
  chunks: Array<{
    id: string;
    chunkIndex: number;
    text: string;
    sectionHeader: string | null;
    tokenCount: number;
    charStart: number;
    charEnd: number;
    hasEmbedding: boolean;
  }>;
  total: number;
}> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const [countResult, rows] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*) as total FROM document_chunks
      WHERE org_id = ${orgId} AND document_id = ${documentId}
    `),
    db.execute(sql`
      SELECT id, chunk_index, text, section_header, token_count, char_start, char_end,
             (embedding IS NOT NULL) as has_embedding
      FROM document_chunks
      WHERE org_id = ${orgId} AND document_id = ${documentId}
      ORDER BY chunk_index ASC
      LIMIT ${limit} OFFSET ${offset}
    `),
  ]);

  const total = parseInt((countResult.rows as any[])[0]?.total || "0");
  const chunks = (rows.rows as any[]).map((r) => ({
    id: r.id,
    chunkIndex: r.chunk_index,
    text: r.text,
    sectionHeader: r.section_header || null,
    tokenCount: r.token_count,
    charStart: r.char_start,
    charEnd: r.char_end,
    hasEmbedding: r.has_embedding === true,
  }));

  return { chunks, total };
}

/**
 * Get knowledge base analytics for an org.
 */
export async function getKnowledgeBaseAnalytics(
  db: NodePgDatabase,
  orgId: string,
): Promise<{
  totalDocuments: number;
  totalChunks: number;
  indexedDocuments: number;
  failedDocuments: number;
  pendingDocuments: number;
  mostRetrievedDocs: Array<{ documentId: string; name: string; category: string; retrievalCount: number }>;
  avgChunksPerDocument: number;
}> {
  const [docStats, chunkCount, topDocs] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE indexing_status = 'indexed') as indexed,
        COUNT(*) FILTER (WHERE indexing_status = 'failed') as failed,
        COUNT(*) FILTER (WHERE indexing_status = 'pending' OR indexing_status = 'indexing') as pending_count
      FROM reference_documents
      WHERE org_id = ${orgId} AND is_active = true
    `),
    db.execute(sql`
      SELECT COUNT(*) as total FROM document_chunks WHERE org_id = ${orgId}
    `),
    db.execute(sql`
      SELECT id, name, category, retrieval_count
      FROM reference_documents
      WHERE org_id = ${orgId} AND is_active = true AND retrieval_count > 0
      ORDER BY retrieval_count DESC
      LIMIT 10
    `),
  ]);

  const stats = (docStats.rows as any[])[0] || {};
  const totalDocs = parseInt(stats.total || "0");
  const totalChunks = parseInt((chunkCount.rows as any[])[0]?.total || "0");

  return {
    totalDocuments: totalDocs,
    totalChunks,
    indexedDocuments: parseInt(stats.indexed || "0"),
    failedDocuments: parseInt(stats.failed || "0"),
    pendingDocuments: parseInt(stats.pending_count || "0"),
    mostRetrievedDocs: (topDocs.rows as any[]).map((r) => ({
      documentId: r.id,
      name: r.name,
      category: r.category,
      retrievalCount: r.retrieval_count,
    })),
    avgChunksPerDocument: totalDocs > 0 ? Math.round(totalChunks / totalDocs) : 0,
  };
}

// --- Domain synonym expansion (adapted from ums-knowledge-reference) ---
// Bidirectional synonym maps per industry vertical. When a query contains
// a term, its synonyms are appended to boost BM25 recall on abbreviations
// and alternate phrasings. The embedding handles semantic similarity;
// this handles lexical gaps (e.g., "w/c" vs "wheelchair").

const DENTAL_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["crown", ["cap", "restoration", "prosthetic"]],
  ["filling", ["restoration", "composite", "amalgam"]],
  ["extraction", ["pull", "exodontia", "removal"]],
  ["prophylaxis", ["prophy", "cleaning", "dental cleaning"]],
  ["radiograph", ["xray", "x-ray", "film", "image"]],
  ["periodontal", ["perio", "gum", "gingival"]],
  ["endodontic", ["endo", "root canal", "rct"]],
  ["orthodontic", ["ortho", "braces", "aligner"]],
  ["denture", ["prosthesis", "partial", "full denture"]],
  ["implant", ["dental implant", "fixture", "abutment"]],
  ["cdt", ["dental code", "procedure code"]],
  ["sealant", ["pit and fissure sealant", "preventive sealant"]],
  ["fluoride", ["fluoride treatment", "topical fluoride", "varnish"]],
]);

const MEDICAL_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["wheelchair", ["wc", "w/c", "power wheelchair", "manual wheelchair"]],
  ["cpap", ["c-pap", "continuous positive airway pressure"]],
  ["oxygen", ["o2", "supplemental oxygen", "home oxygen"]],
  ["diabetes", ["dm", "dm2", "type 2 diabetes", "diabetic"]],
  ["hypertension", ["htn", "high blood pressure", "elevated bp"]],
  ["medication", ["med", "meds", "prescription", "rx"]],
  ["diagnosis", ["dx", "diagnoses", "condition"]],
  ["treatment", ["tx", "therapy", "intervention"]],
  ["history", ["hx", "medical history", "past history"]],
  ["symptoms", ["sx", "presenting complaints", "chief complaint"]],
  ["patient", ["pt", "client", "individual"]],
  ["hospital", ["facility", "inpatient", "acute care"]],
  ["outpatient", ["op", "ambulatory", "clinic"]],
  ["discharge", ["dc", "d/c", "released"]],
  ["referral", ["consult", "consultation", "refer"]],
  ["vitals", ["vital signs", "bp", "hr", "rr", "temp", "spo2"]],
]);

const BEHAVIORAL_HEALTH_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["therapy", ["counseling", "psychotherapy", "session"]],
  ["depression", ["mdd", "depressive disorder", "depressed mood"]],
  ["anxiety", ["gad", "anxious", "generalized anxiety"]],
  ["substance", ["substance use", "sud", "addiction", "chemical dependency"]],
  ["ptsd", ["post-traumatic", "trauma", "traumatic stress"]],
  ["medication management", ["med management", "psychiatric medication", "psychopharmacology"]],
  ["cbt", ["cognitive behavioral", "cognitive therapy"]],
  ["emdr", ["eye movement", "desensitization", "reprocessing"]],
  ["assessment", ["evaluation", "intake", "diagnostic assessment"]],
  ["crisis", ["crisis intervention", "emergency", "suicidal ideation", "si"]],
  ["soap", ["soap note", "subjective objective assessment plan"]],
  ["dap", ["dap note", "data assessment plan"]],
  ["birp", ["birp note", "behavior intervention response plan"]],
]);

const VETERINARY_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["spay", ["ovariohysterectomy", "ohe", "sterilization"]],
  ["neuter", ["castration", "orchiectomy"]],
  ["vaccination", ["vaccine", "vax", "immunization", "booster"]],
  ["heartworm", ["hw", "dirofilaria", "heartworm disease"]],
  ["flea", ["flea treatment", "ectoparasite", "flea tick"]],
  ["dental", ["dental cleaning", "dental prophy", "oral health"]],
  ["blood work", ["cbc", "chemistry panel", "lab work", "blood panel"]],
  ["radiograph", ["xray", "x-ray", "imaging"]],
]);

const GENERAL_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ["cancellation", ["cancel", "cancelled", "no show", "no-show"]],
  ["appointment", ["appt", "visit", "booking", "scheduled"]],
  ["insurance", ["coverage", "benefits", "plan", "carrier"]],
  ["copay", ["co-pay", "copayment", "co-payment"]],
  ["deductible", ["out of pocket", "oop", "patient responsibility"]],
  ["preauthorization", ["prior auth", "pre-auth", "precertification"]],
  ["complaint", ["concern", "issue", "problem", "grievance"]],
  ["satisfaction", ["csat", "nps", "experience", "happy"]],
  ["escalation", ["escalate", "supervisor", "manager"]],
  ["hold time", ["wait time", "on hold", "queue"]],
]);

/** Get the synonym map for an industry type (falls back to general). */
function getSynonymMap(industryType?: string): ReadonlyMap<string, readonly string[]> {
  const maps: ReadonlyMap<string, readonly string[]>[] = [GENERAL_SYNONYMS];
  switch (industryType) {
    case "dental":
      maps.push(DENTAL_SYNONYMS, MEDICAL_SYNONYMS);
      break;
    case "medical":
      maps.push(MEDICAL_SYNONYMS);
      break;
    case "behavioral_health":
      maps.push(BEHAVIORAL_HEALTH_SYNONYMS, MEDICAL_SYNONYMS);
      break;
    case "veterinary":
      maps.push(VETERINARY_SYNONYMS);
      break;
  }
  // Merge all maps into one
  const merged = new Map<string, readonly string[]>();
  for (const map of maps) {
    for (const [key, synonyms] of Array.from(map)) {
      merged.set(key, synonyms);
    }
  }
  return merged;
}

/**
 * Build a bidirectional synonym lookup from a synonym map.
 * If "cpap" maps to ["c-pap", "continuous positive airway pressure"],
 * then "c-pap" also maps to ["cpap"].
 */
function buildBidirectionalLookup(
  synonymMap: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  for (const [key, synonyms] of Array.from(synonymMap)) {
    // key → all synonyms
    const existing = lookup.get(key) || [];
    for (const syn of synonyms) {
      if (!existing.includes(syn)) existing.push(syn);
    }
    lookup.set(key, existing);

    // each synonym → key (bidirectional)
    for (const syn of synonyms) {
      const synLower = syn.toLowerCase();
      const synExisting = lookup.get(synLower) || [];
      if (!synExisting.includes(key)) synExisting.push(key);
      lookup.set(synLower, synExisting);
    }
  }
  return lookup;
}

/**
 * Expand a query with synonyms for improved BM25 recall.
 * Only appends single-token synonyms to avoid noise.
 */
export function expandQueryWithSynonyms(query: string, industryType?: string): string {
  const synonymMap = getSynonymMap(industryType);
  const lookup = buildBidirectionalLookup(synonymMap);
  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/);
  const expansions: string[] = [];

  for (const term of terms) {
    const synonyms = lookup.get(term);
    if (synonyms) {
      for (const syn of synonyms) {
        // Only add single-token synonyms (multi-word ones add noise to BM25)
        if (!syn.includes(" ") && !terms.includes(syn) && !expansions.includes(syn)) {
          expansions.push(syn);
        }
      }
    }
  }

  return expansions.length > 0 ? `${query} ${expansions.join(" ")}` : query;
}

// --- BM25-style keyword scoring (simplified, no corpus IDF) ---

function bm25Score(
  query: string,
  text: string,
  options?: { avgDocLen?: number; corpusSize?: number; documentFrequencies?: Map<string, number> },
): number {
  const k1 = 1.2;
  const b = 0.75;
  const avgDocLen = options?.avgDocLen ?? 500;

  const queryTerms = tokenize(query);
  const docTerms = tokenize(text);
  const docLen = docTerms.length;

  if (queryTerms.length === 0 || docLen === 0) return 0;

  // Build term frequency map
  const tf = new Map<string, number>();
  for (const term of docTerms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const freq = tf.get(term) || 0;
    if (freq === 0) continue;

    // BM25 term frequency saturation
    const numerator = freq * (k1 + 1);
    const denominator = freq + k1 * (1 - b + b * (docLen / avgDocLen));
    let idf = 1.0;
    if (options?.corpusSize && options?.documentFrequencies) {
      const df = options.documentFrequencies.get(term) || 0;
      idf = Math.log((options.corpusSize - df + 0.5) / (df + 0.5) + 1);
    }
    score += idf * (numerator / denominator);
  }

  // Normalize to 0–1 range using log-linear scaling.
  // Standard BM25 does NOT divide by query term count — doing so penalizes
  // multi-term queries and inflates single-term queries. Use log scaling instead.
  return Math.min(Math.log1p(score) / Math.log1p(3), 1);
}

const MEDICAL_SHORT_TOKENS = new Set([
  "iv",
  "o2",
  "bp",
  "hr",
  "rr",
  "rx",
  "dx",
  "tx",
  "hx",
  "sx",
  "im",
  "sc",
  "po",
  "bid",
  "tid",
  "qd",
  "prn",
  "ct",
  "mr",
  "us",
  "mg",
  "ml",
  "kg",
  "cm",
  "mm",
  "cc",
]);

function tokenize(text: string): string[] {
  const codePattern = /[A-Z]\d{2,4}\.?\d{0,2}|D\d{4}|E\d{4}|\d{5}/gi;
  const codes = (text.match(codePattern) || []).map((c) => c.toLowerCase());
  const hyphenated = (text.match(/[a-zA-Z]+-[a-zA-Z]+/g) || []).map((h) => h.toLowerCase());
  const standard = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 || MEDICAL_SHORT_TOKENS.has(t));
  return Array.from(new Set([...standard, ...codes, ...hyphenated]));
}

/**
 * Compute retrieval confidence from chunk scores.
 * Used as the baseline; can be reconciled with LLM-stated confidence
 * via reconcileConfidence().
 */
export function computeConfidence(chunks: RetrievedChunk[]): {
  score: number;
  level: "high" | "partial" | "low" | "none";
} {
  if (chunks.length === 0) return { score: 0, level: "none" };
  const topScore = chunks[0].score;
  const avgScore = chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;

  // Effective score: 65% top + 35% avg (adapted from UMS).
  // A single strong match lifts confidence more than average.
  let effective = topScore * 0.65 + avgScore * 0.35;

  // Penalize thin evidence: only 1 result means low confidence in retrieval
  if (chunks.length <= 1 && effective > 0) {
    effective *= 0.85;
  }

  let level: "high" | "partial" | "low" | "none";
  if (effective >= 0.42) level = "high";
  else if (effective >= 0.30) level = "partial";
  else if (effective >= 0.15) level = "low";
  else level = "none";
  return { score: Math.round(effective * 100) / 100, level };
}

/**
 * Reconcile LLM-stated confidence with retrieval scores.
 * Adapted from UMS's parseConfidence() reconciliation logic.
 *
 * The LLM may be overconfident (hallucinating with weak retrieval) or
 * underconfident (conservative despite strong retrieval). This function
 * cross-checks both signals to produce a more trustworthy result.
 *
 * @param llmConfidence - Confidence tag from LLM output (e.g., "[CONFIDENCE: HIGH]")
 * @param retrievalConfidence - Score from computeConfidence()
 * @returns Reconciled confidence level and cleaned answer text
 */
export function reconcileConfidence(
  llmText: string,
  retrievalConfidence: { score: number; level: "high" | "partial" | "low" | "none" },
): {
  level: "high" | "partial" | "low" | "none";
  score: number;
  cleanedText: string;
  reconciled: boolean;
} {
  // Parse [CONFIDENCE: HIGH/PARTIAL/LOW] tag from LLM output
  const tagMatch = llmText.match(/\[CONFIDENCE:\s*(HIGH|PARTIAL|LOW)\]/i);
  const cleanedText = llmText.replace(/\[CONFIDENCE:\s*(?:HIGH|PARTIAL|LOW)\]/gi, "").trim();

  if (!tagMatch) {
    // No LLM tag — use retrieval confidence directly
    return {
      level: retrievalConfidence.level,
      score: retrievalConfidence.score,
      cleanedText,
      reconciled: false,
    };
  }

  const llmLevel = tagMatch[1].toLowerCase() as "high" | "partial" | "low";
  let finalLevel: "high" | "partial" | "low" | "none" = llmLevel;
  let reconciled = false;
  const rScore = retrievalConfidence.score;

  // Downgrade: LLM says HIGH but retrieval is weak → prevent hallucination trust
  if (llmLevel === "high" && rScore < 0.30) {
    finalLevel = "partial";
    reconciled = true;
  }

  // Hard downgrade: LLM says HIGH/PARTIAL but retrieval is very weak
  if ((llmLevel === "high" || llmLevel === "partial") && rScore < 0.15) {
    finalLevel = "low";
    reconciled = true;
  }

  // Upgrade: LLM says PARTIAL but retrieval is strong → model may be conservative
  if (llmLevel === "partial" && rScore >= 0.42) {
    const topScore = retrievalConfidence.score / 0.65; // approximate topScore from effective
    if (topScore >= 0.50) {
      finalLevel = "high";
      reconciled = true;
    }
  }

  return {
    level: finalLevel,
    score: rScore,
    cleanedText,
    reconciled,
  };
}

export function validateConversationHistory(
  history: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const MAX_TURNS = 20;
  const MAX_TOTAL_CHARS = 50_000;
  let trimmed = history.slice(-MAX_TURNS);
  let totalChars = trimmed.reduce((sum, h) => sum + h.content.length, 0);
  while (totalChars > MAX_TOTAL_CHARS && trimmed.length > 1) {
    totalChars -= trimmed[0].content.length;
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

/**
 * Reformulate a follow-up question into a standalone query using conversation context.
 * Adapted from UMS's query reformulation strategy.
 *
 * When users ask follow-up questions like "What about that?" or "And the coverage?",
 * the query needs prior context to make sense for embedding and search.
 *
 * Strategy:
 * - Last 4 turns kept verbatim
 * - Older turns summarized into a topic list
 * - Returns a standalone query that can be embedded and searched independently
 *
 * This is a lightweight client-side reformulation (no LLM call). For production
 * conversational interfaces, consider an LLM-based reformulation step.
 */
export function reformulateWithContext(
  currentQuery: string,
  conversationHistory: Array<{ role: string; content: string }>,
): string {
  if (!conversationHistory || conversationHistory.length === 0) return currentQuery;

  // Detect if the query is a follow-up (short, contains pronouns/references)
  const isFollowUp =
    currentQuery.length < 80 &&
    /\b(?:that|this|those|these|it|they|them|the same|above|previous|also|more|what about|and the|how about)\b/i.test(
      currentQuery,
    );

  if (!isFollowUp) return currentQuery;

  // Extract topics from recent conversation
  const recentTurns = conversationHistory.slice(-4);
  const olderTurns = conversationHistory.slice(0, -4);

  // Build topic context from older turns
  let topicContext = "";
  if (olderTurns.length > 0) {
    const topics = olderTurns
      .filter((t) => t.role === "user")
      .map((t) => t.content.slice(0, 100).replace(/[?!.]+$/, ""))
      .join("; ");
    if (topics) {
      topicContext = `Context: previously discussed ${topics}. `;
    }
  }

  // Extract the most recent user question for context
  const lastUserTurn = recentTurns.filter((t) => t.role === "user").pop();
  const lastContext = lastUserTurn ? lastUserTurn.content.slice(0, 200) : "";

  // Reformulate: prepend context to the follow-up
  if (lastContext) {
    return `${topicContext}Regarding "${lastContext}": ${currentQuery}`;
  }

  return `${topicContext}${currentQuery}`;
}
