/**
 * Dashboard cache invalidation.
 *
 * Extracted from routes/dashboard.ts so that services (e.g. call-processing)
 * can invalidate the dashboard cache without importing a route module.
 */
import { getRedis } from "./redis";

/** Invalidate all dashboard caches for an org (call after a call completes or is deleted). */
export async function invalidateDashboardCache(orgId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const keys = [`dashboard:metrics:${orgId}`, `dashboard:sentiment:${orgId}`];
    // Also invalidate performers cache (keyed with limit suffix)
    const performerKeys = await redis.keys(`dashboard:performers:${orgId}:*`);
    keys.push(...performerKeys);
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    /* Redis unavailable — skip */
  }
}
