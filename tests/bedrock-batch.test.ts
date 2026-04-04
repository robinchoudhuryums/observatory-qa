/**
 * Bedrock batch inference tests — verifies batch mode configuration,
 * pending item management, and pipeline branching logic.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

describe("Bedrock batch inference", () => {
  describe("shouldUseBatchMode", () => {
    it("returns false when org has no batch settings", async () => {
      const { shouldUseBatchMode } = await import("../server/services/bedrock-batch.js");
      assert.equal(shouldUseBatchMode(undefined), false);
      assert.equal(shouldUseBatchMode({}), false);
    });

    it("returns false when batchMode is realtime", async () => {
      const { shouldUseBatchMode } = await import("../server/services/bedrock-batch.js");
      assert.equal(shouldUseBatchMode({ batchMode: "realtime" }), false);
    });

    it("returns true when batchMode is batch and infrastructure is available", async () => {
      const { shouldUseBatchMode } = await import("../server/services/bedrock-batch.js");
      // Save/restore env
      const origBucket = process.env.S3_BUCKET;
      const origRole = process.env.BEDROCK_BATCH_ROLE_ARN;
      const origKey = process.env.AWS_ACCESS_KEY_ID;
      const origSecret = process.env.AWS_SECRET_ACCESS_KEY;

      process.env.S3_BUCKET = "test-bucket";
      process.env.BEDROCK_BATCH_ROLE_ARN = "arn:aws:iam::123:role/test";
      process.env.AWS_ACCESS_KEY_ID = "test-key";
      process.env.AWS_SECRET_ACCESS_KEY = "test-secret";

      try {
        assert.equal(shouldUseBatchMode({ batchMode: "batch" }), true);
      } finally {
        process.env.S3_BUCKET = origBucket;
        process.env.BEDROCK_BATCH_ROLE_ARN = origRole;
        process.env.AWS_ACCESS_KEY_ID = origKey;
        process.env.AWS_SECRET_ACCESS_KEY = origSecret;
      }
    });

    it("returns false when batchMode is batch but infrastructure missing", async () => {
      const { shouldUseBatchMode } = await import("../server/services/bedrock-batch.js");
      const origRole = process.env.BEDROCK_BATCH_ROLE_ARN;
      delete process.env.BEDROCK_BATCH_ROLE_ARN;

      try {
        assert.equal(shouldUseBatchMode({ batchMode: "batch" }), false);
      } finally {
        if (origRole) process.env.BEDROCK_BATCH_ROLE_ARN = origRole;
      }
    });

    it("per-call override takes precedence over org setting", async () => {
      const { shouldUseBatchMode } = await import("../server/services/bedrock-batch.js");
      // Override to realtime even though org says batch
      assert.equal(shouldUseBatchMode({ batchMode: "batch" }, undefined, "realtime"), false);
    });

    it("hybrid mode defaults to realtime", async () => {
      const { shouldUseBatchMode } = await import("../server/services/bedrock-batch.js");
      assert.equal(shouldUseBatchMode({ batchMode: "hybrid" }), false);
    });
  });

  describe("isBatchAvailable", () => {
    it("returns false when S3_BUCKET is not set", async () => {
      const { isBatchAvailable } = await import("../server/services/bedrock-batch.js");
      const orig = process.env.S3_BUCKET;
      delete process.env.S3_BUCKET;
      try {
        assert.equal(isBatchAvailable(), false);
      } finally {
        if (orig) process.env.S3_BUCKET = orig;
      }
    });

    it("returns false when BEDROCK_BATCH_ROLE_ARN is not set", async () => {
      const { isBatchAvailable } = await import("../server/services/bedrock-batch.js");
      const origBucket = process.env.S3_BUCKET;
      const origRole = process.env.BEDROCK_BATCH_ROLE_ARN;
      process.env.S3_BUCKET = "test";
      delete process.env.BEDROCK_BATCH_ROLE_ARN;
      try {
        assert.equal(isBatchAvailable(), false);
      } finally {
        process.env.S3_BUCKET = origBucket;
        if (origRole) process.env.BEDROCK_BATCH_ROLE_ARN = origRole;
      }
    });
  });

  describe("PendingBatchItem interface", () => {
    it("includes all required fields", async () => {
      const item: import("../server/services/bedrock-batch.js").PendingBatchItem = {
        orgId: "org-1",
        callId: "call-1",
        prompt: "Analyze this transcript...",
        callCategory: "inbound",
        uploadedBy: "user-1",
        timestamp: new Date().toISOString(),
      };
      assert.equal(item.orgId, "org-1");
      assert.equal(item.callId, "call-1");
      assert.ok(item.prompt.length > 0);
    });
  });

  describe("BatchJob interface", () => {
    it("includes orgId for multi-tenant isolation", async () => {
      const job: import("../server/services/bedrock-batch.js").BatchJob = {
        jobId: "job-1",
        jobArn: "arn:aws:bedrock:us-east-1:123:job/job-1",
        orgId: "org-1",
        status: "Submitted",
        inputS3Uri: "s3://bucket/input.jsonl",
        outputS3Uri: "s3://bucket/output/",
        callIds: ["call-1", "call-2"],
        createdAt: new Date().toISOString(),
      };
      assert.equal(job.orgId, "org-1");
      assert.equal(job.callIds.length, 2);
    });
  });

  describe("OrgSettings batchMode", () => {
    it("accepts valid batchMode values", async () => {
      const { orgSettingsSchema } = await import("../shared/schema/org.js");

      for (const mode of ["realtime", "batch", "hybrid"]) {
        const result = orgSettingsSchema.safeParse({ batchMode: mode, retentionDays: 90 });
        assert.ok(result.success, `batchMode "${mode}" should be valid`);
      }
    });

    it("rejects invalid batchMode values", async () => {
      const { orgSettingsSchema } = await import("../shared/schema/org.js");
      const result = orgSettingsSchema.safeParse({ batchMode: "turbo", retentionDays: 90 });
      assert.equal(result.success, false, "Invalid batchMode should fail validation");
    });

    it("accepts primaryLanguage", async () => {
      const { orgSettingsSchema } = await import("../shared/schema/org.js");
      const result = orgSettingsSchema.safeParse({ primaryLanguage: "es", retentionDays: 90 });
      assert.ok(result.success, "primaryLanguage should be valid");
    });

    it("accepts confidenceThreshold", async () => {
      const { orgSettingsSchema } = await import("../shared/schema/org.js");
      const result = orgSettingsSchema.safeParse({ confidenceThreshold: 0.7, retentionDays: 90 });
      assert.ok(result.success, "confidenceThreshold should be valid");
    });

    it("rejects confidenceThreshold out of range", async () => {
      const { orgSettingsSchema } = await import("../shared/schema/org.js");
      const result = orgSettingsSchema.safeParse({ confidenceThreshold: 1.5, retentionDays: 90 });
      assert.equal(result.success, false, "confidenceThreshold > 1 should fail");
    });
  });
});
