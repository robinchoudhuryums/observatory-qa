/**
 * Cost estimation functions for AI and transcription services.
 *
 * Pure math functions with no external dependencies — safe to import
 * from services, routes, and workers.
 */

/** Estimate Bedrock cost based on model and token counts. */
export function estimateBedrockCost(model: string, inputTokens: number, outputTokens: number): number {
  // Approximate pricing per 1K tokens (input, output) — updated as of 2026
  const pricing: Record<string, [number, number]> = {
    "us.anthropic.claude-sonnet-4-6": [0.003, 0.015],
    "us.anthropic.claude-sonnet-4-20250514": [0.003, 0.015],
    "us.anthropic.claude-haiku-4-5-20251001": [0.001, 0.005],
    "anthropic.claude-3-haiku-20240307": [0.00025, 0.00125],
    "anthropic.claude-3-5-sonnet-20241022": [0.003, 0.015],
  };
  const [inputRate, outputRate] = pricing[model] || [0.003, 0.015];
  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

/** Estimate AssemblyAI cost: base $0.15/hr + sentiment $0.02/hr = $0.17/hr = ~$0.0000472/sec */
export function estimateAssemblyAICost(durationSeconds: number): number {
  return durationSeconds * 0.0000472;
}

/**
 * Estimate ElevenLabs TTS cost per character.
 *
 * Standard tier is $0.30 per 1000 characters → $0.0003/char. Override
 * via `ELEVENLABS_COST_PER_CHAR` env var when on a different tier
 * (Creator, Pro, Scale, Business each have lower per-character rates).
 *
 * Used by the Simulated Call Generator to attribute per-org TTS spend
 * into `usage_records`.
 */
export function estimateElevenLabsCost(characterCount: number): number {
  const perChar = Number(process.env.ELEVENLABS_COST_PER_CHAR);
  const rate = Number.isFinite(perChar) && perChar > 0 ? perChar : 0.0003;
  // 4 decimals — keeps the value JSON-stable for usage_record diffs.
  return Math.round(characterCount * rate * 10000) / 10000;
}
