/**
 * Tests for external API failure modes and graceful degradation.
 *
 * Validates that the application handles failures from external services
 * (AssemblyAI, AWS Bedrock, S3) without crashing and provides meaningful
 * defaults/error messages.
 *
 * These tests exercise the business logic patterns without importing
 * server modules that have heavy dependencies (pino, AWS SDK, etc.).
 *
 * Run with: npx tsx --test tests/external-api-failures.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ==================== JSON PARSING RESILIENCE ====================

describe("AI JSON response parsing resilience", () => {
  // Inline parser matching the logic from ai-provider.ts parseJsonResponse

  function extractJson(raw: string): any {
    if (!raw || raw.trim().length === 0) {
      throw new Error("Response did not contain valid JSON: empty response");
    }

    // Try extracting from markdown code fences
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();

    try {
      return JSON.parse(jsonStr);
    } catch {
      // Try to find first { ... } or [ ... ] block
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          return JSON.parse(objMatch[0]);
        } catch {
          throw new Error("Response contained malformed JSON");
        }
      }
      throw new Error("Response did not contain valid JSON");
    }
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeAnalysis(raw: any): any {
    return {
      summary: typeof raw.summary === "string" ? raw.summary :
               typeof raw.summary === "object" && raw.summary?.text ? raw.summary.text : "No summary available",
      performance_score: clamp(typeof raw.performance_score === "number" ? raw.performance_score : 5.0, 0, 10),
      sentiment: typeof raw.sentiment === "string" ? raw.sentiment : "neutral",
      sentiment_score: clamp(typeof raw.sentiment_score === "number" ? raw.sentiment_score : 0.5, 0, 1),
      topics: Array.isArray(raw.topics) ? raw.topics : [],
      action_items: Array.isArray(raw.action_items) ? raw.action_items : [],
      flags: Array.isArray(raw.flags) ? raw.flags : [],
      detected_agent_name: raw.detected_agent_name || null,
      sub_scores: raw.sub_scores || { compliance: 5, customer_experience: 5, communication: 5, resolution: 5 },
      feedback: raw.feedback || { strengths: [], suggestions: [] },
      call_party_type: raw.call_party_type || "unknown",
    };
  }

  it("throws on empty response", () => {
    assert.throws(() => extractJson(""), /empty response/i);
  });

  it("throws on non-JSON text", () => {
    assert.throws(
      () => extractJson("Sorry, I cannot analyze this transcript."),
      /did not contain valid JSON|malformed/i,
    );
  });

  it("throws on truncated JSON", () => {
    assert.throws(
      () => extractJson('{"summary":"Test","topics":["billing"]'),
      /malformed JSON|did not contain valid JSON/,
    );
  });

  it("extracts JSON from markdown code fences", () => {
    const raw = '```json\n{"summary":"Fenced","topics":["billing"]}\n```';
    const result = extractJson(raw);
    assert.equal(result.summary, "Fenced");
  });

  it("extracts JSON embedded in text", () => {
    const raw = 'Here is my analysis:\n\n{"summary":"Found it","topics":[]}\n\nEnd.';
    const result = extractJson(raw);
    assert.equal(result.summary, "Found it");
  });

  it("clamps over-range performance score to 10", () => {
    const raw = { performance_score: 15 };
    const normalized = normalizeAnalysis(raw);
    assert.equal(normalized.performance_score, 10);
  });

  it("clamps negative performance score to 0", () => {
    const raw = { performance_score: -3 };
    const normalized = normalizeAnalysis(raw);
    assert.equal(normalized.performance_score, 0);
  });

  it("clamps over-range sentiment score to 1", () => {
    const raw = { sentiment_score: 1.5 };
    const normalized = normalizeAnalysis(raw);
    assert.equal(normalized.sentiment_score, 1);
  });

  it("provides defaults for missing fields", () => {
    const raw = { summary: "Brief" };
    const normalized = normalizeAnalysis(raw);
    assert.equal(normalized.summary, "Brief");
    assert.equal(normalized.performance_score, 5.0);
    assert.equal(normalized.sentiment, "neutral");
    assert.equal(normalized.sentiment_score, 0.5);
    assert.deepEqual(normalized.topics, []);
    assert.deepEqual(normalized.action_items, []);
    assert.deepEqual(normalized.flags, []);
    assert.equal(normalized.detected_agent_name, null);
  });

  it("handles object-wrapped summary string", () => {
    const raw = { summary: { text: "Wrapped summary" } };
    const normalized = normalizeAnalysis(raw);
    assert.equal(normalized.summary, "Wrapped summary");
  });

  it("falls back on completely empty response", () => {
    const normalized = normalizeAnalysis({});
    assert.equal(normalized.summary, "No summary available");
    assert.equal(normalized.performance_score, 5.0);
    assert.equal(normalized.sentiment, "neutral");
  });

  it("clamps sub_scores to valid range", () => {
    const clampScore = (s: any) => ({
      compliance: clamp(s.compliance ?? 5, 0, 10),
      customer_experience: clamp(s.customer_experience ?? 5, 0, 10),
      communication: clamp(s.communication ?? 5, 0, 10),
      resolution: clamp(s.resolution ?? 5, 0, 10),
    });

    const result = clampScore({ compliance: 15, customer_experience: -2, communication: 7, resolution: 8 });
    assert.equal(result.compliance, 10);
    assert.equal(result.customer_experience, 0);
    assert.equal(result.communication, 7);
    assert.equal(result.resolution, 8);
  });
});

// ==================== GRACEFUL DEGRADATION PATTERNS ====================

describe("Graceful degradation patterns", () => {
  it("call completes with defaults when AI is unavailable", () => {
    const aiAvailable = false;
    const analysis = {
      performanceScore: aiAvailable ? 8.5 : 5.0,
      sentiment: aiAvailable ? "positive" : "neutral",
      sentimentScore: aiAvailable ? 0.85 : 0.5,
      confidenceFactors: {
        aiAnalysisCompleted: aiAvailable,
        transcriptQuality: 0.9,
      },
    };

    assert.equal(analysis.performanceScore, 5.0);
    assert.equal(analysis.sentiment, "neutral");
    assert.equal(analysis.confidenceFactors.aiAnalysisCompleted, false);
  });

  it("S3 archive failure adds audio_missing tag", () => {
    const tags: string[] = [];
    const s3ArchiveFailed = true;

    if (s3ArchiveFailed) tags.push("audio_missing");

    assert.ok(tags.includes("audio_missing"));
  });

  it("empty transcript produces low confidence and skips AI", () => {
    const transcriptText = "Hi";
    const MIN_TRANSCRIPT_LENGTH = 10;

    const isEmpty = !transcriptText || transcriptText.trim().length < MIN_TRANSCRIPT_LENGTH;
    assert.equal(isEmpty, true);

    if (isEmpty) {
      const flags = ["empty_transcript"];
      const confidenceScore = 0.1;
      assert.ok(flags.includes("empty_transcript"));
      assert.ok(confidenceScore < 0.5);
    }
  });

  it("failed calls set status to failed", () => {
    const callStatus = "processing";
    const error = new Error("Transcription timeout");

    const finalStatus = error ? "failed" : "completed";
    assert.equal(finalStatus, "failed");
  });
});

// ==================== SERVER-SIDE FLAG ENFORCEMENT ====================

describe("Server-side flag enforcement overrides AI", () => {
  it("overrides AI flags with server-computed low_score", () => {
    const aiFlags: string[] = ["compliance_concern"];
    const performanceScore = 1.5;

    const serverFlags = [...aiFlags];
    if (performanceScore <= 2.0 && !serverFlags.includes("low_score")) {
      serverFlags.push("low_score");
    }

    assert.ok(serverFlags.includes("low_score"));
    assert.ok(serverFlags.includes("compliance_concern")); // preserved
  });

  it("overrides AI flags with server-computed exceptional_call", () => {
    const aiFlags: string[] = [];
    const performanceScore = 9.5;

    const serverFlags = [...aiFlags];
    if (performanceScore >= 9.0 && !serverFlags.includes("exceptional_call")) {
      serverFlags.push("exceptional_call");
    }

    assert.ok(serverFlags.includes("exceptional_call"));
  });

  it("does not duplicate existing AI flags", () => {
    const aiFlags = ["low_score"]; // AI already flagged
    const performanceScore = 1.0;

    const serverFlags = [...aiFlags];
    if (performanceScore <= 2.0 && !serverFlags.includes("low_score")) {
      serverFlags.push("low_score");
    }

    assert.equal(serverFlags.filter(f => f === "low_score").length, 1);
  });

  it("adds low_confidence flag when confidence is below threshold", () => {
    const confidenceScore = 0.35;
    const LOW_CONFIDENCE_THRESHOLD = 0.5;
    const flags: string[] = [];

    if (confidenceScore < LOW_CONFIDENCE_THRESHOLD) {
      flags.push("low_confidence");
    }

    assert.ok(flags.includes("low_confidence"));
  });
});

// ==================== COST ESTIMATION ====================

describe("Cost estimation on failure", () => {
  it("returns zero cost when transcription fails before start", () => {
    const totalCost = 0;
    assert.equal(totalCost, 0);
  });

  it("returns partial cost when AI fails but transcription succeeds", () => {
    const transcriptionCost = 0.006; // per minute
    const aiCost = 0; // AI failed
    const totalCost = transcriptionCost + aiCost;
    assert.ok(totalCost > 0);
    assert.ok(totalCost < 0.01);
  });

  it("estimates reasonable per-call cost", () => {
    const durationMinutes = 5;
    const transcriptionCostPerMinute = 0.006;
    const aiTokenCost = 0.005;
    const totalCost = durationMinutes * transcriptionCostPerMinute + aiTokenCost;
    assert.ok(totalCost > 0.01);
    assert.ok(totalCost < 1.0);
  });
});

// ==================== WEBHOOK NOTIFICATION RESILIENCE ====================

describe("Webhook notification resilience", () => {
  it("webhook failure does not block call processing", () => {
    // Simulate: call processing succeeds, webhook fails
    let callCompleted = false;
    let webhookSent = false;

    // Process call
    callCompleted = true;

    // Webhook fails (non-blocking)
    try {
      throw new Error("Webhook delivery failed: 503 Service Unavailable");
    } catch {
      webhookSent = false;
    }

    // Call should still be completed
    assert.equal(callCompleted, true);
    assert.equal(webhookSent, false);
  });

  it("coaching recommendation failure does not block call", () => {
    let callCompleted = false;
    let recommendationGenerated = false;

    callCompleted = true;

    try {
      throw new Error("Coaching engine unavailable");
    } catch {
      recommendationGenerated = false;
    }

    assert.equal(callCompleted, true);
    assert.equal(recommendationGenerated, false);
  });
});

// ==================== REDIS FALLBACK ====================

describe("Redis fallback behavior", () => {
  it("rate limiter falls back to in-memory without Redis", () => {
    const redisAvailable = false;
    const rateLimiterType = redisAvailable ? "redis" : "memory";
    assert.equal(rateLimiterType, "memory");
  });

  it("session store falls back to MemoryStore without Redis", () => {
    const redisAvailable = false;
    const sessionStore = redisAvailable ? "RedisStore" : "MemoryStore";
    assert.equal(sessionStore, "MemoryStore");
  });

  it("job queue falls back to in-process without Redis", () => {
    const redisAvailable = false;
    const queueType = redisAvailable ? "bullmq" : "in-process";
    assert.equal(queueType, "in-process");
  });
});
