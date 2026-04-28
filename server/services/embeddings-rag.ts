/**
 * PHI-redacting wrappers around the embedding service for RAG search.
 *
 * The base `generateEmbedding(text)` in `./embeddings` is used for two
 * purposes that have OPPOSITE PHI requirements:
 *
 *   1. Indexing reference documents: text must be embedded verbatim so
 *      retrieval works. Documents are uploaded by the org (handbooks,
 *      protocols, scripts) — they're org-controlled content, not user PHI.
 *
 *   2. Embedding RAG queries: text comes from end users (managers asking
 *      questions, system-generated coaching context). PHI in the query
 *      enters Bedrock's prompt cache and the embedding cache key, which
 *      is unnecessary for retrieval.
 *
 * This module provides query-side wrappers that PHI-redact before calling
 * the underlying embedding service. Callers should use:
 *   - generateEmbedding (from ./embeddings)        for INDEXING
 *   - generateQueryEmbedding (from this module)    for RAG QUERIES
 *
 * Tier 0.1 of the CallAnalyzer adaptation plan.
 */
import { generateEmbedding } from "./embeddings";
import { redactTextForCategory } from "./phi-policy";

/**
 * Generate an embedding for a RAG query, with automatic PHI redaction.
 *
 * @param queryText - The user's query text. May contain PHI.
 * @param callCategory - Optional. If the query is associated with a call
 *                       category (e.g., the analyzer building a RAG context
 *                       for a clinical encounter), the redaction policy
 *                       respects clinical-vs-non-clinical routing.
 *                       For free-form RAG queries (e.g., from a chat UI),
 *                       leave undefined — the policy defaults to redact.
 *
 * Returns the embedding vector (number[]). Same shape and dimensions as
 * `generateEmbedding`. The PHI redaction is invisible to the caller.
 */
export async function generateQueryEmbedding(queryText: string, callCategory?: string | null): Promise<number[]> {
  const safeText = redactTextForCategory(queryText, callCategory);
  return generateEmbedding(safeText);
}
