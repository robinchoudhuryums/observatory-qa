/**
 * BullMQ job queue infrastructure for async processing.
 *
 * Replaces in-process fire-and-forget async tasks with durable,
 * retryable job queues. Jobs survive server restarts and can be
 * distributed across multiple worker processes.
 *
 * Queues:
 * - audio-processing: Transcription + AI analysis pipeline
 * - bulk-reanalysis: Re-analyze all calls for an org
 * - data-retention: Purge expired calls per org retention policy
 * - usage-metering: Track per-org usage events for billing
 *
 * Requires REDIS_URL to be set. Falls back to in-process execution
 * when Redis is unavailable (backward compatible with current behavior).
 */
import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import { logger } from "./logger";

// Job type definitions
export interface AudioProcessingJob {
  orgId: string;
  callId: string;
  fileName: string;
  callCategory?: string;
  uploadedBy?: string;
}

export interface BulkReanalysisJob {
  orgId: string;
  callIds?: string[]; // If empty, reanalyze all completed calls
  requestedBy: string;
}

export interface DataRetentionJob {
  orgId: string;
  retentionDays: number;
}

export interface UsageMeteringJob {
  orgId: string;
  eventType: "transcription" | "ai_analysis" | "storage_mb" | "api_call";
  quantity: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentIndexingJob {
  orgId: string;
  documentId: string;
  extractedText: string;
}

// Dead letter queue job type — captures permanently failed jobs for admin review
export interface DeadLetterJob {
  originalQueue: string;
  originalJobId: string;
  orgId: string;
  failedAt: string;
  error: string;
  data: Record<string, unknown>;
}

/**
 * EHR note push job — queued when an immediate push fails so it can be
 * retried with exponential backoff without requiring the user to retry manually.
 * Note content is pre-formatted text (PHI is not stored in the queue).
 */
export interface EhrNotePushJob {
  orgId: string;
  callId: string;
  ehrPatientId: string;
  ehrProviderId?: string;
  /** Pre-formatted note text (already decrypted from PHI storage; do not store raw PHI) */
  noteContent: string;
  noteType: string;
  procedureCodes?: Array<{ code: string; description: string }>;
  diagnosisCodes?: Array<{ code: string; description: string }>;
  queuedAt: string;
}

// Queue instances
let audioQueue: Queue<AudioProcessingJob> | null = null;
let reanalysisQueue: Queue<BulkReanalysisJob> | null = null;
let retentionQueue: Queue<DataRetentionJob> | null = null;
let usageQueue: Queue<UsageMeteringJob> | null = null;
let indexingQueue: Queue<DocumentIndexingJob> | null = null;
let deadLetterQueue: Queue<DeadLetterJob> | null = null;
let ehrNotePushQueue: Queue<EhrNotePushJob> | null = null;

// Connection config
let connection: ConnectionOptions | null = null;

/**
 * Initialize BullMQ queues. Requires REDIS_URL.
 * Returns true if queues were initialized, false if Redis unavailable.
 */
export function initQueues(): boolean {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn("REDIS_URL not set — job queues unavailable, using in-process execution");
    return false;
  }

  try {
    // Parse Redis URL for BullMQ connection
    const url = new URL(redisUrl);
    connection = {
      host: url.hostname,
      port: parseInt(url.port || "6379"),
      password: url.password || undefined,
      // TLS is negotiated automatically when REDIS_URL uses the rediss:// scheme
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    };

    const defaultOpts = {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 500 },    // Tighter: keep 500 (was 1000)
        removeOnFail: { count: 1000 },       // Tighter: keep 1000 (was 5000)
      },
    };

    audioQueue = new Queue<AudioProcessingJob>("audio-processing", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
      },
    });

    reanalysisQueue = new Queue<BulkReanalysisJob>("bulk-reanalysis", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 1, // Don't retry bulk ops
      },
    });

    retentionQueue = new Queue<DataRetentionJob>("data-retention", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
      },
    });

    usageQueue = new Queue<UsageMeteringJob>("usage-metering", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 3,
        backoff: { type: "fixed", delay: 2000 },
      },
    });

    indexingQueue = new Queue<DocumentIndexingJob>("document-indexing", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
      },
    });

    // Dead letter queue — captures permanently failed jobs for admin review/retry
    deadLetterQueue = new Queue<DeadLetterJob>("dead-letter", {
      connection,
      defaultJobOptions: {
        removeOnComplete: { age: 7 * 24 * 3600 },  // Keep completed DLQ jobs for 7 days
        removeOnFail: false,                          // Never auto-remove failed DLQ entries
      },
    });

    // EHR note push queue — retries failed EHR note pushes with exponential backoff
    // 5 attempts: ~1min, ~2min, ~4min, ~8min, ~16min
    ehrNotePushQueue = new Queue<EhrNotePushJob>("ehr-note-push", {
      ...defaultOpts,
      defaultJobOptions: {
        ...defaultOpts.defaultJobOptions,
        attempts: 5,
        backoff: { type: "exponential", delay: 60_000 }, // 1 minute base
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });

    logger.info("BullMQ queues initialized (including dead letter queue and EHR note push queue)");
    return true;
  } catch (error) {
    logger.error({ err: error }, "Failed to initialize BullMQ queues");
    return false;
  }
}

// --- Queue accessors ---

export function getAudioQueue(): Queue<AudioProcessingJob> | null {
  return audioQueue;
}

export function getReanalysisQueue(): Queue<BulkReanalysisJob> | null {
  return reanalysisQueue;
}

export function getRetentionQueue(): Queue<DataRetentionJob> | null {
  return retentionQueue;
}

export function getUsageQueue(): Queue<UsageMeteringJob> | null {
  return usageQueue;
}

export function getIndexingQueue(): Queue<DocumentIndexingJob> | null {
  return indexingQueue;
}

export function getDeadLetterQueue(): Queue<DeadLetterJob> | null {
  return deadLetterQueue;
}

export function getEhrNotePushQueue(): Queue<EhrNotePushJob> | null {
  return ehrNotePushQueue;
}

/**
 * Enqueue a failed EHR note push for background retry.
 * The note content should already be formatted (not raw PHI).
 * Falls back to logging when queues are unavailable.
 */
export async function enqueueEhrNotePush(job: EhrNotePushJob): Promise<boolean> {
  if (ehrNotePushQueue) {
    try {
      const jobId = `ehr-push-${job.orgId}-${job.callId}-${Date.now()}`;
      await ehrNotePushQueue.add("push-note", job, { jobId });
      logger.info({ callId: job.callId, orgId: job.orgId }, "EHR note push job enqueued for retry");
      return true;
    } catch (error) {
      logger.error({ err: error, callId: job.callId }, "Failed to enqueue EHR note push job");
      return false;
    }
  }
  logger.warn({ callId: job.callId }, "EHR note push queue unavailable — retry not queued");
  return false;
}

/**
 * Move a permanently failed job to the dead letter queue for admin review.
 * Call this from worker "failed" event handlers after all retries are exhausted.
 */
export async function moveToDeadLetter(
  originalQueue: string,
  jobId: string,
  orgId: string,
  error: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!deadLetterQueue) return;
  try {
    await deadLetterQueue.add("dead-letter", {
      originalQueue,
      originalJobId: jobId,
      orgId,
      failedAt: new Date().toISOString(),
      error: error.substring(0, 1000), // Truncate long error messages
      data,
    });
    logger.warn({ originalQueue, jobId, orgId }, "Job moved to dead letter queue");
  } catch (err) {
    logger.error({ err, originalQueue, jobId }, "Failed to enqueue to dead letter queue");
  }
}

/**
 * Enqueue a document for RAG indexing (chunking + embedding).
 * Falls back to synchronous in-process indexing when queues unavailable.
 */
export async function enqueueDocumentIndexing(job: DocumentIndexingJob): Promise<void> {
  if (indexingQueue) {
    try {
      await indexingQueue.add("index-document", job, {
        jobId: `index-${job.documentId}`, // Deduplicate
      });
      logger.info({ documentId: job.documentId }, "Document indexing job enqueued");
    } catch (error) {
      logger.error({ err: error, documentId: job.documentId }, "Failed to enqueue indexing job");
    }
  } else {
    // Fallback: index in-process (import dynamically to avoid circular deps)
    logger.info({ documentId: job.documentId }, "Indexing document in-process (no queue)");
    try {
      const { indexDocumentInProcess } = await import("./rag-worker");
      await indexDocumentInProcess(job.orgId, job.documentId, job.extractedText);
    } catch (error) {
      logger.error({ err: error, documentId: job.documentId }, "In-process indexing failed");
    }
  }
}

/**
 * Enqueue a usage metering event. Fire-and-forget.
 * Falls back to logging when queues are unavailable.
 */
export async function trackUsage(event: UsageMeteringJob): Promise<void> {
  if (usageQueue) {
    try {
      await usageQueue.add("usage", event);
    } catch (error) {
      logger.error({ err: error, event }, "Failed to enqueue usage event");
    }
  } else {
    // Fallback: just log it
    logger.info({ usage: event }, "Usage event (no queue)");
  }
}

/**
 * Enqueue a data retention job for an org.
 */
export async function enqueueRetention(orgId: string, retentionDays: number): Promise<void> {
  if (retentionQueue) {
    await retentionQueue.add("retention", { orgId, retentionDays }, {
      jobId: `retention-${orgId}`, // Deduplicate per org (BullMQ disallows colons in job IDs)
    });
  }
}

/**
 * Get BullMQ connection options for creating workers.
 * Workers should be created in a separate process for production.
 */
export function getQueueConnection(): ConnectionOptions | null {
  return connection;
}

/**
 * Enqueue a bulk re-analysis job.
 * Falls back to returning null when queues are unavailable (caller handles in-process).
 */
export async function enqueueReanalysis(job: BulkReanalysisJob): Promise<boolean> {
  if (reanalysisQueue) {
    try {
      await reanalysisQueue.add("reanalyze", job, {
        jobId: `reanalyze-${job.orgId}-${Date.now()}`,
      });
      logger.info({ orgId: job.orgId, requestedBy: job.requestedBy }, "Bulk reanalysis job enqueued");
      return true;
    } catch (error) {
      logger.error({ err: error, orgId: job.orgId }, "Failed to enqueue reanalysis job");
      return false;
    }
  }
  return false;
}

/**
 * Close all queues on shutdown.
 */
export async function closeQueues(): Promise<void> {
  const queues = [audioQueue, reanalysisQueue, retentionQueue, usageQueue, indexingQueue, deadLetterQueue, ehrNotePushQueue];
  await Promise.all(queues.filter(Boolean).map((q) => q!.close()));
  audioQueue = null;
  reanalysisQueue = null;
  retentionQueue = null;
  usageQueue = null;
  indexingQueue = null;
  deadLetterQueue = null;
  logger.info("BullMQ queues closed");
}
