/**
 * EHR Note Push Worker
 *
 * Processes failed EHR note push jobs from the `ehr-note-push` BullMQ queue.
 * When a clinical note push fails (EHR offline, validation error, transient network),
 * the route handler enqueues a retry job here instead of surfacing the error to the user.
 *
 * Retry schedule (exponential backoff, 5 attempts):
 *   Attempt 1:  immediately after enqueue (~1 min after initial failure)
 *   Attempt 2:  ~2 min
 *   Attempt 3:  ~4 min
 *   Attempt 4:  ~8 min
 *   Attempt 5:  ~16 min
 *   → After 5 failures: moved to dead letter queue, user must retry manually
 *
 * On success: updates the call analysis with ehrPushStatus { success, ehrRecordId, timestamp }
 */

import { Worker, type ConnectionOptions, type Job } from "bullmq";
import type { EhrNotePushJob } from "../services/queue.js";
import { moveToDeadLetter } from "../services/queue.js";
import { getEhrAdapter } from "../services/ehr/index.js";
import { decryptField } from "../services/phi-encryption.js";
import { resolveEhrCredentials } from "../services/ehr/secrets-manager.js";
import { logger } from "../services/logger.js";
import type { EhrConnectionConfig } from "../services/ehr/types.js";

type GetStorage = () => any;

export function createEhrNotePushWorker(
  connection: ConnectionOptions,
  getStorage: GetStorage,
): Worker<EhrNotePushJob> {
  const worker = new Worker<EhrNotePushJob>(
    "ehr-note-push",
    async (job: Job<EhrNotePushJob>) => {
      const { orgId, callId, ehrPatientId, ehrProviderId, noteContent, noteType, procedureCodes, diagnosisCodes } = job.data;

      logger.info({ jobId: job.id, callId, orgId, attempt: job.attemptsMade }, "Processing EHR note push");

      const storage = getStorage();

      // Load org EHR config
      const org = await storage.getOrganization(orgId);
      if (!org) throw new Error(`Org not found: ${orgId}`);

      const settings = org.settings as any;
      const ehrConfig: (EhrConnectionConfig & { secretArn?: string }) | undefined = settings?.ehrConfig;

      if (!ehrConfig?.enabled) {
        throw new Error("EHR integration is disabled — cannot push note");
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) throw new Error(`No adapter for EHR system: ${ehrConfig.system}`);

      // Resolve credentials
      const decryptedKey = ehrConfig.apiKey ? decryptField(ehrConfig.apiKey) : undefined;
      const resolvedConfig = await resolveEhrCredentials(ehrConfig, decryptedKey);

      // Attempt push
      const result = await adapter.pushClinicalNote(resolvedConfig, {
        patientId: ehrPatientId,
        providerId: ehrProviderId || "",
        date: new Date().toISOString().split("T")[0]!,
        noteType,
        content: noteContent,
        procedureCodes,
        diagnosisCodes,
      });

      if (!result.success) {
        // Throw to trigger BullMQ retry
        throw new Error(result.error || "EHR note push returned failure");
      }

      // Update call analysis with push status
      try {
        const analysis = await storage.getCallAnalysis(orgId, callId);
        if (analysis) {
          await storage.updateCallAnalysis(orgId, callId, {
            ...(analysis as object),
            ehrPushStatus: {
              success: true,
              ehrRecordId: result.ehrRecordId,
              timestamp: result.timestamp,
              retriedViaQueue: true,
            },
          });
        }
      } catch (updateErr) {
        // Non-fatal — the note was pushed successfully, just log the update failure
        logger.warn({ err: updateErr, callId }, "EHR push succeeded but failed to update call analysis");
      }

      logger.info({ callId, orgId, ehrRecordId: result.ehrRecordId }, "EHR note push succeeded (via retry queue)");
    },
    { connection, concurrency: 2 },
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { orgId, callId } = job.data;

    if (job.attemptsMade >= (job.opts.attempts || 5)) {
      logger.error({ callId, orgId, err: err.message, attempts: job.attemptsMade }, "EHR note push permanently failed — moving to dead letter");

      await moveToDeadLetter(
        "ehr-note-push",
        job.id || "unknown",
        orgId,
        err.message,
        job.data as unknown as Record<string, unknown>,
      );

      // Update call analysis to reflect permanent failure
      try {
        const storage = (await import("../storage/index.js")).storage;
        const analysis = await storage.getCallAnalysis(orgId, callId);
        if (analysis) {
          await storage.updateCallAnalysis(orgId, callId, {
            ...(analysis as object),
            ehrPushStatus: {
              success: false,
              error: `Push permanently failed after ${job.attemptsMade} attempts: ${err.message}`,
              timestamp: new Date().toISOString(),
              requiresManualRetry: true,
            },
          });
        }
      } catch { /* best-effort */ }
    } else {
      logger.warn({ callId, orgId, attempt: job.attemptsMade, err: err.message }, "EHR note push attempt failed — will retry");
    }
  });

  worker.on("completed", job => {
    logger.debug({ jobId: job.id, callId: job.data.callId }, "EHR note push job completed");
  });

  return worker;
}
