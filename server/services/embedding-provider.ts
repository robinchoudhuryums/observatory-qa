/**
 * Embedding Provider Interface
 *
 * Abstraction layer for embedding models. Allows swapping embedding
 * models (e.g., Titan → Cohere → OpenAI) without changing calling code.
 *
 * Ported from ums-knowledge-reference.
 */

export interface EmbeddingProvider {
  /** Human-readable name (e.g., "Amazon Titan Embed V2") */
  readonly name: string;
  /** Output dimension count (e.g., 1024) */
  readonly dimensions: number;
  /** Max input characters */
  readonly maxInputChars: number;
  /** Generate a single embedding */
  embed(text: string): Promise<number[]>;
  /** Check if the provider is available */
  isAvailable(): boolean;
}
