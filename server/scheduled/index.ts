/**
 * Scheduled task exports.
 * Each task is an async function that takes IStorage as its first parameter,
 * with an optional pre-fetched org list to avoid redundant listOrganizations() calls.
 */
import type { IStorage } from "../storage/types";
import { logger } from "../services/logger";

export { runRetention } from "./retention";
export { runTrialDowngrade } from "./trial-downgrade";
export { runQuotaAlerts } from "./quota-alerts";
export { runWeeklyDigest } from "./weekly-digest";
export { runAuditChainVerify } from "./audit-chain-verify";
export { runCoachingScheduledTasks } from "./coaching-tasks";
export { runPostProcessingReconciliation } from "./post-processing-reconciliation";
export {
  runScheduledReportsTask,
  startScheduledReportsHourlyTick,
  runScheduledReportsCatchUp,
} from "./scheduled-reports-tick";
export { runScoringQualityTasks } from "./scoring-quality-tasks";
export { scheduleDaily, scheduleWeekly, scheduleHourly } from "./scheduler";

// Re-import for orchestrator use
import { runRetention } from "./retention";
import { runTrialDowngrade } from "./trial-downgrade";
import { runQuotaAlerts } from "./quota-alerts";
import { runWeeklyDigest } from "./weekly-digest";
import { runAuditChainVerify } from "./audit-chain-verify";
import { runCoachingScheduledTasks } from "./coaching-tasks";
import { runPostProcessingReconciliation } from "./post-processing-reconciliation";
import { runScoringQualityTasks } from "./scoring-quality-tasks";

interface DailyTaskOptions {
  queuesReady: boolean;
  defaultRetentionDays: number;
}

/**
 * Default per-task timeout. Any single scheduled task that takes longer than
 * this is treated as hung and the orchestrator moves on to the next task.
 * See F-14 in broad-scan audit — previously a hung task silently blocked all
 * downstream tasks (quota alerts, trial downgrade, weekly digest, etc.).
 */
const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const RETENTION_TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — purges calls + S3 audio

/** Error class for task timeouts so we can distinguish them from task-thrown errors in logs. */
class ScheduledTaskTimeoutError extends Error {
  constructor(taskName: string, timeoutMs: number) {
    super(`Scheduled task '${taskName}' timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "ScheduledTaskTimeoutError";
  }
}

/**
 * Wrap a task in a Promise.race with a timeout. Rejects with ScheduledTaskTimeoutError
 * if the task doesn't resolve within timeoutMs. Note: JavaScript promises cannot be
 * cancelled, so a hung task's work continues in the background until it resolves or
 * the process exits. The orchestrator moves on so downstream tasks still run.
 */
function withTaskTimeout<T>(taskName: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ScheduledTaskTimeoutError(taskName, timeoutMs)), timeoutMs);
  });
  return Promise.race([
    fn().finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeoutPromise,
  ]);
}

/**
 * Run all daily scheduled tasks with a single listOrganizations() call.
 * Replaces 6 separate org list fetches with 1.
 */
export async function runAllDailyTasks(storage: IStorage, opts: DailyTaskOptions): Promise<void> {
  let orgs: any[];
  try {
    orgs = await storage.listOrganizations();
  } catch (err) {
    logger.error({ err }, "Failed to list organizations for scheduled tasks");
    return;
  }

  const retentionOpts = { queuesReady: opts.queuesReady, defaultRetentionDays: opts.defaultRetentionDays };

  // Run tasks in sequence to avoid thundering herd on DB.
  // Each task is individually wrapped with a timeout AND a try/catch so that
  // (a) a hung task can't silently block downstream tasks, and (b) a thrown
  // task doesn't prevent the rest from running. See F-14 in broad-scan audit.
  const tasks: Array<{ name: string; timeoutMs: number; fn: () => Promise<void | unknown> }> = [
    {
      name: "retention",
      timeoutMs: RETENTION_TASK_TIMEOUT_MS,
      fn: () => runRetention(storage, retentionOpts, orgs),
    },
    { name: "trial-downgrade", timeoutMs: DEFAULT_TASK_TIMEOUT_MS, fn: () => runTrialDowngrade(storage, orgs) },
    { name: "quota-alerts", timeoutMs: DEFAULT_TASK_TIMEOUT_MS, fn: () => runQuotaAlerts(storage, orgs) },
    { name: "audit-chain-verify", timeoutMs: DEFAULT_TASK_TIMEOUT_MS, fn: () => runAuditChainVerify(storage, orgs) },
    { name: "coaching-tasks", timeoutMs: DEFAULT_TASK_TIMEOUT_MS, fn: () => runCoachingScheduledTasks(storage, orgs) },
    { name: "post-processing-reconciliation", timeoutMs: DEFAULT_TASK_TIMEOUT_MS, fn: () => runPostProcessingReconciliation(storage, orgs) },
    // Tier 2: scoring-feedback quality + regression checks (per-org)
    { name: "scoring-quality-tasks", timeoutMs: DEFAULT_TASK_TIMEOUT_MS, fn: () => runScoringQualityTasks(storage, orgs) },
  ];

  for (const task of tasks) {
    const startedAt = Date.now();
    try {
      await withTaskTimeout(task.name, task.timeoutMs, task.fn);
      logger.info({ task: task.name, durationMs: Date.now() - startedAt }, `Scheduled task '${task.name}' completed`);
    } catch (err) {
      if (err instanceof ScheduledTaskTimeoutError) {
        logger.error(
          { task: task.name, timeoutMs: task.timeoutMs, durationMs: Date.now() - startedAt },
          `Scheduled task '${task.name}' TIMED OUT — hung task may still be running in background, downstream tasks continuing`,
        );
      } else {
        logger.error(
          { err, task: task.name, durationMs: Date.now() - startedAt },
          `Scheduled task '${task.name}' failed — continuing with remaining tasks`,
        );
      }
    }
  }
}
