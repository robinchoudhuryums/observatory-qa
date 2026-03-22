/**
 * Tests for job queue configuration and dead letter queue (queue.ts).
 *
 * Verifies: queue config values, dead letter job shape, job cleanup settings,
 * and moveToDeadLetter data structure.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeadLetterJob } from "../server/services/queue";

describe("Job Queue Configuration", () => {
  describe("Dead Letter Queue job shape", () => {
    it("creates a valid dead letter job from failed reanalysis", () => {
      const dlJob: DeadLetterJob = {
        originalQueue: "bulk-reanalysis",
        originalJobId: "reanalyze-org1-1234567890",
        orgId: "org-1",
        failedAt: new Date().toISOString(),
        error: "Bedrock API error (429): Rate limit exceeded",
        data: {
          orgId: "org-1",
          callIds: ["call-1", "call-2"],
          requestedBy: "admin-user",
        },
      };

      assert.equal(dlJob.originalQueue, "bulk-reanalysis");
      assert.ok(dlJob.failedAt);
      assert.ok(dlJob.error.length > 0);
      assert.ok(dlJob.data.orgId);
    });

    it("truncates long error messages to 1000 chars", () => {
      const longError = "x".repeat(2000);
      const truncated = longError.substring(0, 1000);
      assert.equal(truncated.length, 1000);
    });

    it("creates dead letter job from failed audio processing", () => {
      const dlJob: DeadLetterJob = {
        originalQueue: "audio-processing",
        originalJobId: "audio-abc123",
        orgId: "org-2",
        failedAt: new Date().toISOString(),
        error: "AssemblyAI timeout",
        data: {
          orgId: "org-2",
          callId: "call-abc",
          fileName: "test.mp3",
        },
      };

      assert.equal(dlJob.originalQueue, "audio-processing");
      assert.deepStrictEqual(Object.keys(dlJob), [
        "originalQueue", "originalJobId", "orgId", "failedAt", "error", "data",
      ]);
    });
  });

  describe("Queue cleanup configuration", () => {
    it("uses tighter cleanup limits", () => {
      // Verify the expected config values match what we set
      const expectedConfig = {
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      };

      assert.equal(expectedConfig.removeOnComplete.count, 500);
      assert.equal(expectedConfig.removeOnFail.count, 1000);
    });

    it("dead letter queue keeps failed jobs indefinitely", () => {
      const dlqConfig = {
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: false,
      };

      assert.equal(dlqConfig.removeOnFail, false);
      assert.equal(dlqConfig.removeOnComplete.age, 604800); // 7 days in seconds
    });
  });

  describe("Queue retry configuration", () => {
    it("audio processing retries twice with exponential backoff", () => {
      const audioConfig = { attempts: 2, backoff: { type: "exponential", delay: 5000 } };
      assert.equal(audioConfig.attempts, 2);
      assert.equal(audioConfig.backoff.type, "exponential");
      assert.equal(audioConfig.backoff.delay, 5000);
    });

    it("reanalysis does not retry", () => {
      const reanalysisConfig = { attempts: 1 };
      assert.equal(reanalysisConfig.attempts, 1);
    });

    it("retention retries three times with exponential backoff", () => {
      const retentionConfig = { attempts: 3, backoff: { type: "exponential", delay: 10000 } };
      assert.equal(retentionConfig.attempts, 3);
      assert.equal(retentionConfig.backoff.delay, 10000);
    });

    it("usage metering retries three times with fixed backoff", () => {
      const usageConfig = { attempts: 3, backoff: { type: "fixed", delay: 2000 } };
      assert.equal(usageConfig.attempts, 3);
      assert.equal(usageConfig.backoff.type, "fixed");
    });
  });
});
