/**
 * AWS Bedrock Batch Inference Service — 50% cost reduction for async analysis.
 *
 * Adapted from the single-tenant Call Analyzer (assemblyai_tool) for multi-tenant use.
 * When an org opts into batch mode, call analysis prompts are saved to S3 as pending
 * items instead of invoking Bedrock synchronously. A scheduler periodically collects
 * pending items, writes a JSONL input file, and submits a Bedrock batch inference job.
 *
 * Flow:
 *   1. After transcription, the call prompt is saved to S3 as a pending batch item
 *   2. A scheduler collects pending items per org, writes JSONL, submits batch job
 *   3. A poller checks running jobs; when complete, reads output and completes calls
 *
 * Multi-tenancy: items are partitioned by orgId in S3 keys. Each batch job
 * contains calls from a single org only (never mixing org data).
 *
 * Requires: S3_BUCKET env var, AWS credentials, BEDROCK_BATCH_ROLE_ARN env var.
 * Optional: BEDROCK_BATCH_INTERVAL_MINUTES (default 15)
 */
import { randomUUID } from "crypto";
import { logger } from "./logger";

export interface PendingBatchItem {
  orgId: string;
  callId: string;
  prompt: string;
  callCategory?: string;
  uploadedBy?: string;
  timestamp: string;
}

export interface BatchJob {
  jobId: string;
  jobArn: string;
  orgId: string;
  status: "Submitted" | "InProgress" | "Completed" | "Failed" | "Stopping" | "Stopped" | "Expired" | "Validating" | "Scheduled";
  inputS3Uri: string;
  outputS3Uri: string;
  callIds: string[];
  createdAt: string;
}

/**
 * Check if batch inference is available and configured.
 */
export function isBatchAvailable(): boolean {
  return !!(
    process.env.S3_BUCKET &&
    process.env.BEDROCK_BATCH_ROLE_ARN &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

/**
 * Save a pending batch item to S3 for later batch processing.
 * Items are keyed by orgId for multi-tenant isolation.
 */
export async function savePendingBatchItem(item: PendingBatchItem): Promise<void> {
  const { S3Client: S3ClientClass } = await import("./s3");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET not configured for batch inference");

  const s3 = new S3ClientClass(bucket);
  const key = `batch-inference/pending/${item.orgId}/${item.callId}.json`;
  await s3.uploadJson(key, item);

  logger.info(
    { orgId: item.orgId, callId: item.callId, key },
    "Saved pending batch item to S3",
  );
}

/**
 * List pending batch items for an org (or all orgs if orgId is omitted).
 */
export async function listPendingItems(orgId?: string): Promise<PendingBatchItem[]> {
  const { S3Client: S3ClientClass } = await import("./s3");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return [];

  const s3 = new S3ClientClass(bucket);
  const prefix = orgId
    ? `batch-inference/pending/${orgId}/`
    : `batch-inference/pending/`;

  try {
    const keys = await s3.listObjects(prefix);
    const items: PendingBatchItem[] = [];

    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      try {
        const data = await s3.downloadJson(key);
        if (data && data.orgId && data.callId) {
          items.push(data as PendingBatchItem);
        }
      } catch (err) {
        logger.warn({ key, err }, "Failed to read pending batch item");
      }
    }

    return items;
  } catch (err) {
    logger.warn({ err, prefix }, "Failed to list pending batch items");
    return [];
  }
}

/**
 * Build a JSONL input file from pending batch items and upload to S3.
 * Each line is a Converse API format request with a recordId.
 */
export async function createBatchInput(
  orgId: string,
  items: PendingBatchItem[],
  model?: string,
): Promise<{ s3Uri: string; batchId: string }> {
  const { S3Client: S3ClientClass } = await import("./s3");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET not configured");

  const batchId = `batch-${orgId.slice(0, 8)}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const bedrockModel = model || process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";

  const lines = items.map((item) =>
    JSON.stringify({
      recordId: item.callId,
      modelInput: {
        messages: [{ role: "user", content: [{ text: item.prompt }] }],
        inferenceConfig: { temperature: 0.3, maxTokens: 2048 },
      },
    }),
  );

  const jsonlContent = lines.join("\n");
  const key = `batch-inference/input/${orgId}/${batchId}.jsonl`;
  const s3Uri = `s3://${bucket}/${key}`;

  const s3 = new S3ClientClass(bucket);
  await s3.uploadFile(key, Buffer.from(jsonlContent, "utf-8"), "application/jsonl");

  logger.info(
    { orgId, batchId, s3Uri, itemCount: items.length, bytes: jsonlContent.length },
    "Uploaded batch input JSONL to S3",
  );

  return { s3Uri, batchId };
}

/**
 * Remove pending items from S3 after they've been included in a batch.
 */
export async function cleanupPendingItems(orgId: string, callIds: string[]): Promise<void> {
  const { S3Client: S3ClientClass } = await import("./s3");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return;

  const s3 = new S3ClientClass(bucket);
  for (const callId of callIds) {
    try {
      await s3.deleteObject(`batch-inference/pending/${orgId}/${callId}.json`);
    } catch {
      // Non-critical — orphaned pending items are harmless
    }
  }
}

/**
 * Submit a batch inference job to Bedrock.
 *
 * Requires: BEDROCK_BATCH_ROLE_ARN env var (IAM role with bedrock:InvokeModel
 * and S3 read/write permissions).
 */
export async function submitBatchJob(
  orgId: string,
  inputS3Uri: string,
  batchId: string,
  callIds: string[],
  model?: string,
): Promise<BatchJob> {
  const { BedrockClient, CreateModelInvocationJobCommand } = await import("@aws-sdk/client-bedrock");
  const { fromEnv } = await import("@aws-sdk/credential-providers");

  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET not configured");

  const region = process.env.AWS_REGION || "us-east-1";
  const roleArn = process.env.BEDROCK_BATCH_ROLE_ARN;
  if (!roleArn) throw new Error("BEDROCK_BATCH_ROLE_ARN not configured");

  const bedrockModel = model || process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
  const outputS3Uri = `s3://${bucket}/batch-inference/output/${orgId}/${batchId}/`;

  const client = new BedrockClient({ region, credentials: fromEnv() });

  const command = new CreateModelInvocationJobCommand({
    jobName: batchId,
    modelId: bedrockModel,
    roleArn,
    inputDataConfig: {
      s3InputDataConfig: {
        s3Uri: inputS3Uri,
        s3InputFormat: "JSONL",
      },
    },
    outputDataConfig: {
      s3OutputDataConfig: {
        s3Uri: outputS3Uri,
      },
    },
  });

  const response = await client.send(command);
  const jobArn = response.jobArn || "";
  const jobId = jobArn.split("/").pop() || batchId;

  logger.info(
    { orgId, jobId, jobArn, callCount: callIds.length, model: bedrockModel },
    "Bedrock batch job submitted",
  );

  return {
    jobId,
    jobArn,
    orgId,
    status: "Submitted",
    inputS3Uri,
    outputS3Uri,
    callIds,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Check the status of a batch inference job.
 */
export async function getBatchJobStatus(jobArn: string): Promise<{
  status: BatchJob["status"];
  message?: string;
}> {
  const { BedrockClient, GetModelInvocationJobCommand } = await import("@aws-sdk/client-bedrock");
  const { fromEnv } = await import("@aws-sdk/credential-providers");

  const region = process.env.AWS_REGION || "us-east-1";
  const client = new BedrockClient({ region, credentials: fromEnv() });
  const jobId = jobArn.split("/").pop() || jobArn;

  const command = new GetModelInvocationJobCommand({ jobIdentifier: jobId });
  const response = await client.send(command);

  return {
    status: (response.status as BatchJob["status"]) || "Failed",
    message: response.message,
  };
}

/**
 * Read batch output from S3 and parse results.
 * Returns a map of callId → parsed AI response text.
 */
export async function readBatchOutput(
  orgId: string,
  outputS3Uri: string,
): Promise<Map<string, string>> {
  const { S3Client: S3ClientClass } = await import("./s3");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET not configured");

  const s3 = new S3ClientClass(bucket);
  const results = new Map<string, string>();

  // Parse prefix from s3:// URI
  const prefix = outputS3Uri.replace(`s3://${bucket}/`, "");
  const outputFiles = await s3.listObjects(prefix);

  logger.info({ orgId, prefix, fileCount: outputFiles.length }, "Reading batch output files");

  for (const file of outputFiles) {
    if (!file.endsWith(".jsonl.out") && !file.endsWith(".jsonl")) continue;

    try {
      const buffer = await s3.downloadFile(file);
      if (!buffer) continue;

      const content = buffer.toString("utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as {
            recordId: string;
            modelOutput?: { output?: { message?: { content?: Array<{ text: string }> } } };
            error?: string;
          };

          if (record.error) {
            logger.warn({ callId: record.recordId, error: record.error }, "Batch item error");
            continue;
          }

          const responseText = record.modelOutput?.output?.message?.content?.[0]?.text;
          if (responseText) {
            results.set(record.recordId, responseText);
          } else {
            logger.warn({ callId: record.recordId }, "Empty response in batch output");
          }
        } catch (parseErr) {
          logger.warn({ err: parseErr, file }, "Failed to parse batch output line");
        }
      }
    } catch (fileErr) {
      logger.warn({ err: fileErr, file }, "Failed to read batch output file");
    }
  }

  return results;
}

/**
 * Determine if a call should use batch processing.
 * Checks org settings, env overrides, and per-call overrides.
 */
export function shouldUseBatchMode(
  orgSettings: { batchMode?: string } | undefined,
  callCategory?: string,
  perCallOverride?: "batch" | "realtime",
): boolean {
  // Per-call override takes precedence
  if (perCallOverride === "batch") return isBatchAvailable();
  if (perCallOverride === "realtime") return false;

  // Check org setting
  const mode = orgSettings?.batchMode;
  if (!mode || mode === "realtime") return false;
  if (mode === "batch") return isBatchAvailable();

  // Hybrid mode: could check callCategory against org-specific rules
  // For now, hybrid defaults to realtime (orgs configure via per-call override)
  return false;
}
