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
export { scheduleDaily, scheduleWeekly } from "./scheduler";

// Re-import for orchestrator use
import { runRetention } from "./retention";
import { runTrialDowngrade } from "./trial-downgrade";
import { runQuotaAlerts } from "./quota-alerts";
import { runWeeklyDigest } from "./weekly-digest";
import { runAuditChainVerify } from "./audit-chain-verify";
import { runCoachingScheduledTasks } from "./coaching-tasks";

interface DailyTaskOptions {
  queuesReady: boolean;
  defaultRetentionDays: number;
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
  // Each task is individually wrapped so a failure in one doesn't prevent the rest from running.
  const tasks: Array<{ name: string; fn: () => Promise<void> }> = [
    { name: "retention", fn: () => runRetention(storage, retentionOpts, orgs) },
    { name: "trial-downgrade", fn: () => runTrialDowngrade(storage, orgs) },
    { name: "quota-alerts", fn: () => runQuotaAlerts(storage, orgs) },
    { name: "audit-chain-verify", fn: () => runAuditChainVerify(storage, orgs) },
    { name: "coaching-tasks", fn: () => runCoachingScheduledTasks(storage, orgs) },
  ];

  for (const task of tasks) {
    try {
      await task.fn();
    } catch (err) {
      logger.error({ err, task: task.name }, `Scheduled task '${task.name}' failed — continuing with remaining tasks`);
    }
  }
}
