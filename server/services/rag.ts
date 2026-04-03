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
  const semanticWeight = options.semanticWeight ?? RAG_CONFIG.semanticWeight;
  const keywordWeight = options.keywordWeight ?? RAG_CONFIG.keywordWeight;
  const timer = createRagTimer();

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

  // Apply BM25-style keyword boosting with dynamic avgDocLen
  const results: RetrievedChunk[] = (candidates.rows as any[]).map((row) => {
    // Clamp semantic score to [0,1] — pgvector cosine can return negatives
    const rawSemantic = parseFloat(row.semantic_score) || 0;
    const semanticScore = Math.max(0, Math.min(1, rawSemantic));
    const kwScore = Math.max(0, bm25Score(queryText, row.text, { avgDocLen }));
    const combinedScore = semanticWeight * semanticScore + keywordWeight * kwScore;
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
  logRagTrace({
    traceId: randomUUID(),
    orgId,
    queryTextRedacted: redactPhi(queryText),
    embeddingTimeMs: timer.elapsed("embedding"),
    retrievalTimeMs: timer.elapsed("retrieval"),
    rerankTimeMs: timer.elapsed("rerank"),
    totalTimeMs: timer.total(),
    candidateCount: candidates.rows.length,
    returnedCount: finalResults.length,
    topScore: finalResults.length > 0 ? finalResults[0].score : 0,
    avgScore: finalResults.length > 0 ? finalResults.reduce((sum, c) => sum + c.score, 0) / finalResults.length : 0,
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

export function computeConfidence(chunks: RetrievedChunk[]): {
  score: number;
  level: "high" | "partial" | "low" | "none";
} {
  if (chunks.length === 0) return { score: 0, level: "none" };
  const topScore = chunks[0].score;
  const avgScore = chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;
  const blended = 0.6 * topScore + 0.4 * avgScore;
  let level: "high" | "partial" | "low" | "none";
  if (blended >= 0.7) level = "high";
  else if (blended >= 0.45) level = "partial";
  else if (blended >= 0.3) level = "low";
  else level = "none";
  return { score: Math.round(blended * 100) / 100, level };
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
