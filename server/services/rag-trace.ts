/**
 * RAG Trace Logging — structured observability for the retrieval pipeline.
 *
 * Records per-query timing breakdowns (embedding, retrieval, rerank),
 * confidence metrics, and injection detection results.
 */

import { logger } from "./logger";
 * RAG Observability Tracing
 *
 * Per-query trace logging with retrieval scores, timing breakdown,
 * and confidence levels. Traces are logged as structured JSON via
 * the existing Pino logger.
 *
 * Ported from ums-knowledge-reference, adapted for multi-tenant context.
 */
import { logger } from "./logger";
import { redactPhi } from "../utils/phi-redactor";

export interface RagTrace {
  traceId: string;
  orgId: string;
  queryTextRedacted: string;
  embeddingTimeMs: number;
  retrievalTimeMs: number;
  rerankTimeMs: number;
  totalTimeMs: number;
  candidateCount: number;
  returnedCount: number;
  topScore: number;
  avgScore: number;
  confidenceLevel: "high" | "partial" | "low" | "none";
  confidenceLevel: string;
  confidenceScore: number;
  injectionBlocked: boolean;
  timestamp: string;
}

/** Log a structured RAG trace entry. */
export function logRagTrace(trace: RagTrace): void {
  logger.info(
    {
      ragTrace: true,
      traceId: trace.traceId,
      orgId: trace.orgId,
      embeddingMs: trace.embeddingTimeMs,
      retrievalMs: trace.retrievalTimeMs,
      rerankMs: trace.rerankTimeMs,
      totalMs: trace.totalTimeMs,
      candidates: trace.candidateCount,
      returned: trace.returnedCount,
      topScore: trace.topScore,
      avgScore: trace.avgScore,
      confidence: trace.confidenceLevel,
      confidenceScore: trace.confidenceScore,
      injectionBlocked: trace.injectionBlocked,
    },
    `RAG trace: ${trace.returnedCount} chunks (${trace.confidenceLevel}) in ${trace.totalTimeMs}ms`,
  );
}

/** Simple timing helper for RAG pipeline stages. */
export function createRagTimer(): {
  mark: (stage: string) => void;
  elapsed: (stage: string) => number;
  total: () => number;
} {
  const start = Date.now();
  const marks = new Map<string, number>();
/**
 * Log a RAG query trace with PHI-redacted query text.
 */
export function logRagTrace(trace: RagTrace): void {
  logger.info({
    ragTrace: {
      ...trace,
      queryTextRedacted: redactPhi(trace.queryTextRedacted),
    },
  }, "RAG query trace");
}

/**
 * Create a timing helper for measuring pipeline stages.
 */
export function createRagTimer(): { mark: (stage: string) => void; elapsed: (stage: string) => number; total: () => number } {
  const marks = new Map<string, number>();
  const start = Date.now();

  return {
    mark(stage: string) {
      marks.set(stage, Date.now());
    },
    elapsed(stage: string) {
      const prev = marks.get(stage);
      if (!prev) return 0;
      // Find the previous mark or start
      const stages = Array.from(marks.entries()).sort((a, b) => a[1] - b[1]);
      const idx = stages.findIndex(([s]) => s === stage);
      const prevTime = idx > 0 ? stages[idx - 1][1] : start;
      return prev - prevTime;
    },
    total() {
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
