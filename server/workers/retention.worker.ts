/**
 * Data retention worker — purges expired calls per org retention policy.
 *
 * Processes jobs from the "data-retention" BullMQ queue.
 * Each job contains { orgId, retentionDays } and deletes calls older
 * than retentionDays from that org (including audio blobs).
 */
import { Worker, type Job } from "bullmq";
import type { DataRetentionJob } from "../services/queue";
import { logger } from "../services/logger";

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
