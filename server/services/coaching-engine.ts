/**
 * Coaching Engine — Auto-recommendation and AI plan generation.
 *
 * Analyzes agent performance patterns and generates coaching recommendations
 * when metrics drop below thresholds. Also generates AI coaching plans.
 */
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { aiProvider } from "./ai-factory";
import { buildAgentSummaryPrompt } from "./ai-provider";
import { logger } from "./logger";
import type { CallSummary, CoachingSession } from "@shared/schema";
import { prepareCallSummariesForPrompt } from "./coaching-prompt";
import { generateProgressivePlan, progressivePlanToActionPlan, type WeaknessContext } from "./coaching-progressive";

// Default thresholds for auto-recommendations (can be overridden per-org via settings.coachingThresholds)
const DEFAULT_THRESHOLDS = {
  lowScore: 5, // Performance score below this triggers recommendation (0-10)
  lowSubScore: 5, // Sub-score below this triggers category-specific recommendation (0-10)
  minCallsForTrend: 3, // Minimum calls to detect a trend
  lowSentiment: 0.4, // Sentiment score below this triggers recommendation (0-1 scale)
  minCallsForPerformers: 5, // Minimum calls for an employee to appear in rankings
};

/** Non-coachable flags — system/audio issues, not agent behavior. */
const NON_COACHABLE_FLAGS = new Set(["empty_transcript", "audio_missing", "low_confidence"]);

export interface CoachingRecommendation {
  employeeId: string;
  trigger: string;
  category: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  callIds: string[];
  metrics: Record<string, unknown>;
}

/**
 * Analyze an employee's recent calls and generate coaching recommendations.
 * Called after call analysis completes or on demand.
 */
export async function generateRecommendations(orgId: string, employeeId: string): Promise<CoachingRecommendation[]> {
  const recommendations: CoachingRecommendation[] = [];

  try {
    // Load per-org coaching thresholds (falls back to defaults)
    const org = await storage.getOrganization(orgId);
    const orgThresholds = (org?.settings as any)?.coachingThresholds || {};
    const THRESHOLDS = { ...DEFAULT_THRESHOLDS, ...orgThresholds };

    const allCalls = await storage.getCallSummaries(orgId, { employee: employeeId, status: "completed" });
    if (allCalls.length < THRESHOLDS.minCallsForTrend) return [];

    // Sort by date descending — most recent first
    const calls = allCalls
      .filter((c) => c.analysis?.performanceScore != null)
      .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());

    if (calls.length < THRESHOLDS.minCallsForTrend) return [];

    const recentCalls = calls.slice(0, 10);
    const employee = await storage.getEmployee(orgId, employeeId);
    const employeeName = employee?.name || "Agent";

    // 1. Check overall performance score
    const avgScore = average(recentCalls.map((c) => Number(c.analysis?.performanceScore) || 0));
    if (avgScore < THRESHOLDS.lowScore) {
      recommendations.push({
        employeeId,
        trigger: "low_performance",
        category: "general",
        title: `${employeeName}: Low overall performance (avg ${avgScore.toFixed(1)}/10)`,
        description: `${employeeName}'s average performance score over the last ${recentCalls.length} calls is ${avgScore.toFixed(1)}/10, below the ${THRESHOLDS.lowScore}/10 threshold.`,
        severity: avgScore < 3 ? "high" : "medium",
        callIds: recentCalls.slice(0, 5).map((c) => c.id),
        metrics: { avgScore, callCount: recentCalls.length },
      });
    }

    // 2. Check sub-scores
    const subScoreChecks = [
      { key: "compliance", label: "Compliance" },
      { key: "customerExperience", label: "Customer Experience" },
      { key: "communication", label: "Communication" },
      { key: "resolution", label: "Resolution" },
    ] as const;

    for (const { key, label } of subScoreChecks) {
      const scores = recentCalls
        .map((c) => {
          const val = (c.analysis?.subScores as Record<string, unknown> | undefined)?.[key];
          return val != null ? Number(val) : undefined;
        })
        .filter((s): s is number => s != null && !isNaN(s));

      if (scores.length >= THRESHOLDS.minCallsForTrend) {
        const avg = average(scores);
        if (avg < THRESHOLDS.lowSubScore) {
          recommendations.push({
            employeeId,
            trigger: `low_${key}`,
            category: key,
            title: `${employeeName}: Low ${label.toLowerCase()} (avg ${avg.toFixed(1)}/10)`,
            description: `${employeeName}'s ${label.toLowerCase()} sub-score averages ${avg.toFixed(1)}/10 over ${scores.length} recent calls.`,
            severity: avg < 3 ? "high" : "medium",
            callIds: recentCalls.slice(0, 3).map((c) => c.id),
            metrics: { [`avg_${key}`]: avg, callCount: scores.length },
          });
        }
      }
    }

    // 3. Check sentiment trend (overallScore is 0-1 scale: 0=negative, 1=positive)
    const sentimentScores = recentCalls
      .map((c) => (c.sentiment?.overallScore != null ? Number(c.sentiment.overallScore) : undefined))
      .filter((s): s is number => s != null && !isNaN(s));

    if (sentimentScores.length >= THRESHOLDS.minCallsForTrend) {
      const avgSentiment = average(sentimentScores);
      if (avgSentiment < THRESHOLDS.lowSentiment) {
        recommendations.push({
          employeeId,
          trigger: "negative_sentiment_trend",
          category: "communication",
          title: `${employeeName}: Low customer sentiment (avg ${(avgSentiment * 10).toFixed(1)}/10)`,
          description: `${employeeName}'s calls show low customer sentiment (avg ${(avgSentiment * 10).toFixed(1)}/10 over ${sentimentScores.length} calls). Consider de-escalation or empathy training.`,
          severity: avgSentiment < 0.25 ? "high" : "medium",
          callIds: recentCalls.slice(0, 3).map((c) => c.id),
          metrics: { avgSentiment, callCount: sentimentScores.length },
        });
      }
    }

    // 4. Check for recurring coachable flags (skip system/audio flags)
    const flagCounts: Record<string, number> = {};
    for (const call of recentCalls) {
      const flags = call.analysis?.flags;
      if (Array.isArray(flags)) {
        for (const flag of flags) {
          const f = typeof flag === "string" ? flag : "";
          if (f && !NON_COACHABLE_FLAGS.has(f)) flagCounts[f] = (flagCounts[f] || 0) + 1;
        }
      }
    }

    for (const [flag, count] of Object.entries(flagCounts)) {
      if (count >= 2) {
        recommendations.push({
          employeeId,
          trigger: `recurring_flag_${flag}`,
          category: "compliance",
          title: `${employeeName}: Recurring "${flag.replace(/_/g, " ")}" flag (${count}x)`,
          description: `The "${flag.replace(/_/g, " ")}" flag has been triggered ${count} times in the last ${recentCalls.length} calls.`,
          severity: count >= 3 ? "high" : "medium",
          callIds: recentCalls
            .filter((c) => {
              const flags = c.analysis?.flags;
              return Array.isArray(flags) && flags.includes(flag);
            })
            .map((c) => c.id),
          metrics: { flag, count, totalCalls: recentCalls.length },
        });
      }
    }
  } catch (error) {
    logger.error({ err: error, orgId, employeeId }, "Failed to generate coaching recommendations");
  }

  return recommendations;
}

/**
 * Persist recommendations to the database, deduplicating against existing pending ones.
 */
export async function saveRecommendations(orgId: string, recommendations: CoachingRecommendation[]): Promise<number> {
  let saved = 0;
  try {
    const { getDatabase } = await import("../db/index");
    const db = getDatabase();
    if (!db) return 0;

    const { coachingRecommendations } = await import("../db/schema");
    const { eq, and } = await import("drizzle-orm");

    for (const rec of recommendations) {
      // Check for existing pending recommendation with same trigger + employee
      const existing = await db
        .select()
        .from(coachingRecommendations)
        .where(
          and(
            eq(coachingRecommendations.orgId, orgId),
            eq(coachingRecommendations.employeeId, rec.employeeId),
            eq(coachingRecommendations.trigger, rec.trigger),
            eq(coachingRecommendations.status, "pending"),
          ),
        )
        .limit(1);

      if (existing.length > 0) continue; // Already exists

      await db.insert(coachingRecommendations).values({
        id: randomUUID(),
        orgId,
        employeeId: rec.employeeId,
        trigger: rec.trigger,
        category: rec.category,
        title: rec.title,
        description: rec.description,
        severity: rec.severity,
        callIds: rec.callIds,
        metrics: rec.metrics,
        status: "pending",
      });
      saved++;
    }
  } catch (error) {
    logger.error({ err: error, orgId }, "Failed to save coaching recommendations");
  }
  return saved;
}

/**
 * Generate an AI coaching plan for a coaching session.
 * Uses the employee's recent call analyses to produce actionable coaching content.
 */
export async function generateCoachingPlan(orgId: string, sessionId: string): Promise<{ plan: string } | null> {
  if (!aiProvider.isAvailable || !aiProvider.generateText) {
    return null;
  }

  const session = await getCoachingSession(orgId, sessionId);
  if (!session) return null;

  const employee = await storage.getEmployee(orgId, session.employeeId);
  if (!employee) return null;

  const calls = await storage.getCallSummaries(orgId, { employee: session.employeeId, status: "completed" });
  const recentCalls = calls
    .filter((c) => c.analysis?.performanceScore != null)
    .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime())
    .slice(0, 10);

  if (recentCalls.length === 0) return null;

  const avgScore = average(recentCalls.map((c) => Number(c.analysis?.performanceScore) || 0));
  const callSummaries = recentCalls.slice(0, 5).map((c) => ({
    score: c.analysis?.performanceScore,
    subScores: c.analysis?.subScores,
    summary: c.analysis?.summary,
    feedback: c.analysis?.feedback,
    flags: c.analysis?.flags,
    sentiment: c.sentiment?.overallSentiment,
  }));

  const prompt = `You are a call center coaching expert. Generate a structured coaching action plan for the following agent.

Agent: ${employee.name}
Role: ${employee.role || "Agent"}
Coaching Category: ${session.category}
Session Title: ${session.title}
${session.notes ? `Manager Notes: ${session.notes}` : ""}

Performance Summary (last ${recentCalls.length} calls):
- Average Score: ${avgScore.toFixed(1)}/10
- Recent Call Details:
${JSON.stringify(callSummaries, null, 2)}

Generate a coaching plan in the following JSON format:
{
  "summary": "Brief assessment of current performance",
  "strengths": ["strength 1", "strength 2"],
  "areasForImprovement": ["area 1", "area 2"],
  "actionItems": [
    { "task": "Specific action item", "priority": "high|medium|low", "timeline": "e.g. 1 week" }
  ],
  "trainingRecommendations": ["recommendation 1"],
  "targetMetrics": {
    "targetScore": 7.5,
    "focusAreas": ["compliance", "communication"]
  }
}

Return ONLY valid JSON, no markdown or extra text.`;

  try {
    const response = await aiProvider.generateText(prompt);
    return { plan: response };
  } catch (error) {
    logger.error({ err: error, orgId, sessionId }, "Failed to generate coaching plan");
    return null;
  }
}

/**
 * Calculate coaching effectiveness: compare pre/post coaching metrics.
 */
export async function calculateEffectiveness(
  orgId: string,
  sessionId: string,
): Promise<{
  preCoaching: { avgScore: number; callCount: number; subScores: Record<string, number> };
  postCoaching: { avgScore: number; callCount: number; subScores: Record<string, number> };
  improvement: { score: number; subScores: Record<string, number> };
} | null> {
  const session = await getCoachingSession(orgId, sessionId);
  if (!session) return null;

  const calls = await storage.getCallSummaries(orgId, { employee: session.employeeId, status: "completed" });
  const scoredCalls = calls
    .filter((c) => c.analysis?.performanceScore != null && c.uploadedAt)
    .sort((a, b) => new Date(a.uploadedAt || 0).getTime() - new Date(b.uploadedAt || 0).getTime());

  const sessionDate = new Date(session.createdAt || 0);

  const preCalls = scoredCalls.filter((c) => new Date(c.uploadedAt || 0) < sessionDate);
  const postCalls = scoredCalls.filter((c) => new Date(c.uploadedAt || 0) >= sessionDate);

  if (preCalls.length === 0 || postCalls.length === 0) return null;

  const preMetrics = computeMetrics(preCalls.slice(-10)); // Last 10 before
  const postMetrics = computeMetrics(postCalls.slice(0, 10)); // First 10 after

  return {
    preCoaching: preMetrics,
    postCoaching: postMetrics,
    improvement: {
      score: postMetrics.avgScore - preMetrics.avgScore,
      subScores: {
        compliance: (postMetrics.subScores.compliance || 0) - (preMetrics.subScores.compliance || 0),
        customerExperience:
          (postMetrics.subScores.customerExperience || 0) - (preMetrics.subScores.customerExperience || 0),
        communication: (postMetrics.subScores.communication || 0) - (preMetrics.subScores.communication || 0),
        resolution: (postMetrics.subScores.resolution || 0) - (preMetrics.subScores.resolution || 0),
      },
    },
  };
}

// --- Helpers ---

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function computeMetrics(calls: CallSummary[]): {
  avgScore: number;
  callCount: number;
  subScores: Record<string, number>;
} {
  const scores = calls.map((c) => Number(c.analysis?.performanceScore) || 0);
  const subScoreKeys = ["compliance", "customerExperience", "communication", "resolution"];

  const subScores: Record<string, number> = {};
  for (const key of subScoreKeys) {
    const vals = calls
      .map((c) => {
        const val = (c.analysis?.subScores as Record<string, unknown> | undefined)?.[key];
        return val != null ? Number(val) : undefined;
      })
      .filter((v): v is number => v != null && !isNaN(v));
    subScores[key] = vals.length > 0 ? average(vals) : 0;
  }

  return {
    avgScore: average(scores),
    callCount: calls.length,
    subScores,
  };
}

async function getCoachingSession(orgId: string, sessionId: string): Promise<CoachingSession | null> {
  try {
    const sessions = await storage.getAllCoachingSessions(orgId);
    return sessions.find((s) => s.id === sessionId) || null;
  } catch (err) {
    logger.warn({ err, orgId, sessionId }, "Failed to retrieve coaching session");
    return null;
  }
}

// =============================================================================
// AUTOMATION RULES ENGINE
// =============================================================================

/**
 * Run all enabled automation rules for an org.
 * Checks each rule's trigger conditions against recent employee data
 * and auto-creates coaching sessions when thresholds are breached.
 *
 * Called: after each call is analyzed (inline) + on a daily scheduled pass.
 */
export async function runAutomationRules(
  orgId: string,
  targetEmployeeId?: string,
): Promise<{ triggered: number; sessionsCreated: number }> {
  let triggered = 0;
  let sessionsCreated = 0;

  try {
    const rules = await storage.listAutomationRules(orgId);
    const enabledRules = rules.filter((r) => r.isEnabled);
    if (enabledRules.length === 0) return { triggered: 0, sessionsCreated: 0 };

    // Load employees to evaluate
    const employees = targetEmployeeId
      ? [await storage.getEmployee(orgId, targetEmployeeId)].filter(Boolean)
      : await storage.getAllEmployees(orgId);

    const activeEmployees = (employees as any[]).filter((e) => e?.status === "active");

    for (const rule of enabledRules) {
      for (const employee of activeEmployees) {
        const fired = await evaluateRule(orgId, rule as any, employee.id, employee.name);
        if (fired) {
          triggered++;
          // Create the coaching session
          const actions = rule.actions as any;
          if (actions.createSession !== false) {
            const template = actions.templateId
              ? await storage.getCoachingTemplate(orgId, actions.templateId).catch(() => null)
              : null;

            const sessionTitle = (actions.sessionTitle || `Coaching: ${rule.name} — ${employee.name}`)
              .replace("{employee}", employee.name)
              .replace("{rule}", rule.name);

            const sessionData = {
              orgId,
              employeeId: employee.id,
              assignedBy: "Automation",
              category: actions.sessionCategory || "general",
              title: sessionTitle,
              notes: actions.sessionNotes
                ? actions.sessionNotes.replace("{employee}", employee.name).replace("{rule}", rule.name)
                : `Auto-created by rule: ${rule.name}`,
              actionPlan: template?.actionPlan?.map((t: any) => ({ task: t.task, completed: false })) || [],
              status: "pending" as const,
              automatedTrigger: rule.triggerType,
              automationRuleId: rule.id,
              templateId: actions.templateId || null,
            } as any;

            try {
              await storage.createCoachingSession(orgId, sessionData);
              sessionsCreated++;

              // Update rule stats
              await storage.updateAutomationRule(orgId, rule.id, {
                lastTriggeredAt: new Date().toISOString(),
                triggerCount: (rule.triggerCount || 0) + 1,
              } as any);

              logger.info(
                { orgId, ruleId: rule.id, employeeId: employee.id },
                "Automation rule triggered coaching session",
              );
            } catch (err) {
              logger.warn(
                { err, ruleId: rule.id, employeeId: employee.id },
                "Failed to create automated coaching session",
              );
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err, orgId }, "Automation rules runner failed");
  }

  return { triggered, sessionsCreated };
}

/**
 * Evaluate a single automation rule against an employee.
 * Returns true if the rule should fire (trigger not already in cooldown).
 */
async function evaluateRule(orgId: string, rule: any, employeeId: string, employeeName: string): Promise<boolean> {
  try {
    const conditions = rule.conditions as any;
    const lookbackDays = conditions.lookbackDays || 30;
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    // Check cooldown: don't re-trigger for same employee if a pending/in_progress automated session exists
    const existing = await storage.getCoachingSessionsByEmployee(orgId, employeeId);
    const hasActiveCooldown = existing.some(
      (s) =>
        s.status !== "completed" &&
        s.status !== "dismissed" &&
        (s as any).automationRuleId === rule.id &&
        new Date(s.createdAt || 0) > since,
    );
    if (hasActiveCooldown) return false;

    // Load recent completed calls for this employee
    const allCalls = await storage.getAllCalls(orgId);
    const recentCalls = allCalls.filter(
      (c) =>
        c.employeeId === employeeId &&
        c.status === "completed" &&
        new Date(c.uploadedAt || 0) >= since &&
        (!conditions.category || c.callCategory === conditions.category),
    );

    if (recentCalls.length === 0) return false;

    // Load analyses
    const callsWithAnalysis = await Promise.all(
      recentCalls.slice(-20).map(async (c) => {
        const analysis = await storage.getCallAnalysis(orgId, c.id);
        return { ...c, analysis };
      }),
    );
    const analyzed = callsWithAnalysis.filter((c) => c.analysis);

    switch (rule.triggerType) {
      case "consecutive_low_score": {
        const threshold = conditions.threshold ?? 6.0;
        const needed = conditions.consecutiveCount ?? 3;
        // Check last N calls in order
        const sorted = analyzed.sort(
          (a: any, b: any) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime(),
        );
        const lastN = sorted.slice(0, needed);
        if (lastN.length < needed) return false;
        return lastN.every((c: any) => (c.analysis?.performanceScore || 0) < threshold);
      }

      case "trend_decline": {
        const threshold = conditions.threshold ?? 1.0; // min score drop to be considered decline
        if (analyzed.length < 4) return false;
        const sorted = analyzed.sort(
          (a: any, b: any) => new Date(a.uploadedAt || 0).getTime() - new Date(b.uploadedAt || 0).getTime(),
        );
        const half = Math.floor(sorted.length / 2);
        const older = average(sorted.slice(0, half).map((c: any) => c.analysis?.performanceScore || 0));
        const newer = average(sorted.slice(half).map((c: any) => c.analysis?.performanceScore || 0));
        return older - newer >= threshold;
      }

      case "flag_recurring": {
        const flagType = conditions.flagType;
        if (!flagType) return false;
        const flaggedCalls = analyzed.filter((c: any) => {
          const flags = c.analysis?.flags as string[] | undefined;
          return flags?.includes(flagType);
        });
        const needed = conditions.consecutiveCount ?? 2;
        return flaggedCalls.length >= needed;
      }

      case "low_sentiment": {
        const threshold = conditions.sentimentThreshold ?? 0.35;
        const needed = conditions.consecutiveCount ?? 3;
        if (analyzed.length < needed) return false;
        const callsWithSentiment = await Promise.all(
          analyzed.slice(-needed).map(async (c) => {
            const sentiment = await storage.getSentimentAnalysis(orgId, c.id);
            return sentiment?.overallScore || 0;
          }),
        );
        return callsWithSentiment.every((s) => s < threshold);
      }

      default:
        return false;
    }
  } catch (err) {
    logger.warn({ err, ruleId: rule.id, employeeId }, "Rule evaluation failed");
    return false;
  }
}

// =============================================================================
// EFFECTIVENESS CACHING
// =============================================================================

/**
 * Calculate effectiveness and cache the snapshot on the coaching session.
 * Automatically called when a session is 30+ days old and has no snapshot.
 */
export async function calculateAndCacheEffectiveness(orgId: string, sessionId: string): Promise<void> {
  try {
    const session = await storage.getCoachingSession(orgId, sessionId);
    if (!session) return;
    if ((session as any).effectivenessSnapshot) return; // already cached

    const result = await calculateEffectiveness(orgId, sessionId);
    if (!result) return;

    await storage.updateCoachingSession(orgId, sessionId, {
      effectivenessSnapshot: result,
      effectivenessCalculatedAt: new Date().toISOString(),
    } as any);
  } catch (err) {
    logger.warn({ err, orgId, sessionId }, "Failed to cache effectiveness snapshot");
  }
}

/**
 * Sweep all completed sessions older than 30 days that haven't had effectiveness calculated.
 * Run daily.
 */
export async function sweepEffectivenessSnapshots(orgId: string): Promise<number> {
  let calculated = 0;
  try {
    const sessions = await storage.getAllCoachingSessions(orgId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const candidates = sessions.filter(
      (s) =>
        s.status === "completed" &&
        s.completedAt &&
        new Date(s.completedAt) < thirtyDaysAgo &&
        !(s as any).effectivenessSnapshot,
    );
    for (const session of candidates) {
      await calculateAndCacheEffectiveness(orgId, session.id);
      calculated++;
    }
  } catch (err) {
    logger.warn({ err, orgId }, "Effectiveness sweep failed");
  }
  return calculated;
}

// =============================================================================
// FOLLOW-UP REMINDERS
// =============================================================================

/**
 * Check for coaching sessions with action items approaching their due date.
 * Returns sessions due within `windowHours` (default: 24) that aren't completed.
 */
export async function getDueSoonSessions(
  orgId: string,
  windowHours = 24,
): Promise<Array<{ session: CoachingSession; employeeName: string; hoursUntilDue: number }>> {
  try {
    const sessions = await storage.getAllCoachingSessions(orgId);
    const employees = await storage.getAllEmployees(orgId);
    const empMap = new Map(employees.map((e) => [e.id, e.name]));
    const now = Date.now();
    const windowMs = windowHours * 60 * 60 * 1000;

    return sessions
      .filter((s) => {
        if (s.status === "completed" || s.status === "dismissed" || !s.dueDate) return false;
        const due = new Date(s.dueDate).getTime();
        return due > now && due - now <= windowMs;
      })
      .map((s) => ({
        session: s,
        employeeName: empMap.get(s.employeeId) || "Unknown",
        hoursUntilDue: Math.round((new Date(s.dueDate!).getTime() - now) / 3600000),
      }));
  } catch (err) {
    logger.warn({ err, orgId }, "Failed to get due-soon sessions");
    return [];
  }
}

/**
 * Check for overdue coaching sessions.
 */
export async function getOverdueSessions(
  orgId: string,
): Promise<Array<{ session: CoachingSession; employeeName: string; daysOverdue: number }>> {
  try {
    const sessions = await storage.getAllCoachingSessions(orgId);
    const employees = await storage.getAllEmployees(orgId);
    const empMap = new Map(employees.map((e) => [e.id, e.name]));
    const now = Date.now();

    return sessions
      .filter((s) => {
        if (s.status === "completed" || s.status === "dismissed" || !s.dueDate) return false;
        return new Date(s.dueDate).getTime() < now;
      })
      .map((s) => ({
        session: s,
        employeeName: empMap.get(s.employeeId) || "Unknown",
        daysOverdue: Math.round((now - new Date(s.dueDate!).getTime()) / 86400000),
      }));
  } catch (err) {
    logger.warn({ err, orgId }, "Failed to get overdue sessions");
    return [];
  }
}
