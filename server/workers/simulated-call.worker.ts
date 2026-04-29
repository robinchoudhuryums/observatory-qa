/**
 * BullMQ worker for the Simulated Call Generator pipeline.
 *
 * Runs the TTS rewrite → ElevenLabs → ffmpeg-concat → S3 upload chain.
 * On retryable failure (network blip, 429), BullMQ re-runs with the
 * exponential backoff configured in queue.ts. After retries are
 * exhausted, the row stays at status=failed so the UI can surface it.
 */
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { generateSimulatedCall } from "../services/simulated-call-generator";
import { logger } from "../services/logger";
import type { SimulatedCallGenerationJob } from "../services/queue";

export function createSimulatedCallWorker(connection: ConnectionOptions): Worker<SimulatedCallGenerationJob> {
  const worker = new Worker<SimulatedCallGenerationJob>(
    "simulated-call-generation",
    async (job: Job<SimulatedCallGenerationJob>) => {
      const { orgId, simulatedCallId } = job.data;
      logger.info({ orgId, simulatedCallId, jobId: job.id }, "Starting simulated call generation");
      const result = await generateSimulatedCall(orgId, simulatedCallId);
      logger.info(
        { orgId, simulatedCallId, jobId: job.id, durationSeconds: result.durationSeconds },
        "Simulated call generation complete",
      );
      return result;
    },
    {
      connection,
      // TTS + ffmpeg are CPU/IO heavy. Two concurrent renders per worker
      // process is a reasonable starting point — tune if we see queue depth.
      concurrency: 2,
    },
  );

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, orgId: job?.data?.orgId, simulatedCallId: job?.data?.simulatedCallId, err: err?.message },
      "Simulated call worker: job failed",
    );
  });

  return worker;
}
