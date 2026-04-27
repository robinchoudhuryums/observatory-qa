/**
 * Performance Snapshot Service — longitudinal analytics with AI narratives.
 *
 * Adapted from the Call Analyzer for multi-tenant Observatory QA.
 * Generates periodic snapshots (weekly/monthly) with:
 *   1. Numerical metrics (for charts/trends)
 *   2. AI narrative that references prior snapshots for trajectory awareness
 *
 * The AI prompt includes recent prior snapshots so the model can identify
 * improvements, regressions, and coaching effectiveness over time.
 *
 * Tier 0.2: persistence backed by server/storage/snapshots.ts (PostgreSQL).
 * In-memory fallback retained for dev mode (no DATABASE_URL) and unit tests.
 */
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { logger } from "./logger";
import type { CallSummary } from "@shared/schema";
import { getDatabase } from "../db/index";
import {
  upsertSnapshot,
  listRecentSnapshots,
  type PerformanceSnapshotRow,
} from "../storage/snapshots";

export type SnapshotLevel = "employee" | "team" | "company";

export interface PerformanceMetrics {
  totalCalls: number;
  avgScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  subScores: {
    compliance: number | null;
    customerExperience: number | null;
    communication: number | null;
    resolution: number | null;
  };
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topStrengths: Array<{ text: string; count: number }>;
  topSuggestions: Array<{ text: string; count: number }>;
  flaggedCallCount: number;
  exceptionalCallCount: number;
}

export interface PerformanceSnapshot {
  id: string;
  orgId: string;
  level: SnapshotLevel;
  targetId: string;
  targetName: string;
  periodStart: string;
  periodEnd: string;
  metrics: PerformanceMetrics;
  aiSummary: string | null;
  priorSnapshotIds: string[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Persistence layer
// ---------------------------------------------------------------------------
//
// PRIMARY: PostgreSQL via server/storage/snapshots.ts (Tier 0.2 of the
// CallAnalyzer adaptation plan). Survives restarts, supports cross-process
// access for SaaS multi-instance deployments.
//
// FALLBACK: in-memory Map. Only used when getDatabase() returns null
// (dev mode without DATABASE_URL or test environments using MemStorage).
// Reset on every process restart — same caveat as the pre-Tier-0.2 behavior.

const snapshotStore = new Map<string, PerformanceSnapshot[]>();

function getStoreKey(orgId: string, level: SnapshotLevel, targetId: string): string {
  return `${orgId}:${level}:${targetId}`;
}

/** Convert a DB row into the JSON-friendly PerformanceSnapshot shape. */
function rowToSnapshot(row: PerformanceSnapshotRow): PerformanceSnapshot {
  return {
    id: row.id,
    orgId: row.orgId,
    level: row.level as SnapshotLevel,
    targetId: row.targetId,
    targetName: row.targetName,
    periodStart: row.periodStart instanceof Date ? row.periodStart.toISOString() : String(row.periodStart),
    periodEnd: row.periodEnd instanceof Date ? row.periodEnd.toISOString() : String(row.periodEnd),
    metrics: row.metrics as PerformanceMetrics,
    aiSummary: row.aiSummary,
    priorSnapshotIds: (row.priorSnapshotIds as string[]) || [],
    generatedAt: row.generatedAt instanceof Date ? row.generatedAt.toISOString() : String(row.generatedAt),
  };
}

/**
 * Persist a snapshot. PostgreSQL when available; in-memory fallback otherwise.
 * Idempotent: re-saving for the same (orgId, level, targetId, periodStart,
 * periodEnd) updates the existing row instead of duplicating.
 */
export async function saveSnapshot(snapshot: PerformanceSnapshot): Promise<void> {
  const db = getDatabase();
  if (db) {
    try {
      await upsertSnapshot(db, {
        id: snapshot.id,
        orgId: snapshot.orgId,
        level: snapshot.level,
        targetId: snapshot.targetId,
        targetName: snapshot.targetName,
        periodStart: new Date(snapshot.periodStart),
        periodEnd: new Date(snapshot.periodEnd),
        metrics: snapshot.metrics,
        aiSummary: snapshot.aiSummary,
        priorSnapshotIds: snapshot.priorSnapshotIds,
        generatedAt: new Date(snapshot.generatedAt),
      });
      return;
    } catch (err) {
      logger.error(
        { err, snapshotId: snapshot.id, orgId: snapshot.orgId },
        "Snapshot DB upsert failed — falling back to in-memory store",
      );
      // Fall through to in-memory store so the snapshot isn't lost
    }
  }

  const key = getStoreKey(snapshot.orgId, snapshot.level, snapshot.targetId);
  const existing = snapshotStore.get(key) || [];
  // Replace any prior entry for the same period (idempotent semantics)
  const filtered = existing.filter(
    (s) => !(s.periodStart === snapshot.periodStart && s.periodEnd === snapshot.periodEnd),
  );
  filtered.push(snapshot);
  snapshotStore.set(key, filtered);
}

/**
 * Fetch the most recent snapshots for a target. PostgreSQL when available;
 * in-memory fallback otherwise. Always sorted by periodEnd DESC.
 */
export async function getSnapshots(
  orgId: string,
  level: SnapshotLevel,
  targetId: string,
  limit = 10,
): Promise<PerformanceSnapshot[]> {
  const db = getDatabase();
  if (db) {
    try {
      const rows = await listRecentSnapshots(db, orgId, level, targetId, limit);
      return rows.map(rowToSnapshot);
    } catch (err) {
      logger.error(
        { err, orgId, level, targetId },
        "Snapshot DB read failed — falling back to in-memory store",
      );
      // Fall through to in-memory store
    }
  }

  const key = getStoreKey(orgId, level, targetId);
  const all = snapshotStore.get(key) || [];
  return all
    .sort((a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime())
    .slice(0, limit);
}

/**
 * Aggregate metrics from a set of call summaries.
 */
export function aggregateMetrics(calls: CallSummary[]): PerformanceMetrics {
  const scores: number[] = [];
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  let flaggedCount = 0, exceptionalCount = 0;
  const subScoreSums = { compliance: 0, customerExperience: 0, communication: 0, resolution: 0 };
  let subScoreCount = 0;
  const allStrengths: string[] = [];
  const allSuggestions: string[] = [];

  for (const call of calls) {
    if (call.analysis?.performanceScore) {
      scores.push(parseFloat(String(call.analysis.performanceScore)) || 0);
    }
    const subScores = (call.analysis as any)?.subScores;
    if (subScores && typeof subScores === "object") {
      subScoreSums.compliance += Number(subScores.compliance) || 0;
      subScoreSums.customerExperience += Number(subScores.customerExperience || subScores.customer_experience) || 0;
      subScoreSums.communication += Number(subScores.communication) || 0;
      subScoreSums.resolution += Number(subScores.resolution) || 0;
      subScoreCount++;
    }
    const flags = call.analysis?.flags;
    if (Array.isArray(flags)) {
      for (const f of flags) {
        if (f === "low_score" || String(f).startsWith("agent_misconduct")) flaggedCount++;
        if (f === "exceptional_call") exceptionalCount++;
      }
    }
    const s = call.sentiment?.overallSentiment;
    if (s === "positive") sentimentCounts.positive++;
    else if (s === "negative") sentimentCounts.negative++;
    else sentimentCounts.neutral++;

    const feedback = call.analysis?.feedback as any;
    if (feedback?.strengths) {
      for (const item of feedback.strengths) allStrengths.push(typeof item === "string" ? item : item?.text || "");
    }
    if (feedback?.suggestions) {
      for (const item of feedback.suggestions) allSuggestions.push(typeof item === "string" ? item : item?.text || "");
    }
  }

  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  return {
    totalCalls: calls.length,
    avgScore: avgScore !== null ? Math.round(avgScore * 100) / 100 : null,
    highScore: scores.length > 0 ? Math.round(Math.max(...scores) * 100) / 100 : null,
    lowScore: scores.length > 0 ? Math.round(Math.min(...scores) * 100) / 100 : null,
    subScores: {
      compliance: subScoreCount > 0 ? Math.round((subScoreSums.compliance / subScoreCount) * 100) / 100 : null,
      customerExperience: subScoreCount > 0 ? Math.round((subScoreSums.customerExperience / subScoreCount) * 100) / 100 : null,
      communication: subScoreCount > 0 ? Math.round((subScoreSums.communication / subScoreCount) * 100) / 100 : null,
      resolution: subScoreCount > 0 ? Math.round((subScoreSums.resolution / subScoreCount) * 100) / 100 : null,
    },
    sentimentBreakdown: sentimentCounts,
    topStrengths: countFrequency(allStrengths),
    topSuggestions: countFrequency(allSuggestions),
    flaggedCallCount: flaggedCount,
    exceptionalCallCount: exceptionalCount,
  };
}

function countFrequency(arr: string[]): Array<{ text: string; count: number }> {
  const freq = new Map<string, number>();
  for (const item of arr) {
    const n = item.trim().toLowerCase();
    if (n) freq.set(n, (freq.get(n) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([text, count]) => ({ text, count }));
}

/**
 * Build an AI prompt for generating a longitudinal narrative summary.
 * Includes prior snapshot context so the model can identify trajectories.
 */
export function buildSnapshotSummaryPrompt(params: {
  level: SnapshotLevel;
  targetName: string;
  periodLabel: string;
  metrics: PerformanceMetrics;
  priorSnapshots: PerformanceSnapshot[];
}): string {
  const { level, targetName, periodLabel, metrics, priorSnapshots } = params;

  let priorContext = "";
  if (priorSnapshots.length > 0) {
    priorContext = "\n\nPRIOR PERFORMANCE SNAPSHOTS (for trajectory context):\n";
    for (const snap of priorSnapshots.slice(0, 3)) {
      priorContext += `- Period: ${snap.periodStart.slice(0, 10)} to ${snap.periodEnd.slice(0, 10)}\n`;
      priorContext += `  Avg Score: ${snap.metrics.avgScore}, Calls: ${snap.metrics.totalCalls}\n`;
      priorContext += `  Sub-scores: Compliance=${snap.metrics.subScores.compliance}, CX=${snap.metrics.subScores.customerExperience}, Communication=${snap.metrics.subScores.communication}, Resolution=${snap.metrics.subScores.resolution}\n`;
      if (snap.aiSummary) priorContext += `  Prior Summary: ${snap.aiSummary.slice(0, 200)}...\n`;
    }
  }

  return `You are a performance analyst writing a ${periodLabel} summary for ${level === "employee" ? "an agent" : level === "team" ? "a team" : "the company"} named "${targetName}".

CURRENT PERIOD METRICS:
- Total Calls: ${metrics.totalCalls}
- Average Score: ${metrics.avgScore}/10
- Score Range: ${metrics.lowScore} to ${metrics.highScore}
- Sub-scores: Compliance=${metrics.subScores.compliance}, Customer Experience=${metrics.subScores.customerExperience}, Communication=${metrics.subScores.communication}, Resolution=${metrics.subScores.resolution}
- Sentiment: ${metrics.sentimentBreakdown.positive} positive, ${metrics.sentimentBreakdown.neutral} neutral, ${metrics.sentimentBreakdown.negative} negative
- Flagged Calls: ${metrics.flaggedCallCount}, Exceptional Calls: ${metrics.exceptionalCallCount}
- Top Strengths: ${metrics.topStrengths.map((s) => s.text).join(", ") || "none"}
- Areas for Improvement: ${metrics.topSuggestions.map((s) => s.text).join(", ") || "none"}
${priorContext}
Write a 3-4 paragraph professional summary that:
1. Highlights key performance trends (improving, stable, declining) by comparing to prior periods if available
2. Identifies specific strengths to reinforce
3. Recommends 2-3 concrete actions for improvement
4. Notes any coaching effectiveness (if scores improved after prior recommendations)

Be specific — reference actual numbers and changes. Write in third person.`;
}

/**
 * Generate a snapshot for an employee.
 */
export async function generateEmployeeSnapshot(
  orgId: string,
  employeeId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<PerformanceSnapshot> {
  const allCalls = await storage.getCallSummaries(orgId, { employee: employeeId, status: "completed" });
  const periodCalls = allCalls.filter((c) => {
    const d = new Date(c.uploadedAt || 0);
    return d >= periodStart && d <= periodEnd;
  });

  const employee = await storage.getEmployee(orgId, employeeId);
  const metrics = aggregateMetrics(periodCalls);
  const priorSnapshots = await getSnapshots(orgId, "employee", employeeId, 3);

  const snapshot: PerformanceSnapshot = {
    id: randomUUID(),
    orgId,
    level: "employee",
    targetId: employeeId,
    targetName: employee?.name || "Unknown",
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    metrics,
    aiSummary: null, // AI summary generated separately (requires Bedrock call)
    priorSnapshotIds: priorSnapshots.map((s) => s.id),
    generatedAt: new Date().toISOString(),
  };

  await saveSnapshot(snapshot);
  logger.info({ orgId, employeeId, snapshotId: snapshot.id }, "Generated employee performance snapshot");
  return snapshot;
}

/**
 * Generate a company-wide snapshot.
 */
export async function generateCompanySnapshot(
  orgId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<PerformanceSnapshot> {
  const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
  const periodCalls = allCalls.filter((c) => {
    const d = new Date(c.uploadedAt || 0);
    return d >= periodStart && d <= periodEnd;
  });

  const org = await storage.getOrganization(orgId);
  const metrics = aggregateMetrics(periodCalls);
  const priorSnapshots = await getSnapshots(orgId, "company", orgId, 3);

  const snapshot: PerformanceSnapshot = {
    id: randomUUID(),
    orgId,
    level: "company",
    targetId: orgId,
    targetName: org?.name || "Organization",
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    metrics,
    aiSummary: null,
    priorSnapshotIds: priorSnapshots.map((s) => s.id),
    generatedAt: new Date().toISOString(),
  };

  await saveSnapshot(snapshot);
  logger.info({ orgId, snapshotId: snapshot.id }, "Generated company performance snapshot");
  return snapshot;
}
