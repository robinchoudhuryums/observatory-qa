import type { Express, Request, Response, NextFunction } from "express";
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import { pipeline } from "stream/promises";
import { storage, normalizeAnalysis } from "../storage";
import { requireAuth, requireRole, injectOrgContext, requireOrgContext, getTeamScopedEmployeeIds } from "../auth";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { upload, safeFloat, validateUUIDParam, acquireUploadSlot, releaseUploadSlot } from "./helpers";
import { asyncHandler, AppError } from "../middleware/error-handler";

const validateId = validateUUIDParam("id");
import { enforceQuota, requireActiveSubscription, reportCallOverageToStripe } from "./billing";
import { logger } from "../services/logger";
import { CALL_CATEGORIES, type InsertCallAnalysis } from "@shared/schema";
import { decryptClinicalNotePhi } from "../services/phi-encryption";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { processAudioFile, invalidateRefDocCache, cleanupFile } from "../services/call-processing";
import { broadcastCallUpdate } from "../services/websocket";
import path from "path";

// In-flight upload dedup lock: prevents TOCTOU race where two concurrent
// uploads with the same file hash both pass the duplicate check.
// Key = `${orgId}:${fileHash}`, value = true while upload is in progress.
const uploadHashLocks = new Set<string>();

// Re-export invalidateRefDocCache for consumers that import from calls route
export { invalidateRefDocCache } from "../services/call-processing";

/**
 * Analyze manual edit patterns across the org and store insights in org settings.
 * Fires-and-forgets after each PATCH /api/calls/:id/analysis.
 * Requires ≥20 edits across the org for statistical reliability.
 * Surfaces patterns like "compliance scores consistently lowered by 1.5 pts on average."
 */
async function analyzeAndStoreEditPatterns(orgId: string): Promise<void> {
  try {
    // Sample up to 500 completed calls — getCallsWithDetails already batch-loads
    // analysis data via JOIN, so no individual getCallAnalysis() calls needed.
    const calls = await storage.getCallsWithDetails(orgId, { status: "completed", limit: 500 });
    let totalEdits = 0;
    const perfDeltas: number[] = [];

    for (const call of calls) {
      // Use the analysis already included in CallWithDetails (batch-loaded)
      const analysis = call.analysis;
      const edits = Array.isArray(analysis?.manualEdits) ? (analysis.manualEdits as any[]) : [];
      if (edits.length === 0) continue;
      totalEdits += edits.length;

      for (const edit of edits) {
        const prev = edit.previousValues || {};
        const beforeScore =
          typeof prev.performanceScore !== "undefined" ? parseFloat(String(prev.performanceScore)) : NaN;
        const afterScore = analysis?.performanceScore ? parseFloat(String(analysis.performanceScore)) : NaN;
        if (!isNaN(beforeScore) && !isNaN(afterScore)) {
          perfDeltas.push(afterScore - beforeScore);
        }
      }
    }

    if (totalEdits < 20) return;

    const insights: Array<{ dimension: string; avgDelta: number; editCount: number; pattern: string }> = [];

    if (perfDeltas.length >= 5) {
      const avg = perfDeltas.reduce((a, b) => a + b, 0) / perfDeltas.length;
      if (Math.abs(avg) >= 0.3) {
        const dir = avg > 0 ? "raised" : "lowered";
        insights.push({
          dimension: "performanceScore",
          avgDelta: Math.round(avg * 100) / 100,
          editCount: perfDeltas.length,
          pattern: `Managers consistently ${dir} overall performance scores by ${Math.abs(avg).toFixed(1)} pts on average (${perfDeltas.length} edits)`,
        });
      }
    }

    if (insights.length === 0) return;

    const org = await storage.getOrganization(orgId);
    if (!org) return;

    await storage.updateOrganization(orgId, {
      settings: {
        ...org.settings,
        editPatternInsights: {
          updatedAt: new Date().toISOString(),
          totalEdits,
          insights,
        },
      } as any,
    });

    logger.info({ orgId, insightCount: insights.length, totalEdits }, "Edit pattern insights updated");
  } catch (err) {
    logger.warn({ orgId, err }, "Edit pattern analysis failed (non-blocking)");
  }
}

export function registerCallRoutes(app: Express): void {
  app.get("/api/calls", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { status, sentiment, employee, limit, offset } = req.query;
      const parsedLimit = Math.min(Math.max(1, parseInt(limit as string, 10) || 100), 500);
      const parsedOffset = Math.max(0, parseInt(offset as string, 10) || 0);

      // Team-scoped filtering: managers with a subTeam see only their team's calls
      const teamEmployeeIds = req.user ? await getTeamScopedEmployeeIds(req.orgId!, req.user) : null;

      let calls = await storage.getCallsWithDetails(req.orgId!, {
        status: status as string,
        sentiment: sentiment as string,
        employee: employee as string,
        limit: parsedLimit,
        offset: parsedOffset,
      });

      if (teamEmployeeIds !== null) {
        calls = calls.filter((c) => !c.employeeId || teamEmployeeIds.has(c.employeeId));
      }

      // Return raw array — all frontend consumers (Dashboard, Sidebar, CallsTable,
      // SentimentPage, SearchPage, etc.) expect CallWithDetails[] directly.
      res.json(calls);
    } catch (error) {
      logger.error({ err: error }, "Failed to get calls");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get calls"));
    }
  });

  app.get("/api/calls/:id", requireAuth, injectOrgContext, validateId, async (req, res) => {
    try {
      // Pre-compute team scope BEFORE fetching call details to avoid TOCTOU:
      // returning 403 leaks existence of cross-team calls, 404 does not.
      const teamIds = req.user?.role !== "admin" ? await getTeamScopedEmployeeIds(req.orgId!, req.user!) : null;

      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"));
        return;
      }

      // Team scoping: return 404 (not 403) to avoid leaking call existence
      if (call.employeeId && teamIds !== null && !teamIds.has(call.employeeId)) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"));
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "view_call_details",
        resourceType: "call",
        resourceId: req.params.id,
      });

      const [employee, transcript, sentiment, rawAnalysis] = await Promise.all([
        call.employeeId ? storage.getEmployee(req.orgId!, call.employeeId) : undefined,
        storage.getTranscript(req.orgId!, call.id),
        storage.getSentimentAnalysis(req.orgId!, call.id),
        storage.getCallAnalysis(req.orgId!, call.id),
      ]);

      const analysis = normalizeAnalysis(rawAnalysis);

      // Decrypt PHI fields — isolated catch so decryption failures get a clear
      // HIPAA-specific error rather than a generic 500.
      try {
        decryptClinicalNotePhi(analysis as Record<string, unknown> | null, {
          userId: req.user?.id,
          orgId: req.orgId,
          resourceId: call.id,
          resourceType: "call_analysis",
        });
      } catch (decryptErr) {
        logger.error({ err: decryptErr, callId: call.id }, "PHI decryption failed for call details");
        logPhiAccess({
          ...auditContext(req),
          event: "phi_decryption_failure",
          resourceType: "call_analysis",
          resourceId: call.id,
          detail: "Decryption failed — key mismatch or data corruption",
        });
        res.status(503).json(errorResponse(
          ERROR_CODES.PHI_DECRYPTION_FAILED,
          "Unable to decrypt clinical data. This may indicate an encryption key issue — contact your administrator.",
        ));
        return;
      }

      res.json({
        ...call,
        employee,
        transcript,
        sentiment,
        analysis,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get call details");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get call"));
    }
  });

  // Wrap multer to catch file-size and type errors with proper HTTP responses
  const handleUpload = (req: Request, res: Response, next: NextFunction): void => {
    upload.single("audioFile")(req, res, (err: unknown) => {
      if (err) {
        const multerErr = err as { code?: string; message?: string };
        if (multerErr.code === "LIMIT_FILE_SIZE") {
          return res
            .status(413)
            .json(errorResponse(ERROR_CODES.VALIDATION_ERROR, "File too large. Maximum size is 100MB."));
        }
        if (multerErr.message?.includes("Invalid file type")) {
          return res
            .status(400)
            .json(
              errorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Invalid file type. Only audio files (MP3, WAV, M4A, MP4, FLAC, OGG) are allowed.",
              ),
            );
        }
        logger.warn({ err: multerErr.message }, "Upload error");
        return res
          .status(400)
          .json(errorResponse(ERROR_CODES.CALL_UPLOAD_FAILED, "File upload failed. Please try again."));
      }
      next();
    });
  };

  app.post(
    "/api/calls/upload",
    requireAuth,
    injectOrgContext,
    requireOrgContext,
    requireActiveSubscription(),
    enforceQuota("transcription"),
    handleUpload,
    async (req, res) => {
      const orgId = req.orgId!;
      if (!acquireUploadSlot(orgId)) {
        if (req.file) await cleanupFile(req.file.path);
        res.status(429).json({ message: "Too many concurrent uploads. Please wait and try again." });
        return;
      }
      try {
        if (!req.file) {
          releaseUploadSlot(orgId);
          res.status(400).json({ message: "No audio file provided" });
          return;
        }

        const { employeeId, callCategory, clinicalSpecialty, noteFormat } = req.body;

        // Validate callCategory against allowed values
        const validCategories = CALL_CATEGORIES.map((c) => c.value);
        if (callCategory && !validCategories.includes(callCategory)) {
          await cleanupFile(req.file.path);
          res.status(400).json({ message: `Invalid call category. Must be one of: ${validCategories.join(", ")}` });
          return;
        }

        if (employeeId) {
          const employee = await storage.getEmployee(req.orgId!, employeeId);
          if (!employee) {
            await cleanupFile(req.file.path);
            res.status(404).json(errorResponse(ERROR_CODES.EMP_NOT_FOUND, "Employee not found"));
            return;
          }
        }

        // Hash the file with a read stream to avoid blocking the event loop
        // (sync reads of 100MB files stall all other requests).
        const fileHash = await new Promise<string>((resolve, reject) => {
          const hash = createHash("sha256");
          const stream = fs.createReadStream(req.file!.path);
          stream.on("data", (chunk) => hash.update(chunk));
          stream.on("end", () => resolve(hash.digest("hex")));
          stream.on("error", reject);
        });
        // Read the buffer after hashing — still needed for AssemblyAI + S3 upload.
        const audioBuffer = await fs.promises.readFile(req.file.path);
        // Deduplication with TOCTOU race prevention: an in-memory lock ensures
        // two concurrent uploads with the same hash can't both pass the check.
        const hashLockKey = `${orgId}:${fileHash}`;
        if (uploadHashLocks.has(hashLockKey)) {
          await cleanupFile(req.file.path);
          releaseUploadSlot(orgId);
          res.status(409).json({
            message: "This file is currently being uploaded. Please wait.",
            duplicate: true,
          });
          return;
        }
        uploadHashLocks.add(hashLockKey);

        let duplicate;
        try {
          duplicate = await storage.getCallByFileHash(orgId, fileHash);
        } catch (dupErr) {
          uploadHashLocks.delete(hashLockKey);
          throw dupErr;
        }
        if (duplicate) {
          uploadHashLocks.delete(hashLockKey);
          await cleanupFile(req.file.path);
          releaseUploadSlot(orgId);
          res.status(409).json({
            message: "This file has already been uploaded.",
            existingCallId: duplicate.id,
            duplicate: true,
          });
          return;
        }

        let call;
        try {
          call = await storage.createCall(req.orgId!, {
            orgId: req.orgId!,
            employeeId: employeeId || undefined,
            fileName: req.file.originalname,
            filePath: req.file.path,
            fileHash,
            status: "processing",
            callCategory: callCategory || undefined,
          });
        } finally {
          // Release hash lock once the call is created (or creation failed).
          // The DB record now prevents future duplicates via getCallByFileHash.
          uploadHashLocks.delete(hashLockKey);
        }
        const originalName = req.file.originalname;
        const mimeType = req.file.mimetype || "audio/mpeg";
        const uploadUserId = req.user?.id;
        // If this call was accepted under overage, report 1 unit to Stripe metered billing.
        // Fire-and-forget — a Stripe failure must never block the upload response.
        if ((req as any).isOverQuota) {
          reportCallOverageToStripe(orgId).catch(() => {}); // already logged inside the helper
        }

        processAudioFile({
          orgId,
          callId: call.id,
          filePath: req.file.path,
          audioBuffer,
          originalName,
          mimeType,
          callCategory,
          userId: uploadUserId,
          clinicalSpecialty,
          noteFormat,
        }).catch(async (error) => {
          logger.error({ callId: call.id, err: error }, "Failed to process call");
          try {
            await storage.updateCall(orgId, call.id, { status: "failed" });
          } catch (updateErr) {
            logger.error({ callId: call.id, err: updateErr }, "Failed to mark call as failed");
          }
        });

        releaseUploadSlot(orgId);
        res.status(201).json(call);
      } catch (error) {
        releaseUploadSlot(orgId);
        logger.error({ err: error }, "Error during file upload");
        if (req.file?.path) await cleanupFile(req.file.path);
        res.status(500).json(errorResponse(ERROR_CODES.CALL_UPLOAD_FAILED, "Failed to upload call"));
      }
    },
  );

  app.get("/api/calls/:id/audio", requireAuth, injectOrgContext, validateId, async (req, res) => {
    try {
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"));
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: req.query.download === "true" ? "download_audio" : "stream_audio",
        resourceType: "audio",
        resourceId: req.params.id,
      });

      const audioFiles = await storage.getAudioFiles(req.orgId!, req.params.id);
      if (!audioFiles || audioFiles.length === 0) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Audio file not found in archive"));
        return;
      }

      const audioBuffer = await storage.downloadAudio(req.orgId!, audioFiles[0]);
      if (!audioBuffer) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Audio file could not be retrieved"));
        return;
      }

      const ext = path.extname(audioFiles[0]).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".mp4": "audio/mp4",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
      };
      const contentType = mimeTypes[ext] || "audio/mpeg";

      if (req.query.download === "true") {
        const rawName = call.fileName || `call-${req.params.id}${ext}`;
        const safeName = path.basename(rawName).replace(/[^\w.\-() ]/g, "_");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", audioBuffer.length.toString());
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.send(audioBuffer);
    } catch (error) {
      logger.error({ err: error }, "Failed to stream audio");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to stream audio"));
    }
  });

  app.get("/api/calls/:id/transcript", requireAuth, injectOrgContext, validateId, async (req, res) => {
    try {
      logPhiAccess({
        ...auditContext(req),
        event: "view_transcript",
        resourceType: "transcript",
        resourceId: req.params.id,
      });

      const transcript = await storage.getTranscript(req.orgId!, req.params.id);
      if (!transcript) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Transcript not found"));
        return;
      }
      res.json(transcript);
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get transcript"));
    }
  });

  app.get("/api/calls/:id/sentiment", requireAuth, injectOrgContext, validateId, async (req, res) => {
    try {
      const sentiment = await storage.getSentimentAnalysis(req.orgId!, req.params.id);
      if (!sentiment) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Sentiment analysis not found"));
        return;
      }
      logPhiAccess({
        ...auditContext(req),
        event: "view_sentiment_analysis",
        resourceType: "sentiment",
        resourceId: req.params.id,
      });
      res.json(sentiment);
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get sentiment analysis"));
    }
  });

  app.get("/api/calls/:id/analysis", requireAuth, injectOrgContext, validateId, async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call analysis not found"));
        return;
      }
      try {
        decryptClinicalNotePhi(analysis as Record<string, unknown>, {
          userId: req.user?.id,
          orgId: req.orgId,
          resourceId: req.params.id,
          resourceType: "call_analysis",
        });
      } catch (decryptErr) {
        logger.error({ err: decryptErr, callId: req.params.id }, "PHI decryption failed for call analysis");
        logPhiAccess({
          ...auditContext(req),
          event: "phi_decryption_failure",
          resourceType: "call_analysis",
          resourceId: req.params.id,
          detail: "Decryption failed — key mismatch or data corruption",
        });
        res.status(503).json(errorResponse(
          ERROR_CODES.PHI_DECRYPTION_FAILED,
          "Unable to decrypt clinical data. This may indicate an encryption key issue — contact your administrator.",
        ));
        return;
      }
      logPhiAccess({
        ...auditContext(req),
        event: "view_call_analysis",
        resourceType: "analysis",
        resourceId: req.params.id,
      });
      res.json(analysis);
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get call analysis"));
    }
  });

  app.patch(
    "/api/calls/:id/analysis",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    async (req, res) => {
      try {
        const callId = req.params.id;
        const { updates, reason } = req.body;

        logPhiAccess({
          ...auditContext(req),
          event: "edit_call_analysis",
          resourceType: "analysis",
          resourceId: callId,
          detail: `reason: ${reason}; fields: ${updates ? Object.keys(updates).join(",") : "none"}`,
        });

        if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
          res.status(400).json({ message: "A reason for the manual edit is required." });
          return;
        }

        if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
          res.status(400).json({ message: "Updates must be a non-empty object." });
          return;
        }

        const ALLOWED_FIELDS = new Set([
          "summary",
          "performanceScore",
          "topics",
          "actionItems",
          "feedback",
          "flags",
          "sentiment",
          "sentimentScore",
        ]);
        const disallowed = Object.keys(updates).filter((k) => !ALLOWED_FIELDS.has(k));
        if (disallowed.length > 0) {
          res.status(400).json({ message: `Cannot edit fields: ${disallowed.join(", ")}` });
          return;
        }

        const existing = await storage.getCallAnalysis(req.orgId!, callId);
        if (!existing) {
          res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call analysis not found"));
          return;
        }

        const user = req.user;
        const editedBy = user?.name || user?.username || "Unknown User";

        const previousEdits = Array.isArray(existing.manualEdits) ? existing.manualEdits : [];
        const editRecord = {
          editedBy,
          editedAt: new Date().toISOString(),
          reason: reason.trim(),
          fieldsChanged: Object.keys(updates),
          previousValues: {} as Record<string, unknown>,
        };

        for (const key of Object.keys(updates)) {
          editRecord.previousValues[key] = (existing as Record<string, unknown>)[key];
        }

        const updatedAnalysis = {
          ...existing,
          ...updates,
          manualEdits: [...previousEdits, editRecord],
        };

        await storage.updateCallAnalysis(req.orgId!, callId, updatedAnalysis);

        // Fire-and-forget: update edit pattern insights for this org
        analyzeAndStoreEditPatterns(req.orgId!).catch(() => {});

        logger.info(
          { callId, editedBy, reason, fields: editRecord.fieldsChanged },
          "Manual edit applied to call analysis",
        );
        res.json(updatedAnalysis);
      } catch (error) {
        logger.error({ err: error }, "Failed to update call analysis");
        res.status(500).json(errorResponse(ERROR_CODES.CALL_ANALYSIS_FAILED, "Failed to update call analysis"));
      }
    },
  );

  // PATCH /api/calls/:id/transcript — save manual transcript corrections (manager+)
  app.patch(
    "/api/calls/:id/transcript",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    async (req, res) => {
      try {
        const callId = req.params.id;
        const { corrections, correctedText } = req.body;

        if (!Array.isArray(corrections) && correctedText === undefined) {
          res.status(400).json({ message: "corrections (array) or correctedText (string) is required" });
          return;
        }

        const call = await storage.getCall(req.orgId!, callId);
        if (!call) {
          res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"));
          return;
        }

        logPhiAccess({
          ...auditContext(req),
          event: "update_transcript_corrections",
          resourceType: "transcript",
          resourceId: callId,
          detail: `${Array.isArray(corrections) ? corrections.length : 0} corrections by ${req.user?.name || req.user?.username}`,
        });

        const updated = await storage.updateTranscript(req.orgId!, callId, {
          ...(Array.isArray(corrections) ? { corrections } : {}),
          ...(correctedText !== undefined ? { correctedText } : {}),
        });

        if (!updated) {
          res.status(404).json({ message: "Transcript not found" });
          return;
        }

        logger.info(
          { callId, correctionCount: Array.isArray(corrections) ? corrections.length : 0 },
          "Transcript corrections saved",
        );
        res.json(updated);
      } catch (error) {
        logger.error({ err: error }, "Failed to save transcript corrections");
        res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to save transcript corrections"));
      }
    },
  );

  app.patch(
    "/api/calls/:id/assign",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    async (req, res) => {
      try {
        const { employeeId } = req.body;
        if (!employeeId) {
          res.status(400).json({ message: "employeeId is required" });
          return;
        }

        const call = await storage.getCall(req.orgId!, req.params.id);
        if (!call) {
          res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"));
          return;
        }

        const employee = await storage.getEmployee(req.orgId!, employeeId);
        if (!employee) {
          res.status(404).json(errorResponse(ERROR_CODES.EMP_NOT_FOUND, "Employee not found"));
          return;
        }

        logPhiAccess({
          ...auditContext(req),
          event: "assign_call",
          resourceType: "call",
          resourceId: req.params.id,
          detail: `Assigned to employee ${employee.name} (${employeeId})${call.employeeId ? `, previously ${call.employeeId}` : ""}`,
        });

        const updated = await storage.updateCall(req.orgId!, req.params.id, { employeeId });
        res.json(updated);
      } catch (error) {
        res.status(500).json(errorResponse(ERROR_CODES.CALL_ASSIGN_FAILED, "Failed to assign call"));
      }
    },
  );

  app.patch("/api/calls/:id/tags", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { tags } = req.body;
      if (!Array.isArray(tags)) {
        res.status(400).json({ message: "tags must be an array" });
        return;
      }
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"));
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "update_call_tags",
        resourceType: "call",
        resourceId: req.params.id,
        detail: `Tags: ${tags.join(", ")}`,
      });

      const updated = await storage.updateCall(req.orgId!, req.params.id, { tags });
      res.json(updated);
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update tags"));
    }
  });

  // Reanalyze a single call with current prompt templates and AI provider
  app.post(
    "/api/calls/:id/reanalyze",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    async (req, res) => {
      try {
        const callId = req.params.id;
        const orgId = req.orgId!;

        const call = await storage.getCall(orgId, callId);
        if (!call) {
          res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"));
          return;
        }

        if (call.status !== "completed") {
          res.status(400).json({ message: "Only completed calls can be reanalyzed" });
          return;
        }

        const transcript = await storage.getTranscript(orgId, callId);
        if (!transcript?.text || transcript.text.length < 10) {
          res.status(400).json({ message: "Call has no valid transcript for reanalysis" });
          return;
        }

        logPhiAccess({
          ...auditContext(req),
          event: "reanalyze_call",
          resourceType: "call",
          resourceId: callId,
          detail: `Reanalysis requested by ${req.user?.name || req.user?.username}`,
        });

        // Run reanalysis in the background
        (async () => {
          try {
            await storage.updateCall(orgId, callId, { status: "processing" });
            broadcastCallUpdate(
              callId,
              "reanalyzing",
              { step: 1, totalSteps: 2, label: "Re-running AI analysis..." },
              orgId,
            );

            const { getOrgAIProvider } = await import("../services/ai-factory");
            const org = await storage.getOrganization(orgId);
            const provider = getOrgAIProvider(orgId, org?.settings);

            if (!provider.isAvailable) {
              await storage.updateCall(orgId, callId, { status: "completed" });
              broadcastCallUpdate(
                callId,
                "failed",
                { step: 2, totalSteps: 2, label: "AI provider unavailable" },
                orgId,
              );
              return;
            }

            // Load prompt template for this call's category
            const template = call.callCategory
              ? await storage.getPromptTemplateByCategory(orgId, call.callCategory)
              : undefined;

            const result = await provider.analyzeCallTranscript(
              transcript.text!,
              callId,
              call.callCategory || undefined,
              template
                ? ({
                    evaluationCriteria: template.evaluationCriteria || undefined,
                    scoringWeights: template.scoringWeights,
                    requiredPhrases: template.requiredPhrases,
                  } as import("../services/ai-provider").PromptTemplateConfig)
                : undefined,
            );

            // Preserve existing data that shouldn't be overwritten
            const existing = await storage.getCallAnalysis(orgId, callId);
            const manualEdits = existing?.manualEdits || [];

            await storage.createCallAnalysis(orgId, {
              id: existing?.id || callId,
              orgId,
              callId,
              ...result,
              manualEdits: [
                ...(Array.isArray(manualEdits) ? manualEdits : []),
                {
                  editedBy: "system",
                  editedAt: new Date().toISOString(),
                  reason: `Reanalysis requested by ${req.user?.name || req.user?.username}`,
                  fieldsChanged: ["reanalysis"],
                  previousValues: { performanceScore: existing?.performanceScore },
                },
              ],
            } as InsertCallAnalysis);

            await storage.updateCall(orgId, callId, { status: "completed" });
            broadcastCallUpdate(callId, "completed", { step: 2, totalSteps: 2, label: "Reanalysis complete" }, orgId);
            logger.info({ orgId, callId }, "Call reanalysis completed");
          } catch (err) {
            logger.error({ err, callId }, "Reanalysis failed");
            await storage.updateCall(orgId, callId, { status: "completed" });
            broadcastCallUpdate(callId, "failed", { step: 2, totalSteps: 2, label: "Reanalysis failed" }, orgId);
          }
        })();

        res.json({ success: true, message: "Reanalysis started" });
      } catch (error) {
        logger.error({ err: error }, "Failed to start reanalysis");
        res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to start reanalysis"));
      }
    },
  );

  app.delete("/api/calls/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), validateId, async (req, res) => {
    try {
      const callId = req.params.id;

      logPhiAccess({
        ...auditContext(req),
        event: "delete_call",
        resourceType: "call",
        resourceId: callId,
      });

      await storage.deleteCall(req.orgId!, callId);

      logger.info({ callId }, "Successfully deleted call");
      res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, "Failed to delete call");
      res.status(500).json(errorResponse(ERROR_CODES.CALL_DELETE_FAILED, "Failed to delete call"));
    }
  });

  // ==================== CALL SHARE ROUTES ====================
  // Resource-level sharing: create time-limited links for external reviewers
  // (compliance consultants, QA auditors) without granting org-wide access.

  // Create a shareable link for a call (manager+)
  app.post(
    "/api/calls/:id/shares",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    async (req, res) => {
      try {
        const call = await storage.getCall(req.orgId!, req.params.id);
        if (!call) {
          return res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"));
        }

        const { viewerLabel, expiresInHours } = req.body;
        const hours = Math.min(Math.max(1, parseInt(expiresInHours) || 72), 720); // 1h–30d, default 72h
        const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

        // Generate a cryptographically random token (48 hex chars)
        const token = randomBytes(24).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const tokenPrefix = token.slice(0, 8);

        const share = await storage.createCallShare(req.orgId!, {
          orgId: req.orgId!,
          callId: call.id,
          tokenHash,
          tokenPrefix,
          viewerLabel: viewerLabel?.toString().slice(0, 255) || undefined,
          expiresAt,
          createdBy: req.user!.id,
        });

        logPhiAccess({
          ...auditContext(req),
          event: "create_call_share",
          resourceType: "call",
          resourceId: call.id,
          detail: `Share ${share.id} created, expires ${expiresAt}`,
        });

        res.status(201).json({
          id: share.id,
          token, // Only time plaintext token is returned
          tokenPrefix: share.tokenPrefix,
          viewerLabel: share.viewerLabel,
          expiresAt: share.expiresAt,
          createdAt: share.createdAt,
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to create call share");
        res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to create share link"));
      }
    },
  );

  // List active shares for a call (manager+)
  app.get("/api/calls/:id/shares", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        return res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call not found"));
      }
      const shares = await storage.listCallShares(req.orgId!, call.id);
      const now = new Date();
      // Filter expired + never return tokenHash
      const active = shares
        .filter((s) => new Date(s.expiresAt) > now)
        .map((s) => ({
          id: s.id,
          tokenPrefix: s.tokenPrefix,
          viewerLabel: s.viewerLabel,
          expiresAt: s.expiresAt,
          createdAt: s.createdAt,
          createdBy: s.createdBy,
        }));
      res.json(active);
    } catch (error) {
      logger.error({ err: error }, "Failed to list call shares");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to list shares"));
    }
  });

  // Revoke a specific share (manager+)
  app.delete(
    "/api/calls/:id/shares/:shareId",
    requireAuth,
    injectOrgContext,
    requireRole("manager", "admin"),
    async (req, res) => {
      try {
        await storage.deleteCallShare(req.orgId!, req.params.shareId);
        logPhiAccess({
          ...auditContext(req),
          event: "revoke_call_share",
          resourceType: "call",
          resourceId: req.params.id,
          detail: `Share ${req.params.shareId} revoked`,
        });
        res.json({ message: "Share link revoked" });
      } catch (error) {
        logger.error({ err: error }, "Failed to revoke call share");
        res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to revoke share"));
      }
    },
  );

  // Public endpoint: access a shared call via token (no authentication required)
  // Returns call details, transcript, and analysis — but NOT clinical notes (PHI).
  app.get("/api/shared-calls/:token", async (req, res) => {
    try {
      const token = req.params.token;
      if (!/^[0-9a-f]{48}$/.test(token)) {
        return res.status(404).json({ message: "Invalid or expired share link" });
      }

      const tokenHash = createHash("sha256").update(token).digest("hex");
      const share = await storage.getCallShareByToken(tokenHash);

      if (!share) {
        return res.status(404).json({ message: "Invalid or expired share link" });
      }
      if (new Date(share.expiresAt) < new Date()) {
        return res.status(410).json({ message: "This share link has expired" });
      }

      const call = await storage.getCall(share.orgId, share.callId);
      if (!call) {
        return res.status(404).json({ message: "Call not found" });
      }

      const [employee, transcript, sentiment, rawAnalysis] = await Promise.all([
        call.employeeId ? storage.getEmployee(share.orgId, call.employeeId) : undefined,
        storage.getTranscript(share.orgId, call.id),
        storage.getSentimentAnalysis(share.orgId, call.id),
        storage.getCallAnalysis(share.orgId, call.id),
      ]);

      const analysis = normalizeAnalysis(rawAnalysis);
      // Strip clinical note from shared view — PHI must not be shared externally
      if (analysis) {
        delete (analysis as any).clinicalNote;
      }

      res.json({
        id: call.id,
        fileName: call.fileName,
        status: call.status,
        duration: call.duration,
        callCategory: call.callCategory,
        tags: call.tags,
        uploadedAt: call.uploadedAt,
        channel: call.channel,
        employeeName: employee?.name,
        transcript: transcript ? { text: transcript.text, confidence: transcript.confidence } : undefined,
        sentiment,
        analysis,
        share: {
          viewerLabel: share.viewerLabel,
          expiresAt: share.expiresAt,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to load shared call");
      res.status(500).json({ message: "Failed to load shared call" });
    }
  });
}
