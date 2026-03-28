/**
 * RAG Trace Logging — structured observability for the retrieval pipeline.
 *
 * Records per-query timing breakdowns (embedding, retrieval, rerank),
 * confidence metrics, and injection detection results.
 */

import { logger } from "./logger";

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
      return Date.now() - start;
    },
  };
}
