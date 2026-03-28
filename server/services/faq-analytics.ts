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
 * FAQ Analytics Service
 *
 * Detects frequently asked questions from RAG query patterns.
 * Normalizes queries, groups by similarity key, tracks confidence
 * distribution, and identifies knowledge base gaps.
 *
 * Ported from ums-knowledge-reference, adapted for multi-tenant context.
 */
import { logger } from "./logger";

interface FaqEntry {
  normalizedKey: string;
  sampleQueries: string[];
  count: number;
  avgConfidence: number;
  totalConfidence: number;
  lowConfidenceCount: number;
  lastSeen: string;
}

// Per-org FAQ tracking (in-memory, suitable for single-instance)
const orgFaqData = new Map<string, Map<string, FaqEntry>>();

const MAX_SAMPLE_QUERIES = 5;
const MAX_ENTRIES_PER_ORG = 500;

/**
 * Normalize a query for grouping: lowercase, strip punctuation, collapse whitespace.
 */
function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Record a RAG query for FAQ analysis.
 */
export function recordFaqQuery(
  orgId: string,
  queryText: string,
  confidenceScore: number,
  confidenceLevel: string,
): void {
  let orgData = orgFaqData.get(orgId);
  if (!orgData) {
    orgData = new Map();
    orgFaqData.set(orgId, orgData);
  }

  const key = normalizeQuery(queryText);
  if (key.length < 3) return; // Skip trivially short queries

  const existing = orgData.get(key);
  if (existing) {
    existing.count++;
    existing.totalConfidence += confidenceScore;
    existing.avgConfidence = existing.totalConfidence / existing.count;
    if (confidenceLevel === "low" || confidenceLevel === "none") {
      existing.lowConfidenceCount++;
    }
    if (existing.sampleQueries.length < MAX_SAMPLE_QUERIES) {
      existing.sampleQueries.push(queryText.slice(0, 200));
    }
    existing.lastSeen = new Date().toISOString();
  } else {
    // Evict oldest entry if at capacity
    if (orgData.size >= MAX_ENTRIES_PER_ORG) {
      let oldestKey: string | null = null;
      let oldestDate = "";
      for (const [k, v] of Array.from(orgData)) {
        if (!oldestKey || v.lastSeen < oldestDate) {
          oldestKey = k;
          oldestDate = v.lastSeen;
        }
      }
      if (oldestKey) orgData.delete(oldestKey);
    }

    orgData.set(key, {
      normalizedKey: key,
      sampleQueries: [queryText.slice(0, 200)],
      count: 1,
      avgConfidence: confidenceScore,
      totalConfidence: confidenceScore,
      lowConfidenceCount: (confidenceLevel === "low" || confidenceLevel === "none") ? 1 : 0,
      lastSeen: new Date().toISOString(),
    });
  }
}

/**
 * Get FAQ analytics for an org. Returns top queries sorted by frequency.
 */
export function getFaqAnalytics(
  orgId: string,
  options?: { minCount?: number; limit?: number },
): Array<{
  normalizedKey: string;
  sampleQueries: string[];
  count: number;
  avgConfidence: number;
  lowConfidenceRate: number;
  lastSeen: string;
}> {
  const orgData = orgFaqData.get(orgId);
  if (!orgData) return [];

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
  const entries = Array.from(orgData.values())
    .filter((e: FaqEntry) => e.count >= minCount)
    .sort((a: FaqEntry, b: FaqEntry) => b.count - a.count)
    .slice(0, limit)
    .map((e: FaqEntry) => ({
      normalizedKey: e.normalizedKey,
      sampleQueries: e.sampleQueries,
      count: e.count,
      avgConfidence: Math.round(e.avgConfidence * 100) / 100,
      lowConfidenceRate: e.count > 0 ? Math.round((e.lowConfidenceCount / e.count) * 100) / 100 : 0,
      lastSeen: e.lastSeen,
    }));

  return entries;
}

/**
 * Get knowledge base gap analysis: queries with high frequency but low confidence.
 * These represent topics users frequently ask about but the knowledge base can't answer well.
 */
export function getKnowledgeBaseGaps(
  orgId: string,
  options?: { minCount?: number; maxConfidence?: number; limit?: number },
): Array<{
  normalizedKey: string;
  sampleQueries: string[];
  count: number;
  avgConfidence: number;
  lowConfidenceRate: number;
}> {
  const orgData = orgFaqData.get(orgId);
  if (!orgData) return [];

  const minCount = options?.minCount ?? 3;
  const maxConfidence = options?.maxConfidence ?? 0.45;
  const limit = options?.limit ?? 20;

  return Array.from(orgData.values())
    .filter((e: FaqEntry) => e.count >= minCount && e.avgConfidence <= maxConfidence)
    .sort((a: FaqEntry, b: FaqEntry) => b.count - a.count)
    .slice(0, limit)
    .map((e: FaqEntry) => ({
      normalizedKey: e.normalizedKey,
      sampleQueries: e.sampleQueries,
      count: e.count,
      avgConfidence: Math.round(e.avgConfidence * 100) / 100,
      lowConfidenceRate: e.count > 0 ? Math.round((e.lowConfidenceCount / e.count) * 100) / 100 : 0,
    }));
}
