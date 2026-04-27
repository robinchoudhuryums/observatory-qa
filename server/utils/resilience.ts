/**
 * Resilience utilities for external service calls.
 *
 * Tier 1B of the CallAnalyzer adaptation plan. Adapted from CA's
 * `server/services/resilience.ts`.
 *
 * Provides:
 *   - CircuitBreaker: prevents cascading failures when a service is down.
 *     After N consecutive failures, the circuit opens and rejects calls
 *     immediately for a cooldown period. After the cooldown, one test call
 *     is allowed through (half-open). If it succeeds, the circuit closes;
 *     if it fails, it re-opens.
 *   - PerKeyCircuitBreaker: keyed variant for "one breaker per upstream"
 *     scenarios (e.g., per-webhook-id, per-AssemblyAI-account). Independent
 *     state per key with bounded LRU eviction.
 *   - CircuitBreakerOpenError: thrown when execute() is called while the
 *     breaker is open. Lets callers distinguish "rejected by policy" from
 *     "fn threw upstream error" without string-matching.
 *
 * Note: Observatory already has a Bedrock-specific circuit breaker
 * (`withBedrockProtection` in `services/ai-factory.ts`) with per-org +
 * global state. This module is the GENERAL primitive for other external
 * integrations (AssemblyAI, outbound webhooks, future external APIs).
 *
 * The Bedrock-specific one is intentionally kept separate — it has org
 * affinity and lifecycle semantics tuned for Bedrock that don't apply
 * to other upstreams.
 */
import { logger } from "../services/logger";

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export type CircuitState = "closed" | "open" | "half-open";

/**
 * Thrown by `CircuitBreaker.execute()` when the breaker is open at the time
 * of the call. Use `instanceof CircuitBreakerOpenError` to distinguish
 * "rejected by open circuit" from "upstream returned an error" without
 * relying on string-matching.
 */
export class CircuitBreakerOpenError extends Error {
  readonly label: string;
  readonly failureCount: number;

  constructor(label: string, failureCount: number) {
    super(
      `Circuit breaker [${label}] is open — call rejected (${failureCount} consecutive failures, cooling down)`,
    );
    this.name = "CircuitBreakerOpenError";
    this.label = label;
    this.failureCount = failureCount;
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly label: string,
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 30_000,
  ) {}

  /**
   * Get current state. Side effect: transitions open → half-open if the
   * reset window has elapsed.
   */
  getState(): CircuitState {
    if (this.state === "open" && Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
      this.transitionTo("half-open");
    }
    return this.state;
  }

  /**
   * Execute `fn` under the circuit breaker.
   *
   * Optional `isFailure(err)` predicate lets callers classify errors so
   * client-side errors (e.g. Bedrock 4xx schema rejections, malformed
   * prompts) don't trip the breaker and brownout-affect healthy traffic.
   * Returning false means "this error is real but doesn't indicate an
   * unhealthy upstream — surface it but don't count toward the threshold."
   * Default: every error counts as a failure.
   *
   * Throws `CircuitBreakerOpenError` when the breaker is open at call time
   * (before fn() is invoked). This lets callers distinguish rejected-by-policy
   * from fn-threw without string matching.
   */
  async execute<T>(fn: () => Promise<T>, isFailure?: (err: unknown) => boolean): Promise<T> {
    const currentState = this.getState();

    if (currentState === "open") {
      throw new CircuitBreakerOpenError(this.label, this.failureCount);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      const counts = isFailure ? isFailure(error) : true;
      if (counts) this.onFailure();
      throw error;
    }
  }

  /** Test seam: directly reset to closed state. */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  /** Internal accessor for snapshot output. */
  getFailureCount(): number {
    return this.failureCount;
  }

  /** Internal accessor for snapshot output. */
  getLastFailureTime(): number {
    return this.lastFailureTime;
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      logger.info({ label: this.label }, "Circuit breaker test call succeeded, closing circuit");
    }
    this.failureCount = 0;
    this.transitionTo("closed");
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      this.transitionTo("open");
    } else if (this.failureCount >= this.failureThreshold) {
      this.transitionTo("open");
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      logger.warn(
        { label: this.label, from: this.state, to: newState, failures: this.failureCount },
        "Circuit breaker state transition",
      );
      this.state = newState;
    }
  }
}

// ---------------------------------------------------------------------------
// PerKeyCircuitBreaker
// ---------------------------------------------------------------------------
//
// Keyed variant of CircuitBreaker — holds an independent state machine per
// key so one failing target (e.g. one webhook URL) doesn't brownout the rest.
//
// Bounded to MAX_KEYS entries with LRU eviction to prevent unbounded growth
// under pathological key churn (e.g. if keys aren't actually stable). 1,000
// is far beyond any realistic number of webhook configs or AssemblyAI accounts.

export type CircuitSnapshot = {
  key: string;
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
};

type PerKeyOverride = { threshold?: number; resetMs?: number };

export class PerKeyCircuitBreaker {
  private breakers = new Map<string, CircuitBreaker>();
  private readonly MAX_KEYS = 1_000;

  constructor(
    private readonly labelPrefix: string,
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 30_000,
  ) {}

  private getOrCreate(key: string, override?: PerKeyOverride): CircuitBreaker {
    const existing = this.breakers.get(key);
    if (existing) {
      // LRU touch: delete-then-set moves to most-recently-used position.
      this.breakers.delete(key);
      this.breakers.set(key, existing);
      return existing;
    }
    if (this.breakers.size >= this.MAX_KEYS) {
      const oldest = this.breakers.keys().next().value;
      if (oldest !== undefined) this.breakers.delete(oldest);
    }
    // Per-key override is applied only on first creation. Later policy
    // changes by the caller won't retroactively update the breaker —
    // call reset(key) to recreate with new thresholds.
    const threshold = override?.threshold ?? this.failureThreshold;
    const resetMs = override?.resetMs ?? this.resetTimeoutMs;
    const breaker = new CircuitBreaker(`${this.labelPrefix}:${key}`, threshold, resetMs);
    this.breakers.set(key, breaker);
    return breaker;
  }

  /**
   * Execute `fn` under the per-key circuit. Throws CircuitBreakerOpenError
   * immediately if the key's circuit is open.
   *
   * The third argument can be either a plain `isFailure` predicate OR an
   * options object. Threshold/resetMs overrides only take effect when the
   * key's breaker is FIRST created — subsequent overrides are ignored unless
   * you call reset(key) first.
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    isFailureOrOptions?:
      | ((err: unknown) => boolean)
      | { isFailure?: (err: unknown) => boolean; threshold?: number; resetMs?: number },
  ): Promise<T> {
    const opts =
      typeof isFailureOrOptions === "function" ? { isFailure: isFailureOrOptions } : (isFailureOrOptions ?? {});
    const override =
      opts.threshold !== undefined || opts.resetMs !== undefined
        ? { threshold: opts.threshold, resetMs: opts.resetMs }
        : undefined;
    return this.getOrCreate(key, override).execute(fn, opts.isFailure);
  }

  /** Current state for a specific key — "closed" for unknown keys. */
  getState(key: string): CircuitState {
    const b = this.breakers.get(key);
    return b ? b.getState() : "closed";
  }

  /** True when the key's breaker is currently open. Cheap read. */
  isOpen(key: string): boolean {
    return this.getState(key) === "open";
  }

  /** Snapshot of all currently-tracked breakers, sorted by most-recently-failed. */
  snapshot(): CircuitSnapshot[] {
    const out: CircuitSnapshot[] = [];
    for (const [key, b] of this.breakers) {
      out.push({
        key,
        state: b.getState(),
        failureCount: b.getFailureCount(),
        lastFailureTime: b.getLastFailureTime(),
      });
    }
    return out.sort((a, b) => b.lastFailureTime - a.lastFailureTime);
  }

  /** Test seam — reset a specific key's breaker. */
  reset(key: string): void {
    this.breakers.delete(key);
  }

  /** Test seam — reset all breakers. */
  resetAll(): void {
    this.breakers.clear();
  }

  /** Number of currently-tracked keys (bounded by MAX_KEYS). */
  size(): number {
    return this.breakers.size;
  }
}
