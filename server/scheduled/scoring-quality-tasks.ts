/**
 * Scheduled task: scoring quality + regression checks.
 *
 * Tier 2 of the CallAnalyzer adaptation plan. Wraps the two scoring-feedback
 * analyses into a single daily task:
 *
 *   1. runScoringQualityChecks — high-correction-rate + systematic-bias detection
 *      (Tier 2C, server/services/scoring-feedback-alerts.ts)
 *   2. runScoringRegressionChecks — week-over-week mean shift detection
 *      (Tier 2D, server/services/scoring-feedback-regression.ts)
 *
 * Both run sequentially per org. Alerts are logged and posted to Slack/Teams
 * via the project's existing notifications service when present; the alerts
 * are also exposed via the GET /api/scoring-corrections/quality-alerts admin
 * endpoint for on-demand inspection.
 *
 * Designed to be added to runAllDailyTasks in server/scheduled/index.ts.
 * Each phase is independently try/caught so a regression-detection failure
 * doesn't starve quality-checks (and vice versa).
 */
import type { IStorage } from "../storage/types";
import { logger } from "../services/logger";
import { runScoringQualityChecks, type ScoringQualityAlert } from "../services/scoring-feedback-alerts";
import { runScoringRegressionChecks } from "../services/scoring-feedback-regression";

/**
 * One daily cycle: quality checks + regression checks across all orgs.
 *
 * Returns aggregate counts so the scheduler orchestrator can log a single
 * line summarizing the cycle.
 */
export async function runScoringQualityTasks(
  _storage: IStorage,
  _orgs?: unknown[],
): Promise<{
  qualityAlertCount: number;
  regressionAlertCount: number;
  totalAlerts: number;
}> {
  let qualityAlerts: ScoringQualityAlert[] = [];
  let regressionAlertCount = 0;

  // Phase 1: correction-rate + systematic-bias checks (per org).
  try {
    qualityAlerts = await runScoringQualityChecks();
  } catch (err) {
    logger.error({ err }, "scoring-quality-tasks: quality-checks phase failed");
  }

  // Phase 2: week-over-week regression (per org).
  try {
    const regressionResults = await runScoringRegressionChecks();
    for (const r of regressionResults) {
      if (r.alert) regressionAlertCount++;
    }
  } catch (err) {
    logger.error({ err }, "scoring-quality-tasks: regression-checks phase failed");
  }

  const totalAlerts = qualityAlerts.length + regressionAlertCount;
  if (totalAlerts > 0) {
    logger.warn(
      { qualityAlertCount: qualityAlerts.length, regressionAlertCount, totalAlerts },
      "scoring-quality-tasks: alerts generated this cycle",
    );

    // Best-effort Slack/Teams notification when the existing notifications
    // service is configured. Lazy-import so this module doesn't pull in
    // notifications.ts at boot time even when the feature isn't in use.
    if (qualityAlerts.length > 0 || regressionAlertCount > 0) {
      try {
        const { sendSlackNotification } = await import("../services/notifications");
        const summary = [
          "*Scoring quality alerts (last 7 days)*",
          ...qualityAlerts.map((a) => `• [${a.severity}] org ${a.orgId}: ${a.message}`),
          regressionAlertCount > 0
            ? `• Regression detected in ${regressionAlertCount} org(s) (week-over-week mean shift ≥ 0.8)`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
        await sendSlackNotification({ channel: "alerts", text: summary, blocks: [] });
      } catch (err) {
        // Non-critical — quality alerts still surface in logs and via the
        // admin /api/scoring-corrections/quality-alerts endpoint.
        logger.debug(
          { err },
          "scoring-quality-tasks: notification dispatch skipped (notifications service unavailable or not configured)",
        );
      }
    }
  }

  return {
    qualityAlertCount: qualityAlerts.length,
    regressionAlertCount,
    totalAlerts,
  };
}
