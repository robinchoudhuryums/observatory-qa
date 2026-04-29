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
import { simulatedCallScriptSchema, simulatedCallConfigSchema, simulatedCallStatusSchema } from "@shared/schema";

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

export function registerSimulatedCallRoutes(app: Express): void {
  const PLAN_GATE_MESSAGE = "Simulated calls require a Professional or Enterprise plan";

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
  // The row is persisted with status=pending; PR #4c will pick it up
  // and run the actual TTS pipeline. Until then this endpoint is a
  // no-op end-to-end (rows accumulate but never flip to ready).
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

      logger.info({ orgId, simulatedCallId: created.id, title: created.title }, "Simulated call created");
      res.status(201).json(created);
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
