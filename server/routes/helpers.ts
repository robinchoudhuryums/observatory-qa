import multer from "multer";
import path from "path";
import fs from "fs";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger";

/** Parse a numeric value safely, returning fallback if NaN or non-finite. */
export function safeFloat(val: unknown, fallback = 0): number {
  const num = parseFloat(String(val ?? fallback));
  return Number.isFinite(num) ? num : fallback;
}

export function safeInt(val: unknown, fallback = 0): number {
  const num = parseInt(String(val ?? fallback), 10);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Retry an async operation with exponential backoff.
 * Useful for transient failures in AI/transcription services.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelay?: number; label?: string } = {},
): Promise<T> {
  const { retries = 2, baseDelay = 1000, label = "operation" } = opts;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(
          { label, attempt: attempt + 1, maxAttempts: retries + 1, delayMs: delay, err: lastError },
          "Retrying failed operation",
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

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
 * Parse and validate a date query parameter. Returns undefined if absent or invalid.
 */
export function parseDateParam(val: unknown): Date | undefined {
  if (!val || typeof val !== "string") return undefined;
  const date = new Date(val);
  if (isNaN(date.getTime())) return undefined;
  return date;
}

/**
 * Extract pagination params from query string with safe defaults.
 * Returns { limit, offset } clamped to reasonable bounds.
 */
export function parsePagination(
  query: Record<string, unknown>,
  defaults: { limit?: number; maxLimit?: number } = {},
): { limit: number; offset: number } {
  const maxLimit = defaults.maxLimit ?? 500;
  const defaultLimit = defaults.limit ?? 100;
  const limit = Math.min(Math.max(safeInt(query.limit, defaultLimit), 1), maxLimit);
  const offset = Math.max(safeInt(query.offset, 0), 0);
  return { limit, offset };
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
  if (current <= 1) orgUploadCounts.delete(orgId);
  else orgUploadCounts.set(orgId, current - 1);
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
