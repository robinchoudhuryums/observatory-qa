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

  // Run tasks in sequence to avoid thundering herd on DB
  await runRetention(storage, retentionOpts, orgs);
  await runTrialDowngrade(storage, orgs);
  await runQuotaAlerts(storage, orgs);
  await runAuditChainVerify(storage, orgs);
  await runCoachingScheduledTasks(storage, orgs);
}
