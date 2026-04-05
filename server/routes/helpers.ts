import multer from "multer";
import path from "path";
import fs from "fs";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger";

// Re-export pure utility functions from server/utils/helpers.ts
// so that existing route-file imports (`from "../routes/helpers"`) continue to work.
export { safeFloat, safeInt, withRetry, parseDateParam, parsePagination } from "../utils/helpers";

// --- Validation middleware ---

/** UUID v4 regex for validating :id params */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware to validate that a URL parameter is a valid UUID.
 * Returns 400 if the parameter is not a valid UUID v4 format.
 */
export function validateUUIDParam(paramName = "id") {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    if (value && !UUID_REGEX.test(value)) {
      res.status(400).json({ message: `Invalid ${paramName} format` });
      return;
    }
    next();
  };
}

/**
 * Apply pagination to an in-memory array and return paginated response shape.
 */
export function paginateArray<T>(
  items: T[],
  limit: number,
  offset: number,
): { data: T[]; total: number; limit: number; offset: number; hasMore: boolean } {
  const total = items.length;
  const data = items.slice(offset, offset + limit);
  return { data, total, limit, offset, hasMore: offset + limit < total };
}

/**
 * Per-org concurrent upload limiter.
 * Prevents a single org from consuming all upload slots.
 */
const orgUploadCounts = new Map<string, number>();
const MAX_CONCURRENT_UPLOADS_PER_ORG = 5;

export function acquireUploadSlot(orgId: string): boolean {
  const current = orgUploadCounts.get(orgId) || 0;
  if (current >= MAX_CONCURRENT_UPLOADS_PER_ORG) return false;
  orgUploadCounts.set(orgId, current + 1);
  return true;
}

export function releaseUploadSlot(orgId: string): void {
  const current = orgUploadCounts.get(orgId) || 0;
  if (current <= 1) orgUploadCounts.delete(orgId); // Clean up entry when at 0 or 1
  else orgUploadCounts.set(orgId, current - 1);
  // Safety: if somehow called when count is already 0, delete ensures no negative values
}

/**
 * Periodic cleanup of orphaned temp files in the uploads directory.
 * Files older than 1 hour are removed (normal processing completes in minutes).
 */
const ORPHAN_FILE_AGE_MS = 60 * 60 * 1000; // 1 hour

export function startUploadCleanup(): void {
  const interval = setInterval(
    async () => {
      try {
        const files = await fs.promises.readdir(uploadsDir);
        const now = Date.now();
        for (const file of files) {
          const filePath = path.join(uploadsDir, file);
          try {
            const stats = await fs.promises.stat(filePath);
            if (now - stats.mtimeMs > ORPHAN_FILE_AGE_MS) {
              await fs.promises.unlink(filePath);
            }
          } catch {
            /* file may have been removed between readdir and stat */
          }
        }
      } catch {
        /* uploads dir may not exist */
      }
    },
    30 * 60 * 1000,
  ); // Every 30 minutes
  interval.unref();
}

// Ensure uploads directory exists
const uploadsDir = "uploads";
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
export const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit (reasonable for audio files)
  },
  fileFilter: (req, file, cb) => {
    // Validate both file extension and MIME type
    const allowedTypes = [".mp3", ".wav", ".m4a", ".mp4", ".flac", ".ogg"];
    const allowedMimeTypes = [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/mp4",
      "audio/x-m4a",
      "audio/m4a",
      "audio/flac",
      "audio/x-flac",
      "audio/ogg",
      "audio/vorbis",
      "video/mp4",
      "application/octet-stream",
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = allowedMimeTypes.includes(file.mimetype);
    if (allowedTypes.includes(ext) && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only audio files (MP3, WAV, M4A, MP4, FLAC, OGG) are allowed."), false);
    }
  },
});

// ─── Upload deduplication lock ───────────────────────────────────────────────
// Prevents TOCTOU race when two concurrent uploads have the same file hash.
// Uses Redis SET NX (atomic "set if not exists") with 30-second TTL.
// Falls back to in-memory Map when Redis is unavailable.
const memLocks = new Map<string, number>(); // key → expiresAt timestamp

export async function acquireUploadLock(lockKey: string, ttlMs = 30_000): Promise<boolean> {
  try {
    const { getRedis } = await import("../services/redis");
    const redis = getRedis();
    if (redis?.status === "ready") {
      // SET NX: only sets if key doesn't exist (atomic). Returns "OK" on success, null if already locked.
      const result = await redis.set(lockKey, "1", "PX", ttlMs, "NX");
      return result === "OK";
    }
  } catch {
    // Redis unavailable — fall through to in-memory
  }

  // In-memory fallback (single-instance only)
  const now = Date.now();
  const existing = memLocks.get(lockKey);
  if (existing && existing > now) return false; // Lock held
  memLocks.set(lockKey, now + ttlMs);
  return true;
}

/** Release an upload dedup lock early (call after createCall succeeds). */
export async function releaseUploadLock(lockKey: string): Promise<void> {
  try {
    const { getRedis } = await import("../services/redis");
    const redis = getRedis();
    if (redis?.status === "ready") {
      await redis.del(lockKey);
      return;
    }
  } catch {
    // Redis unavailable — fall through to in-memory
  }
  memLocks.delete(lockKey);
}
