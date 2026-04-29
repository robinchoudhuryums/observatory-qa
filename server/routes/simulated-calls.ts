/**
 * Simulated Call Generator routes — TTS-rendered training/QA calls.
 *
 * Manager+ creates a synthetic call (script + voices + circumstances + tier).
 * The row is persisted with status=pending; PR #4c adds the worker that
 * runs the rewrite → ElevenLabs TTS → audio assembly → S3 upload pipeline.
 * Once the worker flips status to "ready", the audio endpoint streams the
 * rendered file. PR #4c also adds the "send to analysis" endpoint that
 * feeds the rendered audio back through the regular call pipeline.
 *
 * Plan gating: Professional+ (`simulatedCallsEnabled`).
 * Role gating: manager+ for all mutating routes; manager+ for read since
 * the script can reference real scenario details that aren't broadly
 * shareable.
 *
 * No PHI audit: scripts are org-authored synthetic content, not patient PHI.
 * The standard API audit middleware in server/index.ts captures access.
 */
import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { requireActiveSubscription, requirePlanFeature } from "./billing";
import { asyncHandler } from "../middleware/error-handler";
import { validateUUIDParam } from "./helpers";
import { ERROR_CODES, errorResponse } from "../services/error-codes";
import { logger } from "../services/logger";
import { enqueueSimulatedCallGeneration } from "../services/queue";
import { processAudioFile, cleanupFile } from "../services/call-processing";
import { elevenLabsClient } from "../services/elevenlabs-client";
import { LruCache } from "../utils/lru-cache";
import { simulatedCallScriptSchema, simulatedCallConfigSchema, simulatedCallStatusSchema } from "@shared/schema";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const validateId = validateUUIDParam("id");

// ── Request schemas ─────────────────────────────────────────────────
export const createSimulatedCallSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(500),
  scenario: z.string().max(4000).optional(),
  qualityTier: z.enum(["excellent", "acceptable", "poor"]).optional(),
  equipment: z.string().max(255).optional(),
  script: simulatedCallScriptSchema,
  config: simulatedCallConfigSchema,
});

export const listSimulatedCallsQuerySchema = z.object({
  status: simulatedCallStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

// Cache the ElevenLabs voices list for 1h. Voices are platform-wide so the
// same list is fine across orgs; only one entry is ever stored.
const voicesCache = new LruCache<unknown>({ maxSize: 1, ttlMs: 60 * 60 * 1000 });
const VOICES_CACHE_KEY = "elevenlabs-voices";

export function registerSimulatedCallRoutes(app: Express): void {
  const PLAN_GATE_MESSAGE = "Simulated calls require a Professional or Enterprise plan";

  // ── Voice picker source ──────────────────────────────────────────
  // Proxy to the ElevenLabs /voices endpoint with a process-wide cache so
  // the script-builder modal can populate voice dropdowns without a key
  // round-trip every time. Returns 503 when ELEVENLABS_API_KEY is unset.
  app.get(
    "/api/simulated-calls/voices",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    asyncHandler(async (_req, res) => {
      const cached = voicesCache.get(VOICES_CACHE_KEY);
      if (cached) {
        res.json(cached);
        return;
      }
      if (!elevenLabsClient.isAvailable) {
        res.status(503).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "ElevenLabs is not configured"));
        return;
      }
      const voices = await elevenLabsClient.listVoices();
      voicesCache.set(VOICES_CACHE_KEY, voices);
      res.json(voices);
    }),
  );

  // ── List ──────────────────────────────────────────────────────────
  app.get(
    "/api/simulated-calls",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const parsed = listSimulatedCallsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(errorResponse(ERROR_CODES.VALIDATION_ERROR, parsed.error.message));
        return;
      }
      const rows = await storage.listSimulatedCalls(req.orgId!, parsed.data);
      res.json(rows);
    }),
  );

  // ── Get one ───────────────────────────────────────────────────────
  app.get(
    "/api/simulated-calls/:id",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateId,
    asyncHandler(async (req, res) => {
      const row = await storage.getSimulatedCall(req.orgId!, req.params.id);
      if (!row) {
        res.status(404).json(errorResponse(ERROR_CODES.SIMULATED_CALL_NOT_FOUND, "Simulated call not found"));
        return;
      }
      res.json(row);
    }),
  );

  // ── Audio stream ──────────────────────────────────────────────────
  // Rendered MP3 from S3. Returns 409 if the call is still generating
  // and 404 if no audio key was ever set (failed renders, deleted blobs).
  app.get(
    "/api/simulated-calls/:id/audio",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateId,
    asyncHandler(async (req, res) => {
      const row = await storage.getSimulatedCall(req.orgId!, req.params.id);
      if (!row) {
        res.status(404).json(errorResponse(ERROR_CODES.SIMULATED_CALL_NOT_FOUND, "Simulated call not found"));
        return;
      }
      if (row.status !== "ready") {
        res
          .status(409)
          .json(errorResponse(ERROR_CODES.SIMULATED_CALL_NOT_READY, `Audio not yet ready (status=${row.status})`));
        return;
      }
      if (!row.audioS3Key) {
        res
          .status(404)
          .json(errorResponse(ERROR_CODES.SIMULATED_CALL_AUDIO_MISSING, "Audio key missing for ready call"));
        return;
      }
      const buf = await storage.downloadAudio(req.orgId!, row.audioS3Key);
      if (!buf) {
        res
          .status(404)
          .json(errorResponse(ERROR_CODES.SIMULATED_CALL_AUDIO_MISSING, "Audio file could not be retrieved"));
        return;
      }
      const contentType = row.audioFormat === "wav" ? "audio/wav" : "audio/mpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(buf.length));
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(buf);
    }),
  );

  // ── Create ────────────────────────────────────────────────────────
  // Persists the row at status=pending and enqueues the generation job.
  // The worker (or in-process fallback when Redis isn't configured) flips
  // status through generating → ready/failed asynchronously; the response
  // returns the pending row immediately.
  app.post(
    "/api/simulated-calls",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    requireActiveSubscription(),
    requirePlanFeature("simulatedCallsEnabled", PLAN_GATE_MESSAGE),
    asyncHandler(async (req, res) => {
      const parsed = createSimulatedCallSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(errorResponse(ERROR_CODES.VALIDATION_ERROR, parsed.error.message));
        return;
      }

      const orgId = req.orgId!;
      const created = await storage.createSimulatedCall(orgId, {
        orgId,
        title: parsed.data.title,
        scenario: parsed.data.scenario,
        qualityTier: parsed.data.qualityTier ?? parsed.data.script.qualityTier,
        equipment: parsed.data.equipment,
        script: parsed.data.script,
        config: parsed.data.config,
        createdBy: req.user?.username ?? "unknown",
      });

      // Fire-and-forget — generation runs in background (queue or in-process).
      enqueueSimulatedCallGeneration({ orgId, simulatedCallId: created.id }).catch((err) =>
        logger.error({ err, simulatedCallId: created.id }, "Failed to enqueue simulated call generation"),
      );

      logger.info({ orgId, simulatedCallId: created.id, title: created.title }, "Simulated call created and enqueued");
      res.status(201).json(created);
    }),
  );

  // ── Send to analysis ──────────────────────────────────────────────
  // Feeds the rendered audio back through the regular call pipeline:
  // creates a normal Call row, hands the audio buffer + temp file to
  // processAudioFile() (which transcribes + analyzes), and links the
  // resulting callId back onto the simulated call row.
  app.post(
    "/api/simulated-calls/:id/send-to-analysis",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    requireActiveSubscription(),
    requirePlanFeature("simulatedCallsEnabled", PLAN_GATE_MESSAGE),
    validateId,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId!;
      const sim = await storage.getSimulatedCall(orgId, req.params.id);
      if (!sim) {
        res.status(404).json(errorResponse(ERROR_CODES.SIMULATED_CALL_NOT_FOUND, "Simulated call not found"));
        return;
      }
      if (sim.status !== "ready") {
        res
          .status(409)
          .json(errorResponse(ERROR_CODES.SIMULATED_CALL_NOT_READY, `Cannot send to analysis (status=${sim.status})`));
        return;
      }
      if (!sim.audioS3Key) {
        res
          .status(404)
          .json(errorResponse(ERROR_CODES.SIMULATED_CALL_AUDIO_MISSING, "Audio key missing for ready call"));
        return;
      }

      const audio = await storage.downloadAudio(orgId, sim.audioS3Key);
      if (!audio) {
        res.status(404).json(errorResponse(ERROR_CODES.SIMULATED_CALL_AUDIO_MISSING, "Audio could not be retrieved"));
        return;
      }

      // Spool to a temp file — processAudioFile reads from disk for the
      // AssemblyAI upload step.
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "simulated-call-analysis-"));
      const fileName = `simulated-${sim.id}.mp3`;
      const filePath = path.join(tmpDir, fileName);
      await fs.writeFile(filePath, audio);
      const fileHash = createHash("sha256").update(audio).digest("hex");

      try {
        const call = await storage.createCall(orgId, {
          orgId,
          fileName,
          filePath,
          fileHash,
          status: "processing",
          callCategory: undefined,
          tags: ["simulated"],
        });

        // Fire-and-forget — pipeline takes minutes; client polls /api/calls/:id.
        processAudioFile({
          orgId,
          callId: call.id,
          filePath,
          audioBuffer: audio,
          originalName: fileName,
          mimeType: "audio/mpeg",
          callCategory: undefined,
          userId: req.user?.id,
        }).catch((err) => {
          logger.error({ err, callId: call.id, simulatedCallId: sim.id }, "Simulated-call analysis pipeline failed");
          cleanupFile(filePath).catch(() => {});
          fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        });

        await storage.updateSimulatedCall(orgId, sim.id, { sentToAnalysisCallId: call.id });
        logger.info({ orgId, simulatedCallId: sim.id, callId: call.id }, "Simulated call sent to analysis pipeline");
        res.status(202).json({ callId: call.id, simulatedCallId: sim.id });
      } catch (err) {
        // Clean up temp on synchronous failure (createCall et al).
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
    }),
  );

  // ── Delete ────────────────────────────────────────────────────────
  app.delete(
    "/api/simulated-calls/:id",
    requireAuth,
    requireRole("manager"),
    injectOrgContext,
    validateId,
    asyncHandler(async (req, res) => {
      const existing = await storage.getSimulatedCall(req.orgId!, req.params.id);
      if (!existing) {
        res.status(404).json(errorResponse(ERROR_CODES.SIMULATED_CALL_NOT_FOUND, "Simulated call not found"));
        return;
      }
      await storage.deleteSimulatedCall(req.orgId!, req.params.id);
      res.status(204).send();
    }),
  );
}
