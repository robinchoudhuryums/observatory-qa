/**
 * AssemblyAI webhook handler.
 *
 * When APP_BASE_URL is configured, transcription requests include a webhook_url
 * so AssemblyAI POSTs a completion notice here instead of requiring polling.
 * This endpoint is public but verified via the X-Assembly-Webhook-Token header.
 *
 * The webhook body is only `{ transcript_id, status }` — not the transcript.
 * The full transcript is fetched by id before resuming the pipeline.
 */
import type { Express } from "express";
import { timingSafeEqual } from "crypto";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { assemblyAIService } from "../services/assemblyai";
import { continueAfterTranscription, consumeWebhookPipelineOpts } from "../services/call-processing";
import { ephemeralSetNx, ephemeralDel } from "../services/redis";

const CLAIM_PREFIX = "aai-webhook-claim";
// Covers AssemblyAI's redelivery window; a claimed call that fails is marked
// failed (not left processing), so the claim outliving it is harmless.
const CLAIM_TTL_MS = 6 * 60 * 60 * 1000;

export function registerAssemblyAIWebhookRoutes(app: Express): void {
  // Note: This endpoint is registered BEFORE auth middleware — it is public
  // but protected by the shared webhook secret token.
  app.post("/api/webhooks/assemblyai", async (req, res) => {
    // Verify the shared secret token.
    // Trim both sides — accidental whitespace in env vars causes length mismatch
    // and rejects valid webhooks without any useful error signal.
    const expectedToken = (process.env.ASSEMBLYAI_WEBHOOK_SECRET || process.env.SESSION_SECRET || "").trim();
    const receivedToken =
      typeof req.headers["x-assembly-webhook-token"] === "string" ? req.headers["x-assembly-webhook-token"].trim() : "";

    // Reject when no webhook secret is configured — prevents accepting forged payloads
    if (!expectedToken) {
      logger.error("AssemblyAI webhook: no ASSEMBLYAI_WEBHOOK_SECRET or SESSION_SECRET configured — rejecting request");
      res.status(503).json({ error: "Webhook secret not configured" });
      return;
    }

    if (
      !receivedToken ||
      receivedToken.length !== expectedToken.length ||
      !timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedToken))
    ) {
      logger.warn({ receivedToken: receivedToken ? "[redacted]" : "missing" }, "AssemblyAI webhook: invalid token");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = (req.body ?? {}) as { transcript_id?: unknown; id?: unknown; status?: unknown };
    // `transcript_id` is the documented field; `id` is accepted for robustness.
    const rawId = body.transcript_id ?? body.id;
    const transcriptId = typeof rawId === "string" ? rawId : "";
    const status = typeof body.status === "string" ? body.status : "";

    if (!transcriptId) {
      res.status(400).json({ error: "Missing transcript ID" });
      return;
    }

    // Respond immediately — processing happens asynchronously
    res.status(200).json({ received: true });

    if (status !== "completed" && status !== "error") {
      logger.info({ transcriptId, status }, "AssemblyAI webhook: ignoring non-terminal status");
      return;
    }

    let claimedCallId: string | undefined;
    try {
      // Intentionally cross-org (INV-11): the transcript id is the only key we
      // have. Everything below uses the call's own orgId.
      const call = await storage.getCallByAssemblyAiId(transcriptId);
      if (!call) {
        logger.warn({ transcriptId }, "AssemblyAI webhook: call not found for transcript ID");
        return;
      }

      // Safety: only process calls that are still in "processing" state
      // Prevents replay attacks from re-processing already-completed calls
      if (call.status !== "processing" && call.status !== "pending") {
        logger.warn(
          { callId: call.id, status: call.status, transcriptId },
          "AssemblyAI webhook: ignoring callback for call not in processing state",
        );
        return;
      }

      // Atomic claim: duplicate deliveries both pass the status check above
      // (the status only changes at the end of the pipeline). Without this,
      // the second run's insert collided with the first and flipped a
      // completed call to failed.
      const claimed = await ephemeralSetNx(CLAIM_PREFIX, call.id, transcriptId, CLAIM_TTL_MS);
      if (!claimed) {
        logger.info(
          { callId: call.id, transcriptId },
          "AssemblyAI webhook: duplicate delivery — already being processed",
        );
        return;
      }
      claimedCallId = call.id;

      if (status === "error") {
        logger.error({ callId: call.id, transcriptId }, "AssemblyAI webhook: transcription error");
        await storage.updateCall(call.orgId, call.id, { status: "failed" });
        return;
      }

      const transcriptResponse = await assemblyAIService.getTranscript(transcriptId);
      if (transcriptResponse.status !== "completed") {
        logger.error(
          { callId: call.id, transcriptId, status: transcriptResponse.status },
          "AssemblyAI webhook: fetched transcript is not completed",
        );
        await storage.updateCall(call.orgId, call.id, { status: "failed" });
        return;
      }

      const opts = await consumeWebhookPipelineOpts(call.id);
      logger.info({ callId: call.id, transcriptId }, "AssemblyAI webhook: resuming pipeline after transcription");
      await continueAfterTranscription(call.orgId, call.id, transcriptResponse, opts);
    } catch (err) {
      logger.error({ transcriptId, err }, "AssemblyAI webhook: error processing");
      // Don't leave the call stuck in "processing" — nothing else will pick it
      // up. Release the claim so an operator-triggered retry isn't blocked.
      if (claimedCallId) {
        try {
          const call = await storage.getCallByAssemblyAiId(transcriptId);
          if (call && call.status === "processing") {
            await storage.updateCall(call.orgId, call.id, { status: "failed" });
          }
        } catch {
          // Best effort — already logged above
        }
        await ephemeralDel(CLAIM_PREFIX, claimedCallId).catch(() => {});
      }
    }
  });
}
