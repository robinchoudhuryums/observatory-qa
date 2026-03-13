/**
 * Usage metering worker — records per-org usage events for billing/analytics.
 *
 * Processes jobs from the "usage-metering" BullMQ queue.
 * Each job contains { orgId, eventType, quantity, metadata } and writes
 * the event to the usage_events table.
 */
import { Worker, type Job } from "bullmq";
import type { UsageMeteringJob } from "../services/queue";
import { logger } from "../services/logger";

export interface UsageStorageClient {
  recordUsageEvent(event: {
    orgId: string;
    eventType: string;
    quantity: number;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export function createUsageWorker(
  connection: import("bullmq").ConnectionOptions,
  getStorageClient: () => UsageStorageClient,
): Worker<UsageMeteringJob> {
  const worker = new Worker<UsageMeteringJob>(
    "usage-metering",
    async (job: Job<UsageMeteringJob>) => {
      const { orgId, eventType, quantity, metadata } = job.data;
      const client = getStorageClient();

      await client.recordUsageEvent({ orgId, eventType, quantity, metadata });

      logger.debug({ orgId, eventType, quantity }, "Usage event recorded");
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Usage worker: job failed");
  });

  return worker;
}
