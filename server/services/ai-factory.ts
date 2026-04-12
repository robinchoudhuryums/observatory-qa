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

// Cache of per-org providers to avoid re-creating on every call.
// LRU eviction ensures frequently-used orgs stay cached while inactive ones are dropped.
import { LruCache } from "../utils/lru-cache";

const orgProviderCache = new LruCache<AIAnalysisProvider>({
  maxSize: 200,
  ttlMs: 30 * 60 * 1000, // 30 min TTL — re-creates provider when org changes bedrockModel
});

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
    logger.warn(
      { orgId, concurrent: current, limit: MAX_CONCURRENT_PER_ORG },
      "Bedrock per-org concurrency limit reached",
    );
    return false;
  }

  // Check per-org requests per minute
  const now = Date.now();
  const windowStart = now - 60_000;
  let timestamps = orgRequestTimestamps.get(orgId) || [];
  timestamps = timestamps.filter((ts) => ts > windowStart);
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

// ==================== CIRCUIT BREAKER (PER-ORG) ====================

/**
 * Per-org circuit breaker for Bedrock API calls.
 *
 * Each org has its own circuit breaker state so one noisy tenant's rate limits
 * or failures don't disable AI analysis for other tenants. A global circuit
 * breaker is also maintained — if ALL orgs are failing (Bedrock-wide outage),
 * the global breaker opens and fast-fails all requests regardless of per-org state.
 *
 * States: CLOSED → normal operation
 *         OPEN   → fast-fail, no calls reach Bedrock
 *         HALF_OPEN → single probe allowed to test recovery
 */
const CIRCUIT_FAILURE_THRESHOLD = parseInt(process.env.BEDROCK_CIRCUIT_THRESHOLD || "5", 10);
const CIRCUIT_RESET_MS = parseInt(process.env.BEDROCK_CIRCUIT_RESET_MS || "60000", 10); // 1 min
const GLOBAL_CIRCUIT_FAILURE_THRESHOLD = parseInt(process.env.BEDROCK_GLOBAL_CIRCUIT_THRESHOLD || "15", 10);

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface OrgCircuitBreaker {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  halfOpenProbeInFlight: boolean;
}

const orgCircuitBreakers = new Map<string, OrgCircuitBreaker>();

// Global circuit breaker — trips on platform-wide Bedrock outages
let globalCircuit: OrgCircuitBreaker = {
  state: "CLOSED",
  consecutiveFailures: 0,
  openedAt: null,
  halfOpenProbeInFlight: false,
};

function getOrgCircuit(orgId: string): OrgCircuitBreaker {
  let cb = orgCircuitBreakers.get(orgId);
  if (!cb) {
    cb = { state: "CLOSED", consecutiveFailures: 0, openedAt: null, halfOpenProbeInFlight: false };
    orgCircuitBreakers.set(orgId, cb);
  }
  return cb;
}

function recordCircuitSuccess(cb: OrgCircuitBreaker, label: string): void {
  if (cb.state !== "CLOSED") {
    logger.info({ previousState: cb.state, label }, "Bedrock circuit breaker: closing after successful probe");
  }
  cb.state = "CLOSED";
  cb.consecutiveFailures = 0;
  cb.openedAt = null;
  cb.halfOpenProbeInFlight = false;
}

function recordCircuitFailure(cb: OrgCircuitBreaker, threshold: number, label: string): void {
  cb.consecutiveFailures++;
  cb.halfOpenProbeInFlight = false;
  if (cb.state === "CLOSED" && cb.consecutiveFailures >= threshold) {
    cb.state = "OPEN";
    cb.openedAt = Date.now();
    logger.error(
      { consecutiveFailures: cb.consecutiveFailures, resetMs: CIRCUIT_RESET_MS, label },
      "Bedrock circuit breaker OPENED — AI analysis will fast-fail until Bedrock recovers",
    );
  } else if (cb.state === "HALF_OPEN") {
    cb.state = "OPEN";
    cb.openedAt = Date.now();
    logger.warn({ label }, "Bedrock circuit breaker: probe failed, re-opening circuit");
  }
}

/**
 * Get circuit breaker decision AND atomically claim the probe slot if applicable.
 * Safe in Node.js single-threaded model: no await between check and set.
 */
function getCircuitDecisionFor(cb: OrgCircuitBreaker): "allow" | "reject" | "probe" {
  if (cb.state === "CLOSED") return "allow";
  if (cb.state === "HALF_OPEN") {
    if (cb.halfOpenProbeInFlight) return "reject";
    cb.halfOpenProbeInFlight = true;
    return "probe";
  }
  // OPEN — check if reset window has passed
  if (cb.openedAt && Date.now() - cb.openedAt >= CIRCUIT_RESET_MS) {
    cb.state = "HALF_OPEN";
    cb.halfOpenProbeInFlight = true;
    return "probe";
  }
  return "reject";
}

/** Expose circuit state for health checks and monitoring. */
export function getBedrockCircuitState(orgId?: string): {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  global: { state: CircuitState; consecutiveFailures: number; openedAt: number | null };
} {
  const orgCb = orgId ? getOrgCircuit(orgId) : globalCircuit;
  return {
    state: orgCb.state,
    consecutiveFailures: orgCb.consecutiveFailures,
    openedAt: orgCb.openedAt,
    global: { state: globalCircuit.state, consecutiveFailures: globalCircuit.consecutiveFailures, openedAt: globalCircuit.openedAt },
  };
}

/**
 * Wrap a Bedrock call with both rate limiting and circuit breaker protection.
 *
 * Checks the per-org circuit breaker first, then the global breaker.
 * On success, both the per-org and global breakers record success.
 * On failure, only the calling org's breaker and the global breaker are affected.
 */
export async function withBedrockProtection<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  // Check per-org circuit breaker first
  const orgCb = getOrgCircuit(orgId);
  const orgDecision = getCircuitDecisionFor(orgCb);

  if (orgDecision === "reject") {
    const openedSecondsAgo = orgCb.openedAt ? Math.round((Date.now() - orgCb.openedAt) / 1000) : 0;
    throw new Error(
      `Bedrock circuit breaker is OPEN for this organization (opened ${openedSecondsAgo}s ago, resets after ${CIRCUIT_RESET_MS / 1000}s). AI analysis temporarily unavailable.`,
    );
  }

  // Check global circuit breaker (platform-wide outage detection)
  const globalDecision = getCircuitDecisionFor(globalCircuit);

  if (globalDecision === "reject") {
    // Undo per-org probe claim if we're rejecting globally
    if (orgDecision === "probe") orgCb.halfOpenProbeInFlight = false;
    const openedSecondsAgo = globalCircuit.openedAt ? Math.round((Date.now() - globalCircuit.openedAt) / 1000) : 0;
    throw new Error(
      `Bedrock circuit breaker is OPEN globally (opened ${openedSecondsAgo}s ago, resets after ${CIRCUIT_RESET_MS / 1000}s). AI analysis temporarily unavailable.`,
    );
  }

  if (orgDecision === "probe" || globalDecision === "probe") {
    logger.info({ orgId, orgProbe: orgDecision === "probe", globalProbe: globalDecision === "probe" }, "Bedrock circuit breaker: allowing probe request (HALF_OPEN)");
  }

  if (!acquireBedrockSlot(orgId)) {
    if (orgDecision === "probe") orgCb.halfOpenProbeInFlight = false;
    if (globalDecision === "probe") globalCircuit.halfOpenProbeInFlight = false;
    throw new Error("Bedrock rate limit exceeded for organization. Please try again shortly.");
  }

  try {
    const result = await fn();
    recordCircuitSuccess(orgCb, `org:${orgId}`);
    recordCircuitSuccess(globalCircuit, "global");
    return result;
  } catch (err) {
    recordCircuitFailure(orgCb, CIRCUIT_FAILURE_THRESHOLD, `org:${orgId}`);
    recordCircuitFailure(globalCircuit, GLOBAL_CIRCUIT_FAILURE_THRESHOLD, "global");
    throw err;
  } finally {
    releaseBedrockSlot(orgId);
  }
}

// Clean up stale per-org circuit breakers every 5 minutes
setInterval(() => {
  const now = Date.now();
  orgCircuitBreakers.forEach((cb, orgId) => {
    // Remove CLOSED breakers that haven't had activity (no failures tracked)
    if (cb.state === "CLOSED" && cb.consecutiveFailures === 0) {
      orgCircuitBreakers.delete(orgId);
    }
    // Auto-transition stale OPEN breakers to HALF_OPEN so they don't block forever
    // if no requests arrive to trigger the transition
    if (cb.state === "OPEN" && cb.openedAt && now - cb.openedAt >= CIRCUIT_RESET_MS * 3) {
      cb.state = "HALF_OPEN";
    }
  });
}, 5 * 60_000).unref();

// Clean up stale RPM timestamps every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  orgRequestTimestamps.forEach((timestamps, orgId) => {
    const filtered = timestamps.filter((ts: number) => ts > cutoff);
    if (filtered.length === 0) orgRequestTimestamps.delete(orgId);
    else orgRequestTimestamps.set(orgId, filtered);
  });
}, 2 * 60_000).unref();
