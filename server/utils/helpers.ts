/**
 * Pure utility functions shared across server code.
 *
 * These functions have NO dependencies on Express, route handlers, or storage.
 * They are safe to import from services, workers, and route layers.
 */
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
