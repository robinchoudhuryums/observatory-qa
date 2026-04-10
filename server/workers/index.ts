/**
 * Worker process entry point.
 *
 * Starts all BullMQ workers for background job processing.
 * Run separately from the web server:
 *
 *   npx tsx server/workers/index.ts
 *
 * Or in production:
 *
 *   node dist/workers.js
 *
 * Requires REDIS_URL to be set. Optionally requires DATABASE_URL
 * for PostgreSQL storage (otherwise falls back to in-memory).
 */
import { getQueueConnection, initQueues } from "../services/queue";
import { logger } from "../services/logger";
import { createRetentionWorker } from "./retention.worker";
import { createUsageWorker } from "./usage.worker";
import { createReanalysisWorker } from "./reanalysis.worker";
import { createIndexingWorker } from "./indexing.worker";
import { createEhrNotePushWorker } from "./ehr-note-push.worker";
import { startEhrHealthMonitor } from "../services/ehr/health-monitor";
import type { Worker } from "bullmq";

async function main() {
  logger.info("Starting worker processes...");

  // Initialize queues (to get connection config)
  const queuesReady = initQueues();
  if (!queuesReady) {
    logger.error("REDIS_URL is required for worker processes. Exiting.");
    process.exit(1);
  }

  const connection = getQueueConnection();
  if (!connection) {
    logger.error("Failed to get queue connection. Exiting.");
    process.exit(1);
  }

  // Initialize storage (PostgreSQL if available, otherwise MemStorage)
  const { initPostgresStorage } = await import("../storage/index");
  const pgReady = await initPostgresStorage();
  if (pgReady) {
    logger.info("Workers using PostgreSQL storage backend");
  } else {
    logger.warn("Workers using in-memory storage (not recommended for production)");
  }

  const getStorage = () => {
    // Dynamically import to get the latest storage instance (may be swapped on init)
    const { storage } = require("../storage/index");
    return storage;
  };

  const workers: Worker[] = [];

  // 1. Data retention worker
  const retentionWorker = createRetentionWorker(connection, getStorage);
  workers.push(retentionWorker);
  logger.info("Data retention worker started");

  // 2. Usage metering worker
  const usageWorker = createUsageWorker(connection, () => {
    const storage = getStorage();
    return {
      async recordUsageEvent(event: {
        orgId: string;
        eventType: string;
        quantity: number;
        metadata?: Record<string, unknown>;
      }) {
        // Store usage event — uses the storage layer
        // For now, log it; full implementation writes to usage_events table
        if ("recordUsageEvent" in storage) {
          await (storage as any).recordUsageEvent(event);
        } else {
          logger.info({ usage: event }, "Usage event recorded (no storage method available)");
        }
      },
    };
  });
  workers.push(usageWorker);
  logger.info("Usage metering worker started");

  // 3. Bulk reanalysis worker
  const reanalysisWorker = createReanalysisWorker(
    connection,
    getStorage,
    () => {
      const { aiProvider } = require("../services/ai-factory");
      return aiProvider;
    },
    () => {
      const { assemblyAIService } = require("../services/assemblyai");
      return assemblyAIService;
    },
  );
  workers.push(reanalysisWorker);
  logger.info("Bulk reanalysis worker started");

  // 4. Document RAG indexing worker
  const indexingWorker = createIndexingWorker(connection);
  workers.push(indexingWorker);
  logger.info("Document indexing worker started");

  // 5. EHR note push retry worker
  const ehrNotePushWorker = createEhrNotePushWorker(connection, getStorage);
  workers.push(ehrNotePushWorker);
  logger.info("EHR note push retry worker started");

  // Start EHR health monitor (periodic connection checks + alerting)
  const healthMonitorInterval = startEhrHealthMonitor();

  // Register error handlers on all workers for Redis disconnection/errors.
  // Without these, workers hang indefinitely on Redis drop with no logging.
  for (const w of workers) {
    w.on("error", (err) => {
      logger.error({ err, workerName: w.name }, "Worker error (possible Redis disconnection)");
    });
  }

  logger.info({ count: workers.length }, "All workers started. Waiting for jobs...");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down workers...");
    clearInterval(healthMonitorInterval);
    await Promise.all(workers.map((w) => w.close()));
    logger.info("All workers stopped");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "Worker process failed to start");
  process.exit(1);
});
