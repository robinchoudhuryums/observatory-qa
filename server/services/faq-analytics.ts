/**
 * FAQ Analytics Service
 *
 * Detects frequently asked questions from RAG query patterns.
 * Normalizes queries, groups by similarity key, tracks confidence
 * distribution, and identifies knowledge base gaps.
 *
 * HIPAA: Sample queries are PHI-redacted before storage to prevent
 * patient information from persisting in analytics data.
 *
 * Ported from ums-knowledge-reference, adapted for multi-tenant context.
 */
import { redactPhi } from "../utils/phi-redactor";

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
  // Guard against NaN/Infinity from failed embedding operations — would corrupt avgConfidence
  if (!Number.isFinite(confidenceScore)) return;

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
      existing.sampleQueries.push(redactPhi(queryText.slice(0, 200)));
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
      sampleQueries: [redactPhi(queryText.slice(0, 200))],
      count: 1,
      avgConfidence: confidenceScore,
      totalConfidence: confidenceScore,
      lowConfidenceCount: confidenceLevel === "low" || confidenceLevel === "none" ? 1 : 0,
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

  return Array.from(orgData.values())
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

/**
 * Get cross-org (anonymized) FAQ patterns for platform-level intelligence.
 * Adapted from ums-knowledge-reference's FAQ dashboard concept, extended
 * for multi-tenant SaaS to identify common knowledge gaps across the platform.
 *
 * No org-identifiable data is exposed — only normalized query keys with
 * aggregate counts and confidence levels across all tenants.
 *
 * Useful for:
 * - Identifying common knowledge gaps across the platform
 * - Suggesting default knowledge base content for new orgs
 * - Informing default evaluation template improvements
 *
 * Requires minimum 3 orgs asking the same question to prevent de-anonymization.
 */
export function getCrossOrgFaqPatterns(options?: { minOrgs?: number; minTotalCount?: number; limit?: number }): Array<{
  normalizedKey: string;
  orgCount: number;
  totalCount: number;
  avgConfidence: number;
  lowConfidenceRate: number;
}> {
  const minOrgs = options?.minOrgs ?? 3;
  const minTotalCount = options?.minTotalCount ?? 5;
  const limit = options?.limit ?? 30;

  // Aggregate across all orgs by normalized key
  const crossOrgMap = new Map<
    string,
    { orgSet: Set<string>; totalCount: number; totalConfidence: number; lowConfidenceCount: number }
  >();

  for (const [orgId, orgData] of Array.from(orgFaqData)) {
    for (const [key, entry] of Array.from(orgData)) {
      let agg = crossOrgMap.get(key);
      if (!agg) {
        agg = { orgSet: new Set(), totalCount: 0, totalConfidence: 0, lowConfidenceCount: 0 };
        crossOrgMap.set(key, agg);
      }
      agg.orgSet.add(orgId);
      agg.totalCount += entry.count;
      agg.totalConfidence += entry.totalConfidence;
      agg.lowConfidenceCount += entry.lowConfidenceCount;
    }
  }

  return Array.from(crossOrgMap.entries())
    .filter(([, agg]) => agg.orgSet.size >= minOrgs && agg.totalCount >= minTotalCount)
    .sort((a, b) => b[1].totalCount - a[1].totalCount)
    .slice(0, limit)
    .map(([key, agg]) => ({
      normalizedKey: key,
      orgCount: agg.orgSet.size,
      totalCount: agg.totalCount,
      avgConfidence: agg.totalCount > 0 ? Math.round((agg.totalConfidence / agg.totalCount) * 100) / 100 : 0,
      lowConfidenceRate: agg.totalCount > 0 ? Math.round((agg.lowConfidenceCount / agg.totalCount) * 100) / 100 : 0,
    }));
}
