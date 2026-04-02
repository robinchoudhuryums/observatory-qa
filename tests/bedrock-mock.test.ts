/**
 * AI provider mock tests — verifies behavior under Bedrock failure modes
 * without requiring real AWS credentials.
 *
 * Covers:
 *   - Normal analysis with valid JSON response
 *   - Malformed JSON response (truncated, markdown-wrapped)
 *   - Rate limiting (429 status)
 *   - Timeout (aborted request)
 *   - Unavailable provider (no credentials)
 *   - Default scores when AI fails
 *   - Score clamping on out-of-range values
 *   - Missing fields get safe defaults
 *
 * Run with: npx tsx --test tests/bedrock-mock.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJsonResponse } from "../server/services/ai-types.js";
import type { AIAnalysisProvider, CallAnalysis, PromptTemplateConfig } from "../server/services/ai-types.js";

// ============================================================================
// Mock AI Provider — simulates various Bedrock behaviors
// ============================================================================

type MockBehavior =
  | { type: "success"; response: string }
  | { type: "malformed_json"; response: string }
  | { type: "rate_limit" }
  | { type: "timeout"; delayMs: number }
  | { type: "unavailable" }
  | { type: "empty_response" }
  | { type: "server_error"; statusCode: number; message: string };

class MockBedrockProvider implements AIAnalysisProvider {
  readonly name = "mock-bedrock";
  private behavior: MockBehavior;
  callCount = 0;

  constructor(behavior: MockBehavior) {
    this.behavior = behavior;
  }

  get isAvailable(): boolean {
    return this.behavior.type !== "unavailable";
  }

  setBehavior(behavior: MockBehavior): void {
    this.behavior = behavior;
  }

  async analyzeCallTranscript(
    transcriptText: string,
    callId: string,
    _callCategory?: string,
    _promptTemplate?: PromptTemplateConfig,
  ): Promise<CallAnalysis> {
    this.callCount++;

    switch (this.behavior.type) {
      case "success":
        return parseJsonResponse(this.behavior.response, callId);

      case "malformed_json":
        return parseJsonResponse(this.behavior.response, callId);

      case "rate_limit":
        throw Object.assign(new Error("Throttling"), {
          $metadata: { httpStatusCode: 429 },
        });

      case "timeout":
        throw Object.assign(new Error("Request aborted"), {
          name: "AbortError",
          $metadata: { httpStatusCode: 0 },
        });

      case "server_error":
        throw Object.assign(new Error(this.behavior.message), {
          $metadata: { httpStatusCode: this.behavior.statusCode },
        });

      case "empty_response":
        return parseJsonResponse("", callId);

      case "unavailable":
        throw new Error("Bedrock provider not configured — no AWS credentials available");
    }
  }

  async generateText(prompt: string): Promise<string> {
    if (this.behavior.type === "success") return "Generated text response";
    throw new Error("Mock: generateText not available");
  }
}

// ============================================================================
// Valid response fixture
// ============================================================================

const VALID_RESPONSE = JSON.stringify({
  summary: "Customer called about insurance coverage for dental crown.",
  topics: ["insurance", "dental crown", "coverage"],
  sentiment: "neutral",
  sentiment_score: 0.55,
  performance_score: 7.2,
  sub_scores: {
    compliance: 8.0,
    customer_experience: 7.5,
    communication: 6.8,
    resolution: 7.0,
  },
  action_items: ["Follow up on pre-authorization"],
  feedback: {
    strengths: ["Clear explanation of benefits"],
    suggestions: ["Ask for preferred callback time"],
  },
  call_party_type: "customer",
  flags: [],
  detected_agent_name: "Sarah",
});

// ============================================================================
// Tests
// ============================================================================

describe("AI Provider Mock: successful analysis", () => {
  it("parses valid JSON response correctly", () => {
    const result = parseJsonResponse(VALID_RESPONSE, "call-1");
    assert.equal(result.performance_score, 7.2);
    assert.equal(result.sentiment, "neutral");
    assert.equal(result.detected_agent_name, "Sarah");
    assert.deepEqual(result.topics, ["insurance", "dental crown", "coverage"]);
    assert.equal(result.sub_scores.compliance, 8.0);
  });

  it("mock provider tracks call count", async () => {
    const provider = new MockBedrockProvider({ type: "success", response: VALID_RESPONSE });
    await provider.analyzeCallTranscript("transcript", "call-1");
    await provider.analyzeCallTranscript("transcript", "call-2");
    assert.equal(provider.callCount, 2);
  });
});

describe("AI Provider Mock: malformed JSON response", () => {
  it("handles markdown-wrapped JSON (```json ... ```)", () => {
    const wrapped = "```json\n" + VALID_RESPONSE + "\n```";
    const result = parseJsonResponse(wrapped, "call-1");
    assert.equal(result.performance_score, 7.2);
  });

  it("handles truncated JSON by attempting recovery", () => {
    // Truncated mid-value — parseJsonResponse may recover partial JSON
    // or throw AI_MALFORMED_JSON if it can't parse at all
    const truncated = '{"summary":"Truncated call","performance_score":6.5,"sentiment":"neutral","sentiment_score":0.5';
    try {
      const result = parseJsonResponse(truncated, "call-1");
      // If recovery succeeded, check fields are valid
      assert.equal(typeof result.performance_score, "number");
    } catch (err: any) {
      // Recovery failed — verify it throws with proper error code
      assert.ok(err.code === "AI_MALFORMED_JSON" || err.code === "AI_NO_JSON");
    }
  });

  it("throws AI_NO_JSON for completely invalid response", () => {
    // parseJsonResponse throws when no JSON is found — the caller
    // (call-processing.ts) catches this and applies default scores
    assert.throws(
      () => parseJsonResponse("This is not JSON at all", "call-1"),
      (err: any) => err.code === "AI_NO_JSON",
    );
  });

  it("throws AI_NO_JSON for empty response", () => {
    assert.throws(
      () => parseJsonResponse("", "call-1"),
      (err: any) => err.code === "AI_NO_JSON",
    );
  });
});

describe("AI Provider Mock: score clamping", () => {
  it("clamps performance_score above 10 to 10", () => {
    const response = JSON.stringify({ ...JSON.parse(VALID_RESPONSE), performance_score: 15 });
    const result = parseJsonResponse(response, "call-1");
    assert.ok(result.performance_score <= 10, `Got ${result.performance_score}`);
  });

  it("clamps performance_score below 0 to 0", () => {
    const response = JSON.stringify({ ...JSON.parse(VALID_RESPONSE), performance_score: -3 });
    const result = parseJsonResponse(response, "call-1");
    assert.ok(result.performance_score >= 0, `Got ${result.performance_score}`);
  });

  it("clamps sentiment_score to [0, 1]", () => {
    const response = JSON.stringify({ ...JSON.parse(VALID_RESPONSE), sentiment_score: 2.5 });
    const result = parseJsonResponse(response, "call-1");
    assert.ok(result.sentiment_score <= 1, `Got ${result.sentiment_score}`);
  });

  it("clamps sub_scores to [0, 10]", () => {
    const response = JSON.stringify({
      ...JSON.parse(VALID_RESPONSE),
      sub_scores: { compliance: 15, customer_experience: -2, communication: 7, resolution: 11 },
    });
    const result = parseJsonResponse(response, "call-1");
    assert.ok(result.sub_scores.compliance <= 10);
    assert.ok(result.sub_scores.customer_experience >= 0);
    assert.ok(result.sub_scores.resolution <= 10);
  });
});

describe("AI Provider Mock: error handling", () => {
  it("rate limit (429) throws with status code", async () => {
    const provider = new MockBedrockProvider({ type: "rate_limit" });
    await assert.rejects(
      () => provider.analyzeCallTranscript("transcript", "call-1"),
      (err: any) => {
        assert.equal(err.$metadata?.httpStatusCode, 429);
        return true;
      },
    );
  });

  it("timeout throws AbortError", async () => {
    const provider = new MockBedrockProvider({ type: "timeout", delayMs: 100 });
    await assert.rejects(
      () => provider.analyzeCallTranscript("transcript", "call-1"),
      (err: any) => {
        assert.equal(err.name, "AbortError");
        return true;
      },
    );
  });

  it("server error (500) throws with status code", async () => {
    const provider = new MockBedrockProvider({
      type: "server_error",
      statusCode: 500,
      message: "Internal Service Error",
    });
    await assert.rejects(
      () => provider.analyzeCallTranscript("transcript", "call-1"),
      (err: any) => {
        assert.equal(err.$metadata?.httpStatusCode, 500);
        return true;
      },
    );
  });

  it("unavailable provider throws descriptive error", async () => {
    const provider = new MockBedrockProvider({ type: "unavailable" });
    assert.equal(provider.isAvailable, false);
    await assert.rejects(
      () => provider.analyzeCallTranscript("transcript", "call-1"),
      /not configured/,
    );
  });

  it("403 (access denied) throws with status code", async () => {
    const provider = new MockBedrockProvider({
      type: "server_error",
      statusCode: 403,
      message: "Access Denied",
    });
    await assert.rejects(
      () => provider.analyzeCallTranscript("transcript", "call-1"),
      (err: any) => {
        assert.equal(err.$metadata?.httpStatusCode, 403);
        return true;
      },
    );
  });
});

describe("AI Provider Mock: missing fields get safe defaults", () => {
  it("missing sub_scores get default 5.0", () => {
    const response = JSON.stringify({
      summary: "A call",
      performance_score: 7,
      sentiment: "positive",
      sentiment_score: 0.8,
    });
    const result = parseJsonResponse(response, "call-1");
    assert.equal(result.sub_scores.compliance, 5);
    assert.equal(result.sub_scores.customer_experience, 5);
    assert.equal(result.sub_scores.communication, 5);
    assert.equal(result.sub_scores.resolution, 5);
  });

  it("missing topics/action_items default to empty arrays", () => {
    const response = JSON.stringify({
      summary: "A call",
      performance_score: 7,
      sentiment: "positive",
      sentiment_score: 0.8,
    });
    const result = parseJsonResponse(response, "call-1");
    assert.deepEqual(result.topics, []);
    assert.deepEqual(result.action_items, []);
    assert.deepEqual(result.flags, []);
  });

  it("missing feedback defaults to empty strengths/suggestions", () => {
    const response = JSON.stringify({
      summary: "A call",
      performance_score: 7,
      sentiment: "positive",
      sentiment_score: 0.8,
    });
    const result = parseJsonResponse(response, "call-1");
    assert.deepEqual(result.feedback.strengths, []);
    assert.deepEqual(result.feedback.suggestions, []);
  });

  it("non-string sentiment defaults to neutral", () => {
    const response = JSON.stringify({
      summary: "A call",
      performance_score: 7,
      sentiment: 42, // wrong type
      sentiment_score: 0.8,
    });
    const result = parseJsonResponse(response, "call-1");
    assert.equal(result.sentiment, "neutral");
  });
});

describe("AI Provider Mock: behavior switching", () => {
  it("can switch from success to error mode", async () => {
    const provider = new MockBedrockProvider({ type: "success", response: VALID_RESPONSE });

    // First call succeeds
    const result = await provider.analyzeCallTranscript("transcript", "call-1");
    assert.equal(result.performance_score, 7.2);

    // Switch to rate limit mode
    provider.setBehavior({ type: "rate_limit" });
    await assert.rejects(() => provider.analyzeCallTranscript("transcript", "call-2"));

    // Switch back to success
    provider.setBehavior({ type: "success", response: VALID_RESPONSE });
    const result2 = await provider.analyzeCallTranscript("transcript", "call-3");
    assert.equal(result2.performance_score, 7.2);
    assert.equal(provider.callCount, 3);
  });
});
