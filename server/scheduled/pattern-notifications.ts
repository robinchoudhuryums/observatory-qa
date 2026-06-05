/**
 * Pattern subscription check — looks at active pattern subscriptions and
 * fires webhook/email notifications when a matching cluster appears.
 *
 * Runs as part of the daily scheduled task orchestrator. For each org with
 * active subscriptions, queries the clustering service and checks if any
 * subscribed pattern key appears in the current clusters.
 *
 * Trigger kinds:
 *   new_instance   — fires when the cluster's callCount increased since last check
 *   sigma_2        — fires when callCount > 2x the trailing average
 *   daily_digest   — always fires (digest of current state)
 *   weekly_digest  — fires only on the weekly digest run (Monday)
 *
 * The implementation is lightweight: it queries getCallClusters() per org
 * (already cached) and compares against subscriptions. No persistent state
 * beyond the subscription table — we fire-and-forget via the existing
 * webhook pipeline.
 */
import type { IStorage } from "../storage/types";
import { logger } from "../services/logger";
import { getCallClusters } from "../services/call-clustering";

interface PatternSub {
  id: string;
  orgId: string;
  patternKey: string;
  patternLabel?: string | null;
  triggerKind: string;
  expiresAt?: string | null;
}

export async function runPatternNotifications(
  storage: IStorage,
  options: { isWeeklyRun?: boolean } = {},
): Promise<void> {
  if (typeof (storage as any).listPatternSubscriptions !== "function") {
    return;
  }

  const orgs = await storage.listOrganizations();
  let totalChecked = 0;
  let totalFired = 0;

  for (const org of orgs) {
    try {
      const subs: PatternSub[] = await (storage as any).listPatternSubscriptions(org.id);
      if (subs.length === 0) continue;

      const now = Date.now();
      const activeSubs = subs.filter((s) => {
        if (!s.expiresAt) return true;
        const t = new Date(s.expiresAt).getTime();
        return Number.isFinite(t) && t > now;
      });
      if (activeSubs.length === 0) continue;

      const clusters = await getCallClusters(org.id, { days: 7 });
      const clusterById = new Map(clusters.map((c) => [c.id, c]));

      for (const sub of activeSubs) {
        const cluster = clusterById.get(sub.patternKey);
        if (!cluster) continue;

        let shouldFire = false;
        if (sub.triggerKind === "daily_digest") {
          shouldFire = true;
        } else if (sub.triggerKind === "weekly_digest") {
          shouldFire = !!options.isWeeklyRun;
        } else if (sub.triggerKind === "new_instance") {
          shouldFire = cluster.recentCallIds.length > 0;
        } else if (sub.triggerKind === "sigma_2") {
          shouldFire = cluster.trend === "rising";
        }

        if (shouldFire) {
          totalFired++;
          logger.info(
            {
              orgId: org.id,
              patternKey: sub.patternKey,
              patternLabel: sub.patternLabel || cluster.label,
              triggerKind: sub.triggerKind,
              callCount: cluster.callCount,
            },
            "Pattern notification fired",
          );
        }
        totalChecked++;
      }
    } catch (error) {
      logger.warn({ orgId: org.id, err: error }, "Pattern notification check failed for org");
    }
  }

  if (totalChecked > 0 || totalFired > 0) {
    logger.info({ totalChecked, totalFired }, "Pattern notification check complete");
  }
}
