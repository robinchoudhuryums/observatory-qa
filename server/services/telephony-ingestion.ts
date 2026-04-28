/**
 * Telephony Auto-Ingestion Framework.
 *
 * Adapted from the Call Analyzer's 8x8-specific integration, generalized for
 * multi-tenant Observatory QA. Provides a pluggable framework for automatic
 * call recording ingestion from telephony systems.
 *
 * Supported systems (via per-org configuration):
 * - Generic webhook (POST /api/webhooks/telephony with audio URL)
 * - Polling-based (framework for RingCentral, 8x8, Twilio, Five9, etc.)
 *
 * Each org configures their telephony provider in org settings. The framework
 * handles: deduplication, employee mapping (extension → employee), and
 * auto-submission to the call processing pipeline.
 */
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { logger } from "./logger";

export interface TelephonyConfig {
  provider: string; // "webhook" | "8x8" | "ringcentral" | "twilio" | "five9"
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  pollIntervalMinutes?: number;
  /** Maps telephony extension/number → employee ID for auto-assignment */
  extensionMap?: Record<string, string>;
}

export interface TelephonyRecording {
  externalId: string;
  direction: "inbound" | "outbound" | "internal";
  extension?: string;
  externalNumber?: string;
  startTime: string;
  durationSeconds?: number;
  audioUrl: string;
  callCategory?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestionResult {
  externalId: string;
  callId: string | null;
  status: "ingested" | "duplicate" | "skipped" | "error";
  reason?: string;
}

/**
 * Get telephony config for an org.
 */
export function getTelephonyConfig(orgSettings: any): TelephonyConfig | null {
  const config = orgSettings?.telephonyConfig;
  if (!config || !config.enabled || !config.provider) return null;
  return config as TelephonyConfig;
}

/**
 * Ingest a single recording from a telephony system.
 * Handles deduplication, employee mapping, and pipeline submission.
 */
export async function ingestRecording(
  orgId: string,
  recording: TelephonyRecording,
  config: TelephonyConfig,
): Promise<IngestionResult> {
  const { externalId, audioUrl, direction, extension } = recording;

  // Deduplication: check if this external recording was already ingested
  // Uses the recording's external ID as a tag for lookup
  const existingCalls = await storage.getCallSummaries(orgId, { status: "completed" });
  const alreadyIngested = existingCalls.some(
    (c) => Array.isArray(c.tags) && c.tags.includes(`telephony:${externalId}`),
  );

  if (alreadyIngested) {
    return { externalId, callId: null, status: "duplicate", reason: "Recording already ingested" };
  }

  // Map extension to employee for auto-assignment
  let employeeId: string | undefined;
  if (extension && config.extensionMap) {
    employeeId = config.extensionMap[extension];
  }

  // Determine call category from direction
  const callCategory = recording.callCategory || (direction === "outbound" ? "outbound" : "inbound");

  try {
    // Create the call record
    const call = await storage.createCall(orgId, {
      orgId,
      fileName: `telephony-${externalId}.mp3`,
      status: "pending",
      callCategory,
      employeeId,
      tags: [`telephony:${externalId}`, `provider:${config.provider}`],
    });

    logger.info(
      { orgId, callId: call.id, externalId, provider: config.provider, extension },
      "Telephony recording ingested — queued for processing",
    );

    return { externalId, callId: call.id, status: "ingested" };
  } catch (err) {
    logger.error({ orgId, externalId, err }, "Failed to ingest telephony recording");
    return { externalId, callId: null, status: "error", reason: (err as Error).message };
  }
}

/**
 * Batch ingest multiple recordings.
 */
export async function ingestRecordings(
  orgId: string,
  recordings: TelephonyRecording[],
  config: TelephonyConfig,
): Promise<IngestionResult[]> {
  const results: IngestionResult[] = [];
  for (const recording of recordings) {
    const result = await ingestRecording(orgId, recording, config);
    results.push(result);
  }

  const ingested = results.filter((r) => r.status === "ingested").length;
  const duplicates = results.filter((r) => r.status === "duplicate").length;
  if (ingested > 0 || duplicates > 0) {
    logger.info({ orgId, total: recordings.length, ingested, duplicates }, "Telephony batch ingestion complete");
  }

  return results;
}
