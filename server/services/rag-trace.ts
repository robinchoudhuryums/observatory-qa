/**
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
  confidenceLevel: string;
  confidenceScore: number;
  injectionBlocked: boolean;
  timestamp: string;
}

/**
 * Log a RAG query trace with PHI-redacted query text.
 */
export function logRagTrace(trace: RagTrace): void {
  logger.info(
    {
      ragTrace: {
        ...trace,
        queryTextRedacted: redactPhi(trace.queryTextRedacted),
      },
    },
    `RAG trace: ${trace.returnedCount} chunks (${trace.confidenceLevel}) in ${trace.totalTimeMs}ms`,
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
