/**
 * ElevenLabs TTS REST client.
 *
 * Adapted from the single-tenant CallAnalyzer (assemblyai_tool) for
 * Observatory QA. Mirrors the AssemblyAIService pattern: thin fetch
 * wrapper, API key from env, graceful degradation (`isAvailable=false`)
 * when the key is missing, no SDK dependency.
 *
 * Used by the upcoming Simulated Call Generator feature to synthesize
 * per-turn audio clips. The client itself is org-agnostic — multi-tenant
 * scoping (plan-tier gating, per-org cost attribution) lives at the
 * route layer that wraps this client.
 *
 * Pricing reference (standard tier, as of this writing):
 *   $0.30 per 1000 characters → tracked in usage_records via
 *   `estimateElevenLabsCost()` in `cost-estimation.ts`.
 *
 * Rate limiting: ElevenLabs limits concurrent requests per API key. The
 * caller is expected to serialize via the existing BullMQ queue
 * infrastructure; this client adds defense-in-depth via exponential
 * backoff + jitter on 429 (de-correlates concurrent workers so they
 * don't all retry at exactly the same instant).
 */
import { logger } from "./logger";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const TTS_TIMEOUT_MS = 60_000; // 60s — per-turn generation rarely takes >15s
const VOICES_TIMEOUT_MS = 10_000;

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
  description?: string;
}

export interface TextToSpeechOptions {
  /** Voice ID from ElevenLabs — listed via `/voices`. */
  voiceId: string;
  /** Text to synthesize. Length-cap enforcement is the caller's responsibility. */
  text: string;
  /** Model ID — defaults to `eleven_flash_v2_5` for lower latency/cost. */
  modelId?: string;
  /** Output format — `mp3_44100_128` (default) | `pcm_16000` | etc. */
  outputFormat?: string;
  /** Voice stability (0-1). Lower = more expressive, higher = more consistent. */
  stability?: number;
  /** Similarity boost (0-1). Controls adherence to the reference voice. */
  similarityBoost?: number;
}

export interface TtsResult {
  audio: Buffer;
  /** Character count billed by ElevenLabs (== `text.length` for most cases). */
  characterCount: number;
  latencyMs: number;
}

export class ElevenLabsClient {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || "";
    if (!this.apiKey) {
      logger.warn("ELEVENLABS_API_KEY is not set — Simulated Call Generator TTS will fail when invoked");
    }
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not set — set it in .env to use the Simulated Call Generator");
    }
    return this.apiKey;
  }

  /**
   * Fetch the list of available voices on the API key's account.
   * Results are intended to be cached at the route layer (LRU/TTL).
   */
  async listVoices(): Promise<ElevenLabsVoice[]> {
    const apiKey = this.requireKey();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VOICES_TIMEOUT_MS);
    try {
      const res = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
        headers: { "xi-api-key": apiKey, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`ElevenLabs /voices failed: ${res.status} — ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { voices?: ElevenLabsVoice[] };
      return data.voices ?? [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Synthesize one turn of text into MP3 audio. Returns a Buffer plus the
   * billed character count for usage tracking.
   *
   * Retries up to 3 times on 429 (rate limit) with exponential backoff +
   * jitter (1s/2s/4s ± 20%). Without jitter, concurrent workers hitting
   * the rate limit at T+0 would all retry at exactly the same T+1s and
   * collide again — the jitter de-correlates them. Other errors surface
   * to the caller and should fail the job.
   */
  async textToSpeech(options: TextToSpeechOptions): Promise<TtsResult> {
    const apiKey = this.requireKey();
    const model = options.modelId ?? "eleven_flash_v2_5";
    const output = options.outputFormat ?? "mp3_44100_128";

    const body = {
      text: options.text,
      model_id: model,
      voice_settings: {
        stability: options.stability ?? 0.5,
        similarity_boost: options.similarityBoost ?? 0.75,
      },
    };

    const url = `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=${encodeURIComponent(output)}`;
    const start = Date.now();

    const attempt = async (): Promise<Response> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS);
      try {
        return await fetch(url, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    const RETRY_DELAYS_MS = [1000, 2000, 4000];
    let res = await attempt();
    for (let i = 0; res.status === 429 && i < RETRY_DELAYS_MS.length; i++) {
      const base = RETRY_DELAYS_MS[i];
      const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
      const delay = Math.max(250, Math.round(base + jitter));
      logger.warn(
        { voiceId: options.voiceId, attempt: i + 1, delayMs: delay },
        "ElevenLabs 429 — retrying with backoff",
      );
      await new Promise((r) => setTimeout(r, delay));
      res = await attempt();
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed: ${res.status} — ${txt.slice(0, 200)}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuf),
      characterCount: options.text.length,
      latencyMs: Date.now() - start,
    };
  }
}

export const elevenLabsClient = new ElevenLabsClient();
