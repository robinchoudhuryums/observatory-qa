import type { Express } from "express";
import { createHash } from "crypto";
import fs from "fs";
import { storage, normalizeAnalysis } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { upload, safeFloat, validateUUIDParam } from "./helpers";
import { enforceQuota, requireActiveSubscription } from "./billing";
import { logger } from "../services/logger";
import { CALL_CATEGORIES } from "@shared/schema";
import { decryptClinicalNotePhi } from "../services/phi-encryption";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import { processAudioFile, invalidateRefDocCache } from "../services/call-processing";

// Re-export invalidateRefDocCache for consumers that import from calls route
export { invalidateRefDocCache } from "../services/call-processing";

export function registerCallRoutes(app: Express): void {

  app.get("/api/calls", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { status, sentiment, employee, limit, offset } = req.query;
      const parsedLimit = limit ? Math.min(Math.max(1, parseInt(limit as string, 10) || 100), 500) : undefined;
      const parsedOffset = Math.max(0, parseInt(offset as string, 10) || 0);

      const calls = await storage.getCallsWithDetails(req.orgId!, {
        status: status as string,
        sentiment: sentiment as string,
        employee: employee as string,
        limit: parsedLimit,
        offset: parsedOffset,
      });

      if (parsedLimit && parsedLimit > 0) {
        res.json({ data: calls, total: calls.length, limit: parsedLimit, offset: parsedOffset });
      } else {
        // Backwards compatible — return raw array when no limit specified
        res.json(calls);
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to get calls");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get calls"));
    }
  });

  app.get("/api/calls/:id", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
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
      decryptClinicalNote(analysis as Record<string, unknown> | null);

      res.json({
        ...call,
        employee,
        transcript,
        sentiment,
        analysis
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get call details");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get call"));
    }
  });

  app.post("/api/calls/upload", requireAuth, injectOrgContext, requireActiveSubscription(), enforceQuota("transcription"), upload.single('audioFile'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { employeeId, callCategory, clinicalSpecialty, noteFormat } = req.body;

      // Validate callCategory against allowed values
      const validCategories = CALL_CATEGORIES.map(c => c.value);
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

      const audioBuffer = fs.readFileSync(req.file.path);
      const fileHash = createHash("sha256").update(audioBuffer).digest("hex");
      const duplicate = await storage.getCallByFileHash(req.orgId!, fileHash);
      if (duplicate) {
        await cleanupFile(req.file.path);
        res.status(200).json(duplicate);
        return;
      }

      const call = await storage.createCall(req.orgId!, {
        orgId: req.orgId!,
        employeeId: employeeId || undefined,
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileHash,
        status: "processing",
        callCategory: callCategory || undefined,
      });
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype || "audio/mpeg";
      const orgId = req.orgId!;
      const uploadUserId = req.user?.id;
      processAudioFile({ orgId, callId: call.id, filePath: req.file.path, audioBuffer, originalName, mimeType, callCategory, userId: uploadUserId, clinicalSpecialty, noteFormat })
        .catch(async (error) => {
          logger.error({ callId: call.id, err: error }, "Failed to process call");
          try {
            await storage.updateCall(orgId, call.id, { status: "failed" });
          } catch (updateErr) {
            logger.error({ callId: call.id, err: updateErr }, "Failed to mark call as failed");
          }
        });

      res.status(201).json(call);
    } catch (error) {
      logger.error({ err: error }, "Error during file upload");
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json(errorResponse(ERROR_CODES.CALL_UPLOAD_FAILED, "Failed to upload call"));
    }
  });

  app.get("/api/calls/:id/audio", requireAuth, injectOrgContext, async (req, res) => {
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
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.mp4': 'audio/mp4',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
      };
      const contentType = mimeTypes[ext] || 'audio/mpeg';

      if (req.query.download === 'true') {
        const rawName = call.fileName || `call-${req.params.id}${ext}`;
        const safeName = path.basename(rawName).replace(/[^\w.\-() ]/g, "_");
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.send(audioBuffer);
    } catch (error) {
      logger.error({ err: error }, "Failed to stream audio");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to stream audio"));
    }
  });

  app.get("/api/calls/:id/transcript", requireAuth, injectOrgContext, async (req, res) => {
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

  app.get("/api/calls/:id/sentiment", requireAuth, injectOrgContext, async (req, res) => {
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

  app.get("/api/calls/:id/analysis", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call analysis not found"));
        return;
      }
      decryptClinicalNote(analysis as Record<string, unknown>);
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

  app.patch("/api/calls/:id/analysis", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
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
        "summary", "performanceScore", "topics", "actionItems",
        "feedback", "flags", "sentiment", "sentimentScore",
      ]);
      const disallowed = Object.keys(updates).filter(k => !ALLOWED_FIELDS.has(k));
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
        previousValues: {} as Record<string, any>,
      };

      for (const key of Object.keys(updates)) {
        editRecord.previousValues[key] = (existing as any)[key];
      }

      const updatedAnalysis = {
        ...existing,
        ...updates,
        manualEdits: [...previousEdits, editRecord],
      };

      await storage.updateCallAnalysis(req.orgId!, callId, updatedAnalysis);

      logger.info({ callId, editedBy, reason, fields: editRecord.fieldsChanged }, "Manual edit applied to call analysis");
      res.json(updatedAnalysis);
    } catch (error) {
      logger.error({ err: error }, "Failed to update call analysis");
      res.status(500).json(errorResponse(ERROR_CODES.CALL_ANALYSIS_FAILED, "Failed to update call analysis"));
    }
  });

  app.patch("/api/calls/:id/assign", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
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

      const updated = await storage.updateCall(req.orgId!, req.params.id, { employeeId });
      res.json(updated);
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.CALL_ASSIGN_FAILED, "Failed to assign call"));
    }
  });

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
      const updated = await storage.updateCall(req.orgId!, req.params.id, { tags });
      res.json(updated);
    } catch (error) {
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to update tags"));
    }
  });

  app.delete("/api/calls/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
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
}
