/**
 * Call tags + annotations routes.
 *
 * Tier 1A of the CallAnalyzer adaptation plan. Adapted from CA's
 * `routes/calls-tags.ts`, scoped per-org for multi-tenant Observatory.
 *
 * Endpoints:
 *   GET    /api/calls/:id/tags
 *   POST   /api/calls/:id/tags                  (manager+ or self)
 *   DELETE /api/calls/:id/tags/:tagId           (author-or-manager)
 *   GET    /api/tags                            (top tags, autocomplete)
 *   GET    /api/calls/by-tag/:tag               (calls tagged with X)
 *
 *   GET    /api/calls/:id/annotations
 *   POST   /api/calls/:id/annotations
 *   DELETE /api/calls/:id/annotations/:annotationId  (author-or-manager)
 *
 * Multi-tenancy: every operation scoped to `req.orgId`. The storage layer
 * filters by orgId; cross-org access is structurally impossible.
 *
 * Author-or-manager delete: tags + annotations can only be deleted by
 * their original author OR a user with manager/admin role. Mirrors the
 * pattern used in CA.
 *
 * PHI audit: viewing tags + annotations on a call counts as PHI access
 * (the parent call is PHI). Same logPhiAccess pattern as the rest of
 * the codebase.
 */
import { randomUUID } from "crypto";
import type { Express, Request } from "express";
import { requireAuth, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { getDatabase } from "../db/index";
import { asyncHandler } from "../middleware/error-handler";
import { validateUUIDParam } from "./helpers";
import {
  listTagsForCall,
  addTag,
  getTagById,
  deleteTag,
  listTopTags,
  listCallIdsByTag,
  listAnnotationsForCall,
  addAnnotation,
  getAnnotationById,
  deleteAnnotation,
} from "../storage/call-tags";

// --- Validation constants ---
// Match CA's normalization: lowercase, alphanumeric + spaces + `._/-`,
// must start with alphanumeric.
const TAG_PATTERN = /^[a-z0-9][a-z0-9 _./-]*$/;
const MAX_TAG_LEN = 100;
const MAX_ANNOTATION_LEN = 2000;
const TOP_TAGS_LIMIT = 100;
const BY_TAG_RESULTS_LIMIT = 100;

/** Convenience for "is this user a manager or admin in this org?" */
function isManagerOrAdmin(req: Request): boolean {
  const role = req.user?.role || "viewer";
  return role === "manager" || role === "admin";
}

/** Identity used for `created_by` / `author` columns. */
function authorIdentity(req: Request): string {
  return req.user?.username || req.user?.id || "unknown";
}

export function registerCallTagRoutes(app: Express) {
  // ==================== TAGS ====================

  app.get(
    "/api/calls/:id/tags",
    requireAuth,
    injectOrgContext,
    validateUUIDParam("id"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const callId = req.params.id;

      const call = await storage.getCall(orgId, callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      const db = getDatabase();
      if (!db) return res.json([]);

      const tags = await listTagsForCall(db, orgId, callId);
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "view_call_tags",
        resourceType: "call",
        resourceId: callId,
      });
      return res.json(tags);
    }),
  );

  app.post(
    "/api/calls/:id/tags",
    requireAuth,
    injectOrgContext,
    validateUUIDParam("id"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const callId = req.params.id;

      const { tag } = req.body;
      if (!tag || typeof tag !== "string" || tag.length > MAX_TAG_LEN) {
        return res
          .status(400)
          .json({ message: `Tag is required (max ${MAX_TAG_LEN} characters)` });
      }
      const normalized = tag.trim().toLowerCase();
      if (normalized.length === 0 || !TAG_PATTERN.test(normalized)) {
        return res.status(400).json({
          message:
            "Tags must contain only letters, numbers, spaces, dots, underscores, hyphens, and slashes",
        });
      }

      const call = await storage.getCall(orgId, callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      const db = getDatabase();
      if (!db) {
        return res.status(503).json({ message: "Tagging requires a database connection" });
      }

      const inserted = await addTag(db, {
        id: randomUUID(),
        orgId,
        callId,
        tag: normalized,
        createdBy: authorIdentity(req),
      });

      if (!inserted) {
        return res.status(409).json({ message: "Tag already exists on this call" });
      }

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "tag_added",
        resourceType: "call",
        resourceId: callId,
        detail: normalized,
      });
      return res.status(201).json(inserted);
    }),
  );

  app.delete(
    "/api/calls/:id/tags/:tagId",
    requireAuth,
    injectOrgContext,
    validateUUIDParam("id"),
    validateUUIDParam("tagId"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const { id: callId, tagId } = req.params;

      const db = getDatabase();
      if (!db) return res.status(503).json({ message: "Tagging requires a database connection" });

      const existing = await getTagById(db, orgId, tagId);
      if (!existing || existing.callId !== callId) {
        return res.status(404).json({ message: "Tag not found" });
      }

      // Author-or-manager check.
      const me = authorIdentity(req);
      const isAuthor = existing.createdBy === me;
      if (!isAuthor && !isManagerOrAdmin(req)) {
        return res
          .status(403)
          .json({ message: "Only the tag's author or a manager can delete this tag" });
      }

      await deleteTag(db, orgId, tagId);
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "tag_removed",
        resourceType: "call",
        resourceId: callId,
        detail: existing.tag,
      });
      return res.json({ message: "Tag removed" });
    }),
  );

  app.get(
    "/api/tags",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const db = getDatabase();
      if (!db) return res.json([]);

      const limit = Math.min(parseInt(String(req.query.limit ?? TOP_TAGS_LIMIT), 10) || TOP_TAGS_LIMIT, TOP_TAGS_LIMIT);
      const tags = await listTopTags(db, orgId, limit);
      return res.json(tags);
    }),
  );

  app.get(
    "/api/calls/by-tag/:tag",
    requireAuth,
    injectOrgContext,
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const tag = String(req.params.tag || "").trim().toLowerCase();
      if (!tag || tag.length > MAX_TAG_LEN) {
        return res.status(400).json({ message: "Invalid tag" });
      }

      const db = getDatabase();
      if (!db) return res.json([]);

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "search_calls_by_tag",
        resourceType: "call",
        detail: tag,
      });

      const callIds = await listCallIdsByTag(db, orgId, tag, BY_TAG_RESULTS_LIMIT);
      if (callIds.length === 0) return res.json([]);

      // Look up matching calls. The IStorage method already scopes by orgId
      // so any cross-org IDs would simply not resolve.
      const calls = await Promise.all(
        callIds.map((id) => storage.getCall(orgId, id).catch(() => null)),
      );
      const present = calls
        .filter((c): c is NonNullable<typeof c> => c !== null && c !== undefined)
        .map((c: any) => ({
          id: c.id,
          fileName: c.fileName,
          status: c.status,
          duration: c.duration,
          callCategory: c.callCategory,
          uploadedAt: c.uploadedAt,
          employeeId: c.employeeId,
        }));

      return res.json(present);
    }),
  );

  // ==================== ANNOTATIONS ====================

  app.get(
    "/api/calls/:id/annotations",
    requireAuth,
    injectOrgContext,
    validateUUIDParam("id"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const callId = req.params.id;

      const call = await storage.getCall(orgId, callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      const db = getDatabase();
      if (!db) return res.json([]);

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "view_annotations",
        resourceType: "annotation",
        resourceId: callId,
      });

      const rows = await listAnnotationsForCall(db, orgId, callId);
      return res.json(rows);
    }),
  );

  app.post(
    "/api/calls/:id/annotations",
    requireAuth,
    injectOrgContext,
    validateUUIDParam("id"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const callId = req.params.id;

      const { timestampMs, text } = req.body;
      if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs < 0) {
        return res
          .status(400)
          .json({ message: "timestampMs must be a non-negative finite number" });
      }
      if (typeof text !== "string" || !text.trim() || text.length > MAX_ANNOTATION_LEN) {
        return res
          .status(400)
          .json({ message: `text must be a non-empty string ≤ ${MAX_ANNOTATION_LEN} chars` });
      }

      const call = await storage.getCall(orgId, callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      const db = getDatabase();
      if (!db) {
        return res.status(503).json({ message: "Annotations require a database connection" });
      }

      const inserted = await addAnnotation(db, {
        id: randomUUID(),
        orgId,
        callId,
        timestampMs,
        text: text.trim(),
        author: req.user?.name || req.user?.username || "unknown",
      });

      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "annotation_added",
        resourceType: "annotation",
        resourceId: inserted.id,
      });

      return res.status(201).json(inserted);
    }),
  );

  app.delete(
    "/api/calls/:id/annotations/:annotationId",
    requireAuth,
    injectOrgContext,
    validateUUIDParam("id"),
    validateUUIDParam("annotationId"),
    asyncHandler(async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const { id: callId, annotationId } = req.params;

      const db = getDatabase();
      if (!db) {
        return res.status(503).json({ message: "Annotations require a database connection" });
      }

      const existing = await getAnnotationById(db, orgId, annotationId);
      if (!existing || existing.callId !== callId) {
        return res.status(404).json({ message: "Annotation not found" });
      }

      // Author-or-manager check. Author column stored display name (req.user.name)
      // with username fallback, so check both.
      const me = req.user?.name || req.user?.username || "";
      const isAuthor = existing.author === me;
      if (!isAuthor && !isManagerOrAdmin(req)) {
        return res
          .status(403)
          .json({ message: "Only the annotation's author or a manager can delete this annotation" });
      }

      await deleteAnnotation(db, orgId, annotationId);
      logPhiAccess({
        ...auditContext(req),
        timestamp: new Date().toISOString(),
        event: "annotation_deleted",
        resourceType: "annotation",
        resourceId: annotationId,
      });
      return res.json({ message: "Annotation deleted" });
    }),
  );
}
