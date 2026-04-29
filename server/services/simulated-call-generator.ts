/**
 * Simulated Call Generator pipeline.
 *
 * Takes a `simulated_calls` row at status=pending and runs the full
 * synthesis pipeline:
 *
 *   1. (optional) Bedrock script rewrite for non-rule circumstances
 *   2. Rule-based circumstance modifiers (`angry`, `hard_of_hearing`,
 *      `escalation`)
 *   3. Per-turn TTS via ElevenLabs (with disfluency injection on
 *      acceptable/poor tiers)
 *   4. Audio assembly via ffmpeg (concat with gap distribution + hold
 *      silence segments)
 *   5. Upload rendered MP3 to S3 (via storage.uploadAudio)
 *   6. Persist status=ready + audioS3Key + cost/duration metrics
 *
 * On any failure: status flips to "failed" with `error` populated. The
 * BullMQ worker treats thrown errors as retryable; after retries are
 * exhausted, the row stays at status=failed.
 *
 * All external dependencies (TTS, audio assembly, RNG) are injectable
 * so the unit tests can run without ElevenLabs, ffmpeg, or randomness.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { storage as defaultStorage } from "../storage";
import { logger } from "./logger";
import { elevenLabsClient } from "./elevenlabs-client";
import { addDisfluencies } from "./disfluency";
import { applyCircumstanceModifiers } from "./circumstance-modifiers";
import { rewriteScript } from "./script-rewriter";
import { estimateElevenLabsCost } from "./cost-estimation";
import type { IStorage } from "../storage/types";
import {
  CIRCUMSTANCE_META,
  type Circumstance,
  type SimulatedCall,
  type SimulatedCallScript,
  type SimulatedTurn,
  type VoiceSettings,
} from "@shared/schema";

// ── Audio segment types ─────────────────────────────────────────────

export type AudioSegment = { kind: "audio"; buffer: Buffer } | { kind: "silence"; durationMs: number };

// ── Injectable dependencies ─────────────────────────────────────────

export interface TtsSynthesizer {
  synthesize(text: string, voiceId: string, voiceSettings?: VoiceSettings): Promise<{ audio: Buffer; chars: number }>;
}

export interface AudioAssembler {
  assemble(segments: AudioSegment[]): Promise<{ buffer: Buffer; durationSeconds: number }>;
}

export interface GeneratorDeps {
  tts?: TtsSynthesizer;
  assembler?: AudioAssembler;
  rng?: () => number;
  /** Override storage for tests. Defaults to the singleton from server/storage. */
  storage?: IStorage;
}

// ── Default implementations ─────────────────────────────────────────

const defaultTts: TtsSynthesizer = {
  async synthesize(text, voiceId, voiceSettings) {
    const result = await elevenLabsClient.textToSpeech({
      text,
      voiceId,
      stability: voiceSettings?.stability,
      similarityBoost: voiceSettings?.similarityBoost,
    });
    return { audio: result.audio, chars: result.characterCount };
  },
};

/**
 * ffmpeg-based concat. Writes each audio segment to a temp .mp3 and each
 * silence segment to a generated silent .mp3, then runs:
 *   ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp3
 *
 * Falls back gracefully if ffmpeg isn't on PATH — the orchestrator catches
 * the throw and marks the row failed with a clear error.
 */
const defaultAssembler: AudioAssembler = {
  async assemble(segments) {
    if (segments.length === 0) {
      throw new Error("No audio segments to assemble");
    }
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "simulated-call-"));
    try {
      const segmentFiles: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const filePath = path.join(tmp, `seg-${String(i).padStart(4, "0")}.mp3`);
        if (seg.kind === "audio") {
          await fs.writeFile(filePath, seg.buffer);
        } else {
          await runFfmpeg([
            "-f",
            "lavfi",
            "-i",
            `anullsrc=r=44100:cl=mono`,
            "-t",
            (seg.durationMs / 1000).toFixed(3),
            "-c:a",
            "libmp3lame",
            "-q:a",
            "5",
            "-y",
            filePath,
          ]);
        }
        segmentFiles.push(filePath);
      }
      const listPath = path.join(tmp, "list.txt");
      await fs.writeFile(listPath, segmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
      const outPath = path.join(tmp, "out.mp3");
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-y", outPath]);
      const buffer = await fs.readFile(outPath);
      const durationSeconds = await probeDurationSeconds(outPath);
      return { buffer, durationSeconds };
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  },
};

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.once("error", reject);
    proc.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let stdout = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.once("error", () => resolve(0));
    proc.once("close", () => {
      const seconds = parseFloat(stdout.trim());
      resolve(Number.isFinite(seconds) ? Math.round(seconds) : 0);
    });
  });
}

// ── Pipeline ────────────────────────────────────────────────────────

/**
 * Build the segment plan from a script + config. Pure — no I/O.
 * Tests pass a stub `tts` to verify the right text/voiceId pairs flow through.
 */
export async function runTtsPipeline(
  script: SimulatedCallScript,
  config: SimulatedCall["config"] & {
    gapMeanSeconds?: number;
    gapStdDevSeconds?: number;
    holdMusicUrl?: string | null;
    disfluencies?: boolean;
  },
  deps: { tts: TtsSynthesizer; rng: () => number },
): Promise<{ segments: AudioSegment[]; ttsCharCount: number }> {
  const segments: AudioSegment[] = [];
  let ttsCharCount = 0;
  const tier = script.qualityTier;
  const injectDisfluencies = config.disfluencies !== false; // default true
  const gapMeanMs = (config.gapMeanSeconds ?? 0.8) * 1000;
  const gapStdDevMs = (config.gapStdDevSeconds ?? 0.3) * 1000;

  for (let i = 0; i < script.turns.length; i++) {
    const turn = script.turns[i];

    if (turn.speaker === "hold") {
      segments.push({ kind: "silence", durationMs: turn.duration * 1000 });
      continue;
    }

    if (i > 0) {
      // Insert inter-turn gap. Box-Muller would be ideal; deterministic +/-
      // 1 std-dev is good enough for our purposes and avoids the second
      // RNG draw needed by Box-Muller.
      const jitter = (deps.rng() * 2 - 1) * gapStdDevMs;
      const gapMs = Math.max(50, gapMeanMs + jitter);
      segments.push({ kind: "silence", durationMs: gapMs });
    }

    if (turn.speaker === "agent" || turn.speaker === "customer") {
      const voiceId = turn.speaker === "agent" ? script.voices.agent : script.voices.customer;
      const text = injectDisfluencies ? addDisfluencies(turn.text, tier, deps.rng) : turn.text;
      const voiceSettings = turn.voiceSettings ?? script.defaultVoiceSettings;
      const result = await deps.tts.synthesize(text, voiceId, voiceSettings);
      segments.push({ kind: "audio", buffer: result.audio });
      ttsCharCount += result.chars;
    } else {
      // Interrupt turn — TTS the interrupt text using the agent voice as a
      // sane default (script doesn't dictate which side interrupts).
      const interruptText = (turn as { interruptText: string }).interruptText;
      const result = await deps.tts.synthesize(interruptText, script.voices.agent);
      segments.push({ kind: "audio", buffer: result.audio });
      ttsCharCount += result.chars;
    }
  }

  return { segments, ttsCharCount };
}

/**
 * Apply non-rule (LLM) and rule-based circumstance modifiers in the
 * correct order. Rule-based ones run on the rewritten script if a
 * rewrite happened; otherwise on the original.
 */
async function applyCircumstancePipeline(
  baseScript: SimulatedCallScript,
  circumstances: Circumstance[],
  rng: () => number,
): Promise<{ script: SimulatedCallScript; rewroteWithLlm: boolean }> {
  const llmCircumstances = circumstances.filter((c) => CIRCUMSTANCE_META[c]?.ruleBased === false);
  const ruleCircumstances = circumstances.filter((c) => CIRCUMSTANCE_META[c]?.ruleBased === true);

  let script: SimulatedCallScript = baseScript;
  let rewroteWithLlm = false;

  if (llmCircumstances.length > 0) {
    try {
      const rewritten = await rewriteScript({ baseScript: script, circumstances: llmCircumstances });
      script = rewritten.script;
      rewroteWithLlm = true;
    } catch (err) {
      // Rewrite failure is non-fatal — fall back to the original script.
      // The audit log will show the issue but generation still proceeds.
      logger.warn({ err, circumstances: llmCircumstances }, "Script rewrite failed, falling back to base script");
    }
  }

  if (ruleCircumstances.length > 0) {
    const turns = applyCircumstanceModifiers(script, ruleCircumstances, rng);
    script = { ...script, turns: turns as SimulatedTurn[] };
  }

  return { script, rewroteWithLlm };
}

// ── Top-level orchestrator ──────────────────────────────────────────

export class SimulatedCallGenerationError extends Error {
  constructor(
    message: string,
    public readonly stage: "load" | "rewrite" | "tts" | "assemble" | "upload" | "unavailable",
  ) {
    super(message);
    this.name = "SimulatedCallGenerationError";
  }
}

/**
 * Run the generator end-to-end for a single simulated_calls row.
 * Throws on retryable failures so the BullMQ worker retries; the
 * row is also stamped with status=failed + error so the UI surfaces it.
 */
export async function generateSimulatedCall(
  orgId: string,
  simulatedCallId: string,
  deps: GeneratorDeps = {},
): Promise<{ audioS3Key: string; durationSeconds: number; ttsCharCount: number; estimatedCost: number }> {
  const tts = deps.tts ?? defaultTts;
  const assembler = deps.assembler ?? defaultAssembler;
  const rng = deps.rng ?? Math.random;
  const storage = deps.storage ?? defaultStorage;

  const row = await storage.getSimulatedCall(orgId, simulatedCallId);
  if (!row) {
    throw new SimulatedCallGenerationError("Simulated call not found", "load");
  }
  if (row.status === "ready") {
    logger.info({ orgId, simulatedCallId }, "Simulated call already ready, skipping");
    return {
      audioS3Key: row.audioS3Key ?? "",
      durationSeconds: row.durationSeconds ?? 0,
      ttsCharCount: row.ttsCharCount ?? 0,
      estimatedCost: row.estimatedCost ?? 0,
    };
  }

  await storage.updateSimulatedCall(orgId, simulatedCallId, { status: "generating", error: null });

  try {
    const config = row.config as SimulatedCall["config"];
    const circumstances = (config?.circumstances ?? []) as Circumstance[];

    const { script } = await applyCircumstancePipeline(row.script as SimulatedCallScript, circumstances, rng);
    const { segments, ttsCharCount } = await runTtsPipeline(script, config, { tts, rng });

    let audio: Buffer;
    let durationSeconds: number;
    try {
      const assembled = await assembler.assemble(segments);
      audio = assembled.buffer;
      durationSeconds = assembled.durationSeconds;
    } catch (err) {
      throw new SimulatedCallGenerationError(
        `Audio assembly failed: ${(err as Error).message ?? "unknown"}`,
        "assemble",
      );
    }

    const fileName = `simulated-${simulatedCallId}.mp3`;
    const audioS3Key = `${orgId}/audio/${simulatedCallId}/${fileName}`;
    try {
      await storage.uploadAudio(orgId, simulatedCallId, fileName, audio, "audio/mpeg");
    } catch (err) {
      throw new SimulatedCallGenerationError(`Audio upload failed: ${(err as Error).message ?? "unknown"}`, "upload");
    }

    const estimatedCost = estimateElevenLabsCost(ttsCharCount);
    await storage.updateSimulatedCall(orgId, simulatedCallId, {
      status: "ready",
      audioS3Key,
      audioFormat: "mp3",
      durationSeconds,
      ttsCharCount,
      estimatedCost,
      error: null,
    });

    logger.info(
      { orgId, simulatedCallId, durationSeconds, ttsCharCount, estimatedCost },
      "Simulated call generation complete",
    );
    return { audioS3Key, durationSeconds, ttsCharCount, estimatedCost };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stage = err instanceof SimulatedCallGenerationError ? err.stage : "tts";
    await storage
      .updateSimulatedCall(orgId, simulatedCallId, {
        status: "failed",
        error: `[${stage}] ${message}`.slice(0, 1000),
      })
      .catch((updateErr) => logger.warn({ updateErr }, "Failed to mark simulated call as failed"));
    throw err;
  }
}

// ── Test surface ────────────────────────────────────────────────────
export const _internal = { applyCircumstancePipeline };
