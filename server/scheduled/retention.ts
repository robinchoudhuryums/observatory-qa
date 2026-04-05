/**
 * Scheduled task: Data retention purge.
 * Purges expired calls per org's retentionDays setting.
 */
import type { IStorage } from "../storage/types";
import { enqueueRetention } from "../services/queue";
import { logger } from "../services/logger";

interface RetentionOptions {
  queuesReady: boolean;
  defaultRetentionDays: number;
}

export async function runRetention(storage: IStorage, opts: RetentionOptions, orgs?: any[]): Promise<void> {
  try {
    if (!orgs) orgs = await storage.listOrganizations();
    let totalPurged = 0;
    for (const org of orgs) {
      const orgRetention = org.settings?.retentionDays ?? opts.defaultRetentionDays;

      // Use job queue if available (non-blocking, durable)
      if (opts.queuesReady) {
        await enqueueRetention(org.id, orgRetention);
      } else {
        // Fallback: run inline
        const purged = await storage.purgeExpiredCalls(org.id, orgRetention);
        if (purged > 0) {
          const { logPhiAccess } = await import("../services/audit-log");
          logPhiAccess({
            orgId: org.id,
            userId: "system",
            username: "system:retention",
            role: "admin",
            ip: "localhost",
            userAgent: "retention-scheduler",
            event: "data_retention_purge",
            resourceType: "call",
            detail: `Purged ${purged} calls older than ${orgRetention} days`,
          });
          logger.info({ org: org.slug, purged, retentionDays: orgRetention }, "Retention purge completed");
          totalPurged += purged;
        }
      }
    }
    if (!opts.queuesReady && totalPurged > 0) {
      logger.info({ totalPurged }, "Retention purge complete across all orgs");
    }
  } catch (error) {
    logger.error({ err: error }, "Error during retention purge");
  }
}
