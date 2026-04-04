/**
 * AssemblyAI webhook handler.
 *
 * When APP_BASE_URL is configured, transcription requests include a webhook_url
 * so AssemblyAI POSTs the completed transcript here instead of requiring polling.
 * This endpoint is public but verified via the X-Assembly-Webhook-Token header.
 */
import type { Express } from "express";
import { timingSafeEqual } from "crypto";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { continueAfterTranscription } from "../services/call-processing";
import type { AssemblyAIResponse } from "../services/assemblyai";

export function registerAssemblyAIWebhookRoutes(app: Express): void {
  // Note: This endpoint is registered BEFORE auth middleware — it is public
  // but protected by the shared webhook secret token.
  app.post("/api/webhooks/assemblyai", async (req, res) => {
    // Verify the shared secret token.
    // Trim both sides — accidental whitespace in env vars causes length mismatch
    // and rejects valid webhooks without any useful error signal.
    const expectedToken = (process.env.ASSEMBLYAI_WEBHOOK_SECRET || process.env.SESSION_SECRET || "").trim();
    const receivedToken = typeof req.headers["x-assembly-webhook-token"] === "string"
      ? req.headers["x-assembly-webhook-token"].trim()
      : "";

    const tokenMismatch =
      expectedToken &&
      (!receivedToken ||
        receivedToken.length !== expectedToken.length ||
        !timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedToken)));
    if (tokenMismatch) {
      logger.warn({ receivedToken: receivedToken ? "[redacted]" : "missing" }, "AssemblyAI webhook: invalid token");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const transcriptResponse = req.body as AssemblyAIResponse;

    if (!transcriptResponse?.id) {
      res.status(400).json({ error: "Missing transcript ID" });
      return;
    }

    // Respond immediately — processing happens asynchronously
    res.status(200).json({ received: true });

    if (transcriptResponse.status !== "completed" && transcriptResponse.status !== "error") {
      logger.info(
        { transcriptId: transcriptResponse.id, status: transcriptResponse.status },
        "AssemblyAI webhook: ignoring non-terminal status",
      );
      return;
    }

    // Look up the call by assemblyAiId
    try {
      const call = await storage.getCallByAssemblyAiId(transcriptResponse.id);
      if (!call) {
        logger.warn({ transcriptId: transcriptResponse.id }, "AssemblyAI webhook: call not found for transcript ID");
        return;
      }

      // Safety: only process calls that are still in "processing" state
      // Prevents replay attacks from re-processing already-completed calls
      if (call.status !== "processing" && call.status !== "pending") {
        logger.warn(
          { callId: call.id, status: call.status, transcriptId: transcriptResponse.id },
          "AssemblyAI webhook: ignoring callback for call not in processing state",
        );
        return;
      }

      if (transcriptResponse.status === "error") {
        logger.error(
          { callId: call.id, transcriptId: transcriptResponse.id, error: transcriptResponse.error },
          "AssemblyAI webhook: transcription error",
        );
        await storage.updateCall(call.orgId, call.id, { status: "failed" });
        return;
      }

      logger.info(
        { callId: call.id, transcriptId: transcriptResponse.id },
        "AssemblyAI webhook: resuming pipeline after transcription",
      );
      await continueAfterTranscription(call.orgId, call.id, transcriptResponse);
    } catch (err) {
      logger.error({ transcriptId: transcriptResponse.id, err }, "AssemblyAI webhook: error processing");
    }
  });
}
