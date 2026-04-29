/**
 * Tests for the Bedrock script rewriter / generator.
 *
 * Real Bedrock calls are exercised end-to-end by the admin UI smoke
 * test in PR #4 of the sub-arc. This file covers the pure surface:
 *   - prompt construction includes circumstances + tier expectation
 *   - JSON extraction handles plain JSON, fenced JSON, and prose+JSON
 *   - voice + tier are force-restored even if the model drifts
 *   - validation errors carry stage="validation_error"
 *   - "AI unavailable" path throws stage="unavailable"
 *
 * Network is stubbed by swapping `aiProvider.generateText` so the
 * fallback / model-routing paths are reachable without AWS access.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  rewriteScript,
  generateScriptFromScenario,
  ScriptRewriterError,
  _internal,
  type RewriteInput,
} from "../server/services/script-rewriter.js";
import { aiProvider } from "../server/services/ai-factory.js";
import type { SimulatedCallScript } from "../shared/simulated-call-schema.js";

const baseScript: SimulatedCallScript = {
  title: "Order status check",
  scenario: "Customer calling about a delayed shipment",
  qualityTier: "acceptable",
  voices: { agent: "voice_AGENT_id", customer: "voice_CUST_id" },
  turns: [
    { speaker: "agent", text: "Thanks for calling, how can I help?" },
    { speaker: "customer", text: "I'm checking on my order." },
  ],
};

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("buildRewritePrompt", () => {
  it("includes the BASE SCRIPT and circumstance descriptions", () => {
    const prompt = _internal.buildRewritePrompt({
      baseScript,
      circumstances: ["angry", "escalation"],
    } satisfies RewriteInput);
    assert.ok(prompt.includes("BASE SCRIPT"));
    assert.ok(prompt.includes("Order status check"));
    assert.ok(prompt.includes("- angry:"));
    assert.ok(prompt.includes("- escalation:"));
  });

  it("notes 'none' when no circumstances are configured", () => {
    const prompt = _internal.buildRewritePrompt({ baseScript, circumstances: [] });
    assert.ok(prompt.includes("(none"));
  });

  it("uses targetQualityTier when provided, otherwise the base script's tier", () => {
    const promptDefault = _internal.buildRewritePrompt({ baseScript, circumstances: [] });
    assert.ok(promptDefault.includes("TARGET QUALITY TIER: acceptable"));

    const promptOverride = _internal.buildRewritePrompt({
      baseScript,
      circumstances: [],
      targetQualityTier: "excellent",
    });
    assert.ok(promptOverride.includes("TARGET QUALITY TIER: excellent"));
  });
});

describe("buildGeneratorPrompt", () => {
  it("includes the title, scenario, voices, and tier expectation", () => {
    const prompt = _internal.buildGeneratorPrompt({
      title: "Insurance verification call",
      scenario: "Customer wants to confirm coverage",
      qualityTier: "excellent",
      voices: { agent: "v_a", customer: "v_c" },
    });
    assert.ok(prompt.includes("Insurance verification call"));
    assert.ok(prompt.includes("Customer wants to confirm coverage"));
    assert.ok(prompt.includes("v_a"));
    assert.ok(prompt.includes("v_c"));
    assert.ok(prompt.includes("Excellent handling"));
  });

  it("clamps targetTurnCount to [4, 30]", () => {
    const lowPrompt = _internal.buildGeneratorPrompt({
      title: "x",
      qualityTier: "acceptable",
      voices: { agent: "v", customer: "v" },
      targetTurnCount: 1,
    });
    assert.ok(lowPrompt.includes("approximately 4 turns"));

    const highPrompt = _internal.buildGeneratorPrompt({
      title: "x",
      qualityTier: "acceptable",
      voices: { agent: "v", customer: "v" },
      targetTurnCount: 1000,
    });
    assert.ok(highPrompt.includes("approximately 30 turns"));
  });
});

describe("extractJsonObject", () => {
  it("returns the input when it is plain JSON", () => {
    const raw = '{"title":"Hi","ok":true}';
    assert.equal(_internal.extractJsonObject(raw), raw);
  });

  it("strips fenced ```json``` wrappers", () => {
    const raw = '```json\n{"a":1}\n```';
    assert.equal(_internal.extractJsonObject(raw), '{"a":1}');
  });

  it("ignores leading/trailing prose", () => {
    const raw = 'Sure, here you go:\n{"a":1}\nLet me know if anything else.';
    assert.equal(_internal.extractJsonObject(raw), '{"a":1}');
  });

  it("handles braces inside string literals", () => {
    const raw = '{"text":"hello {world}"}';
    assert.equal(_internal.extractJsonObject(raw), raw);
  });

  it("returns null when no balanced object is present", () => {
    assert.equal(_internal.extractJsonObject("no json here"), null);
    assert.equal(_internal.extractJsonObject("{ unbalanced "), null);
  });
});

// ── Stubbed-aiProvider tests ────────────────────────────────────────────────

describe("rewriteScript — stubbed model", () => {
  let originalGenerateText: typeof aiProvider.generateText;
  let originalIsAvailable: boolean;

  beforeEach(() => {
    originalGenerateText = aiProvider.generateText;
    // Pretend the provider is available (test-mode credentials may be missing).
    originalIsAvailable = aiProvider.isAvailable;
    Object.defineProperty(aiProvider, "isAvailable", { value: true, configurable: true });
  });

  afterEach(() => {
    aiProvider.generateText = originalGenerateText;
    Object.defineProperty(aiProvider, "isAvailable", { value: originalIsAvailable, configurable: true });
  });

  it("force-restores voices and qualityTier even when the model returns different ones", async () => {
    aiProvider.generateText = async () =>
      JSON.stringify({
        title: "MODEL TITLE",
        scenario: "MODEL SCENARIO",
        qualityTier: "poor", // model tries to drift
        voices: { agent: "WRONG_AGENT", customer: "WRONG_CUST" }, // model tries to swap
        turns: [
          { speaker: "agent", text: "Rewritten 1" },
          { speaker: "customer", text: "Rewritten 2" },
        ],
      });

    const result = await rewriteScript({
      baseScript,
      circumstances: ["angry"],
      targetQualityTier: "excellent",
    });

    assert.equal(result.script.voices.agent, "voice_AGENT_id", "voices must be restored from base");
    assert.equal(result.script.voices.customer, "voice_CUST_id");
    assert.equal(result.script.qualityTier, "excellent", "tier must use the requested target");
    assert.equal(result.script.turns.length, 2);
  });

  it("throws stage=parse_error when the model returns no JSON", async () => {
    aiProvider.generateText = async () => "I cannot do that, Dave.";
    await assert.rejects(
      () => rewriteScript({ baseScript, circumstances: [] }),
      (err) => err instanceof ScriptRewriterError && err.stage === "parse_error",
    );
  });

  it("throws stage=parse_error when the JSON is malformed", async () => {
    aiProvider.generateText = async () => '{"title": "incomplete';
    await assert.rejects(
      () => rewriteScript({ baseScript, circumstances: [] }),
      (err) => err instanceof ScriptRewriterError && err.stage === "parse_error",
    );
  });

  it("throws stage=validation_error when the JSON is well-formed but doesn't match the schema", async () => {
    aiProvider.generateText = async () =>
      JSON.stringify({
        title: "x",
        // missing required fields: qualityTier, voices, turns
      });
    await assert.rejects(
      () => rewriteScript({ baseScript, circumstances: [] }),
      (err) => err instanceof ScriptRewriterError && err.stage === "validation_error",
    );
  });

  it("throws stage=model_error when generateText itself throws", async () => {
    aiProvider.generateText = async () => {
      throw new Error("AWS credentials missing");
    };
    await assert.rejects(
      () => rewriteScript({ baseScript, circumstances: [] }),
      (err) =>
        err instanceof ScriptRewriterError &&
        err.stage === "model_error" &&
        /AWS credentials missing/.test(err.message),
    );
  });

  it("throws stage=unavailable when aiProvider is not configured", async () => {
    Object.defineProperty(aiProvider, "isAvailable", { value: false, configurable: true });
    await assert.rejects(
      () => rewriteScript({ baseScript, circumstances: [] }),
      (err) => err instanceof ScriptRewriterError && err.stage === "unavailable",
    );
  });
});

describe("generateScriptFromScenario — stubbed model", () => {
  let originalGenerateText: typeof aiProvider.generateText;
  let originalIsAvailable: boolean;

  beforeEach(() => {
    originalGenerateText = aiProvider.generateText;
    originalIsAvailable = aiProvider.isAvailable;
    Object.defineProperty(aiProvider, "isAvailable", { value: true, configurable: true });
  });

  afterEach(() => {
    aiProvider.generateText = originalGenerateText;
    Object.defineProperty(aiProvider, "isAvailable", { value: originalIsAvailable, configurable: true });
  });

  it("rejects empty title with stage=validation_error", async () => {
    await assert.rejects(
      () =>
        generateScriptFromScenario({
          title: "  ",
          qualityTier: "acceptable",
          voices: { agent: "v_a", customer: "v_c" },
        }),
      (err) => err instanceof ScriptRewriterError && err.stage === "validation_error",
    );
  });

  it("preserves admin-supplied title even when the model drifts", async () => {
    aiProvider.generateText = async () =>
      JSON.stringify({
        title: "MODEL'S RENAMED TITLE WITH EXTRA WORDS",
        scenario: "model scenario",
        qualityTier: "acceptable",
        voices: { agent: "MODEL_AGENT", customer: "MODEL_CUST" },
        turns: [
          { speaker: "agent", text: "Hi" },
          { speaker: "customer", text: "Hello" },
        ],
      });

    const result = await generateScriptFromScenario({
      title: "Admin's Original Title",
      qualityTier: "excellent",
      voices: { agent: "v_real_a", customer: "v_real_c" },
      // useStrong=true skips the Haiku fallback path so we hit aiProvider directly.
      useStrong: true,
    });

    assert.equal(result.script.title, "Admin's Original Title");
    assert.equal(result.script.qualityTier, "excellent");
    assert.equal(result.script.voices.agent, "v_real_a");
    assert.equal(result.script.voices.customer, "v_real_c");
    assert.equal(result.modelUsed, "default");
    assert.equal(result.fellBackFromHaiku, false);
  });
});
