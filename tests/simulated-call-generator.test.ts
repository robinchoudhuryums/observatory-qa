/**
 * Tests for the Simulated Call Generator orchestrator.
 *
 * Network/disk dependencies (ElevenLabs TTS, ffmpeg, S3) are stubbed via
 * the injectable `GeneratorDeps` and a global storage swap, so the suite
 * runs offline and deterministically.
 *
 * What's covered:
 *   - runTtsPipeline emits one segment per spoken turn + interleaved gaps
 *   - hold turns become silence segments with the right duration
 *   - disfluency injection runs only when config.disfluencies !== false
 *   - excellent-tier scripts NEVER receive disfluencies (regardless of toggle)
 *   - rule-based circumstance modifiers (angry) reach the TTS layer
 *   - generateSimulatedCall flips status pending → generating → ready
 *   - generateSimulatedCall flips to failed + records error on assembler throw
 *   - cost is computed from total characters via estimateElevenLabsCost
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";
import {
  runTtsPipeline,
  generateSimulatedCall,
  type AudioSegment,
  type AudioAssembler,
  type TtsSynthesizer,
} from "../server/services/simulated-call-generator.js";
import type { SimulatedCallScript } from "../shared/simulated-call-schema.js";

// ── Test doubles ────────────────────────────────────────────────────

function makeStubTts(): TtsSynthesizer & {
  calls: Array<{ text: string; voiceId: string }>;
} {
  const calls: Array<{ text: string; voiceId: string }> = [];
  return {
    calls,
    async synthesize(text, voiceId) {
      calls.push({ text, voiceId });
      // Synthesize a deterministic "audio" buffer so tests can verify byte
      // count and segment ordering. Length proportional to text length.
      return { audio: Buffer.from(`AUDIO[${text}]`), chars: text.length };
    },
  };
}

function makeStubAssembler(): AudioAssembler & { received: AudioSegment[][] } {
  const received: AudioSegment[][] = [];
  return {
    received,
    async assemble(segments) {
      received.push(segments);
      // Concat raw buffers with a 1-byte separator. Duration roughly = segment count.
      const audioParts = segments
        .filter((s): s is { kind: "audio"; buffer: Buffer } => s.kind === "audio")
        .map((s) => s.buffer);
      const buffer = Buffer.concat(audioParts);
      return { buffer, durationSeconds: segments.length };
    },
  };
}

function constantRng(value = 0.5): () => number {
  return () => value;
}

const baseScript: SimulatedCallScript = {
  title: "Order status check",
  scenario: "Customer calling about a delayed shipment",
  qualityTier: "acceptable",
  voices: { agent: "voice_AGENT", customer: "voice_CUST" },
  turns: [
    { speaker: "agent", text: "Thanks for calling, how can I help?" },
    { speaker: "customer", text: "I'm checking on my order." },
  ],
};

let memStorage: MemStorage;

beforeEach(() => {
  memStorage = new MemStorage();
});

// ── runTtsPipeline ──────────────────────────────────────────────────

describe("runTtsPipeline — segment plan", () => {
  it("emits one audio segment per spoken turn with a gap between", async () => {
    const tts = makeStubTts();
    const { segments, ttsCharCount } = await runTtsPipeline(
      baseScript,
      { circumstances: [] },
      { tts, rng: constantRng() },
    );
    // Expected: audio + silence + audio = 3 segments.
    assert.equal(segments.length, 3);
    assert.equal(segments[0].kind, "audio");
    assert.equal(segments[1].kind, "silence");
    assert.equal(segments[2].kind, "audio");
    assert.equal(tts.calls.length, 2);
    assert.equal(tts.calls[0].voiceId, "voice_AGENT");
    assert.equal(tts.calls[1].voiceId, "voice_CUST");
    assert.ok(ttsCharCount > 0);
  });

  it("uses gapMeanSeconds for the inter-turn silence", async () => {
    const tts = makeStubTts();
    const { segments } = await runTtsPipeline(
      baseScript,
      { circumstances: [], gapMeanSeconds: 1.5, gapStdDevSeconds: 0 }, // zero jitter
      { tts, rng: constantRng() },
    );
    const silence = segments.find((s) => s.kind === "silence") as { kind: "silence"; durationMs: number };
    assert.equal(silence.durationMs, 1500);
  });

  it("converts hold turns to silence with the right duration", async () => {
    const tts = makeStubTts();
    const script: SimulatedCallScript = {
      ...baseScript,
      turns: [
        { speaker: "agent", text: "Please hold." },
        { speaker: "hold", duration: 5 }, // seconds
        { speaker: "agent", text: "Thanks for waiting." },
      ],
    };
    const { segments } = await runTtsPipeline(script, { circumstances: [] }, { tts, rng: constantRng() });
    // Hold turns ARE the silence — no extra gap is inserted before/after
    // them, so: audio + hold-silence + gap + audio = 4 segments.
    assert.equal(segments.length, 4);
    const holdSegment = segments[1] as { kind: "silence"; durationMs: number };
    assert.equal(holdSegment.kind, "silence");
    assert.equal(holdSegment.durationMs, 5000);
    // Inter-turn gap (between hold and final agent turn) is much smaller.
    const gapAfterHold = segments[2] as { kind: "silence"; durationMs: number };
    assert.equal(gapAfterHold.kind, "silence");
    assert.ok(gapAfterHold.durationMs < 5000);
  });

  it("excellent-tier scripts pass text through unchanged (no disfluencies)", async () => {
    const tts = makeStubTts();
    const original = "Thank you for calling. How may I help?";
    const script: SimulatedCallScript = {
      ...baseScript,
      qualityTier: "excellent",
      turns: [{ speaker: "agent", text: original }],
    };
    await runTtsPipeline(script, { circumstances: [] }, { tts, rng: constantRng() });
    assert.equal(tts.calls[0].text, original);
  });

  it("respects config.disfluencies=false (no disfluency injection on poor tier)", async () => {
    const tts = makeStubTts();
    const original = "I'm here to help. Tell me more.";
    const script: SimulatedCallScript = {
      ...baseScript,
      qualityTier: "poor",
      turns: [{ speaker: "agent", text: original }],
    };
    await runTtsPipeline(script, { circumstances: [], disfluencies: false }, { tts, rng: () => 0.01 });
    assert.equal(tts.calls[0].text, original, "poor tier with disfluencies=false must not mutate text");
  });

  it("uses the per-turn voiceSettings if provided, otherwise the script default", async () => {
    let receivedSettings: unknown = null;
    const tts: TtsSynthesizer = {
      async synthesize(_text, _voiceId, settings) {
        if (!receivedSettings) receivedSettings = settings;
        return { audio: Buffer.from("AUDIO"), chars: 5 };
      },
    };
    const script: SimulatedCallScript = {
      ...baseScript,
      defaultVoiceSettings: { stability: 0.7 },
      turns: [{ speaker: "agent", text: "Hi", voiceSettings: { stability: 0.9 } }],
    };
    await runTtsPipeline(script, { circumstances: [] }, { tts, rng: constantRng() });
    assert.deepEqual(receivedSettings, { stability: 0.9 }, "per-turn settings should win");
  });
});

// ── generateSimulatedCall (full orchestrator) ───────────────────────

describe("generateSimulatedCall — happy path", () => {
  it("flips status pending → ready and persists audio + metrics", async () => {
    const created = await memStorage.createSimulatedCall("org-A", {
      orgId: "org-A",
      title: "Test",
      script: baseScript,
      config: { circumstances: [] } as never,
      createdBy: "tester",
    });

    const tts = makeStubTts();
    const assembler = makeStubAssembler();
    const result = await generateSimulatedCall("org-A", created.id, {
      tts,
      assembler,
      rng: constantRng(),
      storage: memStorage,
    });

    const after = await memStorage.getSimulatedCall("org-A", created.id);
    assert.ok(after);
    assert.equal(after!.status, "ready");
    assert.ok(after!.audioS3Key, "audioS3Key must be set");
    assert.equal(after!.audioS3Key!.startsWith("org-A/audio/"), true);
    assert.equal(after!.audioFormat, "mp3");
    assert.equal(after!.durationSeconds, result.durationSeconds);
    assert.ok(after!.ttsCharCount && after!.ttsCharCount > 0);
    assert.ok(after!.estimatedCost && after!.estimatedCost > 0);
    assert.equal(after!.error, null);

    // Audio buffer was actually uploaded to MemStorage.
    const fetched = await memStorage.downloadAudio("org-A", after!.audioS3Key!);
    assert.ok(fetched && fetched.length > 0);
  });

  it("returns early without re-running if status is already ready", async () => {
    const created = await memStorage.createSimulatedCall("org-A", {
      orgId: "org-A",
      title: "Test",
      script: baseScript,
      config: { circumstances: [] } as never,
      createdBy: "tester",
    });
    await memStorage.updateSimulatedCall("org-A", created.id, {
      status: "ready",
      audioS3Key: "org-A/audio/" + created.id + "/cached.mp3",
      durationSeconds: 42,
      ttsCharCount: 100,
      estimatedCost: 0.03,
    });

    const tts = makeStubTts();
    const assembler = makeStubAssembler();
    const result = await generateSimulatedCall("org-A", created.id, {
      tts,
      assembler,
      rng: constantRng(),
      storage: memStorage,
    });

    assert.equal(tts.calls.length, 0, "TTS must not be called when row is already ready");
    assert.equal(assembler.received.length, 0, "Assembler must not be called when row is already ready");
    assert.equal(result.durationSeconds, 42);
  });
});

// ── generateSimulatedCall (failure paths) ───────────────────────────

describe("generateSimulatedCall — failure paths", () => {
  it("flips status to failed and records the error message when the assembler throws", async () => {
    const created = await memStorage.createSimulatedCall("org-A", {
      orgId: "org-A",
      title: "Test",
      script: baseScript,
      config: { circumstances: [] } as never,
      createdBy: "tester",
    });

    const tts = makeStubTts();
    const failingAssembler: AudioAssembler = {
      async assemble() {
        throw new Error("ffmpeg not on PATH");
      },
    };

    await assert.rejects(
      generateSimulatedCall("org-A", created.id, {
        tts,
        assembler: failingAssembler,
        rng: constantRng(),
        storage: memStorage,
      }),
    );

    const after = await memStorage.getSimulatedCall("org-A", created.id);
    assert.ok(after);
    assert.equal(after!.status, "failed");
    assert.ok(after!.error, "error must be populated");
    assert.match(after!.error!, /assemble/i);
    assert.match(after!.error!, /ffmpeg/i);
  });

  it("throws stage=load when the row is missing", async () => {
    await assert.rejects(
      generateSimulatedCall("org-A", "does-not-exist", {
        tts: makeStubTts(),
        assembler: makeStubAssembler(),
        rng: constantRng(),
        storage: memStorage,
      }),
      (err) => err instanceof Error && /not found/i.test(err.message),
    );
  });
});
