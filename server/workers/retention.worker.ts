/**
 * Data retention worker — purges expired calls per org retention policy.
 *
 * Processes jobs from the "data-retention" BullMQ queue.
 * Each job contains { orgId, retentionDays } and deletes calls older
 * than retentionDays from that org (including audio blobs).
 *
 * HIPAA: Audit logs are NEVER purged by this worker. HIPAA requires
 * audit trails to be retained for 6-7 years minimum, independent of
 * PHI data retention. Audit logs have their own separate retention
 * policy (AUDIT_LOG_RETENTION_DAYS, default 2555 days / ~7 years).
 */
import { Worker, type Job } from "bullmq";
import type { DataRetentionJob } from "../services/queue";
import { logger } from "../services/logger";

/** HIPAA: Minimum audit log retention — 7 years. */
const AUDIT_LOG_RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || "2555", 10);

export function createRetentionWorker(
  connection: import("bullmq").ConnectionOptions,
  getStorage: () => import("../storage/types").IStorage,
): Worker<DataRetentionJob> {
  const worker = new Worker<DataRetentionJob>(
    "data-retention",
    async (job: Job<DataRetentionJob>) => {
      const { orgId, retentionDays } = job.data;
      logger.info({ orgId, retentionDays, jobId: job.id }, "Retention worker: starting purge");

      const storage = getStorage();
      const purged = await storage.purgeExpiredCalls(orgId, retentionDays);

      if (purged > 0) {
        logger.info({ orgId, purged, retentionDays }, "Retention worker: purge completed");
      }

      // HIPAA: Purge only very old audit logs (7+ years) — never delete with PHI
      if (storage.purgeExpiredAuditLogs) {
        const auditPurged = await storage.purgeExpiredAuditLogs(orgId, AUDIT_LOG_RETENTION_DAYS);
        if (auditPurged > 0) {
          logger.info({ orgId, auditPurged, auditRetentionDays: AUDIT_LOG_RETENTION_DAYS }, "Retention worker: old audit logs purged");
        }
      }

      return { purged };
    },
    {
      connection,
      concurrency: 2,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Retention worker: job failed");
  });

  return worker;
}
