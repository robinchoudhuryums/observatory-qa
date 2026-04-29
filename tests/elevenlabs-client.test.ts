/**
 * Tests for the ElevenLabs TTS client + cost estimator.
 *
 * The real `textToSpeech` and `listVoices` calls hit the network; those
 * are exercised end-to-end by the Simulated Call Generator E2E spec.
 * This file covers the static / pure surface:
 *   - cost estimation rate + override
 *   - `isAvailable` reflects the env var
 *   - `requireKey` throws when the key is missing (via public surface)
 *   - retry logic on 429 (with `globalThis.fetch` stubbed)
 *   - non-429 non-2xx responses surface as thrown errors
 *
 * Run: `npx tsx --test tests/elevenlabs-client.test.ts`
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { estimateElevenLabsCost } from "../server/services/cost-estimation.js";

// ── Cost estimation ──────────────────────────────────────────────────────────

describe("estimateElevenLabsCost", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.ELEVENLABS_COST_PER_CHAR;
    delete process.env.ELEVENLABS_COST_PER_CHAR;
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env.ELEVENLABS_COST_PER_CHAR = originalEnv;
    else delete process.env.ELEVENLABS_COST_PER_CHAR;
  });

  it("uses the standard tier rate by default ($0.30 / 1000 chars)", () => {
    // 1000 characters → $0.30
    assert.equal(estimateElevenLabsCost(1000), 0.3);
  });

  it("scales linearly with character count", () => {
    assert.equal(estimateElevenLabsCost(0), 0);
    assert.equal(estimateElevenLabsCost(500), 0.15);
    assert.equal(estimateElevenLabsCost(2000), 0.6);
  });

  it("rounds to 4 decimal places (keeps usage_record JSON stable)", () => {
    // 333 chars × 0.0003 = 0.0999 — already 4 dp, must not introduce float noise
    const cost = estimateElevenLabsCost(333);
    assert.equal(cost, 0.0999);
    // 7 chars × 0.0003 = 0.0021
    assert.equal(estimateElevenLabsCost(7), 0.0021);
  });

  it("respects ELEVENLABS_COST_PER_CHAR override (Creator/Pro tiers)", () => {
    process.env.ELEVENLABS_COST_PER_CHAR = "0.00018"; // hypothetical Creator rate
    assert.equal(estimateElevenLabsCost(1000), 0.18);
  });

  it("ignores invalid override values (NaN, zero, negative)", () => {
    for (const bad of ["not-a-number", "0", "-0.0001", ""]) {
      process.env.ELEVENLABS_COST_PER_CHAR = bad;
      assert.equal(
        estimateElevenLabsCost(1000),
        0.3,
        `override "${bad}" should fall back to the default rate`,
      );
    }
  });
});

// ── Client behavior (with network stubbed) ───────────────────────────────────

describe("ElevenLabsClient.isAvailable", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.ELEVENLABS_API_KEY = originalKey;
    else delete process.env.ELEVENLABS_API_KEY;
  });

  it("reports false when the API key is missing", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const { ElevenLabsClient } = await import("../server/services/elevenlabs-client.js");
    const client = new ElevenLabsClient();
    assert.equal(client.isAvailable, false);
  });

  it("reports true when the API key is set", async () => {
    process.env.ELEVENLABS_API_KEY = "fake-key-for-testing";
    const { ElevenLabsClient } = await import("../server/services/elevenlabs-client.js");
    const client = new ElevenLabsClient();
    assert.equal(client.isAvailable, true);
  });
});

describe("ElevenLabsClient.textToSpeech — error paths", () => {
  let originalKey: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalKey = process.env.ELEVENLABS_API_KEY;
    originalFetch = globalThis.fetch;
    process.env.ELEVENLABS_API_KEY = "fake-key";
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.ELEVENLABS_API_KEY = originalKey;
    else delete process.env.ELEVENLABS_API_KEY;
    globalThis.fetch = originalFetch;
  });

  it("throws when API key is missing", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const { ElevenLabsClient } = await import("../server/services/elevenlabs-client.js");
    const client = new ElevenLabsClient();
    await assert.rejects(
      () => client.textToSpeech({ voiceId: "v1", text: "hi" }),
      /ELEVENLABS_API_KEY is not set/,
    );
  });

  it("surfaces non-429 non-2xx responses as thrown errors", async () => {
    globalThis.fetch = async () =>
      new Response("Forbidden", { status: 403, statusText: "Forbidden" });
    const { ElevenLabsClient } = await import("../server/services/elevenlabs-client.js");
    const client = new ElevenLabsClient();
    await assert.rejects(
      () => client.textToSpeech({ voiceId: "v1", text: "hi" }),
      /ElevenLabs TTS failed: 403/,
    );
  });

  it("retries on 429 with backoff and ultimately succeeds", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls < 3) {
        return new Response("Rate limited", { status: 429 });
      }
      // Third call succeeds — return a tiny audio buffer
      const fakeAudio = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
      return new Response(fakeAudio, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    };

    const { ElevenLabsClient } = await import("../server/services/elevenlabs-client.js");
    const client = new ElevenLabsClient();
    const result = await client.textToSpeech({ voiceId: "v1", text: "hello world" });

    assert.equal(calls, 3, "should retry twice then succeed on third attempt");
    assert.equal(result.characterCount, "hello world".length);
    assert.ok(result.audio.length > 0, "audio buffer must be returned");
    assert.ok(result.latencyMs >= 0);
  });

  it("gives up after 4 consecutive 429s (initial + 3 retries)", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("Rate limited", { status: 429 });
    };

    const { ElevenLabsClient } = await import("../server/services/elevenlabs-client.js");
    const client = new ElevenLabsClient();
    await assert.rejects(
      () => client.textToSpeech({ voiceId: "v1", text: "hi" }),
      /ElevenLabs TTS failed: 429/,
    );
    assert.equal(calls, 4, "initial attempt + 3 retries = 4 total calls");
  });
});
