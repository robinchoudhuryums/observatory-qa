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
