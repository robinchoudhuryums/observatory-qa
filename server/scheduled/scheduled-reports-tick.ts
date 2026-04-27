/**
 * Scheduled task: hourly scheduled-reports tick + delivery.
 *
 * Tier 0.5 of the CallAnalyzer adaptation plan. Wraps the two scheduled-
 * reports operations into a single hourly task:
 *
 *   1. runScheduledReportsTick() — generate any reports that became due in
 *      the last hour (idempotent via UNIQUE constraint).
 *   2. deliverPendingReports() — email any reports with status="generated"
 *      to their configured recipients (idempotent via status transitions).
 *
 * Boot-time catch-up (catchUpReports) is intentionally NOT included here —
 * call it from the server bootstrap once after DB init. See the wire-up
 * note at the bottom of this file.
 *
 * Wrapped in this file so the orchestrator / boot script can register one
 * function rather than two.
 */
import type { IStorage } from "../storage/types";
import { logger } from "../services/logger";
import {
  runScheduledReportsTick,
  deliverPendingReports,
  catchUpReports,
} from "../services/scheduled-reports";
import { scheduleHourly } from "./scheduler";

/**
 * One hourly cycle: generate due reports, then deliver any pending.
 *
 * Both phases are independently try/caught so a delivery failure doesn't
 * starve generation, and vice versa. Returns aggregate counts so callers
 * can log a single line summarizing the cycle.
 */
export async function runScheduledReportsTask(
  _storage?: IStorage,
  _orgs?: unknown[],
): Promise<{
  generated: { checked: number; generated: number; failed: number };
  delivered: { pending: number; sent: number; failed: number };
}> {
  // Phase 1: generate due reports for all enabled configs.
  let generated = { checked: 0, generated: 0, failed: 0 };
  try {
    generated = await runScheduledReportsTick();
  } catch (err) {
    logger.error({ err }, "scheduled-reports-tick: generation phase failed");
  }

  // Phase 2: deliver any reports that were generated (this hour or earlier).
  let delivered = { pending: 0, sent: 0, failed: 0 };
  try {
    delivered = await deliverPendingReports();
  } catch (err) {
    logger.error({ err }, "scheduled-reports-tick: delivery phase failed");
  }

  logger.info(
    {
      checked: generated.checked,
      generated: generated.generated,
      genFailed: generated.failed,
      pending: delivered.pending,
      sent: delivered.sent,
      sendFailed: delivered.failed,
    },
    "scheduled-reports-tick complete",
  );

  return { generated, delivered };
}

/**
 * Register the scheduled-reports tick to fire at the top of every UTC hour.
 *
 * Returns a cleanup function that cancels the schedule. Idempotent — safe
 * to call multiple times during testing (each call returns its own cleanup).
 *
 * Call this from server bootstrap AFTER DB initialization. Recommended:
 *
 *   import { startScheduledReportsHourlyTick } from "./scheduled/scheduled-reports-tick";
 *   const stopReportsTick = startScheduledReportsHourlyTick();
 *   // On shutdown: stopReportsTick();
 */
export function startScheduledReportsHourlyTick(): () => void {
  return scheduleHourly(runScheduledReportsTask, "scheduled-reports-tick");
}

/**
 * Boot-time catch-up across all orgs with enabled configs. Walks the
 * configured orgs and backfills the last 12 weeks/months of missed reports
 * for each (bounded by catchUpReports' internal cap).
 *
 * Call from server bootstrap AFTER DB initialization but BEFORE the first
 * hourly tick fires. Non-blocking — designed to be fire-and-forget so it
 * doesn't delay server startup.
 */
export async function runScheduledReportsCatchUp(storage: IStorage): Promise<void> {
  try {
    const orgs = await storage.listOrganizations();
    let totalGenerated = 0;
    let totalSkipped = 0;

    for (const org of orgs) {
      try {
        const result = await catchUpReports(org.id);
        totalGenerated += result.generated;
        totalSkipped += result.skipped;
      } catch (orgErr) {
        logger.warn(
          { err: orgErr, orgId: org.id },
          "scheduled-reports catch-up failed for org",
        );
      }
    }

    logger.info(
      { orgs: orgs.length, generated: totalGenerated, skipped: totalSkipped },
      "scheduled-reports boot catch-up complete",
    );
  } catch (err) {
    logger.error({ err }, "scheduled-reports catch-up failed");
  }
}
