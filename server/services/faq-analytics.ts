/**
 * FAQ Analytics — tracks RAG query patterns per org.
 *
 * In-memory sliding window (1 hour) of query texts, grouped and counted.
 * Identifies top queries and knowledge base gaps (frequent queries with
 * low retrieval scores).
 */

import { logger } from "./logger";

interface QueryEntry {
  query: string;
  timestamp: number;
  topScore: number;
  chunkCount: number;
}

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const orgQueries = new Map<string, QueryEntry[]>();

/** Record a RAG query for analytics. Fire-and-forget. */
export function recordRagQuery(orgId: string, query: string, topScore: number, chunkCount: number): void {
  let entries = orgQueries.get(orgId);
  if (!entries) {
    entries = [];
    orgQueries.set(orgId, entries);
  }
  entries.push({ query: query.trim().toLowerCase(), timestamp: Date.now(), topScore, chunkCount });
}

function pruneOld(entries: QueryEntry[]): QueryEntry[] {
  const cutoff = Date.now() - WINDOW_MS;
  return entries.filter(e => e.timestamp > cutoff);
}

export interface FaqEntry {
  query: string;
  count: number;
  avgTopScore: number;
  avgChunkCount: number;
}

export function getFaqAnalytics(orgId: string, options?: { minCount?: number; limit?: number }): FaqEntry[] {
  const raw = orgQueries.get(orgId);
  if (!raw) return [];
  const entries = pruneOld(raw);
  orgQueries.set(orgId, entries);

  const groups = new Map<string, { count: number; totalScore: number; totalChunks: number }>();
  for (const e of entries) {
    const existing = groups.get(e.query);
    if (existing) {
      existing.count++;
      existing.totalScore += e.topScore;
      existing.totalChunks += e.chunkCount;
    } else {
      groups.set(e.query, { count: 1, totalScore: e.topScore, totalChunks: e.chunkCount });
    }
  }

  const minCount = options?.minCount ?? 2;
  const limit = options?.limit ?? 50;

  return Array.from(groups.entries())
    .filter(([, g]) => g.count >= minCount)
    .map(([query, g]) => ({
      query,
      count: g.count,
      avgTopScore: Math.round((g.totalScore / g.count) * 1000) / 1000,
      avgChunkCount: Math.round((g.totalChunks / g.count) * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export interface KnowledgeGap {
  query: string;
  count: number;
  avgTopScore: number;
}

export function getKnowledgeBaseGaps(orgId: string, options?: { minCount?: number; limit?: number }): KnowledgeGap[] {
  const faqs = getFaqAnalytics(orgId, { minCount: options?.minCount ?? 3, limit: 200 });
  const limit = options?.limit ?? 20;
  // Gaps: frequent queries with low retrieval quality
  return faqs
    .filter(f => f.avgTopScore < 0.45)
    .map(f => ({ query: f.query, count: f.count, avgTopScore: f.avgTopScore }))
    .slice(0, limit);
}

/** Alias for recordRagQuery — used by RAG trace integration */
export function recordFaqQuery(orgId: string, query: string, score: number, level: string): void {
  recordRagQuery(orgId, query, score, level === "none" ? 0 : 1);
}
