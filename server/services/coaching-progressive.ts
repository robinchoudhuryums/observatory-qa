/**
 * Multi-week progressive coaching plan generator.
 *
 * Tier 1C of the CallAnalyzer adaptation plan. Adapted from CA's
 * `coaching-alerts.ts:generateRecurringWeaknessAIPlan` — produces a
 * structured week-by-week plan (week 1 = awareness, week 2+ = practice
 * + application) rather than a flat task list.
 *
 * The flat-list version already exists in OQ as `generateCoachingPlan`
 * in `coaching-engine.ts`. This module is the multi-week complement,
 * intended for use when an automation rule fires for recurring weakness
 * (e.g., 3+ low calls in the same sub-score dimension).
 *
 * PHI: call summaries are PHI-redacted via the project's `redactPhi`
 * utility before they reach Bedrock. Defense-in-depth on top of the
 * AWS BAA for the prompt cache.
 */
import { aiProvider } from "./ai-factory";
import { storage } from "../storage";
import { logger } from "./logger";
import { redactPhi } from "../utils/phi-redactor";

export interface ProgressivePlanResult {
  tasks: string[];
  notes: string;
}

export interface WeaknessContext {
  /** Sub-score dimension key (compliance, customerExperience, communication, resolution). */
  dim: string;
  /** Human-readable label for the dimension. */
  label: string;
  /** Average sub-score across the weak calls. */
  avgScore: number;
  /** Number of weak calls in the lookback window. */
  count: number;
}

/**
 * Generate a multi-week progressive coaching plan via Bedrock.
 * Returns null if Bedrock is unavailable or the response can't be parsed.
 *
 * The returned `tasks` array is structured for direct use as a coaching
 * session's actionPlan — week headings are interleaved with tasks so a
 * simple `tasks.map(t => ({ task: t, completed: false }))` produces a
 * usable plan.
 */
export async function generateProgressivePlan(
  orgId: string,
  employeeId: string,
  primary: WeaknessContext,
  options: {
    secondaryWeaknesses?: WeaknessContext[];
    callSummaries?: string[];
    totalCallsAnalyzed?: number;
  } = {},
): Promise<ProgressivePlanResult | null> {
  if (!aiProvider.isAvailable || !aiProvider.generateText) {
    logger.debug({ orgId, employeeId }, "Bedrock unavailable — skipping progressive plan generation");
    return null;
  }

  let employeeName = "the agent";
  try {
    const emp = await storage.getEmployee(orgId, employeeId);
    if (emp?.name) employeeName = emp.name;
  } catch {
    /* fallback to generic agent */
  }

  const { secondaryWeaknesses = [], callSummaries = [], totalCallsAnalyzed = primary.count } = options;

  // PHI redaction at the prompt boundary. Aggregate metrics + employee
  // names are not PHI (workforce, not patients), but call summaries may
  // contain transcribed patient information — redact before Bedrock.
  const safeSummaries = callSummaries.map((s) => redactPhi(s));

  const otherWeaknesses = secondaryWeaknesses
    .map((d) => `${d.label}: avg ${d.avgScore.toFixed(1)}/10 (${d.count} weak calls)`)
    .join("\n  ");

  const summaryContext =
    safeSummaries.length > 0
      ? `\nRecent low-scoring call summaries (PHI-redacted):\n${safeSummaries.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`
      : "";

  const prompt = `You are a quality assurance coach. An agent has a recurring weakness pattern detected across their recent calls. Generate a targeted, multi-week coaching plan.

AGENT: ${employeeName}
PRIMARY WEAKNESS: ${primary.label}
  Average sub-score: ${primary.avgScore.toFixed(1)}/10 across ${primary.count} of the last ${totalCallsAnalyzed} calls
${otherWeaknesses ? `SECONDARY WEAKNESSES:\n  ${otherWeaknesses}` : ""}
${summaryContext}

Respond in this exact JSON format only, with no additional text:
{
  "coaching_summary": "A 3-4 sentence analysis explaining the pattern, likely root cause, and recommended approach.",
  "weekly_plan": [
    { "week": 1, "focus": "Brief focus area", "tasks": ["Specific task 1", "Specific task 2"] },
    { "week": 2, "focus": "Brief focus area", "tasks": ["Specific task 1", "Specific task 2"] }
  ]
}

Requirements:
- Generate a 2-3 week plan with 2-3 tasks per week
- Tasks should be progressive (build on each other)
- Week 1: awareness and review (listen to recordings, identify patterns)
- Week 2+: practice and application (role-play, shadowing, real calls)
- Reference the specific weakness dimension (${primary.label})
- Each task should be under 100 characters and actionable`;

  let response: string;
  try {
    response = await aiProvider.generateText(prompt);
  } catch (err) {
    logger.warn({ err, orgId, employeeId }, "Bedrock call failed for progressive coaching plan");
    return null;
  }

  let parsed: { coaching_summary?: unknown; weekly_plan?: Array<{ week?: number; focus?: string; tasks?: unknown[] }> };
  try {
    const cleaned = response
      .replace(/```json?\s*/g, "")
      .replace(/```/g, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    logger.warn({ err, orgId, employeeId }, "Failed to parse progressive coaching plan response");
    return null;
  }

  if (!Array.isArray(parsed.weekly_plan) || parsed.weekly_plan.length === 0) {
    logger.warn({ orgId, employeeId }, "Progressive plan response missing weekly_plan");
    return null;
  }

  const tasks: string[] = [];
  for (const week of parsed.weekly_plan) {
    if (week.focus && week.week !== undefined) {
      tasks.push(`Week ${week.week}: ${week.focus}`);
    }
    if (Array.isArray(week.tasks)) {
      for (const task of week.tasks) {
        if (typeof task === "string") tasks.push(task);
      }
    }
  }
  if (tasks.length === 0) {
    logger.warn({ orgId, employeeId }, "Progressive plan parsed but contained no usable tasks");
    return null;
  }

  // Always append a follow-up evaluation step.
  tasks.push(`Follow-up: re-evaluate ${primary.label.toLowerCase()} after completing plan`);

  const notes =
    typeof parsed.coaching_summary === "string" && parsed.coaching_summary.trim().length > 0
      ? parsed.coaching_summary
      : `Pattern detected: ${primary.count} of the last ${totalCallsAnalyzed} calls weak in ${primary.label}.`;

  return {
    tasks: tasks.slice(0, 12),
    notes,
  };
}

/**
 * Convert a ProgressivePlanResult into the actionPlan shape expected by
 * `storage.createCoachingSession({ actionPlan: ... })`. Convenience helper
 * for callers that want to drop the result straight into a session.
 */
export function progressivePlanToActionPlan(result: ProgressivePlanResult): Array<{ task: string; completed: false }> {
  return result.tasks.map((task) => ({ task, completed: false as const }));
}
