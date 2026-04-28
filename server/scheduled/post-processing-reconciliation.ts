/**
 * Post-processing reconciliation — finds completed calls that are missing
 * expected post-processing artifacts (usage records, notifications) and
 * re-runs the missing steps.
 *
 * Background: After a call is successfully committed (transcript + sentiment +
 * analysis stored atomically), postProcessing() runs for notifications, usage
 * tracking, coaching recommendations, and gamification. This is intentionally
 * wrapped in try/catch (see F-44) so failures don't mark the call as "failed."
 * But without a compensating mechanism, missed post-processing is permanent
 * data loss.
 *
 * This reconciliation job runs daily and fills the gap by detecting calls
 * that completed >1 hour ago but have no usage records.
 */
import type { IStorage } from "../storage/types";
import { logger } from "../services/logger";

/**
 * Find completed calls with missing usage records and re-track them.
 * Only processes calls completed >1 hour ago (avoids racing with in-flight
 * post-processing) and <48 hours ago (avoids reprocessing ancient data).
 */
export async function runPostProcessingReconciliation(
  storage: IStorage,
  orgs?: Array<{ id: string; name: string; slug: string }>,
): Promise<void> {
  const orgList = orgs || (await storage.listOrganizations());
  const now = Date.now();
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

  let totalReconciled = 0;
  let totalOrgsChecked = 0;

  for (const org of orgList) {
    try {
      // Get recently completed calls
      const calls = await storage.getCallSummaries(org.id, { status: "completed" });
      if (!calls || calls.length === 0) continue;
      totalOrgsChecked++;

      // Filter to calls completed 1-48 hours ago
      const candidates = calls.filter((c) => {
        const completedAt = c.uploadedAt ? new Date(c.uploadedAt).getTime() : 0;
        const age = now - completedAt;
        return age > ONE_HOUR_MS && age < TWO_DAYS_MS;
      });

      if (candidates.length === 0) continue;

      // Get usage records for this org in the current period
      const periodStart = new Date(now - TWO_DAYS_MS);
      const usageSummary = await storage.getUsageSummary(org.id, periodStart);
      const trackedCallIds = new Set<string>();

      // Check individual usage records to find which calls have been tracked
      try {
        const usageRecords = await storage.getUsageRecords(org.id);
        for (const record of usageRecords) {
          if (record.callId) trackedCallIds.add(record.callId);
        }
      } catch {
        // getUsageRecords may not be available on all backends — skip this org
        continue;
      }

      // Find calls missing usage records
      const missingUsage = candidates.filter((c) => !trackedCallIds.has(c.id));

      if (missingUsage.length === 0) continue;

      // Re-track usage for missing calls (capped at 50 per org per run)
      const toReconcile = missingUsage.slice(0, 50);
      let reconciled = 0;

      for (const call of toReconcile) {
        try {
          const { trackUsage } = await import("../services/queue");
          trackUsage({
            orgId: org.id,
            eventType: "transcription",
            quantity: 1,
            metadata: { callId: call.id, reconciled: true },
          });
          // Track AI analysis usage if the call has analysis
          if (call.analysis?.performanceScore != null) {
            trackUsage({
              orgId: org.id,
              eventType: "ai_analysis",
              quantity: 1,
              metadata: { callId: call.id, reconciled: true },
            });
          }
          reconciled++;
        } catch (err) {
          logger.warn(
            { callId: call.id, orgId: org.id, err },
            "Post-processing reconciliation: failed to re-track usage for call",
          );
        }
      }

      if (reconciled > 0) {
        totalReconciled += reconciled;
        logger.info(
          { orgId: org.id, reconciled, total: missingUsage.length },
          "Post-processing reconciliation: re-tracked usage for calls with missing records",
        );
      }
    } catch (err) {
      logger.warn({ orgId: org.id, err }, "Post-processing reconciliation: org processing failed");
    }
  }

  if (totalReconciled > 0) {
    logger.info({ totalReconciled, orgsChecked: totalOrgsChecked }, "Post-processing reconciliation complete");
  }
}
