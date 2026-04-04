/**
 * RAG Observability Tracing
 *
 * Per-query trace logging with retrieval scores, timing breakdown,
 * chunk-level detail, and confidence levels. Traces are logged as
 * structured JSON via the existing Pino logger.
 *
 * Enhanced with granular fields adapted from ums-knowledge-reference:
 * - Per-chunk IDs and scores for retrieval debugging
 * - Query type classification tracking
 * - Semantic/keyword weight tracking
 * - Token count tracking (when available from Bedrock response)
 *
 * Ported from ums-knowledge-reference, adapted for multi-tenant context.
 */
import { logger } from "./logger";

export interface RagTrace {
  traceId: string;
  orgId: string;
  /** Must be PHI-redacted by the caller before passing to logRagTrace. */
  queryTextRedacted: string;
  /** Query type classification (template_lookup, compliance_question, coaching_question, general) */
  queryType?: string;
  /** Semantic weight used for this query */
  semanticWeight?: number;
  /** Keyword weight used for this query */
  keywordWeight?: number;
  embeddingTimeMs: number;
  retrievalTimeMs: number;
  rerankTimeMs: number;
  totalTimeMs: number;
  candidateCount: number;
  returnedCount: number;
  /** IDs of chunks returned to the caller (for retrieval debugging) */
  retrievedChunkIds?: string[];
  /** Per-chunk scores parallel to retrievedChunkIds */
  retrievalScores?: number[];
  topScore: number;
  avgScore: number;
  confidenceLevel: string;
  confidenceScore: number;
  /** Whether confidence was reconciled (LLM vs retrieval disagreement) */
  confidenceReconciled?: boolean;
  injectionBlocked: boolean;
  /** Bedrock input token count (when available) */
  inputTokens?: number;
  /** Bedrock output token count (when available) */
  outputTokens?: number;
  timestamp: string;
}

/**
 * Log a RAG query trace. Expects queryTextRedacted to already be PHI-redacted
 * by the caller (rag.ts passes redactPhi(queryText) before calling this).
 */
export function logRagTrace(trace: RagTrace): void {
  logger.info(
    { ragTrace: trace },
    `RAG trace: ${trace.returnedCount} chunks (${trace.confidenceLevel}${trace.queryType ? `, ${trace.queryType}` : ""}) in ${trace.totalTimeMs}ms`,
  );
}

/**
 * Create a timing helper for measuring pipeline stages.
 */
export function createRagTimer(): {
  mark: (stage: string) => void;
  elapsed: (stage: string) => number;
  total: () => number;
} {
  const marks = new Map<string, number>();
  const start = Date.now();

  return {
    mark(stage: string) {
      marks.set(stage, Date.now());
    },
    elapsed(stage: string): number {
      const markTime = marks.get(stage);
      if (!markTime) return 0;
      // Find the previous mark or use start
      const allTimes = Array.from(marks.values()).sort((a: number, b: number) => a - b);
      const idx = allTimes.indexOf(markTime);
      const prevTime = idx > 0 ? allTimes[idx - 1] : start;
      return markTime - prevTime;
    },
    total(): number {
      return Date.now() - start;
    },
  };
}
