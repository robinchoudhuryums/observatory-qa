/**
 * Sliding-window rate limiting middleware.
 *
 * Lives in its own module so unit tests can exercise the in-memory limiter
 * directly without booting the production server (`server/index.ts` runs
 * port-binding, scheduler, and queue setup at import time).
 *
 * Two front doors:
 *
 *   - `inMemoryRateLimit(windowMs, max, includeOrg?)` — pure in-process
 *     sliding-window counter keyed by `IP[:org_<id>]:<normalized_path>`.
 *     Always synchronous. Used for the test suite, and as the fallback
 *     path for production when Redis is unreachable.
 *
 *   - `distributedRateLimit(windowMs, max, includeOrg?)` — Redis-backed
 *     limiter via `services/redis.ts`. Falls through to `inMemoryRateLimit`
 *     when `setRedisAvailable(false)` (the default until boot completes).
 *
 * Both emit `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
 * headers, and `Retry-After` when blocking. Hard-cap of `MAX_RATE_LIMIT_ENTRIES`
 * keys with FIFO eviction prevents unbounded growth under attack.
 */
import type { Request, Response, NextFunction } from "express";
import { checkRateLimit } from "../services/redis";

/** Match a UUID embedded in a path (so `/calls/<uuid>/audio` rate-limits as `/calls/:id/audio`). */
const UUID_SEGMENT_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Hard cap on the in-memory counter map; oldest entry is evicted FIFO when at capacity. */
export const MAX_RATE_LIMIT_ENTRIES = 50_000;

/**
 * In-process sliding-window state. Exported for test reset only — the
 * middleware factories below close over the same Map.
 */
export const rateLimitMap = new Map<string, number[]>();

/** Reset for tests. Production callers don't need this. */
export function _resetRateLimitState(): void {
  rateLimitMap.clear();
}

/**
 * Build the limiter key. Normalizes UUID path segments to `:id` so cycling
 * call IDs can't bypass the limit. Includes `req.orgId` for authenticated
 * data routes so two tenants behind the same NAT don't block each other.
 */
export function rateLimitKey(req: Request, includeOrg: boolean): string {
  const orgPart = includeOrg && req.orgId ? `:org:${req.orgId}` : "";
  const normalizedPath = req.path.replace(UUID_SEGMENT_RE, "/:id");
  return `${req.ip}:${normalizedPath}${orgPart}`;
}

export function setRateLimitHeaders(res: Response, limit: number, remaining: number, resetSeconds: number): void {
  res.setHeader("X-RateLimit-Limit", limit.toString());
  res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining).toString());
  res.setHeader("X-RateLimit-Reset", Math.ceil(resetSeconds).toString());
}

export function inMemoryRateLimit(windowMs: number, maxRequests: number, includeOrg = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = rateLimitKey(req, includeOrg);
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = rateLimitMap.get(key) || [];
    timestamps = timestamps.filter((ts) => ts > windowStart);

    const resetSeconds = timestamps.length > 0 ? (timestamps[0] + windowMs - now) / 1000 : windowMs / 1000;

    if (timestamps.length >= maxRequests) {
      rateLimitMap.set(key, timestamps);
      setRateLimitHeaders(res, maxRequests, 0, resetSeconds);
      res.setHeader("Retry-After", Math.ceil(resetSeconds).toString());
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }

    timestamps.push(now);
    if (rateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES && !rateLimitMap.has(key)) {
      // Evict oldest entry when at capacity (insertion-order Map = FIFO).
      const oldest = rateLimitMap.keys().next().value;
      if (oldest) rateLimitMap.delete(oldest);
    }
    rateLimitMap.set(key, timestamps);

    setRateLimitHeaders(res, maxRequests, maxRequests - timestamps.length, resetSeconds);
    return next();
  };
}

let redisAvailable = false;

/** Flipped to true once `initRedis()` succeeds. Tests should leave this false. */
export function setRedisAvailable(available: boolean): void {
  redisAvailable = available;
}

export function distributedRateLimit(windowMs: number, maxRequests: number, includeOrg = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redisAvailable) {
      return inMemoryRateLimit(windowMs, maxRequests, includeOrg)(req, res, next);
    }

    const key = rateLimitKey(req, includeOrg);
    try {
      const result = await checkRateLimit(key, windowMs, maxRequests);
      const resetSeconds = Math.ceil(result.resetMs / 1000);
      setRateLimitHeaders(res, maxRequests, result.remaining, resetSeconds);
      if (!result.allowed) {
        res.setHeader("Retry-After", resetSeconds.toString());
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }
      return next();
    } catch {
      // Redis transient failure — fail open rather than denying legitimate traffic.
      return next();
    }
  };
}

/**
 * Periodic GC for the in-memory counter Map. Returns the timer so the
 * server can clear it during graceful shutdown. Cleared keys whose
 * timestamps are all older than 1 hour (the longest registration window).
 */
export function startRateLimitCleanup(): NodeJS.Timeout {
  return setInterval(
    () => {
      const now = Date.now();
      const maxWindowMs = 60 * 60 * 1000;
      rateLimitMap.forEach((timestamps, key) => {
        const filtered = timestamps.filter((ts) => ts > now - maxWindowMs);
        if (filtered.length === 0) {
          rateLimitMap.delete(key);
        } else {
          rateLimitMap.set(key, filtered);
        }
      });
    },
    5 * 60 * 1000,
  );
}
