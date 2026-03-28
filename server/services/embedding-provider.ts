/**
 * Embedding provider interface — allows swapping embedding models
 * without changing calling code.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  readonly maxInputChars: number;
  embed(text: string): Promise<number[]>;
  isAvailable(): boolean;
}
