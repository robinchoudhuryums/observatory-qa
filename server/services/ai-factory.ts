/**
 * Factory that selects the AI analysis provider based on configuration.
 *
 * Uses AWS Bedrock (Claude) as the sole AI provider.
 * Per-org model overrides are supported via OrgSettings.bedrockModel.
 *
 * Includes per-org rate limiting to prevent any single tenant from
 * exhausting the AWS Bedrock account-level concurrency quota.
 */
import type { AIAnalysisProvider } from "./ai-provider";
import { BedrockProvider } from "./bedrock";
import type { OrgSettings } from "@shared/schema";
import { logger } from "./logger";

function createProvider(modelOverride?: string): AIAnalysisProvider {
  const provider = new BedrockProvider(modelOverride);
  if (provider.isAvailable) return provider;

  logger.warn("AWS credentials not configured — AI analysis will use transcript-based defaults");
  return provider;
}

// Default global provider (used when no org-specific config exists)
export const aiProvider = createProvider();

// Cache of per-org providers to avoid re-creating on every call
const orgProviderCache = new Map<string, AIAnalysisProvider>();

/**
 * Get the AI provider for a specific organization.
 * Uses org settings for model override, falling back to global default.
 */
export function getOrgAIProvider(orgId: string, orgSettings?: OrgSettings | null): AIAnalysisProvider {
  if (!orgSettings?.bedrockModel) {
    return aiProvider; // Use global default
  }

  const cacheKey = `${orgId}:${orgSettings.bedrockModel}`;
  const cached = orgProviderCache.get(cacheKey);
  if (cached) return cached;

  const provider = new BedrockProvider(orgSettings.bedrockModel);
  const resolved = provider.isAvailable ? provider : aiProvider;
  orgProviderCache.set(cacheKey, resolved);
  return resolved;
}

// ==================== PER-ORG BEDROCK RATE LIMITER ====================

/**
 * Sliding-window rate limiter for Bedrock API calls per org.
 * Prevents any single org from exhausting the AWS account-level concurrency quota.
 *
 * Default: 5 concurrent requests per org, 20 requests per minute per org.
 */
const MAX_CONCURRENT_PER_ORG = parseInt(process.env.BEDROCK_MAX_CONCURRENT_PER_ORG || "5", 10);
const MAX_RPM_PER_ORG = parseInt(process.env.BEDROCK_MAX_RPM_PER_ORG || "20", 10);
const GLOBAL_MAX_CONCURRENT = parseInt(process.env.BEDROCK_GLOBAL_MAX_CONCURRENT || "50", 10);

// Track concurrent requests per org and globally
const orgConcurrent = new Map<string, number>();
const orgRequestTimestamps = new Map<string, number[]>();
let globalConcurrent = 0;

/**
 * Acquire a Bedrock request slot for an org. Returns true if allowed, false if rate limited.
 */
export function acquireBedrockSlot(orgId: string): boolean {
  // Check global concurrency
  if (globalConcurrent >= GLOBAL_MAX_CONCURRENT) {
    logger.warn({ orgId, globalConcurrent, limit: GLOBAL_MAX_CONCURRENT }, "Bedrock global concurrency limit reached");
    return false;
  }

  // Check per-org concurrency
  const current = orgConcurrent.get(orgId) || 0;
  if (current >= MAX_CONCURRENT_PER_ORG) {
    logger.warn({ orgId, concurrent: current, limit: MAX_CONCURRENT_PER_ORG }, "Bedrock per-org concurrency limit reached");
    return false;
  }

  // Check per-org requests per minute
  const now = Date.now();
  const windowStart = now - 60_000;
  let timestamps = orgRequestTimestamps.get(orgId) || [];
  timestamps = timestamps.filter(ts => ts > windowStart);
  if (timestamps.length >= MAX_RPM_PER_ORG) {
    logger.warn({ orgId, rpm: timestamps.length, limit: MAX_RPM_PER_ORG }, "Bedrock per-org RPM limit reached");
    orgRequestTimestamps.set(orgId, timestamps);
    return false;
  }

  // Acquire slot
  orgConcurrent.set(orgId, current + 1);
  globalConcurrent++;
  timestamps.push(now);
  orgRequestTimestamps.set(orgId, timestamps);
  return true;
}

/**
 * Release a Bedrock request slot for an org. Call this when a request completes.
 */
export function releaseBedrockSlot(orgId: string): void {
  const current = orgConcurrent.get(orgId) || 0;
  if (current <= 1) orgConcurrent.delete(orgId);
  else orgConcurrent.set(orgId, current - 1);
  globalConcurrent = Math.max(0, globalConcurrent - 1);
}

/**
 * Wrap a Bedrock call with rate limiting. Throws if rate limited.
 */
export async function withBedrockRateLimit<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  if (!acquireBedrockSlot(orgId)) {
    throw new Error("Bedrock rate limit exceeded for organization. Please try again shortly.");
  }
  try {
    return await fn();
  } finally {
    releaseBedrockSlot(orgId);
  }
}

// Clean up stale RPM timestamps every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  orgRequestTimestamps.forEach((timestamps, orgId) => {
    const filtered = timestamps.filter((ts: number) => ts > cutoff);
    if (filtered.length === 0) orgRequestTimestamps.delete(orgId);
    else orgRequestTimestamps.set(orgId, filtered);
  });
}, 2 * 60_000).unref();
