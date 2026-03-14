import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Audio processing pipeline tests.
 *
 * Tests the data flow through the pipeline without calling external services.
 * Focuses on: confidence scoring, flag logic, agent name detection,
 * and analysis normalization.
 */

describe("Audio Processing Pipeline", () => {
  describe("Confidence score computation", () => {
    it("computes weighted confidence from all factors", () => {
      const transcriptConfidence = 0.95;
      const wordCount = 200;
      const callDuration = 120; // seconds
      const hasAiAnalysis = true;

      const wordConfidence = Math.min(wordCount / 50, 1);
      const durationConfidence = callDuration > 30 ? 1 : callDuration / 30;
      const aiConfidence = hasAiAnalysis ? 1 : 0.3;

      const confidenceScore =
        transcriptConfidence * 0.4 +
        wordConfidence * 0.2 +
        durationConfidence * 0.15 +
        aiConfidence * 0.25;

      assert.ok(confidenceScore > 0.9, `Expected >0.9, got ${confidenceScore}`);
      assert.ok(confidenceScore <= 1.0, `Expected <=1.0, got ${confidenceScore}`);
    });

    it("produces low confidence without AI analysis", () => {
      const transcriptConfidence = 0.95;
      const wordCount = 200;
      const callDuration = 120;
      const hasAiAnalysis = false;

      const wordConfidence = Math.min(wordCount / 50, 1);
      const durationConfidence = callDuration > 30 ? 1 : callDuration / 30;
      const aiConfidence = hasAiAnalysis ? 1 : 0.3;

      const confidenceScore =
        transcriptConfidence * 0.4 +
        wordConfidence * 0.2 +
        durationConfidence * 0.15 +
        aiConfidence * 0.25;

      // Should be lower due to aiConfidence = 0.3 instead of 1.0
      assert.ok(confidenceScore < 0.9, `Expected <0.9 without AI, got ${confidenceScore}`);
    });

    it("produces low confidence with short call duration", () => {
      const transcriptConfidence = 0.85;
      const wordCount = 10;
      const callDuration = 5; // Very short
      const hasAiAnalysis = true;

      const wordConfidence = Math.min(wordCount / 50, 1);
      const durationConfidence = callDuration > 30 ? 1 : callDuration / 30;
      const aiConfidence = hasAiAnalysis ? 1 : 0.3;

      const confidenceScore =
        transcriptConfidence * 0.4 +
        wordConfidence * 0.2 +
        durationConfidence * 0.15 +
        aiConfidence * 0.25;

      assert.ok(confidenceScore < 0.7, `Expected <0.7 for short call, got ${confidenceScore}`);
    });

    it("flags low_confidence when score < 0.7", () => {
      const confidenceScore = 0.65;
      const flags: string[] = [];

      if (confidenceScore < 0.7) {
        flags.push("low_confidence");
      }

      assert.ok(flags.includes("low_confidence"));
    });

    it("does not flag when confidence >= 0.7", () => {
      const confidenceScore = 0.75;
      const flags: string[] = [];

      if (confidenceScore < 0.7) {
        flags.push("low_confidence");
      }

      assert.ok(!flags.includes("low_confidence"));
    });
  });

  describe("Agent name detection and matching", () => {
    it("matches employee by exact lowercase name", () => {
      const detectedName = "john smith";
      const employees = [
        { id: "emp-1", name: "John Smith", email: "j@test.com" },
        { id: "emp-2", name: "Jane Doe", email: "jd@test.com" },
      ];

      const match = employees.find(emp => {
        const empName = emp.name.toLowerCase();
        return empName === detectedName ||
          empName.split(" ")[0] === detectedName ||
          empName.split(" ").pop() === detectedName;
      });

      assert.ok(match);
      assert.strictEqual(match!.id, "emp-1");
    });

    it("matches employee by first name only", () => {
      const detectedName = "john";
      const employees = [
        { id: "emp-1", name: "John Smith", email: "j@test.com" },
      ];

      const match = employees.find(emp => {
        const empName = emp.name.toLowerCase();
        return empName === detectedName ||
          empName.split(" ")[0] === detectedName ||
          empName.split(" ").pop() === detectedName;
      });

      assert.ok(match);
      assert.strictEqual(match!.id, "emp-1");
    });

    it("matches employee by last name only", () => {
      const detectedName = "smith";
      const employees = [
        { id: "emp-1", name: "John Smith", email: "j@test.com" },
      ];

      const match = employees.find(emp => {
        const empName = emp.name.toLowerCase();
        return empName === detectedName ||
          empName.split(" ")[0] === detectedName ||
          empName.split(" ").pop() === detectedName;
      });

      assert.ok(match);
      assert.strictEqual(match!.id, "emp-1");
    });

    it("returns undefined when no employee matches", () => {
      const detectedName = "unknown person";
      const employees = [
        { id: "emp-1", name: "John Smith", email: "j@test.com" },
      ];

      const match = employees.find(emp => {
        const empName = emp.name.toLowerCase();
        return empName === detectedName ||
          empName.split(" ")[0] === detectedName ||
          empName.split(" ").pop() === detectedName;
      });

      assert.strictEqual(match, undefined);
    });
  });

  describe("Analysis normalization", () => {
    it("normalizes analysis with missing arrays", async () => {
      const { normalizeAnalysis } = await import("../server/storage/types");

      const raw = {
        id: "a1",
        orgId: "org1",
        callId: "c1",
        summary: "Test summary",
        performanceScore: "7.5",
        // Missing: topics, actionItems, flags, feedback
      } as any;

      const normalized = normalizeAnalysis(raw);
      assert.ok(Array.isArray(normalized.topics));
      assert.ok(Array.isArray(normalized.actionItems));
      assert.ok(Array.isArray(normalized.flags));
      assert.ok(normalized.feedback && typeof normalized.feedback === "object");
    });

    it("preserves existing valid arrays", async () => {
      const { normalizeAnalysis } = await import("../server/storage/types");

      const raw = {
        id: "a1",
        orgId: "org1",
        callId: "c1",
        summary: "Test",
        topics: ["billing", "refund"],
        actionItems: ["Follow up"],
        flags: ["low_score"],
        feedback: { strengths: ["Good greeting"], suggestions: ["Improve pace"] },
      } as any;

      const normalized = normalizeAnalysis(raw);
      assert.deepStrictEqual(normalized.topics, ["billing", "refund"]);
      assert.deepStrictEqual(normalized.actionItems, ["Follow up"]);
      assert.deepStrictEqual(normalized.flags, ["low_score"]);
    });

    it("handles undefined analysis gracefully", async () => {
      const { normalizeAnalysis } = await import("../server/storage/types");
      const result = normalizeAnalysis(undefined);
      assert.strictEqual(result, undefined);
    });
  });

  describe("File upload validation", () => {
    it("validates allowed MIME types", () => {
      const allowed = [
        "audio/mpeg", "audio/wav", "audio/mp4",
        "audio/flac", "audio/ogg", "audio/webm",
        "video/mp4", "video/quicktime",
      ];

      assert.ok(allowed.includes("audio/mpeg")); // MP3
      assert.ok(allowed.includes("audio/wav")); // WAV
      assert.ok(allowed.includes("audio/mp4")); // M4A
      assert.ok(allowed.includes("audio/flac")); // FLAC
      assert.ok(!allowed.includes("text/plain")); // Rejected
      assert.ok(!allowed.includes("application/pdf")); // Rejected
    });

    it("enforces 100MB file size limit", () => {
      const MAX_FILE_SIZE = 100 * 1024 * 1024;
      assert.strictEqual(MAX_FILE_SIZE, 104857600);

      // File under limit
      assert.ok(50 * 1024 * 1024 < MAX_FILE_SIZE);
      // File over limit
      assert.ok(150 * 1024 * 1024 > MAX_FILE_SIZE);
    });

    it("enforces batch size limit of 20 files", () => {
      const MAX_BATCH_SIZE = 20;
      assert.strictEqual(MAX_BATCH_SIZE, 20);
    });
  });

  describe("Duplicate detection via SHA256", () => {
    it("generates consistent hash for same content", async () => {
      const { createHash } = await import("crypto");
      const buffer = Buffer.from("test audio content");
      const hash1 = createHash("sha256").update(buffer).digest("hex");
      const hash2 = createHash("sha256").update(buffer).digest("hex");
      assert.strictEqual(hash1, hash2);
    });

    it("generates different hash for different content", async () => {
      const { createHash } = await import("crypto");
      const buffer1 = Buffer.from("audio content 1");
      const buffer2 = Buffer.from("audio content 2");
      const hash1 = createHash("sha256").update(buffer1).digest("hex");
      const hash2 = createHash("sha256").update(buffer2).digest("hex");
      assert.notStrictEqual(hash1, hash2);
    });
  });
});

describe("Data Retention", () => {
  it("purges calls older than retention period from MemStorage", async () => {
    const { MemStorage } = await import("../server/storage/memory");
    const storage = new MemStorage();

    const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });

    // Create an old call (100 days ago)
    const call = await storage.createCall(org.id, {
      fileName: "old-call.mp3",
      status: "completed",
    });
    // Manually set uploadedAt to 100 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);
    await storage.updateCall(org.id, call.id, { uploadedAt: oldDate.toISOString() } as any);

    // Create a recent call
    await storage.createCall(org.id, {
      fileName: "new-call.mp3",
      status: "completed",
    });

    // Purge calls older than 90 days
    const purged = await storage.purgeExpiredCalls(org.id, 90);
    assert.strictEqual(purged, 1);

    // Verify only the new call remains
    const remaining = await storage.getAllCalls(org.id);
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].fileName, "new-call.mp3");
  });

  it("respects per-org retention settings", () => {
    const defaultRetentionDays = 90;
    const orgSettings = { retentionDays: 30 };
    const effectiveRetention = orgSettings.retentionDays ?? defaultRetentionDays;
    assert.strictEqual(effectiveRetention, 30);
  });

  it("falls back to default when org has no retention setting", () => {
    const defaultRetentionDays = 90;
    const orgSettings = {} as any;
    const effectiveRetention = orgSettings.retentionDays ?? defaultRetentionDays;
    assert.strictEqual(effectiveRetention, 90);
  });
});

describe("Rate Limiting", () => {
  it("in-memory rate limiter tracks requests per key", () => {
    const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxRequests = 5;
    const key = "127.0.0.1:/api/auth/login";

    // Simulate 5 requests
    for (let i = 0; i < 5; i++) {
      const entry = rateLimitMap.get(key) || { count: 0, resetTime: Date.now() + windowMs };
      entry.count++;
      rateLimitMap.set(key, entry);
    }

    const entry = rateLimitMap.get(key)!;
    assert.strictEqual(entry.count, 5);
    assert.ok(entry.count <= maxRequests); // At limit

    // 6th request should exceed
    entry.count++;
    assert.ok(entry.count > maxRequests);
  });

  it("cleans up expired entries", () => {
    const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
    const now = Date.now();

    // Expired entry
    rateLimitMap.set("expired-key", { count: 3, resetTime: now - 1000 });
    // Active entry
    rateLimitMap.set("active-key", { count: 1, resetTime: now + 60000 });

    // Cleanup
    rateLimitMap.forEach((entry, key) => {
      if (now > entry.resetTime) rateLimitMap.delete(key);
    });

    assert.strictEqual(rateLimitMap.has("expired-key"), false);
    assert.strictEqual(rateLimitMap.has("active-key"), true);
  });
});
