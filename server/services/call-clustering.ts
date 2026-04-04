/**
 * Call Clustering Service — discovers recurring call patterns via topic similarity.
 *
 * Adapted from the single-tenant Call Analyzer (assemblyai_tool) for multi-tenant use.
 * Uses TF-IDF cosine similarity on AI-extracted topics, keywords, and summary terms
 * to group calls into clusters. No external embedding model needed — works purely
 * on existing analysis data.
 *
 * Surfaces "trending issues" — topic clusters that are growing in frequency,
 * helping managers identify training opportunities and recurring problems.
 */
import { storage } from "../storage";
import { logger } from "./logger";
import type { CallSummary } from "@shared/schema";

export interface TopicCluster {
  id: string;
  label: string;
  topics: string[];
  callCount: number;
  callIds: string[];
  avgScore: number | null;
  avgConfidence: number | null;
  avgSentiment: { positive: number; neutral: number; negative: number };
  trend: "rising" | "stable" | "declining";
  recentCallIds: string[];
}

interface TermFrequency {
  callId: string;
  terms: Map<string, number>;
  uploadedAt: string;
}

const STOP_WORDS = new Set([
  "the", "and", "was", "were", "been", "being", "have", "has", "had",
  "does", "did", "doing", "will", "would", "could", "should", "shall",
  "this", "that", "these", "those", "with", "from", "into", "about",
  "then", "than", "they", "them", "their", "there", "here", "what",
  "when", "where", "which", "while", "also", "very", "just", "only",
  "call", "caller", "agent", "customer", "said", "called", "told",
  "patient", "office", "phone", "number", "time", "today", "help",
]);

/**
 * Extract and normalize terms from a call's analysis data.
 */
function extractTerms(call: CallSummary): string[] {
  const terms: string[] = [];

  if (call.analysis?.topics && Array.isArray(call.analysis.topics)) {
    for (const topic of call.analysis.topics) {
      const text = typeof topic === "string" ? topic : "";
      if (text) {
        const normalized = text.toLowerCase().trim();
        terms.push(normalized);
        const words = normalized.split(/\s+/).filter((w: string) => w.length >= 3);
        terms.push(...words);
      }
    }
  }

  if (call.analysis?.keywords && Array.isArray(call.analysis.keywords)) {
    for (const kw of call.analysis.keywords) {
      const text = typeof kw === "string" ? kw : "";
      if (text.length >= 3) terms.push(text.toLowerCase().trim());
    }
  }

  if (call.analysis?.summary && typeof call.analysis.summary === "string") {
    const words = call.analysis.summary
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
    terms.push(...words.slice(0, 10));
  }

  return terms;
}

/**
 * Build TF-IDF weighted term vectors for a set of calls.
 */
function buildTfIdf(calls: CallSummary[]): TermFrequency[] {
  const docTerms: TermFrequency[] = [];
  const docFreq = new Map<string, number>();

  for (const call of calls) {
    const terms = extractTerms(call);
    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }
    docTerms.push({ callId: call.id, terms: tf, uploadedAt: call.uploadedAt || "" });
    for (const term of Array.from(tf.keys())) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  // Apply IDF weighting
  const N = calls.length;
  for (const dt of docTerms) {
    for (const [term, count] of Array.from(dt.terms)) {
      const idf = Math.log(N / (docFreq.get(term) || 1));
      dt.terms.set(term, count * idf);
    }
  }

  return docTerms;
}

/**
 * Cosine similarity between two term vectors.
 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, magA = 0, magB = 0;
  for (const [term, valA] of Array.from(a)) {
    const valB = b.get(term) || 0;
    dot += valA * valB;
    magA += valA * valA;
  }
  for (const valB of Array.from(b.values())) {
    magB += valB * valB;
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag > 0 ? dot / mag : 0;
}

/**
 * Agglomerative clustering using cosine similarity threshold.
 */
function clusterCalls(
  docTerms: TermFrequency[],
  similarityThreshold = 0.15,
): Map<number, TermFrequency[]> {
  const assignments = new Array(docTerms.length).fill(-1);
  let nextCluster = 0;

  for (let i = 0; i < docTerms.length; i++) {
    if (assignments[i] !== -1) continue;
    assignments[i] = nextCluster;

    for (let j = i + 1; j < docTerms.length; j++) {
      if (assignments[j] !== -1) continue;
      const sim = cosineSimilarity(docTerms[i].terms, docTerms[j].terms);
      if (sim >= similarityThreshold) {
        assignments[j] = nextCluster;
      }
    }
    nextCluster++;
  }

  const clusters = new Map<number, TermFrequency[]>();
  for (let i = 0; i < assignments.length; i++) {
    const cid = assignments[i];
    if (!clusters.has(cid)) clusters.set(cid, []);
    clusters.get(cid)!.push(docTerms[i]);
  }

  return clusters;
}

/**
 * Get top terms for a cluster by aggregate TF-IDF score.
 */
function getClusterTopTerms(docs: TermFrequency[], limit = 5): string[] {
  const aggregate = new Map<string, number>();
  for (const doc of docs) {
    for (const [term, score] of Array.from(doc.terms)) {
      aggregate.set(term, (aggregate.get(term) || 0) + score);
    }
  }
  return Array.from(aggregate.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}

/**
 * Determine trend by comparing recent (7d) vs older (7-14d) call counts.
 */
function determineTrend(docs: { uploadedAt: string }[]): "rising" | "stable" | "declining" {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86400000;
  const fourteenDaysAgo = now - 14 * 86400000;

  const recent = docs.filter((d) => new Date(d.uploadedAt).getTime() >= sevenDaysAgo).length;
  const older = docs.filter((d) => {
    const t = new Date(d.uploadedAt).getTime();
    return t >= fourteenDaysAgo && t < sevenDaysAgo;
  }).length;

  if (recent > older * 1.3) return "rising";
  if (recent < older * 0.7) return "declining";
  return "stable";
}

/**
 * Main clustering function — returns topic clusters for an org's calls.
 *
 * All data is strictly scoped to the given orgId. Uses TF-IDF cosine similarity
 * on existing analysis topics/keywords/summary — no embedding model calls needed.
 */
export async function getCallClusters(
  orgId: string,
  options: {
    days?: number;
    employeeId?: string;
    minClusterSize?: number;
    maxClusters?: number;
  } = {},
): Promise<TopicCluster[]> {
  const days = options.days || 30;
  const minSize = options.minClusterSize || 2;
  const maxClusters = options.maxClusters || 20;

  const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
  const cutoff = Date.now() - days * 86400000;
  const sevenDaysAgo = Date.now() - 7 * 86400000;

  let calls = allCalls.filter(
    (c) => c.analysis && new Date(c.uploadedAt || 0).getTime() >= cutoff,
  );

  if (options.employeeId) {
    calls = calls.filter((c) => c.employeeId === options.employeeId);
  }

  if (calls.length < 2) return [];

  // Cap input to prevent O(n²) clustering from consuming too much CPU
  const MAX_CLUSTER_INPUT = 500;
  if (calls.length > MAX_CLUSTER_INPUT) {
    calls.sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());
    calls = calls.slice(0, MAX_CLUSTER_INPUT);
  }

  const callMap = new Map(calls.map((c) => [c.id, c]));

  // Build TF-IDF vectors and cluster
  const docTerms = buildTfIdf(calls);
  const rawClusters = clusterCalls(docTerms);

  // Build result clusters
  const results: TopicCluster[] = [];
  let clusterIdx = 0;

  for (const [, docs] of Array.from(rawClusters)) {
    if (docs.length < minSize) continue;

    const callIds = docs.map((d: TermFrequency) => d.callId);
    const clusterCalls = callIds.map((id) => callMap.get(id)).filter(Boolean) as CallSummary[];

    // Average performance score
    const scores = clusterCalls
      .map((c) => parseFloat(String(c.analysis?.performanceScore || "")))
      .filter((s) => !isNaN(s));
    const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;

    // Average confidence
    const confidences = clusterCalls
      .map((c) => parseFloat(String(c.analysis?.confidenceScore || "")))
      .filter((s) => !isNaN(s) && s > 0);
    const avgConfidence = confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
      : null;

    // Sentiment breakdown
    const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
    for (const c of clusterCalls) {
      const s = c.sentiment?.overallSentiment;
      if (s === "positive") sentimentCounts.positive++;
      else if (s === "negative") sentimentCounts.negative++;
      else sentimentCounts.neutral++;
    }

    // Top terms as label
    const topTerms = getClusterTopTerms(docs);
    const label = topTerms.slice(0, 3).join(", ") || `Cluster ${clusterIdx + 1}`;

    // Trend
    const trend = determineTrend(docs);

    // Recent calls (last 7 days)
    const recentCallIds = docs
      .filter((d: TermFrequency) => new Date(d.uploadedAt).getTime() >= sevenDaysAgo)
      .map((d: TermFrequency) => d.callId);

    results.push({
      id: `cluster-${clusterIdx}`,
      label,
      topics: topTerms,
      callCount: docs.length,
      callIds,
      avgScore,
      avgConfidence,
      avgSentiment: sentimentCounts,
      trend,
      recentCallIds,
    });

    clusterIdx++;
  }

  // Sort by call count descending, limit to maxClusters
  results.sort((a, b) => b.callCount - a.callCount);
  return results.slice(0, maxClusters);
}

/**
 * Export internal functions for testing.
 */
export const _testExports = {
  extractTerms,
  buildTfIdf,
  cosineSimilarity,
  clusterCalls,
  getClusterTopTerms,
  determineTrend,
};
