/**
 * Tests for the Tier 1B resilience module.
 *
 * Covers state machine transitions, isFailure predicate, per-key isolation,
 * and CircuitBreakerOpenError contract.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CircuitBreaker,
  PerKeyCircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitState,
} from "../server/utils/resilience";

/** Tiny helper: returns a function that fails N times then succeeds forever. */
function makeFlakyFn<T>(failuresBeforeSuccess: number, successValue: T, errorMessage = "boom") {
  let calls = 0;
  return async (): Promise<T> => {
    calls++;
    if (calls <= failuresBeforeSuccess) throw new Error(errorMessage);
    return successValue;
  };
}

describe("CircuitBreaker — state machine", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker("test", 3, 1000);
    assert.equal(cb.getState(), "closed");
    assert.equal(cb.getFailureCount(), 0);
  });

  it("stays closed on successful calls", async () => {
    const cb = new CircuitBreaker("test", 3, 1000);
    await cb.execute(async () => "ok");
    await cb.execute(async () => "ok");
    assert.equal(cb.getState(), "closed");
    assert.equal(cb.getFailureCount(), 0);
  });

  it("increments failure count without tripping until threshold reached", async () => {
    const cb = new CircuitBreaker("test", 3, 1000);
    const failing = async () => {
      throw new Error("upstream failed");
    };
    // First two failures: still closed
    await assert.rejects(cb.execute(failing));
    assert.equal(cb.getState(), "closed");
    await assert.rejects(cb.execute(failing));
    assert.equal(cb.getState(), "closed");
    assert.equal(cb.getFailureCount(), 2);
    // Third failure: opens the circuit
    await assert.rejects(cb.execute(failing));
    assert.equal(cb.getState(), "open");
    assert.equal(cb.getFailureCount(), 3);
  });

  it("rejects with CircuitBreakerOpenError when open", async () => {
    const cb = new CircuitBreaker("test", 1, 1_000_000); // very long reset
    const failing = async () => {
      throw new Error("upstream failed");
    };
    await assert.rejects(cb.execute(failing)); // trips the breaker
    assert.equal(cb.getState(), "open");

    let caught: unknown;
    try {
      await cb.execute(async () => "ok");
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof CircuitBreakerOpenError);
    if (caught instanceof CircuitBreakerOpenError) {
      assert.equal(caught.label, "test");
      assert.equal(caught.failureCount, 1);
    }
  });

  it("transitions open → half-open after the reset window", async () => {
    const cb = new CircuitBreaker("test", 1, 10);
    await assert.rejects(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    );
    assert.equal(cb.getState(), "open");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(cb.getState(), "half-open");
  });

  it("closes the circuit when the half-open test call succeeds", async () => {
    const cb = new CircuitBreaker("test", 1, 10);
    // Trip the breaker
    await assert.rejects(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    );
    // Wait for reset window
    await new Promise((r) => setTimeout(r, 20));
    // Successful test call closes the circuit
    const result = await cb.execute(async () => "recovered");
    assert.equal(result, "recovered");
    assert.equal(cb.getState(), "closed");
    assert.equal(cb.getFailureCount(), 0);
  });

  it("re-opens immediately when the half-open test call fails", async () => {
    const cb = new CircuitBreaker("test", 1, 10);
    // Trip
    await assert.rejects(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(cb.getState(), "half-open");
    // Failed test call: re-opens (no further successes needed to trip)
    await assert.rejects(
      cb.execute(async () => {
        throw new Error("still down");
      }),
    );
    assert.equal(cb.getState(), "open");
  });

  it("resets failure count after a success in closed state", async () => {
    const cb = new CircuitBreaker("test", 5, 1000);
    const flaky = makeFlakyFn(2, "ok");
    await assert.rejects(cb.execute(flaky));
    await assert.rejects(cb.execute(flaky));
    assert.equal(cb.getFailureCount(), 2);
    // Third call succeeds
    const result = await cb.execute(flaky);
    assert.equal(result, "ok");
    assert.equal(cb.getFailureCount(), 0);
    assert.equal(cb.getState(), "closed");
  });

  it("reset() clears all state", async () => {
    const cb = new CircuitBreaker("test", 1, 1_000_000);
    await assert.rejects(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    );
    assert.equal(cb.getState(), "open");
    cb.reset();
    assert.equal(cb.getState(), "closed");
    assert.equal(cb.getFailureCount(), 0);
  });
});

describe("CircuitBreaker — isFailure predicate", () => {
  it("does not count errors that the predicate marks as non-failures", async () => {
    const cb = new CircuitBreaker("test", 2, 1000);
    const isClient4xx = (err: unknown): boolean => {
      const msg = (err as Error).message;
      return !msg.startsWith("4xx:");
    };
    // Two 4xx errors — predicate returns false, neither counts.
    await assert.rejects(
      cb.execute(async () => {
        throw new Error("4xx: bad request");
      }, isClient4xx),
    );
    await assert.rejects(
      cb.execute(async () => {
        throw new Error("4xx: validation");
      }, isClient4xx),
    );
    assert.equal(cb.getState(), "closed");
    assert.equal(cb.getFailureCount(), 0);
  });

  it("counts errors that the predicate marks as failures", async () => {
    const cb = new CircuitBreaker("test", 2, 1000);
    const isServer5xx = (err: unknown): boolean => {
      const msg = (err as Error).message;
      return msg.startsWith("5xx:");
    };
    await assert.rejects(
      cb.execute(async () => {
        throw new Error("5xx: server fault");
      }, isServer5xx),
    );
    await assert.rejects(
      cb.execute(async () => {
        throw new Error("5xx: timeout");
      }, isServer5xx),
    );
    assert.equal(cb.getState(), "open");
  });

  it("re-throws the original error regardless of predicate verdict", async () => {
    const cb = new CircuitBreaker("test", 5, 1000);
    const original = new Error("original message");
    const isFailure = () => false; // never count
    let caught: unknown;
    try {
      await cb.execute(async () => {
        throw original;
      }, isFailure);
    } catch (err) {
      caught = err;
    }
    assert.equal(caught, original); // identical reference
    assert.equal(cb.getState(), "closed");
  });
});

describe("CircuitBreakerOpenError — contract", () => {
  it("has correct name, label, and failureCount", () => {
    const err = new CircuitBreakerOpenError("my-upstream", 7);
    assert.equal(err.name, "CircuitBreakerOpenError");
    assert.equal(err.label, "my-upstream");
    assert.equal(err.failureCount, 7);
    assert.ok(err.message.includes("my-upstream"));
    assert.ok(err.message.includes("7"));
  });

  it("is instanceof Error and instanceof CircuitBreakerOpenError", () => {
    const err = new CircuitBreakerOpenError("x", 1);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof CircuitBreakerOpenError);
  });
});

describe("PerKeyCircuitBreaker — isolation", () => {
  it("tracks state independently per key", async () => {
    const breaker = new PerKeyCircuitBreaker("test", 2, 1000);
    // Trip key A
    await assert.rejects(
      breaker.execute("A", async () => {
        throw new Error("A failed");
      }),
    );
    await assert.rejects(
      breaker.execute("A", async () => {
        throw new Error("A failed");
      }),
    );
    assert.ok(breaker.isOpen("A"));
    // Key B is unaffected
    assert.equal(breaker.getState("B"), "closed");
    const result = await breaker.execute("B", async () => "B works");
    assert.equal(result, "B works");
  });

  it("returns 'closed' for unknown keys without creating a breaker", () => {
    const breaker = new PerKeyCircuitBreaker("test");
    assert.equal(breaker.getState("never-seen"), "closed");
    assert.equal(breaker.size(), 0);
  });

  it("reset(key) clears one key without affecting others", async () => {
    const breaker = new PerKeyCircuitBreaker("test", 1, 1_000_000);
    await assert.rejects(
      breaker.execute("A", async () => {
        throw new Error("A");
      }),
    );
    await assert.rejects(
      breaker.execute("B", async () => {
        throw new Error("B");
      }),
    );
    assert.ok(breaker.isOpen("A"));
    assert.ok(breaker.isOpen("B"));
    breaker.reset("A");
    assert.equal(breaker.getState("A"), "closed");
    assert.ok(breaker.isOpen("B"));
  });

  it("resetAll() clears every key", async () => {
    const breaker = new PerKeyCircuitBreaker("test", 1, 1_000_000);
    await assert.rejects(
      breaker.execute("A", async () => {
        throw new Error("A");
      }),
    );
    await assert.rejects(
      breaker.execute("B", async () => {
        throw new Error("B");
      }),
    );
    breaker.resetAll();
    assert.equal(breaker.size(), 0);
    assert.equal(breaker.getState("A"), "closed");
    assert.equal(breaker.getState("B"), "closed");
  });

  it("snapshot returns one entry per tracked breaker, sorted by lastFailureTime DESC", async () => {
    const breaker = new PerKeyCircuitBreaker("test", 3, 1000);
    // Trip A first
    await assert.rejects(
      breaker.execute("A", async () => {
        throw new Error("a");
      }),
    );
    // Small delay so lastFailureTime for B is strictly later
    await new Promise((r) => setTimeout(r, 10));
    // Then B
    await assert.rejects(
      breaker.execute("B", async () => {
        throw new Error("b");
      }),
    );
    const snap = breaker.snapshot();
    assert.equal(snap.length, 2);
    // B failed most recently — should be first
    assert.equal(snap[0].key, "B");
    assert.equal(snap[1].key, "A");
    for (const entry of snap) {
      assert.equal(entry.failureCount, 1);
      assert.ok(entry.lastFailureTime > 0);
    }
  });

  it("supports per-key threshold/resetMs override on first creation", async () => {
    const breaker = new PerKeyCircuitBreaker("test", 5, 30_000);
    // Override key A: trip after 1 failure with very short reset
    await assert.rejects(
      breaker.execute(
        "A",
        async () => {
          throw new Error("a");
        },
        { threshold: 1, resetMs: 10 },
      ),
    );
    assert.ok(breaker.isOpen("A"));
    // Key B uses defaults (threshold 5)
    await assert.rejects(
      breaker.execute("B", async () => {
        throw new Error("b");
      }),
    );
    assert.equal(breaker.getState("B"), "closed"); // 1 of 5 — not open yet
  });

  it("accepts plain isFailure predicate as third arg (back-compat)", async () => {
    const breaker = new PerKeyCircuitBreaker("test", 1, 1000);
    const isCountable = (err: unknown) => (err as Error).message !== "ignore";
    await assert.rejects(
      breaker.execute(
        "A",
        async () => {
          throw new Error("ignore");
        },
        isCountable,
      ),
    );
    assert.equal(breaker.getState("A"), "closed"); // ignored error didn't count
  });
});

describe("PerKeyCircuitBreaker — bounded growth", () => {
  it("size() reports the number of tracked keys", async () => {
    const breaker = new PerKeyCircuitBreaker("test");
    assert.equal(breaker.size(), 0);
    await breaker.execute("a", async () => "ok");
    assert.equal(breaker.size(), 1);
    await breaker.execute("b", async () => "ok");
    assert.equal(breaker.size(), 2);
    breaker.resetAll();
    assert.equal(breaker.size(), 0);
  });

  it("does not create breakers for read-only state queries", () => {
    const breaker = new PerKeyCircuitBreaker("test");
    assert.equal(breaker.size(), 0);
    breaker.getState("phantom");
    breaker.isOpen("phantom");
    assert.equal(breaker.size(), 0);
  });
});
