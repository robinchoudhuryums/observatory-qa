/**
 * Bedrock-powered script rewriter for the Simulated Call Generator.
 *
 * Adapted from the single-tenant CallAnalyzer (assemblyai_tool) for
 * Observatory. Two surfaces:
 *
 *   1. `rewriteScript(input)` — takes an existing `SimulatedCallScript`
 *      and a list of circumstances, returns a rewritten variant. Used
 *      by the "Create Variation" admin flow to generate richer, more
 *      nuanced variants than the rule-based modifiers can produce
 *      (e.g. `confused`, `grateful`, `non_native_speaker`).
 *
 *   2. `generateScriptFromScenario(input)` — takes a title + scenario
 *      description with no existing turns, returns a full script. Used
 *      by the "New Simulated Call" admin flow.
 *
 * Cost: ~$0.003 on Haiku, ~$0.034 on Sonnet per call. Dwarfed by the
 * TTS cost of the resulting call (~$1–2). The generator tries Haiku
 * first (cheap + fast) and falls back to the default `aiProvider`
 * (typically Sonnet via `BEDROCK_MODEL`) on 4xx — usually means the
 * AWS account doesn't have Haiku 4.5 access enabled. 429s and 5xx
 * surface unchanged so we don't paper over rate limits or outages.
 *
 * Security posture:
 * - The output is validated against `simulatedCallScriptSchema` via Zod.
 *   Malformed/missing fields throw, keeping the route handler honest.
 * - `voices` is force-restored from the base/input so the model cannot
 *   swap in unknown voice IDs.
 * - `qualityTier` is force-set from the caller so an overzealous rewrite
 *   can't drop tier consistency.
 */
import { aiProvider } from "./ai-factory";
import { BedrockProvider } from "./bedrock";
import { logger } from "./logger";
import {
  simulatedCallScriptSchema,
  CIRCUMSTANCE_META,
  type SimulatedCallScript,
  type Circumstance,
} from "@shared/simulated-call-schema";

/**
 * Haiku model ID used for fast/cheap script generation. Override via
 * `SIMULATED_CALL_HAIKU_MODEL` env var if AWS publishes a newer Haiku
 * before we update the default.
 */
const HAIKU_MODEL = process.env.SIMULATED_CALL_HAIKU_MODEL ?? "anthropic.claude-3-haiku-20240307";

/** Token budget for rewrites (15-turn variant + JSON overhead). */
const REWRITE_MAX_TOKENS = 6144;

/** Token budget for generation from scratch (up to ~30 turns). */
const GENERATE_MAX_TOKENS = 8192;

export interface RewriteInput {
  baseScript: SimulatedCallScript;
  circumstances: Circumstance[];
  /** Target quality tier for the rewrite. Defaults to the base script's tier. */
  targetQualityTier?: "poor" | "acceptable" | "excellent";
}

export interface RewriteResult {
  script: SimulatedCallScript;
  /** Raw model output for debugging. Not persisted. */
  rawResponse: string;
  /** Approximate input + output char count so the UI can estimate cost. */
  promptChars: number;
  responseChars: number;
  /**
   * Which model actually produced the script. Differs from what was
   * requested if Haiku wasn't accessible and we fell back to the
   * default `aiProvider`.
   */
  modelUsed?: "haiku" | "sonnet" | "default" | "fallback";
  /** True iff we tried Haiku first and had to fall back to the default model. */
  fellBackFromHaiku?: boolean;
}

// ── Prompt construction ────────────────────────────────────────────

const SYSTEM_INSTRUCTIONS = `You are a writer rewriting customer-service call scripts for a QA training tool. You transform a BASE SCRIPT into a VARIANT that reflects specific circumstances (e.g. angry customer, escalation, non-native speaker) while preserving the scenario and core outcome.

Rules:
1. Preserve the call's scenario and overall resolution path. Do not invent new medical facts or policies.
2. Preserve the voices mapping EXACTLY as given. Do not substitute voice IDs.
3. Preserve the qualityTier the caller specifies (it may differ from the base script's tier).
4. Turn count may change modestly (±30%) but must remain between 4 and 30 turns.
5. Speaker alternation should remain natural; do not have the same speaker for 4+ turns in a row.
6. Output MUST be valid JSON, matching exactly this shape:

{
  "title": string,
  "scenario": string,
  "qualityTier": "poor" | "acceptable" | "excellent",
  "equipment": string (optional),
  "voices": { "agent": string, "customer": string },
  "turns": Array<
    | { "speaker": "agent" | "customer", "text": string }
    | { "speaker": "hold", "duration": number }
    | { "speaker": "interrupt", "primarySpeaker": "agent" | "customer", "text": string, "interruptText": string }
  >
}

7. Return ONLY the JSON. No markdown, no prose, no code fences.

Circumstance glossary:
- angry: customer is frustrated and shows it; softer language is replaced by terse demands; exclamations allowed but don't overdo them.
- hard_of_hearing: customer occasionally asks the agent to repeat something; may mishear a detail and need clarification.
- escalation: the call ends with the customer requesting a supervisor; add 2–4 turns at the tail reflecting that.
- confused: customer repeatedly asks clarifying questions, pauses, seems lost.
- non_native_speaker: simpler sentence structure for the customer, occasional minor word choice oddities (still understandable — do not caricature).
- time_pressure: terse, hurried customer lines; customer may interrupt or cut off the agent.
- grateful: warm, affirming customer; "thank you so much" / "I really appreciate it" throughout.
- distressed: emotional urgency; short sentences; customer may sound overwhelmed.`;

function buildRewritePrompt(input: RewriteInput): string {
  const circumstanceBlock =
    input.circumstances.length === 0
      ? "(none — return the script essentially unchanged, just adjusted to the target quality tier)"
      : input.circumstances.map((c) => `- ${c}: ${CIRCUMSTANCE_META[c]?.description ?? ""}`).join("\n");

  const targetTier = input.targetQualityTier ?? input.baseScript.qualityTier;

  return [
    SYSTEM_INSTRUCTIONS,
    "",
    "## BASE SCRIPT",
    "```json",
    JSON.stringify(input.baseScript, null, 2),
    "```",
    "",
    "## REQUESTED CIRCUMSTANCES",
    circumstanceBlock,
    "",
    `## TARGET QUALITY TIER: ${targetTier}`,
    "",
    "Return ONLY the rewritten script JSON. Preserve the voices mapping exactly.",
  ].join("\n");
}

// ── JSON extraction ────────────────────────────────────────────────

/**
 * Pull the first balanced JSON object out of a string that may contain
 * prose or code fences around it. Returns null if no balanced object
 * is found. Uses a depth counter with string-literal awareness so
 * `{"text":"foo}bar"}` still parses.
 */
function extractJsonObject(text: string): string | null {
  // Strip ```json ... ``` fences first if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const firstBrace = candidate.indexOf("{");
  if (firstBrace < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(firstBrace, i + 1);
    }
  }
  return null;
}

// ── Public API ─────────────────────────────────────────────────────

export class ScriptRewriterError extends Error {
  constructor(
    message: string,
    public readonly stage: "unavailable" | "model_error" | "parse_error" | "validation_error",
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ScriptRewriterError";
  }
}

/**
 * Rewrite a script via Bedrock. Throws `ScriptRewriterError` on any
 * failure so callers can distinguish stage-specific issues.
 *
 * Contract:
 * - Returns a script that has passed `simulatedCallScriptSchema` parse.
 * - `voices` is force-restored from the base script (model cannot swap).
 * - `qualityTier` is force-set from `targetQualityTier` if provided.
 */
export async function rewriteScript(input: RewriteInput): Promise<RewriteResult> {
  if (!aiProvider.isAvailable || !aiProvider.generateText) {
    throw new ScriptRewriterError(
      "AI provider is not configured — set AWS credentials to enable script rewriting",
      "unavailable",
    );
  }

  const prompt = buildRewritePrompt(input);
  let raw: string;
  try {
    raw = await aiProvider.generateText(prompt, REWRITE_MAX_TOKENS);
  } catch (err) {
    throw new ScriptRewriterError(`Bedrock generateText failed: ${(err as Error).message}`, "model_error", err);
  }

  const jsonBlob = extractJsonObject(raw);
  if (!jsonBlob) {
    logger.warn({ sample: raw.slice(0, 200) }, "script-rewriter: model response had no JSON block");
    throw new ScriptRewriterError("Model response did not contain a JSON object", "parse_error", {
      sample: raw.slice(0, 200),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlob);
  } catch (err) {
    throw new ScriptRewriterError(`Model JSON was malformed: ${(err as Error).message}`, "parse_error", {
      jsonBlob: jsonBlob.slice(0, 500),
    });
  }

  const result = simulatedCallScriptSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ error: result.error.format() }, "script-rewriter: rewritten script failed schema validation");
    throw new ScriptRewriterError(
      "Rewritten script failed schema validation",
      "validation_error",
      result.error.flatten(),
    );
  }

  // Force-restore voices + tier so the model can't drift these.
  const script: SimulatedCallScript = {
    ...result.data,
    voices: input.baseScript.voices,
    qualityTier: input.targetQualityTier ?? input.baseScript.qualityTier,
  };

  return {
    script,
    rawResponse: raw,
    promptChars: prompt.length,
    responseChars: raw.length,
  };
}

// ── Script generation from a scenario description ──────────────────

export interface GenerateFromScenarioInput {
  title: string;
  scenario?: string;
  equipment?: string;
  qualityTier: "poor" | "acceptable" | "excellent";
  voices: { agent: string; customer: string };
  /** Requested number of turns. Model may produce ±20%. Default 10. */
  targetTurnCount?: number;
  /**
   * Set true to route through the default `aiProvider` (typically
   * Sonnet via `BEDROCK_MODEL`) instead of trying Haiku first. Useful
   * when the admin wants higher-quality dialogue at higher cost.
   */
  useStrong?: boolean;
}

function buildGeneratorPrompt(input: GenerateFromScenarioInput): string {
  const targetTurns = Math.max(4, Math.min(input.targetTurnCount ?? 10, 30));
  const tierExpectation = {
    excellent:
      "Excellent handling: the agent is warm, proactive, solves the customer's issue efficiently, offers follow-up, and leaves the customer satisfied.",
    acceptable:
      "Acceptable handling: the agent answers correctly but doesn't go the extra mile. Tone is neutral, resolution is adequate.",
    poor: "Poor handling: the agent is curt, dismissive, or unhelpful. May fail to resolve the issue or leave the customer frustrated.",
  }[input.qualityTier];

  return [
    "You are a writer producing realistic customer-service phone call scripts for a QA training tool. Generate a script from scratch given a title and a scenario description.",
    "",
    "Rules:",
    `1. Target approximately ${targetTurns} turns (±20% is fine). Natural back-and-forth — agent and customer alternate.`,
    "2. Every spoken turn must have non-empty `text`. Do not emit hold turns unless the scenario clearly calls for one.",
    "3. Preserve the voices mapping EXACTLY as given. Do not substitute voice IDs.",
    "4. Preserve the qualityTier exactly as given.",
    "5. The script should reflect a full realistic call: greeting, problem statement, resolution attempt, closing.",
    "6. Tone and outcome must match the quality tier expectation below.",
    "7. Output MUST be valid JSON matching this shape EXACTLY:",
    "",
    "{",
    '  "title": string,',
    '  "scenario": string,',
    '  "qualityTier": "poor" | "acceptable" | "excellent",',
    '  "equipment": string (optional),',
    '  "voices": { "agent": string, "customer": string },',
    '  "turns": Array<',
    '    | { "speaker": "agent" | "customer", "text": string }',
    '    | { "speaker": "hold", "duration": number }',
    "  >",
    "}",
    "",
    "8. Return ONLY the JSON. No markdown, no prose, no code fences.",
    "",
    `## TARGET QUALITY TIER: ${input.qualityTier}`,
    tierExpectation,
    "",
    "## SCRIPT TO GENERATE",
    "```json",
    JSON.stringify(
      {
        title: input.title,
        scenario: input.scenario ?? "",
        qualityTier: input.qualityTier,
        equipment: input.equipment ?? "",
        voices: input.voices,
        targetTurns,
      },
      null,
      2,
    ),
    "```",
    "",
    "Return ONLY the generated script JSON. Preserve the voices mapping exactly.",
  ].join("\n");
}

/** Best-effort: extract a numeric HTTP status from a Bedrock SDK error. */
function statusFrom(err: unknown): number | undefined {
  const e = err as { $metadata?: { httpStatusCode?: number }; statusCode?: number };
  return e?.$metadata?.httpStatusCode ?? e?.statusCode;
}

export async function generateScriptFromScenario(input: GenerateFromScenarioInput): Promise<RewriteResult> {
  if (!aiProvider.isAvailable || !aiProvider.generateText) {
    throw new ScriptRewriterError(
      "AI provider is not configured — set AWS credentials to enable script generation",
      "unavailable",
    );
  }
  if (!input.title.trim()) {
    throw new ScriptRewriterError("Title is required to generate a script", "validation_error");
  }

  const prompt = buildGeneratorPrompt(input);

  let raw: string;
  let fellBackFromHaiku = false;
  let modelUsed: RewriteResult["modelUsed"] = input.useStrong ? "default" : "haiku";

  if (input.useStrong) {
    // Caller asked for the strong model up front — skip Haiku.
    try {
      raw = await aiProvider.generateText!(prompt, GENERATE_MAX_TOKENS);
    } catch (err) {
      throw new ScriptRewriterError(`Bedrock generateText failed: ${(err as Error).message}`, "model_error", err);
    }
  } else {
    // Try Haiku first via a one-off provider; fall back to the default
    // aiProvider (Sonnet) on 4xx (typically "access denied" or "model
    // not found"). 429 (rate limit) and 5xx (Bedrock outage) surface
    // unchanged — falling back wouldn't help either.
    const haiku = new BedrockProvider(HAIKU_MODEL);
    try {
      raw = await haiku.generateText(prompt, GENERATE_MAX_TOKENS);
    } catch (err) {
      const status = statusFrom(err);
      const isRateLimit = status === 429;
      const isClient4xx = typeof status === "number" && status >= 400 && status < 500;
      const shouldFallback = isClient4xx && !isRateLimit;
      if (!shouldFallback) {
        throw new ScriptRewriterError(`Bedrock generateText failed: ${(err as Error).message}`, "model_error", err);
      }
      logger.warn(
        { haikuModel: HAIKU_MODEL, haikuStatus: status, haikuError: (err as Error).message },
        "script-generator: Haiku rejected, falling back to default model",
      );
      try {
        raw = await aiProvider.generateText!(prompt, GENERATE_MAX_TOKENS);
        fellBackFromHaiku = true;
        modelUsed = "fallback";
      } catch (fallbackErr) {
        throw new ScriptRewriterError(
          `Bedrock generateText failed (after Haiku fallback): ${(fallbackErr as Error).message}`,
          "model_error",
          fallbackErr,
        );
      }
    }
  }

  const jsonBlob = extractJsonObject(raw);
  if (!jsonBlob) {
    logger.warn(
      { sample: raw.slice(0, 400), totalChars: raw.length },
      "script-generator: model response had no JSON block",
    );
    throw new ScriptRewriterError("Model response did not contain a JSON object", "parse_error", {
      sample: raw.slice(0, 200),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlob);
  } catch (err) {
    throw new ScriptRewriterError(`Model JSON was malformed: ${(err as Error).message}`, "parse_error", {
      jsonBlob: jsonBlob.slice(0, 500),
    });
  }

  const result = simulatedCallScriptSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ error: result.error.format() }, "script-generator: generated script failed schema validation");
    throw new ScriptRewriterError(
      "Generated script failed schema validation",
      "validation_error",
      result.error.flatten(),
    );
  }

  // Force-restore voices + tier (model cannot drift these). Also preserve
  // the admin-supplied title verbatim — the model sometimes rewrites it
  // into something wordier and we want the Library card to match what
  // the admin typed.
  const script: SimulatedCallScript = {
    ...result.data,
    title: input.title,
    scenario: input.scenario ?? result.data.scenario,
    qualityTier: input.qualityTier,
    voices: input.voices,
  };

  return {
    script,
    rawResponse: raw,
    promptChars: prompt.length,
    responseChars: raw.length,
    modelUsed,
    fellBackFromHaiku,
  };
}

// Test seam — exported for unit tests so they can exercise the
// validator + voice-preservation logic without hitting Bedrock.
export const _internal = {
  buildRewritePrompt,
  buildGeneratorPrompt,
  extractJsonObject,
  HAIKU_MODEL,
  REWRITE_MAX_TOKENS,
  GENERATE_MAX_TOKENS,
};
