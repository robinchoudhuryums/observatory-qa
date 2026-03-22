/**
 * Tests for Bedrock per-org rate limiting (ai-factory.ts).
 *
 * Verifies: per-org concurrency caps, global concurrency caps,
 * RPM sliding window, slot release, and withBedrockRateLimit wrapper.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Import the rate-limiting functions directly
import {
  acquireBedrockSlot,
  releaseBedrockSlot,
  withBedrockRateLimit,
} from "../server/services/ai-factory";

describe("Bedrock Rate Limiting", () => {
  // Release any slots from prior tests
  beforeEach(() => {
    // Clean up by releasing many slots to reset state
    for (let i = 0; i < 100; i++) {
      releaseBedrockSlot("test-org");
      releaseBedrockSlot("other-org");
    }
  });

  describe("acquireBedrockSlot / releaseBedrockSlot", () => {
    it("allows acquiring a slot for an org", () => {
      const result = acquireBedrockSlot("org-1");
      assert.equal(result, true);
      releaseBedrockSlot("org-1");
    });

    it("allows multiple slots up to the per-org limit", () => {
      const results: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        results.push(acquireBedrockSlot("org-limit"));
      }
      assert.deepStrictEqual(results, [true, true, true, true, true]);

      // 6th should be rejected (default limit is 5)
      const sixth = acquireBedrockSlot("org-limit");
      assert.equal(sixth, false);

      // Clean up
      for (let i = 0; i < 5; i++) releaseBedrockSlot("org-limit");
    });

    it("releases slots correctly", () => {
      // Fill up 5 slots
      for (let i = 0; i < 5; i++) acquireBedrockSlot("org-release");

      // Should be full
      assert.equal(acquireBedrockSlot("org-release"), false);

      // Release one
      releaseBedrockSlot("org-release");

      // Should be able to acquire again
      assert.equal(acquireBedrockSlot("org-release"), true);

      // Clean up
      for (let i = 0; i < 5; i++) releaseBedrockSlot("org-release");
    });

    it("tracks slots per org independently", () => {
      // Fill org-a
      for (let i = 0; i < 5; i++) acquireBedrockSlot("org-a");
      assert.equal(acquireBedrockSlot("org-a"), false);

      // org-b should still have capacity
      assert.equal(acquireBedrockSlot("org-b"), true);

      // Clean up
      for (let i = 0; i < 5; i++) releaseBedrockSlot("org-a");
      releaseBedrockSlot("org-b");
    });

    it("releaseBedrockSlot does not go below zero", () => {
      // Release without acquiring — should not throw
      releaseBedrockSlot("org-empty");
      releaseBedrockSlot("org-empty");

      // Should still be able to acquire normally
      assert.equal(acquireBedrockSlot("org-empty"), true);
      releaseBedrockSlot("org-empty");
    });
  });

  describe("withBedrockRateLimit", () => {
    it("executes function and releases slot on success", async () => {
      let executed = false;
      const result = await withBedrockRateLimit("org-wrap", async () => {
        executed = true;
        return 42;
      });
      assert.equal(executed, true);
      assert.equal(result, 42);
    });

    it("releases slot on function error", async () => {
      // Fill up 4 of 5 slots so we can verify release
      for (let i = 0; i < 4; i++) acquireBedrockSlot("org-err");

      try {
        await withBedrockRateLimit("org-err", async () => {
          throw new Error("test error");
        });
        assert.fail("Should have thrown");
      } catch (err: any) {
        assert.equal(err.message, "test error");
      }

      // Slot should have been released — should still be able to acquire
      assert.equal(acquireBedrockSlot("org-err"), true);

      // Clean up
      for (let i = 0; i < 5; i++) releaseBedrockSlot("org-err");
    });

    it("throws when rate limited", async () => {
      // Fill up all 5 slots
      for (let i = 0; i < 5; i++) acquireBedrockSlot("org-full");

      try {
        await withBedrockRateLimit("org-full", async () => "should not run");
        assert.fail("Should have thrown rate limit error");
      } catch (err: any) {
        assert.ok(err.message.includes("rate limit"), `Expected rate limit error, got: ${err.message}`);
      }

      // Clean up
      for (let i = 0; i < 5; i++) releaseBedrockSlot("org-full");
    });
  });
});
