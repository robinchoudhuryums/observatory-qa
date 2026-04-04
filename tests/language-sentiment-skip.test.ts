/**
 * Language-aware sentiment skipping tests — verifies that AssemblyAI
 * sentiment_analysis is disabled for non-English audio to save ~12% cost.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

describe("Language-aware sentiment skipping", () => {
  let capturedBodies: Array<Record<string, unknown>> = [];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    capturedBodies = [];
    originalFetch = globalThis.fetch;

    // Mock fetch to capture request bodies sent to AssemblyAI
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

      if (urlStr.includes("assemblyai.com/v2/transcript") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        capturedBodies.push(body);
        return new Response(JSON.stringify({ id: "test-transcript-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Default: return a generic OK for any other call (e.g., upload)
      return new Response(JSON.stringify({ upload_url: "https://example.com/audio" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("enables sentiment_analysis when no language is specified", async () => {
    // Dynamic import to pick up the mocked fetch
    const { AssemblyAIService } = await import("../server/services/assemblyai.js");
    const service = new AssemblyAIService();

    await service.transcribeAudio("https://example.com/audio.mp3");

    assert.equal(capturedBodies.length, 1, "Should have made one transcription request");
    assert.equal(capturedBodies[0].sentiment_analysis, true, "Sentiment should be enabled by default");
  });

  it("enables sentiment_analysis when language is English", async () => {
    const { AssemblyAIService } = await import("../server/services/assemblyai.js");
    const service = new AssemblyAIService();

    await service.transcribeAudio("https://example.com/audio.mp3", { language: "en" });

    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].sentiment_analysis, true, "Sentiment should be enabled for English");
  });

  it("enables sentiment_analysis for en-US variant", async () => {
    const { AssemblyAIService } = await import("../server/services/assemblyai.js");
    const service = new AssemblyAIService();

    await service.transcribeAudio("https://example.com/audio.mp3", { language: "en-US" });

    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].sentiment_analysis, true, "Sentiment should be enabled for en-US");
  });

  it("disables sentiment_analysis for Spanish (es)", async () => {
    const { AssemblyAIService } = await import("../server/services/assemblyai.js");
    const service = new AssemblyAIService();

    await service.transcribeAudio("https://example.com/audio.mp3", { language: "es" });

    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].sentiment_analysis, false, "Sentiment should be disabled for Spanish");
  });

  it("disables sentiment_analysis for French (fr)", async () => {
    const { AssemblyAIService } = await import("../server/services/assemblyai.js");
    const service = new AssemblyAIService();

    await service.transcribeAudio("https://example.com/audio.mp3", { language: "fr" });

    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].sentiment_analysis, false, "Sentiment should be disabled for French");
  });

  it("disables sentiment_analysis for Portuguese (pt)", async () => {
    const { AssemblyAIService } = await import("../server/services/assemblyai.js");
    const service = new AssemblyAIService();

    await service.transcribeAudio("https://example.com/audio.mp3", { language: "pt" });

    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].sentiment_analysis, false, "Sentiment should be disabled for Portuguese");
  });

  it("is case-insensitive for language codes", async () => {
    const { AssemblyAIService } = await import("../server/services/assemblyai.js");
    const service = new AssemblyAIService();

    await service.transcribeAudio("https://example.com/audio.mp3", { language: "ES" });

    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].sentiment_analysis, false, "Should handle uppercase language codes");
  });

  it("still enables other features when sentiment is skipped", async () => {
    const { AssemblyAIService } = await import("../server/services/assemblyai.js");
    const service = new AssemblyAIService();

    await service.transcribeAudio("https://example.com/audio.mp3", {
      language: "es",
      wordBoost: ["hola", "gracias"],
      languageDetection: true,
    });

    assert.equal(capturedBodies.length, 1);
    const body = capturedBodies[0];
    assert.equal(body.sentiment_analysis, false, "Sentiment disabled for Spanish");
    assert.equal(body.speaker_labels, true, "Speaker labels still enabled");
    assert.equal(body.language_detection, true, "Language detection still enabled");
    assert.deepEqual(body.word_boost, ["hola", "gracias"], "Word boost still passed");
  });
});
