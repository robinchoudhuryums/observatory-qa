/**
 * Redis client and utilities for multi-tenant SaaS.
 *
 * Provides:
 * - Shared Redis connection (for sessions, rate limiting, pub/sub)
 * - Session store factory (connect-redis)
 * - Distributed rate limiter (replaces in-memory Map)
 * - Pub/Sub for cross-instance WebSocket broadcasting
 *
 * Falls back gracefully when REDIS_URL is not configured.
 */
import Redis from "ioredis";
import { RedisStore } from "connect-redis";
import type session from "express-session";
import { logger } from "./logger";

let redisClient: Redis | null = null;
let subscriberClient: Redis | null = null;

/**
 * Initialize Redis connection. Returns null if REDIS_URL is not set.
 */
export function initRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn("REDIS_URL not set — using in-memory fallbacks for sessions and rate limiting");
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null; // Stop retrying
        return Math.min(times * 200, 2000);
      },
      // TLS is negotiated automatically when REDIS_URL uses the rediss:// scheme
    });

    redisClient.on("error", (err) => {
      logger.error({ err }, "Redis connection error");
    });

    redisClient.on("connect", () => {
      logger.info("Redis connected");
    });

    return redisClient;
  } catch (error) {
    logger.error({ err: error }, "Failed to initialize Redis");
    return null;
  }
}

/**
 * Get the Redis client instance. Returns null if not initialized.
 */
export function getRedis(): Redis | null {
  return redisClient;
}

/**
 * Adapter that wraps an ioredis client to match the node-redis v5 API
 * expected by connect-redis v9 (which passes { expiration: { type, value } }
 * to set() instead of positional "EX", ttl args).
 */
function ioredisAdapter(client: Redis) {
  return {
    get: (key: string) => client.get(key),
    set: (key: string, val: string, opts?: { expiration?: { type: string; value: number } }) => {
      if (opts?.expiration) {
        return client.set(key, val, opts.expiration.type as "EX", opts.expiration.value);
      }
      return client.set(key, val);
    },
    del: (key: string) => client.del(key),
    expire: (key: string, ttl: number) => client.expire(key, ttl),
    scanIterator: (opts: { MATCH: string; COUNT: number }) => {
      // connect-redis uses this for destroy-all; provide a basic async iterator
      let cursor = "0";
      let done = false;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (done) return { done: true, value: undefined };
              const [nextCursor, keys] = await client.scan(cursor, "MATCH", opts.MATCH, "COUNT", opts.COUNT);
              cursor = nextCursor;
              if (cursor === "0") done = true;
              return { done: false, value: keys };
            },
          };
        },
      };
    },
  };
}

/**
 * Create a Redis-backed session store (connect-redis).
 * Falls back to null if Redis is unavailable (caller should use MemoryStore).
 */
export function createRedisSessionStore(sessionModule: typeof session): InstanceType<typeof RedisStore> | null {
  if (!redisClient) return null;

  try {
    const store = new RedisStore({
      client: ioredisAdapter(redisClient) as any,
      prefix: "observatory:sess:",
      ttl: 15 * 60, // 15 min idle timeout (matches HIPAA session config)
    });
    logger.info("Redis session store initialized");
    return store;
  } catch (error) {
    logger.error({ err: error }, "Failed to create Redis session store");
    return null;
  }
}

/**
 * Distributed rate limiter backed by Redis.
 * Uses sliding window algorithm for accurate rate limiting across instances.
 */
export async function checkRateLimit(
  key: string,
  windowMs: number,
  maxRequests: number,
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  if (!redisClient) {
    // Fallback: always allow (in-memory rate limiter handles this case)
    return { allowed: true, remaining: maxRequests, resetMs: 0 };
  }

  const windowKey = `observatory:rl:${key}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    // Use a Redis pipeline for atomicity
    const pipeline = redisClient.pipeline();
    // Remove old entries outside the window
    pipeline.zremrangebyscore(windowKey, 0, windowStart);
    // Count current entries
    pipeline.zcard(windowKey);
    // Add current request
    pipeline.zadd(windowKey, now.toString(), `${now}:${Math.random()}`);
    // Set expiry on the key
    pipeline.pexpire(windowKey, windowMs);

    const results = await pipeline.exec();
    const currentCount = (results?.[1]?.[1] as number) || 0;

    if (currentCount >= maxRequests) {
      // Get the oldest entry to determine reset time
      const oldest = await redisClient.zrange(windowKey, 0, 0, "WITHSCORES");
      const resetMs = oldest.length >= 2 ? parseInt(oldest[1]) + windowMs - now : windowMs;
      return { allowed: false, remaining: 0, resetMs };
    }

    return {
      allowed: true,
      remaining: maxRequests - currentCount - 1,
      resetMs: windowMs,
    };
  } catch (error) {
    logger.error({ err: error }, "Redis rate limit check failed — allowing request");
    return { allowed: true, remaining: maxRequests, resetMs: 0 };
  }
}

/**
 * Get a Redis subscriber client for pub/sub (separate connection required by Redis).
 */
export function getSubscriberClient(): Redis | null {
  if (!redisClient) return null;

  if (!subscriberClient) {
    subscriberClient = redisClient.duplicate();
    subscriberClient.on("error", (err) => {
      logger.error({ err }, "Redis subscriber error");
    });
  }
  return subscriberClient;
}

/**
 * Publish a message to a Redis channel (for cross-instance WebSocket broadcasting).
 */
export async function publishMessage(channel: string, message: string): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.publish(channel, message);
  } catch (error) {
    logger.error({ err: error, channel }, "Failed to publish Redis message");
  }
}

/**
 * Check if Redis is required for the current environment.
 * Returns true when NODE_ENV=production AND REDIS_URL is set, or when REQUIRE_REDIS=true.
 */
export function isRedisRequired(): boolean {
  if (process.env.REQUIRE_REDIS === "true") return true;
  return process.env.NODE_ENV === "production" && !!process.env.REDIS_URL;
}

/**
 * Get the current Redis status including connection state, mode, and uptime.
 */
export function getRedisStatus(): { connected: boolean; mode: "distributed" | "in-memory"; uptime: number } {
  const connected = redisClient !== null && redisClient.status === "ready";
  return {
    connected,
    mode: connected ? "distributed" : "in-memory",
    uptime: Math.floor(process.uptime()),
  };
}

/**
 * Invalidate all sessions for a specific user by scanning Redis session keys.
 * Uses SCAN (non-blocking) instead of KEYS to avoid Redis event loop stalls.
 * Returns the number of sessions destroyed, or 0 if Redis is unavailable.
 *
 * Used after: password reset, account deactivation, admin password change.
 */
export async function invalidateUserSessions(userId: string): Promise<number> {
  if (!redisClient) return 0;

  try {
    let cursor = "0";
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redisClient.scan(cursor, "MATCH", "sess:*", "COUNT", 100);
      cursor = nextCursor;
      for (const key of keys) {
        try {
          const sessionData = await redisClient.get(key);
          if (sessionData) {
            const parsed = JSON.parse(sessionData);
            if (parsed?.passport?.user === userId) {
              await redisClient.del(key);
              deleted++;
            }
          }
        } catch {
          /* skip unparseable sessions */
        }
      }
    } while (cursor !== "0");
    return deleted;
  } catch {
    return 0;
  }
}

// ── Ephemeral key-value store (Redis-backed with in-memory fallback) ──────
// Used by OIDC state, email OTP, and other short-lived session data.
// Falls back to in-memory Map when Redis is unavailable (single-instance only).

const memFallback = new Map<string, { value: string; expiresAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of Array.from(memFallback)) {
    if (v.expiresAt < now) memFallback.delete(k);
  }
}, 60_000).unref();

/**
 * Store a value with automatic TTL expiry. Uses Redis when available.
 * Key is prefixed with `prefix:` to namespace different use cases.
 */
export async function ephemeralSet(prefix: string, key: string, value: string, ttlMs: number): Promise<void> {
  const fullKey = `${prefix}:${key}`;
  if (redisClient?.status === "ready") {
    await redisClient.set(fullKey, value, "PX", ttlMs);
  } else {
    memFallback.set(fullKey, { value, expiresAt: Date.now() + ttlMs });
  }
}

/** Retrieve and delete a value (consume-once pattern). Returns null if not found or expired. */
export async function ephemeralConsume(prefix: string, key: string): Promise<string | null> {
  const fullKey = `${prefix}:${key}`;
  if (redisClient?.status === "ready") {
    const val = await redisClient.get(fullKey);
    if (val) await redisClient.del(fullKey);
    return val;
  }
  const entry = memFallback.get(fullKey);
  memFallback.delete(fullKey);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  return null;
}

/** Get a value without consuming it. Returns null if not found or expired. */
export async function ephemeralGet(prefix: string, key: string): Promise<string | null> {
  const fullKey = `${prefix}:${key}`;
  if (redisClient?.status === "ready") {
    return await redisClient.get(fullKey);
  }
  const entry = memFallback.get(fullKey);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  return null;
}

/**
 * Atomically set a value with TTL only if the key doesn't already exist.
 * Returns true if the value was set (first writer), false if a value already
 * existed (loser of race). Use for idempotency guards where two concurrent
 * writers must agree on a single winner — e.g. Stripe webhook dedup, locks.
 *
 * In-memory fallback implements the same check-and-set atomically within
 * the single-threaded event loop.
 */
export async function ephemeralSetNx(
  prefix: string,
  key: string,
  value: string,
  ttlMs: number,
): Promise<boolean> {
  const fullKey = `${prefix}:${key}`;
  if (redisClient?.status === "ready") {
    // ioredis: SET key value PX ttl NX -> "OK" on success, null if not set
    const result = await redisClient.set(fullKey, value, "PX", ttlMs, "NX");
    return result === "OK";
  }
  // In-memory fallback: Node's single-threaded event loop makes this atomic
  // because no other async tick can run between the get and set below.
  const now = Date.now();
  const existing = memFallback.get(fullKey);
  if (existing && existing.expiresAt > now) return false;
  memFallback.set(fullKey, { value, expiresAt: now + ttlMs });
  return true;
}

/** Delete a value. */
export async function ephemeralDel(prefix: string, key: string): Promise<void> {
  const fullKey = `${prefix}:${key}`;
  if (redisClient?.status === "ready") {
    await redisClient.del(fullKey);
  } else {
    memFallback.delete(fullKey);
  }
}

/**
 * Atomically increment a counter with TTL. Used for rate limiting where we
 * need "5 attempts per 15 minutes" semantics: INCR on Redis is atomic, and
 * on the first increment we also set the TTL via EXPIRE.
 *
 * Returns the post-increment count. When Redis is unavailable, falls back to
 * an in-memory counter that is single-instance only (documented limitation).
 *
 * Example:
 *   const count = await ephemeralIncrement("mfa-attempts", userId, 15*60*1000);
 *   if (count > 5) { return 429; }
 */
export async function ephemeralIncrement(prefix: string, key: string, ttlMs: number): Promise<number> {
  const fullKey = `${prefix}:${key}`;
  if (redisClient?.status === "ready") {
    // Atomic INCR. If this is the first increment (result === 1), also set TTL.
    const count = await redisClient.incr(fullKey);
    if (count === 1) {
      await redisClient.pexpire(fullKey, ttlMs);
    }
    return count;
  }
  // In-memory fallback: Node's single-threaded event loop guarantees atomicity
  // between the read and write below. Single-instance only.
  const now = Date.now();
  const existing = memFallback.get(fullKey);
  if (!existing || existing.expiresAt <= now) {
    memFallback.set(fullKey, { value: "1", expiresAt: now + ttlMs });
    return 1;
  }
  const nextCount = parseInt(existing.value, 10) + 1;
  // Keep the original expiry — don't reset the window on each increment,
  // otherwise an attacker could maintain the window indefinitely.
  memFallback.set(fullKey, { value: String(nextCount), expiresAt: existing.expiresAt });
  return nextCount;
}

/**
 * Clean up Redis connections on shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (subscriberClient) {
    await subscriberClient.quit();
    subscriberClient = null;
  }
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  logger.info("Redis connections closed");
}
